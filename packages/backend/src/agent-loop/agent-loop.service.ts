import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { ChatGateway } from '../gateway/chat.gateway';
import {
  Annotation,
  StateGraph,
  START,
  END,
  interrupt,
  Command,
  MemorySaver,
} from '@langchain/langgraph';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { filterTools, TOOL_MAP, HIGH_RISK_TOOLS } from './tools';
import type { ChatOpenAI } from '@langchain/openai';
import type { StructuredToolInterface } from '@langchain/core/tools';

/** Max execution time for an agent loop (180s per project spec). */
const LOOP_TIMEOUT_MS = 180_000;

// ── State ─────────────────────────────────────────────────────

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  agentId: Annotation<string>(),
  conversationId: Annotation<string>(),
  iterationCount: Annotation<number>(),
});

type AgentStateType = typeof AgentState.State;

// ── Thread tracking for HITL resume ──────────────────────────

interface ActiveLoop {
  threadId: string;
  agentId: string;
  conversationId: string;
}

@Injectable()
export class AgentLoopService {
  private readonly logger = new Logger(AgentLoopService.name);
  /** Shared in-memory checkpointer for LangGraph interrupt support */
  private readonly checkpointer = new MemorySaver();
  /** Map of conversationId::agentId → ActiveLoop for HITL resume */
  private readonly activeLoops = new Map<string, ActiveLoop>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly chatGateway: ChatGateway,
  ) {}

  // ── Public API ──────────────────────────────────────────────

  /**
   * Run the ReAct loop for an agent responding to a user message.
   * Spawned asynchronously — does not block the WebSocket handler.
   */
  async runAgentLoop(params: {
    agentId: string;
    conversationId: string;
    userMessage: string;
  }): Promise<void> {
    const { agentId, conversationId, userMessage } = params;

    try {
      // 1. Load agent config
      const agent = await this.prisma.agent.findFirst({
        where: { id: agentId, deletedAt: null },
      });
      if (!agent) {
        this.logger.warn(`Agent ${agentId} not found, skipping loop`);
        return;
      }

      // 2. Resolve model
      let model: ChatOpenAI;
      if (agent.assignedModelId) {
        model = await this.llmService.getModelByProviderModelId(agent.assignedModelId);
      } else {
        model = await this.llmService.getDefaultModelByRole('big');
      }

      // 3. Bind tools to LLM
      const agentTools = filterTools(agent.tools);
      const llmWithTools = model.bindTools(agentTools as StructuredToolInterface[]);

      // 4. Load conversation history (last 20 messages for context window)
      const recentMessages = await this.loadRecentMessages(conversationId, 20);

      // 5. Build & compile graph
      const threadId = `agent-${agentId}-${Date.now()}`;
      const graph = this.buildGraph(llmWithTools, agent.systemPrompt, agent.tools);

      // 6. Execute with streaming (with 180s timeout)
      const input = {
        messages: [
          ...recentMessages,
          new HumanMessage(userMessage),
        ],
        agentId,
        conversationId,
        iterationCount: 0,
      };

      const stream = await graph.stream(input, {
        configurable: { thread_id: threadId },
        streamMode: 'updates',
      });

      let finalContent = '';
      let isTimedOut = false;

      const timeoutId = setTimeout(() => {
        isTimedOut = true;
      }, LOOP_TIMEOUT_MS);

      const streamPromise = (async () => {
        for await (const update of stream) {
          if (isTimedOut) return; // Stop processing after timeout

          // Check for interrupt (HITL pause)
          if ('__interrupt__' in update) {
            const interruptData = (update as Record<string, unknown>).__interrupt__;
            await this.handleApprovalInterrupt(
              threadId,
              { agentId, conversationId },
              interruptData as ApprovalInterruptData,
            );
            return; // Loop pauses here; resumed via resumeLoop()
          }

          // Process agent node output
          if ('agent' in update) {
            const agentUpdate = update.agent as { messages?: BaseMessage[] };
            if (agentUpdate.messages) {
              for (const msg of agentUpdate.messages) {
                if (msg instanceof AIMessage) {
                  const content = typeof msg.content === 'string'
                    ? msg.content
                    : JSON.stringify(msg.content);
                  finalContent = content;

                  if (content && !isTimedOut) {
                    this.chatGateway.emitMessageStream(conversationId, {
                      agentId,
                      content,
                    });
                  }
                }
              }
            }
          }

          if ('tools' in update) {
            this.logger.log(`Tools executed for agent ${agentId}`);
          }
        }
      })();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Agent loop timed out after ${LOOP_TIMEOUT_MS / 1000}s`)),
          LOOP_TIMEOUT_MS,
        ),
      );

      try {
        await Promise.race([streamPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
      }

      // 7. Persist final message
      if (finalContent && !isTimedOut) {
        const persisted = await this.persistAgentMessage(
          conversationId, agentId, finalContent,
        );
        this.chatGateway.emitMessageComplete(conversationId, {
          messageId: persisted.id,
          agentId,
          content: finalContent,
          messageType: 'text',
        });
      }

      this.chatGateway.emitAgentThinking(conversationId, {
        agentId,
        content: undefined,
      });

      this.logger.log(
        `Agent loop completed: ${agentId} in conversation ${conversationId}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Agent loop failed: ${msg}`);
      // Clean up any active loop entry (e.g., if timed out after an interrupt)
      const loopKey = `${params.conversationId}::${params.agentId}`;
      this.activeLoops.delete(loopKey);
      this.chatGateway.emitAgentThinking(params.conversationId, {
        agentId: params.agentId,
        content: undefined,
      });
      this.chatGateway.emitError(params.conversationId, {
        code: 'AGENT_LOOP_ERROR',
        message: msg,
      });
    }
  }

  /**
   * Resume a paused agent loop after HITL approval/denial.
   */
  async resumeLoop(
    conversationId: string,
    agentId: string,
    approvalResult: { approved: boolean; decision: string },
  ): Promise<void> {
    const key = `${conversationId}::${agentId}`;
    const active = this.activeLoops.get(key);
    if (!active) {
      this.logger.warn(`No active loop for ${key}`);
      return;
    }

    try {
      const agent = await this.prisma.agent.findFirst({
        where: { id: active.agentId, deletedAt: null },
      });
      if (!agent) return;

      let model: ChatOpenAI;
      if (agent.assignedModelId) {
        model = await this.llmService.getModelByProviderModelId(agent.assignedModelId);
      } else {
        model = await this.llmService.getDefaultModelByRole('big');
      }

      const agentTools = filterTools(agent.tools);
      const llmWithTools = model.bindTools(agentTools as StructuredToolInterface[]);
      const graph = this.buildGraph(llmWithTools, agent.systemPrompt, agent.tools);

      // Resume with Command (with timeout)
      const stream = await graph.stream(
        new Command({ resume: approvalResult }),
        {
          configurable: { thread_id: active.threadId },
          streamMode: 'updates',
        },
      );

      let finalContent = '';
      let isTimedOut = false;

      const timeoutId = setTimeout(() => {
        isTimedOut = true;
      }, LOOP_TIMEOUT_MS);

      const streamPromise = (async () => {
        for await (const update of stream) {
          if (isTimedOut) return;

          if ('__interrupt__' in update) {
            const interruptData = (update as Record<string, unknown>).__interrupt__;
            await this.handleApprovalInterrupt(
              active.threadId,
              { agentId: active.agentId, conversationId },
              interruptData as ApprovalInterruptData,
            );
            return;
          }

          if ('agent' in update) {
            const agentUpdate = update.agent as { messages?: BaseMessage[] };
            if (agentUpdate.messages) {
              for (const msg of agentUpdate.messages) {
                if (msg instanceof AIMessage) {
                  const content = typeof msg.content === 'string'
                    ? msg.content
                    : JSON.stringify(msg.content);
                  finalContent = content;
                  if (content && !isTimedOut) {
                    this.chatGateway.emitMessageStream(conversationId, {
                      agentId: active.agentId,
                      content,
                    });
                  }
                }
              }
            }
          }
        }
      })();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Agent loop timed out after ${LOOP_TIMEOUT_MS / 1000}s`)),
          LOOP_TIMEOUT_MS,
        ),
      );

      try {
        await Promise.race([streamPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
      }

      if (finalContent && !isTimedOut) {
        const persisted = await this.persistAgentMessage(
          conversationId, active.agentId, finalContent,
        );
        this.chatGateway.emitMessageComplete(conversationId, {
          messageId: persisted.id,
          agentId: active.agentId,
          content: finalContent,
          messageType: 'text',
        });
      }

      this.chatGateway.emitAgentThinking(conversationId, {
        agentId: active.agentId,
        content: undefined,
      });

      this.activeLoops.delete(key);
      this.logger.log(`Resumed loop completed: ${active.agentId}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Resume loop failed: ${msg}`);
      this.chatGateway.emitAgentThinking(conversationId, {
        agentId,
        content: undefined,
      });
      this.chatGateway.emitError(conversationId, {
        code: 'AGENT_LOOP_ERROR',
        message: msg,
      });
      this.activeLoops.delete(key);
    }
  }

  // ── Graph construction ──────────────────────────────────────

  private buildGraph(
    llm: ReturnType<ChatOpenAI['bindTools']>,
    systemPrompt: string,
    enabledToolNames: string[],
  ) {
    const service = this;
    const enabledSet = new Set(enabledToolNames);

    // ── Node: agent ────────────────────────────────────────────
    async function agentNode(
      state: AgentStateType,
    ): Promise<Partial<AgentStateType>> {
      const systemMsg = new SystemMessage(systemPrompt);
      const messages = [systemMsg, ...state.messages];

      service.chatGateway.emitAgentThinking(state.conversationId, {
        agentId: state.agentId,
        content: 'Thinking...',
      });

      const response = await llm.invoke(messages);

      return {
        messages: [response],
        iterationCount: state.iterationCount + 1,
      };
    }

    // ── Node: tools ────────────────────────────────────────────
    async function toolsNode(
      state: AgentStateType,
    ): Promise<Partial<AgentStateType>> {
      const lastMessage = state.messages[state.messages.length - 1];
      if (!(lastMessage instanceof AIMessage) || !lastMessage.tool_calls?.length) {
        return {};
      }

      const results: ToolMessage[] = [];

      for (const toolCall of lastMessage.tool_calls) {
        const toolName = toolCall.name;
        const toolArgs = (toolCall.args ?? {}) as Record<string, unknown>;

        service.chatGateway.emitToolStart(state.conversationId, {
          agentId: state.agentId,
          toolName,
          input: toolArgs,
        });

        try {
          // HITL check for high-risk tools
          if (HIGH_RISK_TOOLS.has(toolName)) {
            const approval = interrupt({
              toolName,
              toolArgs,
              agentId: state.agentId,
              conversationId: state.conversationId,
              riskLevel: 'high',
              reason: `Agent wants to execute ${toolName}`,
            }) as ApprovalResult;

            // Defensive check: ensure resume value has expected shape
            if (!approval || typeof approval.approved !== 'boolean') {
              results.push(
                new ToolMessage({
                  tool_call_id: toolCall.id!,
                  content: 'Tool execution rejected: invalid approval response',
                }),
              );
              service.chatGateway.emitToolEnd(state.conversationId, {
                agentId: state.agentId,
                toolName,
                error: 'Invalid approval response',
              });
              continue;
            }

            if (!approval.approved) {
              results.push(
                new ToolMessage({
                  tool_call_id: toolCall.id!,
                  content: `Tool execution rejected by user: ${approval.decision ?? 'no reason'}`,
                }),
              );
              service.chatGateway.emitToolEnd(state.conversationId, {
                agentId: state.agentId,
                toolName,
                error: 'Rejected by user',
              });
              continue;
            }
          }

          // Find tool by name in registry
          const matchedTool = TOOL_MAP.get(toolName);
          if (!matchedTool) {
            results.push(
              new ToolMessage({
                tool_call_id: toolCall.id!,
                content: `Unknown tool: ${toolName}`,
              }),
            );
            service.chatGateway.emitToolEnd(state.conversationId, {
              agentId: state.agentId,
              toolName,
              error: `Unknown tool: ${toolName}`,
            });
            continue;
          }

          // Defense-in-depth: verify tool is in agent's enabled set
          if (!enabledSet.has(toolName)) {
            results.push(
              new ToolMessage({
                tool_call_id: toolCall.id!,
                content: `Tool "${toolName}" is not enabled for this agent`,
              }),
            );
            service.chatGateway.emitToolEnd(state.conversationId, {
              agentId: state.agentId,
              toolName,
              error: `Tool "${toolName}" is not enabled for this agent`,
            });
            continue;
          }

          const result = await matchedTool.invoke(toolArgs);
          const content = typeof result === 'string' ? result : JSON.stringify(result);

          results.push(
            new ToolMessage({
              tool_call_id: toolCall.id!,
              content,
            }),
          );

          service.chatGateway.emitToolEnd(state.conversationId, {
            agentId: state.agentId,
            toolName,
            result: content.slice(0, 500),
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          results.push(
            new ToolMessage({
              tool_call_id: toolCall.id!,
              content: `Tool error: ${msg}`,
            }),
          );
          service.chatGateway.emitToolEnd(state.conversationId, {
            agentId: state.agentId,
            toolName,
            error: msg,
          });
        }
      }

      return { messages: results };
    }

    // ── Router ─────────────────────────────────────────────────
    function router(state: AgentStateType): 'tools' | typeof END {
      const lastMessage = state.messages[state.messages.length - 1];

      // Hard limit: 15 iterations
      if (state.iterationCount >= 15) {
        service.logger.warn(
          `Agent ${state.agentId} hit iteration limit (15)`,
        );
        return END;
      }

      if (
        lastMessage instanceof AIMessage &&
        lastMessage.tool_calls?.length
      ) {
        return 'tools';
      }
      return END;
    }

    return new StateGraph(AgentState)
      .addNode('agent', agentNode)
      .addNode('tools', toolsNode)
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', router, {
        tools: 'tools',
        [END]: END,
      })
      .addEdge('tools', 'agent')
      .compile({ checkpointer: this.checkpointer });
  }

  // ── Helpers ─────────────────────────────────────────────────

  private async loadRecentMessages(
    conversationId: string,
    limit: number,
  ): Promise<BaseMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { role: true, content: true, agentId: true },
    });

    // Reverse to chronological order for LLM context
    return messages.reverse().map((m) => {
      if (m.role === 'user') return new HumanMessage(m.content);
      return new AIMessage({ content: m.content });
    });
  }

  private async persistAgentMessage(
    conversationId: string,
    agentId: string,
    content: string,
  ) {
    return this.prisma.message.create({
      data: {
        conversationId,
        role: 'agent',
        agentId,
        content,
        messageType: 'text',
      },
    });
  }

  private async handleApprovalInterrupt(
    threadId: string,
    loopInfo: { agentId: string; conversationId: string },
    interruptData: ApprovalInterruptData,
  ) {
    // Store thread mapping for resume (compound key for multi-agent group chat)
    const key = `${loopInfo.conversationId}::${loopInfo.agentId}`;
    this.activeLoops.set(key, {
      threadId,
      agentId: loopInfo.agentId,
      conversationId: loopInfo.conversationId,
    });

    // Derive risk level from interrupt data (default 'high' for HIGH_RISK_TOOLS)
    const VALID_RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);
    const riskLevel = VALID_RISK_LEVELS.has(interruptData.riskLevel)
      ? (interruptData.riskLevel as 'low' | 'medium' | 'high' | 'critical')
      : 'high';

    // Create approval request in DB
    const approval = await this.prisma.approvalRequest.create({
      data: {
        agentId: loopInfo.agentId,
        conversationId: loopInfo.conversationId,
        target: JSON.stringify(interruptData.toolArgs),
        operation: interruptData.toolName,
        toolName: interruptData.toolName,
        reason: interruptData.reason,
        riskLevel: riskLevel,
        status: 'pending',
      },
    });

    // Emit approval card to frontend
    this.chatGateway.emitApprovalRequest(loopInfo.conversationId, {
      approvalId: approval.id,
      agentId: loopInfo.agentId,
      target: JSON.stringify(interruptData.toolArgs),
      operation: interruptData.toolName,
      toolName: interruptData.toolName,
      reason: interruptData.reason,
      riskLevel,
    });

    this.logger.log(
      `HITL interrupt: agent=${loopInfo.agentId} tool=${interruptData.toolName}`,
    );
  }
}

// ── Types ─────────────────────────────────────────────────────

interface ApprovalInterruptData {
  toolName: string;
  toolArgs: Record<string, unknown>;
  agentId: string;
  conversationId: string;
  riskLevel: string;
  reason: string;
}

interface ApprovalResult {
  approved: boolean;
  decision: string;
}
import {
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { AgentLoopService } from '../agent-loop/agent-loop.service';
import { ParallelOrchestrator } from '../orchestration/parallel-orchestrator.service';
import { SupervisorEngine } from '../orchestration/supervisor-engine.service';
import { MessageType } from '../../generated/prisma/enums';

const VALID_MESSAGE_TYPES = new Set<string>(Object.values(MessageType));

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN ?? '*',
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AgentLoopService))
    private readonly agentLoopService: AgentLoopService,
    @Inject(forwardRef(() => ParallelOrchestrator))
    private readonly parallelOrchestrator: ParallelOrchestrator,
    @Inject(forwardRef(() => SupervisorEngine))
    private readonly supervisorEngine: SupervisorEngine,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ): Promise<{ event: string; data: unknown }> {
    if (!payload.conversationId || typeof payload.conversationId !== 'string') {
      client.emit('error', { code: 'INVALID_CONVERSATION_ID', message: 'conversationId is required and must be a string' });
      return { event: 'error', data: { code: 'INVALID_CONVERSATION_ID', message: 'conversationId is required and must be a string' } };
    }
    const room = `conversation:${payload.conversationId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);
    return { event: 'join_room', data: { conversationId: payload.conversationId } };
  }

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ): Promise<{ event: string; data: unknown }> {
    if (!payload.conversationId || typeof payload.conversationId !== 'string') {
      client.emit('error', { code: 'INVALID_CONVERSATION_ID', message: 'conversationId is required and must be a string' });
      return { event: 'error', data: { code: 'INVALID_CONVERSATION_ID', message: 'conversationId is required and must be a string' } };
    }
    const room = `conversation:${payload.conversationId}`;
    client.leave(room);
    this.logger.log(`Client ${client.id} left room ${room}`);
    return { event: 'leave_room', data: { conversationId: payload.conversationId } };
  }

  @SubscribeMessage('message:send')
  async handleMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      conversationId: string;
      content: string;
      agentId?: string;
      messageType?: string;
      parentId?: string;
    },
  ): Promise<{ event: string; data: unknown } | { event: string; data: { code: string; message: string } }> {
    this.logger.log(`message:send from conversation ${payload.conversationId}`);

    const messageType = payload.messageType ?? 'text';
    if (!VALID_MESSAGE_TYPES.has(messageType)) {
      this.logger.warn(`Invalid messageType: ${messageType}`);
      return {
        event: 'error',
        data: { code: 'INVALID_MESSAGE_TYPE', message: `Invalid messageType: ${messageType}` },
      };
    }

    if (!payload.content || typeof payload.content !== 'string' || !payload.content.trim()) {
      return {
        event: 'error',
        data: { code: 'INVALID_CONTENT', message: 'content is required and must be a non-empty string' },
      };
    }

    try {
      // Validate conversation exists and is not deleted
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: payload.conversationId, deletedAt: null },
      });
      if (!conversation) {
        return {
          event: 'error',
          data: { code: 'CONVERSATION_NOT_FOUND', message: `Conversation ${payload.conversationId} not found` },
        };
      }

      // Validate agentId in DM mode (agent existence + not soft-deleted)
      if (payload.agentId) {
        const agent = await this.prisma.agent.findFirst({
          where: { id: payload.agentId, deletedAt: null },
          select: { id: true },
        });
        if (!agent) {
          return {
            event: 'error',
            data: { code: 'AGENT_NOT_FOUND', message: `Agent ${payload.agentId} not found or deleted` },
          };
        }
      }

      const message = await this.prisma.message.create({
        data: {
          conversationId: payload.conversationId,
          role: 'user',
          content: payload.content,
          agentId: payload.agentId ?? null,
          messageType: messageType as MessageType,
          parentId: payload.parentId ?? null,
        },
      });

      this.server.to(`conversation:${payload.conversationId}`).emit('message:send', message);

      // Trigger agent response asynchronously
      this.triggerAgentResponse(payload.conversationId, payload.agentId, payload.content);

      return { event: 'message:send', data: message };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to store message: ${msg}`);
      client.emit('error', { code: 'MESSAGE_STORE_FAILED', message: msg });
      return { event: 'error', data: { code: 'MESSAGE_STORE_FAILED', message: msg } };
    }
  }

  @SubscribeMessage('approval:response')
  async handleApprovalResponse(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      approvalId: string;
      decision: 'approved' | 'rejected';
    },
  ): Promise<{ event: string; data: unknown } | { event: string; data: { code: string; message: string } }> {
    this.logger.log(`approval:response for ${payload.approvalId}: ${payload.decision}`);

    const VALID_DECISIONS = new Set(['approved', 'rejected']);
    if (!payload.decision || !VALID_DECISIONS.has(payload.decision)) {
      return {
        event: 'error',
        data: { code: 'INVALID_DECISION', message: `decision must be 'approved' or 'rejected', got: '${payload.decision}'` },
      };
    }

    try {
      const existing = await this.prisma.approvalRequest.findUnique({
        where: { id: payload.approvalId },
      });

      if (!existing) {
        return {
          event: 'error',
          data: { code: 'APPROVAL_NOT_FOUND', message: `Approval request ${payload.approvalId} not found` },
        };
      }

      if (existing.status !== 'pending') {
        return {
          event: 'error',
          data: { code: 'APPROVAL_ALREADY_RESOLVED', message: `Approval request ${payload.approvalId} is already ${existing.status}` },
        };
      }

      // Validate conversation exists and is not deleted
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: existing.conversationId, deletedAt: null },
      });
      if (!conversation) {
        return {
          event: 'error',
          data: { code: 'CONVERSATION_NOT_FOUND', message: `Conversation ${existing.conversationId} not found` },
        };
      }

      const status = payload.decision === 'approved' ? 'approved' : 'rejected';

      const [approval] = await this.prisma.$transaction([
        this.prisma.approvalRequest.update({
          where: { id: payload.approvalId },
          data: {
            status,
            userDecision: payload.decision,
            resolvedAt: new Date(),
          },
        }),
        this.prisma.auditTrail.create({
          data: {
            action: `approval:${payload.decision}`,
            agentId: existing.agentId,
            conversationId: existing.conversationId,
            details: {
              approvalId: payload.approvalId,
              target: existing.target,
              operation: existing.operation,
              toolName: existing.toolName,
              riskLevel: existing.riskLevel,
              userDecision: payload.decision,
            },
          },
        }),
      ]);

      // Resume paused agent loop
      this.agentLoopService.resumeLoop(
        existing.conversationId,
        existing.agentId,
        {
          approved: payload.decision === 'approved',
          decision: payload.decision,
        },
      );

      return { event: 'approval:response', data: approval };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to process approval: ${msg}`);
      client.emit('error', { code: 'APPROVAL_PROCESS_FAILED', message: msg });
      return { event: 'error', data: { code: 'APPROVAL_PROCESS_FAILED', message: msg } };
    }
  }

  emitMessageStream(conversationId: string, data: {
    agentId?: string;
    content: string;
    messageId?: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('message:stream', data);
  }

  // ── Agent loop trigger ──────────────────────────────────────

  /**
   * Determine which agents should respond to a user message.
   * Routes based on orchestrationMode (Phase 3):
   * - parallel → ParallelOrchestrator.triggerRound()
   * - supervisor → SupervisorEngine.start()
   * - DM (no group) → direct AgentLoopService.runAgentLoop()
   */
  private triggerAgentResponse(
    conversationId: string,
    agentId: string | undefined,
    userMessage: string,
  ) {
    // Fire-and-forget: don't block the WebSocket handler
    Promise.resolve().then(async () => {
      try {
        // Check if this is a group conversation
        const chatGroup = await this.prisma.chatGroup.findFirst({
          where: { conversationId, deletedAt: null },
          include: {
            members: {
              where: { enabled: true, agent: { deletedAt: null } },
              include: { agent: true },
            },
          },
        });

        if (chatGroup && chatGroup.members.length > 0) {
          // Phase 3: Route based on orchestrationMode
          if (chatGroup.orchestrationMode === 'supervisor') {
            // Supervisor mode (02-群聊设计 §四)
            const supervisorAgentId = chatGroup.supervisorAgentId ?? chatGroup.members[0].agentId;
            await this.supervisorEngine.start({
              conversationId,
              supervisorAgentId,
              userMessage,
              members: chatGroup.members,
            });
          } else {
            // Parallel mode (02-群聊设计 §一)
            await this.parallelOrchestrator.triggerRound({
              conversationId,
              userMessage,
              groupName: chatGroup.name,
              dynamicDiscussionEnabled: chatGroup.dynamicDiscussionEnabled,
            });
          }
        } else if (agentId) {
          // DM: trigger the specified agent (unchanged)
          this.agentLoopService.runAgentLoop({
            agentId,
            conversationId,
            userMessage,
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to trigger agent response: ${error instanceof Error ? error.message : 'Unknown'}`,
        );
      }
    });
  }

  emitMessageComplete(conversationId: string, data: {
    messageId: string;
    agentId: string;
    content: string;
    agentName?: string;
    timestamp: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('message:complete', {
      message: {
        id: data.messageId,
        role: 'assistant',
        content: data.content,
        agentId: data.agentId,
        agentName: data.agentName,
        timestamp: data.timestamp,
      },
      conversationId,
    });
  }

  emitAgentThinking(conversationId: string, data: {
    agentId: string;
    content?: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('agent:thinking', data);
  }

  emitAgentPeerMessage(conversationId: string, data: {
    fromAgentId: string;
    content: string;
    messageId: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('agent:peer_message', data);
  }

  emitToolStart(conversationId: string, data: {
    agentId: string;
    toolName: string;
    input?: unknown;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('tool:start', data);
  }

  emitToolEnd(conversationId: string, data: {
    agentId: string;
    toolName: string;
    result?: unknown;
    error?: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('tool:end', data);
  }

  emitToolProgress(conversationId: string, data: {
    agentId: string;
    toolName: string;
    progress: number;
    message?: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('tool:progress', data);
  }

  emitApprovalRequest(conversationId: string, data: {
    approvalId: string;
    agentId: string;
    target: string;
    operation: string;
    toolName?: string;
    reason: string;
    riskLevel: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('approval:request', data);
  }

  emitTaskUpdate(conversationId: string, data: {
    taskId: string;
    status: string;
    data?: unknown;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('task:update', data);
  }

  emitTaskProgress(conversationId: string, data: {
    taskId: string;
    agentId: string;
    progress: number;
    message?: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('task:progress', data);
  }

  emitDreamStatus(data: {
    agentId: string;
    status: string;
    stage?: string;
    message?: string;
  }) {
    this.server.emit('dream:status', data);
  }

  emitAceStatus(data: {
    agentId: string;
    status: string;
    stage?: string;
    message?: string;
  }) {
    this.server.emit('ace:status', data);
  }

  emitGroupMemberJoined(conversationId: string, data: {
    agentId: string;
    agentName: string;
    joinedAt: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('group:member_joined', data);
  }

  emitError(conversationId: string | null, data: {
    code: string;
    message: string;
    details?: unknown;
  }) {
    if (conversationId) {
      this.server.to(`conversation:${conversationId}`).emit('error', data);
    } else {
      this.server.emit('error', data);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { RiskEngineService } from './risk-engine.service';
import { WhitelistService, type WhitelistEntryType } from './whitelist.service';
import { AuditTrailService } from './audit-trail.service';
import type { RiskMatchResult } from './risk-engine.service';

// ── Types ──────────────────────────────────────────────────────

export interface ToolCallContext {
  agentId: string;
  agentName?: string;
  conversationId: string;
  /** Whether no-review mode is active */
  noReviewMode: boolean;
}

export interface PreExecutionCheck {
  requiresApproval: boolean;
  riskResult: RiskMatchResult;
  whitelistHit: boolean;
  whitelistEntryId?: string;
  shouldInterrupt: boolean;
}

export interface ToolExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTimeMs: number;
}

// ── Service (03 §5.4) ─────────────────────────────────────────

@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  constructor(
    private readonly riskEngine: RiskEngineService,
    private readonly whitelist: WhitelistService,
    private readonly auditTrail: AuditTrailService,
  ) {}

  /**
   * Pre-execution check: determine if tool call requires approval (03 §6.2).
   * This is called BEFORE the tool executes, within the LangGraph toolsNode.
   *
   * Returns a PreExecutionCheck that tells the caller whether to interrupt.
   */
  async preCheck(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolCallContext,
  ): Promise<PreExecutionCheck> {
    // Layer 3: no-review mode — bypass everything
    if (context.noReviewMode) {
      return {
        requiresApproval: false,
        riskResult: { requiresApproval: false },
        whitelistHit: false,
        shouldInterrupt: false,
      };
    }

    // Layer 2: check session whitelist (exact match only, §3.3)
    const whitelistType = this.getWhitelistType(toolName);
    const whitelistValue = this.getWhitelistValue(toolName, args);
    const whitelistHit = await this.whitelist.match(
      context.conversationId,
      whitelistType,
      whitelistValue,
    );

    if (whitelistHit) {
      // Whitelist hit → log audit and bypass approval
      await this.auditTrail.create({
        action: 'approval_whitelist_hit',
        agentId: context.agentId,
        conversationId: context.conversationId,
        details: {
          conversationId: context.conversationId,
          toolName,
          target: whitelistValue,
          matchedEntryId: whitelistHit.id,
          originalApprovalId: whitelistHit.sourceApprovalId,
          originalRiskLevel: whitelistHit.riskLevel,
        },
      });

      return {
        requiresApproval: false,
        riskResult: { requiresApproval: false },
        whitelistHit: true,
        whitelistEntryId: whitelistHit.id,
        shouldInterrupt: false,
      };
    }

    // Layer 1: risk engine assessment
    const riskResult = this.riskEngine.assessToolRisk(toolName, args);

    return {
      requiresApproval: riskResult.requiresApproval,
      riskResult,
      whitelistHit: false,
      shouldInterrupt: riskResult.requiresApproval,
    };
  }

  /**
   * After user approves a tool call, add it to the session whitelist (03 §3.5.2).
   */
  async addToWhitelist(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolCallContext,
    riskResult: RiskMatchResult,
    approvalId: string,
  ): Promise<void> {
    const entryType = this.getWhitelistType(toolName);
    const entryValue = this.getWhitelistValue(toolName, args);

    await this.whitelist.addEntry(context.conversationId, {
      id: `wl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: entryType,
      value: entryValue,
      riskLevel: riskResult.riskLevel ?? 'medium',
      approvedAt: new Date(),
      approvedBy: 'user',
      sourceApprovalId: approvalId,
    });
  }

  /**
   * Record tool execution result in audit trail (03 §4.3).
   */
  async auditExecution(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolCallContext,
    result: ToolExecutionResult,
    whitelistHit: boolean,
  ): Promise<void> {
    const target = this.getWhitelistValue(toolName, args);

    await this.auditTrail.create({
      action: result.success ? 'tool_executed' : 'tool_failed',
      agentId: context.agentId,
      conversationId: context.conversationId,
      details: {
        toolName,
        target,
        executionTimeMs: result.executionTimeMs,
        whitelistHit,
        error: result.error,
      },
    });
  }

  /**
   * Record approval decision in audit trail (03 §4.3).
   */
  async auditApproval(
    decision: 'approved' | 'rejected',
    toolName: string,
    args: Record<string, unknown>,
    context: ToolCallContext,
    riskResult: RiskMatchResult,
    approvalId: string,
  ): Promise<void> {
    const target = this.getWhitelistValue(toolName, args);

    await this.auditTrail.create({
      action:
        decision === 'approved' ? 'tool_call_approved' : 'tool_call_rejected',
      agentId: context.agentId,
      conversationId: context.conversationId,
      details: {
        approvalId,
        agentId: context.agentId,
        toolName,
        target,
        operation: toolName,
        riskLevel: riskResult.riskLevel ?? 'medium',
        matchedRule: riskResult.matchedRule,
        indirectCall: riskResult.indirectCall,
      },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────

  /**
   * Map tool name → whitelist entry type (03 §5.4).
   */
  private getWhitelistType(toolName: string): WhitelistEntryType {
    switch (toolName) {
      case 'read_file':
        return 'path_read';
      case 'write_file':
        return 'path_write';
      case 'execute_command':
      case 'code_execute':
        return 'command';
      default:
        return 'command';
    }
  }

  /**
   * Map tool name + args → whitelist value (03 §5.4).
   * Uses exact match — even a trailing slash would break the match (§3.3).
   */
  getWhitelistValue(
    toolName: string,
    args: Record<string, unknown>,
  ): string {
    switch (toolName) {
      case 'read_file':
      case 'write_file':
        return (args.path as string) ?? '';
      case 'execute_command':
        return (args.command as string) ?? '';
      case 'code_execute': {
        const code = (args.code as string) ?? '';
        const language = (args.language as string) ?? '';
        return `${language}:${this.hashCode(code)}`;
      }
      default:
        return JSON.stringify(args);
    }
  }

  private hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return Math.abs(hash).toString(16).slice(0, 8);
  }
}

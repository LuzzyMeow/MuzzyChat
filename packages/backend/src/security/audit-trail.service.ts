import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { RiskLevel } from './risk-engine.service';

// ── Types (03-安全与工具设计 §4) ──────────────────────────────

export interface AuditDetails {
  approvalId?: string;
  agentId?: string;
  conversationId?: string;
  toolName?: string;
  target?: string;
  operation?: string;
  riskLevel?: RiskLevel;
  matchedRule?: string;
  timeoutMs?: number;
  executionTimeMs?: number;
  error?: string;
  whitelistHit?: boolean;
  matchedEntryId?: string;
  originalApprovalId?: string;
  originalRiskLevel?: RiskLevel;
  indirectCall?: {
    isIndirect: boolean;
    depth: number;
    innerCommands: string[];
    matchedRules: string[];
  };
}

export type AuditAction =
  | 'tool_call_approved'
  | 'tool_call_rejected'
  | 'tool_call_auto_rejected'
  | 'tool_executed'
  | 'tool_failed'
  | 'approval_whitelist_hit'
  | 'no_review_mode_enabled';

export interface AuditQueryFilters {
  agentId?: string;
  action?: AuditAction;
  from?: Date;
  to?: Date;
  conversationId?: string;
  riskLevel?: RiskLevel;
  limit?: number;
}

// ── Service (03 §4.5.3 — 仅暴露 create + query，不暴露 update/delete) ──

@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an audit trail entry (INSERT only — immutable by design).
   * Per 03 §4.3 action enumeration.
   */
  async create(params: {
    action: AuditAction;
    agentId?: string;
    conversationId?: string;
    details: AuditDetails;
  }): Promise<void> {
    try {
      await this.prisma.auditTrail.create({
        data: {
          action: params.action,
          agentId: params.agentId ?? null,
          conversationId: params.conversationId ?? null,
          details: params.details as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // Audit failure should never block normal operations
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to write audit trail: ${msg}`);
    }
  }

  /**
   * Query audit trail entries (03 §4.6).
   */
  async query(filters: AuditQueryFilters = {}) {
    const where: Record<string, unknown> = {};

    if (filters.agentId) where.agentId = filters.agentId;
    if (filters.action) where.action = filters.action;
    if (filters.conversationId) where.conversationId = filters.conversationId;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) (where.createdAt as Record<string, unknown>).gte = filters.from;
      if (filters.to) (where.createdAt as Record<string, unknown>).lte = filters.to;
    }

    return this.prisma.auditTrail.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.limit ?? 100,
    });
  }
}

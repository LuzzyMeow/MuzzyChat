import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService } from './audit-trail.service';

// ── Constants (03-安全与工具设计 §2.6) ────────────────────────

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface TimeoutEntry {
  approvalId: string;
  conversationId: string;
  agentId: string;
  timer: ReturnType<typeof setTimeout>;
}

// ── Service ────────────────────────────────────────────────────

@Injectable()
export class ApprovalTimeoutService {
  private readonly logger = new Logger(ApprovalTimeoutService.name);
  private readonly timers = new Map<string, TimeoutEntry>();

  /** Callback for emitting auto-reject events to frontend */
  private emitAutoRejected:
    | ((conversationId: string, approvalId: string) => void)
    | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditTrail: AuditTrailService,
  ) {}

  /**
   * Register a callback to emit WebSocket events on auto-reject.
   */
  setEmitCallback(
    cb: (conversationId: string, approvalId: string) => void,
  ): void {
    this.emitAutoRejected = cb;
  }

  /**
   * Schedule a timeout for an approval request (03 §2.6).
   */
  schedule(
    approvalId: string,
    conversationId: string,
    agentId: string,
  ): void {
    // Clear any existing timer for this approval
    this.cancel(approvalId);

    const delay = APPROVAL_TIMEOUT_MS;
    this.logger.log(
      `Scheduling approval timeout for ${approvalId} (${delay / 1000}s)`,
    );

    const timer = setTimeout(() => {
      this.handleTimeout(approvalId);
    }, delay);

    this.timers.set(approvalId, {
      approvalId,
      conversationId,
      agentId,
      timer,
    });
  }

  /**
   * Cancel a scheduled timeout (called when user responds before timeout).
   */
  cancel(approvalId: string): void {
    const entry = this.timers.get(approvalId);
    if (entry) {
      clearTimeout(entry.timer);
      this.timers.delete(approvalId);
      this.logger.log(`Cancelled approval timeout for ${approvalId}`);
    }
  }

  /**
   * Handle timeout: auto-reject the approval request (03 §2.6).
   */
  private async handleTimeout(approvalId: string): Promise<void> {
    const entry = this.timers.get(approvalId);
    this.timers.delete(approvalId);

    if (!entry) {
      this.logger.warn(`Timeout entry not found for ${approvalId}`);
      return;
    }

    this.logger.warn(`Approval ${approvalId} timed out — auto-rejecting`);

    try {
      await this.prisma.approvalRequest.update({
        where: { id: approvalId },
        data: {
          status: 'auto_rejected',
          resolvedAt: new Date(),
        },
      });

      await this.auditTrail.create({
        action: 'tool_call_auto_rejected',
        agentId: entry.agentId,
        conversationId: entry.conversationId,
        details: {
          approvalId,
          timeoutMs: APPROVAL_TIMEOUT_MS,
        },
      });

      // Notify frontend
      if (this.emitAutoRejected) {
        this.emitAutoRejected(entry.conversationId, approvalId);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to auto-reject approval ${approvalId}: ${msg}`);
    }
  }
}

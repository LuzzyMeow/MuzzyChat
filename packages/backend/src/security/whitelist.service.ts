import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { RiskLevel } from './risk-engine.service';

// ── Types (03-安全与工具设计 §3.2–3.3) ────────────────────────

export type WhitelistEntryType = 'path_read' | 'path_write' | 'command';

export interface WhitelistEntry {
  id: string;
  type: WhitelistEntryType;
  value: string;
  riskLevel: RiskLevel;
  approvedAt: Date;
  approvedBy: 'user' | 'auto';
  sourceApprovalId: string;
}

export interface SessionWhitelist {
  conversationId: string;
  entries: WhitelistEntry[];
  createdAt: Date;
  updatedAt: Date;
}

// ── Service (03 §3.4–3.5) ─────────────────────────────────────

@Injectable()
export class WhitelistService implements OnModuleDestroy {
  private readonly logger = new Logger(WhitelistService.name);
  private redis: Redis | null = null;
  /** In-memory fallback when Redis is unavailable */
  private readonly fallback = new Map<string, SessionWhitelist>();

  constructor() {
    this.initRedis();
  }

  private initRedis(): void {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn(
        'REDIS_URL not set — session whitelist will use in-memory fallback (lost on restart)',
      );
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) {
            this.logger.error('Redis connection failed after 3 retries — using in-memory fallback');
            this.redis = null;
            return null;
          }
          return Math.min(times * 1000, 3000);
        },
        lazyConnect: true,
      });

      // Don't block startup on Redis connect
      this.redis.connect().catch((err) => {
        this.logger.warn(`Redis connection failed: ${err.message} — using in-memory fallback`);
        this.redis = null;
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.warn(`Redis init failed: ${msg} — using in-memory fallback`);
      this.redis = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => {});
    }
  }

  /**
   * Get the whitelist for a conversation (03 §3.5.2).
   */
  async get(conversationId: string): Promise<SessionWhitelist | null> {
    if (this.redis) {
      try {
        const key = this.redisKey(conversationId);
        const data = await this.redis.get(key);
        if (data) return JSON.parse(data) as SessionWhitelist;
        return null;
      } catch (error) {
        this.logger.warn(`Redis get failed: ${error}`);
      }
    }
    return this.fallback.get(conversationId) ?? null;
  }

  /**
   * Add an entry to the whitelist (03 §3.5.2).
   * Exact match — same type + same value → skip duplicate.
   */
  async addEntry(
    conversationId: string,
    entry: WhitelistEntry,
  ): Promise<void> {
    const whitelist = (await this.get(conversationId)) ?? {
      conversationId,
      entries: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const exists = whitelist.entries.some(
      (e) => e.type === entry.type && e.value === entry.value,
    );
    if (!exists) {
      whitelist.entries.push(entry);
      whitelist.updatedAt = new Date();
    }

    await this.set(conversationId, whitelist);
    this.logger.log(
      `Whitelist entry added: ${entry.type}=${entry.value} for ${conversationId}`,
    );
  }

  /**
   * Reset (clear) whitelist for a conversation (03 §3.4).
   */
  async reset(conversationId: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(this.redisKey(conversationId));
      } catch {
        // fall through to fallback
      }
    }
    this.fallback.delete(conversationId);
    this.logger.log(`Whitelist reset for ${conversationId}`);
  }

  /**
   * Match an operation against the whitelist (03 §3.3 — exact match only).
   */
  async match(
    conversationId: string,
    type: WhitelistEntryType,
    value: string,
  ): Promise<WhitelistEntry | null> {
    const whitelist = await this.get(conversationId);
    if (!whitelist) return null;

    return (
      whitelist.entries.find(
        (entry) => entry.type === type && entry.value === value,
      ) ?? null
    );
  }

  // ── Private helpers ──────────────────────────────────────────

  private redisKey(conversationId: string): string {
    return `whitelist:${conversationId}`;
  }

  private async set(
    conversationId: string,
    whitelist: SessionWhitelist,
  ): Promise<void> {
    if (this.redis) {
      try {
        const key = this.redisKey(conversationId);
        // TTL: 24h matching conversation cache
        await this.redis.setex(key, 86400, JSON.stringify(whitelist));
        return;
      } catch (error) {
        this.logger.warn(`Redis set failed: ${error}`);
      }
    }
    this.fallback.set(conversationId, whitelist);
  }
}

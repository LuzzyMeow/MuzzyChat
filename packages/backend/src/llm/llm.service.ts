import { Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';

type ModelRole = 'big' | 'small' | 'embedding';

interface ModelConfig {
  providerId: string;
  providerName: string;
  apiBase: string;
  apiKey: string;
  modelId: string;
  displayName: string;
  tokenLimit: number | null;
  contextWindow: number | null;
}

@Injectable()
export class LlmService implements OnModuleDestroy {
  private readonly logger = new Logger(LlmService.name);
  private readonly modelCache = new Map<string, ChatOpenAI>();

  constructor(private readonly prisma: PrismaService) {}

  onModuleDestroy(): void {
    this.modelCache.clear();
    this.logger.log('Model cache cleared');
  }

  // ── Public API ────────────────────────────────────────────────

  /** Get a LangChain ChatOpenAI instance for the given ProviderModel ID. */
  async getModelByProviderModelId(providerModelId: string): Promise<ChatOpenAI> {
    const cached = this.modelCache.get(providerModelId);
    if (cached) return cached;

    const config = await this.resolveConfig(providerModelId);
    const model = this.buildModel(config);
    this.modelCache.set(providerModelId, model);
    this.logger.log(`Initialized model: ${config.displayName} (${config.modelId})`);
    return model;
  }

  /** Get the default model for a given role (big / small / embedding). */
  async getDefaultModelByRole(role: ModelRole): Promise<ChatOpenAI> {
    const resolved = await this.resolveDefaultByRole(role);
    return this.getModelByProviderModelId(resolved.id);
  }

  /** Convenience: non-streaming LLM call. */
  async invoke(model: ChatOpenAI, messages: BaseMessage[]): Promise<string> {
    const response = await model.invoke(messages);
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
    return content;
  }

  /** Convenience: streaming LLM call. Returns an async iterable of string chunks. */
  async *stream(
    model: ChatOpenAI,
    messages: BaseMessage[],
  ): AsyncIterable<string> {
    const stream = await model.stream(messages);
    for await (const chunk of stream) {
      const content = typeof chunk.content === 'string'
        ? chunk.content
        : JSON.stringify(chunk.content);
      if (content) yield content;
    }
  }

  /** Generate embedding vector for a text using the default embedding model. */
  async embedText(text: string): Promise<number[]> {
    const config = await this.resolveEmbeddingConfig();
    const url = `${config.apiBase}/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelId,
        input: text,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown');
      throw new Error(`Embedding API error ${response.status}: ${errText}`);
    }
    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data[0].embedding;
  }

  // ── Internal ──────────────────────────────────────────────────

  private async resolveConfig(providerModelId: string): Promise<ModelConfig> {
    const row = await this.prisma.providerModel.findUnique({
      where: { id: providerModelId },
      include: { provider: true },
    });
    if (!row) {
      throw new NotFoundException(`ProviderModel not found: ${providerModelId}`);
    }
    return {
      providerId: row.provider.id,
      providerName: row.provider.name,
      apiBase: row.provider.apiBase,
      apiKey: row.provider.apiKeyEncrypted,
      modelId: row.modelId,
      displayName: row.displayName,
      tokenLimit: row.tokenLimit,
      contextWindow: row.contextWindow,
    };
  }

  private async resolveDefaultByRole(role: ModelRole) {
    const candidates = await this.prisma.providerModel.findMany({
      where: {
        roleHints: { has: role },
      },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });
    if (candidates.length === 0) {
      throw new NotFoundException(
        `No model configured for role "${role}". ` +
        `Please add a ProviderModel with role_hints containing "${role}".`,
      );
    }
    return candidates[0];
  }

  /** Resolve embedding model with full provider config (apiBase + apiKey). */
  private async resolveEmbeddingConfig(): Promise<{
    apiBase: string; apiKey: string; modelId: string;
  }> {
    const candidate = await this.prisma.providerModel.findFirst({
      where: { roleHints: { has: 'embedding' } },
      include: { provider: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) {
      throw new NotFoundException(
        'No model configured for role "embedding". ' +
        'Please add a ProviderModel with role_hints containing "embedding".',
      );
    }
    return {
      apiBase: candidate.provider.apiBase,
      apiKey: candidate.provider.apiKeyEncrypted,
      modelId: candidate.modelId,
    };
  }

  private buildModel(config: ModelConfig): ChatOpenAI {
    return new ChatOpenAI({
      model: config.modelId,
      apiKey: config.apiKey,
      configuration: {
        baseURL: config.apiBase,
        defaultHeaders: {
          'Content-Type': 'application/json',
        },
      },
      maxTokens: config.tokenLimit ?? undefined,
      temperature: 0.7,
    });
  }
}
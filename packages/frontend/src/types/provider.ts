export interface ProviderModel {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  tokenLimit: number | null;
  contextWindow: number | null;
  supportsFunctionCalling: boolean;
  roleHints: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ModelProvider {
  id: string;
  name: string;
  apiBase: string;
  apiKeyEncrypted: string;
  createdAt: string;
  updatedAt: string;
  models: ProviderModel[];
}

export interface CreateProviderInput {
  name: string;
  apiBase: string;
  apiKeyEncrypted: string;
}

export interface UpdateProviderInput {
  name?: string;
  apiBase?: string;
  apiKeyEncrypted?: string;
}

export interface CreateModelInput {
  modelId: string;
  displayName: string;
  tokenLimit?: number;
  contextWindow?: number;
  supportsFunctionCalling?: boolean;
  roleHints?: string[];
}

export interface UpdateModelInput {
  modelId?: string;
  displayName?: string;
  tokenLimit?: number;
  contextWindow?: number;
  supportsFunctionCalling?: boolean;
  roleHints?: string[];
}

export interface Agent {
  id: string;
  name: string;
  avatarDescription: string | null;
  systemPrompt: string;
  assignedModelId: string | null;
  tools: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  name: string;
  avatarDescription?: string;
  systemPrompt: string;
  assignedModelId?: string;
  tools?: string[];
}

export interface UpdateAgentInput {
  name?: string;
  avatarDescription?: string;
  systemPrompt?: string;
  assignedModelId?: string | null;
  tools?: string[];
}
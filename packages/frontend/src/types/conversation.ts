export interface Conversation {
  id: string;
  type: "group" | "dm";
  title: string | null;
  participantAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationInput {
  type: "group" | "dm";
  title?: string;
}

export interface UpdateConversationInput {
  title?: string;
}
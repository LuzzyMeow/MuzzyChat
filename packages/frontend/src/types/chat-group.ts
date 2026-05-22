export interface ChatGroup {
  id: string;
  conversationId: string;
  name: string;
  orchestrationMode: "parallel" | "supervisor";
  dynamicDiscussionEnabled: boolean;
  supervisorAgentId: string | null;
  createdAt: string;
  updatedAt: string;
  conversation?: { id: string; type: string; title: string | null };
  members?: GroupMember[];
}

export interface GroupMember {
  id: string;
  groupId: string;
  agentId: string;
  enabled: boolean;
  joinedAt: string;
  agent?: { id: string; name: string };
}

export interface CreateChatGroupInput {
  name: string;
  orchestrationMode?: "parallel" | "supervisor";
  dynamicDiscussionEnabled?: boolean;
  supervisorAgentId?: string;
}

export interface UpdateChatGroupInput {
  name?: string;
  orchestrationMode?: "parallel" | "supervisor";
  dynamicDiscussionEnabled?: boolean;
  supervisorAgentId?: string | null;
}
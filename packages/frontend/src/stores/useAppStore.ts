import { create } from "zustand";

interface Conversation {
  id: string;
  title: string;
}

interface AppState {
  conversations: Conversation[];
  activeConversationId: string | null;
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversation: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  conversations: [],
  activeConversationId: null,
  setConversations: (_conversations) => set({ conversations: _conversations }),
  setActiveConversation: (_id) => set({ activeConversationId: _id }),
}));
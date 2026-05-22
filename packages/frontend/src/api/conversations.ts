import useSWR, { mutate } from "swr";
import { get, post, patch, del } from "./client";
import type {
  Conversation,
  CreateConversationInput,
  UpdateConversationInput,
} from "@/types/conversation";

const KEY = "/conversations";

export function useConversations() {
  return useSWR<Conversation[]>(KEY, get);
}

export function useConversation(id: string | undefined) {
  return useSWR<Conversation>(id ? `${KEY}/${id}` : null, get);
}

export async function createConversation(
  data: CreateConversationInput
): Promise<Conversation> {
  const c = await post<Conversation>(KEY, data);
  await mutate(KEY);
  return c;
}

export async function updateConversation(
  id: string,
  data: UpdateConversationInput
): Promise<Conversation> {
  const c = await patch<Conversation>(`${KEY}/${id}`, data);
  await mutate(KEY);
  await mutate(`${KEY}/${id}`);
  return c;
}

export async function deleteConversation(id: string): Promise<void> {
  await del(`${KEY}/${id}`);
  await mutate(KEY);
}
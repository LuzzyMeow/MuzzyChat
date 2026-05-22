import useSWR, { mutate } from "swr";
import { get, post, patch, del } from "./client";
import type {
  ChatGroup,
  GroupMember,
  CreateChatGroupInput,
  UpdateChatGroupInput,
} from "@/types/chat-group";

const KEY = "/groups";

export function useGroups() {
  return useSWR<ChatGroup[]>(KEY, get);
}

export function useGroup(id: string | undefined) {
  return useSWR<ChatGroup>(id ? `${KEY}/${id}` : null, get);
}

export async function createGroup(data: CreateChatGroupInput): Promise<ChatGroup> {
  const g = await post<ChatGroup>(KEY, data);
  await mutate(KEY);
  return g;
}

export async function updateGroup(
  id: string,
  data: UpdateChatGroupInput
): Promise<ChatGroup> {
  const g = await patch<ChatGroup>(`${KEY}/${id}`, data);
  await mutate(KEY);
  await mutate(`${KEY}/${id}`);
  return g;
}

export async function deleteGroup(id: string): Promise<void> {
  await del(`${KEY}/${id}`);
  await mutate(KEY);
}

export function useGroupMembers(groupId: string | undefined) {
  return useSWR<GroupMember[]>(
    groupId ? `${KEY}/${groupId}/members` : null,
    get
  );
}

export async function addMember(
  groupId: string,
  agentId: string
): Promise<GroupMember> {
  const m = await post<GroupMember>(
    `${KEY}/${groupId}/members/${agentId}`,
    {}
  );
  await mutate(`${KEY}/${groupId}/members`);
  return m;
}

export async function removeMember(
  groupId: string,
  agentId: string
): Promise<void> {
  await del(`${KEY}/${groupId}/members/${agentId}`);
  await mutate(`${KEY}/${groupId}/members`);
}
import useSWR, { mutate } from "swr";
import { get, post, patch, del } from "./client";
import type { Agent, CreateAgentInput, UpdateAgentInput } from "@/types/agent";

const AGENTS_KEY = "/agents";

export function useAgents() {
  return useSWR<Agent[]>(AGENTS_KEY, get);
}

export async function createAgent(data: CreateAgentInput): Promise<Agent> {
  const agent = await post<Agent>(AGENTS_KEY, data);
  await mutate(AGENTS_KEY);
  return agent;
}

export function useAgent(id: string | undefined) {
  return useSWR<Agent>(id ? `${AGENTS_KEY}/${id}` : null, get);
}

export async function updateAgent(
  id: string,
  data: UpdateAgentInput
): Promise<Agent> {
  const agent = await patch<Agent>(`${AGENTS_KEY}/${id}`, data);
  await mutate(AGENTS_KEY);
  await mutate(`${AGENTS_KEY}/${id}`);
  return agent;
}

export async function deleteAgent(id: string): Promise<void> {
  await del(`${AGENTS_KEY}/${id}`);
  await mutate(AGENTS_KEY);
}
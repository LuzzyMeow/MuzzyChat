import { get, post } from "./client";

export interface DreamSweep {
  id: string;
  agentId: string;
  sweepId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

export interface LongTermMemory {
  id: string;
  agentId: string;
  content: string;
  score: number;
  frequency: number;
  relevance: number;
  queryDiversity: number;
  recency: number;
  consolidation: number;
  conceptualRichness: number;
  conceptualTags: Record<string, unknown> | null;
  createdAt: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  filePath: string;
  successRate: number;
  usageCount: number;
  status: string;
  trustLevel: string;
  agentId: string;
  createdAt: string;
  updatedAt: string;
}

export const dreamApi = {
  triggerSweep: (agentId: string) =>
    post<{ jobId: string; agentId: string; status: string }>(`/dream/sweep/${agentId}`, {}),
  triggerAllSweeps: () =>
    post<{ enqueued: number; status: string }>("/dream/sweep-all", {}),
  getSweeps: (agentId: string, limit = 10) =>
    get<DreamSweep[]>(`/dream/sweeps/${agentId}?limit=${limit}`),
  getMemories: (agentId: string, limit = 20) =>
    get<LongTermMemory[]>(`/dream/memories/${agentId}?limit=${limit}`),
  recoverSweep: (agentId: string) =>
    post<{ sweepId: string | null; status: string }>(`/dream/recover/${agentId}`, {}),
  getMemoryMd: (agentId: string) =>
    fetch(`/api/dream/export/memory/${agentId}`).then((r) => r.text()),
  getDreamsMd: (agentId: string) =>
    fetch(`/api/dream/export/dreams/${agentId}`).then((r) => r.text()),
};

export const skillApi = {
  search: (query: string, topK = 3) =>
    get<Skill[]>(`/skill/search?q=${encodeURIComponent(query)}&topK=${topK}`),
  list: (agentId: string, status?: string, limit = 20) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set("status", status);
    return get<Skill[]>(`/skill/list/${agentId}?${params}`);
  },
  get: (skillId: string) => get<Skill>(`/skill/${skillId}`),
  triggerCurator: (agentId: string) =>
    post<{ jobId: string; agentId: string; status: string }>(`/skill/curator/${agentId}`, {}),
  triggerAllCurators: () =>
    post<{ enqueued: number; status: string }>("/skill/curator-all", {}),
};

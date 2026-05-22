import useSWR, { mutate } from "swr";
import { get, post, patch, del } from "./client";
import type {
  ModelProvider,
  ProviderModel,
  CreateProviderInput,
  UpdateProviderInput,
  CreateModelInput,
  UpdateModelInput,
} from "@/types/provider";

const PROVIDERS_KEY = "/providers";

// ─── Providers ─────────────────────────────────────────────────

export function useProviders() {
  return useSWR<ModelProvider[]>(PROVIDERS_KEY, get);
}

export async function createProvider(data: CreateProviderInput): Promise<ModelProvider> {
  const provider = await post<ModelProvider>(PROVIDERS_KEY, data);
  await mutate(PROVIDERS_KEY);
  return provider;
}

export async function updateProvider(id: string, data: UpdateProviderInput): Promise<ModelProvider> {
  const provider = await patch<ModelProvider>(`${PROVIDERS_KEY}/${id}`, data);
  await mutate(PROVIDERS_KEY);
  return provider;
}

export async function deleteProvider(id: string): Promise<void> {
  await del(`${PROVIDERS_KEY}/${id}`);
  await mutate(PROVIDERS_KEY);
}

// ─── Models ────────────────────────────────────────────────────

export function useModels(providerId: string | undefined) {
  return useSWR<ProviderModel[]>(
    providerId ? `${PROVIDERS_KEY}/${providerId}/models` : null,
    get,
  );
}

export async function createModel(
  providerId: string,
  data: CreateModelInput,
): Promise<ProviderModel> {
  const model = await post<ProviderModel>(
    `${PROVIDERS_KEY}/${providerId}/models`,
    data,
  );
  await mutate(PROVIDERS_KEY);
  await mutate(`${PROVIDERS_KEY}/${providerId}/models`);
  return model;
}

export async function updateModel(
  providerId: string,
  id: string,
  data: UpdateModelInput,
): Promise<ProviderModel> {
  const model = await patch<ProviderModel>(
    `${PROVIDERS_KEY}/${providerId}/models/${id}`,
    data,
  );
  await mutate(PROVIDERS_KEY);
  await mutate(`${PROVIDERS_KEY}/${providerId}/models`);
  return model;
}

export async function deleteModel(
  providerId: string,
  id: string,
): Promise<void> {
  await del(`${PROVIDERS_KEY}/${providerId}/models/${id}`);
  await mutate(PROVIDERS_KEY);
  await mutate(`${PROVIDERS_KEY}/${providerId}/models`);
}

import useSWR, { mutate } from "swr";
import { get, put } from "./client";
import type { SettingsMap, SettingEntry } from "@/types/settings";

const SETTINGS_KEY = "/settings";

export function useAllSettings() {
  return useSWR<SettingsMap>(SETTINGS_KEY, get);
}

export function useSetting(key: string | undefined) {
  return useSWR<SettingEntry>(key ? `${SETTINGS_KEY}/${key}` : null, get);
}

export async function setSetting(
  key: string,
  value: string,
): Promise<SettingEntry> {
  const result = await put<SettingEntry>(`${SETTINGS_KEY}/${key}`, { value });
  await mutate(SETTINGS_KEY);
  await mutate(`${SETTINGS_KEY}/${key}`);
  return result;
}

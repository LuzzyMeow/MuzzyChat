export interface SettingEntry {
  key: string;
  value: string;
}

export interface SettingsMap {
  [key: string]: string;
}

/** 预定义的设置键 */
export const SETTING_KEYS = {
  APPROVAL_BYPASS_ALL: "approval.bypass_all",
  MODEL_DEFAULT_LARGE: "model.default_large",
  MODEL_DEFAULT_SMALL: "model.default_small",
  MODEL_DEFAULT_EMBEDDING: "model.default_embedding",
} as const;

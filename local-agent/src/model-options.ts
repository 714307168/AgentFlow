import {
  listModelProviderPresets,
  normalizeModelProviderProfiles,
  type ModelProviderProfile,
  type ModelProviderProtocol,
  type ProviderConfigSnapshot,
} from "./provider-registry";

export interface ModelProviderOption {
  id: string;
  name: string;
  protocol: ModelProviderProtocol;
  defaultModel: string | null;
  models: string[];
  configured: boolean;
  credentialSource?: "config" | "env" | "none";
  error?: string;
}

const BUILTIN_MODEL_CATALOG_BY_PROFILE_ID: Record<string, string[]> = {
  openai: [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.6",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5-codex",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-image-2",
    "gpt-image-1",
  ],
  deepseek: [
    "deepseek-chat",
    "deepseek-reasoner",
  ],
  zhipu: [
    "glm-4.5",
    "glm-4.5-air",
    "glm-4-plus",
    "glm-4-flash",
  ],
  "minimax-mimo": [
    "MiniMax-M1",
    "abab6.5s-chat",
    "abab6.5g-chat",
  ],
  hunyuan: [
    "hunyuan-turbos-latest",
    "hunyuan-lite",
    "hunyuan-standard",
    "hunyuan-pro",
  ],
  "aliyun-qwen": [
    "qwen-plus",
    "qwen-max",
    "qwen-turbo",
    "qwen-long",
    "qwen-vl-plus",
  ],
  anthropic: [
    "claude-3-7-sonnet-latest",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest",
  ],
};

export async function listConfiguredModelOptions(
  config: ProviderConfigSnapshot,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ModelProviderOption[]> {
  const profiles = normalizeModelProviderProfiles(config.modelProviderProfiles, config)
    .filter((profile) => profile.enabled !== false);

  return profiles.map((profile) => {
    const credential = resolveProfileCredential(profile, env);
    return {
      id: profile.id,
      name: profile.name,
      protocol: profile.protocol,
      defaultModel: normalizeText(profile.defaultModel) || null,
      models: modelsForProfile(profile),
      configured: Boolean(credential.apiKey),
      credentialSource: credential.source,
    };
  });
}

function modelsForProfile(profile: ModelProviderProfile): string[] {
  const preset = listModelProviderPresets().find((entry) => entry.id === profile.id);
  return mergeModels([
    profile.defaultModel,
    ...builtinModelsForProfile(profile),
    preset?.defaultModel,
  ]);
}

function builtinModelsForProfile(profile: ModelProviderProfile): string[] {
  const byId = BUILTIN_MODEL_CATALOG_BY_PROFILE_ID[profile.id.toLowerCase()];
  if (byId) {
    return byId;
  }
  return profile.protocol === "anthropic"
    ? BUILTIN_MODEL_CATALOG_BY_PROFILE_ID.anthropic
    : BUILTIN_MODEL_CATALOG_BY_PROFILE_ID.openai;
}

function resolveProfileCredential(
  profile: ModelProviderProfile,
  env: NodeJS.ProcessEnv,
): { apiKey: string; source: "config" | "env" | "none" } {
  const configured = normalizeText(profile.apiKey);
  if (configured) {
    return { apiKey: configured, source: "config" };
  }
  const fromEnv = firstEnv(env, getProfileApiKeyEnvNames(profile));
  if (fromEnv) {
    return { apiKey: fromEnv, source: "env" };
  }
  return { apiKey: "", source: "none" };
}

function getProfileApiKeyEnvNames(profile: ModelProviderProfile): string[] {
  const id = profile.id.toLowerCase();
  const names = new Set<string>();
  if (profile.protocol === "anthropic") {
    names.add("ANTHROPIC_API_KEY");
    names.add("ANTHROPIC_AUTH_TOKEN");
  } else {
    names.add("OPENAI_API_KEY");
  }
  if (id.includes("deepseek")) names.add("DEEPSEEK_API_KEY");
  if (id.includes("zhipu") || id.includes("glm")) names.add("ZHIPU_API_KEY");
  if (id.includes("minimax") || id.includes("mimo")) {
    names.add("MINIMAX_API_KEY");
    names.add("MIMO_API_KEY");
  }
  if (id.includes("hunyuan")) names.add("HUNYUAN_API_KEY");
  if (id.includes("aliyun") || id.includes("qwen") || id.includes("dashscope")) {
    names.add("DASHSCOPE_API_KEY");
    names.add("ALIYUN_API_KEY");
  }
  return [...names];
}

function firstEnv(env: NodeJS.ProcessEnv, names: string[]): string {
  for (const name of names) {
    const value = normalizeText(env[name]);
    if (value) {
      return value;
    }
  }
  return "";
}

function mergeModels(models: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const model of models) {
    const normalized = normalizeText(model);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

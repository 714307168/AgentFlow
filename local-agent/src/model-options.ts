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

export interface ModelOptionLoadOptions {
  fetchRemote?: boolean;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
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
  "google-gemini": [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
  ],
  anthropic: [
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
  ],
};

export async function listConfiguredModelOptions(
  config: ProviderConfigSnapshot,
  env: NodeJS.ProcessEnv = process.env,
  options: ModelOptionLoadOptions = {},
): Promise<ModelProviderOption[]> {
  const profiles = normalizeModelProviderProfiles(config.modelProviderProfiles, config)
    .filter((profile) => profile.enabled !== false);

  return await Promise.all(profiles.map(async (profile) => {
    const credential = resolveProfileCredential(profile, env);
    const remote = options.fetchRemote && credential.apiKey
      ? await fetchProviderModels(profile, credential.apiKey, options)
      : { models: [], error: undefined };
    return {
      id: profile.id,
      name: profile.name,
      protocol: profile.protocol,
      defaultModel: normalizeText(profile.defaultModel) || null,
      models: modelsForProfile(profile, remote.models),
      configured: Boolean(credential.apiKey),
      credentialSource: credential.source,
      error: remote.error,
    };
  }));
}

function modelsForProfile(profile: ModelProviderProfile, remoteModels: string[] = []): string[] {
  const preset = listModelProviderPresets().find((entry) => entry.id === profile.id);
  return mergeModels([
    profile.defaultModel,
    ...remoteModels,
    ...builtinModelsForProfile(profile),
    preset?.defaultModel,
  ]);
}

async function fetchProviderModels(
  profile: ModelProviderProfile,
  apiKey: string,
  options: ModelOptionLoadOptions,
): Promise<{ models: string[]; error?: string }> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { models: [], error: "Model refresh is unavailable in this runtime." };
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1_000, Math.min(options.requestTimeoutMs ?? 8_000, 30_000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const models = await fetchProviderModelPages(profile, apiKey, fetchImpl, controller.signal);
    return { models };
  } catch (error) {
    return { models: [], error: formatModelRefreshError(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProviderModelPages(
  profile: ModelProviderProfile,
  apiKey: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string[]> {
  const models: string[] = [];
  let afterId = "";
  for (let page = 0; page < 4 && models.length < 200; page += 1) {
    const response = await fetchImpl(buildModelListUrl(profile.baseUrl, afterId), {
      headers: buildModelListHeaders(profile.protocol, apiKey),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Model endpoint returned HTTP ${response.status}.`);
    }
    const payload = await response.json() as ModelListPayload;
    const pageModels = parseModelIds(payload, profile.protocol);
    models.push(...pageModels);
    const nextAfterId = profile.protocol === "anthropic" && payload.has_more === true
      ? normalizeUnknownText(payload.last_id)
      : "";
    if (!nextAfterId || nextAfterId === afterId || pageModels.length === 0) {
      break;
    }
    afterId = nextAfterId;
  }
  return mergeModels(models).slice(0, 200);
}

interface ModelListPayload {
  data?: Array<{ id?: unknown }>;
  has_more?: boolean;
  last_id?: unknown;
}

function buildModelListUrl(baseUrl: string | null | undefined, afterId: string): string {
  const base = normalizeText(baseUrl) || "https://api.anthropic.com";
  const normalizedBase = base.replace(/\/+$/u, "");
  const endpoint = /\/v\d+(?:\.\d+)?$/iu.test(normalizedBase)
    ? `${normalizedBase}/models`
    : `${normalizedBase}/v1/models`;
  if (!afterId) {
    return endpoint;
  }
  return `${endpoint}?after_id=${encodeURIComponent(afterId)}`;
}

function buildModelListHeaders(protocol: ModelProviderProtocol, apiKey: string): Record<string, string> {
  return protocol === "anthropic"
    ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
    : { Authorization: `Bearer ${apiKey}` };
}

function parseModelIds(payload: ModelListPayload, protocol: ModelProviderProtocol): string[] {
  if (!Array.isArray(payload?.data)) {
    return [];
  }
  return payload.data
    .map((entry) => normalizeUnknownText(entry?.id))
    .filter((id) => protocol !== "anthropic" || /^claude-/iu.test(id));
}

function formatModelRefreshError(error: unknown): string {
  if (error instanceof Error && /^Model endpoint returned HTTP \d+\.$/u.test(error.message)) {
    return error.message;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "Model refresh timed out.";
  }
  return "Unable to refresh models from the configured provider.";
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

function normalizeUnknownText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

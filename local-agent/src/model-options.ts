import {
  getProviderDefaultSdkBaseUrl,
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
  error?: string;
}

interface ModelListProfile extends ModelProviderProfile {
  resolvedApiKey: string;
}

const MODEL_LIST_TIMEOUT_MS = 8000;

export async function listConfiguredModelOptions(
  config: ProviderConfigSnapshot,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ModelProviderOption[]> {
  const profiles = normalizeModelProviderProfiles(config.modelProviderProfiles, config)
    .filter((profile) => profile.enabled !== false);

  return await Promise.all(profiles.map(async (profile) => {
    const resolvedApiKey = resolveProfileApiKey(profile, env);
    const option: ModelProviderOption = {
      id: profile.id,
      name: profile.name,
      protocol: profile.protocol,
      defaultModel: normalizeText(profile.defaultModel) || null,
      models: [],
      configured: Boolean(resolvedApiKey),
    };

    if (!resolvedApiKey) {
      option.models = fallbackModelsForProfile(profile);
      return option;
    }

    try {
      const models = await fetchProviderModels({
        ...profile,
        resolvedApiKey,
      });
      option.models = mergeModels([
        profile.defaultModel,
        ...models,
        ...fallbackModelsForProfile(profile),
      ]);
    } catch (error: any) {
      option.error = error?.message ?? String(error);
      option.models = fallbackModelsForProfile(profile);
    }

    return option;
  }));
}

async function fetchProviderModels(profile: ModelListProfile): Promise<string[]> {
  return profile.protocol === "anthropic"
    ? await fetchAnthropicModels(profile)
    : await fetchOpenAiCompatibleModels(profile);
}

async function fetchOpenAiCompatibleModels(profile: ModelListProfile): Promise<string[]> {
  const url = joinBaseUrl(resolveProfileBaseUrl(profile), "/v1/models");
  const data = await fetchModelJson(url, {
    Authorization: "Bearer " + profile.resolvedApiKey,
  });
  return parseModelIds(data);
}

async function fetchAnthropicModels(profile: ModelListProfile): Promise<string[]> {
  const url = joinBaseUrl(resolveProfileBaseUrl(profile), "/v1/models");
  const data = await fetchModelJson(url, {
    "anthropic-version": "2023-06-01",
    "x-api-key": profile.resolvedApiKey,
  });
  return parseModelIds(data);
}

async function fetchModelJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function parseModelIds(data: unknown): string[] {
  const items = Array.isArray((data as { data?: unknown[] })?.data)
    ? (data as { data: unknown[] }).data
    : (Array.isArray(data) ? data : []);
  return mergeModels(items.map((item) => {
    if (typeof item === "string") {
      return item;
    }
    const model = item as { id?: unknown; name?: unknown };
    return typeof model.id === "string" ? model.id : (typeof model.name === "string" ? model.name : "");
  }));
}

function fallbackModelsForProfile(profile: ModelProviderProfile): string[] {
  const preset = listModelProviderPresets().find((entry) => entry.id === profile.id);
  return mergeModels([
    profile.defaultModel,
    preset?.defaultModel,
  ]);
}

function resolveProfileApiKey(profile: ModelProviderProfile, env: NodeJS.ProcessEnv): string {
  return normalizeText(profile.apiKey) || firstEnv(env, getProfileApiKeyEnvNames(profile));
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

function resolveProfileBaseUrl(profile: ModelProviderProfile): string {
  const configured = normalizeText(profile.baseUrl);
  if (configured) {
    return configured;
  }
  return profile.protocol === "anthropic"
    ? getProviderDefaultSdkBaseUrl("claude")
    : getProviderDefaultSdkBaseUrl("codex");
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

function joinBaseUrl(baseUrl: string, suffix: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/u, "");
  const normalizedSuffix = suffix.replace(/^\/+/u, "/");
  if (/\/v\d+(?:\.\d+)?$/iu.test(normalizedBaseUrl) && /^\/v\d+(?:\.\d+)?\//iu.test(normalizedSuffix)) {
    return normalizedBaseUrl + normalizedSuffix.replace(/^\/v\d+(?:\.\d+)?/iu, "");
  }
  return normalizedBaseUrl + normalizedSuffix;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

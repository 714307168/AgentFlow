import type { CliProvider } from "./runtime-types";

export type ProviderCapabilityKey =
  | "promptExecution"
  | "resumeConversation"
  | "webSearch"
  | "reviewCommand"
  | "featuresCommand"
  | "mcpCommand"
  | "completionCommand"
  | "versionCommand"
  | "nativeTools";

export interface ProviderRuntimeCapabilities {
  promptExecution: boolean;
  resumeConversation: boolean;
  webSearch: boolean;
  reviewCommand: boolean;
  featuresCommand: boolean;
  mcpCommand: boolean;
  completionCommand: boolean;
  versionCommand: boolean;
  nativeTools: boolean;
}

export interface ProviderConfigSnapshot {
  openaiApiKey?: string | null;
  openaiBaseUrl?: string | null;
  openaiDefaultModel?: string | null;
  anthropicApiKey?: string | null;
  anthropicBaseUrl?: string | null;
  anthropicDefaultModel?: string | null;
  modelProviderProfiles?: ModelProviderProfile[] | null;
  activeModelProviderProfileByProtocol?: Partial<Record<ModelProviderProtocol, string>> | null;
}

export type ModelProviderProtocol = "openai" | "anthropic";

export interface ModelProviderProfile {
  id: string;
  name: string;
  protocol: ModelProviderProtocol;
  apiKey?: string | null;
  baseUrl?: string | null;
  defaultModel?: string | null;
  enabled?: boolean;
}

export interface ModelProviderPreset {
  id: string;
  name: string;
  protocol: ModelProviderProtocol;
  baseUrl: string;
  defaultModel: string;
  description: string;
}

interface ProviderRegistryEntry {
  id: CliProvider;
  label: string;
  cliBaseCommand: string;
  sdk: {
    apiKeyConfigKey: keyof ProviderConfigSnapshot;
    baseUrlConfigKey: keyof ProviderConfigSnapshot;
    defaultModelConfigKey: keyof ProviderConfigSnapshot;
    defaultBaseUrl: string;
    defaultModel: string;
    env: {
      apiKey: string;
      authToken?: string;
      baseUrl: string;
    };
  };
  installTargets: {
    npm: string;
    brew: string;
    scoop: string;
    winget: string;
  };
  nativeCliCapabilityKeys: ProviderCapabilityKey[];
  visibleCapabilityKeys: ProviderCapabilityKey[];
  upgradeRequiredCapabilities: Array<{
    key: ProviderCapabilityKey;
    label: string;
  }>;
}

export const EMPTY_PROVIDER_CAPABILITIES: ProviderRuntimeCapabilities = {
  promptExecution: false,
  resumeConversation: false,
  webSearch: false,
  reviewCommand: false,
  featuresCommand: false,
  mcpCommand: false,
  completionCommand: false,
  versionCommand: false,
  nativeTools: false,
};

const PROVIDER_REGISTRY: Record<CliProvider, ProviderRegistryEntry> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    cliBaseCommand: "claude",
    sdk: {
      apiKeyConfigKey: "anthropicApiKey",
      baseUrlConfigKey: "anthropicBaseUrl",
      defaultModelConfigKey: "anthropicDefaultModel",
      defaultBaseUrl: "https://api.anthropic.com",
      defaultModel: "claude-sonnet-4-6",
      env: {
        apiKey: "ANTHROPIC_API_KEY",
        authToken: "ANTHROPIC_AUTH_TOKEN",
        baseUrl: "ANTHROPIC_BASE_URL",
      },
    },
    installTargets: {
      npm: "@anthropic-ai/claude-code@latest",
      brew: "claude-code",
      scoop: "claude-code",
      winget: "Anthropic.ClaudeCode",
    },
    nativeCliCapabilityKeys: [
      "promptExecution",
      "resumeConversation",
      "versionCommand",
      "nativeTools",
    ],
    visibleCapabilityKeys: [
      "promptExecution",
      "resumeConversation",
      "versionCommand",
      "nativeTools",
    ],
    upgradeRequiredCapabilities: [
      { key: "promptExecution", label: "prompt execution" },
    ],
  },
  codex: {
    id: "codex",
    label: "OpenAI Codex",
    cliBaseCommand: "codex",
    sdk: {
      apiKeyConfigKey: "openaiApiKey",
      baseUrlConfigKey: "openaiBaseUrl",
      defaultModelConfigKey: "openaiDefaultModel",
      defaultBaseUrl: "https://api.openai.com",
      defaultModel: "gpt-5.6-terra",
      env: {
        apiKey: "OPENAI_API_KEY",
        baseUrl: "OPENAI_BASE_URL",
      },
    },
    installTargets: {
      npm: "@openai/codex@latest",
      brew: "codex",
      scoop: "codex",
      winget: "OpenAI.Codex",
    },
    nativeCliCapabilityKeys: [
      "promptExecution",
      "resumeConversation",
      "webSearch",
      "reviewCommand",
      "featuresCommand",
      "mcpCommand",
      "completionCommand",
      "versionCommand",
      "nativeTools",
    ],
    visibleCapabilityKeys: [
      "promptExecution",
      "resumeConversation",
      "webSearch",
      "reviewCommand",
      "featuresCommand",
      "mcpCommand",
      "completionCommand",
      "versionCommand",
      "nativeTools",
    ],
    upgradeRequiredCapabilities: [
      { key: "promptExecution", label: "prompt execution" },
      { key: "resumeConversation", label: "conversation resume" },
      { key: "webSearch", label: "web search flag" },
    ],
  },
};

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com",
    defaultModel: "gpt-5.6-terra",
    description: "Official OpenAI-compatible API endpoint.",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    description: "DeepSeek chat models through an OpenAI-compatible API.",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    protocol: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4.5",
    description: "Zhipu GLM OpenAI-compatible API mode.",
  },
  {
    id: "minimax-mimo",
    name: "MiniMax / Mimo",
    protocol: "openai",
    baseUrl: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-M1",
    description: "MiniMax and Mimo-style OpenAI-compatible models.",
  },
  {
    id: "hunyuan",
    name: "腾讯混元",
    protocol: "openai",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    defaultModel: "hunyuan-turbos-latest",
    description: "Tencent Hunyuan OpenAI-compatible API endpoint.",
  },
  {
    id: "aliyun-qwen",
    name: "阿里通义千问",
    protocol: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    description: "Alibaba DashScope OpenAI-compatible API mode.",
  },
  {
    id: "google-gemini",
    name: "Google Gemini",
    protocol: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-pro",
    description: "Google Gemini through its official OpenAI-compatible endpoint.",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-6",
    description: "Official Anthropic Messages API endpoint.",
  },
];

export function listRegisteredProviders(): CliProvider[] {
  return Object.keys(PROVIDER_REGISTRY) as CliProvider[];
}

export function normalizeCliProvider(
  provider: string | null | undefined,
  fallback: CliProvider = "claude",
): CliProvider {
  return provider === "codex" || provider === "claude" ? provider : fallback;
}

export function getProviderLabel(provider: CliProvider): string {
  return PROVIDER_REGISTRY[provider].label;
}

export function getCliProviderCommand(
  provider: CliProvider,
  platform: NodeJS.Platform = process.platform,
): string {
  const base = PROVIDER_REGISTRY[provider].cliBaseCommand;
  return platform === "win32" ? `${base}.cmd` : base;
}

export function getProviderCapabilityKeys(provider: CliProvider): ProviderCapabilityKey[] {
  return [...PROVIDER_REGISTRY[provider].visibleCapabilityKeys];
}

export function createProviderNativeCliCapabilities(provider: CliProvider): ProviderRuntimeCapabilities {
  const enabled = new Set(PROVIDER_REGISTRY[provider].nativeCliCapabilityKeys);
  return {
    promptExecution: enabled.has("promptExecution"),
    resumeConversation: enabled.has("resumeConversation"),
    webSearch: enabled.has("webSearch"),
    reviewCommand: enabled.has("reviewCommand"),
    featuresCommand: enabled.has("featuresCommand"),
    mcpCommand: enabled.has("mcpCommand"),
    completionCommand: enabled.has("completionCommand"),
    versionCommand: enabled.has("versionCommand"),
    nativeTools: enabled.has("nativeTools"),
  };
}

export function getProviderUpgradeMissingCapabilityLabels(
  provider: CliProvider,
  capabilities: ProviderRuntimeCapabilities,
): string[] {
  return PROVIDER_REGISTRY[provider].upgradeRequiredCapabilities
    .filter((entry) => capabilities[entry.key] !== true)
    .map((entry) => entry.label);
}

export function getProviderInstallTargets(provider: CliProvider): ProviderRegistryEntry["installTargets"] {
  return PROVIDER_REGISTRY[provider].installTargets;
}

export function listModelProviderPresets(): ModelProviderPreset[] {
  return MODEL_PROVIDER_PRESETS.map((preset) => ({ ...preset }));
}

export function createDefaultModelProviderProfiles(
  config: ProviderConfigSnapshot | null | undefined = null,
): ModelProviderProfile[] {
  return MODEL_PROVIDER_PRESETS.map((preset) => {
    const profile: ModelProviderProfile = {
      id: preset.id,
      name: preset.name,
      protocol: preset.protocol,
      apiKey: "",
      baseUrl: preset.baseUrl,
      defaultModel: preset.defaultModel,
      enabled: true,
    };
    if (preset.id === "openai") {
      profile.apiKey = normalizeConfigText(config?.openaiApiKey);
      profile.baseUrl = normalizeConfigText(config?.openaiBaseUrl) || preset.baseUrl;
      profile.defaultModel = normalizeConfigText(config?.openaiDefaultModel) || preset.defaultModel;
    } else if (preset.id === "anthropic") {
      profile.apiKey = normalizeConfigText(config?.anthropicApiKey);
      profile.baseUrl = normalizeConfigText(config?.anthropicBaseUrl) || preset.baseUrl;
      profile.defaultModel = normalizeConfigText(config?.anthropicDefaultModel) || preset.defaultModel;
    }
    return profile;
  });
}

export function normalizeModelProviderProfiles(
  profiles: ModelProviderProfile[] | null | undefined,
  legacyConfig: ProviderConfigSnapshot | null | undefined = null,
): ModelProviderProfile[] {
  const source = Array.isArray(profiles) && profiles.length > 0
    ? profiles
    : createDefaultModelProviderProfiles(legacyConfig);
  const usedIds = new Set<string>();
  const normalized: ModelProviderProfile[] = [];
  for (const profile of source) {
    const protocol = profile?.protocol === "anthropic" ? "anthropic" : "openai";
    const fallbackId = `${protocol}-${normalized.length + 1}`;
    const baseId = normalizeProfileId(profile?.id) || fallbackId;
    const id = makeUniqueProfileId(baseId, usedIds);
    const name = normalizeConfigText(profile?.name) || profileDisplayNameFromId(id);
    normalized.push({
      id,
      name,
      protocol,
      apiKey: normalizeConfigText(profile?.apiKey),
      baseUrl: normalizeConfigText(profile?.baseUrl),
      defaultModel: normalizeConfigText(profile?.defaultModel),
      enabled: profile?.enabled !== false,
    });
  }
  return normalized;
}

export function normalizeActiveModelProviderProfileMap(
  activeMap: Partial<Record<ModelProviderProtocol, string>> | null | undefined,
  profiles: ModelProviderProfile[],
): Partial<Record<ModelProviderProtocol, string>> {
  const normalized: Partial<Record<ModelProviderProtocol, string>> = {};
  for (const protocol of ["openai", "anthropic"] as const) {
    const configured = normalizeConfigText(activeMap?.[protocol]);
    const enabledProfiles = profiles.filter((profile) => (
      profile.protocol === protocol && profile.enabled !== false
    ));
    const configuredProfile = configured
      ? enabledProfiles.find((profile) => profile.id === configured)
      : null;
    const configuredCredentialProfile = enabledProfiles.find((profile) => (
      Boolean(normalizeConfigText(profile.apiKey))
    ));
    const fallbackProfile = configuredCredentialProfile || enabledProfiles[0];
    // The initial profile is often an empty official-provider placeholder. Do
    // not let it mask a credential the user has just configured for another
    // provider of the same protocol; otherwise child CLIs receive no key.
    const selected = configuredProfile && (
      Boolean(normalizeConfigText(configuredProfile.apiKey))
      || !configuredCredentialProfile
    )
      ? configuredProfile
      : fallbackProfile;
    if (selected) {
      normalized[protocol] = selected.id;
    }
  }
  return normalized;
}

export function getProviderSdkProtocol(provider: CliProvider): ModelProviderProtocol {
  return provider === "claude" ? "anthropic" : "openai";
}

export function getActiveModelProviderProfile(
  config: ProviderConfigSnapshot | null | undefined,
  providerOrProtocol: CliProvider | ModelProviderProtocol,
): ModelProviderProfile | null {
  const protocol = providerOrProtocol === "claude" || providerOrProtocol === "anthropic" ? "anthropic" : "openai";
  const profiles = normalizeModelProviderProfiles(config?.modelProviderProfiles, config);
  const activeMap = normalizeActiveModelProviderProfileMap(config?.activeModelProviderProfileByProtocol, profiles);
  const activeId = activeMap[protocol];
  return profiles.find((profile) => profile.id === activeId && profile.protocol === protocol && profile.enabled !== false) ?? null;
}

export function getProviderSdkConfigValue(
  config: ProviderConfigSnapshot | null | undefined,
  provider: CliProvider,
  field: "apiKey" | "baseUrl" | "defaultModel",
): string | null {
  if (!config) {
    return null;
  }
  const activeProfile = getActiveModelProviderProfile(config, provider);
  const profileValue = activeProfile ? activeProfile[field] : null;
  if (typeof profileValue === "string" && profileValue.trim()) {
    return profileValue.trim();
  }
  const registry = PROVIDER_REGISTRY[provider].sdk;
  const key = field === "apiKey"
    ? registry.apiKeyConfigKey
    : (field === "baseUrl" ? registry.baseUrlConfigKey : registry.defaultModelConfigKey);
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getProviderDefaultSdkBaseUrl(provider: CliProvider): string {
  return PROVIDER_REGISTRY[provider].sdk.defaultBaseUrl;
}

export function getProviderDefaultSdkModel(provider: CliProvider): string {
  return PROVIDER_REGISTRY[provider].sdk.defaultModel;
}

export function hasProviderApiFallback(
  config: ProviderConfigSnapshot | null | undefined,
  provider: CliProvider,
): boolean {
  return Boolean(getProviderSdkConfigValue(config, provider, "apiKey"));
}

export function buildProviderEnvironment(
  config: ProviderConfigSnapshot | null | undefined,
  provider: CliProvider,
  baseEnv: Record<string, string> = {},
): Record<string, string> {
  const nextEnv: Record<string, string> = { ...baseEnv };
  const registry = PROVIDER_REGISTRY[provider].sdk;
  const apiKey = getProviderSdkConfigValue(config, provider, "apiKey");
  const baseUrl = getProviderSdkConfigValue(config, provider, "baseUrl");

  if (apiKey) {
    nextEnv[registry.env.apiKey] = apiKey;
    if (registry.env.authToken) {
      nextEnv[registry.env.authToken] = apiKey;
    }
  }
  if (baseUrl) {
    nextEnv[registry.env.baseUrl] = baseUrl;
  }

  return nextEnv;
}

function normalizeConfigText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function normalizeProfileId(value: string | null | undefined): string {
  return normalizeConfigText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
}

function makeUniqueProfileId(baseId: string, usedIds: Set<string>): string {
  let id = baseId || "provider";
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId || "provider"}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function profileDisplayNameFromId(id: string): string {
  return id
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || "Model Provider";
}

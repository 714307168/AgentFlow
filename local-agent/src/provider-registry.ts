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
      defaultModel: "claude-3-7-sonnet-latest",
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
      defaultModel: "gpt-5.4",
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

export function getProviderSdkConfigValue(
  config: ProviderConfigSnapshot | null | undefined,
  provider: CliProvider,
  field: "apiKey" | "baseUrl" | "defaultModel",
): string | null {
  if (!config) {
    return null;
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

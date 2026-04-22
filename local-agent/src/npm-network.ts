export const DEFAULT_NPM_REGISTRY = "https://registry.npmmirror.com";

export function resolvePreferredNpmRegistry(
  env: Record<string, string | undefined> = process.env,
): string {
  const candidates = [
    env.AGENTFLOW_NPM_REGISTRY,
    env.npm_config_registry,
    env.NPM_CONFIG_REGISTRY,
    DEFAULT_NPM_REGISTRY,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized.replace(/\/+$/u, "");
    }
  }
  return DEFAULT_NPM_REGISTRY;
}

export function buildNpmCommandEnvironment(
  baseEnv: Record<string, string | undefined> = process.env,
  registry = resolvePreferredNpmRegistry(baseEnv),
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    npm_config_registry: registry,
    NPM_CONFIG_REGISTRY: registry,
  };
}

export function appendNpmRegistryArgs(
  args: string[],
  registry = resolvePreferredNpmRegistry(),
): string[] {
  const normalizedRegistry = String(registry ?? "").trim();
  if (!normalizedRegistry) {
    return [...args];
  }
  return [...args, "--registry", normalizedRegistry];
}

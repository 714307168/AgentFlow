export const DEFAULT_NPM_REGISTRY = "https://registry.npmmirror.com";
export const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org";

function readRuntimeTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export function isLikelyChinaEnvironment(
  env: Record<string, string | undefined> = process.env,
  timeZone = readRuntimeTimeZone(),
): boolean {
  const explicitRegion = String(env.AGENTFLOW_REGION ?? env.AGENTFLOW_MARKET ?? "").trim().toLowerCase();
  if (explicitRegion) {
    return ["cn", "china", "mainland-china", "zh-cn"].includes(explicitRegion);
  }

  const locale = [env.LANG, env.LC_ALL, env.LC_MESSAGES, env.LANGUAGE]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  if (/(?:^|[^a-z])zh[_-]cn(?:[^a-z]|$)/u.test(locale)) {
    return true;
  }

  return /^(asia\/shanghai|asia\/chongqing|asia\/harbin|asia\/urumqi)$/iu.test(String(timeZone).trim());
}

export function resolvePreferredNpmRegistry(
  env: Record<string, string | undefined> = process.env,
  timeZone = readRuntimeTimeZone(),
): string {
  const candidates = [
    env.AGENTFLOW_NPM_REGISTRY,
    env.npm_config_registry,
    env.NPM_CONFIG_REGISTRY,
    isLikelyChinaEnvironment(env, timeZone) ? DEFAULT_NPM_REGISTRY : OFFICIAL_NPM_REGISTRY,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized.replace(/\/+$/u, "");
    }
  }
  return isLikelyChinaEnvironment(env, timeZone) ? DEFAULT_NPM_REGISTRY : OFFICIAL_NPM_REGISTRY;
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

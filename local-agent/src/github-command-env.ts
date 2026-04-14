export function buildGitHubCommandEnvironment(token: string | null | undefined): Record<string, string> {
  const normalizedToken = String(token ?? "").trim();
  if (!normalizedToken) {
    return {};
  }

  const encodedToken = encodeURIComponent(normalizedToken);
  return {
    GITHUB_TOKEN: normalizedToken,
    GH_TOKEN: normalizedToken,
    GCM_INTERACTIVE: "never",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "url.https://x-access-token:" + encodedToken + "@github.com/.insteadof",
    GIT_CONFIG_VALUE_0: "https://github.com/",
    GIT_CONFIG_KEY_1: "url.https://x-access-token:" + encodedToken + "@www.github.com/.insteadof",
    GIT_CONFIG_VALUE_1: "https://www.github.com/",
  };
}

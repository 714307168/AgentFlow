function appendGitConfigEntry(
  target: Record<string, string>,
  index: number,
  key: string,
  value: string,
): number {
  target[`GIT_CONFIG_KEY_${index}`] = key;
  target[`GIT_CONFIG_VALUE_${index}`] = value;
  return index + 1;
}

export function buildGitHubCommandEnvironment(token: string | null | undefined): Record<string, string> {
  const normalizedToken = String(token ?? "").trim();
  const env: Record<string, string> = {
    GCM_INTERACTIVE: "never",
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
  };

  let gitConfigCount = 0;
  gitConfigCount = appendGitConfigEntry(env, gitConfigCount, "credential.helper", "");
  gitConfigCount = appendGitConfigEntry(env, gitConfigCount, "credential.interactive", "never");
  gitConfigCount = appendGitConfigEntry(env, gitConfigCount, "core.askPass", "");

  if (normalizedToken) {
    const encodedToken = encodeURIComponent(normalizedToken);
    env.GITHUB_TOKEN = normalizedToken;
    env.GH_TOKEN = normalizedToken;
    gitConfigCount = appendGitConfigEntry(
      env,
      gitConfigCount,
      "url.https://x-access-token:" + encodedToken + "@github.com/.insteadof",
      "https://github.com/",
    );
    gitConfigCount = appendGitConfigEntry(
      env,
      gitConfigCount,
      "url.https://x-access-token:" + encodedToken + "@www.github.com/.insteadof",
      "https://www.github.com/",
    );
  }

  env.GIT_CONFIG_COUNT = String(gitConfigCount);
  return env;
}

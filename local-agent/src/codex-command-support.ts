import type { CliProvider } from "./runtime-types";

export interface CodexExecArgsOptions {
  canResumeConversation: boolean;
  codexThreadId: string | null;
  model: string | null;
  searchEnabled: boolean;
}

export type SlashToggleIntent = "status" | "enable" | "disable" | "toggle";

export interface CodexReviewArgsResult {
  args: string[] | null;
  errorMessage?: string;
}

const CODEX_COMPLETION_SHELLS = ["bash", "elvish", "fish", "powershell", "zsh"] as const;
type CodexCompletionShell = typeof CODEX_COMPLETION_SHELLS[number];

const CODEX_RESTRICTED_TOOL_ARGS = [
  "--enable",
  "code_mode_only",
  "--disable",
  "shell_tool",
  "--disable",
  "tool_search",
  "--disable",
  "tool_suggest",
  "--disable",
  "tool_call_mcp_elicitation",
] as const;

export function buildCodexExecArgs(options: CodexExecArgsOptions): string[] {
  const sharedArgs = [
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    ...CODEX_RESTRICTED_TOOL_ARGS,
    ...(options.model ? ["--model", options.model] : []),
  ];

  if (options.canResumeConversation && options.codexThreadId) {
    return [
      "exec",
      "resume",
      ...sharedArgs,
      options.codexThreadId,
    ];
  }

  return [
    "exec",
    ...sharedArgs,
    ...(options.searchEnabled ? ["--search"] : []),
  ];
}

export function buildSlashHelpMessage(provider: CliProvider): string {
  const lines = [
    "Supported slash commands in this app:",
    "- /help: show slash-command support in the desktop workspace.",
    "- /tools: show the current provider capabilities exposed through this app.",
    "- /init [extra notes]: initialize project guidance for future agent runs.",
    "- /model: show the current project model.",
    "- /model <name>: switch the current project to a specific model.",
    "- /model auto: return to the provider default model.",
    "- /screenshot: capture the primary desktop display and send it back into this chat.",
    "- /send-image <path>: copy a local image into this chat. Relative paths resolve from the project root.",
    "- /search [status|on|off|toggle]: manage Codex web search availability for future runs.",
    "",
    "Provider behavior:",
    "- Claude Code: native slash commands are passed through when Claude's headless mode supports them.",
    "- OpenAI Codex: headless codex exec does not expose native slash commands, so this app emulates local commands such as /help, /tools, /model, /search, /screenshot, and /send-image.",
  ];

  if (provider === "codex") {
    lines.push(
      "",
      "Additional Codex-only commands in this app:",
      "- /review [options] [instructions]: run `codex review` from this workspace.",
      "- /features [list]: show the current Codex CLI feature flags exposed by `codex features list`.",
      "- /version: show the installed Codex CLI version.",
      "- /completion [shell]: generate a Codex shell-completion script. Defaults to the current desktop shell profile.",
      "- /mcp list [json]: list configured MCP servers.",
      "- /mcp get <name> [json]: show a configured MCP server.",
      "- For other Codex slash commands, use a normal prompt or the full interactive Codex CLI.",
    );
  }

  return lines.join("\n");
}

export function buildCodexUnsupportedSlashMessage(commandName: string): string {
  return [
    `/${commandName} is not available in headless Codex mode.`,
    "This workspace currently emulates /help, /tools, /model, /search, /review, /features, /version, /completion, /mcp, /screenshot, and /send-image for Codex projects.",
    "Use a normal prompt for the same intent, or run the full interactive Codex CLI if you need native slash commands.",
  ].join("\n");
}

export function buildCodexInitPrompt(extraNotes: string): string {
  const parts = [
    "Initialize this repository for future Codex and coding-agent sessions.",
    "Inspect the repository first, then create or update a root-level AGENTS.md file.",
    "Keep AGENTS.md concise and practical.",
    "Include only guidance you can verify from the repository, such as project structure, important commands, test/build/lint workflows, and coding conventions.",
    "If AGENTS.md already exists, improve it in place instead of duplicating content.",
  ];

  if (extraNotes) {
    parts.push(`Additional user guidance: ${extraNotes}`);
  }

  return parts.join("\n");
}

export function buildProviderToolsMessage(options: {
  provider: CliProvider;
  model: string | null;
  codexSearchEnabled: boolean;
}): string {
  const lines = [
    `Current provider: ${options.provider === "codex" ? "OpenAI Codex" : "Claude Code"}`,
    `Current model: ${options.model ?? "Auto"}`,
    "",
  ];

  if (options.provider === "codex") {
    lines.push(
      "Codex capabilities available through this app:",
      "- Runs Codex through `codex exec --json` and resumes threads with `codex exec resume --json`.",
      "- App-side Codex runs are started with a restricted tool profile that disables shell-tool style invocation and Codex tool discovery helpers.",
      "- The chat flow keeps Codex focused on direct responses instead of tool-calling orchestration.",
      "- This app surfaces Codex activity such as command execution, agent messages, and completion events into the chat/activity timeline.",
      `- Web search tool: ${options.codexSearchEnabled ? "enabled" : "disabled"} for subsequent runs. Use /search on|off|toggle to change it.`,
      "- `/review` runs `codex review` for workspace changes without leaving the app.",
      "- `/features` runs `codex features list` so you can inspect CLI feature flags from the app.",
      "- `/version` shows the installed Codex CLI version used by the desktop agent.",
      "- `/completion` generates shell completion scripts from the installed Codex CLI.",
      "- `/mcp list|get` lets you inspect configured MCP servers without leaving the app.",
      "",
      "Not exposed in this app:",
      "- The full interactive Codex TUI.",
      "- Config-mutating top-level flows such as `codex features enable/disable`.",
      "- Config-mutating top-level CLI flows such as `codex login`, `codex logout`, `codex mcp add/remove/login/logout`, or `codex cloud`.",
      "- Native Codex slash commands beyond the local commands emulated by this workspace.",
    );
    return lines.join("\n");
  }

  lines.push(
    "Claude Code capabilities available through this app:",
    "- Runs Claude Code headlessly and streams agent/tool activity back into the chat timeline.",
    "- Native slash commands are only available when Claude's headless mode supports them.",
    "",
    "Use /model to change models, or switch the project provider to OpenAI Codex if you need Codex-specific flows.",
  );
  return lines.join("\n");
}

export function parseSlashToggleIntent(rawArgs: string): SlashToggleIntent | null {
  const normalized = rawArgs.trim().toLowerCase();
  if (!normalized || normalized === "status") {
    return "status";
  }
  if (normalized === "on" || normalized === "enable" || normalized === "enabled" || normalized === "true") {
    return "enable";
  }
  if (normalized === "off" || normalized === "disable" || normalized === "disabled" || normalized === "false") {
    return "disable";
  }
  if (normalized === "toggle" || normalized === "switch") {
    return "toggle";
  }
  return null;
}

export function buildCodexSearchStatusMessage(enabled: boolean): string {
  return enabled
    ? "Codex web search is enabled for future runs."
    : "Codex web search is disabled for future runs.";
}

export function buildCodexSearchUsageMessage(): string {
  return "Usage: /search [status|on|off|toggle]";
}

export function buildCodexFeaturesArgs(rawArgs: string, model: string | null): CodexReviewArgsResult {
  const normalized = rawArgs.trim().toLowerCase();
  if (normalized && normalized !== "list") {
    return {
      args: null,
      errorMessage: "Usage: /features [list]",
    };
  }

  return {
    args: [
      "features",
      ...buildCodexConfigArgs(model),
      ...CODEX_RESTRICTED_TOOL_ARGS,
      "list",
    ],
  };
}

export function buildCodexVersionArgs(): CodexReviewArgsResult {
  return {
    args: ["--version"],
  };
}

export function buildCodexCompletionArgs(rawArgs: string): CodexReviewArgsResult {
  const normalized = rawArgs.trim().toLowerCase();
  const shell = normalized || getDefaultCompletionShell();
  if (!CODEX_COMPLETION_SHELLS.includes(shell as CodexCompletionShell)) {
    return {
      args: null,
      errorMessage: "Usage: /completion [bash|elvish|fish|powershell|zsh]",
    };
  }

  return {
    args: ["completion", shell],
  };
}

export function buildCodexMcpArgs(rawArgs: string): CodexReviewArgsResult {
  const tokens = splitSlashArgs(rawArgs);
  if (!tokens) {
    return {
      args: null,
      errorMessage: "Usage: /mcp list [json] | /mcp get <name> [json]",
    };
  }

  if (tokens.length === 0 || tokens[0] === "list") {
    const wantsJson = tokens.includes("json") || tokens.includes("--json");
    if (tokens.some((token, index) => index > 0 && token !== "json" && token !== "--json")) {
      return {
        args: null,
        errorMessage: "Usage: /mcp list [json] | /mcp get <name> [json]",
      };
    }
    return {
      args: ["mcp", "list", ...(wantsJson ? ["--json"] : [])],
    };
  }

  if (tokens[0] === "get") {
    const name = tokens[1];
    if (!name) {
      return {
        args: null,
        errorMessage: "Usage: /mcp get <name> [json]",
      };
    }
    const trailing = tokens.slice(2);
    const wantsJson = trailing.includes("json") || trailing.includes("--json");
    if (trailing.some((token) => token !== "json" && token !== "--json")) {
      return {
        args: null,
        errorMessage: "Usage: /mcp get <name> [json]",
      };
    }
    return {
      args: ["mcp", "get", name, ...(wantsJson ? ["--json"] : [])],
    };
  }

  return {
    args: null,
    errorMessage: "Usage: /mcp list [json] | /mcp get <name> [json]",
  };
}

export function buildCodexReviewArgs(rawArgs: string, model: string | null): CodexReviewArgsResult {
  const tokens = splitSlashArgs(rawArgs);
  if (!tokens) {
    return {
      args: null,
      errorMessage: "Usage: /review [--uncommitted] [--base <branch>] [--commit <sha>] [--title <title>] [instructions]",
    };
  }

  const args = [
    "review",
    ...buildCodexConfigArgs(model),
    ...CODEX_RESTRICTED_TOOL_ARGS,
  ];
  let hasScope = false;
  const promptTokens: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    if (token === "--uncommitted") {
      args.push("--uncommitted");
      hasScope = true;
      continue;
    }

    if (token === "--base" || token === "--commit" || token === "--title") {
      const value = tokens[index + 1];
      if (!value) {
        return {
          args: null,
          errorMessage: `Missing value for ${token}.\nUsage: /review [--uncommitted] [--base <branch>] [--commit <sha>] [--title <title>] [instructions]`,
        };
      }
      args.push(token, value);
      if (token !== "--title") {
        hasScope = true;
      }
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      return {
        args: null,
        errorMessage: `Unsupported /review option: ${token}\nUsage: /review [--uncommitted] [--base <branch>] [--commit <sha>] [--title <title>] [instructions]`,
      };
    }

    promptTokens.push(token);
  }

  if (!hasScope) {
    args.push("--uncommitted");
  }
  if (args.includes("--base") && args.includes("--commit")) {
    return {
      args: null,
      errorMessage: "Use either --base <branch> or --commit <sha>, not both.",
    };
  }
  if (promptTokens.length > 0) {
    args.push(promptTokens.join(" "));
  }

  return { args };
}

function buildCodexConfigArgs(model: string | null): string[] {
  if (!model) {
    return [];
  }
  return ["-c", `model=${JSON.stringify(model)}`];
}

function getDefaultCompletionShell(): CodexCompletionShell {
  if (process.platform === "win32") {
    return "powershell";
  }
  if (process.platform === "darwin") {
    return "zsh";
  }
  return "bash";
}

function splitSlashArgs(rawArgs: string): string[] | null {
  const normalized = rawArgs.trim();
  if (!normalized) {
    return [];
  }

  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (quote) {
      if (char === "\\" && normalized[index + 1] === quote) {
        current += quote;
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }

    if (/\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    return null;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

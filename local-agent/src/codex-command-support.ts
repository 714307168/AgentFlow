import type { CliProvider } from "./runtime-types";

export interface CodexExecArgsOptions {
  canResumeConversation: boolean;
  codexThreadId: string | null;
  model: string | null;
  searchEnabled: boolean;
}

export type SlashToggleIntent = "status" | "enable" | "disable" | "toggle";

export function buildCodexExecArgs(options: CodexExecArgsOptions): string[] {
  const baseArgs = [
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    ...(options.model ? ["--model", options.model] : []),
    ...(options.searchEnabled ? ["--search"] : []),
  ];

  if (options.canResumeConversation && options.codexThreadId) {
    return [
      "exec",
      "resume",
      ...baseArgs,
      options.codexThreadId,
    ];
  }

  return [
    "exec",
    ...baseArgs,
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
    lines.push("- For other Codex slash commands, use a normal prompt or the full interactive Codex CLI.");
  }

  return lines.join("\n");
}

export function buildCodexUnsupportedSlashMessage(commandName: string): string {
  return [
    `/${commandName} is not available in headless Codex mode.`,
    "This workspace currently emulates /help, /tools, /model, /search, /screenshot, and /send-image for Codex projects.",
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
      "- Codex can still use its built-in agent tools during a run, including command execution and file editing inside the workspace.",
      "- This app surfaces Codex activity such as command execution, agent messages, and completion events into the chat/activity timeline.",
      `- Web search tool: ${options.codexSearchEnabled ? "enabled" : "disabled"} for subsequent runs. Use /search on|off|toggle to change it.`,
      "",
      "Not exposed in this app:",
      "- The full interactive Codex TUI.",
      "- Native Codex slash commands beyond the local commands emulated by this workspace.",
      "- Standalone top-level CLI flows such as `codex login`, `codex logout`, `codex mcp`, or `codex cloud`.",
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

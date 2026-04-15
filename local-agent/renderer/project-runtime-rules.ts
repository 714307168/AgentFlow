type ProjectRuntimeTone = "idle" | "ready" | "running" | "queued" | "error";

interface ProjectStatusMeta {
  label: string;
  tone: ProjectRuntimeTone;
  detail: string;
}

interface ProjectRuntimeRulesTextHelpers {
  inlineText: (en: string, zh: string) => string;
  msg: (key: string, fallback: string, vars?: Record<string, string>) => string;
  providerLabel: (provider: "claude" | "codex") => string;
  modelLabel: (model: string | null | undefined) => string;
  translateSource: (source: "remote" | "desktop" | "workgroup") => string;
  translateKind: (kind: SessionActivity["kind"]) => string;
  translateCliStream: (stream: CliTraceEntry["stream"]) => string;
  translateActivityStatus: (status: SessionActivity["status"]) => string;
  previewText: (value: string | null | undefined, maxLength?: number) => string;
}

interface ProjectRuntimeBaseInput extends ProjectRuntimeRulesTextHelpers {
  project: ProjectState | null;
  session: SessionSnapshot | null;
}

interface ProjectRuntimeOverviewInput extends ProjectRuntimeBaseInput {
  provider: "claude" | "codex";
}

interface ProjectRuntimePreviewInput extends ProjectRuntimeBaseInput {
  maxLength?: number;
}

interface ProjectRuntimeRulesApi {
  getLatestActivity: (session: SessionSnapshot | null) => SessionActivity | null;
  getLatestCliEntry: (session: SessionSnapshot | null) => CliTraceEntry | null;
  getLatestMessage: (session: SessionSnapshot | null) => SessionMessage | null;
  buildProjectStatusMeta: (input: ProjectRuntimeBaseInput) => ProjectStatusMeta;
  buildProjectLatestPreview: (input: ProjectRuntimePreviewInput) => string;
  buildOverviewState: (input: ProjectRuntimeOverviewInput) => OverviewState;
}

function runtimeRulesIsPrivateProjectMessage(message: SessionMessage | null | undefined): boolean {
  return Boolean(message) && message?.source !== "workgroup";
}

function runtimeRulesIsPrivateProjectActivity(activity: SessionActivity | null | undefined): boolean {
  return Boolean(activity) && activity?.meta?.source !== "workgroup";
}

function runtimeRulesGetVisibleSessionMessages(session: SessionSnapshot | null): SessionMessage[] {
  if (!session) {
    return [];
  }
  return session.messages.filter((message) => runtimeRulesIsPrivateProjectMessage(message));
}

function runtimeRulesGetVisibleSessionActivities(session: SessionSnapshot | null): SessionActivity[] {
  if (!session) {
    return [];
  }
  return session.activities.filter((activity) => runtimeRulesIsPrivateProjectActivity(activity));
}

function runtimeRulesGetVisibleSessionQueue(session: SessionSnapshot | null): QueuedRunItem[] {
  if (!session) {
    return [];
  }
  return session.queue.filter((entry) => entry.source !== "workgroup");
}

function runtimeRulesGetLatestActivity(session: SessionSnapshot | null): SessionActivity | null {
  const activities = runtimeRulesGetVisibleSessionActivities(session);
  return activities.length > 0 ? (activities[activities.length - 1] ?? null) : null;
}

function runtimeRulesGetLatestCliEntry(session: SessionSnapshot | null): CliTraceEntry | null {
  if (!session || session.cliTrace.length === 0) {
    return null;
  }
  return session.cliTrace[session.cliTrace.length - 1] ?? null;
}

function runtimeRulesGetLatestMessage(session: SessionSnapshot | null): SessionMessage | null {
  const messages = runtimeRulesGetVisibleSessionMessages(session);
  return messages.length > 0 ? (messages[messages.length - 1] ?? null) : null;
}

function runtimeRulesGetConfiguredProvider(project: ProjectState | null, session: SessionSnapshot | null): "claude" | "codex" {
  if (session?.isRunning) {
    return session.provider;
  }
  return project?.cliProvider ?? session?.provider ?? "claude";
}

function runtimeRulesGetConfiguredModel(project: ProjectState | null, session: SessionSnapshot | null): string | null {
  if (session?.isRunning) {
    return session.model;
  }
  return project?.cliModel ?? session?.model ?? null;
}

function runtimeRulesFormatProjectSummary(
  provider: "claude" | "codex",
  model: string | null | undefined,
  detail: string,
  helpers: Pick<ProjectRuntimeRulesTextHelpers, "providerLabel" | "modelLabel">,
): string {
  return `${helpers.providerLabel(provider)} · ${helpers.modelLabel(model)} · ${detail}`;
}

function buildProjectStatusMeta(input: ProjectRuntimeBaseInput): ProjectStatusMeta {
  const { project, session, inlineText, msg, providerLabel, modelLabel, translateSource } = input;
  const configuredProvider = runtimeRulesGetConfiguredProvider(project, session);
  const configuredModel = runtimeRulesGetConfiguredModel(project, session);
  if (project?.isRemote && project.online === false) {
    return {
      label: inlineText("Offline", "\u79bb\u7ebf"),
      tone: "idle",
      detail: runtimeRulesFormatProjectSummary(
        configuredProvider,
        configuredModel,
        inlineText("Remote desktop is offline", "\u8fdc\u7a0b\u684c\u9762\u7aef\u79bb\u7ebf"),
        { providerLabel, modelLabel },
      ),
    };
  }
  if (!session) {
    return {
      label: msg("terminal.project.status.idle", "Idle"),
      tone: "idle",
      detail: runtimeRulesFormatProjectSummary(
        configuredProvider,
        configuredModel,
        msg("terminal.project.summary.empty", "No messages yet"),
        { providerLabel, modelLabel },
      ),
    };
  }

  const visibleQueue = runtimeRulesGetVisibleSessionQueue(session);
  const runSource = session.currentSource === "remote"
    ? "remote"
    : (session.currentSource === "workgroup" ? "workgroup" : "desktop");
  const isPrivateRunActive = session.isRunning && session.currentSource !== "workgroup";
  if (isPrivateRunActive) {
    return {
      label: msg("terminal.project.status.running", "Running"),
      tone: "running",
      detail: runtimeRulesFormatProjectSummary(
        session.provider,
        session.model,
        msg("terminal.project.summary.running", "Active via {source}", {
          source: translateSource(runSource),
        }),
        { providerLabel, modelLabel },
      ),
    };
  }

  if (visibleQueue.length > 0) {
    return {
      label: msg("terminal.project.status.queued", "Queued"),
      tone: "queued",
      detail: runtimeRulesFormatProjectSummary(
        configuredProvider,
        configuredModel,
        msg("terminal.project.summary.queued", "{count} queued", {
          count: String(visibleQueue.length),
        }),
        { providerLabel, modelLabel },
      ),
    };
  }

  const latestActivity = runtimeRulesGetLatestActivity(session);
  if (latestActivity?.status === "error") {
    return {
      label: msg("terminal.project.status.error", "Error"),
      tone: "error",
      detail: runtimeRulesFormatProjectSummary(
        configuredProvider,
        configuredModel,
        latestActivity.title || latestActivity.detail || msg("terminal.project.summary.error", "Latest run failed"),
        { providerLabel, modelLabel },
      ),
    };
  }

  if (runtimeRulesGetVisibleSessionMessages(session).length > 0) {
    return {
      label: msg("terminal.project.status.ready", "Ready"),
      tone: "ready",
      detail: runtimeRulesFormatProjectSummary(
        configuredProvider,
        configuredModel,
        msg("terminal.project.summary.ready", "Ready for the next prompt"),
        { providerLabel, modelLabel },
      ),
    };
  }

  return {
    label: msg("terminal.project.status.idle", "Idle"),
    tone: "idle",
    detail: runtimeRulesFormatProjectSummary(
      configuredProvider,
      configuredModel,
      msg("terminal.project.summary.empty", "No messages yet"),
      { providerLabel, modelLabel },
    ),
  };
}

function buildProjectLatestPreview(input: ProjectRuntimePreviewInput): string {
  const { project, session, previewText, maxLength = 96 } = input;
  const fallback = buildProjectStatusMeta(input).detail;
  if (!session) {
    return fallback;
  }

  if (session.isRunning && session.currentPrompt?.trim()) {
    return previewText(session.currentPrompt, maxLength) || fallback;
  }

  const latestMessage = runtimeRulesGetLatestMessage(session);
  if (latestMessage?.content?.trim()) {
    return previewText(latestMessage.content, maxLength) || fallback;
  }

  const latestActivity = runtimeRulesGetLatestActivity(session);
  if (latestActivity?.detail?.trim() || latestActivity?.title?.trim()) {
    return previewText(latestActivity.detail || latestActivity.title, maxLength) || fallback;
  }

  const nextQueuedItem = runtimeRulesGetVisibleSessionQueue(session)[0] ?? null;
  if (nextQueuedItem?.prompt?.trim()) {
    return previewText(nextQueuedItem.prompt, maxLength) || fallback;
  }

  if (project?.isRemote && project.online === false) {
    return fallback;
  }

  return fallback;
}

function runtimeRulesBuildOverviewState(input: ProjectRuntimeOverviewInput): OverviewState {
  const {
    project,
    session,
    provider,
    inlineText,
    msg,
    providerLabel,
    translateSource,
    translateKind,
    translateCliStream,
    translateActivityStatus,
    previewText,
  } = input;

  if (!project) {
    return {
      tone: "idle",
      kicker: inlineText("Workbench", "\u5de5\u4f5c\u53f0"),
      title: inlineText("Select a project to start", "\u9009\u62e9\u4e00\u4e2a\u9879\u76ee\u5f00\u59cb"),
      detail: inlineText(
        "Conversation stays in front. Activity, CLI, and Queue are organized as secondary views.",
        "\u5bf9\u8bdd\u4f18\u5148\u5c55\u793a\uff0c\u6d3b\u52a8\u3001CLI \u548c\u961f\u5217\u653e\u5728\u4e0b\u65b9\u5207\u6362\u533a\u3002",
      ),
      source: inlineText("Idle", "\u7a7a\u95f2"),
      signal: inlineText("Waiting", "\u7b49\u5f85"),
    };
  }

  if (!session) {
    return {
      tone: "idle",
      kicker: inlineText("Loading", "\u52a0\u8f7d\u4e2d"),
      title: inlineText("Loading session state", "\u6b63\u5728\u52a0\u8f7d\u4f1a\u8bdd\u72b6\u6001"),
      detail: inlineText(
        "Project context is ready. Recent messages and execution state will appear here shortly.",
        "\u9879\u76ee\u4e0a\u4e0b\u6587\u5df2\u5c31\u7eea\uff0c\u6700\u8fd1\u7684\u6d88\u606f\u4e0e\u6267\u884c\u72b6\u6001\u4f1a\u5f88\u5feb\u51fa\u73b0\u5728\u8fd9\u91cc\u3002",
      ),
      source: inlineText("Idle", "\u7a7a\u95f2"),
      signal: inlineText("Loading", "\u52a0\u8f7d"),
    };
  }

  const latestActivity = runtimeRulesGetLatestActivity(session);
  const latestCliEntry = runtimeRulesGetLatestCliEntry(session);
  const latestMessage = runtimeRulesGetLatestMessage(session);
  const visibleQueue = runtimeRulesGetVisibleSessionQueue(session);

  if (session.isRunning) {
    return {
      tone: "running",
      kicker: provider === "codex"
        ? inlineText("Executing now", "\u6b63\u5728\u6267\u884c")
        : inlineText("Working now", "\u6b63\u5728\u5904\u7406"),
      title: previewText(session.currentPrompt, 144) || inlineText("Current run in progress", "\u5f53\u524d\u4efb\u52a1\u6267\u884c\u4e2d"),
      detail: previewText(latestActivity?.detail || latestActivity?.title || latestCliEntry?.text, 180) || inlineText(
        "Live execution is updating below. Open Activity or CLI for full detail.",
        "\u4e0b\u65b9\u4f1a\u6301\u7eed\u66f4\u65b0\u6267\u884c\u7ec6\u8282\uff0c\u9700\u8981\u65f6\u53ef\u4ee5\u5207\u5230\u6d3b\u52a8\u6216 CLI \u67e5\u770b\u3002",
      ),
      source: translateSource(session.currentSource ?? "desktop"),
      signal: latestActivity
        ? translateKind(latestActivity.kind)
        : translateCliStream(latestCliEntry?.stream ?? "system"),
    };
  }

  if (latestActivity?.status === "error") {
    return {
      tone: "error",
      kicker: inlineText("Needs attention", "\u9700\u8981\u5173\u6ce8"),
      title: previewText(latestActivity.title || latestActivity.detail, 144) || inlineText(
        "The last run ended with an error",
        "\u4e0a\u6b21\u8fd0\u884c\u4ee5\u9519\u8bef\u7ed3\u675f",
      ),
      detail: previewText(latestActivity.detail, 180) || inlineText(
        "Open Activity or CLI to inspect the failure details.",
        "\u53ef\u4ee5\u6253\u5f00\u6d3b\u52a8\u6216 CLI \u67e5\u770b\u5931\u8d25\u539f\u56e0\u3002",
      ),
      source: providerLabel(provider),
      signal: translateActivityStatus("error"),
    };
  }

  if (visibleQueue.length > 0) {
    const nextItem = visibleQueue[0];
    return {
      tone: "queued",
      kicker: inlineText("Queued next", "\u4e0b\u4e00\u4e2a\u961f\u5217\u4efb\u52a1"),
      title: previewText(nextItem?.prompt, 144) || inlineText("Queued prompt", "\u5df2\u6392\u961f\u7684\u63d0\u793a"),
      detail: visibleQueue.length > 1
        ? inlineText(
          `${visibleQueue.length} prompts are waiting to run.`,
          `\u5171\u6709 ${visibleQueue.length} \u6761\u63d0\u793a\u5728\u7b49\u5f85\u6267\u884c\u3002`,
        )
        : inlineText(
          "The next prompt is ready and waiting.",
          "\u4e0b\u4e00\u6761\u63d0\u793a\u5df2\u5728\u961f\u5217\u4e2d\u7b49\u5f85\u6267\u884c\u3002",
        ),
      source: translateSource(nextItem?.source ?? "desktop"),
      signal: msg("terminal.project.status.queued", "Queued"),
    };
  }

  if (latestMessage) {
    const latestSource = latestMessage.role === "user"
      ? translateSource(latestMessage.source)
      : providerLabel(latestMessage.provider ?? provider);
    return {
      tone: latestMessage.status === "streaming" ? "running" : "ready",
      kicker: latestMessage.role === "assistant"
        ? inlineText("Latest reply", "\u6700\u65b0\u56de\u590d")
        : inlineText("Latest message", "\u6700\u65b0\u6d88\u606f"),
      title: previewText(latestMessage.content, 144) || inlineText("Message ready", "\u6d88\u606f\u5df2\u5c31\u7eea"),
      detail: latestMessage.role === "user"
        ? inlineText("Awaiting the next assistant step.", "\u6b63\u5728\u7b49\u5f85\u4e0b\u4e00\u6b65\u56de\u5e94\u3002")
        : inlineText("Ready for the next prompt.", "\u5df2\u5c31\u7eea\uff0c\u53ef\u4ee5\u7ee7\u7eed\u53d1\u9001\u4e0b\u4e00\u6761\u63d0\u793a\u3002"),
      source: latestSource,
      signal: latestMessage.status === "streaming"
        ? msg("terminal.state.running", "Running")
        : msg("terminal.project.status.ready", "Ready"),
    };
  }

  return {
    tone: "ready",
    kicker: inlineText("Ready", "\u5c31\u7eea"),
    title: inlineText("Start the next prompt", "\u53ef\u4ee5\u5f00\u59cb\u4e0b\u4e00\u6761\u63d0\u793a"),
    detail: provider === "codex"
      ? inlineText(
        "Execution details remain close by in CLI and Activity when you need them.",
        "CLI \u4e0e\u6d3b\u52a8\u8be6\u60c5\u4ecd\u7136\u5728\u4e0b\u65b9\uff0c\u9700\u8981\u65f6\u53ef\u4ee5\u968f\u65f6\u5207\u6362\u3002",
      )
      : inlineText(
        "Stay in the conversation by default, then open CLI only when you need deeper execution detail.",
        "\u9ed8\u8ba4\u4ee5\u5bf9\u8bdd\u4e3a\u4e3b\uff0c\u9700\u8981\u66f4\u6df1\u6267\u884c\u7ec6\u8282\u65f6\u518d\u6253\u5f00 CLI\u3002",
      ),
    source: inlineText("Desktop", "\u684c\u9762\u7aef"),
    signal: msg("terminal.project.status.ready", "Ready"),
  };
}

const projectRuntimeRules: ProjectRuntimeRulesApi = {
  getLatestActivity: runtimeRulesGetLatestActivity,
  getLatestCliEntry: runtimeRulesGetLatestCliEntry,
  getLatestMessage: runtimeRulesGetLatestMessage,
  buildProjectStatusMeta,
  buildProjectLatestPreview,
  buildOverviewState: runtimeRulesBuildOverviewState,
};

(globalThis as typeof globalThis & { projectRuntimeRules: ProjectRuntimeRulesApi }).projectRuntimeRules = projectRuntimeRules;

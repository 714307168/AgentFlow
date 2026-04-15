const test = require("node:test");
const assert = require("node:assert/strict");

function formatTemplate(template, vars) {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_match, key) => vars[key] ?? "");
}

function loadRules() {
  const modulePath = require.resolve("../dist/renderer/project-runtime-rules.js");
  delete require.cache[modulePath];
  delete globalThis.projectRuntimeRules;
  require(modulePath);
  return globalThis.projectRuntimeRules;
}

function createHelpers() {
  return {
    inlineText: (en) => en,
    msg: (_key, fallback, vars) => formatTemplate(fallback, vars),
    providerLabel: (provider) => (provider === "codex" ? "OpenAI Codex" : "Claude Code"),
    modelLabel: (model) => model || "Auto",
    translateSource: (source) => source,
    translateKind: (kind) => kind,
    translateCliStream: (stream) => stream,
    translateActivityStatus: (status) => status,
    previewText: (value, maxLength = 160) => {
      const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
      if (!normalized) {
        return "";
      }
      return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
    },
  };
}

function createProject(overrides = {}) {
  return {
    id: "project-1",
    name: "Project 1",
    path: "D:/repo/project-1",
    cliProvider: "claude",
    cliModel: "sonnet",
    isRemote: false,
    online: true,
    ...overrides,
  };
}

function createSession(overrides = {}) {
  return {
    projectId: "project-1",
    provider: "claude",
    model: "sonnet",
    automationMode: "full-auto",
    isRunning: false,
    queuedCount: 0,
    currentSource: null,
    currentPrompt: null,
    currentStartedAt: null,
    activeConversationId: "conv-1",
    conversations: [],
    messageTotal: 0,
    activityTotal: 0,
    cliTraceTotal: 0,
    queue: [],
    cliTrace: [],
    messages: [],
    activities: [],
    ...overrides,
  };
}

test("buildProjectStatusMeta prefers private running state over queue and ready markers", () => {
  const rules = loadRules();
  const meta = rules.buildProjectStatusMeta({
    project: createProject(),
    session: createSession({
      isRunning: true,
      currentSource: "desktop",
      currentPrompt: "ship the release",
      queue: [{ runId: "q1", prompt: "queued", source: "desktop", queuedAt: 1 }],
      queuedCount: 1,
      messages: [{ id: "m1", role: "assistant", content: "done", source: "desktop", createdAt: 1, updatedAt: 1, status: "done" }],
    }),
    ...createHelpers(),
  });

  assert.equal(meta.label, "Running");
  assert.equal(meta.tone, "running");
  assert.match(meta.detail, /Claude Code/);
  assert.match(meta.detail, /desktop/);
});

test("buildProjectStatusMeta ignores workgroup-only queue items when deciding queued state", () => {
  const rules = loadRules();
  const meta = rules.buildProjectStatusMeta({
    project: createProject(),
    session: createSession({
      queue: [{ runId: "q1", prompt: "workgroup queued", source: "workgroup", queuedAt: 1 }],
      queuedCount: 1,
      messages: [{ id: "m1", role: "assistant", content: "ready for next", source: "desktop", createdAt: 1, updatedAt: 1, status: "done" }],
    }),
    ...createHelpers(),
  });

  assert.equal(meta.label, "Ready");
  assert.equal(meta.tone, "ready");
});

test("buildProjectLatestPreview prefers current prompt and falls back to status detail when empty", () => {
  const rules = loadRules();
  const helpers = createHelpers();
  const preview = rules.buildProjectLatestPreview({
    project: createProject(),
    session: createSession({
      isRunning: true,
      currentSource: "desktop",
      currentPrompt: "please summarize the latest production incident and recovery plan",
    }),
    ...helpers,
    maxLength: 32,
  });
  const fallback = rules.buildProjectLatestPreview({
    project: createProject({ isRemote: true, online: false }),
    session: null,
    ...helpers,
    maxLength: 32,
  });

  assert.match(preview, /please summarize/);
  assert.match(fallback, /Remote desktop is offline/);
});

test("buildOverviewState uses the first visible queue item and skips workgroup noise", () => {
  const rules = loadRules();
  const overview = rules.buildOverviewState({
    project: createProject(),
    session: createSession({
      queue: [
        { runId: "w1", prompt: "workgroup item", source: "workgroup", queuedAt: 1 },
        { runId: "d1", prompt: "desktop item", source: "desktop", queuedAt: 2 },
      ],
      queuedCount: 2,
    }),
    provider: "claude",
    ...createHelpers(),
  });

  assert.equal(overview.tone, "queued");
  assert.equal(overview.title, "desktop item");
  assert.equal(overview.source, "desktop");
});

test("buildOverviewState surfaces the latest assistant reply for idle sessions", () => {
  const rules = loadRules();
  const overview = rules.buildOverviewState({
    project: createProject({ cliProvider: "codex" }),
    session: createSession({
      provider: "codex",
      messages: [
        { id: "m1", role: "user", content: "inspect", source: "desktop", createdAt: 1, updatedAt: 1, status: "done" },
        { id: "m2", role: "assistant", content: "latest reply body", source: "desktop", provider: "codex", createdAt: 2, updatedAt: 2, status: "done" },
      ],
    }),
    provider: "codex",
    ...createHelpers(),
  });

  assert.equal(overview.tone, "ready");
  assert.equal(overview.kicker, "Latest reply");
  assert.equal(overview.source, "OpenAI Codex");
  assert.equal(overview.signal, "Ready");
});

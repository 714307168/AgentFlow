const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const testUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-codex-command-test-"));
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        getPath(name) {
          if (name === "userData") {
            return testUserDataPath;
          }
          return testUserDataPath;
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const RuntimeManager = require("../dist/src/runtime-manager.js").default;
const {
  buildCodexCompletionArgs,
  buildCodexFeaturesArgs,
  buildCodexExecArgs,
  buildCodexMcpArgs,
  buildCodexReviewArgs,
  buildCodexVersionArgs,
} = require("../dist/src/codex-command-support.js");

function createRuntimeManager(options = {}) {
  const updateCalls = [];
  const runtimeManager = new RuntimeManager(() => ({
    getProjectProvider: () => options.provider || "codex",
    getProjectModel: () => options.model || null,
    getProjectCodexWebSearchEnabled: () => options.codexWebSearchEnabled === true,
    resolveProviderRuntime: options.resolveProviderRuntime,
    getProviderSdkConfig: options.getProviderSdkConfig,
    updateProject: (_projectId, updates) => {
      updateCalls.push(updates);
    },
    onProjectConfigChanged: () => {
      options.onProjectConfigChangedCalled = true;
    },
  }));
  return { runtimeManager, updateCalls };
}

function createPreparedRun(prompt) {
  return {
    projectId: "project-codex",
    cwd: process.cwd(),
    prompt,
    source: "desktop",
    queuedAt: Date.now(),
    runId: `run-${prompt}`,
  };
}

function createRunContext() {
  return {
    runId: "context-run",
    runStatusActivityId: null,
    assistantMessageId: null,
    thinkingActivityId: null,
    activityIdsByKey: new Map(),
  };
}

test("buildCodexExecArgs omits search when resuming because codex exec resume does not support it", () => {
  const args = buildCodexExecArgs({
    canResumeConversation: true,
    codexThreadId: "thread-123",
    model: "gpt-5.4",
    searchEnabled: true,
  });

  assert.deepEqual(args, [
    "exec",
    "resume",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--enable",
    "code_mode_only",
    "--disable",
    "tool_suggest",
    "--disable",
    "tool_call_mcp_elicitation",
    "--model",
    "gpt-5.4",
    "thread-123",
  ]);
});

test("buildCodexExecArgs enables search for fresh exec runs", () => {
  const args = buildCodexExecArgs({
    canResumeConversation: false,
    codexThreadId: "thread-123",
    model: "gpt-5.4",
    searchEnabled: true,
  });

  assert.deepEqual(args, [
    "exec",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--enable",
    "code_mode_only",
    "--disable",
    "tool_suggest",
    "--disable",
    "tool_call_mcp_elicitation",
    "--model",
    "gpt-5.4",
    "--search",
  ]);
});

test("buildCodexExecArgs drops unsupported resume and search flags when the local CLI lacks them", () => {
  const args = buildCodexExecArgs({
    canResumeConversation: true,
    codexThreadId: "thread-123",
    model: "gpt-5.4",
    searchEnabled: true,
    capabilities: {
      resumeConversation: false,
      webSearch: false,
    },
  });

  assert.deepEqual(args, [
    "exec",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--enable",
    "code_mode_only",
    "--disable",
    "tool_suggest",
    "--disable",
    "tool_call_mcp_elicitation",
    "--model",
    "gpt-5.4",
  ]);
});

test("buildCodexReviewArgs defaults to uncommitted review and preserves quoted title", () => {
  const result = buildCodexReviewArgs('--title "Quick pass" focus on regressions', "gpt-5.4");

  assert.deepEqual(result, {
    args: [
      "review",
      "-c",
      'model="gpt-5.4"',
      "--enable",
      "code_mode_only",
      "--disable",
      "tool_suggest",
      "--disable",
      "tool_call_mcp_elicitation",
      "--title",
      "Quick pass",
      "--uncommitted",
      "focus on regressions",
    ],
  });
});

test("buildCodexReviewArgs rejects mutually exclusive base and commit scopes", () => {
  const result = buildCodexReviewArgs("--base main --commit abc123", null);

  assert.equal(result.args, null);
  assert.equal(result.errorMessage, "Use either --base <branch> or --commit <sha>, not both.");
});

test("buildCodexFeaturesArgs accepts list and rejects unknown subcommands", () => {
  assert.deepEqual(buildCodexFeaturesArgs("list", "gpt-5.4"), {
    args: [
      "features",
      "-c",
      'model="gpt-5.4"',
      "--enable",
      "code_mode_only",
      "--disable",
      "tool_suggest",
      "--disable",
      "tool_call_mcp_elicitation",
      "list",
    ],
  });

  assert.deepEqual(buildCodexFeaturesArgs("enable apps", null), {
    args: null,
    errorMessage: "Usage: /features [list]",
  });
});

test("buildCodexVersionArgs returns the root version command", () => {
  assert.deepEqual(buildCodexVersionArgs(), {
    args: ["--version"],
  });
});

test("buildCodexCompletionArgs uses powershell by default on Windows and validates explicit shells", () => {
  assert.deepEqual(buildCodexCompletionArgs(""), {
    args: ["completion", "powershell"],
  });

  assert.deepEqual(buildCodexCompletionArgs("zsh"), {
    args: ["completion", "zsh"],
  });

  assert.deepEqual(buildCodexCompletionArgs("cmd"), {
    args: null,
    errorMessage: "Usage: /completion [bash|elvish|fish|powershell|zsh]",
  });
});

test("buildCodexMcpArgs supports list and get in text or json mode", () => {
  assert.deepEqual(buildCodexMcpArgs(""), {
    args: ["mcp", "list"],
  });

  assert.deepEqual(buildCodexMcpArgs("list json"), {
    args: ["mcp", "list", "--json"],
  });

  assert.deepEqual(buildCodexMcpArgs("get repo-tools --json"), {
    args: ["mcp", "get", "repo-tools", "--json"],
  });

  assert.deepEqual(buildCodexMcpArgs("remove repo-tools"), {
    args: null,
    errorMessage: "Usage: /mcp list [json] | /mcp get <name> [json]",
  });
});

test("RuntimeManager handles /search locally for Codex projects", async () => {
  const { runtimeManager, updateCalls } = createRuntimeManager({
    provider: "codex",
    codexWebSearchEnabled: false,
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/search on"),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, true);
  assert.deepEqual(updateCalls, [{ codexWebSearchEnabled: true }]);

  const snapshot = runtimeManager.getSnapshot("project-codex");
  assert.equal(snapshot.messages.at(-1)?.content.includes("Codex web search is enabled"), true);
  assert.equal(snapshot.messages.at(-1)?.content.includes("`--search` flag"), true);

  runtimeManager.dispose();
});

test("RuntimeManager /tools reports current Codex support and search status", async () => {
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
    model: "gpt-5.4",
    codexWebSearchEnabled: true,
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/tools"),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, true);
  const message = runtimeManager.getSnapshot("project-codex").messages.at(-1)?.content || "";
  assert.equal(message.includes("codex exec --json"), true);
  assert.equal(message.includes("built-in agent tools"), true);
  assert.equal(message.includes("command execution"), true);
  assert.equal(message.includes("Web search tool: enabled"), true);
  assert.equal(message.includes("/mcp list|get"), true);
  assert.equal(message.includes("Not exposed in this app"), true);

  runtimeManager.dispose();
});

test("RuntimeManager blocks CLI-only Codex slash commands when the runtime falls back to the API", async () => {
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
    resolveProviderRuntime: async () => ({
      provider: "codex",
      kind: "sdk",
      detail: "CLI is unavailable, so the desktop will fall back to the configured API runtime.",
      sdkConfigured: true,
      cliStatus: null,
      capabilities: {
        promptExecution: true,
        resumeConversation: false,
        webSearch: false,
        reviewCommand: false,
        featuresCommand: false,
        mcpCommand: false,
        completionCommand: false,
        versionCommand: false,
        nativeTools: false,
      },
    }),
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/review focus on regressions"),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, true);
  const message = runtimeManager.getSnapshot("project-codex").messages.at(-1)?.content || "";
  assert.equal(message.includes("requires a compatible local Codex CLI"), true);
  assert.equal(message.includes("fall back to the configured API runtime"), true);

  runtimeManager.dispose();
});

test("RuntimeManager prepares /review for Codex custom execution", async () => {
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
    model: "gpt-5.4",
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun('/review --title "Quick pass" focus on bugs'),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, false);
  assert.equal(typeof prepared.customExecutor, "function");
  assert.equal(prepared.completionDetail, "Completed Codex review.");

  runtimeManager.dispose();
});

test("RuntimeManager /features usage errors are handled locally", async () => {
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/features enable apps"),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, true);
  const message = runtimeManager.getSnapshot("project-codex").messages.at(-1)?.content || "";
  assert.equal(message, "Usage: /features [list]");

  runtimeManager.dispose();
});

test("RuntimeManager prepares /version for Codex custom execution", async () => {
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/version"),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, false);
  assert.equal(typeof prepared.customExecutor, "function");
  assert.equal(prepared.completionDetail, "Displayed Codex CLI version.");

  runtimeManager.dispose();
});

test("RuntimeManager /completion usage errors are handled locally", async () => {
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/completion cmd"),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, true);
  const message = runtimeManager.getSnapshot("project-codex").messages.at(-1)?.content || "";
  assert.equal(message, "Usage: /completion [bash|elvish|fish|powershell|zsh]");

  runtimeManager.dispose();
});

test("RuntimeManager prepares /mcp get for Codex custom execution", async () => {
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/mcp get repo-tools json"),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, false);
  assert.equal(typeof prepared.customExecutor, "function");
  assert.equal(prepared.completionDetail, "Displayed Codex MCP configuration.");

  runtimeManager.dispose();
});

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
        setPath() {},
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
  buildCodexGoalPrompt,
  buildCodexMcpArgs,
  buildCodexPlanPrompt,
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
    generateProjectImageAsset: options.generateProjectImageAsset,
    updateProject: (_projectId, updates) => {
      updateCalls.push(updates);
      if (Object.prototype.hasOwnProperty.call(updates, "cliModel")) {
        options.model = updates.cliModel;
      }
      if (Object.prototype.hasOwnProperty.call(updates, "codexWebSearchEnabled")) {
        options.codexWebSearchEnabled = updates.codexWebSearchEnabled === true;
      }
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

test("buildCodexExecArgs passes Codex reasoning effort through config override", () => {
  const args = buildCodexExecArgs({
    canResumeConversation: false,
    codexThreadId: null,
    model: "gpt-5.4",
    reasoningEffort: "high",
    searchEnabled: false,
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
    "-c",
    "model_reasoning_effort=\"high\"",
  ]);
});

test("buildCodexExecArgs preserves reasoning effort when resuming a thread", () => {
  const args = buildCodexExecArgs({
    canResumeConversation: true,
    codexThreadId: "thread-123",
    model: null,
    reasoningEffort: "low",
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
    "-c",
    "model_reasoning_effort=\"low\"",
    "thread-123",
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

test("buildCodexPlanPrompt creates a no-edit planning instruction", () => {
  const prompt = buildCodexPlanPrompt("redesign the settings page");

  assert.equal(prompt.includes("Codex plan mode"), true);
  assert.equal(prompt.includes("Do not modify files"), true);
  assert.equal(prompt.includes("verification steps"), true);
  assert.equal(prompt.includes("Request: redesign the settings page"), true);
});

test("buildCodexGoalPrompt creates a target-driven execution instruction", () => {
  const prompt = buildCodexGoalPrompt("fix Linux package startup");

  assert.equal(prompt.includes("Codex goal mode"), true);
  assert.equal(prompt.includes("concrete outcome"), true);
  assert.equal(prompt.includes("Run the relevant tests"), true);
  assert.equal(prompt.includes("Objective: fix Linux package startup"), true);
  assert.equal(buildCodexGoalPrompt("   "), "");
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

test("RuntimeManager hands off capped context when switching to a model without a saved session", async () => {
  const { runtimeManager, updateCalls } = createRuntimeManager({
    provider: "codex",
    model: "gpt-a",
  });
  const state = runtimeManager.ensureState("project-codex");
  const now = Date.now();

  state.codexThreadId = "thread-gpt-a";
  state.messages.push(
    {
      id: "handoff-user",
      role: "user",
      content: "We need the Android sync list sorted by real latest chat time.",
      source: "desktop",
      createdAt: now,
      updatedAt: now,
      status: "done",
    },
    {
      id: "handoff-assistant",
      role: "assistant",
      content: "I fixed the status cache but still need to verify message ordering.",
      source: "desktop",
      createdAt: now + 1,
      updatedAt: now + 1,
      status: "done",
    },
  );

  const preparedSwitch = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/model gpt-b"),
    createRunContext(),
  );

  assert.equal(preparedSwitch.handledLocally, true);
  assert.deepEqual(updateCalls, [{ cliModel: "gpt-b" }]);
  assert.equal(state.model, "gpt-b");
  assert.equal(state.codexThreadId, null);
  assert.match(state.pendingModelSwitchContext, /Context handoff for model switch/);
  assert.match(state.pendingModelSwitchContext, /Previous model: gpt-a/);
  assert.match(state.pendingModelSwitchContext, /New model: gpt-b/);
  assert.match(state.pendingModelSwitchContext, /Android sync list/);

  const preparedPrompt = await runtimeManager.prepareRun(
    state,
    createPreparedRun("continue implementation"),
    createRunContext(),
  );
  const prompt = runtimeManager.buildPromptWithAttachments(preparedPrompt.run);

  assert.equal(preparedPrompt.handledLocally, false);
  assert.match(prompt, /Context handoff for model switch/);
  assert.match(prompt, /continue implementation$/);
  assert.equal(state.pendingModelSwitchContext, null);

  runtimeManager.dispose();
});

test("RuntimeManager backfills legacy session refs for the current model", () => {
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
    model: "gpt-a",
  });
  const state = runtimeManager.ensureState("project-codex");
  const conversation = state.conversations[0];

  state.codexThreadId = null;
  conversation.codexThreadId = "legacy-thread";
  conversation.modelSessionRefs = {};

  assert.equal(runtimeManager.restoreModelSessionRefsForState(state, conversation), true);
  assert.equal(state.codexThreadId, "legacy-thread");
  assert.equal(conversation.modelSessionRefs["codex:gpt-a"].codexThreadId, "legacy-thread");

  runtimeManager.dispose();
});

test("RuntimeManager prepares /plan as a Codex prompt-mode run", async () => {
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/plan improve project sync"),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, false);
  assert.equal(prepared.run.prompt.includes("Codex plan mode"), true);
  assert.equal(prepared.run.prompt.includes("Do not modify files"), true);
  assert.equal(prepared.run.prompt.includes("Request: improve project sync"), true);

  runtimeManager.dispose();
});

test("RuntimeManager prepares /goal and /target as target-driven Codex runs", async () => {
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
  });
  const state = runtimeManager.ensureState("project-codex");

  const goalRun = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/goal fix update restart"),
    createRunContext(),
  );
  const targetRun = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/target ship Linux icon fix"),
    createRunContext(),
  );

  assert.equal(goalRun.handledLocally, false);
  assert.equal(goalRun.run.prompt.includes("Codex goal mode"), true);
  assert.equal(goalRun.run.prompt.includes("Objective: fix update restart"), true);
  assert.equal(targetRun.handledLocally, false);
  assert.equal(targetRun.run.prompt.includes("Objective: ship Linux icon fix"), true);

  runtimeManager.dispose();
});

test("RuntimeManager shows usage for empty /goal", async () => {
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/goal"),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, true);
  assert.equal(runtimeManager.getSnapshot("project-codex").messages.at(-1)?.content, "Usage: /goal <objective>");

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
  assert.equal(message.includes("/image <prompt>"), true);
  assert.equal(message.includes("/plan [request]"), true);
  assert.equal(message.includes("/goal <objective>"), true);
  assert.equal(message.includes("generated-assets"), true);
  assert.equal(message.includes("/mcp list|get"), true);
  assert.equal(message.includes("Not exposed in this app"), true);

  runtimeManager.dispose();
});

test("RuntimeManager handles /image locally for Codex projects with image generation configured", async () => {
  const calls = [];
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
    model: "gpt-image-1",
    generateProjectImageAsset: async (input) => {
      calls.push(input);
      return {
        attachment: {
          id: "generated-image",
          name: "hero-banner.png",
          path: path.join(process.cwd(), "generated-assets", "hero-banner.png"),
          size: 128,
          kind: "image",
          mimeType: "image/png",
        },
        savedPath: path.join(process.cwd(), "generated-assets", "hero-banner.png"),
        model: "gpt-image-1",
        revisedPrompt: "A polished hero banner",
      };
    },
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/image create a polished hero banner"),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, true);
  assert.deepEqual(calls, [{
    projectId: "project-codex",
    cwd: process.cwd(),
    provider: "codex",
    model: "gpt-image-1",
    prompt: "create a polished hero banner",
  }]);

  const message = runtimeManager.getSnapshot("project-codex").messages.at(-1);
  assert.equal(message?.content.includes("Generated image asset: hero-banner.png"), true);
  assert.equal(message?.content.includes("Saved to: generated-assets/hero-banner.png"), true);
  assert.equal(message?.content.includes("Model: gpt-image-1"), true);
  assert.equal(message?.content.includes("Revised prompt: A polished hero banner"), true);
  assert.equal(message?.attachments?.[0]?.name, "hero-banner.png");

  runtimeManager.dispose();
});

test("RuntimeManager /image shows usage when no prompt is provided", async () => {
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/image"),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, true);
  assert.equal(runtimeManager.getSnapshot("project-codex").messages.at(-1)?.content, "Usage: /image <prompt>");

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

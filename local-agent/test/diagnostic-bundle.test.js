const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildDiagnosticBundleArtifacts,
  createDiagnosticProjectSummary,
  writeDiagnosticBundle,
} = require("../dist/src/diagnostic-bundle.js");

function createSnapshot(overrides = {}) {
  return {
    projectId: "project-1",
    provider: "claude",
    model: "sonnet",
    automationMode: "full-auto",
    projectSignature: "sig-1",
    syncBucket: "hot",
    isRunning: true,
    queuedCount: 1,
    currentSource: "desktop",
    currentPrompt: "ship it",
    currentStartedAt: 1700000004000,
    activeConversationId: "conv-1",
    conversations: [
      {
        id: "conv-1",
        title: "Release prep",
        createdAt: 1700000001000,
        updatedAt: 1700000007000,
        isActive: true,
        messageCount: 2,
        activityCount: 1,
        cliCount: 1,
      },
    ],
    messageTotal: 2,
    activityTotal: 1,
    cliTraceTotal: 1,
    queue: [
      {
        runId: "run-queued",
        prompt: "queued prompt",
        source: "desktop",
        queuedAt: 1700000003000,
      },
    ],
    messages: [
      {
        id: "m1",
        role: "user",
        content: "please summarize the current release blockers",
        source: "desktop",
        createdAt: 1700000001000,
        updatedAt: 1700000001000,
        status: "done",
      },
      {
        id: "m2",
        role: "assistant",
        content: "working on it",
        source: "desktop",
        createdAt: 1700000002000,
        updatedAt: 1700000006000,
        status: "streaming",
      },
    ],
    activities: [
      {
        id: "a1",
        kind: "command",
        title: "npm test",
        detail: "running local verification",
        status: "running",
        createdAt: 1700000002500,
        updatedAt: 1700000006500,
      },
    ],
    cliTrace: [
      {
        id: "c1",
        stream: "stdout",
        text: "test output",
        createdAt: 1700000005000,
      },
    ],
    sessionRefs: {
      claudeSessionId: "claude-session",
      codexThreadId: null,
    },
    ...overrides,
  };
}

test("createDiagnosticProjectSummary builds a bounded recent activity window", () => {
  const summary = createDiagnosticProjectSummary({
    id: "project-1",
    name: "Desktop Project",
    path: "/tmp/project-1",
    agentId: "agent-1",
    cliProvider: "claude",
    cliModel: "sonnet",
    codexWebSearchEnabled: false,
    projectPrompt: "repo guidance",
    groupName: "Default",
    createdAt: 1700000000000,
  }, createSnapshot(), "local", { recentLimit: 3 });

  assert.equal(summary.id, "project-1");
  assert.equal(summary.projectPromptConfigured, true);
  assert.equal(summary.recentActivityWindow.length, 3);
  assert.deepEqual(
    summary.recentActivityWindow.map((entry) => entry.type),
    ["activity", "message", "cli"],
  );
});

test("buildDiagnosticBundleArtifacts groups local and remote projects and preserves log payload", () => {
  const artifacts = buildDiagnosticBundleArtifacts({
    generatedAt: "2026-04-15T08:00:00.000Z",
    appVersion: "1.1.133",
    host: {
      hostname: "desktop",
      platform: "win32",
      release: "10.0",
      arch: "x64",
    },
    config: {
      serverUrl: "https://relay.example.com",
      agentId: "agent-1",
      username: "owner",
      controllerDeviceId: "device-1",
      cliProvider: "claude",
      tokenConfigured: true,
      controllerTokenConfigured: true,
      openaiConfigured: false,
      anthropicConfigured: true,
      githubTokenConfigured: true,
    },
    settings: {
      autoStart: false,
      silentLaunch: true,
      completionSound: true,
      saveLogs: true,
      e2eEnabled: true,
      autoUpdateCheck: true,
      autoUpdateDownload: true,
      silentUpdateInstall: false,
      historyRetentionDays: 30,
    },
    connection: {
      agent: { state: "connected" },
      controller: { state: "connected" },
    },
    relayApi: {
      requestedVersion: "1",
      clientVersion: "1.1.133",
      health: null,
    },
    localData: {
      localDataRoot: "C:/data",
      logDirectory: "C:/data/logs",
      attachments: { fileCount: 1, totalBytes: 128 },
      updates: { fileCount: 0, totalBytes: 0 },
      history: { fileCount: 2, totalBytes: 256 },
      logs: { fileCount: 1, totalBytes: 512 },
    },
    providerRuntime: {
      claude: {
        provider: "claude",
        command: "claude",
        installed: true,
        version: "1.0.0",
        detail: "ok",
        checkedAt: 1,
        resolvedPath: "/usr/bin/claude",
        installMethod: "npm",
        capabilities: {
          promptExecution: true,
          resumeConversation: true,
          webSearch: false,
          reviewCommand: false,
          featuresCommand: false,
          mcpCommand: false,
          completionCommand: false,
          versionCommand: true,
          nativeTools: true,
        },
        upgrade: {
          available: false,
          required: false,
          installMethod: "npm",
          command: null,
          commandPreview: null,
          reason: null,
          latestVersion: null,
        },
      },
    },
    localProjects: [{
      project: {
        id: "project-1",
        name: "Desktop Project",
        path: "/tmp/project-1",
        agentId: "agent-1",
        cliProvider: "claude",
        cliModel: "sonnet",
        codexWebSearchEnabled: false,
        projectPrompt: "repo guidance",
        groupName: "Default",
        createdAt: 1700000000000,
      },
      snapshot: createSnapshot(),
    }],
    remoteProjects: [{
      project: {
        id: "remote:1",
        name: "Remote Project",
        path: "/remote/project",
        agentId: "agent-remote",
        cliProvider: "codex",
        cliModel: "gpt-5",
        codexWebSearchEnabled: true,
        projectPrompt: null,
        groupName: "Remote",
        isRemote: true,
        online: true,
      },
      snapshot: createSnapshot({
        projectId: "remote:1",
        provider: "codex",
        syncBucket: "warm",
        queuedCount: 0,
        isRunning: false,
      }),
    }],
    desktopLogFileName: "desktop.log",
    desktopLogContent: "line 1\nline 2",
  });

  assert.equal(artifacts.manifest.summary.localProjectCount, 1);
  assert.equal(artifacts.manifest.summary.remoteProjectCount, 1);
  assert.equal(artifacts.desktopLogFileName, "desktop.log");
  assert.match(artifacts.desktopLogContent, /line 1/);
});

test("writeDiagnosticBundle writes manifest and optional log files", async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "diagnostic-bundle-"));
  const result = await writeDiagnosticBundle(outputRoot, {
    manifest: {
      schemaVersion: 1,
      generatedAt: "2026-04-15T08:00:00.000Z",
      appVersion: "1.1.133",
      host: { hostname: "desktop", platform: "win32", release: "10.0", arch: "x64" },
      config: {
        serverUrl: "",
        agentId: "",
        username: "",
        controllerDeviceId: "",
        cliProvider: "claude",
        tokenConfigured: false,
        controllerTokenConfigured: false,
        openaiConfigured: false,
        anthropicConfigured: false,
        githubTokenConfigured: false,
      },
      settings: {
        autoStart: false,
        silentLaunch: false,
        completionSound: true,
        saveLogs: true,
        e2eEnabled: true,
        autoUpdateCheck: true,
        autoUpdateDownload: false,
        silentUpdateInstall: false,
        historyRetentionDays: 30,
      },
      connection: {
        agent: {},
        controller: {},
      },
      relayApi: {
        requestedVersion: "1",
        clientVersion: "1.1.133",
        health: null,
      },
      localData: {
        localDataRoot: "",
        logDirectory: "",
        attachments: { fileCount: 0, totalBytes: 0 },
        updates: { fileCount: 0, totalBytes: 0 },
        history: { fileCount: 0, totalBytes: 0 },
        logs: { fileCount: 0, totalBytes: 0 },
      },
      providerRuntime: {},
      localProjects: [],
      remoteProjects: [],
      summary: {
        localProjectCount: 0,
        remoteProjectCount: 0,
        runningProjectCount: 0,
        queuedRunCount: 0,
      },
    },
    desktopLogFileName: "desktop.log",
    desktopLogContent: "hello world",
  }, new Date("2026-04-15T08:00:00.000Z"));

  assert.ok(fs.existsSync(result.manifestPath));
  assert.ok(result.logPath && fs.existsSync(result.logPath));
  assert.match(fs.readFileSync(result.manifestPath, "utf8"), /"schemaVersion": 1/);
  assert.match(fs.readFileSync(result.logPath, "utf8"), /hello world/);
});

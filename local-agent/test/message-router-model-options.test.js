const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const MessageRouter = require("../dist/src/message-router.js").default;
const { Events } = require("../dist/src/types.js");

class FakeRelayClient extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
  }

  send(payload) {
    this.sent.push(payload);
  }
}

function createSnapshot(projectId) {
  return {
    projectId,
    provider: "codex",
    model: "gpt-5.4",
    automationMode: "full-auto",
    projectSignature: null,
    syncBucket: null,
    isRunning: false,
    queuedCount: 0,
    currentSource: null,
    currentPrompt: null,
    currentStartedAt: null,
    activeConversationId: null,
    conversations: [],
    messageTotal: 0,
    activityTotal: 0,
    cliTraceTotal: 0,
    queue: [],
    cliTrace: [],
    messages: [],
    activities: [],
    sessionRefs: {
      claudeSessionId: null,
      codexThreadId: null,
    },
  };
}

test("message router returns remote model options through session sync", async () => {
  const relayClient = new FakeRelayClient();
  const runtimeManager = {
    getSnapshot(projectId) {
      return createSnapshot(projectId);
    },
    buildSyncDelta() {
      return {
        latestSeq: 0,
        truncated: false,
        items: [],
      };
    },
  };
  const router = new MessageRouter(relayClient, {
    runtimeManager,
    async listModelOptions(options) {
      assert.equal(options.force, true);
      return [
        {
          id: "remote-openai",
          name: "Remote OpenAI",
          protocol: "openai",
          defaultModel: "gpt-5.4",
          models: ["gpt-5.4"],
          configured: true,
        },
      ];
    },
  });

  router.handleEnvelope({
    id: "model-options-request-1",
    event: Events.SESSION_SYNC_REQUEST,
    project_id: "project-router-models",
    ts: Date.now(),
    payload: {
      action: "fetch_model_options",
      model_options_force: true,
      limit: 30,
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(relayClient.sent.length, 1);
  assert.equal(relayClient.sent[0].event, Events.SESSION_SYNC);
  assert.equal(relayClient.sent[0].payload.request_id, "model-options-request-1");
  assert.deepEqual(relayClient.sent[0].payload.model_options, [
    {
      id: "remote-openai",
      name: "Remote OpenAI",
      protocol: "openai",
      defaultModel: "gpt-5.4",
      models: ["gpt-5.4"],
      configured: true,
    },
  ]);
});

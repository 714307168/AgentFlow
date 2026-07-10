const test = require("node:test");
const assert = require("node:assert/strict");

const RemoteSessionStore = require("../dist/src/remote-session-store.js").default;
const { Events } = require("../dist/src/types.js");

function createStore() {
  const relayClient = {
    send() {},
  };
  return new RemoteSessionStore(relayClient, {
    localAgentId: () => "local-agent",
  });
}

function listRemoteProject(store) {
  store.handleEnvelope({
    id: "env-project-list",
    event: Events.PROJECT_LISTED,
    ts: Date.now(),
    payload: {
      agent_id: "remote-agent-1",
      projects: [
        {
          id: "remote-project-1",
          agent_id: "remote-agent-1",
          name: "Remote Project",
          path: "C:/remote/project",
          cli_provider: "claude",
        },
      ],
    },
  });
}

test("remote session store emits run-completed when a remote project transitions from running to idle", () => {
  const store = createStore();
  const completedEvents = [];

  listRemoteProject(store);
  store.on("run-completed", (payload) => {
    completedEvents.push(payload);
  });

  store.handleEnvelope({
    id: "env-running",
    event: Events.SESSION_SYNC,
    project_id: "remote-project-1",
    ts: Date.now(),
    payload: {
      snapshot_revision: "rev-running",
      provider: "claude",
      is_running: true,
      queued_count: 0,
      current_source: "remote",
      sync: {
        items: [],
        latest_seq: 0,
      },
    },
  });

  store.handleEnvelope({
    id: "env-completed",
    event: Events.SESSION_SYNC,
    project_id: "remote-project-1",
    ts: Date.now(),
    payload: {
      snapshot_revision: "rev-completed",
      provider: "claude",
      is_running: false,
      queued_count: 0,
      current_source: null,
      sync: {
        items: [],
        latest_seq: 0,
      },
    },
  });

  assert.deepEqual(completedEvents, [
    {
      projectId: "remote-project-1",
      source: "remote",
    },
  ]);
});

test("remote session store does not emit run-completed for idle-to-idle sync updates", () => {
  const store = createStore();
  let completedCount = 0;

  listRemoteProject(store);
  store.on("run-completed", () => {
    completedCount += 1;
  });

  store.handleEnvelope({
    id: "env-idle",
    event: Events.SESSION_SYNC,
    project_id: "remote-project-1",
    ts: Date.now(),
    payload: {
      snapshot_revision: "rev-idle",
      provider: "claude",
      is_running: false,
      queued_count: 0,
      sync: {
        items: [],
        latest_seq: 0,
      },
    },
  });

  assert.equal(completedCount, 0);
});

test("remote session store marks summary-only sync requests and skips known item digests", () => {
  const sentEvents = [];
  const relayClient = {
    send(event) {
      sentEvents.push(event);
    },
  };
  const store = new RemoteSessionStore(relayClient, {
    localAgentId: () => "local-agent",
  });

  listRemoteProject(store);
  store.requestSessionSync("remote-project-1", {
    limit: 30,
    summaryOnly: true,
  });

  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].event, Events.SESSION_SYNC_REQUEST);
  assert.equal(sentEvents[0].payload.summary_only, true);
  assert.equal(sentEvents[0].payload.known_items, undefined);
});

test("remote session store queues eligible session sync refreshes until the prior request is acknowledged", () => {
  const sentEvents = [];
  const relayClient = {
    send(event) {
      sentEvents.push(event);
    },
  };
  const store = new RemoteSessionStore(relayClient, {
    localAgentId: () => "local-agent",
  });

  listRemoteProject(store);
  store.requestSessionSync("remote-project-1", {
    afterSeq: 24,
    limit: 20,
    summaryOnly: true,
  });
  store.requestSessionSync("remote-project-1", {
    afterSeq: 12,
    limit: 40,
    summaryOnly: false,
    conversationId: "conv-1",
  });

  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].event, Events.SESSION_SYNC_REQUEST);
  assert.equal(sentEvents[0].payload.after_seq, 24);
  assert.equal(sentEvents[0].payload.summary_only, true);

  store.handleEnvelope({
    id: "env-sync-ack",
    event: Events.SESSION_SYNC,
    project_id: "remote-project-1",
    ts: Date.now(),
    payload: {
      request_id: sentEvents[0].id,
      snapshot_revision: "rev-1",
      provider: "claude",
      is_running: false,
      queued_count: 0,
      sync: {
        items: [],
        latest_seq: 24,
      },
    },
  });

  assert.equal(sentEvents.length, 2);
  assert.equal(sentEvents[1].event, Events.SESSION_SYNC_REQUEST);
  assert.equal(sentEvents[1].payload.after_seq, 12);
  assert.equal(sentEvents[1].payload.limit, 40);
  assert.equal(sentEvents[1].payload.summary_only, undefined);
  assert.equal(sentEvents[1].payload.conversation_id, "conv-1");
});

test("remote session store bypasses session sync backpressure for detail and action requests", () => {
  const sentEvents = [];
  const relayClient = {
    send(event) {
      sentEvents.push(event);
    },
  };
  const store = new RemoteSessionStore(relayClient, {
    localAgentId: () => "local-agent",
  });

  listRemoteProject(store);
  store.requestSessionSync("remote-project-1", {
    limit: 30,
    summaryOnly: true,
  });
  store.requestSessionSync("remote-project-1", {
    action: "fetch_item_detail",
    itemId: "msg-1",
  });

  assert.equal(sentEvents.length, 2);
  assert.equal(sentEvents[0].event, Events.SESSION_SYNC_REQUEST);
  assert.equal(sentEvents[1].event, Events.SESSION_SYNC_REQUEST);
  assert.equal(sentEvents[1].payload.action, "fetch_item_detail");
  assert.equal(sentEvents[1].payload.item_id, "msg-1");
});

test("remote session store fetches model options from the remote project owner", async () => {
  const sentEvents = [];
  const relayClient = {
    isConnected() {
      return true;
    },
    send(event) {
      sentEvents.push(event);
    },
  };
  const store = new RemoteSessionStore(relayClient, {
    localAgentId: () => "local-agent",
  });

  listRemoteProject(store);
  const promise = store.listModelOptions("remote-project-1", { force: true });

  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].event, Events.SESSION_SYNC_REQUEST);
  assert.equal(sentEvents[0].payload.action, "fetch_model_options");
  assert.equal(sentEvents[0].payload.model_options_force, true);

  store.handleEnvelope({
    id: "env-model-options",
    event: Events.SESSION_SYNC,
    project_id: "remote-project-1",
    ts: Date.now(),
    payload: {
      request_id: sentEvents[0].id,
      snapshot_revision: "rev-model-options",
      provider: "codex",
      model_options: [
        {
          id: "remote-openai",
          name: "Remote OpenAI",
          protocol: "openai",
          defaultModel: "gpt-5.4",
          models: ["gpt-5.4", "gpt-5.4-mini"],
          configured: true,
        },
      ],
      sync: {
        items: [],
        latest_seq: 0,
      },
    },
  });

  assert.deepEqual(await promise, [
    {
      id: "remote-openai",
      name: "Remote OpenAI",
      protocol: "openai",
      defaultModel: "gpt-5.4",
      models: ["gpt-5.4", "gpt-5.4-mini"],
      configured: true,
      error: undefined,
    },
  ]);
});

test("remote session store keeps workgroup-dispatched prompts out of private project snapshots", async () => {
  const sentEvents = [];
  const relayClient = {
    isConnected() {
      return true;
    },
    send(event) {
      sentEvents.push(event);
    },
  };
  const store = new RemoteSessionStore(relayClient, {
    localAgentId: () => "local-agent",
  });

  listRemoteProject(store);
  const result = await store.sendPrompt(
    "remote-project-1",
    "hidden workgroup dispatch",
    undefined,
    { source: "workgroup" },
  );

  assert.equal(result.success, true);
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].event, Events.MESSAGE_SEND);
  assert.equal(sentEvents[0].payload.source, "workgroup");

  const snapshot = store.getSnapshot("remote-project-1");
  assert.ok(snapshot);
  assert.equal(snapshot.messageTotal, 0);
  assert.deepEqual(snapshot.messages, []);
});

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

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const MessageRouter = require("../dist/src/message-router.js").default;
const projectStore = require("../dist/src/project-store.js").default;
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

function createProject(id) {
  return {
    id,
    name: "Project " + id,
    path: process.cwd(),
    agentId: "agent-local",
    cliProvider: "claude",
    cliModel: null,
    codexWebSearchEnabled: false,
    groupName: null,
    projectPrompt: null,
    createdAt: Date.now(),
  };
}

test("message router preserves workgroup source for hidden project dispatches", () => {
  const relayClient = new FakeRelayClient();
  const enqueued = [];
  const runtimeManager = {
    getSnapshot() {
      return {
        queue: [],
        messages: [],
      };
    },
    enqueueMessage(options) {
      enqueued.push(options);
    },
  };

  const originalGetById = projectStore.getById.bind(projectStore);
  const originalGetAll = projectStore.getAll.bind(projectStore);
  const fakeProject = createProject("project-router-workgroup");
  projectStore.getById = (id) => (id === fakeProject.id ? fakeProject : undefined);
  projectStore.getAll = () => [fakeProject];

  try {
    const router = new MessageRouter(relayClient, { runtimeManager });
    router.handleEnvelope({
      id: "env-workgroup-message",
      event: Events.MESSAGE_SEND,
      project_id: fakeProject.id,
      stream_id: "client-1:assistant",
      ts: Date.now(),
      payload: {
        client_message_id: "client-1",
        content: "workgroup dispatched prompt",
        source: "workgroup",
      },
    });

    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].projectId, fakeProject.id);
    assert.equal(enqueued[0].source, "workgroup");
    assert.equal(relayClient.sent.some((entry) => entry.event === Events.MESSAGE_ACCEPTED), true);
  } finally {
    projectStore.getById = originalGetById;
    projectStore.getAll = originalGetAll;
  }
});

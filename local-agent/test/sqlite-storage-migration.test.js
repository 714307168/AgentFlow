const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

function withMockedElectronUserData(userDataPath, fn, options = {}) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: {
          getPath() {
            return userDataPath;
          },
          setPath() {},
        },
      };
    }
    if (request === "electron-store" && options.legacyWorkgroupSessions) {
      return class FakeStore {
        get(key, fallbackValue) {
          if (key === "sessions") {
            return options.legacyWorkgroupSessions;
          }
          return fallbackValue;
        }

        set() {}
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return fn();
  } finally {
    Module._load = originalLoad;
  }
}

function clearModules() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(path.sep + "dist" + path.sep + "src" + path.sep + "session-history-store.js") ||
      key.includes(path.sep + "dist" + path.sep + "src" + path.sep + "workgroup-collaboration-store.js") ||
      key.includes(path.sep + "dist" + path.sep + "src" + path.sep + "desktop-sqlite-store.js")
    ) {
      delete require.cache[key];
    }
  }
}

test("session history store imports legacy JSON project files into SQLite", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-sqlite-history-"));
  const historyDir = path.join(userDataPath, "runtime-history");
  fs.mkdirSync(historyDir, { recursive: true });
  fs.writeFileSync(
    path.join(historyDir, encodeURIComponent("project-a") + ".json"),
    JSON.stringify({
      latestSeq: 1,
      activeConversationId: "conversation-a",
      conversations: [
        {
          id: "conversation-a",
          createdAt: 1,
          updatedAt: 2,
          messages: [
            {
              id: "message-a",
              role: "assistant",
              content: "hello from json",
              source: "desktop",
              createdAt: 1,
              updatedAt: 2,
              status: "done",
              syncSeq: 1,
            },
          ],
          activities: [],
          cliTrace: [],
          claudeSessionId: null,
          codexThreadId: null,
        },
      ],
    }),
    "utf8",
  );

  withMockedElectronUserData(userDataPath, () => {
    clearModules();
    const SessionHistoryStore = require("../dist/src/session-history-store.js").default;
    const store = new SessionHistoryStore();

    assert.deepEqual(store.listProjectIds(), ["project-a"]);
    assert.equal(store.getProjectState("project-a").conversations[0].messages[0].content, "hello from json");

    store.upsertMessage("project-a", "conversation-a", {
      id: "message-b",
      role: "user",
      content: "stored in sqlite",
      source: "desktop",
      createdAt: 3,
      updatedAt: 3,
      status: "done",
    });
    store.flushAll();

    const sqlitePath = path.join(userDataPath, "agentflow-state.sqlite");
    assert.equal(fs.existsSync(sqlitePath), true);
    const jsonPayload = JSON.parse(fs.readFileSync(path.join(historyDir, encodeURIComponent("project-a") + ".json"), "utf8"));
    assert.equal(jsonPayload.conversations[0].messages.length, 1);

    clearModules();
    const ReloadedSessionHistoryStore = require("../dist/src/session-history-store.js").default;
    const reloaded = new ReloadedSessionHistoryStore();
    const messages = reloaded.getProjectState("project-a").conversations[0].messages;
    assert.deepEqual(messages.map((message) => message.id), ["message-a", "message-b"]);
  });
});

test("workgroup collaboration store imports legacy JSON and writes SQLite messages", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-sqlite-workgroup-"));
  const legacyWorkgroupSessions = [
    {
      workgroupId: "workgroup-a",
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: "legacy-message",
          workgroupId: "workgroup-a",
          senderType: "user",
          senderName: "User",
          content: "legacy json",
          status: "done",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    },
  ];

  withMockedElectronUserData(userDataPath, () => {
    clearModules();
    const store = require("../dist/src/workgroup-collaboration-store.js").default;

    assert.equal(store.getMessage("workgroup-a", "legacy-message").content, "legacy json");
    store.appendMessage("workgroup-a", {
      id: "sqlite-message",
      senderType: "member",
      senderName: "Agent",
      content: "sqlite message",
      status: "done",
    });
    clearModules();
    const reloaded = require("../dist/src/workgroup-collaboration-store.js").default;
    assert.deepEqual(
      reloaded.listMessages("workgroup-a").map((message) => message.id),
      ["legacy-message", "sqlite-message"],
    );
  }, { legacyWorkgroupSessions });
});

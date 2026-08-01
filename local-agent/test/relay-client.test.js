const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { WebSocketServer } = require("ws");

const relayClientModule = require("../dist/src/relay-client.js");
const RelayClient = relayClientModule.default;
const { normalizeRelayWebSocketUrl } = relayClientModule;
const { Events } = require("../dist/src/types.js");

function waitForListening(server) {
  return new Promise((resolve) => {
    if (server.address()) {
      resolve();
      return;
    }
    server.once("listening", resolve);
  });
}

test("normalizeRelayWebSocketUrl accepts base relay URLs and targets /ws", () => {
  assert.equal(normalizeRelayWebSocketUrl("https://relay.example.com"), "wss://relay.example.com/ws");
  assert.equal(normalizeRelayWebSocketUrl("http://127.0.0.1:8080"), "ws://127.0.0.1:8080/ws");
  assert.equal(normalizeRelayWebSocketUrl("wss://relay.example.com"), "wss://relay.example.com/ws");
  assert.equal(normalizeRelayWebSocketUrl("relay.example.com"), "wss://relay.example.com/ws");
  assert.equal(normalizeRelayWebSocketUrl("wss://relay.example.com/custom"), "wss://relay.example.com/custom");
});

test("RelayClient reports invalid relay URLs without throwing from connect", () => {
  const client = new RelayClient("", "agent-test", "token-test", false);

  assert.doesNotThrow(() => client.connect());

  const snapshot = client.getConnectionSnapshot();
  assert.equal(snapshot.state, "disconnected");
  assert.equal(snapshot.isConnected, false);
  assert.equal(snapshot.isAuthenticated, false);
  assert.match(snapshot.lastErrorMessage, /Invalid URL/);
  assert.ok(snapshot.lastErrorAt > 0);
  assert.ok(snapshot.recentEvents.some((entry) => entry.type === "socket-error"));
});

test("RelayClient connects to /ws when configured with an HTTP relay base URL", async () => {
  const wss = new WebSocketServer({ port: 0, path: "/ws" });
  await waitForListening(wss);
  const address = wss.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve test websocket address");
  }

  const authMessagePromise = new Promise((resolve) => {
    wss.on("connection", (socket, request) => {
      socket.once("message", (raw) => resolve({
        path: request.url,
        env: JSON.parse(raw.toString()),
      }));
    });
  });

  const client = new RelayClient("http://127.0.0.1:" + address.port, "agent-test", "token-test", false);
  client.connect();
  const authMessage = await authMessagePromise;

  assert.equal(authMessage.path, "/ws");
  assert.equal(authMessage.env.event, Events.AUTH_LOGIN);

  client.disconnect();
  await new Promise((resolve) => wss.close(resolve));
});

test("RelayClient reports connected only after relay authentication", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await waitForListening(wss);
  const address = wss.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve test websocket address");
  }

  let authSocket = null;
  const authMessagePromise = new Promise((resolve) => {
    wss.on("connection", (socket) => {
      authSocket = socket;
      socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    });
  });

  const client = new RelayClient("ws://127.0.0.1:" + address.port, "agent-test", "token-test", false);
  client.connect();
  const authMessage = await authMessagePromise;

  assert.equal(authMessage.event, Events.AUTH_LOGIN);
  assert.equal(client.isConnected(), false);
  assert.equal(client.getConnectionSnapshot().state, "authenticating");
  assert.equal(client.getConnectionSnapshot().isConnected, false);

  const connectedPromise = once(client, "connected");
  const authenticatedPromise = once(client, "authenticated");
  authSocket.send(JSON.stringify({
    id: "auth-ok",
    event: Events.AUTH_OK,
    ts: Date.now(),
    payload: {},
  }));

  await connectedPromise;
  await authenticatedPromise;
  assert.equal(client.isConnected(), true);
  assert.equal(client.getConnectionSnapshot().state, "connected");

  client.disconnect();
  await new Promise((resolve) => wss.close(resolve));
});

test("RelayClient closes the socket after relay auth error", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await waitForListening(wss);
  const address = wss.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve test websocket address");
  }

  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const env = JSON.parse(raw.toString());
      if (env.event !== Events.AUTH_LOGIN) {
        return;
      }
      socket.send(JSON.stringify({
        id: "auth-error",
        event: Events.AUTH_ERROR,
        ts: Date.now(),
        payload: { message: "token expired" },
      }));
    });
  });

  const client = new RelayClient("ws://127.0.0.1:" + address.port, "agent-test", "token-test", false);
  const authFailedPromise = once(client, "auth-failed");
  const disconnectedPromise = once(client, "disconnected");

  client.connect();
  await authFailedPromise;
  await disconnectedPromise;

  const snapshot = client.getConnectionSnapshot();
  assert.equal(snapshot.isAuthenticated, false);
  assert.equal(snapshot.isConnected, false);
  assert.equal(snapshot.lastErrorMessage, "token expired");
  assert.ok(snapshot.recentEvents.some((entry) => entry.type === "auth-error"));
  assert.equal(snapshot.state, "disconnected");
  assert.equal(snapshot.recentEvents.some((entry) => entry.type === "reconnect-scheduled"), false);

  client.disconnect();
  await new Promise((resolve) => wss.close(resolve));
});

test("RelayClient clears stale auth errors after successful re-authentication", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await waitForListening(wss);
  const address = wss.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve test websocket address");
  }

  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const env = JSON.parse(raw.toString());
      if (env.event !== Events.AUTH_LOGIN) {
        return;
      }
      if (env.payload?.token === "token-new") {
        socket.send(JSON.stringify({
          id: "auth-ok",
          event: Events.AUTH_OK,
          ts: Date.now(),
          payload: {},
        }));
        return;
      }
      socket.send(JSON.stringify({
        id: "auth-error",
        event: Events.AUTH_ERROR,
        ts: Date.now(),
        payload: { message: "invalid token" },
      }));
    });
  });

  const client = new RelayClient("ws://127.0.0.1:" + address.port, "agent-test", "token-old", false);
  client.once("auth-failed", () => {
    client.updateAuth("ws://127.0.0.1:" + address.port, "agent-test", "token-new");
    client.connect();
  });

  const authenticatedPromise = once(client, "authenticated");
  client.connect();
  await authenticatedPromise;

  const snapshot = client.getConnectionSnapshot();
  assert.equal(snapshot.isConnected, true);
  assert.equal(snapshot.lastErrorMessage, "");
  assert.equal(snapshot.lastErrorAt, 0);

  client.disconnect();
  await new Promise((resolve) => wss.close(resolve));
});

test("RelayClient retries a room-key offer after its offline agent comes online", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await waitForListening(wss);
  const address = wss.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve test websocket address");
  }

  const offers = [];
  let socket = null;
  const secondOffer = new Promise((resolve) => {
    wss.on("connection", (nextSocket) => {
      socket = nextSocket;
      nextSocket.on("message", (raw) => {
        const env = JSON.parse(raw.toString());
        if (env.event === Events.AUTH_LOGIN) {
          nextSocket.send(JSON.stringify({
            id: "auth-ok",
            event: Events.AUTH_OK,
            ts: Date.now(),
            payload: {},
          }));
          return;
        }
        if (env.event !== Events.E2E_OFFER) {
          return;
        }
        offers.push(env);
        if (offers.length === 1) {
          nextSocket.send(JSON.stringify({
            id: "offer-rejected",
            event: Events.ERROR,
            ts: Date.now(),
            payload: { code: "agent_offline", ref_id: env.id },
          }));
          return;
        }
        resolve(env);
      });
    });
  });

  const client = new RelayClient(
    "ws://127.0.0.1:" + address.port,
    "controller-agent",
    "token-test",
    true,
    {
      clientType: "device",
      deviceId: "controller-device",
      resolveTargetAgentId: () => "owner-agent",
    },
  );
  const authenticated = once(client, "authenticated");
  client.connect();
  await authenticated;

  client.send({
    id: "sync-request",
    event: Events.SESSION_SYNC_REQUEST,
    project_id: "owner-project",
    ts: Date.now(),
    payload: { limit: 30 },
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  socket.send(JSON.stringify({
    id: "project-listed-online",
    event: Events.PROJECT_LISTED,
    ts: Date.now(),
    payload: { agent_id: "owner-agent", projects: [] },
  }));

  const retryOffer = await secondOffer;
  assert.equal(offers.length, 2);
  assert.equal(retryOffer.payload.agent_id, "owner-agent");

  client.disconnect();
  await new Promise((resolve) => wss.close(resolve));
});

test("RelayClient renews a stale room key when an agent comes online after restarting", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await waitForListening(wss);
  const address = wss.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve test websocket address");
  }

  let socket = null;
  const renewedOffer = new Promise((resolve) => {
    wss.on("connection", (nextSocket) => {
      socket = nextSocket;
      nextSocket.on("message", (raw) => {
        const env = JSON.parse(raw.toString());
        if (env.event === Events.AUTH_LOGIN) {
          nextSocket.send(JSON.stringify({
            id: "auth-ok",
            event: Events.AUTH_OK,
            ts: Date.now(),
            payload: {},
          }));
          return;
        }
        if (env.event === Events.E2E_OFFER) {
          resolve(env);
        }
      });
    });
  });

  const client = new RelayClient(
    "ws://127.0.0.1:" + address.port,
    "controller-agent",
    "token-test",
    true,
    {
      clientType: "device",
      deviceId: "controller-device",
    },
  );
  client.getE2E().setRoomKey("owner-agent", Buffer.alloc(32, 7).toString("base64"));
  const authenticated = once(client, "authenticated");
  client.connect();
  await authenticated;

  socket.send(JSON.stringify({
    id: "owner-online",
    event: Events.AGENT_STATUS,
    ts: Date.now(),
    payload: { agent_id: "owner-agent", online: true },
  }));

  const offer = await renewedOffer;
  assert.equal(offer.payload.agent_id, "owner-agent");
  assert.equal(client.getE2E().hasRoomKey("owner-agent"), false);

  client.disconnect();
  await new Promise((resolve) => wss.close(resolve));
});

test("RelayClient records close metadata and recent connection events", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await waitForListening(wss);
  const address = wss.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve test websocket address");
  }

  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const env = JSON.parse(raw.toString());
      if (env.event !== Events.AUTH_LOGIN) {
        return;
      }
      socket.send(JSON.stringify({
        id: "auth-ok",
        event: Events.AUTH_OK,
        ts: Date.now(),
        payload: {},
      }));
      setTimeout(() => socket.close(4001, "token-expired"), 20);
    });
  });

  const client = new RelayClient("ws://127.0.0.1:" + address.port, "agent-test", "token-test", false);
  const authenticatedPromise = once(client, "authenticated");
  const disconnectedPromise = once(client, "disconnected");

  client.connect();
  await authenticatedPromise;
  await disconnectedPromise;

  const snapshot = client.getConnectionSnapshot();
  assert.equal(snapshot.lastCloseCode, 4001);
  assert.equal(snapshot.lastCloseReason, "token-expired");
  assert.equal(snapshot.state, "reconnecting");

  const eventTypes = snapshot.recentEvents.map((entry) => entry.type);
  assert.deepEqual(eventTypes.slice(0, 5), [
    "connect-attempt",
    "socket-open",
    "auth-sent",
    "authenticated",
    "socket-close",
  ]);
  assert.equal(eventTypes.at(-1), "reconnect-scheduled");

  const closeEvent = snapshot.recentEvents.find((entry) => entry.type === "socket-close");
  assert.ok(closeEvent);
  assert.equal(closeEvent.closeCode, 4001);
  assert.equal(closeEvent.closeReason, "token-expired");

  client.disconnect();
  await new Promise((resolve) => wss.close(resolve));
});

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decideRelayHealthCheckRecovery,
  getRelayRecoveryStage,
} = require("../dist/src/relay-connection-recovery.js");

function createInput(overrides = {}) {
  return {
    now: 100_000,
    reason: "watchdog",
    staleTimeoutMs: 75_000,
    connectionState: "connected",
    socketState: "open",
    isAuthenticated: true,
    lastInboundAt: 98_000,
    lastSocketOpenAttemptAt: 95_000,
    lastAuthenticatedAt: 97_500,
    reconnectScheduled: false,
    ...overrides,
  };
}

test("getRelayRecoveryStage distinguishes connect auth catch-up and stable", () => {
  assert.equal(
    getRelayRecoveryStage(createInput({ connectionState: "reconnecting", socketState: "missing" })),
    "connect",
  );
  assert.equal(
    getRelayRecoveryStage(createInput({ connectionState: "authenticating", isAuthenticated: false })),
    "auth",
  );
  assert.equal(
    getRelayRecoveryStage(createInput({ lastInboundAt: 97_500, lastAuthenticatedAt: 97_500 })),
    "catch-up",
  );
  assert.equal(getRelayRecoveryStage(createInput()), "stable");
});

test("decideRelayHealthCheckRecovery waits for the scheduled reconnect when no socket is present", () => {
  const decision = decideRelayHealthCheckRecovery(
    createInput({
      connectionState: "reconnecting",
      socketState: "missing",
      reconnectScheduled: true,
    }),
  );

  assert.equal(decision.action, "none");
  assert.match(decision.detail, /awaiting-scheduled-reconnect/);
  assert.equal(decision.stage, "connect");
});

test("decideRelayHealthCheckRecovery gives unauthenticated open sockets a grace window", () => {
  const decision = decideRelayHealthCheckRecovery(
    createInput({
      connectionState: "authenticating",
      isAuthenticated: false,
      lastSocketOpenAttemptAt: 90_000,
    }),
  );

  assert.equal(decision.action, "none");
  assert.equal(decision.stage, "auth");
  assert.match(decision.detail, /authentication-grace/);
});

test("decideRelayHealthCheckRecovery reconnects unauthenticated sockets after the auth grace window", () => {
  const decision = decideRelayHealthCheckRecovery(
    createInput({
      connectionState: "authenticating",
      isAuthenticated: false,
      lastSocketOpenAttemptAt: 80_000,
    }),
  );

  assert.equal(decision.action, "reconnect");
  assert.equal(decision.stage, "auth");
  assert.match(decision.detail, /authentication-stalled/);
});

test("decideRelayHealthCheckRecovery keeps freshly authenticated catch-up sessions alive", () => {
  const decision = decideRelayHealthCheckRecovery(
    createInput({
      lastInboundAt: 99_000,
      lastAuthenticatedAt: 99_000,
    }),
  );

  assert.equal(decision.action, "none");
  assert.equal(decision.stage, "catch-up");
  assert.match(decision.detail, /catch-up-grace/);
});

test("decideRelayHealthCheckRecovery reconnects authenticated sockets after inbound stalls", () => {
  const decision = decideRelayHealthCheckRecovery(
    createInput({
      lastInboundAt: 10_000,
      lastAuthenticatedAt: 20_000,
    }),
  );

  assert.equal(decision.action, "reconnect");
  assert.equal(decision.stage, "catch-up");
  assert.match(decision.detail, /inbound-stalled/);
});

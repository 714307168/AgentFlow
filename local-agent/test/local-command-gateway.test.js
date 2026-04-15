const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createLocalCommandGateway,
  defineLocalCommand,
} = require("../dist/src/local-command-gateway.js");

test("listCommands exposes sanitized command descriptors without handlers", () => {
  const gateway = createLocalCommandGateway([
    defineLocalCommand({
      id: "relay.reconnect",
      title: "Reconnect relay",
      group: "runtime",
      run: () => true,
    }),
  ]);

  assert.deepEqual(gateway.listCommands(), [
    {
      id: "relay.reconnect",
      title: "Reconnect relay",
      group: "runtime",
      payloadSchema: "none",
    },
  ]);
});

test("runCommand returns an error for missing or unknown command ids", async () => {
  const gateway = createLocalCommandGateway([]);

  await assert.deepEqual(await gateway.runCommand({ commandId: "   " }), {
    success: false,
    commandId: "",
    error: "Local command id is required.",
  });

  await assert.deepEqual(await gateway.runCommand({ commandId: "missing.command" }), {
    success: false,
    commandId: "missing.command",
    error: "Unknown local command: missing.command",
  });
});

test("runCommand validates payload schemas before invoking the handler", async () => {
  const gateway = createLocalCommandGateway([
    defineLocalCommand({
      id: "storage.open",
      title: "Open storage path",
      group: "storage",
      payloadSchema: "optionalPath",
      run: (pathValue) => pathValue || null,
    }),
    defineLocalCommand({
      id: "runtime.refresh",
      title: "Refresh runtime",
      group: "runtime",
      run: () => "ok",
    }),
  ]);

  await assert.deepEqual(
    await gateway.runCommand({ commandId: "storage.open", payload: { currentPath: " C:/data " } }),
    {
      success: true,
      commandId: "storage.open",
      data: "C:/data",
    },
  );

  await assert.deepEqual(
    await gateway.runCommand({ commandId: "runtime.refresh", payload: { unexpected: true } }),
    {
      success: false,
      commandId: "runtime.refresh",
      error: "This local command does not accept a payload.",
    },
  );
});

test("runCommand catches handler exceptions and reports them as gateway errors", async () => {
  const gateway = createLocalCommandGateway([
    defineLocalCommand({
      id: "diagnostics.export",
      title: "Export diagnostics bundle",
      group: "diagnostics",
      run: () => {
        throw new Error("bundle failed");
      },
    }),
  ]);

  await assert.deepEqual(
    await gateway.runCommand({ commandId: "diagnostics.export" }),
    {
      success: false,
      commandId: "diagnostics.export",
      error: "bundle failed",
    },
  );
});

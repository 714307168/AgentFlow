const test = require("node:test");
const assert = require("node:assert/strict");

const { buildWorkgroupTaskGraph } = require("../dist/src/workgroup-task-graph.js");

const task = (id, title, dependsOnIds = [], status = "todo") => ({
  id,
  title,
  dependsOnIds,
  status,
});

test("task graph lays dependencies out from left to right", () => {
  const graph = buildWorkgroupTaskGraph([
    task("release", "Release", ["test", "review"]),
    task("review", "Review", ["implement"]),
    task("test", "Test", ["implement"]),
    task("implement", "Implement"),
  ]);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  assert.equal(nodesById.get("implement").column, 0);
  assert.equal(nodesById.get("review").column, 1);
  assert.equal(nodesById.get("test").column, 1);
  assert.equal(nodesById.get("release").column, 2);
  assert.deepEqual(graph.edges, [
    { fromTaskId: "implement", toTaskId: "review" },
    { fromTaskId: "implement", toTaskId: "test" },
    { fromTaskId: "review", toTaskId: "release" },
    { fromTaskId: "test", toTaskId: "release" },
  ]);
});

test("task graph ignores deleted dependencies and remains stable for independent tasks", () => {
  const graph = buildWorkgroupTaskGraph([
    task("beta", "Beta", ["deleted"]),
    task("alpha", "Alpha"),
  ]);

  assert.deepEqual(graph.nodes.map((node) => ({ id: node.id, column: node.column, row: node.row })), [
    { id: "alpha", column: 0, row: 0 },
    { id: "beta", column: 0, row: 1 },
  ]);
  assert.deepEqual(graph.edges, []);
});

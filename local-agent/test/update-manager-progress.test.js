const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const updateManagerSource = fs.readFileSync(path.join(__dirname, "../src/update-manager.ts"), "utf8");

test("update manager publishes streaming download progress", () => {
  assert.match(updateManagerSource, /downloadProgress: \{/);
  assert.match(updateManagerSource, /private async readDownloadBuffer\(response: Response/);
  assert.match(updateManagerSource, /response\.body\.getReader\(\)/);
  assert.match(updateManagerSource, /this\.setDownloadProgress\(downloadedBytes, totalBytes, false\)/);
  assert.match(updateManagerSource, /percent: 100/);
  assert.doesNotMatch(updateManagerSource, /const arrayBuffer = await response\.arrayBuffer\(\);/);
});

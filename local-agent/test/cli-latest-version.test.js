const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseBrewLatestVersion,
  parseNpmLatestVersion,
  parseScoopLatestVersion,
  parseWingetLatestVersion,
} = require("../dist/src/cli-latest-version.js");

test("parseNpmLatestVersion handles json and plain text responses", () => {
  assert.equal(parseNpmLatestVersion('"0.119.0"'), "0.119.0");
  assert.equal(parseNpmLatestVersion("0.119.0"), "0.119.0");
});

test("parseBrewLatestVersion reads the stable version from brew json", () => {
  assert.equal(
    parseBrewLatestVersion(JSON.stringify({
      formulae: [{ versions: { stable: "1.2.3" } }],
    })),
    "1.2.3",
  );
});

test("parseWingetLatestVersion extracts the available version from upgrade output", () => {
  const output = [
    "Name Id Version Available Source",
    "Codex OpenAI.Codex 0.118.0 0.119.0 winget",
  ].join("\n");
  assert.equal(parseWingetLatestVersion(output, "", "OpenAI.Codex"), "0.119.0");
});

test("parseScoopLatestVersion extracts the target version from status output", () => {
  const output = "codex 0.118.0 -> 0.119.0";
  assert.equal(parseScoopLatestVersion(output, "", "codex"), "0.119.0");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildSkillCatalogSnapshot,
  getDefaultSkillRoots,
} = require("../dist/src/skill-catalog.js");

test("getDefaultSkillRoots includes common local skill directories", () => {
  const roots = getDefaultSkillRoots(path.join("C:", "Users", "demo"));

  assert.equal(roots.some((root) => root.includes(".codex")), true);
  assert.equal(roots.some((root) => root.includes(".agents")), true);
  assert.equal(roots.some((root) => root.includes(".cc-switch")), true);
});

test("buildSkillCatalogSnapshot merges built-in and local SKILL.md entries", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-skill-catalog-"));
  const skillDir = path.join(root, "browser-helper");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    [
      "# Browser Helper",
      "description: Automates browser verification for local UI work.",
      "",
    ].join("\n"),
    "utf8",
  );

  const snapshot = await buildSkillCatalogSnapshot({ roots: [root] });

  assert.equal(snapshot.translationMode, "none");
  assert.equal(snapshot.items.some((item) => item.id === "openai-docs"), true);
  const local = snapshot.items.find((item) => item.id === "local:browser-helper");
  assert.equal(local?.name, "Browser Helper");
  assert.equal(local?.description, "Automates browser verification for local UI work.");
  assert.equal(local?.source, "local");
});

test("buildSkillCatalogSnapshot translates through a configured model translator", async () => {
  const snapshot = await buildSkillCatalogSnapshot({
    roots: [],
    translateToZh: true,
    provider: "codex",
    translator: async ({ prompt }) => {
      assert.equal(prompt.includes("Translate the following skill catalog entries"), true);
      return JSON.stringify([
        {
          id: "openai-docs",
          zhName: "OpenAI 文档",
          zhDescription: "用于查阅 OpenAI 文档。",
        },
      ]);
    },
  });

  assert.equal(snapshot.translationMode, "model");
  assert.equal(snapshot.items.find((item) => item.id === "openai-docs")?.zhDescription, "用于查阅 OpenAI 文档。");
  assert.equal(snapshot.items.find((item) => item.id === "mysql")?.zhName, "MySQL 工程");
});

test("buildSkillCatalogSnapshot falls back when model translation fails", async () => {
  const snapshot = await buildSkillCatalogSnapshot({
    roots: [],
    translateToZh: true,
    provider: "codex",
    translator: async () => {
      throw new Error("network unavailable");
    },
  });

  assert.equal(snapshot.translationMode, "fallback");
  assert.equal(snapshot.error, "network unavailable");
  assert.equal(snapshot.items.find((item) => item.id === "desktop-electron")?.zhName, "Electron 桌面端");
});

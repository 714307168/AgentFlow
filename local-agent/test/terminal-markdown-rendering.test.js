const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const terminalSource = fs.readFileSync(path.join(__dirname, "../renderer/terminal.ts"), "utf8");
const stylesCss = fs.readFileSync(path.join(__dirname, "../renderer/styles.css"), "utf8");

test("terminal chat messages render through the safe markdown renderer", () => {
  assert.match(terminalSource, /function renderMarkdownContent/);
  assert.match(terminalSource, /function sanitizeMarkdownUrl/);
  assert.match(terminalSource, /renderMarkdownContent\(message\.content, state\.messageSearchQuery\)/);
  assert.match(terminalSource, /renderMarkdownContent\(content, state\.messageSearchQuery\)/);
  assert.match(terminalSource, /data-copy-markdown-block/);
  assert.match(terminalSource, /function copyMarkdownCodeBlock\(button: HTMLElement\)/);
});

test("terminal markdown styling covers common chat markdown blocks", () => {
  assert.match(stylesCss, /\.markdown-content pre code/);
  assert.match(stylesCss, /\.markdown-content blockquote/);
  assert.match(stylesCss, /\.markdown-content ul,/);
  assert.match(stylesCss, /\.markdown-content a/);
  assert.match(stylesCss, /\.markdown-code-copy/);
  assert.match(stylesCss, /\.markdown-code-toolbar/);
});

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildGitHubDownloadCandidates,
  getConfiguredGitHubDownloadMirrorTemplates,
  isGitHubReleaseDownloadUrl,
  selectFastestGitHubDownloadUrl,
} = require("../dist/src/github-download-accelerator.js");

test("buildGitHubDownloadCandidates adds HTTPS mirrors only for GitHub release assets", () => {
  const originalUrl = "https://github.com/714307168/AgentFlow/releases/download/v1.1.207/AgentFlow-1.1.207-x64-setup.exe";
  const candidates = buildGitHubDownloadCandidates(originalUrl, [
    "https://fast.example/{url}",
    "http://unsafe.example/{url}",
    "https://encoded.example/download?target={encodedUrl}",
  ]);

  assert.deepEqual(candidates.map((candidate) => candidate.url), [
    originalUrl,
    "https://fast.example/https://github.com/714307168/AgentFlow/releases/download/v1.1.207/AgentFlow-1.1.207-x64-setup.exe",
    "https://encoded.example/download?target=https%3A%2F%2Fgithub.com%2F714307168%2FAgentFlow%2Freleases%2Fdownload%2Fv1.1.207%2FAgentFlow-1.1.207-x64-setup.exe",
  ]);

  assert.deepEqual(buildGitHubDownloadCandidates("https://relay.example/download/app.exe", [
    "https://fast.example/{url}",
  ]).map((candidate) => candidate.url), ["https://relay.example/download/app.exe"]);
});

test("isGitHubReleaseDownloadUrl only accepts GitHub release download URLs", () => {
  assert.equal(isGitHubReleaseDownloadUrl("https://github.com/714307168/AgentFlow/releases/download/v1.1.207/app.exe"), true);
  assert.equal(isGitHubReleaseDownloadUrl("https://github.com/714307168/AgentFlow/archive/refs/tags/v1.1.207.zip"), false);
  assert.equal(isGitHubReleaseDownloadUrl("https://example.com/714307168/AgentFlow/releases/download/v1.1.207/app.exe"), false);
});

test("getConfiguredGitHubDownloadMirrorTemplates supports custom mirrors and disable switch", () => {
  const previousMirrors = process.env.AGENTFLOW_GITHUB_DOWNLOAD_MIRRORS;
  const previousDisabled = process.env.AGENTFLOW_DISABLE_GITHUB_DOWNLOAD_ACCELERATORS;
  try {
    process.env.AGENTFLOW_GITHUB_DOWNLOAD_MIRRORS = "https://custom-one.example/{url}, https://custom-two.example/{encodedUrl}";
    delete process.env.AGENTFLOW_DISABLE_GITHUB_DOWNLOAD_ACCELERATORS;
    const enabled = getConfiguredGitHubDownloadMirrorTemplates();
    assert.equal(enabled[0], "https://custom-one.example/{url}");
    assert.equal(enabled[1], "https://custom-two.example/{encodedUrl}");
    assert.equal(enabled.some((template) => template.includes("gh.llkk.cc")), true);

    process.env.AGENTFLOW_DISABLE_GITHUB_DOWNLOAD_ACCELERATORS = "1";
    assert.deepEqual(getConfiguredGitHubDownloadMirrorTemplates(), [
      "https://custom-one.example/{url}",
      "https://custom-two.example/{encodedUrl}",
    ]);
  } finally {
    restoreEnv("AGENTFLOW_GITHUB_DOWNLOAD_MIRRORS", previousMirrors);
    restoreEnv("AGENTFLOW_DISABLE_GITHUB_DOWNLOAD_ACCELERATORS", previousDisabled);
  }
});

test("selectFastestGitHubDownloadUrl chooses the fastest healthy candidate", async () => {
  const originalUrl = "https://github.com/714307168/AgentFlow/releases/download/v1.1.207/AgentFlow-1.1.207-x64-setup.exe";
  const calls = [];
  const selected = await selectFastestGitHubDownloadUrl(originalUrl, {
    timeoutMs: 1000,
    mirrorTemplates: [
      "https://slow.example/{url}",
      "https://fast.example/{url}",
    ],
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("slow.example")) {
        await delay(40);
        return new Response(null, { status: 200 });
      }
      if (String(url).includes("fast.example")) {
        await delay(5);
        return new Response(null, { status: 200 });
      }
      await delay(20);
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(selected.url.startsWith("https://fast.example/"), true);
  assert.equal(calls.length, 3);
});

test("selectFastestGitHubDownloadUrl falls back to GitHub when every probe fails", async () => {
  const originalUrl = "https://github.com/714307168/AgentFlow/releases/download/v1.1.207/AgentFlow-1.1.207-x64-setup.exe";
  const selected = await selectFastestGitHubDownloadUrl(originalUrl, {
    timeoutMs: 100,
    mirrorTemplates: ["https://broken.example/{url}"],
    fetchImpl: async () => new Response(null, { status: 503 }),
  });

  assert.equal(selected.url, originalUrl);
  assert.equal(selected.original, true);
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

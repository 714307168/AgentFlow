const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildGitHubUpdateCandidate,
  parseGitHubAssetSha256,
  selectGitHubReleaseAsset,
} = require("../dist/src/github-update-source.js");

test("buildGitHubUpdateCandidate selects the Windows setup asset from GitHub releases", () => {
  const candidate = buildGitHubUpdateCandidate({
    id: 123,
    tag_name: "v1.1.146",
    body: "Release notes",
    assets: [
      {
        name: "android-release-app-release.apk",
        browser_download_url: "https://github.com/714307168/AgentFlow/releases/download/v1.1.146/app.apk",
      },
      {
        name: "windows-installer-AgentFlow-1.1.146-x64-setup.exe",
        browser_download_url: "https://github.com/714307168/AgentFlow/releases/download/v1.1.146/setup.exe",
        size: 42,
        digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
  }, "1.1.145", "win32", "x64");

  assert.deepEqual(candidate, {
    releaseId: 123,
    latestVersion: "1.1.146",
    downloadUrl: "https://github.com/714307168/AgentFlow/releases/download/v1.1.146/setup.exe",
    filename: "windows-installer-AgentFlow-1.1.146-x64-setup.exe",
    size: 42,
    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    notes: "Release notes",
  });
});

test("buildGitHubUpdateCandidate ignores non-newer draft and prerelease payloads", () => {
  assert.equal(buildGitHubUpdateCandidate({ tag_name: "v1.1.146", draft: true }, "1.1.145", "win32", "x64"), null);
  assert.equal(buildGitHubUpdateCandidate({ tag_name: "v1.1.146", prerelease: true }, "1.1.145", "win32", "x64"), null);
  assert.equal(buildGitHubUpdateCandidate({ tag_name: "v1.1.145" }, "1.1.145", "win32", "x64"), null);
});

test("selectGitHubReleaseAsset chooses platform-specific packages", () => {
  const assets = [
    { name: "linux-AgentFlow-1.1.146-x64.AppImage", browser_download_url: "https://example.test/appimage" },
    { name: "mac-AgentFlow-1.1.146-arm64.dmg", browser_download_url: "https://example.test/dmg" },
    { name: "windows-AgentFlow-1.1.146-x64-setup.exe", browser_download_url: "https://example.test/exe" },
  ];

  assert.equal(selectGitHubReleaseAsset(assets, "linux", "x64")?.name, "linux-AgentFlow-1.1.146-x64.AppImage");
  assert.equal(selectGitHubReleaseAsset(assets, "darwin", "arm64")?.name, "mac-AgentFlow-1.1.146-arm64.dmg");
  assert.equal(selectGitHubReleaseAsset(assets, "win32", "x64")?.name, "windows-AgentFlow-1.1.146-x64-setup.exe");
});

test("parseGitHubAssetSha256 accepts only GitHub sha256 digest values", () => {
  assert.equal(
    parseGitHubAssetSha256("sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"),
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  assert.equal(parseGitHubAssetSha256("md5:bbbb"), undefined);
  assert.equal(parseGitHubAssetSha256(null), undefined);
});

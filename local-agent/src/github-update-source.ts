import { compareSemanticVersions, extractSemanticVersion } from "./cli-version";
import * as fs from "fs";

export const DEFAULT_GITHUB_UPDATE_REPO = "714307168/AgentFlow";
export const DEFAULT_GITHUB_RELEASE_API_URL = `https://api.github.com/repos/${DEFAULT_GITHUB_UPDATE_REPO}/releases/latest`;

export interface GitHubReleaseAsset {
  name?: string | null;
  browser_download_url?: string | null;
  size?: number | null;
  digest?: string | null;
}

export interface GitHubReleasePayload {
  id?: number | null;
  tag_name?: string | null;
  name?: string | null;
  body?: string | null;
  prerelease?: boolean | null;
  draft?: boolean | null;
  assets?: GitHubReleaseAsset[] | null;
}

export interface GitHubUpdateCandidate {
  releaseId: number;
  latestVersion: string;
  downloadUrl: string;
  filename: string;
  size?: number;
  sha256?: string;
  notes?: string;
}

export type LinuxPackageFamily = "arch" | "debian" | "appimage";

export function getGitHubReleaseApiUrl(): string {
  const configured = process.env.AGENTFLOW_GITHUB_UPDATE_API_URL?.trim();
  return configured || DEFAULT_GITHUB_RELEASE_API_URL;
}

export function buildGitHubApiHeaders(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "AgentFlow-Desktop-Updater",
  };
}

export function normalizeGitHubReleaseVersion(payload: GitHubReleasePayload): string | null {
  const raw = payload.tag_name?.trim() || payload.name?.trim() || "";
  if (!raw) {
    return null;
  }
  return extractSemanticVersion(raw) ?? (raw.replace(/^v/iu, "").trim() || null);
}

export function isNewerGitHubRelease(payload: GitHubReleasePayload, currentVersion: string): boolean {
  const latestVersion = normalizeGitHubReleaseVersion(payload);
  if (!latestVersion) {
    return false;
  }
  return (compareSemanticVersions(currentVersion, latestVersion) ?? 0) < 0;
}

export function selectGitHubReleaseAsset(
  assets: GitHubReleaseAsset[] | null | undefined,
  platform: NodeJS.Platform,
  arch: string,
): GitHubReleaseAsset | null {
  if (platform === "linux") {
    return selectGitHubReleaseAssetForLinuxFamily(assets, arch, detectLinuxPackageFamily());
  }

  const candidates = (assets ?? []).filter((asset) => {
    const name = asset.name?.trim() ?? "";
    return name.length > 0 && Boolean(asset.browser_download_url?.trim());
  });

  const normalizedArch = normalizeArch(arch);
  const platformMatches = candidates.filter((asset) => matchesPlatform(asset.name ?? "", platform));
  if (platformMatches.length === 0) {
    return null;
  }

  const archMatches = platformMatches.filter((asset) => matchesArch(asset.name ?? "", normalizedArch));
  const searchSpace = archMatches.length > 0 ? archMatches : platformMatches;
  return searchSpace.sort((left, right) => scoreAsset(right.name ?? "", platform) - scoreAsset(left.name ?? "", platform))[0] ?? null;
}

export function selectGitHubReleaseAssetForLinuxFamily(
  assets: GitHubReleaseAsset[] | null | undefined,
  arch: string,
  linuxFamily: LinuxPackageFamily,
): GitHubReleaseAsset | null {
  const candidates = (assets ?? []).filter((asset) => {
    const name = asset.name?.trim() ?? "";
    return name.length > 0 && Boolean(asset.browser_download_url?.trim()) && matchesPlatform(name, "linux");
  });
  const normalizedArch = normalizeArch(arch);
  const archMatches = candidates.filter((asset) => matchesArch(asset.name ?? "", normalizedArch));
  const searchSpace = archMatches.length > 0 ? archMatches : candidates;
  return searchSpace.sort((left, right) => scoreLinuxAsset(right.name ?? "", linuxFamily) - scoreLinuxAsset(left.name ?? "", linuxFamily))[0] ?? null;
}

export function buildGitHubUpdateCandidate(
  payload: GitHubReleasePayload,
  currentVersion: string,
  platform: NodeJS.Platform,
  arch: string,
): GitHubUpdateCandidate | null {
  if (payload.draft || payload.prerelease) {
    return null;
  }

  const latestVersion = normalizeGitHubReleaseVersion(payload);
  if (!latestVersion || (compareSemanticVersions(currentVersion, latestVersion) ?? 0) >= 0) {
    return null;
  }

  const asset = selectGitHubReleaseAsset(payload.assets, platform, arch);
  const downloadUrl = asset?.browser_download_url?.trim() ?? "";
  const filename = asset?.name?.trim() ?? "";
  if (!downloadUrl || !filename) {
    return null;
  }

  return {
    releaseId: Number(payload.id ?? 0) || 0,
    latestVersion,
    downloadUrl,
    filename,
    size: Number(asset?.size ?? 0) || undefined,
    sha256: parseGitHubAssetSha256(asset?.digest),
    notes: payload.body ?? "",
  };
}

export function parseGitHubAssetSha256(digest: string | null | undefined): string | undefined {
  const trimmed = digest?.trim() ?? "";
  const match = /^sha256:([a-f0-9]{64})$/iu.exec(trimmed);
  return match?.[1]?.toLowerCase();
}

function matchesPlatform(name: string, platform: NodeJS.Platform): boolean {
  const normalized = name.toLowerCase();
  if (platform === "win32") {
    return normalized.endsWith("-setup.exe") || normalized.endsWith(".exe");
  }
  if (platform === "darwin") {
    return normalized.endsWith(".dmg");
  }
  if (platform === "linux") {
    return normalized.endsWith(".appimage") || normalized.endsWith(".deb") || normalized.endsWith(".pacman") || normalized.includes(".pkg.tar.");
  }
  return false;
}

function matchesArch(name: string, arch: string): boolean {
  const normalized = name.toLowerCase();
  if (arch === "x64") {
    return normalized.includes("x64") || normalized.includes("amd64") || !/(arm64|aarch64|ia32|x86)/u.test(normalized);
  }
  if (arch === "arm64") {
    return normalized.includes("arm64") || normalized.includes("aarch64");
  }
  if (arch === "ia32") {
    return normalized.includes("ia32") || normalized.includes("x86");
  }
  return true;
}

function normalizeArch(arch: string): string {
  const normalized = arch.toLowerCase();
  if (normalized === "x64" || normalized === "amd64") {
    return "x64";
  }
  if (normalized === "arm64" || normalized === "aarch64") {
    return "arm64";
  }
  if (normalized === "ia32" || normalized === "x86") {
    return "ia32";
  }
  return normalized;
}

function scoreAsset(name: string, platform: NodeJS.Platform): number {
  const normalized = name.toLowerCase();
  if (platform === "win32" && normalized.endsWith("-setup.exe")) {
    return 100;
  }
  if (platform === "darwin" && normalized.endsWith(".dmg")) {
    return 100;
  }
  if (platform === "linux") {
    return scoreLinuxAsset(name, detectLinuxPackageFamily());
  }
  return 0;
}

export function detectLinuxPackageFamily(osReleaseContent?: string | null): LinuxPackageFamily {
  const content = osReleaseContent ?? (process.platform === "linux" ? readOsRelease() : "");
  const normalized = content.toLowerCase();
  if (/\b(id|id_like)=.*(arch|manjaro|endeavouros|garuda)/u.test(normalized)) {
    return "arch";
  }
  if (/\b(id|id_like)=.*(debian|ubuntu|kylin|uos|deepin|linuxmint)/u.test(normalized)) {
    return "debian";
  }
  return "appimage";
}

function readOsRelease(): string {
  try {
    return fs.readFileSync("/etc/os-release", "utf8");
  } catch {
    return "";
  }
}

function scoreLinuxAsset(name: string, linuxFamily: LinuxPackageFamily): number {
  const normalized = name.toLowerCase();
  const isPacman = normalized.endsWith(".pacman") || normalized.includes(".pkg.tar.");
  if (linuxFamily === "arch") {
    if (isPacman) return 120;
    if (normalized.endsWith(".appimage")) return 80;
    if (normalized.endsWith(".deb")) return 10;
  }
  if (linuxFamily === "debian") {
    if (normalized.endsWith(".deb")) return 120;
    if (normalized.endsWith(".appimage")) return 80;
    if (isPacman) return 10;
  }
  if (normalized.endsWith(".appimage")) return 120;
  if (normalized.endsWith(".deb")) return 80;
  if (isPacman) return 70;
  return 0;
}

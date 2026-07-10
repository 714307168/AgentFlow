export interface GitHubDownloadCandidate {
  id: string;
  label: string;
  url: string;
  original: boolean;
}

export interface GitHubDownloadProbeResult extends GitHubDownloadCandidate {
  ok: boolean;
  elapsedMs: number;
  status?: number;
  error?: string;
}

export interface SelectFastestGitHubDownloadOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  mirrorTemplates?: readonly string[];
}

const DEFAULT_PROBE_TIMEOUT_MS = 3500;

const BUILTIN_GITHUB_DOWNLOAD_MIRROR_TEMPLATES = [
  "https://gh.llkk.cc/{url}",
  "https://gh-proxy.com/{url}",
  "https://ghproxy.net/{url}",
];

export function buildGitHubDownloadCandidates(
  originalUrl: string,
  mirrorTemplates: readonly string[] = getConfiguredGitHubDownloadMirrorTemplates(),
): GitHubDownloadCandidate[] {
  const normalizedOriginalUrl = originalUrl.trim();
  if (!isGitHubReleaseDownloadUrl(normalizedOriginalUrl)) {
    return [{
      id: "github",
      label: "GitHub",
      url: normalizedOriginalUrl,
      original: true,
    }];
  }

  const candidates: GitHubDownloadCandidate[] = [{
    id: "github",
    label: "GitHub",
    url: normalizedOriginalUrl,
    original: true,
  }];
  const seen = new Set([normalizedOriginalUrl]);
  for (const template of mirrorTemplates) {
    const mirrorUrl = applyGitHubDownloadMirrorTemplate(template, normalizedOriginalUrl);
    if (!mirrorUrl || seen.has(mirrorUrl)) {
      continue;
    }
    seen.add(mirrorUrl);
    candidates.push({
      id: createGitHubDownloadMirrorId(mirrorUrl),
      label: createGitHubDownloadMirrorLabel(mirrorUrl),
      url: mirrorUrl,
      original: false,
    });
  }
  return candidates;
}

export async function selectFastestGitHubDownloadUrl(
  originalUrl: string,
  options: SelectFastestGitHubDownloadOptions = {},
): Promise<GitHubDownloadCandidate> {
  const candidates = buildGitHubDownloadCandidates(originalUrl, options.mirrorTemplates);
  if (candidates.length <= 1 || !isGitHubReleaseDownloadUrl(originalUrl)) {
    return candidates[0] ?? {
      id: "github",
      label: "GitHub",
      url: originalUrl,
      original: true,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const results = await Promise.all(candidates.map((candidate) => probeGitHubDownloadCandidate(candidate, fetchImpl, timeoutMs)));
  const fastest = results
    .filter((result) => result.ok)
    .sort((left, right) => left.elapsedMs - right.elapsedMs || Number(left.original) - Number(right.original))[0];
  return fastest ?? candidates[0];
}

export async function probeGitHubDownloadCandidate(
  candidate: GitHubDownloadCandidate,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<GitHubDownloadProbeResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetchImpl(candidate.url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "AgentFlow-Desktop-Updater",
      },
    });
    return {
      ...candidate,
      ok: response.ok || response.status === 302 || response.status === 301,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ...candidate,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function getConfiguredGitHubDownloadMirrorTemplates(): string[] {
  if (isEnvEnabled(process.env.AGENTFLOW_DISABLE_GITHUB_DOWNLOAD_ACCELERATORS)) {
    return parseMirrorTemplates(process.env.AGENTFLOW_GITHUB_DOWNLOAD_MIRRORS);
  }
  return [
    ...parseMirrorTemplates(process.env.AGENTFLOW_GITHUB_DOWNLOAD_MIRRORS),
    ...BUILTIN_GITHUB_DOWNLOAD_MIRROR_TEMPLATES,
  ];
}

export function isGitHubReleaseDownloadUrl(downloadUrl: string): boolean {
  try {
    const url = new URL(downloadUrl);
    const host = url.hostname.toLowerCase();
    return (host === "github.com" || host === "www.github.com")
      && /\/releases\/download\//iu.test(url.pathname);
  } catch {
    return false;
  }
}

function parseMirrorTemplates(rawValue: string | undefined): string[] {
  return (rawValue ?? "")
    .split(/[\n,;]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function applyGitHubDownloadMirrorTemplate(template: string, originalUrl: string): string | null {
  const normalizedTemplate = template.trim();
  if (!normalizedTemplate) {
    return null;
  }

  const mirroredUrl = normalizedTemplate.includes("{url}") || normalizedTemplate.includes("{encodedUrl}")
    ? normalizedTemplate
      .replace(/\{url\}/gu, originalUrl)
      .replace(/\{encodedUrl\}/gu, encodeURIComponent(originalUrl))
    : `${normalizedTemplate.replace(/\/+$/u, "")}/${originalUrl}`;

  try {
    const parsed = new URL(mirroredUrl);
    if (parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function createGitHubDownloadMirrorId(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "mirror";
  }
}

function createGitHubDownloadMirrorLabel(url: string): string {
  const id = createGitHubDownloadMirrorId(url);
  return id === "github.com" ? "GitHub" : id;
}

function isEnvEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/iu.test(value?.trim() ?? "");
}

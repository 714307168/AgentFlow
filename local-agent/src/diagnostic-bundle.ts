import * as fs from "fs";
import * as path from "path";
import type { CliProviderRuntimeStatus } from "./cli-runtime-status";
import type { Project } from "./project-store";
import type { RemoteProjectRecord } from "./remote-session-store";
import type { ProjectSessionSnapshot } from "./runtime-types";

type DiagnosticProject = Project | RemoteProjectRecord;

export interface DiagnosticAppSettingsSummary {
  autoStart: boolean;
  silentLaunch: boolean;
  completionSound: boolean;
  saveLogs: boolean;
  e2eEnabled: boolean;
  autoUpdateCheck: boolean;
  autoUpdateDownload: boolean;
  silentUpdateInstall: boolean;
  historyRetentionDays: number;
}

export interface DiagnosticConfigSummary {
  serverUrl: string;
  agentId: string;
  username: string;
  controllerDeviceId: string;
  cliProvider: string;
  tokenConfigured: boolean;
  controllerTokenConfigured: boolean;
  openaiConfigured: boolean;
  anthropicConfigured: boolean;
  githubTokenConfigured: boolean;
}

export interface DiagnosticRelayHealthProbe {
  checkedAt: string;
  url: string;
  ok: boolean;
  status: number | null;
  responseText: string | null;
  reportedVersion: string | null;
  serverHeader: string | null;
  error: string | null;
}

export interface DiagnosticRelayApiSummary {
  requestedVersion: string;
  clientVersion: string;
  health: DiagnosticRelayHealthProbe | null;
}

export interface DiagnosticConnectionSummary {
  agent: unknown;
  controller: unknown;
}

export interface DiagnosticLocalDataMetrics {
  localDataRoot: string;
  logDirectory: string;
  attachments: { fileCount: number; totalBytes: number };
  updates: { fileCount: number; totalBytes: number };
  history: { fileCount: number; totalBytes: number };
  logs: { fileCount: number; totalBytes: number };
}

export interface DiagnosticProjectActivityWindowEntry {
  id: string;
  type: "message" | "activity" | "cli" | "queue";
  title: string;
  preview: string;
  status: string | null;
  at: number;
}

export interface DiagnosticProjectSummary {
  id: string;
  name: string;
  source: "local" | "remote";
  agentId: string | null;
  path: string;
  groupName: string | null;
  cliProvider: string;
  cliModel: string | null;
  projectPromptConfigured: boolean;
  codexWebSearchEnabled: boolean;
  online: boolean | null;
  isRunning: boolean;
  queuedCount: number;
  currentSource: string | null;
  currentStartedAt: number | null;
  projectSignature: string | null;
  syncBucket: string | null;
  activeConversationId: string | null;
  conversationCount: number;
  messageTotal: number;
  activityTotal: number;
  cliTraceTotal: number;
  latestConversationAt: number;
  latestMessageAt: number;
  latestActivityAt: number;
  latestCliAt: number;
  recentActivityWindow: DiagnosticProjectActivityWindowEntry[];
}

export interface DiagnosticBundleManifest {
  schemaVersion: 1;
  generatedAt: string;
  appVersion: string;
  host: {
    hostname: string;
    platform: string;
    release: string;
    arch: string;
  };
  config: DiagnosticConfigSummary;
  settings: DiagnosticAppSettingsSummary;
  connection: DiagnosticConnectionSummary;
  relayApi: DiagnosticRelayApiSummary;
  localData: DiagnosticLocalDataMetrics;
  providerRuntime: Record<string, CliProviderRuntimeStatus>;
  localProjects: DiagnosticProjectSummary[];
  remoteProjects: DiagnosticProjectSummary[];
  summary: {
    localProjectCount: number;
    remoteProjectCount: number;
    runningProjectCount: number;
    queuedRunCount: number;
  };
}

export interface DiagnosticBundleArtifacts {
  manifest: DiagnosticBundleManifest;
  desktopLogFileName: string | null;
  desktopLogContent: string | null;
}

export interface DiagnosticBundleWriteResult {
  bundleId: string;
  bundleDirectory: string;
  manifestPath: string;
  logPath: string | null;
}

function truncateText(value: string | null | undefined, maxLength: number): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function compareActivityEntries(left: DiagnosticProjectActivityWindowEntry, right: DiagnosticProjectActivityWindowEntry): number {
  if (left.at !== right.at) {
    return right.at - left.at;
  }
  return left.id.localeCompare(right.id, "en");
}

export function createDiagnosticProjectSummary(
  project: DiagnosticProject,
  snapshot: ProjectSessionSnapshot,
  source: "local" | "remote",
  options: { recentLimit?: number } = {},
): DiagnosticProjectSummary {
  const recentLimit = Number(options.recentLimit) > 0 ? Math.max(1, Math.floor(Number(options.recentLimit))) : 12;
  const recentActivityWindow: DiagnosticProjectActivityWindowEntry[] = [];

  for (const queued of snapshot.queue) {
    recentActivityWindow.push({
      id: `queue:${queued.runId}`,
      type: "queue",
      title: "Queued run",
      preview: truncateText(queued.prompt, 220),
      status: "queued",
      at: Number(queued.queuedAt) || 0,
    });
  }

  for (const message of snapshot.messages) {
    recentActivityWindow.push({
      id: `message:${message.id}`,
      type: "message",
      title: `${message.role} message`,
      preview: truncateText(message.content, 220),
      status: message.status,
      at: Math.max(Number(message.updatedAt) || 0, Number(message.createdAt) || 0),
    });
  }

  for (const activity of snapshot.activities) {
    recentActivityWindow.push({
      id: `activity:${activity.id}`,
      type: "activity",
      title: truncateText(activity.title, 80) || "Activity",
      preview: truncateText(activity.detail, 220),
      status: activity.status,
      at: Math.max(Number(activity.updatedAt) || 0, Number(activity.createdAt) || 0),
    });
  }

  for (const entry of snapshot.cliTrace) {
    recentActivityWindow.push({
      id: `cli:${entry.id}`,
      type: "cli",
      title: `${entry.stream} output`,
      preview: truncateText(entry.text, 220),
      status: entry.stream,
      at: Number(entry.createdAt) || 0,
    });
  }

  recentActivityWindow.sort(compareActivityEntries);

  const latestConversationAt = snapshot.conversations.reduce(
    (latest, conversation) => Math.max(latest, Number(conversation.updatedAt) || 0, Number(conversation.createdAt) || 0),
    0,
  );
  const latestMessageAt = snapshot.messages.reduce(
    (latest, message) => Math.max(latest, Number(message.updatedAt) || 0, Number(message.createdAt) || 0),
    0,
  );
  const latestActivityAt = snapshot.activities.reduce(
    (latest, activity) => Math.max(latest, Number(activity.updatedAt) || 0, Number(activity.createdAt) || 0),
    0,
  );
  const latestCliAt = snapshot.cliTrace.reduce(
    (latest, entry) => Math.max(latest, Number(entry.createdAt) || 0),
    0,
  );

  const projectAgentId = "agentId" in project && typeof project.agentId === "string"
    ? project.agentId
    : null;
  const projectOnline = "online" in project && typeof project.online === "boolean"
    ? project.online
    : null;

  return {
    id: project.id,
    name: project.name,
    source,
    agentId: projectAgentId,
    path: project.path,
    groupName: typeof project.groupName === "string" ? project.groupName : null,
    cliProvider: project.cliProvider,
    cliModel: typeof project.cliModel === "string" ? project.cliModel : null,
    projectPromptConfigured: Boolean(typeof project.projectPrompt === "string" && project.projectPrompt.trim()),
    codexWebSearchEnabled: project.codexWebSearchEnabled === true,
    online: projectOnline,
    isRunning: snapshot.isRunning,
    queuedCount: snapshot.queuedCount,
    currentSource: snapshot.currentSource,
    currentStartedAt: snapshot.currentStartedAt,
    projectSignature: snapshot.projectSignature,
    syncBucket: snapshot.syncBucket,
    activeConversationId: snapshot.activeConversationId,
    conversationCount: Array.isArray(snapshot.conversations) ? snapshot.conversations.length : 0,
    messageTotal: snapshot.messageTotal,
    activityTotal: snapshot.activityTotal,
    cliTraceTotal: snapshot.cliTraceTotal,
    latestConversationAt,
    latestMessageAt,
    latestActivityAt,
    latestCliAt,
    recentActivityWindow: recentActivityWindow.slice(0, recentLimit),
  };
}

export function buildDiagnosticBundleArtifacts(input: {
  generatedAt: string;
  appVersion: string;
  host: DiagnosticBundleManifest["host"];
  config: DiagnosticConfigSummary;
  settings: DiagnosticAppSettingsSummary;
  connection: DiagnosticConnectionSummary;
  relayApi: DiagnosticRelayApiSummary;
  localData: DiagnosticLocalDataMetrics;
  providerRuntime: Record<string, CliProviderRuntimeStatus>;
  localProjects: Array<{ project: Project; snapshot: ProjectSessionSnapshot }>;
  remoteProjects: Array<{ project: RemoteProjectRecord; snapshot: ProjectSessionSnapshot }>;
  desktopLogContent?: string | null;
  desktopLogFileName?: string | null;
}): DiagnosticBundleArtifacts {
  const localProjects = input.localProjects
    .map((entry) => createDiagnosticProjectSummary(entry.project, entry.snapshot, "local"))
    .sort((left, right) => Math.max(right.latestMessageAt, right.latestActivityAt, right.latestCliAt, right.latestConversationAt) - Math.max(left.latestMessageAt, left.latestActivityAt, left.latestCliAt, left.latestConversationAt));
  const remoteProjects = input.remoteProjects
    .map((entry) => createDiagnosticProjectSummary(entry.project, entry.snapshot, "remote"))
    .sort((left, right) => Math.max(right.latestMessageAt, right.latestActivityAt, right.latestCliAt, right.latestConversationAt) - Math.max(left.latestMessageAt, left.latestActivityAt, left.latestCliAt, left.latestConversationAt));

  const runningProjectCount = [...localProjects, ...remoteProjects].filter((project) => project.isRunning).length;
  const queuedRunCount = [...localProjects, ...remoteProjects].reduce((total, project) => total + project.queuedCount, 0);

  return {
    manifest: {
      schemaVersion: 1,
      generatedAt: input.generatedAt,
      appVersion: input.appVersion,
      host: input.host,
      config: input.config,
      settings: input.settings,
      connection: input.connection,
      relayApi: input.relayApi,
      localData: input.localData,
      providerRuntime: input.providerRuntime,
      localProjects,
      remoteProjects,
      summary: {
        localProjectCount: localProjects.length,
        remoteProjectCount: remoteProjects.length,
        runningProjectCount,
        queuedRunCount,
      },
    },
    desktopLogFileName: input.desktopLogFileName?.trim() || null,
    desktopLogContent: input.desktopLogContent?.trim() || null,
  };
}

export async function writeDiagnosticBundle(
  outputRoot: string,
  artifacts: DiagnosticBundleArtifacts,
  generatedAt: Date = new Date(),
): Promise<DiagnosticBundleWriteResult> {
  const bundleId = `desktop-diagnostics-${generatedAt.toISOString().replace(/[:.]/g, "-")}`;
  const bundleDirectory = path.join(outputRoot, bundleId);
  await fs.promises.mkdir(bundleDirectory, { recursive: true });

  const manifestPath = path.join(bundleDirectory, "manifest.json");
  await fs.promises.writeFile(
    manifestPath,
    `${JSON.stringify(artifacts.manifest, null, 2)}\n`,
    "utf8",
  );

  let logPath: string | null = null;
  if (artifacts.desktopLogFileName && artifacts.desktopLogContent) {
    const safeLogFileName = artifacts.desktopLogFileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
    logPath = path.join(bundleDirectory, safeLogFileName || "desktop.log");
    await fs.promises.writeFile(logPath, `${artifacts.desktopLogContent}\n`, "utf8");
  }

  return {
    bundleId,
    bundleDirectory,
    manifestPath,
    logPath,
  };
}

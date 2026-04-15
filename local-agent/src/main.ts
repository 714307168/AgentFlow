import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, safeStorage, clipboard, desktopCapturer, screen, shell, powerMonitor } from "electron";
import "./user-data-bootstrap";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Store from "electron-store";
import { v4 as uuidv4 } from "uuid";
import { createAppIcon, createTrayIcon } from "./app-icon";
import appLogger from "./app-logger";
import { createCoalescedTrigger } from "./coalesced-trigger";
import { createKeyedTimedAsyncCache } from "./keyed-timed-async-cache";
import { createRequestGate } from "./request-gate";
import { createTimedAsyncCache } from "./timed-async-cache";
import RelayClient, { RelayConnectionSnapshot } from "./relay-client";
import MessageRouter from "./message-router";
import projectStore, {
  normalizeCodexWebSearchEnabled,
  normalizeProjectGroupName,
  Project,
} from "./project-store";
import ptyManager from "./pty-manager";
import RemoteSessionStore, { RemoteProjectRecord } from "./remote-session-store";
import RemoteWorkgroupStore, { RemoteWorkgroupRegistryRecord, parseCompositeWorkgroupId } from "./remote-workgroup-store";
import LocalScheduler from "./local-scheduler";
import WorkgroupTaskScheduler from "./workgroup-task-scheduler";
import RuntimeManager, { CliProvider, ProjectSessionSnapshot, RunAttachment } from "./runtime-manager";
import scheduledTaskStore, {
  computeScheduledTaskNextRunAt,
  normalizeDailyTime,
  normalizeWeeklyDay,
  ScheduledTask,
  ScheduledTaskScheduleType,
} from "./scheduled-task-store";
import workgroupStore, { Workgroup, WorkgroupMember, WorkgroupRole, WorkgroupTask, WorkgroupTaskStatus } from "./workgroup-store";
import WorkgroupCollaborationService, {
  CollaborationBoundProject,
  WorkgroupCollaborationSessionSnapshot,
  WorkgroupCollaborationSummary,
} from "./workgroup-collaboration-service";
import { buildSessionSyncPayload } from "./session-sync-payload";
import { shouldUseSummaryOnlyProjectSync, type RemoteProjectSyncDetailMode } from "./remote-project-sync-priority";
import {
  type SessionSyncKnownItemDigest,
} from "./session-sync-hash";
import UpdateManager, { UpdateState } from "./update-manager";
import { Events } from "./types";
import { t, getLang, setLang, getAllMessages, Lang } from "./i18n";
import { buildRelayApiHeaders, getRelayApiClientVersion, RELAY_API_VERSION } from "./api-version";
import { fetchRelayJson } from "./relay-http";
import {
  buildImagePreviewDataUrlFromNativeImage,
  createRunAttachmentFromPath,
  getUniqueAttachmentPath,
  guessMimeType,
  isImageAttachment,
} from "./attachment-utils";
import { WorkgroupRelayCache } from "./workgroup-relay-cache";
import { buildWorkgroupCollaborationSessionRelayPayload as createWorkgroupCollaborationSessionRelayPayload } from "./workgroup-collaboration-relay-payload";
import {
  getDefaultLocalDataRoot,
  getPersistedLocalDataRoot,
  localDataRootsEqual,
  migrateLocalDataRoot,
  persistLocalDataRoot,
  resolveLocalDataRoot,
} from "./user-data-bootstrap";
import { playSystemNotificationSound } from "./desktop-sound";
import { getCliProviderRuntimeStatuses, probeCliProviderRuntime, type CliProviderRuntimeStatus } from "./cli-runtime-status";
import { upgradeCliProvider } from "./cli-updater";
import { selectProviderRuntime, type ProviderRuntimeSelection } from "./provider-runtime";
import { isProviderSdkConfigured, type ProviderSdkConfig } from "./provider-sdk";
import {
  buildProviderEnvironment,
  getProviderDefaultSdkModel,
  getProviderSdkConfigValue,
  hasProviderApiFallback,
  normalizeCliProvider as normalizeRegisteredCliProvider,
  type ProviderConfigSnapshot,
} from "./provider-registry";
import { createLocalCommandGateway, defineLocalCommand, type LocalCommandDescriptor } from "./local-command-gateway";
import { buildGitHubCommandEnvironment } from "./github-command-env";
import {
  createWorkgroupRegistryMembersCacheKey,
  normalizeWorkgroupRegistrySearchQuery,
  parseWorkgroupRegistryMembersCacheKey,
  type WorkgroupRegistryMembersQuery,
} from "./workgroup-registry-query";
import { buildDiagnosticBundleArtifacts, writeDiagnosticBundle } from "./diagnostic-bundle";

interface AgentConfig {
  serverUrl: string;
  agentId: string;
  token: string;
  username?: string;
  password?: string;
  tokenExpiresAt?: string;
  controllerDeviceId?: string;
  controllerToken?: string;
  controllerTokenExpiresAt?: string;
  encryptedToken?: string;
  encryptedPassword?: string;
  encryptedControllerToken?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiDefaultModel?: string;
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  anthropicDefaultModel?: string;
  githubToken?: string;
  encryptedOpenaiApiKey?: string;
  encryptedAnthropicApiKey?: string;
  encryptedGithubToken?: string;
  cliProvider: CliProvider;
}

interface AppSettings {
  autoStart: boolean;
  silentLaunch: boolean;
  completionSound: boolean;
  saveLogs: boolean;
  e2eEnabled: boolean;
  autoUpdateCheck: boolean;
  autoUpdateDownload: boolean;
  silentUpdateInstall: boolean;
  historyRetentionDays: number;
  localDataRoot: string;
}

interface RelayTransferReceiptSummary {
  id: number;
  client_type: string;
  agent_id?: string;
  device_id?: string;
  status: string;
  note?: string;
  created_at: string;
}

interface WorkgroupRegistryMemberRecord {
  userId: number;
  username: string;
  isOwner: boolean;
  joinedAt: number;
}

interface WorkgroupRegistryMembersResponse {
  record: WorkgroupRegistryRecord;
  members: WorkgroupRegistryMemberRecord[];
}

interface RelayTransferRecord {
  id: string;
  sender_type: string;
  sender_agent_id?: string;
  sender_device_id?: string;
  target_type?: string;
  target_id?: string;
  project_id?: string;
  workgroup_id?: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: string;
  created_at: string;
  expires_at?: string;
  download_url?: string;
  receipts?: RelayTransferReceiptSummary[];
}

interface RelayDeviceSummary {
  id: string;
  user_id: number;
  username: string;
  agent_id?: string;
  note?: string;
  created_at: string;
  online?: boolean;
  presence_state?: string;
  last_active_at?: string;
  last_seen_at?: string;
}

interface RelayTransferListOptions {
  limit?: number;
  targetType?: string | null;
  targetId?: string | null;
  projectId?: string | null;
  workgroupId?: string | null;
  includeReceipts?: boolean;
  force?: boolean;
}

interface RelayTransferCreateOptions {
  targetType?: string | null;
  targetId?: string | null;
  projectId?: string | null;
  workgroupId?: string | null;
  expiresInHours?: number | null;
}

type SettingsPane = "overview" | "connection" | "project" | "message" | "automation" | "advanced";

interface PersistedWindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

interface WindowStateSchema {
  settingsWindow: PersistedWindowState;
  workspaceWindow: PersistedWindowState;
}

interface ResolvedWorkgroupProjectBinding {
  projectId: string | null;
  projectName: string | null;
  projectPath: string | null;
  projectKind: "local" | "remote" | null;
  projectExists: boolean;
  projectOnline: boolean;
}

interface WorkgroupMemberView extends Omit<WorkgroupMember, "projectId" | "projectName" | "projectPath" | "projectKind">, ResolvedWorkgroupProjectBinding {
  projectBindingLabel: string;
}

interface WorkgroupTaskView extends WorkgroupTask {
  assigneeMemberName: string | null;
  assigneeRole: WorkgroupRole | null;
  assigneeProjectName: string | null;
  assigneeProjectKind: "local" | "remote" | null;
  assigneeProjectOnline: boolean;
  assigneeProjectBindingLabel: string | null;
  dispatchReady: boolean;
  dispatchBlockedReason: string | null;
}

interface WorkgroupView extends Workgroup {
  members: WorkgroupMemberView[];
  tasks: WorkgroupTaskView[];
  selectedProjectIds: string[];
}

interface ScheduledTaskView extends ScheduledTask {
  projectName: string | null;
  projectPath: string | null;
  projectMissing: boolean;
}

interface WorkgroupRegistryRecord {
  groupNumber: string;
  workgroupId: string;
  hostAgentId: string;
  name: string;
  description: string | null;
  ownerUsername: string;
  memberCount?: number;
  canManage?: boolean;
  joined?: boolean;
  updatedAt: number;
}

const WORKGROUP_PM_PROJECT_PREFIX = "__workgroup_pm__:";

const configStore = new Store<AgentConfig>({
  defaults: {
    serverUrl: "ws://localhost:8080/ws",
    agentId: "",
    token: "",
    username: "",
    tokenExpiresAt: "",
    controllerDeviceId: "",
    controllerToken: "",
    controllerTokenExpiresAt: "",
    encryptedToken: "",
    encryptedPassword: "",
    encryptedControllerToken: "",
    openaiApiKey: "",
    openaiBaseUrl: "",
    openaiDefaultModel: "",
    anthropicApiKey: "",
    anthropicBaseUrl: "",
    anthropicDefaultModel: "",
    githubToken: "",
    encryptedOpenaiApiKey: "",
    encryptedAnthropicApiKey: "",
    encryptedGithubToken: "",
    cliProvider: "claude",
  },
});

const appSettingsStore = new Store<AppSettings>({
  name: "app-settings",
  defaults: {
    autoStart: false,
    silentLaunch: false,
    completionSound: true,
    saveLogs: false,
    e2eEnabled: true,
    autoUpdateCheck: true,
    autoUpdateDownload: false,
    silentUpdateInstall: false,
    historyRetentionDays: 30,
    localDataRoot: "",
  },
});

const windowStateStore = new Store<WindowStateSchema>({
  name: "window-state",
  defaults: {
    settingsWindow: {
      width: 800,
      height: 700,
      maximized: false,
    },
    workspaceWindow: {
      width: 1000,
      height: 700,
      maximized: false,
    },
  },
});

appLogger.setEnabled(appSettingsStore.get("saveLogs") as boolean);
appLogger.installConsoleCapture();

function syncLocalDataRootSetting(nextRoot: string = app.getPath("userData")): void {
  const normalizedRoot = String(nextRoot ?? "").trim();
  if ((appSettingsStore.get("localDataRoot") as string | undefined) !== normalizedRoot) {
    appSettingsStore.set("localDataRoot", normalizedRoot);
  }
}

syncLocalDataRootSetting();

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let workspaceWindow: BrowserWindow | null = null;
let activeWorkspaceProjectId: string | null = null;
let activeWorkgroupCollaborationId: string | null = null;
let activeSettingsPane: SettingsPane = "overview";
let relayClient: RelayClient | null = null;
let controllerRelayClient: RelayClient | null = null;
let remoteSessionStore: RemoteSessionStore | null = null;
let remoteWorkgroupStore: RemoteWorkgroupStore | null = null;
const lastBroadcastSyncSeqByProject = new Map<string, number>();
const updateManager = new UpdateManager({
  getServerUrl: () => loadConfig().serverUrl,
  getAutoCheckEnabled: () => appSettingsStore.get("autoUpdateCheck") as boolean,
  getAutoDownloadEnabled: () => appSettingsStore.get("autoUpdateDownload") as boolean,
  getSilentInstallEnabled: () => appSettingsStore.get("silentUpdateInstall") as boolean,
  canInstallNow: () => !runtimeManager.hasActiveOrQueuedRuns(),
  prepareForSilentInstall: async () => {
    if (relayClient) {
      relayClient.disconnect();
    }
    if (workspaceWindow && !workspaceWindow.isDestroyed()) {
      workspaceWindow.hide();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  },
  getParentWindow: () => workspaceWindow ?? mainWindow ?? null,
});
const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const MIN_TOKEN_REFRESH_DELAY_MS = 30 * 1000;
const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;
let tokenRefreshTimer: NodeJS.Timeout | null = null;
let tokenRefreshPromise: Promise<boolean> | null = null;
let controllerTokenRefreshTimer: NodeJS.Timeout | null = null;
let controllerTokenRefreshPromise: Promise<boolean> | null = null;
const relaySyncTimersByProject = new Map<string, NodeJS.Timeout>();
const pendingRelaySyncSnapshotsByProject = new Map<string, ProjectSessionSnapshot>();
const lastBroadcastSyncPayloadHashByProject = new Map<string, string>();
const RELAY_SYNC_DEBOUNCE_MS = 250;
let lastWorkgroupRelayPayloadRevision = "";
const workgroupRelayCache = new WorkgroupRelayCache<WorkgroupView>();
const workgroupCollaborationRelaySnapshotTimers = new Map<string, NodeJS.Timeout>();
const pendingWorkgroupCollaborationRelaySnapshots = new Map<string, WorkgroupCollaborationSessionSnapshot>();
const lastBroadcastWorkgroupCollaborationSnapshotHashByWorkgroup = new Map<string, string>();
const WORKGROUP_COLLABORATION_RELAY_DEBOUNCE_MS = 200;
let lastWorkgroupCollaborationRelayPayloadHash = "";
const REMOTE_PROJECT_CATALOG_REFRESH_MIN_INTERVAL_MS = 5_000;
const UI_REMOTE_PROJECT_REFRESH_COALESCE_MS = 1_200;
const REMOTE_WORKGROUP_CATALOG_REFRESH_MIN_INTERVAL_MS = 15_000;
const RELAY_HEALTH_CHECK_INTERVAL_MS = 15_000;
const RELAY_MAINTENANCE_INTERVAL_MS = 60_000;
const RELAY_DIAGNOSTIC_HEALTH_TIMEOUT_MS = 4_000;
const MAX_DESKTOP_LOG_UPLOAD_BYTES = 1_600_000;
const MAX_DESKTOP_LOG_FILES = 4;
const MAX_DESKTOP_LOG_EXTRACTED_IDS = 20;
const DESKTOP_DIAGNOSTIC_EXPORT_DIRECTORY = "diagnostics";
const RELAY_DEVICE_LIST_CACHE_TTL_MS = 15_000;
const RELAY_TRANSFER_LIST_CACHE_TTL_MS = 8_000;
const ACCESS_GRANTS_CACHE_TTL_MS = 8_000;
const WORKGROUP_REGISTRY_SEARCH_CACHE_TTL_MS = 12_000;
const WORKGROUP_REGISTRY_MEMBERS_CACHE_TTL_MS = 12_000;
const CLI_PROVIDER_RUNTIME_STATUS_CACHE_TTL_MS = 15_000;
const CLI_PROVIDER_AUTO_UPGRADE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DESKTOP_LOG_TRACE_ID_PATTERN = /(?:trace[_-]?id["=: ]+|traceId["=: ]+)([a-z0-9:-]{6,})/ig;
const DESKTOP_LOG_WORKGROUP_ID_PATTERN = /(?:workgroup[_-]?id["=: ]+|workgroupId["=: ]+)([a-z0-9._:-]{3,})/ig;
const RELAY_FOLLOW_UP_REFRESH_DELAYS_MS = [300, 1_500, 5_000] as const;
const RELAY_STALE_CONNECTION_TIMEOUT_MS = 75_000;
const RELAY_RECOVERY_COOLDOWN_MS = 45_000;
const RELAY_FORCE_RECOVERY_AFTER_MS = 90_000;
const ACTIVE_REMOTE_PROJECT_SYNC_MIN_INTERVAL_MS = 3_000;
const REMOTE_PROJECT_SYNC_PENDING_TIMEOUT_MS = 10_000;
const REMOTE_PROJECT_FOLLOW_UP_SYNC_LIMIT = 4;
const REMOTE_WORKGROUP_SESSION_SYNC_MIN_INTERVAL_MS = 3_000;
const REMOTE_WORKGROUP_SESSION_SYNC_PENDING_TIMEOUT_MS = 15_000;
const REMOTE_WORKGROUP_FOLLOW_UP_SYNC_LIMIT = 4;
let lastRemoteProjectCatalogRefreshAt = 0;
let remoteProjectCatalogRefreshTimer: NodeJS.Timeout | null = null;
let lastRemoteWorkgroupCatalogRefreshAt = 0;
let relayHealthCheckTimer: NodeJS.Timeout | null = null;
let relayMaintenanceTimer: NodeJS.Timeout | null = null;
let lastActiveRemoteProjectSyncAt = 0;
let lastAgentRelayRecoveryAt = 0;
let lastControllerRelayRecoveryAt = 0;
const relayFollowUpRefreshTimers = new Set<NodeJS.Timeout>();
const lastCliProviderAutoUpgradeAt = new Map<CliProvider, number>();
const pendingCliProviderAutoUpgrades = new Map<CliProvider, Promise<CliProviderRuntimeStatus>>();
const cliProviderRuntimeStatusCache = createTimedAsyncCache<Record<CliProvider, CliProviderRuntimeStatus>>({
  ttlMs: CLI_PROVIDER_RUNTIME_STATUS_CACHE_TTL_MS,
  load: getCliProviderRuntimeStatuses,
});
const remoteProjectSyncGate = createRequestGate({
  minIntervalMs: ACTIVE_REMOTE_PROJECT_SYNC_MIN_INTERVAL_MS,
  pendingTimeoutMs: REMOTE_PROJECT_SYNC_PENDING_TIMEOUT_MS,
});
const remoteWorkgroupSessionSyncGate = createRequestGate({
  minIntervalMs: REMOTE_WORKGROUP_SESSION_SYNC_MIN_INTERVAL_MS,
  pendingTimeoutMs: REMOTE_WORKGROUP_SESSION_SYNC_PENDING_TIMEOUT_MS,
});

function clearCliProviderRuntimeStatusCache(): void {
  cliProviderRuntimeStatusCache.clear();
}

async function loadCliProviderRuntimeStatuses(options: { force?: boolean } = {}): Promise<Record<CliProvider, CliProviderRuntimeStatus>> {
  return await cliProviderRuntimeStatusCache.get({ force: options.force === true });
}

function getProviderSdkConfig(provider: CliProvider): ProviderSdkConfig | null {
  const config = loadConfig();
  return {
    apiKey: getProviderSdkConfigValue(config, provider, "apiKey"),
    baseUrl: getProviderSdkConfigValue(config, provider, "baseUrl"),
    defaultModel: getProviderSdkConfigValue(config, provider, "defaultModel"),
  };
}

function canAutoUpgradeCliProvider(status: CliProviderRuntimeStatus | null | undefined): status is CliProviderRuntimeStatus {
  return Boolean(
    status
    && status.installed
    && status.upgrade.available
    && status.installMethod
    && status.upgrade.command,
  );
}

async function maybeAutoUpgradeCliProvider(status: CliProviderRuntimeStatus): Promise<CliProviderRuntimeStatus> {
  if (!canAutoUpgradeCliProvider(status)) {
    return status;
  }

  const pendingUpgrade = pendingCliProviderAutoUpgrades.get(status.provider);
  if (pendingUpgrade) {
    return await pendingUpgrade;
  }

  const lastStartedAt = lastCliProviderAutoUpgradeAt.get(status.provider) ?? 0;
  if (Date.now() - lastStartedAt < CLI_PROVIDER_AUTO_UPGRADE_COOLDOWN_MS) {
    return status;
  }

  const upgradePromise = (async () => {
    lastCliProviderAutoUpgradeAt.set(status.provider, Date.now());
    appLogger.info("runtime", "Attempting automatic CLI upgrade.", {
      provider: status.provider,
      version: status.version,
      installMethod: status.installMethod,
      command: status.upgrade.commandPreview,
      reason: status.upgrade.reason,
    });

    const result = await upgradeCliProvider(status.provider, status.installMethod);
    if (!result.success) {
      appLogger.warn("runtime", "Automatic CLI upgrade failed.", {
        provider: status.provider,
        command: result.commandPreview,
        error: result.error,
        output: result.output,
      });
      return status;
    }

    appLogger.info("runtime", "Automatic CLI upgrade completed.", {
      provider: status.provider,
      command: result.commandPreview,
      output: result.output,
    });

    clearCliProviderRuntimeStatusCache();
    return await probeCliProviderRuntime(status.provider);
  })();

  pendingCliProviderAutoUpgrades.set(status.provider, upgradePromise);
  try {
    return await upgradePromise;
  } finally {
    if (pendingCliProviderAutoUpgrades.get(status.provider) === upgradePromise) {
      pendingCliProviderAutoUpgrades.delete(status.provider);
    }
  }
}

async function getCliProviderRuntimeStatus(
  provider: CliProvider,
  options: { force?: boolean; allowAutoUpgrade?: boolean } = {},
): Promise<CliProviderRuntimeStatus> {
  const statuses = await loadCliProviderRuntimeStatuses({ force: options.force === true });
  const status = statuses[provider] ?? await probeCliProviderRuntime(provider);
  if (!options.allowAutoUpgrade) {
    return status;
  }
  return await maybeAutoUpgradeCliProvider(status);
}

async function resolveProviderRuntime(projectId: string, provider: CliProvider): Promise<ProviderRuntimeSelection> {
  const cliStatus = await getCliProviderRuntimeStatus(provider, { allowAutoUpgrade: true });
  const sdkConfig = getProviderSdkConfig(provider);
  const runtime = selectProviderRuntime({
    provider,
    cliStatus,
    sdkConfigured: isProviderSdkConfigured(sdkConfig),
  });
  appLogger.info("runtime", "Resolved provider runtime.", {
    projectId,
    provider,
    runtimeKind: runtime.kind,
    detail: runtime.detail,
    cliInstalled: cliStatus.installed,
    cliVersion: cliStatus.version,
    upgradeAvailable: cliStatus.upgrade.available,
    sdkConfigured: runtime.sdkConfigured,
  });
  return runtime;
}
const uiRemoteProjectRefreshTrigger = createCoalescedTrigger({
  minIntervalMs: UI_REMOTE_PROJECT_REFRESH_COALESCE_MS,
});

function clampTimeoutDelayMs(delayMs: number): number {
  if (!Number.isFinite(delayMs)) {
    return MIN_TOKEN_REFRESH_DELAY_MS;
  }
  return Math.min(Math.max(MIN_TOKEN_REFRESH_DELAY_MS, Math.trunc(delayMs)), MAX_TIMEOUT_DELAY_MS);
}

function normalizeIncomingAttachments(payload: unknown): RunAttachment[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .filter((entry): entry is Partial<RunAttachment> => Boolean(entry) && typeof entry === "object")
    .map((entry) => {
      const filePath = typeof entry.path === "string" ? path.resolve(entry.path) : "";
      if (!filePath || !fs.existsSync(filePath)) {
        return null;
      }
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        return null;
      }

      return createRunAttachmentFromPath(filePath, {
        id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : uuidv4(),
        name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : path.basename(filePath),
        size: Number.isFinite(entry.size) ? Math.max(0, Number(entry.size)) : stats.size,
        kind: entry.kind === "image" || isImageAttachment(filePath) ? "image" : "file",
        mimeType: typeof entry.mimeType === "string" ? entry.mimeType : undefined,
        previewDataUrl: typeof entry.previewDataUrl === "string" ? entry.previewDataUrl : undefined,
      });
    })
    .filter((entry): entry is RunAttachment => entry !== null);
}

function encodeSecretForStore(secret: string): string {
  if (!secret) {
    return "";
  }

  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(secret).toString("base64")}`;
  }

  return `plain:${Buffer.from(secret, "utf8").toString("base64")}`;
}

function decodeSecretFromStore(storedValue?: string): string {
  if (!storedValue) {
    return "";
  }

  if (storedValue.startsWith("enc:")) {
    if (!safeStorage.isEncryptionAvailable()) {
      return "";
    }

    try {
      return safeStorage.decryptString(Buffer.from(storedValue.slice(4), "base64"));
    } catch (_error) {
      return "";
    }
  }

  if (storedValue.startsWith("plain:")) {
    try {
      return Buffer.from(storedValue.slice(6), "base64").toString("utf8");
    } catch (_error) {
      return "";
    }
  }

  return storedValue;
}

function toHttpBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "http://localhost:8080";
  }

  if (trimmed.startsWith("ws://")) {
    return `http://${trimmed.slice(5).replace(/\/ws$/, "")}`;
  }
  if (trimmed.startsWith("wss://")) {
    return `https://${trimmed.slice(6).replace(/\/ws$/, "")}`;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/\/ws$/, "");
  }

  return `http://${trimmed.replace(/\/ws$/, "")}`;
}

function buildDesktopLogConnectionNote(fileCount: number): string {
  const parts = [
    `host=${os.hostname()}`,
    `platform=${process.platform}`,
    `release=${os.release()}`,
    `files=${fileCount}`,
  ];
  const agentSnapshot = relayClient?.getConnectionSnapshot();
  const controllerSnapshot = controllerRelayClient?.getConnectionSnapshot();
  if (agentSnapshot) {
    parts.push(`agent=${agentSnapshot.state}`);
  }
  if (controllerSnapshot) {
    parts.push(`controller=${controllerSnapshot.state}`);
  }
  return parts.join("; ");
}

function extractDesktopLogIds(content: string, pattern: RegExp): string[] | undefined {
  const values = new Set<string>();
  pattern.lastIndex = 0;
  for (const match of content.matchAll(pattern)) {
    const rawValue = match[1] ?? "";
    const value = rawValue.trim().replace(/^[\"'.,;:()[\]{}<>]+|[\"'.,;:()[\]{}<>]+$/g, "");
    if (!value) {
      continue;
    }
    values.add(value);
    if (values.size >= MAX_DESKTOP_LOG_EXTRACTED_IDS) {
      break;
    }
  }
  return values.size > 0 ? Array.from(values) : undefined;
}

function buildDesktopLogUploadSegment(fileName: string, content: string, remainingBytes: number): { segment: string; bytes: number } | null {
  const header = `===== ${fileName} =====\n`;
  const headerBytes = Buffer.byteLength(header, "utf8");
  if (headerBytes >= remainingBytes) {
    return null;
  }

  const normalizedContent = content.replace(/\r\n/g, "\n").trim();
  const contentBytes = Buffer.byteLength(normalizedContent, "utf8");
  const availableContentBytes = remainingBytes - headerBytes;
  let finalContent = normalizedContent;
  if (contentBytes > availableContentBytes) {
    const truncationPrefix = "... earlier desktop log content omitted ...\n";
    const truncationBytes = Buffer.byteLength(truncationPrefix, "utf8");
    const encodedContent = Buffer.from(normalizedContent, "utf8");
    if (availableContentBytes > truncationBytes + 32) {
      const tailBytes = availableContentBytes - truncationBytes;
      const truncated = encodedContent
        .slice(-tailBytes)
        .toString("utf8")
        .trimStart();
      finalContent = `${truncationPrefix}${truncated}`;
    } else {
      finalContent = encodedContent
        .slice(-availableContentBytes)
        .toString("utf8")
        .trimStart();
    }
  }

  const segment = `${header}${finalContent}\n`;
  return {
    segment,
    bytes: Buffer.byteLength(segment, "utf8"),
  };
}

function summarizeDirectoryTree(targetPath: string): { fileCount: number; totalBytes: number } {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { fileCount: 0, totalBytes: 0 };
  }

  const pendingPaths = [targetPath];
  let fileCount = 0;
  let totalBytes = 0;

  while (pendingPaths.length > 0) {
    const currentPath = pendingPaths.pop();
    if (!currentPath) {
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(currentPath);
    } catch (_error) {
      continue;
    }

    if (stat.isFile()) {
      fileCount += 1;
      totalBytes += stat.size;
      continue;
    }

    if (!stat.isDirectory()) {
      continue;
    }

    let entries: string[] = [];
    try {
      entries = fs.readdirSync(currentPath);
    } catch (_error) {
      continue;
    }

    for (const entry of entries) {
      pendingPaths.push(path.join(currentPath, entry));
    }
  }

  return { fileCount, totalBytes };
}

type LocalDataCleanupTarget = "attachments" | "updates" | "all";

const LOCAL_DATA_CLEANUP_DIRECTORIES: Record<Exclude<LocalDataCleanupTarget, "all">, string> = {
  attachments: "runtime-attachments",
  updates: "updates",
};

function isNestedPath(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function clearDirectoryContents(targetPath: string): { removedEntries: number } {
  fs.mkdirSync(targetPath, { recursive: true });
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  let removedEntries = 0;

  for (const entry of entries) {
    fs.rmSync(path.join(targetPath, entry.name), { recursive: true, force: true });
    removedEntries += 1;
  }

  return { removedEntries };
}

function clearLocalDataCleanupTarget(target: LocalDataCleanupTarget | string): {
  target: LocalDataCleanupTarget;
  clearedTargets: Array<Exclude<LocalDataCleanupTarget, "all">>;
  removedEntries: number;
  metrics: ReturnType<typeof buildLocalDataMetrics>;
} {
  if (target !== "attachments" && target !== "updates" && target !== "all") {
    throw new Error(`Unsupported local data cleanup target: ${target}`);
  }
  const localDataRoot = getPersistedLocalDataRoot();
  const clearedTargets = (target === "all"
    ? Object.keys(LOCAL_DATA_CLEANUP_DIRECTORIES)
    : [target]) as Array<Exclude<LocalDataCleanupTarget, "all">>;
  let removedEntries = 0;

  for (const currentTarget of clearedTargets) {
    const absoluteTargetPath = path.resolve(localDataRoot, LOCAL_DATA_CLEANUP_DIRECTORIES[currentTarget]);
    if (!isNestedPath(localDataRoot, absoluteTargetPath)) {
      throw new Error(`Refused to clear path outside local data root: ${absoluteTargetPath}`);
    }
    removedEntries += clearDirectoryContents(absoluteTargetPath).removedEntries;
  }

  const metrics = buildLocalDataMetrics();
  appLogger.info("settings", "Cleared local transfer cache.", {
    target,
    clearedTargets,
    removedEntries,
    localDataRoot,
  });

  return {
    target,
    clearedTargets,
    removedEntries,
    metrics,
  };
}

function buildLocalDataMetrics(): {
  localDataRoot: string;
  logDirectory: string;
  attachments: { fileCount: number; totalBytes: number };
  updates: { fileCount: number; totalBytes: number };
  history: { fileCount: number; totalBytes: number };
  logs: { fileCount: number; totalBytes: number };
} {
  const localDataRoot = getPersistedLocalDataRoot();
  const logDirectory = appLogger.getLogDirectory();

  return {
    localDataRoot,
    logDirectory,
    attachments: summarizeDirectoryTree(path.join(localDataRoot, "runtime-attachments")),
    updates: summarizeDirectoryTree(path.join(localDataRoot, "updates")),
    history: summarizeDirectoryTree(path.join(localDataRoot, "runtime-history")),
    logs: summarizeDirectoryTree(logDirectory),
  };
}

function buildDiagnosticConfigSummary() {
  const config = loadConfig();
  return {
    serverUrl: config.serverUrl?.trim() ?? "",
    agentId: config.agentId?.trim() ?? "",
    username: config.username?.trim() ?? "",
    controllerDeviceId: config.controllerDeviceId?.trim() ?? "",
    cliProvider: config.cliProvider,
    tokenConfigured: Boolean(config.token?.trim()),
    controllerTokenConfigured: Boolean(config.controllerToken?.trim()),
    openaiConfigured: hasProviderApiFallback(config, "codex"),
    anthropicConfigured: hasProviderApiFallback(config, "claude"),
    githubTokenConfigured: Boolean(config.githubToken?.trim()),
  };
}

function buildDiagnosticAppSettingsSummary() {
  return {
    autoStart: appSettingsStore.get("autoStart") as boolean,
    silentLaunch: appSettingsStore.get("silentLaunch") as boolean,
    completionSound: appSettingsStore.get("completionSound") as boolean,
    saveLogs: appSettingsStore.get("saveLogs") as boolean,
    e2eEnabled: appSettingsStore.get("e2eEnabled") as boolean,
    autoUpdateCheck: appSettingsStore.get("autoUpdateCheck") as boolean,
    autoUpdateDownload: appSettingsStore.get("autoUpdateDownload") as boolean,
    silentUpdateInstall: appSettingsStore.get("silentUpdateInstall") as boolean,
    historyRetentionDays: appSettingsStore.get("historyRetentionDays") as number,
  };
}

function truncateDiagnosticText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

async function probeRelayHealthForDiagnostics(): Promise<{
  checkedAt: string;
  url: string;
  ok: boolean;
  status: number | null;
  responseText: string | null;
  reportedVersion: string | null;
  serverHeader: string | null;
  error: string | null;
} | null> {
  const serverUrl = loadConfig().serverUrl?.trim() ?? "";
  if (!serverUrl) {
    return null;
  }

  const url = `${toHttpBaseUrl(serverUrl)}/health`;
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAY_DIAGNOSTIC_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: buildRelayApiHeaders(),
      signal: controller.signal,
    });
    const responseText = truncateDiagnosticText((await response.text()).trim(), 120) || null;
    return {
      checkedAt,
      url,
      ok: response.ok,
      status: response.status,
      responseText,
      reportedVersion: response.headers.get("x-agentflow-server-version")
        || response.headers.get("x-relay-version")
        || response.headers.get("x-agentflow-api-version"),
      serverHeader: response.headers.get("server"),
      error: null,
    };
  } catch (error) {
    return {
      checkedAt,
      url,
      ok: false,
      status: null,
      responseText: null,
      reportedVersion: null,
      serverHeader: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function exportDesktopDiagnosticsBundle(): Promise<{
  success: boolean;
  error?: string;
  bundlePath?: string;
  manifestPath?: string;
  logPath?: string | null;
}> {
  try {
    const generatedAt = new Date();
    const [providerRuntime, relayHealth] = await Promise.all([
      loadCliProviderRuntimeStatuses({ force: false }),
      probeRelayHealthForDiagnostics(),
    ]);

    let desktopLogFileName: string | null = null;
    let desktopLogContent: string | null = null;
    try {
      const payload = await buildDesktopLogUploadPayload();
      desktopLogFileName = payload.fileName;
      desktopLogContent = payload.content;
    } catch (error) {
      appLogger.warn("diagnostics", "Skipped desktop log payload while exporting diagnostics bundle.", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const localProjects = projectStore.getAll()
      .map((project) => ({
        project,
        snapshot: runtimeManager.getSnapshot(project.id),
      }));
    const remoteProjects = (remoteSessionStore?.getProjects() ?? [])
      .map((project) => ({
        project,
        snapshot: remoteSessionStore?.getSnapshot(project.id) ?? null,
      }))
      .filter((entry): entry is { project: RemoteProjectRecord; snapshot: ProjectSessionSnapshot } => Boolean(entry.snapshot));

    const artifacts = buildDiagnosticBundleArtifacts({
      generatedAt: generatedAt.toISOString(),
      appVersion: app.getVersion(),
      host: {
        hostname: os.hostname(),
        platform: process.platform,
        release: os.release(),
        arch: process.arch,
      },
      config: buildDiagnosticConfigSummary(),
      settings: buildDiagnosticAppSettingsSummary(),
      connection: buildConnectionStatusSnapshot(),
      relayApi: {
        requestedVersion: RELAY_API_VERSION,
        clientVersion: getRelayApiClientVersion(),
        health: relayHealth,
      },
      localData: buildLocalDataMetrics(),
      providerRuntime,
      localProjects,
      remoteProjects,
      desktopLogFileName,
      desktopLogContent,
    });

    const outputRoot = path.join(getPersistedLocalDataRoot(), DESKTOP_DIAGNOSTIC_EXPORT_DIRECTORY);
    const written = await writeDiagnosticBundle(outputRoot, artifacts, generatedAt);
    appLogger.info("diagnostics", "Exported desktop diagnostics bundle.", {
      bundleDirectory: written.bundleDirectory,
      localProjectCount: artifacts.manifest.summary.localProjectCount,
      remoteProjectCount: artifacts.manifest.summary.remoteProjectCount,
      runningProjectCount: artifacts.manifest.summary.runningProjectCount,
    });

    return {
      success: true,
      bundlePath: written.bundleDirectory,
      manifestPath: written.manifestPath,
      logPath: written.logPath,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function buildDesktopLogUploadPayload(): Promise<{
  fileName: string;
  content: string;
  appVersion: string;
  appBuild: number;
  deviceModel: string;
  clientTime: string;
  source: "desktop";
  connectionNote: string;
  traceIds?: string[];
  workgroupIds?: string[];
}> {
  await appLogger.flush();
  const logDirectory = appLogger.getLogDirectory();
  if (!fs.existsSync(logDirectory)) {
    throw new Error("No local desktop logs found. Enable log saving first.");
  }

  const logFiles = fs.readdirSync(logDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".log"))
    .map((entry) => {
      const filePath = path.join(logDirectory, entry.name);
      const stats = fs.statSync(filePath);
      return {
        name: entry.name,
        path: filePath,
        mtimeMs: stats.mtimeMs,
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, MAX_DESKTOP_LOG_FILES);

  if (logFiles.length === 0) {
    throw new Error("No local desktop logs found. Enable log saving first.");
  }

  let remainingBytes = MAX_DESKTOP_LOG_UPLOAD_BYTES;
  const selectedSegments: string[] = [];
  let selectedCount = 0;
  for (const file of logFiles) {
    const rawContent = fs.readFileSync(file.path, "utf8");
    if (!rawContent.trim()) {
      continue;
    }
    const segment = buildDesktopLogUploadSegment(file.name, rawContent, remainingBytes);
    if (!segment) {
      continue;
    }
    remainingBytes -= segment.bytes;
    selectedSegments.unshift(segment.segment);
    selectedCount += 1;
    if (remainingBytes <= 256) {
      break;
    }
  }

  const combinedContent = selectedSegments.join("\n").trim();
  if (!combinedContent) {
    throw new Error("Desktop log files are empty.");
  }

  return {
    fileName: `desktop-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
    content: combinedContent,
    appVersion: app.getVersion(),
    appBuild: 0,
    deviceModel: `${os.hostname()} (${process.platform} ${os.release()})`,
    clientTime: new Date().toISOString(),
    source: "desktop",
    connectionNote: buildDesktopLogConnectionNote(selectedCount),
    traceIds: extractDesktopLogIds(combinedContent, DESKTOP_LOG_TRACE_ID_PATTERN),
    workgroupIds: extractDesktopLogIds(combinedContent, DESKTOP_LOG_WORKGROUP_ID_PATTERN),
  };
}

async function uploadDesktopLogs(): Promise<{ success: boolean; error?: string; logId?: string; uploadedAt?: string }> {
  try {
    const config = loadConfig();
    if (!config.serverUrl.trim()) {
      return { success: false, error: "Server URL is not configured." };
    }

    const payload = await buildDesktopLogUploadPayload();
    const refreshed = await refreshControllerToken(false);
    const nextConfig = loadConfig();
    const token = nextConfig.controllerToken?.trim() ?? "";
    if (!refreshed || !token) {
      return { success: false, error: "Desktop device token is unavailable. Re-login and retry." };
    }

    const response = await fetchRelayJson(`${toHttpBaseUrl(nextConfig.serverUrl)}/api/device/logs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: {
        file_name: payload.fileName,
        content: payload.content,
        app_version: payload.appVersion,
        app_build: payload.appBuild,
        device_model: payload.deviceModel,
        client_time: payload.clientTime,
        source: payload.source,
        connection_note: payload.connectionNote,
        trace_ids: payload.traceIds,
        workgroup_ids: payload.workgroupIds,
      },
    });

    if (!response.ok) {
      const errorText = (await response.text()).trim();
      return { success: false, error: errorText || response.statusText || "Desktop log upload failed." };
    }

    const result = await response.json() as { success?: boolean; log_id?: string; uploaded_at?: string };
    if (!result.success || !result.log_id) {
      return { success: false, error: "Desktop log upload failed." };
    }

    appLogger.info("diagnostics", "Uploaded desktop logs for remote analysis.", {
      logId: result.log_id,
      traceIds: payload.traceIds,
      workgroupIds: payload.workgroupIds,
    });
    return {
      success: true,
      logId: result.log_id,
      uploadedAt: result.uploaded_at,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function ensureDesktopTransferAuthToken(): Promise<string> {
  const refreshed = await refreshAgentToken(false);
  const nextConfig = loadConfig();
  const token = nextConfig.token?.trim() ?? "";
  if (!refreshed || !token) {
    throw new Error("Desktop agent token is unavailable. Please log in again.");
  }
  return token;
}

async function fetchRelayDevicesFromServer(): Promise<RelayDeviceSummary[]> {
  const config = loadConfig();
  if (!config.serverUrl.trim()) {
    throw new Error("Server URL is not configured.");
  }

  const token = await ensureDesktopTransferAuthToken();
  const response = await fetch(`${toHttpBaseUrl(config.serverUrl)}/api/devices`, {
    method: "GET",
    headers: buildRelayApiHeaders({
      Authorization: `Bearer ${token}`,
    }),
  });

  if (!response.ok) {
    const errorText = (await response.text()).trim();
    throw new Error(errorText || response.statusText || "Failed to load relay devices.");
  }

  const payload = await response.json() as RelayDeviceSummary[];
  return Array.isArray(payload) ? payload : [];
}

const relayDeviceListCache = createTimedAsyncCache<RelayDeviceSummary[]>({
  ttlMs: RELAY_DEVICE_LIST_CACHE_TTL_MS,
  load: fetchRelayDevicesFromServer,
});

function clearRelayDeviceListCache(): void {
  relayDeviceListCache.clear();
}

async function listRelayTransfers(limit = 12): Promise<RelayTransferRecord[]> {
  return await listRelayTransfersWithOptions({ limit });
}

function normalizeRelayTransferListOptions(options: RelayTransferListOptions = {}): Required<Omit<RelayTransferListOptions, "force">> {
  return {
    limit: Math.max(1, Math.min(50, Math.floor(Number(options.limit) || 12))),
    targetType: options.targetType?.trim() || "",
    targetId: options.targetId?.trim() || "",
    projectId: options.projectId?.trim() || "",
    workgroupId: options.workgroupId?.trim() || "",
    includeReceipts: options.includeReceipts !== false,
  };
}

function createRelayTransferListCacheKey(options: RelayTransferListOptions = {}): string {
  return JSON.stringify(normalizeRelayTransferListOptions(options));
}

async function fetchRelayTransfersFromServer(cacheKey: string): Promise<RelayTransferRecord[]> {
  const options = JSON.parse(cacheKey) as ReturnType<typeof normalizeRelayTransferListOptions>;
  const config = loadConfig();
  if (!config.serverUrl.trim()) {
    throw new Error("Server URL is not configured.");
  }

  const token = await ensureDesktopTransferAuthToken();
  const query = new URLSearchParams();
  query.set("limit", String(options.limit));
  if (options.targetType) {
    query.set("target_type", options.targetType);
  }
  if (options.targetId) {
    query.set("target_id", options.targetId);
  }
  if (options.projectId) {
    query.set("project_id", options.projectId);
  }
  if (options.workgroupId) {
    query.set("workgroup_id", options.workgroupId);
  }
  if (options.includeReceipts) {
    query.set("include_receipts", "1");
  }

  const response = await fetchRelayJson(`${toHttpBaseUrl(config.serverUrl)}/api/transfers?${query.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorText = (await response.text()).trim();
    throw new Error(errorText || response.statusText || "Failed to load relay transfers.");
  }

  const payload = await response.json() as RelayTransferRecord[];
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload;
}

const relayTransferListCache = createKeyedTimedAsyncCache<RelayTransferRecord[]>({
  ttlMs: RELAY_TRANSFER_LIST_CACHE_TTL_MS,
  load: fetchRelayTransfersFromServer,
});

function clearRelayTransferListCache(): void {
  relayTransferListCache.clear();
}

async function listRelayTransfersWithOptions(options: RelayTransferListOptions = {}): Promise<RelayTransferRecord[]> {
  return await relayTransferListCache.get(
    createRelayTransferListCacheKey(options),
    { force: options.force === true },
  );
}

async function listRelayDevices(options: { force?: boolean } = {}): Promise<RelayDeviceSummary[]> {
  return await relayDeviceListCache.get({ force: options.force === true });
}

async function createRelayTransferFromDesktop(
  options: RelayTransferCreateOptions = {},
  senderWindow?: BrowserWindow | null,
): Promise<RelayTransferRecord> {
  const config = loadConfig();
  if (!config.serverUrl.trim()) {
    throw new Error("Server URL is not configured.");
  }

  const token = await ensureDesktopTransferAuthToken();
  const dialogOptions: Electron.OpenDialogOptions = {
    title: getLang() === "zh" ? "选择要发送到移动端的文件" : "Choose a file to send to mobile",
    properties: ["openFile"],
  };
  const result = senderWindow
    ? await dialog.showOpenDialog(senderWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || !result.filePaths[0]) {
    throw new Error("__TRANSFER_PICK_CANCELED__");
  }

  const selectedPath = path.resolve(result.filePaths[0]);
  const stats = fs.statSync(selectedPath);
  if (!stats.isFile()) {
    throw new Error("Selected item is not a file.");
  }

  const fileName = path.basename(selectedPath);
  const mimeType = guessMimeType(selectedPath);
  const buffer = fs.readFileSync(selectedPath);
  const form = new FormData();
  form.set("file", new Blob([buffer], { type: mimeType }), fileName);
  if (options.targetType?.trim()) {
    form.set("target_type", options.targetType.trim());
  }
  if (options.targetId?.trim()) {
    form.set("target_id", options.targetId.trim());
  }
  if (options.projectId?.trim()) {
    form.set("project_id", options.projectId.trim());
  }
  if (options.workgroupId?.trim()) {
    form.set("workgroup_id", options.workgroupId.trim());
  }
  if (Number.isFinite(options.expiresInHours) && Number(options.expiresInHours) > 0) {
    form.set("expires_in_hours", String(Math.floor(Number(options.expiresInHours))));
  }

  const response = await fetch(`${toHttpBaseUrl(config.serverUrl)}/api/transfers`, {
    method: "POST",
    headers: buildRelayApiHeaders({
      Authorization: `Bearer ${token}`,
    }),
    body: form,
  });

  if (!response.ok) {
    const errorText = (await response.text()).trim();
    throw new Error(errorText || response.statusText || "Failed to upload relay transfer.");
  }

  clearRelayTransferListCache();
  return await response.json() as RelayTransferRecord;
}

async function fetchAccessGrantsFromServer(): Promise<unknown> {
  const refreshed = await refreshAgentToken(false);
  const config = loadConfig();
  if (!refreshed || !config.token) {
    throw new Error("Not logged in");
  }

  const response = await fetchRelayJson(`${toHttpBaseUrl(config.serverUrl)}/api/access/grants`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || response.statusText);
  }
  return await response.json();
}

const accessGrantCache = createTimedAsyncCache<unknown>({
  ttlMs: ACCESS_GRANTS_CACHE_TTL_MS,
  load: fetchAccessGrantsFromServer,
});

function clearAccessGrantCache(): void {
  accessGrantCache.clear();
}

async function fetchWorkgroupRegistrySearchResults(cacheKey: string): Promise<WorkgroupRegistryRecord[]> {
  const normalizedQuery = normalizeWorkgroupRegistrySearchQuery(cacheKey);
  if (!normalizedQuery) {
    return [];
  }
  const response = await requestWorkgroupRegistry<{ records: WorkgroupRegistryRecord[] }>(
    `/api/workgroups/registry?q=${encodeURIComponent(normalizedQuery)}`,
  );
  return Array.isArray(response.records) ? response.records : [];
}

const workgroupRegistrySearchCache = createKeyedTimedAsyncCache<WorkgroupRegistryRecord[]>({
  ttlMs: WORKGROUP_REGISTRY_SEARCH_CACHE_TTL_MS,
  load: fetchWorkgroupRegistrySearchResults,
});

async function fetchWorkgroupRegistryMembers(cacheKey: string): Promise<WorkgroupRegistryMembersResponse> {
  const query = parseWorkgroupRegistryMembersCacheKey(cacheKey);
  const params = new URLSearchParams();
  if (query.groupNumber) {
    params.set("group_number", query.groupNumber);
  }
  if (query.workgroupId) {
    params.set("workgroup_id", query.workgroupId);
  }
  if (query.hostAgentId) {
    params.set("host_agent_id", query.hostAgentId);
  }
  const response = await requestWorkgroupRegistry<WorkgroupRegistryMembersResponse>(
    `/api/workgroups/registry/members?${params.toString()}`,
  );
  return {
    record: response.record,
    members: Array.isArray(response.members) ? response.members : [],
  };
}

const workgroupRegistryMembersCache = createKeyedTimedAsyncCache<WorkgroupRegistryMembersResponse>({
  ttlMs: WORKGROUP_REGISTRY_MEMBERS_CACHE_TTL_MS,
  load: fetchWorkgroupRegistryMembers,
});

function clearWorkgroupRegistryCaches(): void {
  workgroupRegistrySearchCache.clear();
  workgroupRegistryMembersCache.clear();
}

function isTokenExpiringSoon(expiresAt?: string, nowMs: number = Date.now()): boolean {
  if (!expiresAt) {
    return true;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return true;
  }

  return expiresAtMs - nowMs <= TOKEN_REFRESH_WINDOW_MS;
}

function getDefaultCliProvider(): CliProvider {
  return normalizeRegisteredCliProvider(loadConfig().cliProvider, "claude");
}

function normalizeCliProvider(
  provider: string | null | undefined,
  fallback: CliProvider = "claude",
): CliProvider {
  return normalizeRegisteredCliProvider(provider, fallback);
}

function getProjectCliProvider(projectId: string): CliProvider {
  const project = projectStore.getById(projectId);
  return normalizeCliProvider(project?.cliProvider, getDefaultCliProvider());
}

function getProjectCliModel(projectId: string): string | null {
  const project = projectStore.getById(projectId);
  const model = project?.cliModel?.trim() ?? "";
  if (model) {
    return model;
  }

  const provider = getProjectCliProvider(projectId);
  return getProviderSdkConfigValue(loadConfig(), provider, "defaultModel")
    || getProviderDefaultSdkModel(provider);
}

function getProjectCodexWebSearchEnabled(projectId: string): boolean {
  const project = projectStore.getById(projectId);
  return normalizeCodexWebSearchEnabled(project?.codexWebSearchEnabled);
}

function getProjectPrompt(projectId: string): string | null {
  if (isWorkgroupPmProjectId(projectId)) {
    const workgroupId = getWorkgroupIdFromPmProjectId(projectId);
    if (!workgroupId) {
      return null;
    }
    const workgroup = workgroupStore.getWorkgroupById(workgroupId);
    const planWorkspacePath = ensureWorkgroupPlanDirectory(
      workgroup?.planWorkspacePath ?? getDefaultWorkgroupPlanPath(workgroupId),
    );
    const memberNames = workgroupStore
      .listMembers(workgroupId)
      .filter((member) => member.kind !== "pm")
      .map((member) => member.name)
      .join(", ");
    return [
      `This is the planning workspace for workgroup ${workgroup?.name || workgroupId}.`,
      "Act as the PM Agent.",
      "Break the goal into concrete subtasks, track owner handoffs, summarize blockers, and write plans in this workspace when useful.",
      `Planning workspace: ${planWorkspacePath || "unknown"}`,
      `Members: ${memberNames || "none yet"}`,
    ].join("\n");
  }
  const project = projectStore.getById(projectId);
  const prompt = project?.projectPrompt?.trim() ?? "";
  return prompt || null;
}

function buildProjectListPayload(agentId: string): {
  agent_id: string;
  projects: Array<{
    id: string;
    name: string;
    path: string;
    group_name: string;
    cli_provider: CliProvider;
    cli_model: string;
    codex_web_search: boolean;
    project_prompt: string;
  }>;
} {
  return {
    agent_id: agentId,
    projects: projectStore.getAll().map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
      group_name: project.groupName ?? "",
      cli_provider: project.cliProvider,
      cli_model: project.cliModel ?? "",
      codex_web_search: normalizeCodexWebSearchEnabled(project.codexWebSearchEnabled),
      project_prompt: project.projectPrompt ?? "",
    })),
  };
}

normalizeAllWorkgroupPmMembers();

const runtimeManager = new RuntimeManager(() => ({
  getProjectProvider: getProjectCliProvider,
  getProjectModel: getProjectCliModel,
  getProjectCodexWebSearchEnabled,
  getProjectPrompt,
  getProviderEnvironment: (provider) => getProviderEnvironment(provider),
  resolveProviderRuntime,
  getProviderSdkConfig,
  shouldResumeConversation: (projectId) => !isWorkgroupPmProjectId(projectId),
  shouldPersistProjectHistory: (projectId) => !isWorkgroupPmProjectId(projectId),
  updateProject: (projectId, updates) => {
    projectStore.update(projectId, updates);
  },
  onProjectConfigChanged: (projectId) => {
    const project = projectStore.getById(projectId);
    if (project) {
      syncProjectCatalog(project.agentId || loadConfig().agentId);
    }
    rebuildTrayMenu();
    broadcastProjectsChanged();
    broadcastProjectSnapshot(projectId);
    updateWindowTitles();
  },
  captureProjectScreenshot: async (projectId) => captureProjectScreenshot(projectId),
}));
runtimeManager.pruneHistoryCache(appSettingsStore.get("historyRetentionDays") as number);
const localScheduler = new LocalScheduler({
  executeTask: async (task, options) => executeScheduledTask(task, options),
  onTasksChanged: () => {
    broadcastScheduledTasksChanged();
  },
});
const workgroupTaskScheduler = new WorkgroupTaskScheduler({
  dispatchTask: async (taskId: string) => handleDispatchWorkgroupTaskRequest(taskId),
  onTasksChanged: () => {
    broadcastWorkgroupsChanged();
  },
});
const workgroupCollaborationService = new WorkgroupCollaborationService({
  runtimeManager,
  getBoundProject: (projectId: string): CollaborationBoundProject | null => {
    if (isWorkgroupPmProjectId(projectId)) {
      const workgroupId = getWorkgroupIdFromPmProjectId(projectId);
      if (!workgroupId) {
        return null;
      }
      const binding = getWorkgroupPmBinding(workgroupId);
      return {
        id: binding.projectId ?? projectId,
        name: binding.projectName ?? "PM Agent",
        path: binding.projectPath ?? getDefaultWorkgroupPlanPath(workgroupId),
        kind: "local",
        online: true,
      };
    }
    const project = getProjectById(projectId);
    if (!project) {
      return null;
    }
    return {
      id: project.id,
      name: project.name,
      path: project.path,
      kind: isRemoteProjectRecord(project) ? "remote" : "local",
      online: isRemoteProjectRecord(project) ? Boolean(project.online) : true,
    };
  },
  getProjectSessionSnapshot: (projectId: string) => getProjectSnapshot(projectId),
  getRemoteSessionStore: () => remoteSessionStore,
});

async function captureProjectScreenshot(projectId: string): Promise<RunAttachment> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.max(1, primaryDisplay.size.width),
      height: Math.max(1, primaryDisplay.size.height),
    },
    fetchWindowIcons: false,
  });

  const preferredSource = sources.find((source) => String(source.display_id || "") === String(primaryDisplay.id))
    ?? sources.find((source) => !source.thumbnail.isEmpty());
  if (!preferredSource || preferredSource.thumbnail.isEmpty()) {
    throw new Error("No display capture source is available.");
  }

  const screenshotFileName = `screenshot-${Date.now()}.png`;
  const targetPath = getUniqueAttachmentPath(projectId, screenshotFileName);
  fs.writeFileSync(targetPath, preferredSource.thumbnail.toPNG());

  return createRunAttachmentFromPath(targetPath, {
    name: screenshotFileName,
    kind: "image",
    previewDataUrl: buildImagePreviewDataUrlFromNativeImage(preferredSource.thumbnail, {
      maxDimension: 960,
      maxDataUrlChars: 180_000,
      format: "jpeg",
      jpegQuality: 78,
    }),
  });
}

function buildScheduledTaskPrompt(task: ScheduledTask, project: Project): string {
  const scheduleLabel = task.scheduleType === "daily"
    ? `daily ${task.dailyTime ?? "--:--"}`
    : (task.scheduleType === "delay"
      ? `delay ${task.delayMinutes ?? 0}m`
    : (task.scheduleType === "interval"
      ? `every ${task.intervalHours ?? 0}h`
    : (task.scheduleType === "weekly"
      ? `weekly day=${task.weeklyDay ?? "-"} ${task.dailyTime ?? "--:--"}`
      : `once ${task.runAt ? new Date(task.runAt).toLocaleString() : "unspecified"}`)));
  return [
    `[Scheduled Task] ${task.name}`,
    `Project: ${project.name}`,
    `Schedule: ${scheduleLabel}`,
    "",
    task.prompt.trim(),
  ].join("\n");
}

async function executeScheduledTask(
  task: ScheduledTask,
  options: { runId: string },
): Promise<{ success: boolean; message?: string | null }> {
  const project = getLocalProjectById(task.projectId);
  if (!project) {
    return { success: false, message: "Bound local project was not found." };
  }
  const projectPath = String(project.path ?? "").trim();
  if (!projectPath) {
    return { success: false, message: "Bound local project path is empty." };
  }
  if (!fs.existsSync(projectPath)) {
    return { success: false, message: `Bound local project path does not exist: ${projectPath}` };
  }

  return await new Promise((resolve) => {
    let settled = false;
    const settle = (result: { success: boolean; message?: string | null }) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    runtimeManager.enqueueMessage({
      projectId: project.id,
      cwd: project.path,
      prompt: buildScheduledTaskPrompt(task, project),
      source: "desktop",
      runId: options.runId,
      onDone: () => settle({ success: true, message: "Scheduled task completed." }),
      onError: (error) => settle({ success: false, message: error || "Scheduled task failed." }),
    });
  });
}

function normalizeSettingsPane(pane?: string | null): SettingsPane {
  if (
    pane === "overview"
    || pane === "connection"
    || pane === "project"
    || pane === "message"
    || pane === "automation"
    || pane === "advanced"
  ) {
    return pane;
  }
  return "overview";
}

function getSettingsPaneTitle(pane: SettingsPane): string {
  if (getLang() === "zh") {
    switch (pane) {
      case "overview":
        return "设置总览";
      case "connection":
        return "服务器连接";
      case "project":
        return "项目设置";
      default:
        return "系统设置";
    }
  }

  switch (pane) {
    case "overview":
      return "Settings Overview";
    case "connection":
      return "Server Connection";
    case "project":
      return "Project Settings";
    case "message":
      return "Messages & Files";
    case "automation":
      return "Tasks & Automation";
    case "advanced":
      return "Advanced Settings";
    default:
      return "System Settings";
  }
}

function broadcastSettingsPane(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("settings-pane-changed", activeSettingsPane);
  }
}

function getSettingsWindowTitle(pane: SettingsPane = activeSettingsPane): string {
  return `${getSettingsPaneTitle(pane)} - ${t("app.name")}`;
}

function getWorkspaceWindowTitle(
  projectId: string | null = activeWorkspaceProjectId,
  workgroupId: string | null = activeWorkgroupCollaborationId,
): string {
  if (workgroupId) {
    const workgroup = getAllWorkgroupCollaborationSummaries().find((entry) => entry.id === workgroupId);
    if (workgroup) {
      return `${workgroup.name} - ${t("app.name")}`;
    }
  }

  if (projectId) {
    const project = getProjectById(projectId);
    if (project) {
      return `${project.name} - ${t("app.name")}`;
    }
  }

  return t("app.name");
}

function getLangPayload(): { lang: Lang; messages: Record<string, string> } {
  return {
    lang: getLang(),
    messages: getAllMessages(),
  };
}

function getWindowState(storeKey: keyof WindowStateSchema): PersistedWindowState {
  const fallback = windowStateStore.get(storeKey) as PersistedWindowState | undefined;
  return {
    width: Math.max(640, Number(fallback?.width) || (storeKey === "settingsWindow" ? 800 : 1000)),
    height: Math.max(520, Number(fallback?.height) || 700),
    maximized: Boolean(fallback?.maximized),
    x: Number.isFinite(fallback?.x) ? Number(fallback?.x) : undefined,
    y: Number.isFinite(fallback?.y) ? Number(fallback?.y) : undefined,
  };
}

function isWindowBoundsVisible(state: PersistedWindowState): boolean {
  if (!Number.isFinite(state.x) || !Number.isFinite(state.y)) {
    return false;
  }

  const bounds = {
    x: Number(state.x),
    y: Number(state.y),
    width: Math.max(1, Number(state.width) || 1),
    height: Math.max(1, Number(state.height) || 1),
  };

  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return bounds.x < area.x + area.width
      && bounds.x + bounds.width > area.x
      && bounds.y < area.y + area.height
      && bounds.y + bounds.height > area.y;
  });
}

function buildWindowOptions(
  storeKey: keyof WindowStateSchema,
  baseOptions: Electron.BrowserWindowConstructorOptions,
): Electron.BrowserWindowConstructorOptions {
  const state = getWindowState(storeKey);
  const options: Electron.BrowserWindowConstructorOptions = {
    ...baseOptions,
    width: state.width,
    height: state.height,
  };

  if (isWindowBoundsVisible(state)) {
    options.x = Number(state.x);
    options.y = Number(state.y);
  }

  return options;
}

function persistWindowState(
  storeKey: keyof WindowStateSchema,
  win: BrowserWindow,
): void {
  if (win.isDestroyed()) {
    return;
  }

  const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  windowStateStore.set(storeKey, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized: win.isMaximized(),
  });
}

function bindWindowStatePersistence(
  storeKey: keyof WindowStateSchema,
  win: BrowserWindow,
): void {
  let persistTimer: NodeJS.Timeout | null = null;

  const schedulePersist = (): void => {
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistWindowState(storeKey, win);
    }, 180);
  };

  win.on("resize", schedulePersist);
  win.on("move", schedulePersist);
  win.on("maximize", () => persistWindowState(storeKey, win));
  win.on("unmaximize", schedulePersist);
  win.on("close", () => persistWindowState(storeKey, win));
  win.on("closed", () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  });
}

function updateTrayTooltip(): void {
  if (!tray) {
    return;
  }

  const tooltip = buildConnectionStatusSnapshot().state === "connected"
    ? t("tray.connected")
    : t("tray.disconnected");
  tray.setToolTip(tooltip);
}

function formatMonitorRelativeTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return getLang() === "zh" ? "暂无" : "n/a";
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  if (diffMs < 60_000) {
    const seconds = Math.max(1, Math.floor(diffMs / 1000));
    return getLang() === "zh" ? `${seconds} 秒前` : `${seconds}s ago`;
  }
  if (diffMs < 3_600_000) {
    const minutes = Math.max(1, Math.floor(diffMs / 60_000));
    return getLang() === "zh" ? `${minutes} 分钟前` : `${minutes}m ago`;
  }
  const hours = Math.max(1, Math.floor(diffMs / 3_600_000));
  return getLang() === "zh" ? `${hours} 小时前` : `${hours}h ago`;
}

function toUiConnectionState(snapshot: RelayConnectionSnapshot | null, enabled: boolean): "connected" | "connecting" | "disconnected" {
  if (!enabled || !snapshot) {
    return "disconnected";
  }
  if (snapshot.state === "connected") {
    return "connected";
  }
  if (snapshot.state === "connecting" || snapshot.state === "authenticating" || snapshot.state === "reconnecting") {
    return "connecting";
  }
  return "disconnected";
}

function buildRelayMonitorEntry(
  label: string,
  client: RelayClient | null,
  enabled: boolean,
  disconnectedFallback: string,
) {
  const snapshot = client?.getConnectionSnapshot() ?? null;
  const uiState = toUiConnectionState(snapshot, enabled);
  const lang = getLang();
  const stateLabelMap = {
    connected: lang === "zh" ? "已连接" : "Connected",
    connecting: lang === "zh" ? "重连中" : "Reconnecting",
    disconnected: lang === "zh" ? "未连接" : "Disconnected",
  } as const;

  if (!enabled) {
    return {
      label,
      enabled: false,
      state: "disconnected" as const,
      text: lang === "zh" ? `${label}：未启用` : `${label}: disabled`,
      detail: disconnectedFallback,
    };
  }

  if (!snapshot) {
    return {
      label,
      enabled: true,
      state: "disconnected" as const,
      text: lang === "zh" ? `${label}：客户端未启动` : `${label}: client unavailable`,
      detail: disconnectedFallback,
    };
  }

  const detailParts: string[] = [];
  if (snapshot.lastInboundAt > 0) {
    detailParts.push(
      lang === "zh"
        ? `最近活动 ${formatMonitorRelativeTime(snapshot.lastInboundAt)}`
        : `last activity ${formatMonitorRelativeTime(snapshot.lastInboundAt)}`,
    );
  }
  if (snapshot.reconnectAttemptCount > 0) {
    detailParts.push(
      lang === "zh"
        ? `重连 ${snapshot.reconnectAttemptCount} 次`
        : `retries ${snapshot.reconnectAttemptCount}`,
    );
  }
  if (snapshot.pendingQueueSize > 0) {
    detailParts.push(
      lang === "zh"
        ? `待发送 ${snapshot.pendingQueueSize}`
        : `queued ${snapshot.pendingQueueSize}`,
    );
  }
  if (snapshot.lastErrorMessage.trim()) {
    detailParts.push(snapshot.lastErrorMessage.trim());
  }

  return {
    label,
    enabled: true,
    state: uiState,
    text: `${label}: ${stateLabelMap[uiState]}`,
    detail: detailParts.join(" · ") || disconnectedFallback,
    snapshot,
  };
}

function buildConnectionStatusSnapshot() {
  const config = loadConfig();
  const agentEnabled = Boolean(config.agentId?.trim() && config.token?.trim());
  const controllerEnabled = Boolean(
    config.username?.trim()
    && config.password?.trim()
    && config.agentId?.trim()
    && config.controllerToken?.trim(),
  );

  const agent = buildRelayMonitorEntry(
    getLang() === "zh" ? "桌面主连接" : "Desktop relay",
    relayClient,
    agentEnabled,
    getLang() === "zh" ? "等待登录或重新连接。" : "Waiting for login or reconnect.",
  );
  const controller = buildRelayMonitorEntry(
    getLang() === "zh" ? "远程同步连接" : "Remote sync relay",
    controllerRelayClient,
    controllerEnabled,
    getLang() === "zh" ? "远程同步未启用。" : "Remote sync is not enabled.",
  );

  const state: "connected" | "connecting" | "disconnected" =
    agent.state === "connected" && (controller.state === "connected" || !controller.enabled)
      ? "connected"
      : (agent.state === "connecting" || controller.state === "connecting")
        ? "connecting"
        : "disconnected";

  const detail = [agent.text, agent.detail, controller.text, controller.detail].join("\n");
  return {
    state,
    detail,
    monitoredAt: Date.now(),
    agent,
    controller,
  };
}

function shouldThrottleRecovery(lastRecoveryAt: number): boolean {
  return lastRecoveryAt > 0 && Date.now() - lastRecoveryAt < RELAY_RECOVERY_COOLDOWN_MS;
}

function maybeRecoverRelayClient(
  snapshot: RelayConnectionSnapshot | null,
  lastRecoveryAt: number,
  recover: (reason: string) => Promise<void>,
  reason: string,
): number {
  if (!snapshot || shouldThrottleRecovery(lastRecoveryAt)) {
    return lastRecoveryAt;
  }

  const disconnectedForMs = snapshot.lastDisconnectedAt > 0 ? Date.now() - snapshot.lastDisconnectedAt : 0;
  const authStalledForMs = snapshot.state === "authenticating" && snapshot.lastConnectedAt > 0
    ? Date.now() - snapshot.lastConnectedAt
    : 0;
  const shouldRecover = disconnectedForMs >= RELAY_FORCE_RECOVERY_AFTER_MS
    || authStalledForMs >= RELAY_STALE_CONNECTION_TIMEOUT_MS
    || snapshot.consecutiveFailureCount >= 3;
  if (!shouldRecover) {
    return lastRecoveryAt;
  }

  const nextRecoveryAt = Date.now();
  appLogger.warn("relay", "Triggered relay watchdog recovery.", {
    reason: `watchdog-${reason}`,
    state: snapshot.state,
    disconnectedForMs,
    authStalledForMs,
    consecutiveFailureCount: snapshot.consecutiveFailureCount,
    reconnectAttemptCount: snapshot.reconnectAttemptCount,
    lastErrorMessage: snapshot.lastErrorMessage ?? null,
  });
  void recover(`watchdog-${reason}`);
  return nextRecoveryAt;
}

function updateWindowTitles(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(getSettingsWindowTitle(activeSettingsPane));
  }

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.setTitle(getWorkspaceWindowTitle(activeWorkspaceProjectId));
  }
}

function broadcastWorkspaceSelectionState(): void {
  if (!workspaceWindow || workspaceWindow.isDestroyed()) {
    return;
  }
  workspaceWindow.webContents.send("project-id", activeWorkspaceProjectId);
  workspaceWindow.webContents.send("workgroup-collaboration-id", activeWorkgroupCollaborationId);
}

function broadcastLangChange(): void {
  const payload = getLangPayload();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("lang-changed", payload);
  }

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("lang-changed", payload);
  }
}

function broadcastUpdateState(state: UpdateState): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-state-changed", state);
  }

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("update-state-changed", state);
  }
}

function playCompletionSound(): void {
  if (!(appSettingsStore.get("completionSound") as boolean)) {
    return;
  }

  void playSystemNotificationSound().then((played) => {
    if (played) {
      return;
    }

    try {
      shell.beep();
    } catch (error) {
      appLogger.warn("runtime", "Failed to play completion sound.", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

runtimeManager.on("snapshot", (_projectId: string, snapshot: ProjectSessionSnapshot) => {
  syncWorkgroupTasksForProjectSnapshot(snapshot);
  if (!isWorkgroupPmProjectId(snapshot.projectId) && workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("project-session-snapshot", snapshot);
  }
  broadcastSessionSync(snapshot);
  void updateManager.maybeInstallDownloadedUpdate();
});

runtimeManager.on("run-started", (payload: { runId: string }) => {
  localScheduler.markTaskRunning(payload.runId);
});

runtimeManager.on("run-completed", () => {
  playCompletionSound();
});

updateManager.on("state-changed", (state: UpdateState) => {
  broadcastUpdateState(state);
});

workgroupCollaborationService.on("summaries", (_summaries: WorkgroupCollaborationSummary[]) => {
  broadcastWorkgroupCollaborationSummaries();
});

workgroupCollaborationService.on("snapshot", (workgroupId: string, snapshot: WorkgroupCollaborationSessionSnapshot) => {
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("workgroup-collaboration-snapshot", snapshot);
  }
  broadcastWorkgroupCollaborationRelaySnapshot(workgroupId, snapshot);
});

function broadcastProjectsChanged(): void {
  const projects = getAllProjects();
  const previousActiveProjectId = activeWorkspaceProjectId;
  if (previousActiveProjectId && !projects.some((project) => project.id === previousActiveProjectId)) {
    activeWorkspaceProjectId = projects[0]?.id ?? null;
    activeWorkgroupCollaborationId = null;
    if (activeWorkspaceProjectId && isRemoteProject(activeWorkspaceProjectId)) {
      requestRemoteProjectSync(activeWorkspaceProjectId, "fallback-active-project", true, "full");
    }
    updateWindowTitles();
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("projects-changed", projects);
  }

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("projects-changed", projects);
    if (previousActiveProjectId !== activeWorkspaceProjectId) {
      broadcastWorkspaceSelectionState();
    }
  }

  broadcastWorkgroupsChanged();
  broadcastWorkgroupCollaborationSummaries();
  broadcastScheduledTasksChanged();
}

function broadcastProjectSnapshot(projectId: string): void {
  if (isWorkgroupPmProjectId(projectId)) {
    return;
  }
  const snapshot = getProjectSnapshot(projectId);
  if (!snapshot) {
    return;
  }
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("project-session-snapshot", snapshot);
  }
}

function getAllProjects(): Array<Project | RemoteProjectRecord> {
  const localProjects = projectStore.getAll();
  const remoteProjects = remoteSessionStore?.getProjects() ?? [];
  return [...localProjects, ...remoteProjects];
}

function getProjectById(projectId: string): (Project & { isRemote?: false }) | RemoteProjectRecord | undefined {
  return getAllProjects().find((project) => project.id === projectId);
}

function getLocalProjectById(projectId: string): Project | undefined {
  return projectStore.getById(projectId);
}

function isRemoteProject(projectId: string): boolean {
  return remoteSessionStore?.hasProject(projectId) ?? false;
}

function listSerializedScheduledTasks(): ScheduledTaskView[] {
  return scheduledTaskStore.listTasks().map((task) => {
    const project = getLocalProjectById(task.projectId);
    return {
      ...task,
      projectName: project?.name ?? null,
      projectPath: project?.path ?? null,
      projectMissing: !project,
    };
  });
}

function broadcastScheduledTasksChanged(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("scheduled-tasks-changed", listSerializedScheduledTasks());
  }
}

function getProjectSnapshot(projectId: string): ProjectSessionSnapshot | null {
  if (isRemoteProject(projectId)) {
    return remoteSessionStore?.getSnapshot(projectId) ?? null;
  }
  return runtimeManager.getSnapshot(projectId);
}

function getAllWorkgroupCollaborationSummaries(): WorkgroupCollaborationSummary[] {
  return [
    ...workgroupCollaborationService.listSummaries(),
    ...(remoteWorkgroupStore?.listSummaries() ?? []),
  ].sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name, "zh-CN"));
}

function broadcastWorkgroupCollaborationSummaries(): void {
  const summaries = getAllWorkgroupCollaborationSummaries();
  const previousActiveWorkgroupId = activeWorkgroupCollaborationId;
  if (
    activeWorkgroupCollaborationId
    && !summaries.some((entry) => entry.id === activeWorkgroupCollaborationId)
  ) {
    activeWorkgroupCollaborationId = null;
  }
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send(
      "workgroup-collaboration-summaries",
      summaries,
    );
    if (previousActiveWorkgroupId !== activeWorkgroupCollaborationId) {
      updateWindowTitles();
      broadcastWorkspaceSelectionState();
    }
  }
  broadcastWorkgroupCollaborationRelaySummaries();
}

function broadcastWorkgroupCollaborationSnapshot(workgroupId: string): void {
  const snapshot = workgroupCollaborationService.getSession(workgroupId);
  if (!snapshot) {
    return;
  }
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("workgroup-collaboration-snapshot", snapshot);
  }
  broadcastWorkgroupCollaborationRelaySnapshot(workgroupId, snapshot);
}

function buildWorkgroupCollaborationRelayPayload(): { agent_id: string; workgroups: WorkgroupCollaborationSummary[] } | null {
  const agentId = loadConfig().agentId.trim();
  if (!agentId) {
    return null;
  }
  return {
    agent_id: agentId,
    workgroups: workgroupCollaborationService.listSummaries(),
  };
}

function buildWorkgroupCollaborationSessionRelayPayload(data: {
  workgroupId: string;
  beforeId?: string | null;
  limit?: number;
  knownItems?: SessionSyncKnownItemDigest[];
  knownSnapshotRevision?: string | null;
}): {
  agent_id: string;
  workgroup_id: string;
  snapshot_revision: string;
  snapshot_unchanged?: boolean;
  session: WorkgroupCollaborationSessionSnapshot & {
    messages: Array<WorkgroupCollaborationSessionSnapshot["messages"][number] & {
      content_md5: string;
      content_omitted?: boolean;
    }>;
  };
  page: {
    items: Array<WorkgroupCollaborationSessionSnapshot["messages"][number] & {
      content_md5: string;
      content_omitted?: boolean;
    }>;
    hasMore: boolean;
    total: number;
  };
} | null {
  const agentId = loadConfig().agentId.trim();
  if (!agentId) {
    return null;
  }

  const session = workgroupCollaborationService.getSession(data.workgroupId);
  if (!session) {
    return null;
  }

  const page = workgroupCollaborationService.getHistoryPage(data.workgroupId, {
    beforeId: data.beforeId,
    limit: data.limit,
  });
  if (!page) {
    return null;
  }
  return createWorkgroupCollaborationSessionRelayPayload({
    agentId,
    workgroupId: data.workgroupId,
    session,
    page,
    beforeId: data.beforeId,
    knownItems: data.knownItems,
    knownSnapshotRevision: data.knownSnapshotRevision,
  });
}

function broadcastWorkgroupCollaborationRelaySummaries(): void {
  if (!relayClient || !relayClient.isConnected()) {
    return;
  }

  const payload = buildWorkgroupCollaborationRelayPayload();
  if (!payload) {
    return;
  }

  const payloadHash = JSON.stringify(payload);
  if (payloadHash === lastWorkgroupCollaborationRelayPayloadHash) {
    return;
  }
    lastWorkgroupCollaborationRelayPayloadHash = payloadHash;
    relayClient.send({
      id: uuidv4(),
      event: Events.WORKGROUP_COLLABORATION_LIST,
      agent_id: payload.agent_id,
      ts: Date.now(),
      payload,
    });
}

function broadcastWorkgroupCollaborationRelaySnapshot(
  workgroupId: string,
  snapshot?: WorkgroupCollaborationSessionSnapshot,
): void {
  if (!relayClient || !relayClient.isConnected()) {
    return;
  }

  const resolvedSnapshot = snapshot ?? workgroupCollaborationService.getSession(workgroupId);
  if (!resolvedSnapshot) {
    return;
  }

  pendingWorkgroupCollaborationRelaySnapshots.set(workgroupId, resolvedSnapshot);
  const existingTimer = workgroupCollaborationRelaySnapshotTimers.get(workgroupId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  workgroupCollaborationRelaySnapshotTimers.set(workgroupId, setTimeout(() => {
    workgroupCollaborationRelaySnapshotTimers.delete(workgroupId);
    const latestSnapshot = pendingWorkgroupCollaborationRelaySnapshots.get(workgroupId);
    if (!latestSnapshot || !relayClient || !relayClient.isConnected()) {
      return;
    }

    const agentId = loadConfig().agentId.trim();
    if (!agentId) {
      return;
    }

    const payload = {
      agent_id: agentId,
      workgroup_id: workgroupId,
      session: latestSnapshot,
    };
    const payloadHash = JSON.stringify(payload);
    if (lastBroadcastWorkgroupCollaborationSnapshotHashByWorkgroup.get(workgroupId) === payloadHash) {
      return;
    }

    lastBroadcastWorkgroupCollaborationSnapshotHashByWorkgroup.set(workgroupId, payloadHash);
    relayClient.send({
      id: uuidv4(),
      event: Events.WORKGROUP_COLLABORATION_SNAPSHOT,
      agent_id: agentId,
      workgroup_id: workgroupId,
      ts: Date.now(),
      payload,
    });
  }, WORKGROUP_COLLABORATION_RELAY_DEBOUNCE_MS));
}

function isRemoteProjectRecord(project: Project | RemoteProjectRecord): project is RemoteProjectRecord {
  return Boolean((project as RemoteProjectRecord).isRemote);
}

function getWorkgroupPmProjectId(workgroupId: string): string {
  return `${WORKGROUP_PM_PROJECT_PREFIX}${workgroupId.trim()}`;
}

function isWorkgroupPmProjectId(projectId: string | null | undefined): boolean {
  return String(projectId ?? "").trim().startsWith(WORKGROUP_PM_PROJECT_PREFIX);
}

function getWorkgroupIdFromPmProjectId(projectId: string | null | undefined): string | null {
  const normalized = String(projectId ?? "").trim();
  if (!isWorkgroupPmProjectId(normalized)) {
    return null;
  }
  return normalized.slice(WORKGROUP_PM_PROJECT_PREFIX.length).trim() || null;
}

function getDefaultWorkgroupPlanPath(workgroupId: string): string {
  return path.join(app.getPath("userData"), "workgroup-plans", workgroupId);
}

function resolveWorkgroupPlanPath(workgroupId: string, planWorkspacePath: string | null | undefined): string {
  const fallbackPath = getDefaultWorkgroupPlanPath(workgroupId);
  const trimmed = typeof planWorkspacePath === "string" ? planWorkspacePath.trim() : "";
  if (!trimmed) {
    fs.mkdirSync(fallbackPath, { recursive: true });
    return fallbackPath;
  }

  const resolved = path.resolve(trimmed);
  const fallbackResolved = path.resolve(fallbackPath);
  const isManagedWorkgroupPath = (
    path.basename(resolved).toLowerCase() === workgroupId.toLowerCase()
    && path.basename(path.dirname(resolved)).toLowerCase() === "workgroup-plans"
  );
  const currentUserDataPath = path.resolve(app.getPath("userData"));
  const shouldMigrateToCurrentDataRoot = (
    isManagedWorkgroupPath
    && resolved !== fallbackResolved
    && !resolved.toLowerCase().startsWith(currentUserDataPath.toLowerCase())
  );

  if (shouldMigrateToCurrentDataRoot) {
    if (fs.existsSync(resolved)) {
      fs.mkdirSync(path.dirname(fallbackResolved), { recursive: true });
      fs.cpSync(resolved, fallbackResolved, {
        recursive: true,
        force: true,
        errorOnExist: false,
      });
    } else {
      fs.mkdirSync(fallbackResolved, { recursive: true });
    }
    return fallbackResolved;
  }

  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function ensureWorkgroupPlanDirectory(planWorkspacePath: string | null | undefined): string | null {
  const resolved = typeof planWorkspacePath === "string" ? planWorkspacePath.trim() : "";
  if (!resolved) {
    return null;
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function getWorkgroupPmBinding(
  workgroupId: string,
  fallback?: Partial<Pick<Workgroup, "planWorkspacePath">> & Partial<Pick<WorkgroupMember, "projectName" | "projectPath">>,
): ResolvedWorkgroupProjectBinding {
  const workgroup = workgroupStore.getWorkgroupById(workgroupId);
  const planWorkspacePath = resolveWorkgroupPlanPath(
    workgroupId,
    workgroup?.planWorkspacePath
    ?? fallback?.planWorkspacePath
    ?? fallback?.projectPath
    ?? getDefaultWorkgroupPlanPath(workgroupId),
  );
  return {
    projectId: getWorkgroupPmProjectId(workgroupId),
    projectName: fallback?.projectName?.trim() || "PM Agent",
    projectPath: planWorkspacePath,
    projectKind: "local",
    projectExists: Boolean(planWorkspacePath),
    projectOnline: true,
  };
}

function resolveWorkgroupProjectBinding(
  projectId?: string | null,
  fallback?: Partial<Pick<WorkgroupMember, "projectName" | "projectPath" | "projectKind" | "kind">> & Partial<Pick<Workgroup, "planWorkspacePath">>,
): ResolvedWorkgroupProjectBinding {
  const normalizedProjectId = typeof projectId === "string" && projectId.trim() ? projectId.trim() : null;
  if ((fallback?.kind === "pm" || isWorkgroupPmProjectId(normalizedProjectId)) && normalizedProjectId) {
    const workgroupId = getWorkgroupIdFromPmProjectId(normalizedProjectId);
    if (workgroupId) {
      return getWorkgroupPmBinding(workgroupId, fallback);
    }
  }
  if (normalizedProjectId) {
    const liveProject = getProjectById(normalizedProjectId);
    if (liveProject) {
      const remote = isRemoteProjectRecord(liveProject);
      return {
        projectId: liveProject.id,
        projectName: liveProject.name,
        projectPath: liveProject.path,
        projectKind: remote ? "remote" : "local",
        projectExists: true,
        projectOnline: remote ? liveProject.online !== false : true,
      };
    }
  }

  return {
    projectId: normalizedProjectId,
    projectName: fallback?.projectName?.trim() || null,
    projectPath: fallback?.projectPath?.trim() || null,
    projectKind: fallback?.projectKind === "remote" ? "remote" : (fallback?.projectKind === "local" ? "local" : null),
    projectExists: false,
    projectOnline: false,
  };
}

function getWorkgroupProjectBindingLabel(binding: ResolvedWorkgroupProjectBinding): string {
  if (!binding.projectId) {
    return "Unbound";
  }

  if (isWorkgroupPmProjectId(binding.projectId)) {
    return "PM Agent: planning workspace";
  }

  const kindLabel = binding.projectKind === "remote" ? "Remote" : "Local";
  const name = binding.projectName || binding.projectId;
  const suffix = binding.projectExists
    ? (binding.projectOnline ? "online" : "offline")
    : "missing";
  return `${kindLabel}: ${name} (${suffix})`;
}

function serializeWorkgroupMember(member: WorkgroupMember): WorkgroupMemberView {
  const binding = resolveWorkgroupProjectBinding(member.projectId, member);
  return {
    ...member,
    ...binding,
    projectBindingLabel: getWorkgroupProjectBindingLabel(binding),
  };
}

function getWorkgroupDispatchBlockedReason(
  task: WorkgroupTask,
  assignee: WorkgroupMemberView | null,
): string | null {
  if (!task.assigneeMemberId || !assignee) {
    return "Task has no assignee.";
  }
  if (task.status === "assigned" || task.status === "running") {
    return "Task is already dispatched. Reset or finish it before dispatching again.";
  }
  if (!assignee.projectId || !assignee.projectExists) {
    return "Assignee is not bound to an available project.";
  }
  if (assignee.projectKind === "remote" && !assignee.projectOnline) {
    return "Assignee's remote project is offline.";
  }
  return null;
}

function serializeWorkgroupTask(task: WorkgroupTask, membersById: Map<string, WorkgroupMemberView>): WorkgroupTaskView {
  const assignee = task.assigneeMemberId ? membersById.get(task.assigneeMemberId) ?? null : null;
  const dispatchBlockedReason = getWorkgroupDispatchBlockedReason(task, assignee);
  return {
    ...task,
    assigneeMemberName: assignee?.name ?? null,
    assigneeRole: assignee?.role ?? null,
    assigneeProjectName: assignee?.projectName ?? null,
    assigneeProjectKind: assignee?.projectKind ?? null,
    assigneeProjectOnline: assignee?.projectOnline ?? false,
    assigneeProjectBindingLabel: assignee?.projectBindingLabel ?? null,
    dispatchReady: !dispatchBlockedReason,
    dispatchBlockedReason,
  };
}

function loadSerializedWorkgroups(): WorkgroupView[] {
  return workgroupStore
    .listWorkgroups()
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((workgroup) => {
      ensurePmMember(workgroup);
      const members = workgroupStore
        .listMembers(workgroup.id)
        .map(serializeWorkgroupMember)
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
      const membersById = new Map(members.map((member) => [member.id, member]));
      const tasks = workgroupStore
        .listTasks(workgroup.id)
        .map((task) => serializeWorkgroupTask(task, membersById))
        .sort((left, right) => {
          const leftRank = left.nextRunAt ?? Number.MAX_SAFE_INTEGER;
          const rightRank = right.nextRunAt ?? Number.MAX_SAFE_INTEGER;
          if (leftRank !== rightRank) {
            return leftRank - rightRank;
          }
          return right.updatedAt - left.updatedAt;
        });
      return {
        ...workgroup,
        members,
        tasks,
        selectedProjectIds: members
          .filter((member) => member.kind !== "pm" && member.projectId)
          .map((member) => member.projectId as string),
      };
        });
}

function listSerializedWorkgroups(): WorkgroupView[] {
  return workgroupRelayCache.get(loadConfig().agentId, () => loadSerializedWorkgroups()).workgroups;
}

function getSerializedWorkgroupById(workgroupId: string): WorkgroupView | null {
  return listSerializedWorkgroups().find((entry) => entry.id === workgroupId) ?? null;
}

function buildWorkgroupRegistryPayload(workgroupId: string): {
  workgroup_id: string;
  name: string;
  description?: string;
  group_number?: string;
  members: Array<{
    id: string;
    name: string;
    role: WorkgroupRole;
    kind: string;
    project_id: string | null;
    project_name: string | null;
    project_kind: "local" | "remote" | null;
  }>;
} | null {
  const workgroup = workgroupStore.getWorkgroupById(workgroupId);
  if (!workgroup) {
    return null;
  }
  const members = workgroupStore.listMembers(workgroup.id).map((member) => ({
    id: member.id,
    name: member.name,
    role: member.role,
    kind: member.kind ?? "project",
    project_id: member.projectId ?? null,
    project_name: member.projectName ?? null,
    project_kind: member.projectKind ?? null,
  }));
  return {
    workgroup_id: workgroup.id,
    name: workgroup.name,
    description: workgroup.description ?? undefined,
    group_number: workgroup.groupNumber ?? undefined,
    members,
  };
}

async function requestWorkgroupRegistry<T>(
  endpoint: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    body?: Record<string, unknown>;
  } = {},
): Promise<T> {
  const config = loadConfig();
  const baseUrl = toHttpBaseUrl(config.serverUrl);
  const token = config.token?.trim() ?? "";
  if (!token) {
    throw new Error("Please log in first.");
  }

  const url = endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint}`;
  const response = await fetchRelayJson(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: options.body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.trim() || `Request failed with status ${response.status}`);
  }

  return await response.json() as T;
}

function ensurePmMember(workgroup: Workgroup): WorkgroupMember {
  const planWorkspacePath = resolveWorkgroupPlanPath(
    workgroup.id,
    workgroup.planWorkspacePath ?? getDefaultWorkgroupPlanPath(workgroup.id),
  );
  const pmProjectId = getWorkgroupPmProjectId(workgroup.id);
  const manualPmMembers = workgroupStore
    .listMembers(workgroup.id)
    .filter((member) => member.role === "project_manager" && member.kind !== "pm" && member.projectId !== pmProjectId);
  for (const manualPmMember of manualPmMembers) {
    workgroupStore.saveMember({
      ...manualPmMember,
      id: manualPmMember.id,
      workgroupId: workgroup.id,
      name: manualPmMember.name,
      role: "custom",
      kind: "project",
      projectId: manualPmMember.projectId ?? null,
      projectName: manualPmMember.projectName ?? null,
      projectPath: manualPmMember.projectPath ?? null,
      projectKind: manualPmMember.projectKind ?? null,
      allowedPaths: manualPmMember.allowedPaths,
      systemPrompt: manualPmMember.systemPrompt ?? null,
    });
    appLogger.warn("workgroup", "Converted manual project_manager member to custom role to preserve PM uniqueness.", {
      workgroupId: workgroup.id,
      memberId: manualPmMember.id,
      memberName: manualPmMember.name,
    });
  }
  const matchingPmMembers = workgroupStore
    .listMembers(workgroup.id)
    .filter((member) => member.kind === "pm" || member.projectId === pmProjectId);
  const existingPm = matchingPmMembers[0];
  for (const duplicate of matchingPmMembers.slice(1)) {
    workgroupStore.removeMember(duplicate.id);
  }
  if (workgroup.planWorkspacePath !== planWorkspacePath) {
    workgroupStore.saveWorkgroup({
      ...workgroup,
      id: workgroup.id,
      name: workgroup.name,
      description: workgroup.description ?? null,
      allowDirectMemberMessages: workgroup.allowDirectMemberMessages,
      groupNumber: workgroup.groupNumber ?? null,
      planWorkspacePath,
      registryUpdatedAt: workgroup.registryUpdatedAt ?? null,
    });
  }
  return workgroupStore.saveMember({
    id: existingPm?.id,
    workgroupId: workgroup.id,
    name: existingPm?.name?.trim() || "PM Agent",
    role: "project_manager",
    kind: "pm",
    projectId: pmProjectId,
    projectName: "PM Agent",
    projectPath: planWorkspacePath,
    projectKind: "local",
    allowedPaths: [planWorkspacePath],
    systemPrompt: existingPm?.systemPrompt?.trim()
      || "Coordinate the workgroup, keep plans in this workspace, break goals into clear subtasks, and summarize final outcomes.",
  });
}

function normalizeAllWorkgroupPmMembers(): void {
  for (const workgroup of workgroupStore.listWorkgroups()) {
    ensurePmMember(workgroup);
  }
}

function syncWorkgroupMembersFromSelection(workgroup: Workgroup, selectedProjectIds: string[]): void {
  const selectedIds = Array.from(
    new Set(
      selectedProjectIds
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => Boolean(entry) && !isWorkgroupPmProjectId(entry)),
    ),
  );
  const existingMembers = workgroupStore.listMembers(workgroup.id);
  const projectMembers = existingMembers.filter((member) => member.kind !== "pm");
  const existingByProjectId = new Map(
    projectMembers
      .filter((member) => member.projectId)
      .map((member) => [member.projectId as string, member] as const),
  );

  for (const member of projectMembers) {
    if (!member.projectId || selectedIds.includes(member.projectId)) {
      continue;
    }
    workgroupStore.removeMember(member.id);
  }

  for (const projectId of selectedIds) {
    const binding = resolveWorkgroupProjectBinding(projectId);
    if (!binding.projectExists || !binding.projectId) {
      continue;
    }
    const existing = existingByProjectId.get(projectId);
    workgroupStore.saveMember({
      id: existing?.id,
      workgroupId: workgroup.id,
      name: existing?.name?.trim() || binding.projectName || projectId,
      role: existing?.role || (binding.projectKind === "remote" ? "qa" : "developer"),
      kind: "project",
      projectId: binding.projectId,
      projectName: binding.projectName,
      projectPath: binding.projectPath,
      projectKind: binding.projectKind,
      allowedPaths: existing?.allowedPaths ?? [],
      systemPrompt: existing?.systemPrompt ?? null,
    });
  }

  ensurePmMember(workgroup);
}

async function publishWorkgroupRegistry(workgroupId: string): Promise<WorkgroupRegistryRecord> {
  const payload = buildWorkgroupRegistryPayload(workgroupId);
  if (!payload) {
    throw new Error("Workgroup not found");
  }
  const response = await requestWorkgroupRegistry<{ record: WorkgroupRegistryRecord }>("/api/workgroups/registry/publish", {
    method: "POST",
    body: payload,
  });
  const current = workgroupStore.getWorkgroupById(workgroupId);
  if (current) {
    workgroupStore.saveWorkgroup({
      ...current,
      id: current.id,
      name: current.name,
      description: current.description ?? null,
      allowDirectMemberMessages: current.allowDirectMemberMessages,
      groupNumber: response.record.groupNumber,
      planWorkspacePath: current.planWorkspacePath ?? getDefaultWorkgroupPlanPath(current.id),
      registryUpdatedAt: response.record.updatedAt,
    });
  }
  return response.record;
}

async function removeWorkgroupRegistry(workgroupId: string): Promise<void> {
  await requestWorkgroupRegistry<{ success: boolean }>(
    `/api/workgroups/registry?workgroup_id=${encodeURIComponent(workgroupId)}`,
    { method: "DELETE" },
  );
}

function buildWorkgroupRelayPayload() {
  return workgroupRelayCache.get(loadConfig().agentId, () => loadSerializedWorkgroups()).relayPayload;
}

function broadcastWorkgroupsChanged(): void {
  workgroupRelayCache.invalidate();
  const workgroups = listSerializedWorkgroups();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("workgroups-changed", workgroups);
  }

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("workgroups-changed", workgroups);
  }

  const relayPayload = buildWorkgroupRelayPayload();
  if (relayClient && relayClient.isConnected() && relayPayload) {
    if (relayPayload.revision === lastWorkgroupRelayPayloadRevision) {
      workgroupCollaborationService.notifyWorkgroupStructureChanged();
      return;
    }
    lastWorkgroupRelayPayloadRevision = relayPayload.revision;
    relayClient.send({
      id: uuidv4(),
      event: Events.WORKGROUP_LIST,
      agent_id: relayPayload.agent_id,
      ts: Date.now(),
      payload: relayPayload,
    });
  }
  workgroupCollaborationService.notifyWorkgroupStructureChanged();
}

function buildWorkgroupDispatchPrompt(
  workgroup: Workgroup,
  member: WorkgroupMemberView,
  task: WorkgroupTask,
): string {
  const collaborationRule = workgroup.allowDirectMemberMessages
    ? "You may reference other members for handoff notes, but do not fabricate completed work from them."
    : "Do not simulate direct conversations with other members. Complete only your assigned portion and leave handoff notes when needed.";
  const roleRule = member.role === "qa"
    ? "Focus on testing, verification, deployment checks, and evidence. Avoid broad code refactors unless the task explicitly requires it."
    : (member.role === "project_manager"
      ? "Act as a coordinator. Break work down, summarize status, and assign follow-ups. Do not make code changes unless the task explicitly asks for it."
      : (member.role === "developer"
        ? "Focus on implementation inside the assigned project. Keep changes scoped and practical."
        : "Follow the custom role instructions below while staying within the assigned scope."));
  const allowedPaths = member.allowedPaths.length > 0
    ? member.allowedPaths.map((entry) => `- ${entry}`).join("\n")
    : "- No extra path restriction was configured. Stay within the assigned project.";
  const taskDescription = task.description?.trim() || "No additional description provided.";
  const acceptanceCriteria = task.acceptanceCriteria?.trim() || "No explicit acceptance criteria provided.";
  const customPrompt = member.systemPrompt?.trim()
    ? `Custom member instructions:\n${member.systemPrompt.trim()}\n\n`
    : "";

  return [
    "Workgroup execution context",
    `Workgroup: ${workgroup.name}`,
    `Member: ${member.name}`,
    `Role: ${member.role}`,
    `Bound project: ${member.projectName || member.projectId || "unbound"}`,
    "",
    "Operating rules",
    roleRule,
    collaborationRule,
    "Only operate inside the bound project and the allowed paths below.",
    allowedPaths,
    "",
    customPrompt.trim(),
    customPrompt ? "" : "",
    "Assigned task",
    `Title: ${task.title}`,
    `Priority: ${task.priority}`,
    `Description: ${taskDescription}`,
    `Acceptance criteria: ${acceptanceCriteria}`,
    "",
    "Response format",
    "Provide a concise execution report with: outcome, changed files or commands, validation result, blockers or handoff notes.",
  ]
    .filter((entry, index, source) => !(entry === "" && source[index - 1] === ""))
    .join("\n");
}

function touchWorkgroup(workgroupId: string): void {
  const workgroup = workgroupStore.getWorkgroupById(workgroupId);
  if (!workgroup) {
    return;
  }
  const planWorkspacePath = resolveWorkgroupPlanPath(
    workgroup.id,
    workgroup.planWorkspacePath ?? getDefaultWorkgroupPlanPath(workgroup.id),
  );
  workgroupStore.saveWorkgroup({
    ...workgroup,
    id: workgroup.id,
    name: workgroup.name,
    description: workgroup.description ?? null,
    allowDirectMemberMessages: workgroup.allowDirectMemberMessages,
    groupNumber: workgroup.groupNumber ?? null,
    planWorkspacePath,
    registryUpdatedAt: workgroup.registryUpdatedAt ?? null,
  });
}

function updateWorkgroupTask(taskId: string, updates: Partial<WorkgroupTask>): WorkgroupTask | null {
  const task = workgroupStore.getTaskById(taskId);
  if (!task) {
    return null;
  }

  const nextTask = workgroupStore.saveTask({
    ...task,
    ...updates,
    id: task.id,
    workgroupId: task.workgroupId,
    title: updates.title ?? task.title,
  });
  touchWorkgroup(task.workgroupId);
  return nextTask;
}

function getDispatchedAssistantMessageId(task: WorkgroupTask): string | null {
  const runId = task.dispatchRunId?.trim() || "";
  return runId ? `${runId}:assistant` : null;
}

function syncWorkgroupTasksForProjectSnapshot(snapshot: ProjectSessionSnapshot): void {
  const trackedTasks = workgroupStore.listTasks().filter((task) => (
    task.dispatchProjectId === snapshot.projectId
    && Boolean(task.dispatchRunId)
    && (task.status === "assigned" || task.status === "running")
  ));
  if (trackedTasks.length === 0) {
    return;
  }

  let changed = false;
  for (const task of trackedTasks) {
    const runId = task.dispatchRunId?.trim() || "";
    if (!runId) {
      continue;
    }

    const assistantMessageId = getDispatchedAssistantMessageId(task);
    const queued = snapshot.queue.some((entry) => entry.runId === runId);
    const userMessage = snapshot.messages.find((entry) => entry.id === runId);
    const assistantMessage = assistantMessageId
      ? snapshot.messages.find((entry) => entry.id === assistantMessageId)
      : undefined;
    const errorMessage = assistantMessageId
      ? snapshot.messages.find((entry) => entry.id === `${assistantMessageId}:error`)
      : undefined;

    let nextStatus: WorkgroupTaskStatus | null = null;
    let nextResult: string | null | undefined;

    if (errorMessage) {
      nextStatus = "error";
      nextResult = errorMessage.content?.trim() || "Assigned member project reported an error.";
    } else if (queued) {
      nextStatus = "assigned";
      nextResult = "Waiting in the assigned member project queue.";
    } else if (assistantMessage?.status === "streaming") {
      nextStatus = "running";
      nextResult = "Assigned member project is generating a response.";
    } else if (assistantMessage?.status === "done") {
      nextStatus = "done";
      nextResult = "Completed by assigned member project.";
    } else if (
      snapshot.isRunning
      && (
        (Boolean(userMessage) && !assistantMessage)
        || (
          typeof snapshot.currentStartedAt === "number"
          && typeof task.lastDispatchAt === "number"
          && snapshot.currentStartedAt >= task.lastDispatchAt
        )
      )
    ) {
      nextStatus = "running";
      nextResult = "Assigned member project is executing the dispatched task.";
    }

    if (!nextStatus) {
      continue;
    }

    if (task.status === nextStatus && (nextResult === undefined || task.lastDispatchResult === nextResult)) {
      continue;
    }

    updateWorkgroupTask(task.id, {
      status: nextStatus,
      lastDispatchResult: nextResult,
    });
    changed = true;
  }

  if (changed) {
    broadcastWorkgroupsChanged();
  }
}

function broadcastSessionSync(snapshot: ProjectSessionSnapshot, immediate = false): void {
  if (isWorkgroupPmProjectId(snapshot.projectId)) {
    clearRelaySyncState(snapshot.projectId);
    return;
  }

  if (!relayClient || !relayClient.isConnected()) {
    return;
  }

  pendingRelaySyncSnapshotsByProject.set(snapshot.projectId, snapshot);
  const flush = () => {
    relaySyncTimersByProject.delete(snapshot.projectId);
    const latestSnapshot = pendingRelaySyncSnapshotsByProject.get(snapshot.projectId);
    if (!latestSnapshot || !relayClient || !relayClient.isConnected()) {
      return;
    }

    const afterSeq = lastBroadcastSyncSeqByProject.has(latestSnapshot.projectId)
      ? (lastBroadcastSyncSeqByProject.get(latestSnapshot.projectId) ?? 0)
      : 0;
    const delta = runtimeManager.buildSyncDelta(latestSnapshot.projectId, { afterSeq });
    const payload = buildSessionSyncPayload(latestSnapshot, delta, { afterSeq });
    const payloadHash = JSON.stringify(payload);
    if (lastBroadcastSyncPayloadHashByProject.get(latestSnapshot.projectId) === payloadHash) {
      return;
    }

    lastBroadcastSyncSeqByProject.set(latestSnapshot.projectId, delta.latestSeq);
    lastBroadcastSyncPayloadHashByProject.set(latestSnapshot.projectId, payloadHash);
    relayClient.send({
      id: uuidv4(),
      event: Events.SESSION_SYNC,
      project_id: latestSnapshot.projectId,
      ts: Date.now(),
      payload,
    });
  };

  const existingTimer = relaySyncTimersByProject.get(snapshot.projectId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  if (immediate) {
    flush();
    return;
  }

  relaySyncTimersByProject.set(snapshot.projectId, setTimeout(flush, RELAY_SYNC_DEBOUNCE_MS));
}

function clearRelaySyncState(projectId?: string): void {
  const projectIds = projectId ? [projectId] : Array.from(new Set([
    ...relaySyncTimersByProject.keys(),
    ...pendingRelaySyncSnapshotsByProject.keys(),
    ...lastBroadcastSyncPayloadHashByProject.keys(),
    ...lastBroadcastSyncSeqByProject.keys(),
  ]));

  for (const currentProjectId of projectIds) {
    const timer = relaySyncTimersByProject.get(currentProjectId);
    if (timer) {
      clearTimeout(timer);
      relaySyncTimersByProject.delete(currentProjectId);
    }
    pendingRelaySyncSnapshotsByProject.delete(currentProjectId);
    lastBroadcastSyncPayloadHashByProject.delete(currentProjectId);
    lastBroadcastSyncSeqByProject.delete(currentProjectId);
  }

  if (!projectId) {
    for (const [workgroupId, timer] of workgroupCollaborationRelaySnapshotTimers.entries()) {
      clearTimeout(timer);
      workgroupCollaborationRelaySnapshotTimers.delete(workgroupId);
    }
    pendingWorkgroupCollaborationRelaySnapshots.clear();
    lastBroadcastWorkgroupCollaborationSnapshotHashByWorkgroup.clear();
    lastWorkgroupCollaborationRelayPayloadHash = "";
  }
}

function revealWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }

  if (win.isMinimized()) {
    win.restore();
  }
  if (!win.isVisible()) {
    win.show();
  }

  win.focus();
  win.flashFrame(true);
  setTimeout(() => {
    if (!win.isDestroyed()) {
      win.flashFrame(false);
    }
  }, 1200);
}

function loadConfig(): AgentConfig {
  const legacyToken = configStore.get("token") as string;
  const encryptedToken = (configStore.get("encryptedToken") as string) || "";
  const resolvedToken =
    process.env.AGENT_TOKEN?.trim()
    || decodeSecretFromStore(encryptedToken)
    || legacyToken
    || "";

  if (!process.env.AGENT_TOKEN && legacyToken && !encryptedToken) {
    configStore.set("encryptedToken", encodeSecretForStore(legacyToken));
    configStore.set("token", "");
  }

  return {
    serverUrl: (process.env.RELAY_SERVER_URL ?? configStore.get("serverUrl")) as string,
    agentId: (process.env.AGENT_ID ?? configStore.get("agentId")) as string,
    token: resolvedToken,
    username: configStore.get("username") as string,
    password: decodeSecretFromStore(configStore.get("encryptedPassword") as string),
    controllerDeviceId: (configStore.get("controllerDeviceId") as string) || "",
    controllerToken: decodeSecretFromStore(configStore.get("encryptedControllerToken") as string),
    controllerTokenExpiresAt: (configStore.get("controllerTokenExpiresAt") as string) || "",
    openaiApiKey: decodeSecretFromStore(configStore.get("encryptedOpenaiApiKey") as string),
    openaiBaseUrl: (configStore.get("openaiBaseUrl") as string) || "",
    openaiDefaultModel: (configStore.get("openaiDefaultModel") as string) || "",
    anthropicApiKey: decodeSecretFromStore(configStore.get("encryptedAnthropicApiKey") as string),
    anthropicBaseUrl: (configStore.get("anthropicBaseUrl") as string) || "",
    anthropicDefaultModel: (configStore.get("anthropicDefaultModel") as string) || "",
    githubToken: decodeSecretFromStore(configStore.get("encryptedGithubToken") as string),
    tokenExpiresAt: (configStore.get("tokenExpiresAt") as string) || "",
    cliProvider: ((process.env.CLI_PROVIDER ?? configStore.get("cliProvider")) as CliProvider) || "claude",
  };
}

function getPublicConfig(): Omit<AgentConfig, "encryptedToken" | "encryptedPassword" | "encryptedOpenaiApiKey" | "encryptedAnthropicApiKey" | "encryptedGithubToken"> {
  const config = loadConfig();
  return {
    serverUrl: config.serverUrl,
    agentId: config.agentId,
    token: config.token ? "__cached__" : "",
    username: config.username,
    password: config.password,
    controllerDeviceId: config.controllerDeviceId,
    controllerToken: config.controllerToken ? "__cached__" : "",
    controllerTokenExpiresAt: config.controllerTokenExpiresAt,
    openaiApiKey: config.openaiApiKey,
    openaiBaseUrl: config.openaiBaseUrl,
    openaiDefaultModel: config.openaiDefaultModel,
    anthropicApiKey: config.anthropicApiKey,
    anthropicBaseUrl: config.anthropicBaseUrl,
    anthropicDefaultModel: config.anthropicDefaultModel,
    githubToken: config.githubToken,
    tokenExpiresAt: config.tokenExpiresAt,
    cliProvider: config.cliProvider,
  };
}

function getProviderEnvironment(provider: CliProvider): Record<string, string> {
  const config = loadConfig();
  const githubToken = config.githubToken?.trim() || process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || "";
  const gitEnv = buildGitHubCommandEnvironment(githubToken);
  return buildProviderEnvironment(config as ProviderConfigSnapshot, provider, gitEnv);
}

function saveAuthState(data: {
  token: string;
  password: string;
  expiresAt: string;
  username: string;
}): void {
  configStore.set("username", data.username);
  configStore.set("encryptedPassword", encodeSecretForStore(data.password));
  configStore.set("encryptedToken", encodeSecretForStore(data.token));
  configStore.set("token", "");
  configStore.set("tokenExpiresAt", data.expiresAt);
}

function saveControllerAuthState(data: {
  token: string;
  expiresAt: string;
  deviceId: string;
}): void {
  configStore.set("controllerDeviceId", data.deviceId);
  configStore.set("encryptedControllerToken", encodeSecretForStore(data.token));
  configStore.set("controllerToken", "");
  configStore.set("controllerTokenExpiresAt", data.expiresAt);
}

function updateRelayClientAuthFromConfig(): void {
  if (!relayClient) {
    return;
  }

  const config = loadConfig();
  relayClient.updateAuth(config.serverUrl, config.agentId, config.token);
}

function getControllerDeviceId(): string {
  const config = loadConfig();
  const stored = config.controllerDeviceId?.trim() ?? "";
  if (stored) {
    return stored;
  }
  return config.agentId?.trim() ? `desktop-controller-${config.agentId.trim()}` : `desktop-controller-${uuidv4()}`;
}

function updateControllerRelayClientAuthFromConfig(): void {
  if (!controllerRelayClient) {
    return;
  }

  const config = loadConfig();
  controllerRelayClient.updateAuth(
    config.serverUrl,
    "",
    config.controllerToken ?? "",
    getControllerDeviceId(),
  );
}

function ensureRemoteRelayReady(configOverride?: AgentConfig): boolean {
  const config = configOverride ?? loadConfig();
  if (
    !config.username?.trim()
    || !config.password?.trim()
    || !config.agentId?.trim()
    || !config.controllerToken?.trim()
  ) {
    return false;
  }

  if (!controllerRelayClient || !remoteSessionStore) {
    if (controllerRelayClient) {
      controllerRelayClient.disconnect();
      controllerRelayClient = null;
    }
    remoteSessionStore = null;
    initRemoteRelay(config);
    return true;
  }

  updateControllerRelayClientAuthFromConfig();
  if (controllerRelayClient.isConnected()) {
    requestRemoteProjectCatalogRefresh();
    scheduleRemoteProjectCatalogRefresh(1_500);
    return true;
  }

  controllerRelayClient.connect();
  return true;
}

async function recoverAgentRelayAuthentication(reason: string): Promise<void> {
  const refreshed = await refreshAgentToken(true);
  if (!refreshed) {
    appLogger.warn("relay", "Agent relay auth recovery aborted because token refresh failed.", {
      reason,
    });
    return;
  }
  if (!relayClient) {
    return;
  }
  console.warn(`[Main] Recovering agent relay after auth failure: ${reason}`);
  relayClient.resetResumeState();
  updateRelayClientAuthFromConfig();
  relayClient.connect();
}

async function recoverControllerRelayAuthentication(reason: string): Promise<void> {
  const refreshed = await refreshControllerToken(true);
  if (!refreshed) {
    appLogger.warn("relay", "Controller relay auth recovery aborted because token refresh failed.", {
      reason,
    });
    return;
  }
  ensureRemoteRelayReady(loadConfig());
  if (!controllerRelayClient) {
    return;
  }
  console.warn(`[Main] Recovering controller relay after auth failure: ${reason}`);
  controllerRelayClient.resetResumeState();
  updateControllerRelayClientAuthFromConfig();
  controllerRelayClient.connect();
}

function runRelayHealthCheck(reason: string): void {
  relayClient?.ensureHealthyConnection(`agent:${reason}`, RELAY_STALE_CONNECTION_TIMEOUT_MS);
  controllerRelayClient?.ensureHealthyConnection(`controller:${reason}`, RELAY_STALE_CONNECTION_TIMEOUT_MS);
  lastAgentRelayRecoveryAt = maybeRecoverRelayClient(
    relayClient?.getConnectionSnapshot() ?? null,
    lastAgentRelayRecoveryAt,
    recoverAgentRelayAuthentication,
    `agent-${reason}`,
  );
  lastControllerRelayRecoveryAt = maybeRecoverRelayClient(
    controllerRelayClient?.getConnectionSnapshot() ?? null,
    lastControllerRelayRecoveryAt,
    recoverControllerRelayAuthentication,
    `controller-${reason}`,
  );
}

function startRelayHealthChecks(): void {
  if (relayHealthCheckTimer) {
    clearInterval(relayHealthCheckTimer);
  }
  relayHealthCheckTimer = setInterval(() => {
    runRelayHealthCheck("periodic");
  }, RELAY_HEALTH_CHECK_INTERVAL_MS);
}

function runRelayMaintenanceTask(reason: string): void {
  void refreshAgentToken(false);
  void refreshControllerToken(false);
  runRelayHealthCheck(reason);

  if (controllerRelayClient?.isConnected()) {
    requestRemoteProjectCatalogRefresh();
  }
  void refreshRemoteWorkgroupCatalog(false);
}

function startRelayMaintenanceTask(): void {
  if (relayMaintenanceTimer) {
    clearInterval(relayMaintenanceTimer);
  }
  relayMaintenanceTimer = setInterval(() => {
    runRelayMaintenanceTask("periodic");
  }, RELAY_MAINTENANCE_INTERVAL_MS);
}

function clearRelayFollowUpRefreshTimers(): void {
  for (const timer of relayFollowUpRefreshTimers) {
    clearTimeout(timer);
  }
  relayFollowUpRefreshTimers.clear();
}

function getRemoteProjectSyncRecency(projectId: string): number {
  const snapshot = remoteSessionStore?.getSnapshot(projectId);
  if (!snapshot) {
    return 0;
  }

  const latestConversationAt = snapshot.conversations.reduce(
    (maxUpdatedAt, conversation) => Math.max(maxUpdatedAt, Number(conversation.updatedAt) || 0),
    0,
  );
  const latestQueuedAt = snapshot.queue.reduce(
    (maxQueuedAt, entry) => Math.max(maxQueuedAt, Number(entry.queuedAt) || 0),
    0,
  );
  const latestMessageAt = snapshot.messages.reduce(
    (maxUpdatedAt, entry) => Math.max(maxUpdatedAt, Number(entry.updatedAt) || 0),
    0,
  );
  const latestActivityAt = snapshot.activities.reduce(
    (maxUpdatedAt, entry) => Math.max(maxUpdatedAt, Number(entry.updatedAt) || 0),
    0,
  );

  return Math.max(
    Number(snapshot.currentStartedAt) || 0,
    latestConversationAt,
    latestQueuedAt,
    latestMessageAt,
    latestActivityAt,
  );
}

function requestRemoteProjectSync(
  projectId: string,
  reason: string,
  force: boolean = false,
  detailMode: RemoteProjectSyncDetailMode = "auto",
): boolean {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId || !remoteSessionStore || !isRemoteProject(normalizedProjectId)) {
    return false;
  }

  const project = remoteSessionStore.getProject(normalizedProjectId);
  if (project?.online === false) {
    return false;
  }

  if (!remoteProjectSyncGate.tryStart(normalizedProjectId, { force })) {
    return false;
  }
  const summaryOnly = shouldUseSummaryOnlyProjectSync({
    projectId: normalizedProjectId,
    activeProjectId: activeWorkspaceProjectId,
    detailMode,
  });
  remoteSessionStore.requestSessionSync(normalizedProjectId, {
    limit: 30,
    summaryOnly,
  });
  appLogger.info("relay", "Requested remote project sync.", {
    reason,
    force,
    projectId: normalizedProjectId,
    isActiveProject: normalizedProjectId === (activeWorkspaceProjectId?.trim() ?? ""),
    detailMode,
    summaryOnly,
  });
  return true;
}

function getPrioritizedRemoteProjectSyncIds(limit: number = REMOTE_PROJECT_FOLLOW_UP_SYNC_LIMIT): string[] {
  if (!remoteSessionStore || limit <= 0) {
    return [];
  }

  const activeProjectId = activeWorkspaceProjectId?.trim() ?? "";
  const seen = new Set<string>();
  const projectIds: string[] = [];
  const pushProjectId = (projectId: string): void => {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId || seen.has(normalizedProjectId) || !isRemoteProject(normalizedProjectId)) {
      return;
    }
    const project = remoteSessionStore?.getProject(normalizedProjectId);
    if (project?.online === false) {
      return;
    }
    seen.add(normalizedProjectId);
    projectIds.push(normalizedProjectId);
  };

  pushProjectId(activeProjectId);
  const rankedProjects = remoteSessionStore
    .getProjects()
    .filter((project) => project.online !== false)
    .map((project) => {
      const snapshot = remoteSessionStore?.getSnapshot(project.id);
      return {
        id: project.id,
        name: project.name,
        isActive: project.id === activeProjectId,
        isRunning: Boolean(snapshot?.isRunning),
        queuedCount: snapshot?.queuedCount ?? 0,
        recency: getRemoteProjectSyncRecency(project.id),
      };
    })
    .sort((left, right) =>
      Number(right.isActive) - Number(left.isActive)
      || Number(right.isRunning) - Number(left.isRunning)
      || right.queuedCount - left.queuedCount
      || right.recency - left.recency
      || left.name.localeCompare(right.name, "zh-CN"),
    );

  for (const project of rankedProjects) {
    pushProjectId(project.id);
    if (projectIds.length >= limit) {
      break;
    }
  }

  return projectIds.slice(0, limit);
}

function requestPrioritizedRemoteProjectSyncs(reason: string, force: boolean = false): number {
  const projectIds = getPrioritizedRemoteProjectSyncIds();
  const requestedProjectIds = projectIds.filter((projectId) => requestRemoteProjectSync(projectId, reason, force));
  if (requestedProjectIds.length > 0) {
    appLogger.info("relay", "Requested prioritized remote project sync batch.", {
      reason,
      force,
      projectCount: requestedProjectIds.length,
      projectIds: requestedProjectIds.join(","),
      activeProjectId: activeWorkspaceProjectId?.trim() || null,
    });
  }
  return requestedProjectIds.length;
}

function requestRemoteWorkgroupSessionSync(compositeId: string, reason: string, force: boolean = false): boolean {
  const normalizedCompositeId = compositeId.trim();
  if (!normalizedCompositeId || !remoteWorkgroupStore || !parseCompositeWorkgroupId(normalizedCompositeId)) {
    return false;
  }

  const summary = remoteWorkgroupStore
    .listSummaries()
    .find((entry) => entry.id === normalizedCompositeId);
  if (!summary) {
    return false;
  }

  if (!remoteWorkgroupSessionSyncGate.tryStart(normalizedCompositeId, { force })) {
    return false;
  }

  appLogger.info("workgroup", "Requested remote workgroup session sync.", {
    reason,
    force,
    workgroupId: normalizedCompositeId,
    isActiveWorkgroup: normalizedCompositeId === (activeWorkgroupCollaborationId?.trim() ?? ""),
  });
  void remoteWorkgroupStore.requestSession(normalizedCompositeId, { limit: 30 })
    .then((result) => {
      if (!result.success) {
        appLogger.warn("workgroup", "Remote workgroup session sync failed.", {
          reason,
          workgroupId: normalizedCompositeId,
          error: result.error ?? "unknown",
        });
      }
    })
    .finally(() => {
      remoteWorkgroupSessionSyncGate.finish(normalizedCompositeId);
    });
  return true;
}

function getPrioritizedRemoteWorkgroupSessionIds(limit: number = REMOTE_WORKGROUP_FOLLOW_UP_SYNC_LIMIT): string[] {
  if (!remoteWorkgroupStore || limit <= 0) {
    return [];
  }

  const activeCompositeId = activeWorkgroupCollaborationId?.trim() ?? "";
  const seen = new Set<string>();
  const compositeIds: string[] = [];
  const pushCompositeId = (compositeId: string): void => {
    const normalizedCompositeId = compositeId.trim();
    if (!normalizedCompositeId || seen.has(normalizedCompositeId) || !parseCompositeWorkgroupId(normalizedCompositeId)) {
      return;
    }
    seen.add(normalizedCompositeId);
    compositeIds.push(normalizedCompositeId);
  };

  pushCompositeId(activeCompositeId);
  const rankedSummaries = remoteWorkgroupStore
    .listSummaries()
    .filter((summary) => Boolean(parseCompositeWorkgroupId(summary.id)))
    .sort((left, right) =>
      Number(right.id === activeCompositeId) - Number(left.id === activeCompositeId)
      || Number(right.isRunning) - Number(left.isRunning)
      || right.updatedAt - left.updatedAt
      || right.messageCount - left.messageCount
      || left.name.localeCompare(right.name, "zh-CN"),
    );

  for (const summary of rankedSummaries) {
    pushCompositeId(summary.id);
    if (compositeIds.length >= limit) {
      break;
    }
  }

  return compositeIds.slice(0, limit);
}

function requestPrioritizedRemoteWorkgroupSessionSyncs(reason: string, force: boolean = false): number {
  const compositeIds = getPrioritizedRemoteWorkgroupSessionIds();
  const requestedCompositeIds = compositeIds.filter((compositeId) => requestRemoteWorkgroupSessionSync(compositeId, reason, force));
  if (requestedCompositeIds.length > 0) {
    appLogger.info("workgroup", "Requested prioritized remote workgroup session sync batch.", {
      reason,
      force,
      workgroupCount: requestedCompositeIds.length,
      workgroupIds: requestedCompositeIds.join(","),
      activeWorkgroupId: activeWorkgroupCollaborationId?.trim() || null,
    });
  }
  return requestedCompositeIds.length;
}

function requestActiveRemoteProjectSync(reason: string, force: boolean = false): void {
  const projectId = activeWorkspaceProjectId?.trim() ?? "";
  if (!projectId) {
    return;
  }

  const now = Date.now();
  if (!force && now - lastActiveRemoteProjectSyncAt < ACTIVE_REMOTE_PROJECT_SYNC_MIN_INTERVAL_MS) {
    return;
  }

  if (!requestRemoteProjectSync(projectId, reason, force, "full")) {
    return;
  }

  lastActiveRemoteProjectSyncAt = now;
  appLogger.info("relay", "Requested active remote project sync.", {
    reason,
    force,
    projectId,
  });
}

async function runRelayFollowUpRefresh(reason: string): Promise<void> {
  appLogger.info("relay", "Running relay follow-up refresh.", {
    reason,
  });
  ensureRemoteRelayReady(loadConfig());

  if (remoteProjectCatalogRefreshTimer) {
    clearTimeout(remoteProjectCatalogRefreshTimer);
    remoteProjectCatalogRefreshTimer = null;
  }
  lastRemoteProjectCatalogRefreshAt = 0;
  lastRemoteWorkgroupCatalogRefreshAt = 0;

  requestRemoteProjectCatalogRefresh(`follow-up:${reason}`);
  await refreshRemoteWorkgroupCatalog(true, `follow-up:${reason}`);
  const requestedProjectSyncCount = requestPrioritizedRemoteProjectSyncs(`follow-up:${reason}`, true);
  const requestedWorkgroupSyncCount = requestPrioritizedRemoteWorkgroupSessionSyncs(`follow-up:${reason}`, true);
  appLogger.info("relay", "Completed relay follow-up refresh.", {
    reason,
    requestedProjectSyncCount,
    requestedWorkgroupSyncCount,
    requestedActiveProjectSync: Boolean(activeWorkspaceProjectId?.trim() && isRemoteProject(activeWorkspaceProjectId)),
    requestedActiveWorkgroupSync: Boolean(activeWorkgroupCollaborationId?.trim() && parseCompositeWorkgroupId(activeWorkgroupCollaborationId)),
  });
}

function scheduleRelayFollowUpRefreshes(reason: string): void {
  clearRelayFollowUpRefreshTimers();
  appLogger.info("relay", "Scheduled relay follow-up refreshes.", {
    reason,
    delaysMs: RELAY_FOLLOW_UP_REFRESH_DELAYS_MS.join(","),
  });
  for (const delayMs of RELAY_FOLLOW_UP_REFRESH_DELAYS_MS) {
    const timer = setTimeout(() => {
      relayFollowUpRefreshTimers.delete(timer);
      void runRelayFollowUpRefresh(`${reason}:${delayMs}`);
    }, delayMs);
    relayFollowUpRefreshTimers.add(timer);
  }
}

function requestRemoteProjectCatalogRefresh(reason: string = "unspecified"): void {
  if (!remoteSessionStore || !controllerRelayClient) {
    return;
  }

  if (!controllerRelayClient.isConnected()) {
    return;
  }

  const now = Date.now();
  const delayMs = REMOTE_PROJECT_CATALOG_REFRESH_MIN_INTERVAL_MS - (now - lastRemoteProjectCatalogRefreshAt);
  if (delayMs > 0) {
    if (!remoteProjectCatalogRefreshTimer) {
      remoteProjectCatalogRefreshTimer = setTimeout(() => {
        remoteProjectCatalogRefreshTimer = null;
        requestRemoteProjectCatalogRefresh(reason);
      }, delayMs);
    }
    return;
  }

  lastRemoteProjectCatalogRefreshAt = now;
  appLogger.info("relay", "Requested remote project catalog refresh.", {
    reason,
  });
  remoteSessionStore.requestProjectList();
}

function scheduleRemoteProjectCatalogRefresh(delayMs: number, reason: string = "scheduled"): void {
  setTimeout(() => {
    requestRemoteProjectCatalogRefresh(reason);
  }, Math.max(0, delayMs));
}

function requestUiRemoteProjectListRefresh(reason: string = "ui-project-list-refresh"): void {
  const result = uiRemoteProjectRefreshTrigger.trigger(() => {
    requestRemoteProjectCatalogRefresh(reason);
    requestPrioritizedRemoteProjectSyncs(reason);
  });
  if (!result.immediate && result.scheduled) {
    appLogger.info("relay", "Coalesced duplicate UI remote project refresh request.", {
      reason,
      minIntervalMs: UI_REMOTE_PROJECT_REFRESH_COALESCE_MS,
    });
  }
}

async function refreshRemoteWorkgroupCatalog(force: boolean = false, reason: string = "unspecified"): Promise<void> {
  if (!remoteWorkgroupStore) {
    return;
  }
  const now = Date.now();
  if (!force && now - lastRemoteWorkgroupCatalogRefreshAt < REMOTE_WORKGROUP_CATALOG_REFRESH_MIN_INTERVAL_MS) {
    return;
  }
  lastRemoteWorkgroupCatalogRefreshAt = now;

  try {
    const response = await requestWorkgroupRegistry<{ records: WorkgroupRegistryRecord[] }>("/api/workgroups/registry/mine");
    remoteWorkgroupStore.setRegistryRecords((response.records ?? []) as RemoteWorkgroupRegistryRecord[]);
    if (controllerRelayClient?.isConnected()) {
      remoteWorkgroupStore.requestSummaries();
    }
    appLogger.info("workgroup", "Completed remote workgroup catalog refresh.", {
      reason,
      force,
      recordCount: Array.isArray(response.records) ? response.records.length : 0,
      requestedSummaries: Boolean(controllerRelayClient?.isConnected()),
    });
    broadcastWorkgroupCollaborationSummaries();
  } catch (error) {
    lastRemoteWorkgroupCatalogRefreshAt = 0;
    appLogger.warn("workgroup", "Failed to refresh remote workgroup catalog.", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function scheduleTokenRefresh(delayOverrideMs?: number): void {
  if (tokenRefreshTimer) {
    clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }

  const config = loadConfig();
  if (!config.agentId || !config.username?.trim() || !config.password?.trim()) {
    return;
  }

  const delayMs = clampTimeoutDelayMs(delayOverrideMs ?? (() => {
    if (!config.tokenExpiresAt) {
      return MIN_TOKEN_REFRESH_DELAY_MS;
    }

    const expiresAtMs = Date.parse(config.tokenExpiresAt);
    if (Number.isNaN(expiresAtMs)) {
      return MIN_TOKEN_REFRESH_DELAY_MS;
    }

    return Math.max(MIN_TOKEN_REFRESH_DELAY_MS, expiresAtMs - Date.now() - TOKEN_REFRESH_WINDOW_MS);
  })());

  tokenRefreshTimer = setTimeout(() => {
    void refreshAgentToken(true);
  }, delayMs);
}

function scheduleControllerTokenRefresh(delayOverrideMs?: number): void {
  if (controllerTokenRefreshTimer) {
    clearTimeout(controllerTokenRefreshTimer);
    controllerTokenRefreshTimer = null;
  }

  const config = loadConfig();
  if (!config.username?.trim() || !config.password?.trim() || !config.agentId?.trim()) {
    return;
  }

  const delayMs = clampTimeoutDelayMs(delayOverrideMs ?? (() => {
    if (!config.controllerTokenExpiresAt) {
      return MIN_TOKEN_REFRESH_DELAY_MS;
    }
    const expiresAtMs = Date.parse(config.controllerTokenExpiresAt);
    if (Number.isNaN(expiresAtMs)) {
      return MIN_TOKEN_REFRESH_DELAY_MS;
    }
    return Math.max(MIN_TOKEN_REFRESH_DELAY_MS, expiresAtMs - Date.now() - TOKEN_REFRESH_WINDOW_MS);
  })());

  controllerTokenRefreshTimer = setTimeout(() => {
    void refreshControllerToken(true);
  }, delayMs);
}

async function refreshAgentToken(force: boolean = false): Promise<boolean> {
  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  tokenRefreshPromise = (async () => {
    const config = loadConfig();
    if (!config.agentId) {
      return false;
    }

    if (!force && config.token && !isTokenExpiringSoon(config.tokenExpiresAt)) {
      scheduleTokenRefresh();
      updateRelayClientAuthFromConfig();
      return true;
    }

    if (!config.username?.trim() || !config.password?.trim()) {
      scheduleTokenRefresh();
      return Boolean(config.token) && !isTokenExpiringSoon(config.tokenExpiresAt);
    }

    try {
      const response = await fetchRelayJson(`${toHttpBaseUrl(config.serverUrl)}/api/auth/login`, {
        method: "POST",
        body: {
          username: config.username,
          password: config.password,
          client_type: "agent",
          client_id: config.agentId,
        },
      });

      if (!response.ok) {
        scheduleTokenRefresh(MIN_TOKEN_REFRESH_DELAY_MS);
        return Boolean(config.token) && !isTokenExpiringSoon(config.tokenExpiresAt);
      }

      const result = await response.json() as { token: string; expires_at: string; user?: { username?: string } };
      saveAuthState({
        token: result.token,
        password: config.password,
        expiresAt: result.expires_at,
        username: result.user?.username?.trim() || config.username,
      });
      updateRelayClientAuthFromConfig();
      scheduleTokenRefresh();
      return true;
    } catch (_error) {
      scheduleTokenRefresh(MIN_TOKEN_REFRESH_DELAY_MS);
      return Boolean(config.token) && !isTokenExpiringSoon(config.tokenExpiresAt);
    }
  })();

  try {
    return await tokenRefreshPromise;
  } finally {
    tokenRefreshPromise = null;
  }
}

async function refreshControllerToken(force: boolean = false): Promise<boolean> {
  if (controllerTokenRefreshPromise) {
    return controllerTokenRefreshPromise;
  }

  controllerTokenRefreshPromise = (async () => {
    const config = loadConfig();
    const deviceId = getControllerDeviceId();
    if (!config.username?.trim() || !config.password?.trim() || !config.agentId?.trim()) {
      return false;
    }

    if (!force && config.controllerToken && !isTokenExpiringSoon(config.controllerTokenExpiresAt)) {
      scheduleControllerTokenRefresh();
      updateControllerRelayClientAuthFromConfig();
      ensureRemoteRelayReady(config);
      return true;
    }

    try {
      const response = await fetchRelayJson(`${toHttpBaseUrl(config.serverUrl)}/api/auth/login`, {
        method: "POST",
        body: {
          username: config.username,
          password: config.password,
          client_type: "device",
          client_id: deviceId,
        },
      });

      if (!response.ok) {
        scheduleControllerTokenRefresh(MIN_TOKEN_REFRESH_DELAY_MS);
        return Boolean(config.controllerToken) && !isTokenExpiringSoon(config.controllerTokenExpiresAt);
      }

      const result = await response.json() as { token: string; expires_at: string };
      saveControllerAuthState({
        token: result.token,
        expiresAt: result.expires_at,
        deviceId,
      });
      updateControllerRelayClientAuthFromConfig();
      ensureRemoteRelayReady(loadConfig());
      scheduleControllerTokenRefresh();
      return true;
    } catch (_error) {
      scheduleControllerTokenRefresh(MIN_TOKEN_REFRESH_DELAY_MS);
      return Boolean(config.controllerToken) && !isTokenExpiringSoon(config.controllerTokenExpiresAt);
    }
  })();

  try {
    return await controllerTokenRefreshPromise;
  } finally {
    controllerTokenRefreshPromise = null;
  }
}

function createTray(): Tray {
  const icon = createTrayIcon();
  const trayInstance = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  trayInstance.setToolTip(t("tray.disconnected"));
  rebuildTrayMenu(trayInstance);
  trayInstance.on("click", () => {
    showWorkspaceWindow();
  });
  return trayInstance;
}

function rebuildTrayMenu(trayInstance?: Tray): void {
  const tr = trayInstance ?? tray;
  if (!tr) return;
  const projects = getAllProjects();
  const projectItems: Electron.MenuItemConstructorOptions[] = projects.map((p) => ({
    label: p.name,
    click: () => showWorkspaceWindow(p.id),
  }));

  const menu = Menu.buildFromTemplate([
    { label: t("app.name"), enabled: false },
    { type: "separator" },
    ...(projectItems.length > 0
      ? projectItems
      : [{ label: t("tray.noProjects"), enabled: false } as Electron.MenuItemConstructorOptions]),
    { type: "separator" },
    { label: t("tray.settings"), click: () => openSettingsWindow() },
    { label: t("tray.quit"), click: () => app.quit() },
  ]);
  tr.setContextMenu(menu);
}

function showMainWindow(parentWindow?: BrowserWindow | null): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(getSettingsWindowTitle(activeSettingsPane));
    broadcastSettingsPane();
    revealWindow(mainWindow);
    return;
  }
  const initialState = getWindowState("settingsWindow");
  mainWindow = new BrowserWindow(buildWindowOptions("settingsWindow", {
    title: getSettingsWindowTitle(activeSettingsPane),
    icon: createAppIcon(256),
    frame: false,
    transparent: false,
    backgroundColor: "#0d1117",
    parent: parentWindow ?? undefined,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }));
  bindWindowStatePersistence("settingsWindow", mainWindow);
  mainWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "settings.html"));
  mainWindow.webContents.on("did-finish-load", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("lang-changed", getLangPayload());
      mainWindow.webContents.send("update-state-changed", updateManager.getState());
      mainWindow.webContents.send("settings-pane-changed", activeSettingsPane);
    }
  });
  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      if (initialState.maximized) {
        mainWindow.maximize();
      }
      revealWindow(mainWindow);
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createWorkspaceWindow(): BrowserWindow {
  const initialState = getWindowState("workspaceWindow");
  const win = new BrowserWindow(buildWindowOptions("workspaceWindow", {
    title: getWorkspaceWindowTitle(activeWorkspaceProjectId),
    icon: createAppIcon(256),
    frame: false,
    transparent: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),

      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: "#0d1117",
  }));
  bindWindowStatePersistence("workspaceWindow", win);

  win.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
  win.once("ready-to-show", () => {
    if (initialState.maximized) {
      win.maximize();
    }
    revealWindow(win);
  });

  const triggerWindowRemoteRefresh = (reason: string, forceWorkgroupCatalog: boolean = false) => {
    runRelayHealthCheck(reason);
    requestRemoteProjectCatalogRefresh(reason);
    void refreshRemoteWorkgroupCatalog(forceWorkgroupCatalog, reason);
    requestPrioritizedRemoteProjectSyncs(reason);
    requestPrioritizedRemoteWorkgroupSessionSyncs(reason);
  };

  win.on("focus", () => {
    triggerWindowRemoteRefresh("workspace-focus", true);
  });

  win.on("show", () => {
    triggerWindowRemoteRefresh("workspace-show");
  });

  win.on("restore", () => {
    triggerWindowRemoteRefresh("workspace-restore");
  });

  win.webContents.on("did-finish-load", () => {
    win.webContents.send("lang-changed", getLangPayload());
    win.webContents.send("update-state-changed", updateManager.getState());
    win.webContents.send("projects-changed", getAllProjects());
    win.webContents.send("workgroup-collaboration-summaries", getAllWorkgroupCollaborationSummaries());
    for (const project of getAllProjects()) {
      const snapshot = getProjectSnapshot(project.id);
      if (snapshot) {
        win.webContents.send("project-session-snapshot", snapshot);
      }
    }
    broadcastWorkspaceSelectionState();
    triggerWindowRemoteRefresh("workspace-did-finish-load");
  });

  win.on("closed", () => {
    if (workspaceWindow === win) {
      workspaceWindow = null;
    }
  });

  return win;
}

function showWorkspaceWindow(projectId?: string): void {
  if (projectId) {
    const normalizedProjectId = projectId.trim();
    activeWorkspaceProjectId = normalizedProjectId || null;
    if (normalizedProjectId) {
      activeWorkgroupCollaborationId = null;
      if (isRemoteProject(normalizedProjectId)) {
        requestRemoteProjectSync(normalizedProjectId, "workspace-window-open", true, "full");
      }
    }
  }

  requestRemoteProjectCatalogRefresh("show-workspace-window");
  void refreshRemoteWorkgroupCatalog(false, "show-workspace-window");
  requestPrioritizedRemoteProjectSyncs("show-workspace-window");
  requestPrioritizedRemoteWorkgroupSessionSyncs("show-workspace-window");

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.setTitle(getWorkspaceWindowTitle(activeWorkspaceProjectId));
    broadcastWorkspaceSelectionState();
    revealWindow(workspaceWindow);
    return;
  }

  workspaceWindow = createWorkspaceWindow();
}

function openSettingsWindow(pane: SettingsPane = "overview"): void {
  activeSettingsPane = normalizeSettingsPane(pane);
  showMainWindow(workspaceWindow);
}

function sendProjectBind(project: Project, agentId: string): void {
  if (!relayClient || !relayClient.isConnected()) return;
  relayClient.send({
    id: uuidv4(),
    event: "project.bind",
    project_id: project.id,
    ts: Date.now(),
    payload: {
      project_id: project.id,
      name: project.name,
      path: project.path,
      agent_id: agentId,
      group_name: project.groupName ?? "",
      cli_provider: project.cliProvider,
      cli_model: project.cliModel ?? "",
      codex_web_search: normalizeCodexWebSearchEnabled(project.codexWebSearchEnabled),
      project_prompt: project.projectPrompt ?? "",
    },
  });
}

function syncProjectCatalog(agentId: string): void {
  if (!relayClient || !relayClient.isConnected()) {
    return;
  }

  relayClient.send({
    id: uuidv4(),
    event: Events.PROJECT_LIST,
    ts: Date.now(),
    payload: buildProjectListPayload(agentId),
  });
}

function initRelay(config: AgentConfig): void {
  if (!config.agentId || !config.token) {
    console.warn("[Main] agentId or token not configured — relay not started");
    return;
  }

  relayClient = new RelayClient(
    config.serverUrl,
    config.agentId,
    config.token,
    appSettingsStore.get("e2eEnabled") as boolean,
  );
  new MessageRouter(relayClient, {
    runtimeManager,
    flushProjectSessionSyncNow: (projectId: string) => {
      const snapshot = runtimeManager.getSnapshot(projectId);
      broadcastSessionSync(snapshot, true);
    },
    getDefaultCliProvider,
    syncProjectCatalog: () => syncProjectCatalog(loadConfig().agentId),
    getWorkgroupRelayPayload: () => buildWorkgroupRelayPayload(),
    dispatchWorkgroupTask: (taskId: string) => handleDispatchWorkgroupTaskRequest(taskId),
    updateWorkgroupTaskStatus: (data) => handleUpdateWorkgroupTaskStatusRequest(data),
    saveWorkgroupTask: (data) => handleSaveWorkgroupTaskRequest(data),
    deleteWorkgroupTask: (taskId: string) => handleDeleteWorkgroupTaskRequest(taskId),
    updateWorkgroupTaskScheduleEnabled: (data) => handleSetWorkgroupTaskScheduleEnabledRequest(data),
    getWorkgroupCollaborationRelayPayload: () => buildWorkgroupCollaborationRelayPayload(),
    getWorkgroupCollaborationSessionPayload: (data) => buildWorkgroupCollaborationSessionRelayPayload(data),
    sendWorkgroupCollaborationMessage: (data) => workgroupCollaborationService.sendUserMessage(
      data.workgroupId,
      data.content,
      data.clientMessageId ?? undefined,
    ),
    onProjectsChanged: () => {
      rebuildTrayMenu();
      broadcastProjectsChanged();
      updateWindowTitles();
    },
  });

  relayClient.on("connected", () => {
    console.log("[Main] Relay connected");
    clearRelaySyncState();
    lastWorkgroupRelayPayloadRevision = "";
    lastWorkgroupCollaborationRelayPayloadHash = "";
    for (const project of projectStore.getAll()) {
      lastBroadcastSyncSeqByProject.set(project.id, runtimeManager.getLatestSyncSeq(project.id));
    }
    updateTrayTooltip();
    scheduleTokenRefresh();
  });
  relayClient.on("connection-state-changed", () => {
    updateTrayTooltip();
  });

  relayClient.on("authenticated", () => {
    syncProjectCatalog(loadConfig().agentId);
    broadcastWorkgroupCollaborationRelaySummaries();
  });

  relayClient.on("disconnected", () => {
    console.log("[Main] Relay disconnected");
    clearRelaySyncState();
    lastWorkgroupRelayPayloadRevision = "";
    lastWorkgroupCollaborationRelayPayloadHash = "";
    updateTrayTooltip();
  });

  relayClient.on("auth-failed", () => {
    void recoverAgentRelayAuthentication("relay-auth-failed");
  });

  relayClient.on("error", (err: Error) => {
    console.error("[Main] Relay error:", err.message);
  });

  relayClient.connect();
}

function initRemoteRelay(config: AgentConfig): void {
  if (!config.username?.trim() || !config.password?.trim() || !config.agentId?.trim()) {
    return;
  }

  const controllerDeviceId = getControllerDeviceId();
  if (!config.controllerToken?.trim()) {
    return;
  }

  controllerRelayClient = new RelayClient(
    config.serverUrl,
    "",
    config.controllerToken,
    appSettingsStore.get("e2eEnabled") as boolean,
    {
      clientType: "device",
      deviceId: controllerDeviceId,
      resolveTargetAgentId: (env) => {
        const envelopeAgentId = env.agent_id?.trim() ?? "";
        if (envelopeAgentId) {
          return envelopeAgentId;
        }
        const payload = (env.payload ?? {}) as Record<string, unknown>;
        const payloadAgentId = typeof payload.agent_id === "string" ? payload.agent_id.trim() : "";
        if (payloadAgentId) {
          return payloadAgentId;
        }
        const projectId = env.project_id?.trim() ?? "";
        if (!projectId) {
          return null;
        }
        return remoteSessionStore?.getProjectAgentId(projectId) ?? null;
      },
    },
  );
  remoteSessionStore = new RemoteSessionStore(controllerRelayClient, {
    localAgentId: () => loadConfig().agentId,
  });
  remoteWorkgroupStore = new RemoteWorkgroupStore(controllerRelayClient, {
    localAgentId: () => loadConfig().agentId,
  });

  remoteSessionStore.on("projects-changed", (projects: unknown) => {
    appLogger.info("relay", "Remote project catalog updated.", {
      projectCount: Array.isArray(projects) ? projects.length : remoteSessionStore?.getProjects().length ?? 0,
    });
    broadcastProjectsChanged();
    updateWindowTitles();
    requestPrioritizedRemoteProjectSyncs("remote-projects-changed");
  });
  remoteSessionStore.on("run-completed", (payload: { projectId: string; source?: string | null }) => {
    appLogger.info("relay", "Remote project run completed.", {
      projectId: payload?.projectId || null,
      source: payload?.source || null,
    });
    playCompletionSound();
  });
  remoteSessionStore.on("snapshot", (projectId: string, snapshot: ProjectSessionSnapshot) => {
    appLogger.info("relay", "Remote session snapshot updated.", {
      projectId,
      isActiveProject: projectId === (activeWorkspaceProjectId?.trim() ?? ""),
      queuedCount: snapshot.queuedCount,
      messageTotal: snapshot.messageTotal,
      conversationCount: Array.isArray(snapshot.conversations) ? snapshot.conversations.length : 0,
      isRunning: snapshot.isRunning,
      activeConversationId: snapshot.activeConversationId || null,
    });
    remoteProjectSyncGate.finish(projectId);
    syncWorkgroupTasksForProjectSnapshot(snapshot);
    if (workspaceWindow && !workspaceWindow.isDestroyed()) {
      workspaceWindow.webContents.send("project-session-snapshot", snapshot);
    }
  });
  remoteWorkgroupStore.on("summaries", (summaries: unknown) => {
    appLogger.info("workgroup", "Remote workgroup catalog updated.", {
      summaryCount: Array.isArray(summaries) ? summaries.length : remoteWorkgroupStore?.listSummaries().length ?? 0,
    });
    broadcastWorkgroupCollaborationSummaries();
  });
  remoteWorkgroupStore.on("snapshot", (_workgroupId: string, snapshot: WorkgroupCollaborationSessionSnapshot) => {
    appLogger.info("workgroup", "Remote workgroup session snapshot updated.", {
      workgroupId: snapshot.workgroupId,
      isActiveWorkgroup: snapshot.workgroupId === (activeWorkgroupCollaborationId?.trim() ?? ""),
      messageCount: Array.isArray(snapshot.messages) ? snapshot.messages.length : 0,
      updatedAt: snapshot.updatedAt,
    });
    remoteWorkgroupSessionSyncGate.finish(snapshot.workgroupId);
    if (workspaceWindow && !workspaceWindow.isDestroyed()) {
      workspaceWindow.webContents.send("workgroup-collaboration-snapshot", snapshot);
    }
  });

  controllerRelayClient.on("connected", () => {
    updateTrayTooltip();
    scheduleControllerTokenRefresh();
  });
  controllerRelayClient.on("authenticated", () => {
    requestRemoteProjectCatalogRefresh("controller-authenticated");
    scheduleRemoteProjectCatalogRefresh(1_500, "controller-authenticated:1500");
    scheduleRemoteProjectCatalogRefresh(5_000, "controller-authenticated:5000");
    void refreshRemoteWorkgroupCatalog(true, "controller-authenticated");
    scheduleRelayFollowUpRefreshes("controller-authenticated");
  });
  controllerRelayClient.on("disconnected", () => {
    updateTrayTooltip();
  });
  controllerRelayClient.on("auth-failed", () => {
    void recoverControllerRelayAuthentication("controller-auth-failed");
  });
  controllerRelayClient.on("message", (env: any) => {
    remoteSessionStore?.handleEnvelope(env);
    remoteWorkgroupStore?.handleEnvelope(env);
  });
  controllerRelayClient.on("error", () => {
    void 0;
  });
  controllerRelayClient.on("connection-state-changed", () => {
    updateTrayTooltip();
  });
  controllerRelayClient.connect();
}

function handleUpdateWorkgroupTaskStatusRequest(data: {
  taskId: string;
  status: WorkgroupTaskStatus;
  lastDispatchResult?: string | null;
}) {
  const nextTask = updateWorkgroupTask(data.taskId, {
    status: data.status,
    dispatchProjectId: data.status === "todo" ? null : undefined,
    dispatchRunId: data.status === "todo" ? null : undefined,
    lastDispatchResult: data.lastDispatchResult ?? undefined,
  });
  if (!nextTask) {
    return { success: false, error: "Task not found" };
  }

  broadcastWorkgroupsChanged();
  return {
    success: true,
    task: nextTask,
    workgroup: getSerializedWorkgroupById(nextTask.workgroupId),
  };
}

function handleSetWorkgroupTaskScheduleEnabledRequest(data: {
  taskId: string;
  enabled: boolean;
}) {
  const task = workgroupStore.getTaskById(String(data?.taskId ?? "").trim());
  if (!task) {
    return { success: false, error: "Task not found" };
  }
  if (!task.scheduleType) {
    return { success: false, error: "Task is not scheduled" };
  }

  const nextTask = workgroupStore.saveTask({
    ...task,
    scheduleEnabled: data.enabled !== false,
    nextRunAt: computeScheduledTaskNextRunAt({
      scheduleType: task.scheduleType,
      enabled: data.enabled !== false,
      runAt: task.runAt,
      delayMinutes: task.delayMinutes,
      delayStartAt: task.delayStartAt,
      dailyTime: task.dailyTime,
      weeklyDay: task.weeklyDay,
      lastRunAt: task.lastDispatchAt ?? null,
    }),
  });
  touchWorkgroup(task.workgroupId);
  workgroupTaskScheduler.syncTasks("toggle-workgroup-task-schedule");
  broadcastWorkgroupsChanged();
  return {
    success: true,
    task: nextTask,
    workgroup: getSerializedWorkgroupById(task.workgroupId),
  };
}

function handleSaveWorkgroupTaskRequest(data: {
  id?: string;
  workgroupId: string;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  assigneeMemberId?: string | null;
  priority?: "low" | "normal" | "high";
  status?: WorkgroupTaskStatus;
  scheduleType?: "manual" | ScheduledTaskScheduleType | null;
  runAt?: number | null;
  delayMinutes?: number | null;
  dailyTime?: string | null;
  weeklyDay?: number | null;
  scheduleEnabled?: boolean;
}) {
  const workgroup = workgroupStore.getWorkgroupById(data?.workgroupId || "");
  if (!workgroup) {
    return { success: false, error: "Workgroup not found" };
  }

  const title = String(data?.title ?? "").trim();
  if (!title) {
    return { success: false, error: "Task title is required" };
  }

  const assigneeMemberId = typeof data?.assigneeMemberId === "string" && data.assigneeMemberId.trim()
    ? data.assigneeMemberId.trim()
    : null;
  if (assigneeMemberId) {
    const member = workgroupStore.getMemberById(assigneeMemberId);
    if (!member || member.workgroupId !== workgroup.id) {
      return { success: false, error: "Assignee not found in this workgroup" };
    }
  }

  const existing = typeof data?.id === "string" && data.id.trim()
    ? workgroupStore.getTaskById(data.id.trim())
    : null;
  const scheduleAnchorAt = Date.now();
  const scheduleType: ScheduledTaskScheduleType | null = data?.scheduleType === "weekly"
    ? "weekly"
    : (data?.scheduleType === "daily"
      ? "daily"
      : (data?.scheduleType === "delay"
        ? "delay"
        : (data?.scheduleType === "once" ? "once" : null)));
  const scheduleEnabled = scheduleType ? data?.scheduleEnabled !== false : false;
  const runAt = scheduleType === "once"
    ? (Number.isFinite(Number(data?.runAt)) && Number(data?.runAt) > 0 ? Math.trunc(Number(data?.runAt)) : null)
    : null;
  const delayMinutes = scheduleType === "delay"
    ? (Number.isInteger(Number(data?.delayMinutes)) && Number(data?.delayMinutes) > 0 ? Number(data?.delayMinutes) : null)
    : null;
  const dailyTime = scheduleType === "daily" || scheduleType === "weekly" ? normalizeDailyTime(data?.dailyTime) : null;
  const weeklyDay = scheduleType === "weekly" ? normalizeWeeklyDay(data?.weeklyDay) : null;

  if (scheduleType === "once" && !runAt) {
    return { success: false, error: "Choose a valid run time for the one-time workgroup task." };
  }
  if (scheduleType === "delay" && !delayMinutes) {
    return { success: false, error: "Choose a valid delay in minutes for the workgroup task." };
  }
  if ((scheduleType === "daily" || scheduleType === "weekly") && !dailyTime) {
    return { success: false, error: "Choose a valid time in HH:mm format for the workgroup task." };
  }
  if (scheduleType === "weekly" && weeklyDay === null) {
    return { success: false, error: "Choose a valid weekday for the weekly workgroup task." };
  }

  const task = workgroupStore.saveTask({
    id: existing?.id || (typeof data?.id === "string" ? data.id.trim() : undefined),
    workgroupId: workgroup.id,
    title,
    description: data?.description ?? null,
    acceptanceCriteria: data?.acceptanceCriteria ?? null,
    assigneeMemberId,
    priority: data?.priority,
    status: data?.status,
    scheduleType,
    scheduleEnabled,
    runAt,
    delayMinutes,
    delayStartAt: scheduleType === "delay"
      ? (existing?.scheduleType === "delay" ? existing.delayStartAt ?? scheduleAnchorAt : scheduleAnchorAt)
      : null,
    dailyTime,
    weeklyDay,
    nextRunAt: scheduleType ? computeScheduledTaskNextRunAt({
      scheduleType,
      enabled: scheduleEnabled,
      runAt,
      delayMinutes,
      delayStartAt: scheduleType === "delay"
        ? (existing?.scheduleType === "delay" ? existing.delayStartAt ?? scheduleAnchorAt : scheduleAnchorAt)
        : null,
      intervalHours: null,
      intervalStartAt: null,
      dailyTime,
      weeklyDay,
      lastRunAt: existing?.lastDispatchAt ?? null,
    }) : null,
  });
  touchWorkgroup(workgroup.id);
  workgroupTaskScheduler.syncTasks("save-workgroup-task");
  broadcastWorkgroupsChanged();
  return {
    success: true,
    task,
    workgroup: getSerializedWorkgroupById(workgroup.id),
  };
}

function handleDeleteWorkgroupTaskRequest(taskId: string) {
  const task = workgroupStore.getTaskById(taskId);
  if (!task) {
    return { success: false, error: "Task not found" };
  }

  workgroupStore.removeTask(taskId);
  touchWorkgroup(task.workgroupId);
  workgroupTaskScheduler.syncTasks("delete-workgroup-task");
  broadcastWorkgroupsChanged();
  return {
    success: true,
    workgroup: getSerializedWorkgroupById(task.workgroupId),
  };
}

async function handleDispatchWorkgroupTaskRequest(taskId: string) {
  const task = workgroupStore.getTaskById(taskId);
  if (!task) {
    return { success: false, error: "Task not found" };
  }
  if (!task.assigneeMemberId) {
    return { success: false, error: "Task has no assignee" };
  }

  const workgroup = workgroupStore.getWorkgroupById(task.workgroupId);
  if (!workgroup) {
    return { success: false, error: "Workgroup not found" };
  }

  const member = workgroupStore.getMemberById(task.assigneeMemberId);
  if (!member || member.workgroupId !== workgroup.id) {
    return { success: false, error: "Assignee not found" };
  }

  const serializedMember = serializeWorkgroupMember(member);
  const dispatchBlockedReason = getWorkgroupDispatchBlockedReason(task, serializedMember);
  if (dispatchBlockedReason) {
    return { success: false, error: dispatchBlockedReason };
  }

  const project = serializedMember.projectId ? getProjectById(serializedMember.projectId) : null;
  if (!project) {
    return { success: false, error: "Assigned project is unavailable" };
  }

  const dispatchAt = Date.now();
  const dispatchRunId = uuidv4();
  const snapshot = getProjectSnapshot(project.id);
  const initialStatus: WorkgroupTaskStatus = snapshot && (snapshot.isRunning || snapshot.queuedCount > 0)
    ? "assigned"
    : "running";
  const prompt = buildWorkgroupDispatchPrompt(workgroup, serializedMember, task);
  const buildTaskDispatchLogMeta = (
    currentTask: WorkgroupTask,
    extra: Record<string, unknown> = {},
  ) => ({
    taskId: currentTask.id,
    workgroupId: currentTask.workgroupId,
    assigneeMemberId: currentTask.assigneeMemberId ?? null,
    dispatchProjectId: project.id,
    dispatchRunId: currentTask.dispatchRunId ?? dispatchRunId,
    status: currentTask.status,
    projectKind: serializedMember.projectKind ?? null,
    trigger: "manual_dispatch",
    ...extra,
  });

  if (serializedMember.projectKind === "remote") {
    const result = remoteSessionStore
      ? await remoteSessionStore.sendPrompt(project.id, prompt)
      : { success: false, error: "Remote controller unavailable" };
    if (!result.success) {
      updateWorkgroupTask(task.id, {
        status: "error",
        dispatchProjectId: project.id,
        dispatchRunId,
        lastDispatchAt: dispatchAt,
        lastDispatchResult: result.error || "Remote dispatch failed",
      });
      workgroupTaskScheduler.syncTasks("dispatch-workgroup-task-error");
      broadcastWorkgroupsChanged();
      appLogger.warn("scheduler", "Scheduled workgroup task downstream execution failed.", buildTaskDispatchLogMeta(task, {
        error: result.error || "Remote dispatch failed",
      }));
      return result;
    }

    const updatedTask = updateWorkgroupTask(task.id, {
      status: initialStatus,
      dispatchProjectId: project.id,
      dispatchRunId: result.runId || dispatchRunId,
      lastDispatchAt: dispatchAt,
      lastDispatchResult: initialStatus === "assigned"
        ? "Waiting in the assigned remote member project queue."
        : "Assigned remote member project is executing the task.",
    });
    workgroupTaskScheduler.syncTasks("dispatch-workgroup-task-success");
    broadcastWorkgroupsChanged();
    if (updatedTask) {
      appLogger.info("scheduler", "Scheduled workgroup task dispatched.", buildTaskDispatchLogMeta(updatedTask, {
        result: updatedTask.lastDispatchResult ?? null,
      }));
    }
    return {
      success: true,
      task: updatedTask,
      workgroup: getSerializedWorkgroupById(task.workgroupId),
    };
  }

  runtimeManager.enqueueMessage({
    projectId: project.id,
    cwd: project.path,
    prompt,
    source: "desktop",
    runId: dispatchRunId,
    onDone: () => {
      const latestTask = workgroupStore.getTaskById(task.id);
      if (!latestTask || latestTask.dispatchRunId !== dispatchRunId) {
        return;
      }
      if (latestTask.status !== "running" && latestTask.status !== "assigned") {
        return;
      }
      updateWorkgroupTask(task.id, {
        status: "done",
        lastDispatchResult: "Completed by assigned member project.",
      });
      const finishedTask = workgroupStore.getTaskById(task.id);
      workgroupTaskScheduler.syncTasks("dispatch-workgroup-task-done");
      broadcastWorkgroupsChanged();
      if (finishedTask) {
        appLogger.info("scheduler", "Scheduled workgroup task completed.", buildTaskDispatchLogMeta(finishedTask, {
          result: finishedTask.lastDispatchResult ?? null,
        }));
      }
    },
    onError: (error) => {
      const latestTask = workgroupStore.getTaskById(task.id);
      if (!latestTask || latestTask.dispatchRunId !== dispatchRunId) {
        return;
      }
      updateWorkgroupTask(task.id, {
        status: "error",
        lastDispatchResult: error || "Local dispatch failed",
      });
      const failedTask = workgroupStore.getTaskById(task.id);
      workgroupTaskScheduler.syncTasks("dispatch-workgroup-task-local-error");
      broadcastWorkgroupsChanged();
      if (failedTask) {
        appLogger.warn("scheduler", "Scheduled workgroup task downstream execution failed.", buildTaskDispatchLogMeta(failedTask, {
          error: error || "Local dispatch failed",
        }));
      }
    },
  });

  const updatedTask = updateWorkgroupTask(task.id, {
    status: initialStatus,
    dispatchProjectId: project.id,
    dispatchRunId,
    lastDispatchAt: dispatchAt,
    lastDispatchResult: initialStatus === "assigned"
      ? "Queued for the assigned local member project."
      : "Assigned local member project is executing the task.",
  });
  workgroupTaskScheduler.syncTasks("dispatch-workgroup-task-success");
  broadcastWorkgroupsChanged();
  if (updatedTask) {
    appLogger.info("scheduler", "Scheduled workgroup task dispatched.", buildTaskDispatchLogMeta(updatedTask, {
      result: updatedTask.lastDispatchResult ?? null,
    }));
  }
  return {
    success: true,
    task: updatedTask,
    workgroup: getSerializedWorkgroupById(task.workgroupId),
  };
}

// IPC handlers
ipcMain.handle("get-projects", (_event, options?: { refreshRemote?: boolean } | null) => {
  if (options?.refreshRemote) {
    requestUiRemoteProjectListRefresh("refresh-remote-project-list");
  }
  return getAllProjects();
});

ipcMain.handle("add-project", async (_event, data: {
  name: string;
  path: string;
  groupName?: string | null;
  cliProvider?: CliProvider;
  cliModel?: string | null;
  codexWebSearchEnabled?: boolean;
  projectPrompt?: string | null;
}) => {
  const config = loadConfig();
  const projectId = uuidv4();
  const cliProvider = normalizeCliProvider(data.cliProvider, getDefaultCliProvider());
  const cliModel = data.cliModel?.trim() ? data.cliModel.trim() : null;

  // Add to local store
  projectStore.add({
    id: projectId,
    name: data.name,
    path: data.path,
    agentId: config.agentId,
    groupName: normalizeProjectGroupName(data.groupName),
    cliProvider,
    cliModel,
    codexWebSearchEnabled: normalizeCodexWebSearchEnabled(data.codexWebSearchEnabled),
    projectPrompt: data.projectPrompt?.trim() ? data.projectPrompt.trim() : null,
    createdAt: Date.now(),
  });

  // Bind to server
  syncProjectCatalog(config.agentId);

  localScheduler.syncTasks("add-project");
  rebuildTrayMenu();
  broadcastProjectsChanged();
  broadcastProjectSnapshot(projectId);
  return { success: true, projectId };
});

ipcMain.handle(
  "update-project",
  (_event, data: {
    projectId: string;
    updates: Partial<Pick<Project, "name" | "path" | "groupName" | "cliProvider" | "cliModel" | "codexWebSearchEnabled" | "projectPrompt">>;
  }) => {
    const liveProject = getProjectById(data.projectId);
    if (!liveProject) {
      return { success: false, error: "Project not found" };
    }

    const nextUpdates: Partial<Project> = { ...data.updates };
    if (data.updates.groupName !== undefined) {
      nextUpdates.groupName = normalizeProjectGroupName(data.updates.groupName);
    }
    if (data.updates.cliProvider !== undefined) {
      nextUpdates.cliProvider = normalizeCliProvider(
        data.updates.cliProvider,
        normalizeCliProvider(liveProject.cliProvider, getDefaultCliProvider()),
      );
    }
    if (data.updates.cliModel !== undefined) {
      nextUpdates.cliModel = data.updates.cliModel?.trim() ? data.updates.cliModel.trim() : null;
    }
    if (data.updates.codexWebSearchEnabled !== undefined) {
      nextUpdates.codexWebSearchEnabled = normalizeCodexWebSearchEnabled(data.updates.codexWebSearchEnabled);
    }
    if (data.updates.projectPrompt !== undefined) {
      nextUpdates.projectPrompt = data.updates.projectPrompt?.trim() ? data.updates.projectPrompt.trim() : null;
    }

    if (isRemoteProjectRecord(liveProject)) {
      const result = remoteSessionStore?.updateProjectConfig(data.projectId, {
        groupName: nextUpdates.groupName,
        cliProvider: nextUpdates.cliProvider,
        cliModel: nextUpdates.cliModel,
        codexWebSearchEnabled: nextUpdates.codexWebSearchEnabled,
        projectPrompt: nextUpdates.projectPrompt,
      }) ?? { success: false, error: "Remote project sync is unavailable" };
      if (!result.success) {
        return result;
      }
      broadcastProjectsChanged();
      if (workspaceWindow && !workspaceWindow.isDestroyed()) {
        const snapshot = remoteSessionStore?.getSnapshot(data.projectId);
        if (snapshot) {
          workspaceWindow.webContents.send("project-session-snapshot", snapshot);
        }
      }
      updateWindowTitles();
      return { success: true };
    }

    projectStore.update(data.projectId, nextUpdates);
    const updatedProject = projectStore.getById(data.projectId);
    if (updatedProject) {
      syncProjectCatalog(updatedProject.agentId || loadConfig().agentId);
    }
    localScheduler.syncTasks("update-project");
    rebuildTrayMenu();
    broadcastProjectsChanged();
    broadcastProjectSnapshot(data.projectId);
    updateWindowTitles();
    return { success: true };
  },
);

ipcMain.handle("delete-project", (_event, projectId: string) => {
  const project = projectStore.getById(projectId);
  projectStore.remove(projectId);
  scheduledTaskStore.removeTasksByProjectId(projectId);
  runtimeManager.clearProject(projectId);
  clearRelaySyncState(projectId);

  if (activeWorkspaceProjectId === projectId) {
    activeWorkspaceProjectId = null;
  }

  // Kill PTY if exists
  try {
    ptyManager.kill(projectId);
  } catch (err) {
    // Ignore if PTY doesn't exist
  }

  rebuildTrayMenu();
  if (project) {
    syncProjectCatalog(project.agentId || loadConfig().agentId);
  }
  localScheduler.syncTasks("delete-project");
  broadcastProjectsChanged();
  updateWindowTitles();
  return { success: true };
});

ipcMain.on("open-project-window", (_event, projectId: string) => {
  const project = getProjectById(projectId);
  if (project) showWorkspaceWindow(project.id);
});

ipcMain.handle("get-config", () => getPublicConfig());

ipcMain.handle("list-access-grants", async (_event, options?: { force?: boolean } | null) => {
  try {
    const data = await accessGrantCache.get({ force: options?.force === true });
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error?.message ?? String(error) };
  }
});

ipcMain.handle("grant-access-to-user", async (_event, data: { controllerUsername: string; projectIds?: string[] | null; note?: string | null }) => {
  const refreshed = await refreshAgentToken(false);
  const config = loadConfig();
  if (!refreshed || !config.token || !config.agentId) {
    return { success: false, error: "Not logged in" };
  }

  try {
    const response = await fetchRelayJson(`${toHttpBaseUrl(config.serverUrl)}/api/access/grants`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
      body: {
        controller_username: data.controllerUsername,
        target_agent_id: config.agentId,
        project_ids: Array.isArray(data.projectIds) ? data.projectIds : [],
        note: data.note ?? "",
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: errorText || response.statusText };
    }
    clearAccessGrantCache();
    requestRemoteProjectCatalogRefresh();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message ?? String(error) };
  }
});

ipcMain.handle("revoke-access-grant", async (_event, data: { controllerUserId: number; targetAgentId?: string | null }) => {
  const refreshed = await refreshAgentToken(false);
  const config = loadConfig();
  const targetAgentId = data.targetAgentId?.trim() || config.agentId;
  if (!refreshed || !config.token || !targetAgentId) {
    return { success: false, error: "Not logged in" };
  }

  try {
    const query = new URLSearchParams({
      controller_user_id: String(data.controllerUserId),
      target_agent_id: targetAgentId,
    });
    const response = await fetchRelayJson(`${toHttpBaseUrl(config.serverUrl)}/api/access/grants?${query.toString()}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: errorText || response.statusText };
    }
    clearAccessGrantCache();
    requestRemoteProjectCatalogRefresh();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message ?? String(error) };
  }
});

ipcMain.handle("save-config", (_event, config: Partial<AgentConfig>) => {
  clearRelayDeviceListCache();
  clearRelayTransferListCache();
  clearAccessGrantCache();
  clearWorkgroupRegistryCaches();
  clearCliProviderRuntimeStatusCache();
  if (config.serverUrl !== undefined) configStore.set("serverUrl", config.serverUrl);
  if (config.agentId !== undefined) configStore.set("agentId", config.agentId);
  if (config.token !== undefined) {
    configStore.set("encryptedToken", encodeSecretForStore(config.token));
    configStore.set("token", "");
  }
  if (config.username !== undefined) configStore.set("username", config.username);
  if (config.password !== undefined) configStore.set("encryptedPassword", encodeSecretForStore(config.password));
  if (config.openaiApiKey !== undefined) configStore.set("encryptedOpenaiApiKey", encodeSecretForStore(config.openaiApiKey));
  if (config.openaiBaseUrl !== undefined) configStore.set("openaiBaseUrl", config.openaiBaseUrl);
  if (config.openaiDefaultModel !== undefined) configStore.set("openaiDefaultModel", config.openaiDefaultModel);
  if (config.anthropicApiKey !== undefined) configStore.set("encryptedAnthropicApiKey", encodeSecretForStore(config.anthropicApiKey));
  if (config.anthropicBaseUrl !== undefined) configStore.set("anthropicBaseUrl", config.anthropicBaseUrl);
  if (config.anthropicDefaultModel !== undefined) configStore.set("anthropicDefaultModel", config.anthropicDefaultModel);
  if (config.githubToken !== undefined) configStore.set("encryptedGithubToken", encodeSecretForStore(config.githubToken));
  if (config.cliProvider !== undefined) configStore.set("cliProvider", config.cliProvider);
  return true;
});

ipcMain.handle("login", async (_event, data: { username: string; password: string; agentId: string }) => {
  try {
    const config = loadConfig();
    const serverUrl = toHttpBaseUrl(config.serverUrl);

    const response = await fetchRelayJson(`${serverUrl}/api/auth/login`, {
      method: "POST",
      body: {
        username: data.username,
        password: data.password,
        client_type: "agent",
        client_id: data.agentId,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: errorText || response.statusText };
    }

    const result = await response.json() as { token: string; expires_at: string; user?: { username?: string } };
    saveAuthState({
      token: result.token,
      password: data.password,
      expiresAt: result.expires_at,
      username: result.user?.username?.trim() || data.username,
    });
    clearRelayDeviceListCache();
    clearRelayTransferListCache();
    clearAccessGrantCache();
    clearWorkgroupRegistryCaches();
    scheduleTokenRefresh();
    updateRelayClientAuthFromConfig();
    await refreshControllerToken(true);
    updateControllerRelayClientAuthFromConfig();

    return { success: true, token: result.token, user: result.user };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-e2e-status", () => {
  return {
    enabled: relayClient?.isE2EEnabled() ?? (appSettingsStore.get("e2eEnabled") as boolean),
    publicKey: relayClient?.getE2E().getPublicKey() ?? "",
  };
});

ipcMain.handle("set-e2e-enabled", (_event, enabled: boolean) => {
  appSettingsStore.set("e2eEnabled", enabled);
  if (relayClient) relayClient.setE2EEnabled(enabled);
  if (controllerRelayClient) {
    controllerRelayClient.setE2EEnabled(enabled);
    if (enabled) {
      requestRemoteProjectCatalogRefresh();
    }
  }
  return true;
});

ipcMain.handle("reconnect-relay", async () => handleReconnectRelayCommand());

async function handleReconnectRelayCommand(): Promise<boolean> {
  clearRelayDeviceListCache();
  await refreshAgentToken(false);
  await refreshControllerToken(false);
  clearRelayFollowUpRefreshTimers();
  lastActiveRemoteProjectSyncAt = 0;
  remoteProjectSyncGate.clear();
  remoteWorkgroupSessionSyncGate.clear();
  if (relayClient) {
    relayClient.disconnect();
  }
  if (controllerRelayClient) {
    controllerRelayClient.disconnect();
    controllerRelayClient = null;
  }
  remoteSessionStore = null;
  const config = loadConfig();
  initRelay(config);
  ensureRemoteRelayReady(config);
  scheduleRelayFollowUpRefreshes("manual-reconnect");
  return true;
}

ipcMain.handle("get-lang", () => getLang());

ipcMain.handle("set-lang", (_event, lang: Lang) => {
  setLang(lang);
  updateTrayTooltip();
  rebuildTrayMenu();
  updateWindowTitles();
  broadcastLangChange();
  return true;
});

ipcMain.handle("get-i18n-messages", () => getAllMessages());

ipcMain.handle("get-app-settings", () => {
  const effectiveLocalDataRoot = getPersistedLocalDataRoot();
  syncLocalDataRootSetting(effectiveLocalDataRoot);
  return {
    autoStart: appSettingsStore.get("autoStart") as boolean,
    silentLaunch: appSettingsStore.get("silentLaunch") as boolean,
    completionSound: appSettingsStore.get("completionSound") as boolean,
    saveLogs: appSettingsStore.get("saveLogs") as boolean,
    e2eEnabled: appSettingsStore.get("e2eEnabled") as boolean,
    autoUpdateCheck: appSettingsStore.get("autoUpdateCheck") as boolean,
    autoUpdateDownload: appSettingsStore.get("autoUpdateDownload") as boolean,
    silentUpdateInstall: appSettingsStore.get("silentUpdateInstall") as boolean,
    historyRetentionDays: appSettingsStore.get("historyRetentionDays") as number,
    localDataRoot: effectiveLocalDataRoot,
    defaultLocalDataRoot: getDefaultLocalDataRoot(),
    logDirectory: appLogger.getLogDirectory(),
  };
});

ipcMain.handle("get-cli-provider-runtime-status", async (_event, options?: { force?: boolean } | null) => {
  return await loadCliProviderRuntimeStatuses({ force: options?.force === true });
});

ipcMain.handle("get-local-data-metrics", () => {
  return buildLocalDataMetrics();
});

ipcMain.handle("clear-local-data-segment", (_event, target: LocalDataCleanupTarget) => {
  return {
    success: true,
    ...clearLocalDataCleanupTarget(target),
  };
});

ipcMain.handle("list-relay-transfers", async (_event, options?: number | RelayTransferListOptions) => {
  try {
    const items = await listRelayTransfersWithOptions(typeof options === "object" && options !== null ? options : { limit: options });
    return {
      success: true,
      items,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      items: [],
    };
  }
});

ipcMain.handle("list-relay-devices", async (_event, options?: { force?: boolean } | null) => {
  try {
    const items = await listRelayDevices({ force: options?.force === true });
    return {
      success: true,
      items,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      items: [],
    };
  }
});

ipcMain.handle("create-relay-transfer", async (event, options?: RelayTransferCreateOptions) => {
  try {
    const senderWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? workspaceWindow ?? null;
    const transfer = await createRelayTransferFromDesktop(options ?? {}, senderWindow);
    return {
      success: true,
      transfer,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "__TRANSFER_PICK_CANCELED__") {
      return {
        success: false,
        canceled: true,
      };
    }
    return {
      success: false,
      error: message,
    };
  }
});

ipcMain.handle("set-app-settings", (_event, settings: Partial<AppSettings>) => {
  if (settings.autoStart !== undefined) {
    appSettingsStore.set("autoStart", settings.autoStart);
    app.setLoginItemSettings({ openAtLogin: settings.autoStart });
  }
  if (settings.silentLaunch !== undefined) {
    appSettingsStore.set("silentLaunch", settings.silentLaunch);
  }
  if (settings.completionSound !== undefined) {
    appSettingsStore.set("completionSound", settings.completionSound);
  }
  if (settings.saveLogs !== undefined) {
    if (!settings.saveLogs) {
      appLogger.info("settings", "Local log persistence disabled by user.");
    }
    appSettingsStore.set("saveLogs", settings.saveLogs);
    appLogger.setEnabled(settings.saveLogs);
    if (settings.saveLogs) {
      appLogger.info("settings", "Local log persistence enabled by user.");
    }
  }
  if (settings.e2eEnabled !== undefined) {
    appSettingsStore.set("e2eEnabled", settings.e2eEnabled);
    if (relayClient) {
      relayClient.setE2EEnabled(settings.e2eEnabled);
    }
    if (controllerRelayClient) {
      controllerRelayClient.setE2EEnabled(settings.e2eEnabled);
      if (settings.e2eEnabled) {
        requestRemoteProjectCatalogRefresh();
      }
    }
  }
  if (settings.autoUpdateCheck !== undefined) {
    appSettingsStore.set("autoUpdateCheck", settings.autoUpdateCheck);
    updateManager.start();
  }
  if (settings.autoUpdateDownload !== undefined) {
    appSettingsStore.set("autoUpdateDownload", settings.autoUpdateDownload);
  }
  if (settings.silentUpdateInstall !== undefined) {
    appSettingsStore.set("silentUpdateInstall", settings.silentUpdateInstall);
    if (settings.silentUpdateInstall) {
      void updateManager.maybeInstallDownloadedUpdate();
    }
  }
  if (settings.historyRetentionDays !== undefined) {
    const normalizedRetentionDays = Math.max(1, Math.floor(Number(settings.historyRetentionDays) || 30));
    appSettingsStore.set("historyRetentionDays", normalizedRetentionDays);
    runtimeManager.pruneHistoryCache(normalizedRetentionDays);
  }
  return true;
});

ipcMain.handle("pick-local-data-root", async (event, rawPath?: string | null) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? workspaceWindow ?? undefined;
  const defaultPath = resolveLocalDataRoot(rawPath);
  const dialogOptions: Electron.OpenDialogOptions = {
    defaultPath,
    properties: ["openDirectory", "createDirectory", "promptToCreate"],
  };
  const result = senderWindow
    ? await dialog.showOpenDialog(senderWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  return {
    success: !result.canceled,
    path: result.canceled ? null : (result.filePaths[0] ?? null),
  };
});

async function handleOpenLocalDataRootCommand(rawPath?: string | null) {
  const targetPath = resolveLocalDataRoot(rawPath ?? app.getPath("userData"));
  fs.mkdirSync(targetPath, { recursive: true });
  const errorMessage = await shell.openPath(targetPath);
  return {
    success: !errorMessage,
    error: errorMessage || undefined,
  };
}

const localCommandGateway = createLocalCommandGateway([
  defineLocalCommand({
    id: "relay.reconnect",
    title: "Reconnect relay and refresh remote sync state",
    group: "runtime",
    run: () => handleReconnectRelayCommand(),
  }),
  defineLocalCommand({
    id: "updates.check",
    title: "Check for desktop updates immediately",
    group: "updates",
    run: () => updateManager.checkForUpdates(true),
  }),
  defineLocalCommand({
    id: "updates.download",
    title: "Download the latest available desktop update",
    group: "updates",
    run: () => updateManager.downloadAvailableUpdate(),
  }),
  defineLocalCommand({
    id: "updates.install",
    title: "Install the downloaded desktop update",
    group: "updates",
    run: () => updateManager.installDownloadedUpdate(),
  }),
  defineLocalCommand({
    id: "diagnostics.uploadLogs",
    title: "Upload the latest desktop logs to the relay",
    group: "diagnostics",
    run: () => uploadDesktopLogs(),
  }),
  defineLocalCommand({
    id: "diagnostics.exportBundle",
    title: "Export a desktop diagnostics bundle",
    group: "diagnostics",
    run: () => exportDesktopDiagnosticsBundle(),
  }),
  defineLocalCommand({
    id: "storage.openLocalDataRoot",
    title: "Open the local data directory",
    group: "storage",
    payloadSchema: "optionalPath",
    run: (payload) => handleOpenLocalDataRootCommand(typeof payload === "string" ? payload : undefined),
  }),
]);

ipcMain.handle("list-local-commands", (): LocalCommandDescriptor[] => localCommandGateway.listCommands());

ipcMain.handle("run-local-command", async (_event, request: { commandId: string; payload?: unknown }) => {
  return localCommandGateway.runCommand(request);
});

ipcMain.handle("open-local-data-root", async (_event, rawPath?: string | null) => {
  return handleOpenLocalDataRootCommand(rawPath);
});

ipcMain.handle("upload-desktop-logs", async () => {
  return uploadDesktopLogs();
});

ipcMain.handle("export-desktop-diagnostics-bundle", async () => {
  return exportDesktopDiagnosticsBundle();
});

ipcMain.handle("change-local-data-root", async (_event, rawPath?: string | null) => {
  if (runtimeManager.hasActiveOrQueuedRuns()) {
    return {
      success: false,
      error: getLang() === "zh"
        ? "请先等待运行中和排队中的任务完成，再切换本地文件目录。"
        : "Finish running and queued tasks before changing the local data folder.",
    };
  }

  const currentRoot = app.getPath("userData");
  const nextRoot = resolveLocalDataRoot(rawPath);
  if (localDataRootsEqual(currentRoot, nextRoot)) {
    syncLocalDataRootSetting(currentRoot);
    return {
      success: true,
      changed: false,
      restartRequired: false,
      localDataRoot: currentRoot,
    };
  }

  try {
    runtimeManager.flushPersistence();
    migrateLocalDataRoot(currentRoot, nextRoot);
    const persistedRoot = persistLocalDataRoot(nextRoot);
    syncLocalDataRootSetting(persistedRoot);
    appLogger.info("settings", "Local data root updated.", {
      previousRoot: currentRoot,
      nextRoot: persistedRoot,
    });
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 180);
    return {
      success: true,
      changed: true,
      restartRequired: true,
      localDataRoot: persistedRoot,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    appLogger.error("settings", "Failed to migrate local data root.", {
      previousRoot: currentRoot,
      nextRoot,
      error: detail,
    });
    return {
      success: false,
      error: detail,
    };
  }
});

ipcMain.handle("get-update-state", () => updateManager.getState());
ipcMain.handle("check-for-updates", async () => updateManager.checkForUpdates(true));
ipcMain.handle("download-available-update", async () => updateManager.downloadAvailableUpdate());
ipcMain.handle("install-downloaded-update", async () => updateManager.installDownloadedUpdate());

ipcMain.handle("get-connection-status", () => {
  return buildConnectionStatusSnapshot();
});

ipcMain.handle("open-project", (_event, projectId: string) => {
  const project = getProjectById(projectId);
  if (project) {
    showWorkspaceWindow(project.id);
    return { success: true };
  }
  return { success: false, error: "Project not found" };
});

ipcMain.on("open-settings-window", (event, pane?: SettingsPane) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  activeSettingsPane = normalizeSettingsPane(pane);
  showMainWindow(senderWindow ?? workspaceWindow);
});

ipcMain.on("set-active-project", (_event, projectId: string | null) => {
  activeWorkspaceProjectId = projectId?.trim() || null;
  if (activeWorkspaceProjectId) {
    activeWorkgroupCollaborationId = null;
    if (isRemoteProject(activeWorkspaceProjectId)) {
      requestRemoteProjectSync(activeWorkspaceProjectId, "workspace-project-activated", true, "full");
    }
  }
  updateWindowTitles();
});

ipcMain.on("set-active-workgroup-collaboration", (_event, workgroupId: string | null) => {
  activeWorkgroupCollaborationId = workgroupId?.trim() || null;
  if (activeWorkgroupCollaborationId) {
    activeWorkspaceProjectId = null;
    if (parseCompositeWorkgroupId(activeWorkgroupCollaborationId)) {
      requestRemoteWorkgroupSessionSync(activeWorkgroupCollaborationId, "workspace-workgroup-activated");
    }
  }
  updateWindowTitles();
});

ipcMain.handle("get-project-session", (_event, payload: string | { projectId: string; forceRemoteSync?: boolean }) => {
  const projectId = (typeof payload === "string" ? payload : payload?.projectId)?.trim() || "";
  const forceRemoteSync = typeof payload === "string" ? true : payload?.forceRemoteSync === true;
  if (!projectId) {
    return { success: false, error: "Project not found" };
  }
  const project = getProjectById(projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(projectId) && forceRemoteSync) {
    requestRemoteProjectSync(projectId, "open-remote-project-session", true, "full");
  }

  return {
    success: true,
    project,
    session: getProjectSnapshot(projectId),
  };
});

ipcMain.handle("get-project-history-page", async (_event, data: {
  projectId: string;
  kind: "messages" | "activities" | "cli";
  conversationId?: string | null;
  beforeId?: string | null;
  limit?: number;
}) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(data.projectId)) {
    if (!data.beforeId) {
      requestRemoteProjectSync(data.projectId, "open-remote-project-history-page", false, "full");
    }
    const page = await remoteSessionStore?.loadHistoryPage(data.projectId, data.kind, {
      beforeId: data.beforeId,
      limit: data.limit,
      conversationId: data.conversationId,
    });
    if (!page) {
      return { success: false, error: "Remote project history unavailable" };
    }

    return {
      success: true,
      page,
    };
  }

  return {
    success: true,
    page: runtimeManager.getHistoryPage(data.projectId, data.kind, {
      conversationId: data.conversationId,
      beforeId: data.beforeId,
      limit: data.limit,
    }),
  };
});

ipcMain.handle("list-project-conversations", (_event, projectId: string) => {
  const project = getProjectById(projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(projectId)) {
    requestRemoteProjectSync(projectId, "list-remote-project-conversations");
    const snapshot = remoteSessionStore?.getSnapshot(projectId);
    return {
      success: true,
      conversations: snapshot?.conversations ?? [],
    };
  }

  return {
    success: true,
    conversations: runtimeManager.listConversationSummaries(projectId),
  };
});

ipcMain.handle("create-project-conversation", (_event, projectId: string) => {
  const project = getProjectById(projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(projectId)) {
    return remoteSessionStore?.createConversation(projectId) ?? { success: false, error: "Remote controller unavailable" };
  }

  return runtimeManager.createConversation(projectId);
});

ipcMain.handle("activate-project-conversation", (_event, data: { projectId: string; conversationId: string }) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(data.projectId)) {
    return remoteSessionStore?.activateConversation(data.projectId, data.conversationId)
      ?? { success: false, error: "Remote controller unavailable" };
  }

  return runtimeManager.activateConversation(data.projectId, data.conversationId);
});

ipcMain.handle("clear-history-cache", (_event, projectId?: string | null) => {
  return {
    success: true,
    ...runtimeManager.clearHistoryCache(projectId),
  };
});

ipcMain.handle("repair-chat-history", (_event, projectId?: string | null) => {
  return {
    success: true,
    ...runtimeManager.repairChatHistory(projectId),
  };
});

ipcMain.handle("pick-project-attachments", async (event, data: { projectId: string; kind: "image" | "file" }) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  const senderWindow = BrowserWindow.fromWebContents(event.sender) ?? workspaceWindow ?? undefined;
  const filters = data.kind === "image"
    ? [{
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif", "heic"],
      }]
    : undefined;

  const dialogOptions: Electron.OpenDialogOptions = {
    defaultPath: isRemoteProject(data.projectId) ? app.getPath("downloads") : project.path,
    properties: ["openFile", "multiSelections"],
    filters,
  };
  const result = senderWindow
    ? await dialog.showOpenDialog(senderWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return { success: true, attachments: [] };
  }

  return {
    success: true,
    attachments: result.filePaths.map((filePath) => createRunAttachmentFromPath(filePath)),
  };
});

ipcMain.handle("save-clipboard-project-image", (_event, data: { projectId: string }) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return { success: false, error: "Clipboard does not contain an image" };
  }

  const targetPath = getUniqueAttachmentPath(data.projectId, `clipboard-${Date.now()}.png`);
  fs.writeFileSync(targetPath, image.toPNG());

  return {
    success: true,
    attachment: createRunAttachmentFromPath(targetPath, {
      name: path.basename(targetPath),
      kind: "image",
    }),
  };
});

ipcMain.handle("get-attachment-image-data", (_event, data: { path?: string | null }) => {
  const filePath = typeof data?.path === "string" ? path.resolve(data.path) : "";
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return { success: false, error: "Attachment not found" };
  }
  if (!isImageAttachment(filePath)) {
    return { success: false, error: "Attachment is not an image" };
  }

  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) {
    return { success: false, error: "Unable to read image" };
  }

  return {
    success: true,
    dataUrl: image.toDataURL(),
  };
});

ipcMain.handle("send-project-prompt", (_event, data: { projectId: string; prompt: string; attachments?: unknown[] }) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  const attachments = normalizeIncomingAttachments(data.attachments);
  if (!data.prompt.trim() && attachments.length === 0) {
    return { success: false, error: "Prompt cannot be empty" };
  }

  if (isRemoteProject(data.projectId)) {
    return remoteSessionStore?.sendPrompt(data.projectId, data.prompt, attachments)
      ?? { success: false, error: "Remote controller unavailable" };
  }

  runtimeManager.enqueueMessage({
    projectId: project.id,
    cwd: project.path,
    prompt: data.prompt,
    attachments,
    source: "desktop",
  });

  return { success: true };
});

ipcMain.handle("stop-project-run", (_event, projectId: string) => {
  const project = getProjectById(projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(projectId)) {
    return remoteSessionStore?.stopRun(projectId) ?? { success: false, error: "Remote controller unavailable" };
  }

  const stopped = runtimeManager.stopCurrentRun(
    project.id,
    "Run interrupted by desktop user.",
    false,
  );
  if (!stopped) {
    return { success: false, error: "No active run" };
  }

  return { success: true };
});

ipcMain.handle("remove-queued-project-prompt", (_event, data: { projectId: string; runId: string }) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(data.projectId)) {
    return remoteSessionStore?.removeQueuedRun(data.projectId, data.runId) ?? { success: false, error: "Remote controller unavailable" };
  }

  const removed = runtimeManager.removeQueuedRun(data.projectId, data.runId);
  if (!removed) {
    return { success: false, error: "Queued item not found" };
  }

  return { success: true };
});

// 窗口控制
ipcMain.handle("list-scheduled-tasks", () => {
  return {
    success: true,
    tasks: listSerializedScheduledTasks(),
  };
});

ipcMain.handle("save-scheduled-task", (_event, data: {
  id?: string;
  projectId: string;
  name: string;
  prompt: string;
  scheduleType?: ScheduledTaskScheduleType;
  runAt?: number | null;
  delayMinutes?: number | null;
  intervalHours?: number | null;
  dailyTime?: string | null;
  weeklyDay?: number | null;
  maxRetries?: number | null;
  retryDelayMinutes?: number | null;
  enabled?: boolean;
}) => {
  const project = getLocalProjectById(String(data?.projectId ?? "").trim());
  if (!project) {
    return { success: false, error: "Bound local project not found." };
  }

  const name = String(data?.name ?? "").trim();
  const prompt = String(data?.prompt ?? "").trim();
  if (!name) {
    return { success: false, error: "Task name is required." };
  }
  if (!prompt) {
    return { success: false, error: "Task prompt is required." };
  }

  const existing = typeof data?.id === "string" && data.id.trim()
    ? scheduledTaskStore.getTaskById(data.id.trim())
    : null;
  const scheduleAnchorAt = Date.now();
  const scheduleType: ScheduledTaskScheduleType = data?.scheduleType === "weekly"
    ? "weekly"
    : (data?.scheduleType === "interval"
      ? "interval"
      : (data?.scheduleType === "daily" ? "daily" : (data?.scheduleType === "delay" ? "delay" : "once")));
  const enabled = data?.enabled !== false;
  const runAt = scheduleType === "once"
    ? (Number.isFinite(Number(data?.runAt)) && Number(data?.runAt) > 0 ? Math.trunc(Number(data?.runAt)) : null)
    : null;
  const delayMinutes = scheduleType === "delay"
    ? (Number.isInteger(Number(data?.delayMinutes)) && Number(data?.delayMinutes) > 0 ? Number(data?.delayMinutes) : null)
    : null;
  const intervalHours = scheduleType === "interval"
    ? (Number.isInteger(Number(data?.intervalHours)) && Number(data?.intervalHours) > 0 ? Number(data?.intervalHours) : null)
    : null;
  const dailyTime = scheduleType === "daily" || scheduleType === "weekly" ? normalizeDailyTime(data?.dailyTime) : null;
  const weeklyDay = scheduleType === "weekly" ? normalizeWeeklyDay(data?.weeklyDay) : null;
  const maxRetries = Number.isInteger(Number(data?.maxRetries)) && Number(data?.maxRetries) >= 0
    ? Number(data?.maxRetries)
    : 0;
  const retryDelayMinutes = Number.isInteger(Number(data?.retryDelayMinutes)) && Number(data?.retryDelayMinutes) > 0
    ? Number(data?.retryDelayMinutes)
    : 5;
  const delayStartAt = scheduleType === "delay"
    ? (existing?.scheduleType === "delay" ? existing.delayStartAt ?? scheduleAnchorAt : scheduleAnchorAt)
    : null;
  const intervalStartAt = scheduleType === "interval"
    ? (existing?.scheduleType === "interval" ? existing.intervalStartAt ?? scheduleAnchorAt : scheduleAnchorAt)
    : null;

  if (scheduleType === "once" && !runAt) {
    return { success: false, error: "Choose a valid run time for the one-time task." };
  }
  if (scheduleType === "delay" && !delayMinutes) {
    return { success: false, error: "Choose a valid delay in minutes." };
  }
  if (scheduleType === "interval" && !intervalHours) {
    return { success: false, error: "Choose a valid repeat interval in hours." };
  }
  if ((scheduleType === "daily" || scheduleType === "weekly") && !dailyTime) {
    return { success: false, error: "Choose a valid time in HH:mm format." };
  }
  if (scheduleType === "weekly" && weeklyDay === null) {
    return { success: false, error: "Choose a valid weekday for the weekly task." };
  }
  if (maxRetries > 0 && retryDelayMinutes <= 0) {
    return { success: false, error: "Choose a valid retry delay in minutes." };
  }

  const task = scheduledTaskStore.saveTask({
    id: existing?.id || (typeof data?.id === "string" ? data.id.trim() : undefined),
    projectId: project.id,
    name,
    prompt,
    scheduleType,
    runAt,
    delayMinutes,
    delayStartAt,
    intervalHours,
    intervalStartAt,
    dailyTime,
    weeklyDay,
    enabled,
    activeRunId: null,
    lastRunAt: null,
    lastRunStatus: "idle",
    lastError: null,
    retryCount: 0,
    maxRetries,
    retryDelayMinutes,
    nextRunAt: computeScheduledTaskNextRunAt({
      scheduleType,
      enabled,
      runAt,
      delayMinutes,
      delayStartAt,
      intervalHours,
      intervalStartAt,
      dailyTime,
      weeklyDay,
      lastRunAt: null,
    }),
  });
  localScheduler.syncTasks("save-scheduled-task");
  return {
    success: true,
    task: listSerializedScheduledTasks().find((entry) => entry.id === task.id) ?? null,
  };
});

ipcMain.handle("delete-scheduled-task", (_event, taskId: string) => {
  const task = scheduledTaskStore.getTaskById(String(taskId ?? "").trim());
  if (!task) {
    return { success: false, error: "Scheduled task not found." };
  }

  scheduledTaskStore.removeTask(task.id);
  localScheduler.syncTasks("delete-scheduled-task");
  return { success: true };
});

ipcMain.handle("set-scheduled-task-enabled", (_event, data: {
  taskId: string;
  enabled: boolean;
}) => {
  const task = scheduledTaskStore.getTaskById(String(data?.taskId ?? "").trim());
  if (!task) {
    return { success: false, error: "Scheduled task not found." };
  }

  scheduledTaskStore.saveTask({
    ...task,
    enabled: data?.enabled !== false,
  });
  localScheduler.syncTasks("set-scheduled-task-enabled");
  broadcastScheduledTasksChanged();
  return {
    success: true,
    task: listSerializedScheduledTasks().find((entry) => entry.id === task.id) ?? null,
  };
});

ipcMain.handle("bulk-set-scheduled-task-enabled", (_event, data: {
  taskIds?: string[];
  enabled: boolean;
}) => {
  const taskIds = Array.isArray(data?.taskIds)
    ? Array.from(new Set(data.taskIds.map((entry) => String(entry ?? "").trim()).filter(Boolean)))
    : [];
  if (!taskIds.length) {
    return { success: false, error: "Choose at least one scheduled task." };
  }

  let changedCount = 0;
  for (const taskId of taskIds) {
    const task = scheduledTaskStore.getTaskById(taskId);
    if (!task) {
      continue;
    }
    if (task.enabled === (data?.enabled !== false)) {
      continue;
    }
    scheduledTaskStore.saveTask({
      ...task,
      enabled: data?.enabled !== false,
    });
    changedCount += 1;
  }

  localScheduler.syncTasks("bulk-set-scheduled-task-enabled");
  broadcastScheduledTasksChanged();
  return {
    success: true,
    changedCount,
    tasks: listSerializedScheduledTasks(),
  };
});

ipcMain.handle("run-scheduled-task-now", async (_event, taskId: string) => {
  return await localScheduler.runTaskNow(String(taskId ?? "").trim());
});

ipcMain.handle("list-workgroups", () => {
  return {
    success: true,
    workgroups: listSerializedWorkgroups(),
  };
});

ipcMain.handle("search-project-messages", (_event, data: {
  projectId: string;
  query: string;
  conversationId?: string | null;
  limit?: number;
}) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(data.projectId)) {
    requestRemoteProjectSync(data.projectId, "search-remote-project-messages", false, "full");
    return {
      success: true,
      items: remoteSessionStore?.searchMessages(data.projectId, {
        query: data.query,
        conversationId: data.conversationId,
        limit: data.limit,
      }) ?? [],
    };
  }

  return {
    success: true,
    items: runtimeManager.searchMessages(data.projectId, {
      query: data.query,
      conversationId: data.conversationId,
      limit: data.limit,
    }),
  };
});

ipcMain.handle("list-workgroup-collaborations", () => {
  void refreshRemoteWorkgroupCatalog();
  requestPrioritizedRemoteWorkgroupSessionSyncs("list-workgroup-collaborations");
  return {
    success: true,
    workgroups: getAllWorkgroupCollaborationSummaries(),
  };
});

ipcMain.handle("get-workgroup-collaboration-session", async (_event, workgroupId: string) => {
  activeWorkgroupCollaborationId = workgroupId.trim() || null;
  if (parseCompositeWorkgroupId(workgroupId)) {
    const existingRemoteSession = remoteWorkgroupStore?.getSession(workgroupId);
    if (existingRemoteSession) {
      requestRemoteWorkgroupSessionSync(workgroupId, "open-remote-workgroup-session");
      return { success: true, session: existingRemoteSession };
    }
    return await (remoteWorkgroupStore?.requestSession(workgroupId, { limit: 30 }) ?? Promise.resolve({
      success: false,
      error: "Remote workgroup collaboration not found",
    }));
  }
  const session = workgroupCollaborationService.getSession(workgroupId);
  if (!session) {
    return { success: false, error: "Workgroup collaboration not found" };
  }
  return {
    success: true,
    session,
  };
});

ipcMain.handle("get-workgroup-collaboration-history-page", async (_event, data: {
  workgroupId: string;
  beforeId?: string | null;
  limit?: number;
}) => {
  activeWorkgroupCollaborationId = data.workgroupId.trim() || null;
  if (parseCompositeWorkgroupId(data.workgroupId)) {
    const existingPage = remoteWorkgroupStore?.getHistoryPage(data.workgroupId, {
      beforeId: data.beforeId,
      limit: data.limit,
    });
    if (!data.beforeId && existingPage && existingPage.items.length > 0) {
      requestRemoteWorkgroupSessionSync(data.workgroupId, "open-remote-workgroup-history-page");
    }
    if ((!existingPage || (existingPage.items.length === 0 && existingPage.hasMore && data.beforeId)) && remoteWorkgroupStore) {
      const result = await remoteWorkgroupStore.requestSession(data.workgroupId, {
        beforeId: data.beforeId,
        limit: data.limit,
      });
      if (!result.success) {
        return result;
      }
    }
    const page = remoteWorkgroupStore?.getHistoryPage(data.workgroupId, {
      beforeId: data.beforeId,
      limit: data.limit,
    });
    if (!page) {
      return { success: false, error: "Remote workgroup collaboration not found" };
    }
    return {
      success: true,
      page,
    };
  }

  const page = workgroupCollaborationService.getHistoryPage(data.workgroupId, {
    beforeId: data.beforeId,
    limit: data.limit,
  });
  if (!page) {
    return { success: false, error: "Workgroup collaboration not found" };
  }
  return {
    success: true,
    page,
  };
});

ipcMain.handle("search-workgroup-collaboration-messages", (_event, data: {
  workgroupId: string;
  query: string;
  limit?: number;
}) => {
  activeWorkgroupCollaborationId = data.workgroupId.trim() || null;
  if (parseCompositeWorkgroupId(data.workgroupId)) {
    requestRemoteWorkgroupSessionSync(data.workgroupId, "search-remote-workgroup-messages");
    const items = remoteWorkgroupStore?.searchMessages(data.workgroupId, {
      query: data.query,
      limit: data.limit,
    });
    if (!items) {
      return { success: false, error: "Remote workgroup collaboration not found" };
    }
    return {
      success: true,
      items,
    };
  }

  const items = workgroupCollaborationService.searchMessages(data.workgroupId, {
    query: data.query,
    limit: data.limit,
  });
  if (!items) {
    return { success: false, error: "Workgroup collaboration not found" };
  }
  return {
    success: true,
    items,
  };
});

ipcMain.handle("send-workgroup-collaboration-message", async (_event, data: { workgroupId: string; content: string }) => {
  activeWorkgroupCollaborationId = data.workgroupId.trim() || null;
  if (parseCompositeWorkgroupId(data.workgroupId)) {
    return await (remoteWorkgroupStore?.sendMessage(data.workgroupId, data.content) ?? Promise.resolve({
      success: false,
      error: "Remote workgroup collaboration not found",
    }));
  }
  return await workgroupCollaborationService.sendUserMessage(data.workgroupId, data.content);
});

ipcMain.handle("save-workgroup", (_event, data: {
  id?: string;
  name: string;
  description?: string | null;
  allowDirectMemberMessages?: boolean;
  selectedProjectIds?: string[] | null;
}) => {
  const name = String(data?.name ?? "").trim();
  if (!name) {
    return { success: false, error: "Workgroup name is required" };
  }

  const existing = typeof data?.id === "string" ? workgroupStore.getWorkgroupById(data.id.trim()) : null;
  const workgroupId = existing?.id || (typeof data?.id === "string" && data.id.trim() ? data.id.trim() : uuidv4());
  const planWorkspacePath = ensureWorkgroupPlanDirectory(
    existing?.planWorkspacePath
    ?? getDefaultWorkgroupPlanPath(workgroupId),
  );

  const workgroup = workgroupStore.saveWorkgroup({
    id: workgroupId,
    name,
    description: data?.description ?? null,
    allowDirectMemberMessages: Boolean(data?.allowDirectMemberMessages),
    groupNumber: existing?.groupNumber ?? null,
    planWorkspacePath,
    registryUpdatedAt: existing?.registryUpdatedAt ?? null,
  });
  syncWorkgroupMembersFromSelection(workgroup, Array.isArray(data?.selectedProjectIds) ? data.selectedProjectIds : []);
  broadcastWorkgroupsChanged();
  return {
    success: true,
    workgroup: getSerializedWorkgroupById(workgroup.id),
  };
});

ipcMain.handle("delete-workgroup", (_event, workgroupId: string) => {
  const workgroup = workgroupStore.getWorkgroupById(workgroupId);
  if (!workgroup) {
    return { success: false, error: "Workgroup not found" };
  }

  if (workgroup.groupNumber?.trim()) {
    clearWorkgroupRegistryCaches();
    void removeWorkgroupRegistry(workgroup.id).catch((error) => {
      appLogger.warn("workgroup", "Failed to remove workgroup registry.", {
        workgroupId: workgroup.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  workgroupStore.removeWorkgroup(workgroupId);
  workgroupCollaborationService.removeWorkgroup(workgroupId);
  broadcastWorkgroupsChanged();
  return { success: true };
});

ipcMain.handle("publish-workgroup-registry", async (_event, workgroupId: string) => {
  try {
    const record = await publishWorkgroupRegistry(String(workgroupId ?? "").trim());
    clearWorkgroupRegistryCaches();
    broadcastWorkgroupsChanged();
    return {
      success: true,
      record,
      workgroup: getSerializedWorkgroupById(record.workgroupId),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("search-workgroup-registry", async (_event, query: string) => {
  try {
    const normalizedQuery = normalizeWorkgroupRegistrySearchQuery(query);
    const records = await workgroupRegistrySearchCache.get(normalizedQuery);
    return {
      success: true,
      records,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("join-workgroup-registry", async (_event, groupNumber: string) => {
  try {
    const response = await requestWorkgroupRegistry<{ success: boolean; record: WorkgroupRegistryRecord; granted_access: boolean }>("/api/workgroups/registry/join", {
      method: "POST",
      body: { group_number: String(groupNumber ?? "").trim() },
    });
    clearWorkgroupRegistryCaches();
    clearAccessGrantCache();
    void refreshRemoteWorkgroupCatalog(true);
    return {
      ...response,
      success: response.success !== false,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("get-workgroup-registry-members", async (_event, data: WorkgroupRegistryMembersQuery) => {
  try {
    const response = await workgroupRegistryMembersCache.get(
      createWorkgroupRegistryMembersCacheKey(data),
    );
    return {
      success: true,
      ...response,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("leave-workgroup-registry", async (_event, data: {
  groupNumber?: string | null;
  workgroupId?: string | null;
  hostAgentId?: string | null;
}) => {
  try {
    const response = await requestWorkgroupRegistry<{ success: boolean }>("/api/workgroups/registry/leave", {
      method: "POST",
      body: {
        group_number: String(data?.groupNumber ?? "").trim() || undefined,
        workgroup_id: String(data?.workgroupId ?? "").trim() || undefined,
        host_agent_id: String(data?.hostAgentId ?? "").trim() || undefined,
      },
    });
    clearWorkgroupRegistryCaches();
    clearAccessGrantCache();
    void refreshRemoteWorkgroupCatalog(true);
    return {
      success: response.success !== false,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("kick-workgroup-registry-member", async (_event, data: {
  groupNumber?: string | null;
  workgroupId?: string | null;
  hostAgentId?: string | null;
  userId: number;
}) => {
  try {
    const response = await requestWorkgroupRegistry<{ success: boolean }>("/api/workgroups/registry/kick", {
      method: "POST",
      body: {
        group_number: String(data?.groupNumber ?? "").trim() || undefined,
        workgroup_id: String(data?.workgroupId ?? "").trim() || undefined,
        host_agent_id: String(data?.hostAgentId ?? "").trim() || undefined,
        user_id: Number(data?.userId) || 0,
      },
    });
    clearWorkgroupRegistryCaches();
    void refreshRemoteWorkgroupCatalog();
    return {
      success: response.success !== false,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("save-workgroup-member", (_event, data: {
  id?: string;
  workgroupId: string;
  name: string;
  role: WorkgroupRole;
  projectId?: string | null;
  allowedPaths?: string[] | null;
  systemPrompt?: string | null;
}) => {
  const workgroup = workgroupStore.getWorkgroupById(data?.workgroupId || "");
  if (!workgroup) {
    return { success: false, error: "Workgroup not found" };
  }

  const name = String(data?.name ?? "").trim();
  if (!name) {
    return { success: false, error: "Member name is required" };
  }
  if (data.role === "project_manager") {
    return { success: false, error: "Project Manager is reserved for the virtual PM Agent." };
  }

  const projectId = typeof data?.projectId === "string" && data.projectId.trim() ? data.projectId.trim() : null;
  const binding = resolveWorkgroupProjectBinding(projectId);
  const member = workgroupStore.saveMember({
    id: typeof data?.id === "string" ? data.id.trim() : undefined,
    workgroupId: workgroup.id,
    name,
    role: data.role,
    projectId,
    projectName: binding.projectName,
    projectPath: binding.projectPath,
    projectKind: binding.projectKind,
    allowedPaths: Array.isArray(data?.allowedPaths) ? data.allowedPaths : [],
    systemPrompt: data?.systemPrompt ?? null,
  });
  touchWorkgroup(workgroup.id);
  broadcastWorkgroupsChanged();
  return {
    success: true,
    member: serializeWorkgroupMember(member),
    workgroup: getSerializedWorkgroupById(workgroup.id),
  };
});

ipcMain.handle("delete-workgroup-member", (_event, memberId: string) => {
  const member = workgroupStore.getMemberById(memberId);
  if (!member) {
    return { success: false, error: "Member not found" };
  }

  workgroupStore.removeMember(memberId);
  touchWorkgroup(member.workgroupId);
  broadcastWorkgroupsChanged();
  return { success: true };
});

ipcMain.handle("save-workgroup-task", (_event, data: {
  id?: string;
  workgroupId: string;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  assigneeMemberId?: string | null;
  priority?: "low" | "normal" | "high";
  status?: WorkgroupTaskStatus;
  scheduleType?: "manual" | ScheduledTaskScheduleType | null;
  runAt?: number | null;
  delayMinutes?: number | null;
  dailyTime?: string | null;
  weeklyDay?: number | null;
  scheduleEnabled?: boolean;
}) => handleSaveWorkgroupTaskRequest(data));

ipcMain.handle("delete-workgroup-task", (_event, taskId: string) => {
  return handleDeleteWorkgroupTaskRequest(taskId);
});

ipcMain.handle("set-workgroup-task-schedule-enabled", (_event, data: {
  taskId: string;
  enabled: boolean;
}) => handleSetWorkgroupTaskScheduleEnabledRequest(data));

ipcMain.handle("update-workgroup-task-status", (_event, data: {
  taskId: string;
  status: WorkgroupTaskStatus;
  lastDispatchResult?: string | null;
}) => handleUpdateWorkgroupTaskStatusRequest(data));

ipcMain.handle("dispatch-workgroup-task", async (_event, taskId: string) => handleDispatchWorkgroupTaskRequest(taskId));

ipcMain.on("minimize-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.on("maximize-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

ipcMain.on("close-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

app.whenReady().then(async () => {
  tray = createTray();
  await refreshAgentToken(false);
  await refreshControllerToken(false);
  const config = loadConfig();
  initRelay(config);
  ensureRemoteRelayReady(config);
  scheduleTokenRefresh();
  scheduleControllerTokenRefresh();
  startRelayHealthChecks();
  startRelayMaintenanceTask();
  runRelayMaintenanceTask("startup");
  localScheduler.start();
  workgroupTaskScheduler.start();
  powerMonitor.on("resume", () => {
    runRelayMaintenanceTask("power-resume");
  });
  powerMonitor.on("unlock-screen", () => {
    runRelayMaintenanceTask("unlock-screen");
  });
  updateManager.start();
  void Promise.all((["claude", "codex"] as CliProvider[]).map(async (provider) => {
    try {
      await getCliProviderRuntimeStatus(provider, { allowAutoUpgrade: true });
    } catch (error) {
      appLogger.warn("runtime", "Failed to warm provider runtime status.", {
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));

  // Open workspace window unless silent launch is configured
  const silentLaunch = appSettingsStore.get("silentLaunch") as boolean;
  const launchedFromUpdate = process.argv.some((entry) => entry === "--updated");
  if (launchedFromUpdate || !silentLaunch) {
    showWorkspaceWindow();
  }
});

app.on("window-all-closed", (_event: Electron.Event) => {
  // Keep running in system tray — do not quit when all windows close
  _event.preventDefault();
});

app.on("before-quit", () => {
  if (tokenRefreshTimer) {
    clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }
  if (controllerTokenRefreshTimer) {
    clearTimeout(controllerTokenRefreshTimer);
    controllerTokenRefreshTimer = null;
  }
  if (relayHealthCheckTimer) {
    clearInterval(relayHealthCheckTimer);
    relayHealthCheckTimer = null;
  }
  if (relayMaintenanceTimer) {
    clearInterval(relayMaintenanceTimer);
    relayMaintenanceTimer = null;
  }
  uiRemoteProjectRefreshTrigger.dispose();
  clearRelayFollowUpRefreshTimers();
  if (relayClient) relayClient.disconnect();
  if (controllerRelayClient) controllerRelayClient.disconnect();
  localScheduler.stop();
  updateManager.stop();
  runtimeManager.dispose();
  for (const project of projectStore.getAll()) {
    ptyManager.kill(project.id);
  }
});

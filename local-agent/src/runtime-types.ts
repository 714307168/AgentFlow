export type CliProvider = "claude" | "codex";
export type RunSource = "remote" | "desktop";

export interface RunAttachment {
  id: string;
  name: string;
  path: string;
  size: number;
  kind: "image" | "file";
  mimeType?: string;
  previewDataUrl?: string;
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  attachments?: RunAttachment[];
  provider?: CliProvider | null;
  source: RunSource;
  createdAt: number;
  updatedAt: number;
  status: "streaming" | "done";
}

export interface SessionActivity {
  id: string;
  kind: "status" | "thinking" | "tool" | "command" | "agent" | "error";
  title: string;
  detail: string;
  status: "pending" | "running" | "completed" | "error";
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, string | number | boolean>;
}

export interface QueuedRunSnapshot {
  runId: string;
  prompt: string;
  attachments?: RunAttachment[];
  source: RunSource;
  queuedAt: number;
}

export interface CliTraceEntry {
  id: string;
  stream: "system" | "stdout" | "stderr";
  text: string;
  createdAt: number;
}

export interface ProjectSessionSnapshot {
  projectId: string;
  provider: CliProvider;
  model: string | null;
  automationMode: "full-auto";
  isRunning: boolean;
  queuedCount: number;
  currentSource: RunSource | null;
  currentPrompt: string | null;
  currentStartedAt: number | null;
  queue: QueuedRunSnapshot[];
  cliTrace: CliTraceEntry[];
  messages: SessionMessage[];
  activities: SessionActivity[];
  sessionRefs: {
    claudeSessionId: string | null;
    codexThreadId: string | null;
  };
}

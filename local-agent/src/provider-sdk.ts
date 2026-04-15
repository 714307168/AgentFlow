import * as fs from "fs";
import {
  getProviderDefaultSdkBaseUrl,
  getProviderDefaultSdkModel,
} from "./provider-registry";
import type { CliProvider, RunAttachment, SessionMessage } from "./runtime-types";

export interface ProviderSdkConfig {
  apiKey: string | null;
  baseUrl: string | null;
  defaultModel: string | null;
}

export interface ProviderSdkExecutionOptions {
  provider: CliProvider;
  config: ProviderSdkConfig;
  model: string | null;
  prompt: string;
  projectPrompt?: string | null;
  messages?: SessionMessage[];
  attachments?: RunAttachment[];
  signal?: AbortSignal;
}

export interface ProviderSdkExecutionResult {
  text: string;
  model: string | null;
}

const MAX_SDK_MESSAGES = 12;
const MAX_SDK_TOTAL_CHARS = 24_000;

export function isProviderSdkConfigured(config: ProviderSdkConfig | null | undefined): boolean {
  return Boolean(config?.apiKey?.trim());
}

export async function executeProviderSdkRun(
  options: ProviderSdkExecutionOptions,
): Promise<ProviderSdkExecutionResult> {
  if (!isProviderSdkConfigured(options.config)) {
    throw new Error("Provider SDK credentials are not configured.");
  }

  if (options.provider === "codex") {
    return await executeOpenAiChatCompletion(options);
  }

  return await executeAnthropicMessages(options);
}

function buildConversationHistory(messages: SessionMessage[] | undefined, prompt: string): SessionMessage[] {
  const sourceMessages = Array.isArray(messages) ? messages : [];
  const filtered = sourceMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-MAX_SDK_MESSAGES);
  let totalChars = 0;
  const kept: SessionMessage[] = [];
  for (let index = filtered.length - 1; index >= 0; index -= 1) {
    const message = filtered[index];
    totalChars += message.content.length;
    if (totalChars > MAX_SDK_TOTAL_CHARS && kept.length > 0) {
      break;
    }
    kept.unshift(message);
  }
  if (kept.length === 0) {
    return [{
      id: "__sdk_user__",
      role: "user",
      content: prompt,
      attachments: [],
      source: "desktop",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "done",
    }];
  }
  return kept;
}

async function executeOpenAiChatCompletion(
  options: ProviderSdkExecutionOptions,
): Promise<ProviderSdkExecutionResult> {
  const url = joinBaseUrl(options.config.baseUrl || getProviderDefaultSdkBaseUrl("codex"), "/v1/chat/completions");
  const messages = await Promise.all(
    buildConversationHistory(options.messages, options.prompt).map(async (message) => ({
      role: message.role,
      content: await buildOpenAiContentBlocks(
        message.content,
        message.attachments ?? (message.content === options.prompt ? options.attachments ?? [] : []),
      ),
    })),
  );

  const systemPrompt = normalizeText(options.projectPrompt);
  const payloadMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.config.apiKey!.trim()}`,
    },
    body: JSON.stringify({
      model: normalizeText(options.model) || normalizeText(options.config.defaultModel) || getProviderDefaultSdkModel("codex"),
      messages: payloadMessages,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = (await response.text()).trim();
    throw new Error(errorText || response.statusText || "OpenAI SDK fallback request failed.");
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    model?: string;
  };
  const content = payload.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content.trim()
    : Array.isArray(content)
      ? content.map((entry) => String(entry?.text ?? "")).join("\n").trim()
      : "";
  if (!text) {
    throw new Error("OpenAI SDK fallback returned no assistant text.");
  }
  return {
    text,
    model: normalizeText(payload.model) || normalizeText(options.model) || normalizeText(options.config.defaultModel),
  };
}

async function executeAnthropicMessages(
  options: ProviderSdkExecutionOptions,
): Promise<ProviderSdkExecutionResult> {
  const url = joinBaseUrl(options.config.baseUrl || getProviderDefaultSdkBaseUrl("claude"), "/v1/messages");
  const messages = await Promise.all(
    buildConversationHistory(options.messages, options.prompt).map(async (message) => ({
      role: message.role,
      content: await buildAnthropicContentBlocks(
        message.content,
        message.attachments ?? (message.content === options.prompt ? options.attachments ?? [] : []),
      ),
    })),
  );

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": options.config.apiKey!.trim(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: normalizeText(options.model) || normalizeText(options.config.defaultModel) || getProviderDefaultSdkModel("claude"),
      max_tokens: 4096,
      system: normalizeText(options.projectPrompt) || undefined,
      messages,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = (await response.text()).trim();
    throw new Error(errorText || response.statusText || "Anthropic SDK fallback request failed.");
  }

  const payload = await response.json() as {
    content?: Array<{ type?: string; text?: string }>;
    model?: string;
  };
  const text = Array.isArray(payload.content)
    ? payload.content
      .filter((entry) => entry?.type === "text")
      .map((entry) => String(entry?.text ?? ""))
      .join("\n")
      .trim()
    : "";
  if (!text) {
    throw new Error("Anthropic SDK fallback returned no assistant text.");
  }
  return {
    text,
    model: normalizeText(payload.model) || normalizeText(options.model) || normalizeText(options.config.defaultModel),
  };
}

async function buildOpenAiContentBlocks(content: string, attachments: RunAttachment[]): Promise<Array<Record<string, unknown>>> {
  const blocks: Array<Record<string, unknown>> = [
    { type: "text", text: appendUnsupportedAttachmentNote(content, attachments) },
  ];

  for (const attachment of attachments) {
    const imageBlock = await buildImageDataUrl(attachment);
    if (!imageBlock) {
      continue;
    }
    blocks.push({
      type: "image_url",
      image_url: {
        url: imageBlock,
      },
    });
  }

  return blocks;
}

async function buildAnthropicContentBlocks(content: string, attachments: RunAttachment[]): Promise<Array<Record<string, unknown>>> {
  const blocks: Array<Record<string, unknown>> = [
    { type: "text", text: appendUnsupportedAttachmentNote(content, attachments) },
  ];

  for (const attachment of attachments) {
    const imageData = await buildImageBase64(attachment);
    if (!imageData) {
      continue;
    }
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageData.mimeType,
        data: imageData.base64,
      },
    });
  }

  return blocks;
}

function appendUnsupportedAttachmentNote(content: string, attachments: RunAttachment[]): string {
  const unsupported = attachments
    .filter((attachment) => attachment.kind !== "image")
    .map((attachment) => attachment.name)
    .filter(Boolean);
  if (unsupported.length === 0) {
    return content;
  }
  return [
    content,
    "",
    `Attachment note: non-image local files are not sent through the API fallback runtime. Provided files: ${unsupported.join(", ")}`,
  ].join("\n").trim();
}

async function buildImageDataUrl(attachment: RunAttachment): Promise<string | null> {
  const image = await buildImageBase64(attachment);
  if (!image) {
    return null;
  }
  return `data:${image.mimeType};base64,${image.base64}`;
}

async function buildImageBase64(attachment: RunAttachment): Promise<{ base64: string; mimeType: string } | null> {
  if (attachment.kind !== "image") {
    return null;
  }
  const filePath = normalizeText(attachment.path);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  const mimeType = normalizeText(attachment.mimeType) || "image/png";
  return {
    base64: fs.readFileSync(filePath).toString("base64"),
    mimeType,
  };
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function joinBaseUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}${suffix}`;
}

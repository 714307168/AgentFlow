import * as fs from "fs";
import { loadManagedProviderSdkModule } from "./provider-sdk-manager";
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

export interface ProviderSdkImageGenerationOptions {
  provider: CliProvider;
  config: ProviderSdkConfig;
  model: string | null;
  prompt: string;
  signal?: AbortSignal;
}

export interface ProviderSdkImageGenerationResult {
  bytes: Buffer;
  mimeType: string;
  fileExtension: string;
  model: string | null;
  revisedPrompt: string | null;
}

const MAX_SDK_MESSAGES = 12;
const MAX_SDK_TOTAL_CHARS = 24_000;

class ManagedProviderSdkUnavailableError extends Error {}

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
    try {
      return await executeManagedOpenAiChatCompletion(options);
    } catch (error) {
      if (!(error instanceof ManagedProviderSdkUnavailableError)) {
        throw error;
      }
    }
    return await executeOpenAiChatCompletion(options);
  }

  try {
    return await executeManagedAnthropicMessages(options);
  } catch (error) {
    if (!(error instanceof ManagedProviderSdkUnavailableError)) {
      throw error;
    }
  }
  return await executeAnthropicMessages(options);
}

export async function generateProviderSdkImage(
  options: ProviderSdkImageGenerationOptions,
): Promise<ProviderSdkImageGenerationResult> {
  if (!isProviderSdkConfigured(options.config)) {
    throw new Error("Provider SDK credentials are not configured.");
  }
  if (options.provider !== "codex") {
    throw new Error("Image generation is currently available only for OpenAI-compatible project providers.");
  }

  try {
    return await generateManagedOpenAiImage(options);
  } catch (error) {
    if (!(error instanceof ManagedProviderSdkUnavailableError)) {
      throw error;
    }
  }

  return await generateOpenAiImageViaHttp(options);
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

async function executeManagedOpenAiChatCompletion(
  options: ProviderSdkExecutionOptions,
): Promise<ProviderSdkExecutionResult> {
  const OpenAI = resolveManagedOpenAiClientConstructor();
  const client = new OpenAI({
    apiKey: options.config.apiKey!.trim(),
    baseURL: normalizeText(options.config.baseUrl) || getProviderDefaultSdkBaseUrl("codex"),
  });
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
  const payloadModel =
    normalizeText(options.model) || normalizeText(options.config.defaultModel) || getProviderDefaultSdkModel("codex");
  const response = await client.chat.completions.create({
    model: payloadModel,
    messages: payloadMessages,
  });
  const content = response?.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content.trim()
    : Array.isArray(content)
      ? content
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          if (entry && typeof entry === "object" && "text" in entry) {
            return String((entry as { text?: unknown }).text ?? "");
          }
          return "";
        })
        .join("\n")
        .trim()
      : "";
  if (!text) {
    throw new Error("OpenAI managed SDK returned no assistant text.");
  }
  return {
    text,
    model: normalizeText(response?.model) || payloadModel,
  };
}

async function generateManagedOpenAiImage(
  options: ProviderSdkImageGenerationOptions,
): Promise<ProviderSdkImageGenerationResult> {
  const OpenAI = resolveManagedOpenAiClientConstructor();
  const client = new OpenAI({
    apiKey: options.config.apiKey!.trim(),
    baseURL: normalizeText(options.config.baseUrl) || getProviderDefaultSdkBaseUrl("codex"),
  });
  const payloadModel =
    normalizeText(options.model) || normalizeText(options.config.defaultModel) || getProviderDefaultSdkModel("codex");
  const response = await client.images.generate({
    model: payloadModel,
    prompt: normalizeText(options.prompt),
    size: "1024x1024",
  });
  return await normalizeOpenAiGeneratedImageResponse(response, payloadModel, options.signal);
}

async function executeManagedAnthropicMessages(
  options: ProviderSdkExecutionOptions,
): Promise<ProviderSdkExecutionResult> {
  const Anthropic = resolveManagedAnthropicClientConstructor();
  const client = new Anthropic({
    apiKey: options.config.apiKey!.trim(),
    baseURL: normalizeText(options.config.baseUrl) || getProviderDefaultSdkBaseUrl("claude"),
  });
  const messages = await Promise.all(
    buildConversationHistory(options.messages, options.prompt).map(async (message) => ({
      role: message.role,
      content: await buildAnthropicContentBlocks(
        message.content,
        message.attachments ?? (message.content === options.prompt ? options.attachments ?? [] : []),
      ),
    })),
  );
  const payloadModel =
    normalizeText(options.model) || normalizeText(options.config.defaultModel) || getProviderDefaultSdkModel("claude");
  const response = await client.messages.create({
    model: payloadModel,
    max_tokens: 4096,
    system: normalizeText(options.projectPrompt) || undefined,
    messages,
  });
  const text = Array.isArray(response?.content)
    ? response.content
      .filter((entry) => entry?.type === "text")
      .map((entry) => String(entry?.text ?? ""))
      .join("\n")
      .trim()
    : "";
  if (!text) {
    throw new Error("Anthropic managed SDK returned no assistant text.");
  }
  return {
    text,
    model: normalizeText(response?.model) || payloadModel,
  };
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

async function generateOpenAiImageViaHttp(
  options: ProviderSdkImageGenerationOptions,
): Promise<ProviderSdkImageGenerationResult> {
  const url = joinBaseUrl(options.config.baseUrl || getProviderDefaultSdkBaseUrl("codex"), "/v1/images/generations");
  const payloadModel =
    normalizeText(options.model) || normalizeText(options.config.defaultModel) || getProviderDefaultSdkModel("codex");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.config.apiKey!.trim()}`,
    },
    body: JSON.stringify({
      model: payloadModel,
      prompt: normalizeText(options.prompt),
      size: "1024x1024",
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = (await response.text()).trim();
    throw new Error(errorText || response.statusText || "OpenAI image generation request failed.");
  }

  const payload = await response.json() as {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    model?: string;
  };
  return await normalizeOpenAiGeneratedImageResponse(payload, payloadModel, options.signal);
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

function resolveManagedOpenAiClientConstructor(): new (options: Record<string, unknown>) => {
  chat: {
    completions: {
      create: (payload: Record<string, unknown>) => Promise<{
        choices?: Array<{ message?: { content?: unknown } }>;
        model?: string | null;
      }>;
    };
  };
  images: {
    generate: (payload: Record<string, unknown>) => Promise<{
      data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
      model?: string | null;
    }>;
  };
} {
  const sdkModule = loadManagedProviderSdkModule("codex");
  const candidate = sdkModule && typeof sdkModule === "object" && "default" in (sdkModule as Record<string, unknown>)
    ? (sdkModule as Record<string, unknown>).default ?? (sdkModule as Record<string, unknown>).OpenAI ?? sdkModule
    : ((sdkModule as Record<string, unknown> | null | undefined)?.OpenAI ?? sdkModule);
  if (typeof candidate !== "function") {
    throw new ManagedProviderSdkUnavailableError("Managed OpenAI SDK module is unavailable.");
  }
  return candidate as new (options: Record<string, unknown>) => {
    chat: {
      completions: {
        create: (payload: Record<string, unknown>) => Promise<{
          choices?: Array<{ message?: { content?: unknown } }>;
          model?: string | null;
        }>;
      };
    };
    images: {
      generate: (payload: Record<string, unknown>) => Promise<{
        data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
        model?: string | null;
      }>;
    };
  };
}

function resolveManagedAnthropicClientConstructor(): new (options: Record<string, unknown>) => {
  messages: {
    create: (payload: Record<string, unknown>) => Promise<{
      content?: Array<{ type?: string; text?: string }>;
      model?: string | null;
    }>;
  };
} {
  const sdkModule = loadManagedProviderSdkModule("claude");
  const candidate = sdkModule && typeof sdkModule === "object" && "default" in (sdkModule as Record<string, unknown>)
    ? (sdkModule as Record<string, unknown>).default ?? (sdkModule as Record<string, unknown>).Anthropic ?? sdkModule
    : ((sdkModule as Record<string, unknown> | null | undefined)?.Anthropic ?? sdkModule);
  if (typeof candidate !== "function") {
    throw new ManagedProviderSdkUnavailableError("Managed Anthropic SDK module is unavailable.");
  }
  return candidate as new (options: Record<string, unknown>) => {
    messages: {
      create: (payload: Record<string, unknown>) => Promise<{
        content?: Array<{ type?: string; text?: string }>;
        model?: string | null;
      }>;
    };
  };
}

function joinBaseUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}${suffix}`;
}

async function normalizeOpenAiGeneratedImageResponse(
  payload: {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    model?: string | null;
  },
  fallbackModel: string,
  signal?: AbortSignal,
): Promise<ProviderSdkImageGenerationResult> {
  const firstImage = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (firstImage?.b64_json) {
    return {
      bytes: Buffer.from(firstImage.b64_json, "base64"),
      mimeType: "image/png",
      fileExtension: ".png",
      model: normalizeText(payload?.model) || fallbackModel,
      revisedPrompt: normalizeText(firstImage.revised_prompt) || null,
    };
  }
  if (firstImage?.url) {
    const downloaded = await downloadGeneratedImage(firstImage.url, signal);
    return {
      ...downloaded,
      model: normalizeText(payload?.model) || fallbackModel,
      revisedPrompt: normalizeText(firstImage.revised_prompt) || null,
    };
  }
  throw new Error("OpenAI image generation returned no image output.");
}

async function downloadGeneratedImage(
  url: string,
  signal?: AbortSignal,
): Promise<Pick<ProviderSdkImageGenerationResult, "bytes" | "mimeType" | "fileExtension">> {
  const response = await fetch(url, {
    method: "GET",
    signal,
  });
  if (!response.ok) {
    const errorText = (await response.text()).trim();
    throw new Error(errorText || response.statusText || "Failed to download generated image.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const mimeType = normalizeImageMimeType(response.headers.get("content-type")) || "image/png";
  return {
    bytes,
    mimeType,
    fileExtension: guessImageFileExtensionFromMimeType(mimeType),
  };
}

function normalizeImageMimeType(contentType: string | null): string | null {
  const normalized = normalizeText(contentType).split(";")[0]?.trim().toLowerCase() ?? "";
  return normalized.startsWith("image/") ? normalized : null;
}

function guessImageFileExtensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".png";
  }
}

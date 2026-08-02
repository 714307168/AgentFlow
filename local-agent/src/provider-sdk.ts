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
  onTextDelta?: (chunk: string) => void;
  onGuidance?: (event: ProviderSdkGuidanceEvent) => void;
}

export interface ProviderSdkExecutionResult {
  text: string;
  model: string | null;
}

export interface ProviderSdkGuidanceEvent {
  key: string;
  kind: "thinking" | "tool" | "status";
  title: string;
  delta?: string;
  detail?: string;
  status?: "pending" | "running" | "completed" | "error";
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

class OpenAiResponsesUnavailableError extends Error {}

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
    if (shouldUseOpenAiResponsesApi(options.config, options.model)) {
      try {
        return await executeOpenAiResponsesStream(options);
      } catch (error) {
        if (!(error instanceof OpenAiResponsesUnavailableError)) {
          throw error;
        }
      }
    }
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
  const client = new OpenAI(buildManagedOpenAiClientOptions(options.config));
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

function buildManagedOpenAiClientOptions(config: ProviderSdkConfig): Record<string, unknown> {
  const baseURL = normalizeText(config.baseUrl);
  const clientOptions: Record<string, unknown> = {
    apiKey: config.apiKey!.trim(),
  };
  if (baseURL && baseURL !== getProviderDefaultSdkBaseUrl("codex")) {
    clientOptions.baseURL = baseURL;
  }
  return clientOptions;
}

async function executeOpenAiResponsesStream(
  options: ProviderSdkExecutionOptions,
): Promise<ProviderSdkExecutionResult> {
  const payloadModel =
    normalizeText(options.model) || normalizeText(options.config.defaultModel) || getProviderDefaultSdkModel("codex");
  const url = joinBaseUrl(options.config.baseUrl || getProviderDefaultSdkBaseUrl("codex"), "/v1/responses");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${options.config.apiKey!.trim()}`,
    },
    body: JSON.stringify({
      model: payloadModel,
      instructions: normalizeText(options.projectPrompt) || undefined,
      input: await buildOpenAiResponsesInput(options),
      reasoning: {
        summary: "auto",
      },
      stream: true,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = (await response.text()).trim();
    if (response.status === 404 || /unsupported|not supported|unknown parameter|invalid.*reasoning/i.test(errorText)) {
      throw new OpenAiResponsesUnavailableError(errorText || response.statusText || "OpenAI Responses API is unavailable.");
    }
    throw new Error(errorText || response.statusText || "OpenAI Responses API request failed.");
  }

  let text = "";
  let model: string | null = payloadModel;
  await readOpenAiSseStream(response, (event) => {
    const eventType = normalizeText(event.type as string | null | undefined);
    if (eventType === "response.completed" && event.response && typeof event.response === "object") {
      const responsePayload = event.response as Record<string, unknown>;
      model = normalizeText(responsePayload.model as string | null | undefined) || model;
      if (!text.trim()) {
        const completedText = extractOpenAiResponseText(responsePayload);
        if (completedText) {
          text += completedText;
          options.onTextDelta?.(completedText);
        }
      }
      options.onGuidance?.({
        key: "openai-responses-status",
        kind: "status",
        title: "OpenAI Responses",
        status: "completed",
        detail: "Responses stream completed.",
      });
      return;
    }

    const textDelta = extractOpenAiTextDelta(event);
    if (textDelta) {
      text += textDelta;
      options.onTextDelta?.(textDelta);
      return;
    }

    const guidance = normalizeOpenAiGuidanceEvent(event);
    if (guidance) {
      options.onGuidance?.(guidance);
    }
  });

  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new Error("OpenAI Responses API returned no assistant text.");
  }
  return {
    text: normalizedText,
    model,
  };
}

async function generateManagedOpenAiImage(
  options: ProviderSdkImageGenerationOptions,
): Promise<ProviderSdkImageGenerationResult> {
  const OpenAI = resolveManagedOpenAiClientConstructor();
  const client = new OpenAI(buildManagedOpenAiClientOptions(options.config));
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

async function buildOpenAiResponsesInput(options: ProviderSdkExecutionOptions): Promise<Array<Record<string, unknown>>> {
  const history = buildConversationHistory(options.messages, options.prompt);
  const input: Array<Record<string, unknown>> = [];
  for (const message of history) {
    const attachments = message.attachments ?? (message.content === options.prompt ? options.attachments ?? [] : []);
    input.push({
      role: message.role,
      content: await buildOpenAiResponsesContent(message.role, message.content, attachments),
    });
  }
  return input;
}

async function buildOpenAiResponsesContent(
  role: SessionMessage["role"],
  content: string,
  attachments: RunAttachment[],
): Promise<string | Array<Record<string, unknown>>> {
  if (!attachments.some((attachment) => attachment.kind === "image")) {
    return appendUnsupportedAttachmentNote(content, attachments);
  }

  const textType = role === "assistant" ? "output_text" : "input_text";
  const blocks: Array<Record<string, unknown>> = [
    { type: textType, text: appendUnsupportedAttachmentNote(content, attachments) },
  ];
  if (role !== "user") {
    return blocks;
  }
  for (const attachment of attachments) {
    const imageBlock = await buildImageDataUrl(attachment);
    if (!imageBlock) {
      continue;
    }
    blocks.push({
      type: "input_image",
      image_url: imageBlock,
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

function shouldUseOpenAiResponsesApi(config: ProviderSdkConfig, model: string | null): boolean {
  const baseUrl = normalizeText(config.baseUrl) || getProviderDefaultSdkBaseUrl("codex");
  let host = "";
  try {
    host = new URL(baseUrl).host.toLowerCase();
  } catch {
    return false;
  }
  const selectedModel =
    normalizeText(model) || normalizeText(config.defaultModel) || getProviderDefaultSdkModel("codex");
  return host === "api.openai.com" && /^(gpt-5(?:\.|-|$)|o[134](?:\.|-|$)|o\d(?:\.|-|$))/i.test(selectedModel);
}

async function readOpenAiSseStream(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const body = response.body;
  if (!body) {
    throw new Error("OpenAI Responses API returned no stream body.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = drainOpenAiSseBuffer(buffer, onEvent);
  }
  buffer += decoder.decode();
  drainOpenAiSseBuffer(buffer, onEvent, true);
}

function drainOpenAiSseBuffer(
  buffer: string,
  onEvent: (event: Record<string, unknown>) => void,
  flush = false,
): string {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const pending = flush ? "" : parts.pop() ?? "";
  const completeParts = flush ? parts.filter((part) => part.trim()) : parts;
  for (const part of completeParts) {
    const parsed = parseOpenAiSseEvent(part);
    if (parsed) {
      onEvent(parsed);
    }
  }
  return pending;
}

function parseOpenAiSseEvent(raw: string): Record<string, unknown> | null {
  const dataLines: string[] = [];
  let namedEvent = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      namedEvent = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  const data = dataLines.join("\n").trim();
  if (!data || data === "[DONE]") {
    return null;
  }
  const parsed = JSON.parse(data) as Record<string, unknown>;
  if (!parsed.type && namedEvent) {
    parsed.type = namedEvent;
  }
  return parsed;
}

function extractOpenAiTextDelta(event: Record<string, unknown>): string {
  const eventType = normalizeText(event.type as string | null | undefined);
  if (eventType !== "response.output_text.delta") {
    return "";
  }
  return normalizeEventText(event.delta) || normalizeEventText(event.text);
}

function normalizeOpenAiGuidanceEvent(event: Record<string, unknown>): ProviderSdkGuidanceEvent | null {
  const eventType = normalizeText(event.type as string | null | undefined);
  if (!eventType) {
    return null;
  }

  if (eventType.includes("reasoning_summary") || eventType.includes("reasoning_text")) {
    const delta = normalizeEventText(event.delta) || normalizeEventText(event.text);
    const doneText = normalizeEventText(event.text);
    return {
      key: eventType.includes("reasoning_summary") ? "openai-reasoning-summary" : "openai-reasoning",
      kind: "thinking",
      title: eventType.includes("reasoning_summary") ? "Reasoning summary" : "Reasoning guidance",
      delta: eventType.endsWith(".delta") ? delta : undefined,
      detail: !eventType.endsWith(".delta") ? doneText : undefined,
      status: eventType.endsWith(".done") ? "completed" : "running",
    };
  }

  if (eventType === "response.output_item.added" || eventType === "response.output_item.done") {
    const item = event.item && typeof event.item === "object" ? event.item as Record<string, unknown> : null;
    const itemType = normalizeText(item?.type as string | null | undefined);
    if (itemType === "function_call" || itemType === "tool_call") {
      const key = normalizeText(item?.id as string | null | undefined)
        || normalizeText(item?.call_id as string | null | undefined)
        || "openai-tool-call";
      const name = normalizeText(item?.name as string | null | undefined) || "Tool call";
      return {
        key,
        kind: "tool",
        title: name,
        detail: stringifyCompact(item),
        status: eventType.endsWith(".done") ? "completed" : "running",
      };
    }
  }

  if (eventType === "response.function_call_arguments.delta") {
    const key = normalizeText(event.item_id as string | null | undefined)
      || normalizeText(event.call_id as string | null | undefined)
      || "openai-tool-call";
    return {
      key,
      kind: "tool",
      title: "Tool arguments",
      delta: normalizeEventText(event.delta),
      status: "running",
    };
  }

  if (eventType === "response.failed" || eventType === "response.incomplete") {
    return {
      key: "openai-responses-status",
      kind: "status",
      title: "OpenAI Responses",
      detail: stringifyCompact(event.error ?? event),
      status: eventType === "response.failed" ? "error" : "completed",
    };
  }

  return null;
}

function normalizeEventText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractOpenAiResponseText(payload: Record<string, unknown>): string {
  const direct = normalizeEventText(payload.output_text);
  if (direct) {
    return direct.trim();
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as Array<Record<string, unknown>>
      : [];
    for (const block of content) {
      const text = normalizeEventText(block.text);
      if (text) {
        parts.push(text);
      }
    }
  }
  return parts.join("\n").trim();
}

function stringifyCompact(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
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
  const normalizedBaseUrl = baseUrl.replace(/\/+$/u, "");
  const normalizedSuffix = suffix.replace(/^\/+/, "/");
  // Google's OpenAI-compatible endpoint is itself rooted at `/openai` and
  // expects `/chat/completions`, not another `/v1` prefix.
  if (/\/openai$/iu.test(normalizedBaseUrl) && /^\/v\d+(?:\.\d+)?\//iu.test(normalizedSuffix)) {
    return `${normalizedBaseUrl}${normalizedSuffix.replace(/^\/v\d+(?:\.\d+)?/iu, "")}`;
  }
  if (/\/v\d+(?:\.\d+)?$/iu.test(normalizedBaseUrl) && /^\/v\d+(?:\.\d+)?\//iu.test(normalizedSuffix)) {
    return `${normalizedBaseUrl}${normalizedSuffix.replace(/^\/v\d+(?:\.\d+)?/iu, "")}`;
  }
  return `${normalizedBaseUrl}${normalizedSuffix}`;
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

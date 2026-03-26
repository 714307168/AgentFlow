import { createHash } from "crypto";
import type { RunAttachment } from "./runtime-types";

export interface SessionSyncKnownItemDigest {
  id: string;
  content_md5?: string;
  attachments_md5?: string;
}

function normalizeHashInput(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

export function createSessionSyncContentMd5(content: string | null | undefined): string {
  return createHash("md5")
    .update(normalizeHashInput(content ?? ""), "utf8")
    .digest("hex");
}

export function createSessionSyncAttachmentsMd5(attachments?: RunAttachment[] | null): string | null {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  const normalized = attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    path: attachment.path,
    size: attachment.size,
    kind: attachment.kind,
    mimeType: attachment.mimeType ?? "",
  }));

  return createHash("md5")
    .update(JSON.stringify(normalized), "utf8")
    .digest("hex");
}

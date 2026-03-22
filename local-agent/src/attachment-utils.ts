import { app, nativeImage, NativeImage } from "electron";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import type { RunAttachment } from "./runtime-types";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".ico",
  ".avif",
  ".heic",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
};

const DEFAULT_MAX_PREVIEW_DIMENSION = 420;
const DEFAULT_MAX_PREVIEW_DATA_URL_CHARS = 64_000;
const DEFAULT_JPEG_QUALITY = 82;

interface PreviewDataUrlOptions {
  maxDimension?: number;
  maxDataUrlChars?: number;
  format?: "png" | "jpeg";
  jpegQuality?: number;
}

export function isImageAttachment(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function guessMimeType(filePath: string, fallback = "application/octet-stream"): string {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? fallback;
}

export function sanitizeAttachmentFileName(fileName: string): string {
  const baseName = path.basename(fileName).trim();
  const sanitized = baseName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  return sanitized || "attachment.bin";
}

export function getProjectAttachmentDirectory(projectId: string): string {
  const normalizedProjectId = projectId.trim() || "shared";
  const targetDirectory = path.join(
    app.getPath("userData"),
    "runtime-attachments",
    encodeURIComponent(normalizedProjectId),
  );
  fs.mkdirSync(targetDirectory, { recursive: true });
  return targetDirectory;
}

export function getUniqueAttachmentPath(projectId: string, fileName: string): string {
  const safeFileName = sanitizeAttachmentFileName(fileName);
  const attachmentDirectory = getProjectAttachmentDirectory(projectId);
  const extension = path.extname(safeFileName);
  const stem = extension ? safeFileName.slice(0, -extension.length) : safeFileName;

  let candidate = path.join(attachmentDirectory, safeFileName);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(attachmentDirectory, `${stem}-${suffix}${extension}`);
    suffix += 1;
  }

  return candidate;
}

function buildPreviewDataUrl(
  image: NativeImage,
  options: PreviewDataUrlOptions = {},
): string | undefined {
  if (image.isEmpty()) {
    return undefined;
  }

  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0) {
    return undefined;
  }

  const maxDimension = Number.isFinite(options.maxDimension)
    ? Math.max(1, Math.round(Number(options.maxDimension)))
    : DEFAULT_MAX_PREVIEW_DIMENSION;
  const maxDataUrlChars = Number.isFinite(options.maxDataUrlChars)
    ? Math.max(128, Math.round(Number(options.maxDataUrlChars)))
    : DEFAULT_MAX_PREVIEW_DATA_URL_CHARS;
  const longestSide = Math.max(size.width, size.height);
  const shouldResize = longestSide > maxDimension;
  const preview = shouldResize
    ? image.resize({
        width: Math.max(1, Math.round(size.width * (maxDimension / longestSide))),
        height: Math.max(1, Math.round(size.height * (maxDimension / longestSide))),
      })
    : image;

  const requestedFormat = options.format === "jpeg" ? "jpeg" : "png";
  const jpegQuality = Number.isFinite(options.jpegQuality)
    ? Math.max(0, Math.min(100, Math.round(Number(options.jpegQuality))))
    : DEFAULT_JPEG_QUALITY;
  const dataUrl = requestedFormat === "jpeg"
    ? `data:image/jpeg;base64,${preview.toJPEG(jpegQuality).toString("base64")}`
    : preview.toDataURL();
  if (!dataUrl || dataUrl.length > maxDataUrlChars) {
    return undefined;
  }

  return dataUrl;
}

export function buildImagePreviewDataUrlFromPath(
  filePath: string,
  options?: PreviewDataUrlOptions,
): string | undefined {
  return buildPreviewDataUrl(nativeImage.createFromPath(filePath), options);
}

export function buildImagePreviewDataUrlFromNativeImage(
  image: NativeImage,
  options?: PreviewDataUrlOptions,
): string | undefined {
  return buildPreviewDataUrl(image, options);
}

export function createRunAttachmentFromPath(
  filePath: string,
  overrides: Partial<RunAttachment> = {},
): RunAttachment {
  const resolvedPath = path.resolve(filePath);
  const stats = fs.statSync(resolvedPath);
  const inferredKind = overrides.kind === "image" || isImageAttachment(resolvedPath) ? "image" : "file";

  return {
    id: overrides.id?.trim() || uuidv4(),
    name: overrides.name?.trim() || path.basename(resolvedPath),
    path: resolvedPath,
    size: Number.isFinite(overrides.size) ? Math.max(0, Number(overrides.size)) : (stats.isFile() ? stats.size : 0),
    kind: inferredKind,
    mimeType: overrides.mimeType?.trim() || guessMimeType(
      resolvedPath,
      inferredKind === "image" ? "image/*" : "application/octet-stream",
    ),
    previewDataUrl: overrides.previewDataUrl?.trim() || (
      inferredKind === "image" ? buildImagePreviewDataUrlFromPath(resolvedPath) : undefined
    ),
  };
}

import { gzipSync } from "zlib";
import { buildRelayApiHeaders } from "./api-version";

export const RELAY_JSON_GZIP_THRESHOLD_BYTES = 1024;

interface RelayJsonRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  gzipThresholdBytes?: number;
}

export function shouldCompressRelayJsonPayload(
  payloadByteLength: number,
  gzipThresholdBytes: number = RELAY_JSON_GZIP_THRESHOLD_BYTES,
): boolean {
  if (!Number.isFinite(payloadByteLength) || payloadByteLength <= 0) {
    return false;
  }
  if (!Number.isFinite(gzipThresholdBytes)) {
    return false;
  }
  if (gzipThresholdBytes <= 0) {
    return true;
  }
  return payloadByteLength >= gzipThresholdBytes;
}

export function createRelayJsonRequestInit(options: RelayJsonRequestOptions = {}): RequestInit & {
  headers: Record<string, string>;
} {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const headers = buildRelayApiHeaders({
    ...(options.headers ?? {}),
  });

  if (options.body === undefined) {
    return { method, headers };
  }

  const jsonPayload = JSON.stringify(options.body);
  const payloadBuffer = Buffer.from(jsonPayload);
  headers["Content-Type"] = "application/json";

  if (!shouldCompressRelayJsonPayload(payloadBuffer.byteLength, options.gzipThresholdBytes)) {
    return {
      method,
      headers,
      body: jsonPayload,
    };
  }

  return {
    method,
    headers: {
      ...headers,
      "Content-Encoding": "gzip",
    },
    body: gzipSync(payloadBuffer),
  };
}

export async function fetchRelayJson(url: string, options: RelayJsonRequestOptions = {}): Promise<Response> {
  return await fetch(url, createRelayJsonRequestInit(options));
}

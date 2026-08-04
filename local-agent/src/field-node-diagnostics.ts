import * as fs from "fs";
import * as os from "os";
import { FieldNodeProfile } from "./field-node-store";

export interface FieldNodeDiagnostics {
  collectedAt: number;
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  cpuCount: number;
  memoryTotalBytes: number;
  memoryFreeBytes: number;
  uptimeSeconds: number;
  nodeVersion: string;
  diskFreeBytes: number | null;
  diagnosticsNotice: string;
}

// Deliberately excludes environment variables, network addresses, usernames,
// processes, command history, project paths, and file contents.
export function collectFieldNodeDiagnostics(profile: FieldNodeProfile): FieldNodeDiagnostics | null {
  if (!profile.diagnosticsEnabled) {
    return null;
  }
  let diskFreeBytes: number | null = null;
  try {
    const statfs = fs.statfsSync(os.homedir());
    diskFreeBytes = Number(statfs.bavail) * Number(statfs.bsize);
  } catch {
    // statfs is not available on every Electron-supported platform.
  }
  return {
    collectedAt: Date.now(),
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuCount: os.cpus().length,
    memoryTotalBytes: os.totalmem(),
    memoryFreeBytes: os.freemem(),
    uptimeSeconds: Math.floor(os.uptime()),
    nodeVersion: process.version,
    diskFreeBytes,
    diagnosticsNotice: "Sanitized system snapshot. Secrets, environment variables, addresses, files, and command history are excluded.",
  };
}

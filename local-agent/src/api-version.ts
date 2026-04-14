import { app } from "electron";

export const RELAY_API_VERSION = "1";
export const RELAY_API_HEADER_VERSION = "X-AgentFlow-API-Version";
export const RELAY_API_HEADER_CLIENT = "X-AgentFlow-Client";
export const RELAY_API_HEADER_CLIENT_VERSION = "X-AgentFlow-Client-Version";
const RELAY_API_CLIENT_NAME = "desktop-local-agent";

export function getRelayApiClientVersion(): string {
  const version = typeof app?.getVersion === "function"
    ? app.getVersion()
    : process.env.npm_package_version?.trim();
  return version && version.length > 0 ? version : "0.0.0";
}

export function buildRelayApiHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return {
    ...headers,
    [RELAY_API_HEADER_VERSION]: RELAY_API_VERSION,
    [RELAY_API_HEADER_CLIENT]: RELAY_API_CLIENT_NAME,
    [RELAY_API_HEADER_CLIENT_VERSION]: getRelayApiClientVersion(),
  };
}

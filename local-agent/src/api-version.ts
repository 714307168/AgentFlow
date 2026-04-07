import { app } from "electron";

export const RELAY_API_VERSION = "1";
export const RELAY_API_HEADER_VERSION = "X-AgentFlow-API-Version";
export const RELAY_API_HEADER_CLIENT = "X-AgentFlow-Client";
export const RELAY_API_HEADER_CLIENT_VERSION = "X-AgentFlow-Client-Version";
const RELAY_API_CLIENT_NAME = "desktop-local-agent";

export function buildRelayApiHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return {
    ...headers,
    [RELAY_API_HEADER_VERSION]: RELAY_API_VERSION,
    [RELAY_API_HEADER_CLIENT]: RELAY_API_CLIENT_NAME,
    [RELAY_API_HEADER_CLIENT_VERSION]: app.getVersion(),
  };
}

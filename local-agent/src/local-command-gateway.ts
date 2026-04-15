export type LocalCommandGroup = "runtime" | "updates" | "diagnostics" | "storage";
export type LocalCommandPayloadSchema = "none" | "optionalPath";

export interface LocalCommandDescriptor {
  id: string;
  title: string;
  group: LocalCommandGroup;
  payloadSchema: LocalCommandPayloadSchema;
}

export interface LocalCommandRequest {
  commandId: string;
  payload?: unknown;
}

export interface LocalCommandGatewayResult<T = unknown> {
  success: boolean;
  commandId: string;
  data?: T;
  error?: string;
}

interface LocalCommandDefinition extends LocalCommandDescriptor {
  run: (payload: unknown) => Promise<unknown> | unknown;
}

const NO_PAYLOAD_SCHEMA: LocalCommandPayloadSchema = "none";
const OPTIONAL_PATH_SCHEMA: LocalCommandPayloadSchema = "optionalPath";

function normalizeCommandId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateNoPayload(payload: unknown): undefined {
  if (payload === undefined || payload === null) {
    return undefined;
  }
  throw new Error("This local command does not accept a payload.");
}

function validateOptionalPathPayload(payload: unknown): string | undefined {
  if (payload === undefined || payload === null) {
    return undefined;
  }
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed || undefined;
  }
  if (typeof payload === "object" && !Array.isArray(payload)) {
    const candidate = "currentPath" in payload
      ? (payload as { currentPath?: unknown }).currentPath
      : ("path" in payload ? (payload as { path?: unknown }).path : undefined);
    if (candidate === undefined || candidate === null) {
      return undefined;
    }
    if (typeof candidate !== "string") {
      throw new Error("The local command path payload must be a string.");
    }
    const trimmed = candidate.trim();
    return trimmed || undefined;
  }
  throw new Error("The local command path payload must be a string or object.");
}

function validatePayload(schema: LocalCommandPayloadSchema, payload: unknown): unknown {
  if (schema === OPTIONAL_PATH_SCHEMA) {
    return validateOptionalPathPayload(payload);
  }
  return validateNoPayload(payload);
}

export function createLocalCommandGateway(definitions: LocalCommandDefinition[]) {
  const registry = new Map(definitions.map((definition) => [definition.id, definition] as const));
  const descriptors: LocalCommandDescriptor[] = definitions.map(({ id, title, group, payloadSchema }) => ({
    id,
    title,
    group,
    payloadSchema,
  }));

  return {
    listCommands(): LocalCommandDescriptor[] {
      return descriptors.map((entry) => ({ ...entry }));
    },
    async runCommand<T = unknown>(request: LocalCommandRequest): Promise<LocalCommandGatewayResult<T>> {
      const commandId = normalizeCommandId(request?.commandId);
      if (!commandId) {
        return {
          success: false,
          commandId: "",
          error: "Local command id is required.",
        };
      }
      const definition = registry.get(commandId);
      if (!definition) {
        return {
          success: false,
          commandId,
          error: `Unknown local command: ${commandId}`,
        };
      }

      try {
        const payload = validatePayload(definition.payloadSchema, request?.payload);
        const data = await definition.run(payload as never);
        return {
          success: true,
          commandId,
          data: data as T,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "Unknown local command failure");
        return {
          success: false,
          commandId,
          error: message,
        };
      }
    },
  };
}

export function defineLocalCommand(
  definition: Omit<LocalCommandDefinition, "payloadSchema"> & {
    payloadSchema?: LocalCommandPayloadSchema;
  },
): LocalCommandDefinition {
  return {
    ...definition,
    payloadSchema: definition.payloadSchema ?? NO_PAYLOAD_SCHEMA,
  };
}

export const CACHED_SECRET_PLACEHOLDER = "__cached__";

function normalizeSecretValue(value?: string | null): string {
  return typeof value === "string" ? value : "";
}

export function isCachedSecretPlaceholder(value?: string | null): boolean {
  return normalizeSecretValue(value) === CACHED_SECRET_PLACEHOLDER;
}

export function hasStoredSecretValue(storedValue?: string | null, decodedValue?: string | null): boolean {
  return normalizeSecretValue(storedValue).trim().length > 0 || normalizeSecretValue(decodedValue).trim().length > 0;
}

export function toPublicSecretFieldValue(storedValue?: string | null, decodedValue?: string | null): string {
  return hasStoredSecretValue(storedValue, decodedValue) ? CACHED_SECRET_PLACEHOLDER : "";
}

export function normalizeSecretInputForSave(value?: string | null): { shouldUpdate: boolean; nextValue: string } {
  const normalized = normalizeSecretValue(value);
  if (isCachedSecretPlaceholder(normalized)) {
    return {
      shouldUpdate: false,
      nextValue: "",
    };
  }
  return {
    shouldUpdate: true,
    nextValue: normalized,
  };
}

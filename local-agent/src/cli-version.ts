function firstNonEmptyLine(value: string): string | null {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => Boolean(line)) || null;
}

export function normalizeCliVersionOutput(stdout: string, stderr = ""): string | null {
  return firstNonEmptyLine(String(stdout ?? "") + "\n" + String(stderr ?? ""));
}

export function extractSemanticVersion(rawVersion: string | null | undefined): string | null {
  const match = String(rawVersion ?? "").match(/(\d+\.\d+\.\d+)/u);
  return match ? match[1] : null;
}

export function compareSemanticVersions(
  leftRaw: string | null | undefined,
  rightRaw: string | null | undefined,
): number | null {
  const left = extractSemanticVersion(leftRaw);
  const right = extractSemanticVersion(rightRaw);
  if (!left || !right) {
    return null;
  }

  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart === rightPart) {
      continue;
    }
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function shouldRecommendVersionUpgrade(
  currentVersionRaw: string | null | undefined,
  latestVersionRaw: string | null | undefined,
): boolean {
  const latestLine = firstNonEmptyLine(String(latestVersionRaw ?? ""));
  if (!latestLine) {
    return false;
  }

  const semanticComparison = compareSemanticVersions(currentVersionRaw, latestLine);
  if (semanticComparison !== null) {
    return semanticComparison < 0;
  }

  const currentLine = firstNonEmptyLine(String(currentVersionRaw ?? ""));
  if (!currentLine) {
    return true;
  }
  return currentLine !== latestLine;
}

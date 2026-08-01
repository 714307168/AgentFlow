export type WorkgroupTaskAcceptanceStatus = "pending" | "passed" | "failed";

export interface WorkgroupTaskEvidence {
  artifactSummary: string | null;
  validationEvidence: string | null;
}

const MAX_EVIDENCE_LENGTH = 4_000;

function normalizeEvidence(value: string): string | null {
  const normalized = value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return normalized ? normalized.slice(0, MAX_EVIDENCE_LENGTH) : null;
}

function readLabeledSection(text: string, labels: string[]): string | null {
  const labelPattern = labels.join("|");
  const nextLabelPattern = "Outcome|Artifacts?|Changed files?|Validation|Tests?|Blockers?|Handoff|结果|产物|改动|验证|测试|阻塞|交接";
  const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${nextLabelPattern})\\s*[:：]|$)`, "i"));
  return match ? normalizeEvidence(match[1]) : null;
}

export function extractWorkgroupTaskEvidence(response: string): WorkgroupTaskEvidence {
  const normalized = String(response ?? "").trim();
  if (!normalized) {
    return { artifactSummary: null, validationEvidence: null };
  }
  return {
    artifactSummary: readLabeledSection(normalized, ["Artifacts?", "Changed files?", "产物", "改动"]),
    validationEvidence: readLabeledSection(normalized, ["Validation", "Tests?", "验证", "测试"]),
  };
}

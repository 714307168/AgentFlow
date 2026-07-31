import { WorkgroupMemberSpecialty } from "./workgroup-store";

export interface WorkgroupAssignmentCandidate {
  id: string;
  name: string;
  specialty: WorkgroupMemberSpecialty;
  projectId?: string | null;
  projectExists: boolean;
  projectOnline: boolean;
}

export interface WorkgroupTaskAssigneeRecommendation {
  memberId: string;
  memberName: string;
  specialty: WorkgroupMemberSpecialty;
  reason: string;
}

type SpecialtyRule = {
  specialty: Exclude<WorkgroupMemberSpecialty, "general">;
  label: string;
  keywords: string[];
};

const SPECIALTY_RULES: SpecialtyRule[] = [
  {
    specialty: "planner",
    label: "planning and design",
    keywords: ["plan", "planning", "design", "architecture", "spec", "roadmap", "规划", "设计", "架构", "方案", "拆解"],
  },
  {
    specialty: "implementer",
    label: "implementation",
    keywords: ["implement", "code", "feature", "fix", "refactor", "build", "开发", "实现", "修复", "编码", "重构", "功能"],
  },
  {
    specialty: "reviewer",
    label: "review",
    keywords: ["review", "audit", "inspect", "approval", "code review", "审查", "评审", "代码审查", "检查"],
  },
  {
    specialty: "tester",
    label: "testing and verification",
    keywords: ["test", "qa", "verify", "validate", "smoke", "regression", "测试", "验证", "回归"],
  },
  {
    specialty: "researcher",
    label: "research and investigation",
    keywords: ["research", "investigate", "analysis", "explore", "调研", "研究", "分析", "排查", "探索"],
  },
];

function countMatches(text: string, keywords: string[]): number {
  return keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
}

function isAvailable(candidate: WorkgroupAssignmentCandidate): boolean {
  return Boolean(candidate.projectId && candidate.projectExists && candidate.projectOnline);
}

export function recommendWorkgroupTaskAssignee(
  task: Pick<{ title?: string | null; description?: string | null; acceptanceCriteria?: string | null }, "title" | "description" | "acceptanceCriteria">,
  candidates: WorkgroupAssignmentCandidate[],
): WorkgroupTaskAssigneeRecommendation | null {
  const text = [task.title, task.description, task.acceptanceCriteria]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join("\n");
  const availableCandidates = candidates.filter(isAvailable);
  if (!availableCandidates.length) {
    return null;
  }

  const matchedRules = SPECIALTY_RULES
    .map((rule) => ({ rule, matches: countMatches(text, rule.keywords) }))
    .filter(({ matches }) => matches > 0);
  const specialtyScore = new Map<WorkgroupMemberSpecialty, number>(
    matchedRules.map(({ rule, matches }) => [rule.specialty, matches]),
  );
  const recommended = [...availableCandidates].sort((left, right) => {
    const leftScore = specialtyScore.get(left.specialty) ?? (left.specialty === "general" ? 0.5 : 0);
    const rightScore = specialtyScore.get(right.specialty) ?? (right.specialty === "general" ? 0.5 : 0);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return left.name.localeCompare(right.name, "zh-CN");
  })[0];

  if (!recommended) {
    return null;
  }
  const matchedRule = SPECIALTY_RULES.find((rule) => rule.specialty === recommended.specialty);
  return {
    memberId: recommended.id,
    memberName: recommended.name,
    specialty: recommended.specialty,
    reason: matchedRule && specialtyScore.has(matchedRule.specialty)
      ? `Matches ${matchedRule.label}.`
      : "Available generalist fallback.",
  };
}

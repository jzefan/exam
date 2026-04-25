export type OrgKind = "school" | "enterprise";
export type BusinessRole = "evaluator" | "assessee";

const ROLE_LABELS: Record<OrgKind, Record<BusinessRole, string>> = {
  school: { evaluator: "教师", assessee: "学生" },
  enterprise: { evaluator: "HR", assessee: "候选人" },
};

export function displayRole(orgKind: OrgKind, role: BusinessRole): string {
  return ROLE_LABELS[orgKind][role];
}

export function displayAssesseeNoun(orgKind: OrgKind): string {
  return ROLE_LABELS[orgKind].assessee;
}

export function displayEvaluatorNoun(orgKind: OrgKind): string {
  return ROLE_LABELS[orgKind].evaluator;
}

import type { QuestionDisplayType } from "@/types";

export interface ExpansionCandidate {
  id: string;
  displayType: QuestionDisplayType | null;
}

/**
 * 按当前试卷的题型分布，从候选题目里挑出需要补充的题目。
 *
 * - 目标题数 = target，现有题数 = current.length，需要补充 target - current.length；
 * - 先按现有题型占比分配名额（最大余数），再按候选顺序取题；
 * - 某个题型候选不足时，用剩余候选补齐，保证尽量接近目标题数。
 */
export function allocateExpansionQuestionIds(
  currentTypes: Array<QuestionDisplayType | null>,
  candidates: ExpansionCandidate[],
  target: number,
): string[] {
  const need = Math.floor(target) - currentTypes.length;
  if (need <= 0) return [];

  const pools = new Map<QuestionDisplayType, ExpansionCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.displayType) continue;
    const pool = pools.get(candidate.displayType) ?? [];
    pool.push(candidate);
    pools.set(candidate.displayType, pool);
  }

  const picked: string[] = [];
  const used = new Set<string>();
  const currentCounts = new Map<QuestionDisplayType, number>();
  for (const type of currentTypes) {
    if (!type) continue;
    currentCounts.set(type, (currentCounts.get(type) ?? 0) + 1);
  }

  if (currentCounts.size > 0) {
    const total = [...currentCounts.values()].reduce((sum, n) => sum + n, 0);
    const entries = [...currentCounts.entries()];
    const quotas = entries.map(([, count], index) => {
      const exact = (count / total) * need;
      return {
        index,
        type: entries[index][0],
        base: Math.floor(exact),
        remainder: exact - Math.floor(exact),
      };
    });
    let assigned = quotas.reduce((sum, quota) => sum + quota.base, 0);
    const byRemainder = [...quotas].sort((a, b) => b.remainder - a.remainder);
    let cursor = 0;
    while (assigned < need && byRemainder.length > 0) {
      const quota = byRemainder[cursor % byRemainder.length];
      quota.base += 1;
      assigned += 1;
      cursor += 1;
    }
    for (const quota of quotas) {
      if (quota.base <= 0) continue;
      const pool = pools.get(quota.type) ?? [];
      for (const candidate of pool) {
        if (quota.base <= 0) break;
        if (used.has(candidate.id)) continue;
        used.add(candidate.id);
        picked.push(candidate.id);
        quota.base -= 1;
      }
    }
  }

  // 题型名额没用完（候选不足 / 试卷原本没有题）时，用剩余候选补齐。
  if (picked.length < need) {
    for (const candidate of candidates) {
      if (picked.length >= need) break;
      if (used.has(candidate.id)) continue;
      used.add(candidate.id);
      picked.push(candidate.id);
    }
  }

  return picked;
}

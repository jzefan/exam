import type { IKnowledgePointDetail } from "./types";

export function getReadOnlyKnowledgeFeedback(node?: IKnowledgePointDetail | null): string {
  if (node?.parent_id == null) {
    return "这是公共主知识/技能，不能修改或删除，但你可以在它下面添加自己的补充知识。";
  }
  return "这是公共知识点，不能修改或删除，但你可以在它下面添加自己的补充知识。";
}

export function getReadOnlyMajorFeedback(): string {
  return "这是公共专业，不能修改或删除。你可以在该专业下继续使用公开结构，并补充自己的知识内容。";
}

export function getReadOnlyDirectionFeedback(): string {
  return "这是公共方向，不能修改或删除。你可以在该方向下添加自己的主知识和补充知识。";
}

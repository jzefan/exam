export interface IKnowledgePointDetail {
  [key: string]: unknown;
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  difficulty: string | null;
  parent_id: string | null;
  direction_id: string | null;
  owner_id?: string;
  visibility?: "private" | "platform";
  question_count: number;
}

export interface IMajor {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface IDirection {
  id: string;
  major_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface IFlowData {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: IKnowledgePointDetail }>;
  edges: Array<{ id: string; source: string; target: string; type: string }>;
}

export type AIRecommendationModel = "deepseek" | "qwen" | "kimi";

export interface IRecommendationItem {
  title: string;
  description: string;
  url: string;
  source: string;
}

export type Difficulty = "入门" | "初级" | "中级" | "高级" | "困难";

export const DIFFICULTY_COLORS: Record<Difficulty, { bg: string; text: string }> = {
  入门: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-700 dark:text-yellow-400" },
  初级: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-400" },
  中级: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400" },
  高级: { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-400" },
  困难: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-400" },
};

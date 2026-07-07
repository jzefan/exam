export async function paperApiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("access_token");
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text || `请求失败: ${response.status}`;
    try {
      const payload = JSON.parse(text) as { detail?: string };
      if (payload?.detail) {
        message = payload.detail;
      }
    } catch {
      // body is plain text or empty; use text as-is
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export type PaperDifficultyStrategy = "similar" | "easier" | "harder";

export function getDifficultyStrategyLabel(strategy: PaperDifficultyStrategy): string {
  return {
    similar: "接近原卷",
    easier: "略降",
    harder: "略升",
  }[strategy];
}

export const PAPER_SOURCE_REUSE_RATE_OPTIONS = [0, 20, 40, 60] as const;
export type PaperSourceReuseRate = (typeof PAPER_SOURCE_REUSE_RATE_OPTIONS)[number];

export type GeneratePaperFromSourcePayload = {
  count: 1;
  difficulty_strategy: PaperDifficultyStrategy;
  question_type_strategy: "inherit";
  prefer_root_knowledge_point: boolean;
  source_reuse_rate: number;
};

export type GeneratePaperFromSourceResult = {
  paper_id: string;
  generated_question_count: number;
};

export async function generatePaperFromSource(
  paperId: string,
  payload: GeneratePaperFromSourcePayload,
): Promise<GeneratePaperFromSourceResult> {
  return paperApiRequest<GeneratePaperFromSourceResult>(`/papers/${paperId}/ai-generate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type AppendPaperQuestionsWithAIRequest = {
  question_count: number;
  difficulty_strategy: PaperDifficultyStrategy;
  prefer_root_knowledge_point: boolean;
  model?: "qwen" | "deepseek" | "claude";
  question_bank_id?: string;
};

export async function appendPaperQuestionsWithAI<TPaperDetail>(
  paperId: string,
  payload: AppendPaperQuestionsWithAIRequest,
): Promise<TPaperDetail> {
  return paperApiRequest<TPaperDetail>(`/papers/${paperId}/ai-append`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

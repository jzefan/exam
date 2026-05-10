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
    let message = `请求失败: ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload?.detail) {
        message = payload.detail;
      }
    } catch {
      const text = await response.text();
      if (text) {
        message = text;
      }
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

export type GeneratePaperFromSourcePayload = {
  count: 1;
  difficulty_strategy: PaperDifficultyStrategy;
  question_type_strategy: "inherit";
  prefer_root_knowledge_point: boolean;
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

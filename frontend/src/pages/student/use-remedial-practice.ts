import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { apiClient } from "@/lib/api";
import type { IRemedialPracticeAnalysis } from "./wrong-answer-shared";

function readErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return "";
}

/**
 * 拉取某个考试/练习的「可练习知识点 + 已生成的强化练习」。
 * `enabled` 为 false 时不请求（错题本分组还没确定时）。
 */
export function useRemedialPracticeAnalysis(sourceKey: string, enabled = true) {
  const [analysis, setAnalysis] = useState<IRemedialPracticeAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) return;
      setIsLoading(true);
      setError("");
      try {
        const response = await apiClient.get<IRemedialPracticeAnalysis>(
          `/api/wrong-answers/practice-analysis/${sourceKey}`,
          { signal },
        );
        if (!signal?.aborted) setAnalysis(response.data);
      } catch (requestError) {
        if (signal?.aborted) return;
        setAnalysis(null);
        setError(readErrorMessage(requestError));
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [enabled, sourceKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { analysis, isLoading, error, reload: () => void load() };
}

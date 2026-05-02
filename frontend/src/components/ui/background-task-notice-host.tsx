import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { LoaderCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  dismissBackgroundTaskNotice,
  upsertBackgroundTaskNotice,
  useBackgroundTaskNoticeState,
} from "@/hooks/use-background-task-notice";
import type { QuestionImportJobResponse } from "@/pages/questions/import-types";
import {
  clearPersistedQuestionImportJobId,
  isTerminalQuestionImportJobStatus,
  QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_DESCRIPTION,
  QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_ID,
  QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_PAGE_PATH,
  readPersistedQuestionImportJobId,
} from "@/pages/questions/question-knowledge-recognition";

const QUESTION_IMPORT_JOB_POLL_INTERVAL_MS = 2000;

async function fetchQuestionImportJob(jobId: string): Promise<QuestionImportJobResponse> {
  const token = localStorage.getItem("access_token");
  const response = await fetch(`/api/questions/import/jobs/${jobId}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Question import job polling failed: ${response.status}`);
  }

  return response.json() as Promise<QuestionImportJobResponse>;
}

export function BackgroundTaskNoticeHost() {
  const location = useLocation();
  const { notices, subscribe } = useBackgroundTaskNoticeState();

  useEffect(() => {
    return subscribe();
  }, [subscribe]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const pollQuestionImportJob = async () => {
      const jobId = readPersistedQuestionImportJobId();
      if (!jobId) {
        timer = window.setTimeout(pollQuestionImportJob, QUESTION_IMPORT_JOB_POLL_INTERVAL_MS);
        return;
      }

      try {
        const job = await fetchQuestionImportJob(jobId);
        if (cancelled) return;

        if (isTerminalQuestionImportJobStatus(job.status)) {
          clearPersistedQuestionImportJobId();
          dismissBackgroundTaskNotice(QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_ID);
          return;
        }

        upsertBackgroundTaskNotice({
          id: QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_ID,
          title: "知识点正在后台识别",
          progressText: `${job.processed_count}/${job.total_count}`,
          description: QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_DESCRIPTION,
          pagePath: QUESTION_KNOWLEDGE_RECOGNITION_NOTICE_PAGE_PATH,
        });
      } catch {
        if (cancelled) return;
      }

      timer = window.setTimeout(pollQuestionImportJob, QUESTION_IMPORT_JOB_POLL_INTERVAL_MS);
    };

    void pollQuestionImportJob();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  return (
    <>
      {notices.map((notice) => {
        const isOnSourcePage = Boolean(notice.pagePath && location.pathname === notice.pagePath);
        const position = isOnSourcePage ? "center" : "floating";

        return (
          <div
            key={notice.id}
            data-position={position}
            data-testid={`background-task-notice-${notice.id}`}
            className={cn(
              "pointer-events-none fixed z-[95]",
              isOnSourcePage
                ? "left-1/2 top-6 w-[min(92vw,760px)] -translate-x-1/2"
                : "bottom-6 right-6 w-[min(92vw,360px)]",
            )}
          >
            <Alert
              variant="warning"
              className={cn(
                "pointer-events-auto rounded-[28px] border-amber-300 bg-amber-50/98 px-5 py-4 text-amber-900 shadow-[0_24px_60px_rgba(180,83,9,0.18)] backdrop-blur",
                isOnSourcePage ? "min-h-[92px]" : "rounded-2xl px-4 py-3",
              )}
            >
              <LoaderCircle className="mt-0.5 h-5 w-5 animate-spin text-amber-600" />
              <div className={cn("pl-7", isOnSourcePage ? "space-y-2" : "space-y-1.5")}>
                <div className="flex items-center gap-2">
                  <AlertTitle className={cn("mb-0 text-base font-semibold", !isOnSourcePage && "text-sm")}>
                    {notice.title}
                  </AlertTitle>
                  {notice.progressText ? (
                    <span className="rounded-full border border-amber-300 bg-white/80 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                      {notice.progressText}
                    </span>
                  ) : null}
                </div>
                <AlertDescription className={cn("text-sm leading-6 text-amber-800", !isOnSourcePage && "text-xs")}>
                  {notice.description}
                </AlertDescription>
              </div>
            </Alert>
          </div>
        );
      })}
    </>
  );
}

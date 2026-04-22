import { describe, expect, it } from "vitest";

import type { QuestionImportJobResponse } from "./import-types";
import { getQuestionKnowledgeRecognitionStatus } from "./question-knowledge-recognition";

const runningJob: QuestionImportJobResponse = {
  id: "job-1",
  user_id: "user-1",
  status: "running",
  total_count: 3,
  processed_count: 1,
  matched_count: 1,
  unmatched_count: 0,
  failed_count: 0,
  created_question_ids: ["q-1", "q-2", "q-3"],
  error_message: null,
  created_at: "2026-04-21T00:00:00Z",
  updated_at: "2026-04-21T00:00:00Z",
  completed_at: null,
};

describe("getQuestionKnowledgeRecognitionStatus", () => {
  it("marks the current question as running and later questions as waiting", () => {
    expect(getQuestionKnowledgeRecognitionStatus("q-2", runningJob)).toBe("running");
    expect(getQuestionKnowledgeRecognitionStatus("q-3", runningJob)).toBe("waiting");
  });

  it("hides the status for already processed questions and terminal jobs", () => {
    expect(getQuestionKnowledgeRecognitionStatus("q-1", runningJob)).toBeNull();
    expect(
      getQuestionKnowledgeRecognitionStatus("q-3", {
        ...runningJob,
        status: "completed",
        processed_count: 3,
        completed_at: "2026-04-21T00:10:00Z",
      }),
    ).toBeNull();
  });
});

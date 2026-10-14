import { beforeEach, describe, expect, it } from "vitest";

import {
  clearRecentGradingTask,
  readRecentGradingTask,
  recentGradingTaskHref,
  rememberRecentGradingTask,
} from "./recent-task";

function signInAs(id: string) {
  localStorage.setItem("user", JSON.stringify({ id, primary_org: { role_name: "teacher" } }));
}

beforeEach(() => localStorage.clear());

describe("recent grading task", () => {
  it("keeps each teacher's task separate and builds a resumable link", () => {
    signInAs("teacher-a");
    rememberRecentGradingTask({
      taskId: "task-a",
      title: "简答题 · 张三",
      questionRef: "exam-a::q-1",
      mode: "question",
    });
    const task = readRecentGradingTask();
    expect(task?.taskId).toBe("task-a");
    expect(recentGradingTaskHref(task!)).toBe("/grading?taskId=task-a&mode=question&questionRef=exam-a%3A%3Aq-1");

    signInAs("teacher-b");
    expect(readRecentGradingTask()).toBeNull();
    signInAs("teacher-a");
    clearRecentGradingTask("some-other-task");
    expect(readRecentGradingTask()?.taskId).toBe("task-a");
    clearRecentGradingTask("task-a");
    expect(readRecentGradingTask()).toBeNull();
  });
});

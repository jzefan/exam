import type { ViewSettingsValues } from "./components/ExamSettingsPanel";

export function buildExamSettingsUpdate(
  category: "exam" | "practice",
  settings: ViewSettingsValues,
) {
  return category === "practice"
    ? {
        show_result: settings.show_result,
        show_score: settings.show_score,
        allow_retake: settings.allow_retake,
      }
    : {
        max_switch_count: settings.max_switch_count,
        show_result: settings.show_result,
        allow_retake: settings.allow_retake,
        show_score: settings.show_score,
      };
}

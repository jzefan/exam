/**
 * FastAPI errors arrive as a JSON string such as `{"detail":"同校已存在同名班级"}`.
 * Surface the human-readable detail instead of the raw payload.
 */
export function getApiErrorMessage(error: unknown, fallback = "请稍后重试"): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(error.message) as { detail?: unknown; message?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail;
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // Not a JSON error body; use the original message below.
  }
  return error.message || fallback;
}

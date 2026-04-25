let token: string | null = null;
let examId: string | null = null;

export function setGuestSession(nextToken: string, nextExamId: string): void {
  token = nextToken;
  examId = nextExamId;
  sessionStorage.setItem("exam_guest_token", nextToken);
  sessionStorage.setItem("exam_guest_exam_id", nextExamId);
}

export function getGuestToken(): string | null {
  return token ?? sessionStorage.getItem("exam_guest_token");
}

export function getGuestExamId(): string | null {
  return examId ?? sessionStorage.getItem("exam_guest_exam_id");
}

export function clearGuestSession(): void {
  token = null;
  examId = null;
  sessionStorage.removeItem("exam_guest_token");
  sessionStorage.removeItem("exam_guest_exam_id");
}

/**
 * Returns the current actor's principal ID and type for use with exam drafts.
 *
 * Works for both authenticated students and external guest candidates
 * (who have a different identity source but still need draft namespacing).
 */
export type ExamPrincipalType = "student" | "external_guest";

export interface ExamPrincipal {
  id: string;
  type: ExamPrincipalType;
}

function getStudentPrincipal(): ExamPrincipal | null {
  try {
    const u = localStorage.getItem("user");
    if (!u) return null;
    const parsed = JSON.parse(u) as { id?: string };
    if (!parsed?.id) return null;
    return { id: parsed.id, type: "student" };
  } catch {
    return null;
  }
}

function getGuestPrincipal(): ExamPrincipal | null {
  try {
    const token = localStorage.getItem("access_token");
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]!));
    const sub = payload?.sub as string | undefined;
    if (!sub) return null;
    return { id: sub, type: "external_guest" };
  } catch {
    return null;
  }
}

export function useExamPrincipal(): ExamPrincipal | null {
  return getStudentPrincipal() ?? getGuestPrincipal();
}

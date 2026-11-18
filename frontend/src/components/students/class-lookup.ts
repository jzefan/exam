import { apiRequest } from "@/pages/grading/api";

import type { StudentImportClassLookup } from "./student-import-utils";

interface ClassLookupResponse {
  items?: StudentImportClassLookup[];
}

/**
 * Resolve class names against the caller's whole school.
 * The regular class list is teacher-scoped, so this is the only reliable way to
 * find a same-named class created by a colleague before importing a roster.
 */
export async function lookupStudentImportClasses(
  names: string[],
): Promise<StudentImportClassLookup[]> {
  const uniqueNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (uniqueNames.length === 0) {
    return [];
  }

  const response = await apiRequest<ClassLookupResponse>("/rbac/students/classes/resolve", {
    method: "POST",
    body: JSON.stringify({ names: uniqueNames }),
  });
  return response.items ?? [];
}

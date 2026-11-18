import { createContext, useContext } from "react";

export interface CourseWorkspace {
  courseId: string;
  courseName: string;
  shareCode: string;
}

export const CourseWorkspaceContext = createContext<CourseWorkspace | null>(
  null,
);
export const useCourseWorkspace = () => useContext(CourseWorkspaceContext);

/** Router basename keeps every existing teaching page inside the course URL. */
export function courseWorkspaceEntry(pathname: string) {
  const match = pathname.match(/^\/(c|course-share)\/([a-zA-Z0-9_-]+)(?:\/|$)/);
  return match
    ? { basePath: `/${match[1]}/${match[2]}`, shareCode: match[2] }
    : null;
}

export function safeCourseReturnTo(value: string | null, fallback = "/") {
  return value?.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/^\/(login|register)(?:[/?#]|$)/.test(value)
    ? value
    : fallback;
}

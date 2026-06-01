export const DEFAULT_MAJOR_NAME = "default-prof";
export const DEFAULT_MAJOR_DISPLAY_NAME = "默认专业";

export function formatMajorName(name: string | null | undefined): string {
  return name === DEFAULT_MAJOR_NAME ? DEFAULT_MAJOR_DISPLAY_NAME : (name ?? "");
}

export function formatKnowledgeDisplayPath(path: string | null | undefined): string {
  return (path ?? "")
    .split("/")
    .map((part) => {
      const trimmed = part.trim();
      return trimmed === DEFAULT_MAJOR_NAME ? DEFAULT_MAJOR_DISPLAY_NAME : trimmed;
    })
    .filter(Boolean)
    .join(" / ");
}

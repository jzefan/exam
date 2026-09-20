import { apiRequest } from "@/pages/grading/api";

import type { KnowledgeImportPath } from "./import-knowledge-utils";

export type CatalogWebBookInfo = {
  title: string;
  edition: string;
  author: string;
  publisher: string;
};

export type CatalogWebCandidate = {
  title: string;
  url: string;
  author: string;
  publisher: string;
  publish_date: string;
  edition: string;
  price: string;
  source: string;
};

/** `publisher_site`：抓自出版社官网；`llm`：由大模型推断。 */
export type CatalogWebSource = "publisher_site" | "llm";

export type CatalogWebFetchResult = {
  paths: KnowledgeImportPath[];
  source: CatalogWebSource;
  source_url: string;
  publisher_site: string;
  notes: string;
};

export const EMPTY_CATALOG_WEB_BOOK: CatalogWebBookInfo = {
  title: "",
  edition: "",
  author: "",
  publisher: "",
};

export async function recognizeCatalogCover(payload: {
  image: string;
  fileName?: string;
}): Promise<CatalogWebBookInfo> {
  const response = await apiRequest<Partial<CatalogWebBookInfo>>(
    "/knowledge/catalog-web/recognize-cover",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: payload.image, file_name: payload.fileName }),
    },
  );
  return { ...EMPTY_CATALOG_WEB_BOOK, ...response };
}

export async function searchCatalogBooks(payload: {
  keyword: string;
  limit?: number;
}): Promise<CatalogWebCandidate[]> {
  const response = await apiRequest<{ candidates: CatalogWebCandidate[] }>(
    "/knowledge/catalog-web/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: payload.keyword, limit: payload.limit ?? 8 }),
    },
  );
  return response.candidates ?? [];
}

export async function fetchCatalogFromWeb(
  payload: CatalogWebBookInfo,
): Promise<CatalogWebFetchResult> {
  return apiRequest<CatalogWebFetchResult>("/knowledge/catalog-web/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: payload.title,
      edition: payload.edition || undefined,
      author: payload.author || undefined,
      publisher: payload.publisher || undefined,
    }),
  });
}

/** 把 FastAPI 的 `{"detail": "..."}` 错误体还原成可读文案。 */
export function extractErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : "";
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart)) as { detail?: unknown };
      if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        return parsed.detail.trim();
      }
    } catch {
      // 不是 JSON 错误体时退回原文。
    }
  }
  return trimmed || fallback;
}

/** 从 `2017-01-01` 这类出版日期里取年份；取不到返回空串。 */
export function formatPublishYear(publishDate: string): string {
  const match = publishDate.match(/(\d{4})/);
  return match ? match[1] : "";
}

/** 把目录树拍平成可编辑文本：每行一条路径，层级用 ` > ` 分隔。 */
export function pathsToEditableText(paths: KnowledgeImportPath[]): string {
  return paths.map((path) => path.join(" > ")).join("\n");
}

/** 解析编辑文本回目录树；空行、单段行之外的重复路径都会被丢弃。 */
export function editableTextToPaths(text: string): KnowledgeImportPath[] {
  const seen = new Set<string>();
  const paths: KnowledgeImportPath[] = [];
  for (const rawLine of text.split("\n")) {
    const segments = rawLine
      .split(/\s*(?:>|＞|→|➜|⟶)\s*/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (segments.length === 0) continue;
    const key = segments.join(" > ");
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(segments);
  }
  return paths;
}

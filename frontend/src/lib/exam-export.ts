import { apiClient } from "@/lib/api";

export type ExamExportFormat = "docx" | "pdf";
export type ExportPaperFormat = ExamExportFormat;

/** Parse a Content-Disposition header, preferring the RFC 5987 UTF-8 form. */
function parseContentDispositionFilename(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* fall through to the plain filename */
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain?.[1] ?? null;
}

async function downloadPaperExport(
  endpoint: string,
  fallbackFilename: string,
  options: { format: ExportPaperFormat; answers: boolean },
): Promise<void> {
  const response = await apiClient.get(endpoint, {
    params: { format: options.format, answers: options.answers },
    responseType: "blob",
  });
  const blob = response.data as Blob;
  const filename =
    parseContentDispositionFilename(response.headers["content-disposition"]) ??
    fallbackFilename;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Download an exam as a standard-format paper. Streams the file as a blob
 * (authenticated via apiClient) and triggers a browser download with the
 * server-provided filename.
 */
export async function exportExam(
  examId: string,
  options: { format: ExamExportFormat; answers: boolean },
): Promise<void> {
  await downloadPaperExport(
    `/api/exams/${examId}/export`,
    `exam.${options.format}`,
    options,
  );
}

export async function exportPaper(
  paperId: string,
  options: { format: ExportPaperFormat; answers: boolean },
): Promise<void> {
  await downloadPaperExport(
    `/api/papers/${paperId}/export`,
    `paper.${options.format}`,
    options,
  );
}

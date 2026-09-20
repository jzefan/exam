import { afterEach, describe, expect, it, vi } from "vitest";

import type { ImportDocumentPayload } from "./recognize";
import {
  PAPER_IMPORT_MAX_FILE_SIZE_BYTES,
  extractPaperImportPayload,
  recognizePaperPayload,
} from "./recognize";

const extractQuestionImportPayloadMock = vi.hoisted(() => vi.fn());

vi.mock("@/pages/questions/import-utils", () => ({
  extractQuestionImportPayload: extractQuestionImportPayloadMock,
}));

function makePaperResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return new Response(
    JSON.stringify({
      session_id: "session-1",
      mode: "smart",
      summary: {
        total: 0,
        duplicates_removed: 0,
        high_confidence: 0,
        medium_confidence: 0,
        low_confidence: 0,
        issue_count: 0,
        pending_review: 0,
        approved: 0,
        skipped: 0,
      },
      drafts: [],
      ...overrides,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function makePdfPayload(): ImportDocumentPayload {
  const file = new File(["%PDF fake content"], "sql-paper.pdf", {
    type: "application/pdf",
  });
  return {
    fileName: file.name,
    rawText: file.name,
    sourceFormat: "pdf",
    images: [],
    tables: [],
    originalFile: file,
  };
}

function makeDocxFile(): File {
  return new File(["docx fake content"], "sql-paper.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

describe("recognizePaperPayload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    extractQuestionImportPayloadMock.mockReset();
    localStorage.clear();
  });

  it("allows import files up to 40MB", () => {
    expect(PAPER_IMPORT_MAX_FILE_SIZE_BYTES).toBe(40 * 1024 * 1024);
  });

  it("defers DOCX parsing to the backend instead of loading the client-side parser", async () => {
    const file = makeDocxFile();

    const payload = await extractPaperImportPayload(file);

    expect(payload.sourceFormat).toBe("docx");
    expect(payload.originalFile).toBe(file);
    expect(extractQuestionImportPayloadMock).not.toHaveBeenCalled();
  });

  it("uploads DOCX original files to the stable file recognizer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makePaperResponse());
    vi.stubGlobal("fetch", fetchMock);

    const payload = await extractPaperImportPayload(makeDocxFile());
    await recognizePaperPayload(payload, { rootKnowledgePointId: "course-kp-1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/papers/import/recognize-file");
    const formData = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect((formData.get("file") as File).name).toBe("sql-paper.docx");
    expect(formData.get("root_knowledge_point_id")).toBe("course-kp-1");
  });

  it("falls back to client-side DOCX parsing when stable recognition fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "稳定识别失败" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(makePaperResponse());
    vi.stubGlobal("fetch", fetchMock);
    extractQuestionImportPayloadMock.mockResolvedValue({
      rawText: "1. 幂等性是什么？",
      sourceFormat: "docx",
      images: [],
      tables: [],
    });

    const payload = await extractPaperImportPayload(makeDocxFile());
    await recognizePaperPayload(payload);

    expect(extractQuestionImportPayloadMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/papers/import/recognize");
    const body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(body.raw_text).toBe("1. 幂等性是什么？");
    expect(body.source_format).toBe("docx");
  });

  it("uploads PDF original files to the stable file recognizer with the course root knowledge point", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makePaperResponse());
    vi.stubGlobal("fetch", fetchMock);

    await recognizePaperPayload(makePdfPayload(), {
      rootKnowledgePointId: "course-kp-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/papers/import/recognize-file");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const formData = init.body as FormData;
    expect((formData.get("file") as File).name).toBe("sql-paper.pdf");
    expect(formData.get("root_knowledge_point_id")).toBe("course-kp-1");
    expect(String(formData.get("prompt"))).toContain("请直接识别试卷中的真实题目");
  });

  it("does not silently fall back to PDF page-image recognition when stable recognition fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "稳定识别失败" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(recognizePaperPayload(makePdfPayload())).rejects.toThrow("稳定识别失败");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/papers/import/recognize-file");
  });
});

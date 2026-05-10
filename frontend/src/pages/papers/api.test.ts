import { afterEach, describe, expect, it, vi } from "vitest";

import { paperApiRequest } from "./api";

describe("paperApiRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("does not force a JSON content type for FormData uploads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("access_token", "token-1");

    const formData = new FormData();
    formData.append("file", new File(["content"], "paper.docx"));

    await paperApiRequest<{ ok: boolean }>("/papers/import/recognize-file", {
      method: "POST",
      body: formData,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ Authorization: "Bearer token-1" });
  });
});

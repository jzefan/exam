import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeLanguage } from "@/types";
import {
  buildCodeQuestionLspUrl,
  type CodeQuestionLspMonaco,
  useCodeQuestionLsp,
} from "./use-code-question-lsp";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn((code = 1000) => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
}

describe("useCodeQuestionLsp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    window.localStorage.setItem("access_token", "token-123");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("builds a websocket url with exam, question, language, and token", () => {
    const url = buildCodeQuestionLspUrl({
      examId: "exam-1",
      questionId: "code-1",
      language: "python",
      enabled: true,
    });

    expect(url).toContain("/api/student/exams/exam-1/questions/code-1/lsp");
    expect(url).toContain("language=python");
    expect(url).toContain("token=token-123");
    expect(url?.startsWith("ws://")).toBe(true);
  });

  it("opens and disposes a websocket session", () => {
    const { unmount } = renderHook(() => useCodeQuestionLsp({
      examId: "exam-1",
      questionId: "code-1",
      language: "python",
    }));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toContain("language=python");

    unmount();

    expect(MockWebSocket.instances[0]?.close).toHaveBeenCalledWith(1000, "dispose");
  });

  it("reconnects when the language changes", () => {
    const { rerender } = renderHook(
      ({ language }: { language: CodeLanguage }) => useCodeQuestionLsp({
        examId: "exam-1",
        questionId: "code-1",
        language,
      }),
      { initialProps: { language: "python" as CodeLanguage } },
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toContain("language=python");

    rerender({ language: "java" as CodeLanguage });

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[0]?.close).toHaveBeenCalledWith(1000, "dispose");
    expect(MockWebSocket.instances[1]?.url).toContain("language=java");
  });

  it("does not connect without a token", () => {
    window.localStorage.removeItem("access_token");

    renderHook(() => useCodeQuestionLsp({
      examId: "exam-1",
      questionId: "code-1",
      language: "python",
    }));

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("retries after unexpected close", () => {
    renderHook(() => useCodeQuestionLsp({
      examId: "exam-1",
      questionId: "code-1",
      language: "python",
    }));

    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances[0]?.onclose?.({ code: 1011 } as CloseEvent);
    vi.advanceTimersByTime(2_000);

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("registers completion trigger characters for dot-style member access", () => {
    const registerCompletionItemProvider = vi.fn<CodeQuestionLspMonaco["languages"]["registerCompletionItemProvider"]>(
      () => ({ dispose: vi.fn() }),
    );
    const monaco = {
      languages: {
        registerCompletionItemProvider,
        registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerSignatureHelpProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerDocumentSymbolProvider: vi.fn(() => ({ dispose: vi.fn() })),
        CompletionItemKind: { Text: 0 },
        CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      },
      editor: {
        setModelMarkers: vi.fn(),
        MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
      },
    };
    const model = {
      uri: { toString: () => "file:///student-exam/code-1/Solution.java" },
      getValue: () => "",
      getVersionId: () => 1,
      getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
    };
    const editor = {
      getModel: () => model,
      onDidChangeModelContent: () => ({ dispose: vi.fn() }),
    };

    renderHook(() => useCodeQuestionLsp({
      examId: "exam-1",
      questionId: "code-1",
      language: "java",
      monaco,
      editor,
      modelUri: "file:///student-exam/code-1/Solution.java",
    }));

    expect(registerCompletionItemProvider).toHaveBeenCalledTimes(1);
    const completionProvider = registerCompletionItemProvider.mock.calls[0]?.[1];
    expect(completionProvider?.triggerCharacters).toContain(".");
  });
});

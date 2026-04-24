import { useEffect, useMemo, useRef } from "react";
import type { CodeLanguage } from "@/types";

interface UseCodeQuestionLspParams {
  examId?: string;
  questionId?: string;
  language: CodeLanguage;
  enabled?: boolean;
  code?: string;
  modelUri?: string;
  editor?: CodeQuestionLspEditor | null;
  monaco?: CodeQuestionLspMonaco | null;
}

type Disposable = { dispose: () => void };

type LspPendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type LspJsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
};

type MonacoPosition = {
  lineNumber: number;
  column: number;
};

type MonacoWordAtPosition = {
  startColumn: number;
  endColumn: number;
};

type MonacoRangeLike = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

type MonacoDiagnosticMarker = MonacoRangeLike & {
  message: string;
  severity: number;
  source: string;
};

type MonacoHoverContent = {
  value: string;
};

type MonacoCompletionSuggestion = {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | MonacoHoverContent;
  insertText: string;
  insertTextRules?: number;
  range: MonacoRangeLike;
  sortText?: string;
  filterText?: string;
};

type MonacoSignatureInformation = {
  label: string;
  documentation?: string | MonacoHoverContent;
  parameters?: Array<{
    label: string | [number, number];
    documentation?: string | MonacoHoverContent;
  }>;
};

type MonacoDocumentSymbol = {
  name: string;
  detail?: string;
  kind: number;
  range: MonacoRangeLike;
  selectionRange: MonacoRangeLike;
  children?: MonacoDocumentSymbol[];
  tags?: number[];
};

type MonacoCompletionProvider = {
  triggerCharacters?: string[];
  provideCompletionItems: (model: CodeQuestionLspModel, position: MonacoPosition) => Promise<{
    suggestions: MonacoCompletionSuggestion[];
  }>;
};

type MonacoHoverProvider = {
  provideHover: (model: CodeQuestionLspModel, position: MonacoPosition) => Promise<{
    range?: MonacoRangeLike;
    contents: MonacoHoverContent[];
  } | null>;
};

type MonacoSignatureHelpProvider = {
  signatureHelpTriggerCharacters?: string[];
  signatureHelpRetriggerCharacters?: string[];
  provideSignatureHelp: (model: CodeQuestionLspModel, position: MonacoPosition) => Promise<{
    value: {
      signatures: MonacoSignatureInformation[];
      activeSignature: number;
      activeParameter: number;
    };
    dispose: () => void;
  } | null>;
};

type MonacoDocumentSymbolProvider = {
  provideDocumentSymbols: (model: CodeQuestionLspModel) => Promise<MonacoDocumentSymbol[]>;
};

export interface CodeQuestionLspModel {
  uri: {
    toString: () => string;
  };
  getValue: () => string;
  getVersionId: () => number;
  getWordUntilPosition: (position: MonacoPosition) => MonacoWordAtPosition;
}

export interface CodeQuestionLspEditor {
  getModel: () => CodeQuestionLspModel | null;
  onDidChangeModelContent: (listener: () => void) => Disposable;
}

export interface CodeQuestionLspMonaco {
  languages: {
    registerCompletionItemProvider: (languageId: string, provider: MonacoCompletionProvider) => Disposable;
    registerHoverProvider: (languageId: string, provider: MonacoHoverProvider) => Disposable;
    registerSignatureHelpProvider: (languageId: string, provider: MonacoSignatureHelpProvider) => Disposable;
    registerDocumentSymbolProvider: (languageId: string, provider: MonacoDocumentSymbolProvider) => Disposable;
    CompletionItemKind: Record<string, number>;
    CompletionItemInsertTextRule: {
      InsertAsSnippet: number;
    };
    SymbolKind?: Record<string, number>;
  };
  editor: {
    setModelMarkers: (model: CodeQuestionLspModel, owner: string, markers: MonacoDiagnosticMarker[]) => void;
    MarkerSeverity: Record<string, number>;
  };
  Range?: new (
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number,
  ) => MonacoRangeLike;
}

const RECONNECT_DELAY_MS = 2_000;
const CHANGE_DEBOUNCE_MS = 120;
const REQUEST_TIMEOUT_MS = 4_000;
const MARKER_OWNER = "code-question-lsp";

const MONACO_LANGUAGE_MAP: Record<CodeLanguage, string> = {
  python: "python",
  javascript: "javascript",
  java: "java",
  cpp: "cpp",
  c: "c",
  go: "go",
};

const LSP_LANGUAGE_ID_MAP: Record<CodeLanguage, string> = {
  python: "python",
  javascript: "javascript",
  java: "java",
  cpp: "cpp",
  c: "c",
  go: "go",
};

const SIGNATURE_HELP_TRIGGER_CHARACTERS = ["(", ","];
const SIGNATURE_HELP_RETRIGGER_CHARACTERS = [","];
const COMPLETION_TRIGGER_CHARACTERS: Record<CodeLanguage, string[]> = {
  python: [".", "_"],
  javascript: [".", "'", "\"", "/", "@"],
  java: [".", "@", ":"],
  cpp: [".", ">", ":"],
  c: [".", ">", ":"],
  go: [".", "\"", "/"],
};

function createLspPosition(position: MonacoPosition) {
  return {
    line: Math.max(position.lineNumber - 1, 0),
    character: Math.max(position.column - 1, 0),
  };
}

function createMonacoRange(
  monaco: CodeQuestionLspMonaco,
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  } | undefined,
): MonacoRangeLike | undefined {
  if (!range) {
    return undefined;
  }

  const nextRange = {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };

  return monaco.Range
    ? new monaco.Range(
      nextRange.startLineNumber,
      nextRange.startColumn,
      nextRange.endLineNumber,
      nextRange.endColumn,
    )
    : nextRange;
}

function getMarkerSeverity(monaco: CodeQuestionLspMonaco, severity: number | undefined) {
  switch (severity) {
    case 1:
      return monaco.editor.MarkerSeverity.Error;
    case 2:
      return monaco.editor.MarkerSeverity.Warning;
    case 3:
      return monaco.editor.MarkerSeverity.Info;
    case 4:
      return monaco.editor.MarkerSeverity.Hint;
    default:
      return monaco.editor.MarkerSeverity.Info;
  }
}

function normalizeMarkupContent(
  value:
    | string
    | { kind?: string; value?: string }
    | { language?: string; value?: string }
    | Array<string | { kind?: string; value?: string } | { language?: string; value?: string }>
    | null
    | undefined,
): MonacoHoverContent[] {
  if (!value) {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];

  return values
    .map((item) => {
      if (typeof item === "string") {
        return { value: item };
      }

      if ("kind" in item && typeof item.value === "string") {
        return { value: item.value };
      }

      if ("language" in item && typeof item.value === "string") {
        return {
          value: item.language ? `\`\`\`${item.language}\n${item.value}\n\`\`\`` : item.value,
        };
      }

      return null;
    })
    .filter((item): item is MonacoHoverContent => Boolean(item));
}

function mapCompletionKind(monaco: CodeQuestionLspMonaco, kind: number | undefined) {
  const completionKind = monaco.languages.CompletionItemKind;
  const fallback = completionKind.Text ?? 0;
  const kindMap: Record<number, number | undefined> = {
    2: completionKind.Method,
    3: completionKind.Function,
    4: completionKind.Constructor,
    5: completionKind.Field,
    6: completionKind.Variable,
    7: completionKind.Class,
    8: completionKind.Interface,
    9: completionKind.Module,
    10: completionKind.Property,
    11: completionKind.Unit,
    12: completionKind.Value,
    13: completionKind.Enum,
    14: completionKind.Keyword,
    15: completionKind.Snippet,
    16: completionKind.Color,
    17: completionKind.File,
    18: completionKind.Reference,
    19: completionKind.Folder,
    20: completionKind.EnumMember,
    21: completionKind.Constant,
    22: completionKind.Struct,
    23: completionKind.Event,
    24: completionKind.Operator,
    25: completionKind.TypeParameter,
  };

  return kindMap[kind ?? 0] ?? fallback;
}

function mapSymbolKind(monaco: CodeQuestionLspMonaco, kind: number | undefined) {
  const symbolKind = monaco.languages.SymbolKind ?? {};
  const fallback = symbolKind.Object ?? 0;
  const kindMap: Record<number, number | undefined> = {
    1: symbolKind.File,
    2: symbolKind.Module,
    3: symbolKind.Namespace,
    4: symbolKind.Package,
    5: symbolKind.Class,
    6: symbolKind.Method,
    7: symbolKind.Property,
    8: symbolKind.Field,
    9: symbolKind.Constructor,
    10: symbolKind.Enum,
    11: symbolKind.Interface,
    12: symbolKind.Function,
    13: symbolKind.Variable,
    14: symbolKind.Constant,
    15: symbolKind.String,
    16: symbolKind.Number,
    17: symbolKind.Boolean,
    18: symbolKind.Array,
    19: symbolKind.Object,
    20: symbolKind.Key,
    21: symbolKind.Null,
    22: symbolKind.EnumMember,
    23: symbolKind.Struct,
    24: symbolKind.Event,
    25: symbolKind.Operator,
    26: symbolKind.TypeParameter,
  };

  return kindMap[kind ?? 0] ?? fallback;
}

function toMonacoCompletionSuggestions(
  monaco: CodeQuestionLspMonaco,
  items: Array<Record<string, unknown>>,
  defaultRange: MonacoRangeLike,
) {
  return items.map((item) => {
    const insertText = typeof item.insertText === "string"
      ? item.insertText
      : typeof item.label === "string"
        ? item.label
        : "";
    const documentation = normalizeMarkupContent(item.documentation as MonacoHoverContent["value"]);

    return {
      label: typeof item.label === "string" ? item.label : "",
      kind: mapCompletionKind(monaco, typeof item.kind === "number" ? item.kind : undefined),
      detail: typeof item.detail === "string" ? item.detail : undefined,
      documentation: documentation[0] ?? undefined,
      insertText,
      insertTextRules:
        typeof item.insertTextFormat === "number" && item.insertTextFormat === 2
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
      range: defaultRange,
      sortText: typeof item.sortText === "string" ? item.sortText : undefined,
      filterText: typeof item.filterText === "string" ? item.filterText : undefined,
    } satisfies MonacoCompletionSuggestion;
  });
}

function toMonacoDocumentSymbols(
  monaco: CodeQuestionLspMonaco,
  items: Array<Record<string, unknown>>,
): MonacoDocumentSymbol[] {
  const symbols = items
    .map((item): MonacoDocumentSymbol | null => {
      const range = createMonacoRange(
        monaco,
        typeof item.range === "object" && item.range !== null
          ? item.range as {
            start: { line: number; character: number };
            end: { line: number; character: number };
          }
          : undefined,
      );
      const selectionRange = createMonacoRange(
        monaco,
        typeof item.selectionRange === "object" && item.selectionRange !== null
          ? item.selectionRange as {
            start: { line: number; character: number };
            end: { line: number; character: number };
          }
          : undefined,
      ) ?? range;

      if (!range || !selectionRange || typeof item.name !== "string") {
        return null;
      }

      const children: MonacoDocumentSymbol[] | undefined = Array.isArray(item.children)
        ? toMonacoDocumentSymbols(monaco, item.children as Array<Record<string, unknown>>)
        : undefined;

      return {
        name: item.name,
        detail: typeof item.detail === "string" ? item.detail : undefined,
        kind: mapSymbolKind(monaco, typeof item.kind === "number" ? item.kind : undefined),
        range,
        selectionRange,
        children,
        tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is number => typeof tag === "number") : undefined,
      } satisfies MonacoDocumentSymbol;
    });

  return symbols.filter((item): item is MonacoDocumentSymbol => item !== null);
}

function createInitializeParams() {
  return {
    processId: null,
    clientInfo: {
      name: "exam-code-editor",
      version: "1.0.0",
    },
    locale: "zh-CN",
    rootUri: null,
    capabilities: {
      textDocument: {
        synchronization: {
          dynamicRegistration: false,
          willSave: false,
          didSave: false,
          willSaveWaitUntil: false,
        },
        completion: {
          completionItem: {
            snippetSupport: true,
            documentationFormat: ["markdown", "plaintext"],
          },
        },
        hover: {
          contentFormat: ["markdown", "plaintext"],
        },
        signatureHelp: {
          signatureInformation: {
            documentationFormat: ["markdown", "plaintext"],
          },
        },
        documentSymbol: {
          hierarchicalDocumentSymbolSupport: true,
        },
        publishDiagnostics: {
          relatedInformation: true,
        },
      },
      workspace: {},
    },
    initializationOptions: {},
  };
}

function rejectPendingRequests(
  pendingRequests: Map<number, LspPendingRequest>,
  reason: Error,
) {
  for (const [, entry] of pendingRequests) {
    entry.reject(reason);
  }
  pendingRequests.clear();
}

export function buildCodeQuestionLspUrl(params: UseCodeQuestionLspParams) {
  if (typeof window === "undefined" || !params.examId || !params.questionId) {
    return null;
  }

  const token = window.localStorage.getItem("access_token");
  if (!token) {
    return null;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(
    `${protocol}//${window.location.host}/api/student/exams/${params.examId}/questions/${params.questionId}/lsp`,
  );
  url.searchParams.set("language", params.language);
  url.searchParams.set("token", token);
  return url.toString();
}

export function useCodeQuestionLsp({
  examId,
  questionId,
  language,
  enabled = true,
  code = "",
  modelUri,
  editor,
  monaco,
}: UseCodeQuestionLspParams) {
  const connectionKey = useMemo(
    () => `${examId ?? ""}:${questionId ?? ""}:${language}:${enabled ? "on" : "off"}:${modelUri ?? ""}`,
    [enabled, examId, language, modelUri, questionId],
  );
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const changeTimerRef = useRef<number | null>(null);
  const codeRef = useRef(code);
  const modelUriRef = useRef(modelUri ?? "");
  const monacoRef = useRef(monaco ?? null);
  const editorRef = useRef(editor ?? null);
  const requestIdRef = useRef(0);
  const initializedRef = useRef(false);
  const pendingRequestsRef = useRef<Map<number, LspPendingRequest>>(new Map());

  codeRef.current = code;
  modelUriRef.current = modelUri ?? "";
  monacoRef.current = monaco ?? null;
  editorRef.current = editor ?? null;

  useEffect(() => {
    if (!enabled || !examId || !questionId || typeof window === "undefined" || typeof WebSocket === "undefined") {
      return undefined;
    }

    let disposed = false;
    const registrations: Disposable[] = [];
    let modelChangeSubscription: Disposable | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const clearChangeTimer = () => {
      if (changeTimerRef.current !== null) {
        window.clearTimeout(changeTimerRef.current);
        changeTimerRef.current = null;
      }
    };

    const applyDiagnostics = (diagnostics: Array<Record<string, unknown>>) => {
      const currentMonaco = monacoRef.current;
      const currentEditor = editorRef.current;
      const currentModel = currentEditor?.getModel();
      if (!currentMonaco || !currentModel || currentModel.uri.toString() !== modelUriRef.current) {
        return;
      }

      const markers = diagnostics
        .map((item) => {
          const range = createMonacoRange(
            currentMonaco,
            typeof item.range === "object" && item.range !== null
              ? item.range as {
                start: { line: number; character: number };
                end: { line: number; character: number };
              }
              : undefined,
          );
          if (!range || typeof item.message !== "string") {
            return null;
          }

          return {
            ...range,
            message: item.message,
            severity: getMarkerSeverity(currentMonaco, typeof item.severity === "number" ? item.severity : undefined),
            source: typeof item.source === "string" ? item.source : "lsp",
          } satisfies MonacoDiagnosticMarker;
        })
        .filter((item): item is MonacoDiagnosticMarker => Boolean(item));

      currentMonaco.editor.setModelMarkers(currentModel, MARKER_OWNER, markers);
    };

    const clearDiagnostics = () => {
      const currentMonaco = monacoRef.current;
      const currentEditor = editorRef.current;
      const currentModel = currentEditor?.getModel();
      if (!currentMonaco || !currentModel) {
        return;
      }
      currentMonaco.editor.setModelMarkers(currentModel, MARKER_OWNER, []);
    };

    const sendMessage = (payload: Record<string, unknown>) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      socket.send(JSON.stringify(payload));
      return true;
    };

    const sendNotification = (method: string, params: Record<string, unknown>) => {
      sendMessage({
        jsonrpc: "2.0",
        method,
        params,
      });
    };

    const sendRequest = (method: string, params: Record<string, unknown>) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.resolve(null);
      }

      const id = ++requestIdRef.current;

      return new Promise<unknown>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pendingRequestsRef.current.delete(id);
          reject(new Error(`LSP request timed out: ${method}`));
        }, REQUEST_TIMEOUT_MS);

        pendingRequestsRef.current.set(id, {
          resolve: (value) => {
            window.clearTimeout(timeout);
            resolve(value);
          },
          reject: (reason) => {
            window.clearTimeout(timeout);
            reject(reason);
          },
        });

        socket.send(JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        }));
      });
    };

    const sendDidOpen = () => {
      if (!initializedRef.current || !modelUriRef.current) {
        return;
      }

      sendNotification("textDocument/didOpen", {
        textDocument: {
          uri: modelUriRef.current,
          languageId: LSP_LANGUAGE_ID_MAP[language],
          version: 1,
          text: codeRef.current,
        },
      });
    };

    const sendDidChange = () => {
      if (!initializedRef.current) {
        return;
      }
      const currentEditor = editorRef.current;
      const currentModel = currentEditor?.getModel();
      if (!currentModel || currentModel.uri.toString() !== modelUriRef.current) {
        return;
      }

      sendNotification("textDocument/didChange", {
        textDocument: {
          uri: modelUriRef.current,
          version: currentModel.getVersionId(),
        },
        contentChanges: [
          {
            text: currentModel.getValue(),
          },
        ],
      });
    };

    const sendDidClose = () => {
      if (!initializedRef.current || !modelUriRef.current) {
        return;
      }
      sendNotification("textDocument/didClose", {
        textDocument: {
          uri: modelUriRef.current,
        },
      });
    };

    const initializeSession = async () => {
      try {
        const initializeResult = await sendRequest("initialize", createInitializeParams());
        if (disposed || initializeResult === null) {
          return;
        }

        initializedRef.current = true;
        sendNotification("initialized", {});
        sendDidOpen();
      } catch {
        initializedRef.current = false;
      }
    };

    const cleanupSocket = (closeCode = 1000, closeReason = "dispose") => {
      const current = socketRef.current;
      socketRef.current = null;
      if (!current) {
        return;
      }
      current.onopen = null;
      current.onmessage = null;
      current.onerror = null;
      current.onclose = null;
      if (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING) {
        current.close(closeCode, closeReason);
      }
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      const url = buildCodeQuestionLspUrl({ examId, questionId, language, enabled });
      if (!url) {
        return;
      }

      clearReconnectTimer();
      cleanupSocket();
      rejectPendingRequests(pendingRequestsRef.current, new Error("LSP session restarting"));
      initializedRef.current = false;

      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        void initializeSession();
      };

      socket.onmessage = (event) => {
        let message: LspJsonRpcMessage;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (message.id !== undefined) {
          const numericId = typeof message.id === "number" ? message.id : Number(message.id);
          const pending = Number.isFinite(numericId) ? pendingRequestsRef.current.get(numericId) : undefined;
          if (!pending) {
            return;
          }
          pendingRequestsRef.current.delete(numericId);
          if (message.error) {
            pending.reject(new Error(message.error.message || "LSP request failed"));
          } else {
            pending.resolve(message.result ?? null);
          }
          return;
        }

        if (message.method === "textDocument/publishDiagnostics") {
          const uri = typeof message.params?.uri === "string" ? message.params.uri : "";
          if (uri !== modelUriRef.current) {
            return;
          }
          const diagnostics = Array.isArray(message.params?.diagnostics)
            ? message.params?.diagnostics as Array<Record<string, unknown>>
            : [];
          applyDiagnostics(diagnostics);
        }
      };

      socket.onerror = () => {
        // Keep this silent. Language service must never interrupt exam-taking.
      };

      socket.onclose = (event) => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        initializedRef.current = false;
        rejectPendingRequests(pendingRequestsRef.current, new Error("LSP session closed"));
        clearDiagnostics();
        if (disposed || event.code === 1000) {
          return;
        }
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, RECONNECT_DELAY_MS);
      };
    };

    const currentMonaco = monacoRef.current;
    if (currentMonaco) {
      registrations.push(
        currentMonaco.languages.registerCompletionItemProvider(MONACO_LANGUAGE_MAP[language], {
          triggerCharacters: COMPLETION_TRIGGER_CHARACTERS[language],
          provideCompletionItems: async (model, position) => {
            if (model.uri.toString() !== modelUriRef.current || !initializedRef.current) {
              return { suggestions: [] };
            }

            try {
              const response = await sendRequest("textDocument/completion", {
                textDocument: { uri: modelUriRef.current },
                position: createLspPosition(position),
              });
              const payload = Array.isArray(response)
                ? response
                : Array.isArray((response as { items?: unknown[] } | null)?.items)
                  ? (response as { items: Record<string, unknown>[] }).items
                  : [];
              const word = model.getWordUntilPosition(position);
              const range = {
                startLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endLineNumber: position.lineNumber,
                endColumn: word.endColumn,
              };

              return {
                suggestions: toMonacoCompletionSuggestions(currentMonaco, payload as Array<Record<string, unknown>>, range),
              };
            } catch {
              return { suggestions: [] };
            }
          },
        }),
      );

      registrations.push(
        currentMonaco.languages.registerHoverProvider(MONACO_LANGUAGE_MAP[language], {
          provideHover: async (model, position) => {
            if (model.uri.toString() !== modelUriRef.current || !initializedRef.current) {
              return null;
            }

            try {
              const response = await sendRequest("textDocument/hover", {
                textDocument: { uri: modelUriRef.current },
                position: createLspPosition(position),
              }) as { contents?: unknown; range?: { start: { line: number; character: number }; end: { line: number; character: number } } } | null;
              const contents = normalizeMarkupContent(response?.contents as MonacoHoverContent["value"]);
              if (contents.length === 0) {
                return null;
              }

              return {
                range: createMonacoRange(currentMonaco, response?.range),
                contents,
              };
            } catch {
              return null;
            }
          },
        }),
      );

      registrations.push(
        currentMonaco.languages.registerSignatureHelpProvider(MONACO_LANGUAGE_MAP[language], {
          signatureHelpTriggerCharacters: SIGNATURE_HELP_TRIGGER_CHARACTERS,
          signatureHelpRetriggerCharacters: SIGNATURE_HELP_RETRIGGER_CHARACTERS,
          provideSignatureHelp: async (model, position) => {
            if (model.uri.toString() !== modelUriRef.current || !initializedRef.current) {
              return null;
            }

            try {
              const response = await sendRequest("textDocument/signatureHelp", {
                textDocument: { uri: modelUriRef.current },
                position: createLspPosition(position),
              }) as {
                signatures?: Array<Record<string, unknown>>;
                activeSignature?: number;
                activeParameter?: number;
              } | null;

              const signatures: MonacoSignatureInformation[] = Array.isArray(response?.signatures)
                ? response.signatures
                    .map((signature): MonacoSignatureInformation | null => {
                      if (typeof signature.label !== "string") {
                        return null;
                      }

                      const parameters = Array.isArray(signature.parameters)
                        ? signature.parameters
                            .map((parameter) => {
                              if (
                                typeof parameter !== "object"
                                || parameter === null
                                || !("label" in parameter)
                              ) {
                                return null;
                              }
                              const label = parameter.label;
                              if (
                                typeof label !== "string"
                                && (!Array.isArray(label) || label.length !== 2)
                              ) {
                                return null;
                              }
                              return {
                                label: label as string | [number, number],
                                documentation: normalizeMarkupContent(
                                  (parameter as { documentation?: unknown }).documentation as MonacoHoverContent["value"],
                                )[0] ?? undefined,
                              };
                            })
                            .filter((item): item is NonNullable<typeof item> => Boolean(item))
                        : undefined;

                      return {
                        label: signature.label,
                        documentation: normalizeMarkupContent(signature.documentation as MonacoHoverContent["value"])[0] ?? undefined,
                        parameters,
                      };
                    })
                    .filter((item): item is MonacoSignatureInformation => Boolean(item))
                : [];

              if (signatures.length === 0) {
                return null;
              }

              return {
                value: {
                  signatures,
                  activeSignature: typeof response?.activeSignature === "number" ? response.activeSignature : 0,
                  activeParameter: typeof response?.activeParameter === "number" ? response.activeParameter : 0,
                },
                dispose: () => undefined,
              };
            } catch {
              return null;
            }
          },
        }),
      );

      registrations.push(
        currentMonaco.languages.registerDocumentSymbolProvider(MONACO_LANGUAGE_MAP[language], {
          provideDocumentSymbols: async (model) => {
            if (model.uri.toString() !== modelUriRef.current || !initializedRef.current) {
              return [];
            }

            try {
              const response = await sendRequest("textDocument/documentSymbol", {
                textDocument: { uri: modelUriRef.current },
              });
              const items = Array.isArray(response) ? response as Array<Record<string, unknown>> : [];
              return toMonacoDocumentSymbols(currentMonaco, items);
            } catch {
              return [];
            }
          },
        }),
      );
    }

    const currentEditor = editorRef.current;
    if (currentEditor) {
      modelChangeSubscription = currentEditor.onDidChangeModelContent(() => {
        clearChangeTimer();
        changeTimerRef.current = window.setTimeout(() => {
          changeTimerRef.current = null;
          sendDidChange();
        }, CHANGE_DEBOUNCE_MS);
      });
    }

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      clearChangeTimer();
      sendDidClose();
      cleanupSocket();
      rejectPendingRequests(pendingRequestsRef.current, new Error("LSP session disposed"));
      initializedRef.current = false;
      modelChangeSubscription?.dispose();
      registrations.forEach((registration) => registration.dispose());
      clearDiagnostics();
    };
  }, [connectionKey, enabled, examId, questionId, language, editor, monaco, modelUri]);
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import Editor from "@monaco-editor/react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { renderLatexInHtml } from "@/components/ui/latex-text";
import { Braces, Play, RotateCcw, TerminalSquare } from "lucide-react";
import type {
  ICodeAnswerContent,
  ICodeQuestionContent,
  IExamQuestionForStudent,
  IStudentCodeRunCaseResult,
  IStudentCodeRunResult,
} from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

const LANGUAGE_LABELS = {
  python: "Python",
  javascript: "JavaScript",
  java: "Java",
  cpp: "C++",
  c: "C",
  go: "Go",
} as const;

type CodeLanguage = keyof typeof LANGUAGE_LABELS;

const DEFAULT_LANGUAGES: CodeLanguage[] = ["python", "javascript", "java", "cpp", "c", "go"];

const MONACO_LANGUAGE_MAP: Record<CodeLanguage, string> = {
  python: "python",
  javascript: "javascript",
  java: "java",
  cpp: "cpp",
  c: "c",
  go: "go",
};

const MONACO_MODEL_EXTENSIONS: Record<CodeLanguage, string> = {
  python: "py",
  javascript: "js",
  java: "java",
  cpp: "cpp",
  c: "c",
  go: "go",
};

const LANGUAGE_TAB_SIZE: Record<CodeLanguage, number> = {
  python: 4,
  javascript: 2,
  java: 4,
  cpp: 4,
  c: 4,
  go: 4,
};

type MonacoNamespace = Parameters<NonNullable<ComponentProps<typeof Editor>["beforeMount"]>>[0];
type MonacoCompletionKind = "Keyword" | "Function" | "Snippet" | "Class";

interface CompletionSpec {
  label: string;
  kind: MonacoCompletionKind;
  insertText: string;
  documentation: string;
}

const LANGUAGE_COMPLETIONS: Record<CodeLanguage, CompletionSpec[]> = {
  python: [
    { label: "def", kind: "Keyword", insertText: "def ${1:name}(${2:args}):\n    ${3:pass}", documentation: "定义 Python 函数。" },
    { label: "for", kind: "Snippet", insertText: "for ${1:item} in ${2:iterable}:\n    ${3:pass}", documentation: "Python for 循环模板。" },
    { label: "if", kind: "Snippet", insertText: "if ${1:condition}:\n    ${2:pass}", documentation: "Python if 条件分支模板。" },
    { label: "len", kind: "Function", insertText: "len(${1:iterable})", documentation: "返回序列或集合的长度。" },
    { label: "range", kind: "Function", insertText: "range(${1:start}, ${2:stop})", documentation: "生成整数序列。" },
    { label: "sorted", kind: "Function", insertText: "sorted(${1:iterable})", documentation: "返回排序后的新列表。" },
  ],
  javascript: [
    { label: "function", kind: "Keyword", insertText: "function ${1:name}(${2:args}) {\n  ${3:// code}\n}", documentation: "定义 JavaScript 函数。" },
    { label: "const", kind: "Keyword", insertText: "const ${1:name} = ${2:value};", documentation: "声明不可重新赋值的变量。" },
    { label: "for", kind: "Snippet", insertText: "for (let ${1:i} = 0; ${1:i} < ${2:length}; ${1:i} += 1) {\n  ${3}\n}", documentation: "经典 for 循环模板。" },
    { label: "console.log", kind: "Function", insertText: "console.log(${1:value});", documentation: "输出调试日志到控制台。" },
    { label: "map", kind: "Function", insertText: ".map((${1:item}) => ${2:item})", documentation: "对数组进行映射转换。" },
    { label: "filter", kind: "Function", insertText: ".filter((${1:item}) => ${2:condition})", documentation: "按条件过滤数组元素。" },
  ],
  java: [
    { label: "public class", kind: "Keyword", insertText: "public class ${1:Solution} {\n    ${2}\n}", documentation: "定义公开类。" },
    { label: "for", kind: "Snippet", insertText: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    ${3}\n}", documentation: "Java for 循环模板。" },
    { label: "if", kind: "Snippet", insertText: "if (${1:condition}) {\n    ${2}\n}", documentation: "Java if 条件模板。" },
    { label: "System.out.println", kind: "Function", insertText: "System.out.println(${1:value});", documentation: "输出内容到标准控制台。" },
    { label: "ArrayList", kind: "Class", insertText: "ArrayList<${1:Integer}> ${2:list} = new ArrayList<>();", documentation: "动态数组实现，位于 java.util 包。" },
    { label: "HashMap", kind: "Class", insertText: "HashMap<${1:Integer}, ${2:Integer}> ${3:map} = new HashMap<>();", documentation: "键值映射容器，位于 java.util 包。" },
  ],
  cpp: [
    { label: "#include", kind: "Keyword", insertText: "#include <${1:iostream}>", documentation: "引入头文件。" },
    { label: "for", kind: "Snippet", insertText: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n    ${3}\n}", documentation: "C++ for 循环模板。" },
    { label: "if", kind: "Snippet", insertText: "if (${1:condition}) {\n    ${2}\n}", documentation: "C++ if 条件模板。" },
    { label: "std::vector", kind: "Class", insertText: "std::vector<${1:int}> ${2:nums};", documentation: "动态数组容器。" },
    { label: "std::cout", kind: "Function", insertText: "std::cout << ${1:value} << std::endl;", documentation: "向标准输出打印内容。" },
    { label: "sort", kind: "Function", insertText: "sort(${1:nums}.begin(), ${1:nums}.end());", documentation: "对区间进行升序排序。" },
  ],
  c: [
    { label: "#include", kind: "Keyword", insertText: "#include <${1:stdio.h}>", documentation: "引入头文件。" },
    { label: "for", kind: "Snippet", insertText: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n    ${3}\n}", documentation: "C for 循环模板。" },
    { label: "if", kind: "Snippet", insertText: "if (${1:condition}) {\n    ${2}\n}", documentation: "C if 条件模板。" },
    { label: "printf", kind: "Function", insertText: "printf(\"${1:%d}\\n\", ${2:value});", documentation: "格式化输出到标准输出。" },
    { label: "scanf", kind: "Function", insertText: "scanf(\"${1:%d}\", &${2:value});", documentation: "从标准输入读取格式化数据。" },
  ],
  go: [
    { label: "func", kind: "Keyword", insertText: "func ${1:solve}(${2:args}) ${3:int} {\n\t${4:return 0}\n}", documentation: "定义 Go 函数。" },
    { label: "for", kind: "Snippet", insertText: "for ${1:i} := 0; ${1:i} < ${2:n}; ${1:i}++ {\n\t${3}\n}", documentation: "Go for 循环模板。" },
    { label: "if", kind: "Snippet", insertText: "if ${1:condition} {\n\t${2}\n}", documentation: "Go if 条件模板。" },
    { label: "fmt.Println", kind: "Function", insertText: "fmt.Println(${1:value})", documentation: "打印一行输出。" },
    { label: "make", kind: "Function", insertText: "make(${1:[]int}, ${2:0})", documentation: "创建 slice、map 或 channel。" },
  ],
};

let completionProvidersRegistered = false;

const api = axios.create();
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const DEFAULT_PROGRAM_STARTER_CODE: Record<CodeLanguage, string> = {
  python: "",
  javascript: "",
  java: "public class Solution {\n    public static void main(String[] args) {\n        \n    }\n}\n",
  cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n",
  c: "#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n",
  go: "package main\n\nimport \"fmt\"\n\nfunc main() {\n    _ = fmt.Sprintf\n}\n",
};

const DEFAULT_FUNCTION_STARTER_CODE: Record<CodeLanguage, string> = {
  python: "class Solution:\n    def solve(self, *args):\n        # 请在这里实现你的代码\n        pass\n",
  javascript: "function solve(...args) {\n  // 请在这里实现你的代码\n}\n",
  java: "class Solution {\n    public Object solve() {\n        // 请在这里实现你的代码\n        return null;\n    }\n}\n",
  cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nclass Solution {\npublic:\n    int solve() {\n        // 请在这里实现你的代码\n        return 0;\n    }\n};\n",
  c: "#include <stdio.h>\n\nint solve() {\n    // 请在这里实现你的代码\n    return 0;\n}\n",
  go: "package main\n\nfunc solve() int {\n\t// 请在这里实现你的代码\n\treturn 0\n}\n",
};

const RUN_STATUS_LABELS: Record<IStudentCodeRunResult["status"], string> = {
  passed: "通过",
  failed: "未通过",
  compile_error: "编译错误",
  runtime_error: "运行时错误",
  timeout: "超时",
  system_error: "系统错误",
};

const RUN_ERROR_MESSAGES: Record<IStudentCodeRunResult["status"], string> = {
  passed: "运行成功。",
  failed: "运行未通过，请查看测试详情。",
  compile_error: "编译失败，请检查代码后重试。",
  runtime_error: "运行时出错，请检查代码后重试。",
  timeout: "运行超时，请优化代码后重试。",
  system_error: "系统异常，请稍后重试。",
};

function getRunStatusLabel(status: IStudentCodeRunResult["status"]) {
  return RUN_STATUS_LABELS[status] ?? "未知状态";
}

function getRunErrorMessage(detail?: string) {
  if (!detail) {
    return "运行失败，请稍后重试。";
  }

  if (detail.includes("当前运行环境未安装")) {
    return detail;
  }

  if (detail in RUN_ERROR_MESSAGES) {
    return `运行失败：${RUN_ERROR_MESSAGES[detail as IStudentCodeRunResult["status"]]}`;
  }

  return "运行失败，请稍后重试。";
}

function formatRunSummary(result: IStudentCodeRunResult) {
  if (result.mode === "sample") {
    if (result.status === "system_error") {
      return result.stderr || result.compile_output || "当前运行环境暂不支持该语言的在线运行。";
    }
    if (result.status === "compile_error") {
      return "示例测试未运行，代码编译失败。";
    }
    if (result.status === "runtime_error") {
      return "示例测试运行出错，请检查代码后重试。";
    }
    if (result.status === "timeout") {
      return "示例测试运行超时，请检查是否存在死循环或复杂度过高。";
    }
    if (result.case_count === 0) {
      return "当前没有可运行的示例测试。";
    }
    const failedCount = Math.max(result.case_count - result.passed_count, 0);
    if (result.status === "passed") {
      return `示例测试全部通过（${result.passed_count} / ${result.case_count}）`;
    }

    return `示例测试结果：${result.passed_count} 个通过，${failedCount} 个未通过`;
  }

  if (result.status === "passed") {
    return result.stdout
      ? "自定义输入已执行，运行输出见下方。"
      : "自定义输入已执行，但程序没有输出任何内容。";
  }

  return `自定义输入执行结果：${getRunStatusLabel(result.status)}`;
}

function formatCaseStatusLabel(status: IStudentCodeRunCaseResult["status"]) {
  const map: Record<IStudentCodeRunCaseResult["status"], string> = {
    passed: "通过",
    failed: "未通过",
    compile_error: "编译错误",
    runtime_error: "运行时错误",
    timeout: "超时",
    system_error: "系统错误",
  };

  return map[status] ?? "未知状态";
}

function getMonacoModelPath(questionId: string, language: CodeLanguage) {
  return `file:///student-exam/${questionId}/solution.${MONACO_MODEL_EXTENSIONS[language]}`;
}

function normalizeCodeByLanguage(
  answer: Record<string, unknown>,
  language: CodeLanguage | undefined,
  code: string,
): Partial<Record<CodeLanguage, string>> {
  const raw = answer.code_by_language;
  const next: Partial<Record<CodeLanguage, string>> = {};

  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key in LANGUAGE_LABELS && typeof value === "string") {
        next[key as CodeLanguage] = value;
      }
    }
  }

  if (language && code && !next[language]) {
    next[language] = code;
  }

  return next;
}

function normalizeAnswer(answer: Record<string, unknown>): ICodeAnswerContent {
  const language = (answer.language as CodeLanguage | undefined) ?? "python";
  const code = typeof answer.code === "string" ? answer.code : "";

  return {
    language,
    code,
    code_by_language: normalizeCodeByLanguage(answer, language, code),
    custom_input: typeof answer.custom_input === "string" ? answer.custom_input : "",
    last_run_input: typeof answer.last_run_input === "string" ? answer.last_run_input : "",
    last_run_output: typeof answer.last_run_output === "string" ? answer.last_run_output : "",
  };
}

function buildCodePayload(
  normalized: ICodeAnswerContent,
  language: CodeLanguage,
  code: string,
): ICodeAnswerContent {
  return {
    ...normalized,
    language,
    code,
    code_by_language: {
      ...(normalized.code_by_language ?? {}),
      [language]: code,
    },
  };
}

function resolveLanguageCode(
  normalized: ICodeAnswerContent,
  language: CodeLanguage,
  starterCode: Partial<Record<CodeLanguage, string>>,
  defaultStarterCode: Record<CodeLanguage, string>,
) {
  if (normalized.code_by_language && language in normalized.code_by_language) {
    return normalized.code_by_language[language] ?? "";
  }

  if (normalized.language === language && typeof normalized.code === "string" && normalized.code !== "") {
    return normalized.code;
  }

  return starterCode[language] ?? defaultStarterCode[language];
}

function registerLanguageCompletions(monaco: MonacoNamespace) {
  if (completionProvidersRegistered) {
    return;
  }

  (Object.keys(LANGUAGE_COMPLETIONS) as CodeLanguage[]).forEach((language) => {
    monaco.languages.registerCompletionItemProvider(MONACO_LANGUAGE_MAP[language], {
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        };

        return {
          suggestions: LANGUAGE_COMPLETIONS[language].map((item) => ({
            label: item.label,
            kind: monaco.languages.CompletionItemKind[item.kind],
            insertText: item.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: item.documentation,
            range,
          })),
        };
      },
    });
  });

  completionProvidersRegistered = true;
}

export function CodeQuestion({ question, answer, onChange }: Props) {
  const { id: examId } = useParams<{ id: string }>();
  const content = (question.content ?? {}) as ICodeQuestionContent;
  const questionMode = content.mode === "function" ? "function" : "program";
  const normalized = normalizeAnswer(answer);
  const starterCode = content.starter_code ?? {};
  const defaultStarterCode = questionMode === "function" ? DEFAULT_FUNCTION_STARTER_CODE : DEFAULT_PROGRAM_STARTER_CODE;
  const supportedLanguages = DEFAULT_LANGUAGES.filter(
    (language) => typeof starterCode[language] === "string" || defaultStarterCode[language] !== undefined,
  );
  const defaultLanguage = supportedLanguages[0] ?? "python";
  const language = normalized.language && supportedLanguages.includes(normalized.language)
    ? normalized.language
    : defaultLanguage;
  const examples = content.examples ?? [];
  const sampleTests = content.sample_tests ?? examples.map((example) => ({
    input: example.input,
    expected_output: example.output,
  }));

  const [activeTab, setActiveTab] = useState<"sample" | "custom">("sample");
  const [runFeedback, setRunFeedback] = useState("");
  const [runResult, setRunResult] = useState<IStudentCodeRunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isRunResultStale, setIsRunResultStale] = useState(false);
  const [leftPaneWidth, setLeftPaneWidth] = useState(34);
  const [isResizing, setIsResizing] = useState(false);
  const [bottomPaneHeight, setBottomPaneHeight] = useState(36);
  const [isVerticalResizing, setIsVerticalResizing] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const rightPaneRef = useRef<HTMLDivElement | null>(null);
  const latestRunContextRef = useRef({
    language,
    code: "",
    customInput: "",
  });
  const activeRunIdRef = useRef(0);

  const descriptionHtml = useMemo(
    () => content.description ?? content.text ?? question.title,
    [content.description, content.text, question.title],
  );

  const currentCode = resolveLanguageCode(normalized, language, starterCode, defaultStarterCode);
  const currentRunInput = activeTab === "custom"
    ? normalized.custom_input ?? ""
    : sampleTests[0]?.input ?? "";
  const customRunInput = normalized.last_run_input ?? normalized.custom_input ?? "";

  useEffect(() => {
    latestRunContextRef.current = {
      language,
      code: currentCode,
      customInput: normalized.custom_input ?? "",
    };
  }, [currentCode, language, normalized.custom_input]);

  useEffect(() => {
    const currentLanguageCode = normalized.code_by_language?.[language];

    if (
      !normalized.language
      || normalized.language !== language
      || currentLanguageCode === undefined
      || currentLanguageCode !== currentCode
      || normalized.code !== currentCode
    ) {
      onChange(buildCodePayload(normalized, language, currentCode));
    }
  }, [currentCode, language, normalized, onChange]);

  const handleLanguageChange = (nextLanguage: CodeLanguage) => {
    if (isRunning) {
      return;
    }

    const nextCode = resolveLanguageCode(normalized, nextLanguage, starterCode, defaultStarterCode);

    onChange(buildCodePayload(normalized, nextLanguage, nextCode));
    setRunFeedback("");
    setRunResult(null);
    setIsRunResultStale(false);
  };

  const handleCodeChange = (value: string) => {
    onChange(buildCodePayload(normalized, language, value));
    setRunFeedback("");
    setRunResult(null);
    setIsRunResultStale(Boolean(normalized.last_run_output));
  };

  const handleResetCurrentLanguage = () => {
    if (isRunning) {
      return;
    }

    const nextCode = starterCode[language] || defaultStarterCode[language];
    onChange(buildCodePayload(normalized, language, nextCode));
    setRunFeedback(`已恢复 ${LANGUAGE_LABELS[language]} 模板代码。`);
    setRunResult(null);
    setIsRunResultStale(false);
  };

  const handleCustomInputChange = (value: string) => {
    onChange({
      ...normalized,
      language,
      custom_input: value,
    });
    setRunFeedback("");
    setRunResult(null);
    setIsRunResultStale(Boolean(normalized.last_run_output));
  };

  const handleRun = async () => {
    if (isRunning) {
      return;
    }

    if (!currentCode.trim()) {
      setRunResult(null);
      setRunFeedback("请先输入代码，再执行示例测试。");
      setIsRunResultStale(false);
      return;
    }

    if (!examId) {
      setRunResult(null);
      setRunFeedback("未找到考试上下文，暂时无法运行代码。");
      setIsRunResultStale(false);
      return;
    }

    const runId = activeRunIdRef.current + 1;
    activeRunIdRef.current = runId;
    const snapshot = {
      language,
      code: currentCode,
      customInput: normalized.custom_input ?? "",
    };

    setIsRunning(true);
    setRunFeedback("");
    setRunResult(null);
    setIsRunResultStale(false);

    try {
      const response = await api.post<IStudentCodeRunResult>(
        `/api/student/exams/${examId}/questions/${question.question_id}/run`,
        activeTab === "custom"
          ? {
            language,
            code: currentCode,
            mode: "custom",
            custom_input: normalized.custom_input ?? "",
          }
          : {
            language,
            code: currentCode,
            mode: "sample",
          },
      );
      const latestContext = latestRunContextRef.current;
      const isStaleResponse = activeRunIdRef.current !== runId
        || latestContext.language !== snapshot.language
        || latestContext.code !== snapshot.code
        || latestContext.customInput !== snapshot.customInput;

      if (isStaleResponse) {
        setRunFeedback("代码已更新，请重新运行以查看最新结果。");
        setRunResult(null);
        setIsRunResultStale(true);
        return;
      }

      const nextRunResult = response.data;
      const nextRunOutput = formatRunSummary(nextRunResult);

      onChange({
        ...buildCodePayload(normalized, language, currentCode),
        code: currentCode,
        last_run_input: currentRunInput,
        last_run_output: nextRunOutput,
      });
      setRunResult(nextRunResult);
      setIsRunResultStale(false);
    } catch (error) {
      setRunResult(null);
      if (axios.isAxiosError(error) && typeof error.response?.data?.detail === "string") {
        setRunFeedback(getRunErrorMessage(error.response.data.detail));
      } else {
        setRunFeedback("运行失败，请稍后重试。");
      }
      setIsRunResultStale(false);
    } finally {
      if (activeRunIdRef.current === runId) {
        setIsRunning(false);
      }
    }
  };

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const container = layoutRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;

      const nextWidth = ((event.clientX - rect.left) / rect.width) * 100;
      setLeftPaneWidth(Math.min(52, Math.max(24, nextWidth)));
    };

    const handlePointerUp = () => setIsResizing(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!isVerticalResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const container = rightPaneRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      if (rect.height <= 0) return;

      const offsetFromBottom = rect.bottom - event.clientY;
      const nextHeight = (offsetFromBottom / rect.height) * 100;
      setBottomPaneHeight(Math.min(72, Math.max(18, nextHeight)));
    };

    const handlePointerUp = () => setIsVerticalResizing(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isVerticalResizing]);

  useEffect(() => {
    if ((runResult || runFeedback) && !isVerticalResizing) {
      setBottomPaneHeight((current) => Math.max(current, 40));
    }
  }, [runFeedback, runResult, isVerticalResizing]);

  const runSummary = runResult ? formatRunSummary(runResult) : "";

  const functionParameters = Array.isArray(content.parameters)
    ? content.parameters.filter(
      (item): item is { name: string; type: string } =>
        Boolean(item) && typeof item === "object" && typeof item.name === "string" && typeof item.type === "string",
    )
    : [];

  return (
    <div
      ref={layoutRef}
      className={cn(
        "grid h-full min-h-0 w-full bg-background",
        isResizing ? "select-none cursor-col-resize" : "",
      )}
      style={{ gridTemplateColumns: `${leftPaneWidth}% 10px minmax(0, 1fr)` }}
    >
        <section className="min-h-0 overflow-y-auto border-r border-border/70 bg-white">
          <div className="border-b border-[#eef2f7] px-6 py-4">
            <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.12em] text-[#94a3b8]">
              <Braces size={14} />
              题目说明
            </div>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div
              className="prose prose-sm max-w-none leading-7 text-[#40374d]"
              dangerouslySetInnerHTML={{ __html: renderLatexInHtml(descriptionHtml) }}
            />

            {questionMode === "program" && content.input_description ? (
              <div className="rounded-2xl border border-[#ebeef5] bg-[#f8fafc] px-4 py-3.5">
                <p className="text-[12px] text-[#94a3b8]">输入说明</p>
                <p className="mt-2 text-[13px] leading-6 text-[#2c2438]">{content.input_description}</p>
              </div>
            ) : null}

            {questionMode === "program" && content.output_description ? (
              <div className="rounded-2xl border border-[#ebeef5] bg-[#f8fafc] px-4 py-3.5">
                <p className="text-[12px] text-[#94a3b8]">输出说明</p>
                <p className="mt-2 text-[13px] leading-6 text-[#2c2438]">{content.output_description}</p>
              </div>
            ) : null}

            {questionMode === "function" && content.signature ? (
              <div className="rounded-2xl border border-[#ebeef5] bg-[#f8fafc] px-4 py-3.5">
                <p className="text-[12px] text-[#94a3b8]">函数签名</p>
                <pre className="mt-2 overflow-x-auto text-[13px] leading-6 text-[#2c2438]">
                  {content.signature}
                </pre>
              </div>
            ) : null}

            {questionMode === "function" && (content.function_name || functionParameters.length > 0 || content.return_type) ? (
              <div className="rounded-2xl border border-[#ebeef5] bg-[#f8fafc] px-4 py-3.5">
                <p className="text-[12px] text-[#94a3b8]">函数要求</p>
                <div className="mt-2 space-y-2 text-[13px] leading-6 text-[#2c2438]">
                  {content.function_name ? (
                    <p>
                      <span className="text-[#94a3b8]">函数名：</span>
                      <span>{content.function_name}</span>
                    </p>
                  ) : null}
                  {functionParameters.length > 0 ? (
                    <div>
                      <p className="text-[#94a3b8]">参数</p>
                      <ul className="mt-1 space-y-1">
                        {functionParameters.map((item) => (
                          <li key={`${item.name}-${item.type}`}>
                            {item.name}: {item.type}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {content.return_type ? (
                    <p>
                      <span className="text-[#94a3b8]">返回值：</span>
                      <span>{content.return_type}</span>
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {examples.length > 0 ? (
              <div className="rounded-2xl border border-[#e8edf6] bg-[#fafcff] px-4 py-3.5">
                <p className="text-[13px] font-medium text-[#334155]">{questionMode === "program" ? "示例输入输出" : "示例测试"}</p>
                {questionMode === "program" ? (
                  <div className="mt-3 space-y-3">
                    {examples.map((item, index) => (
                      <div key={`${item.input}-${item.output}-${index}`} className="rounded-xl border border-[#e7ecf4] bg-white px-3 py-3">
                        <p className="text-[12px] font-medium text-[#94a3b8]">示例 {index + 1}</p>
                        <div className="mt-2 space-y-2 text-[13px] leading-6 text-[#334155]">
                          <div className="space-y-1">
                            <span className="text-[12px] font-medium text-[#94a3b8]">输入</span>
                            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2">{item.input}</pre>
                          </div>
                          <div className="space-y-1">
                            <span className="text-[12px] font-medium text-[#94a3b8]">输出</span>
                            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2">{item.output}</pre>
                          </div>
                          {item.explanation ? (
                            <div className="space-y-1">
                              <span className="text-[12px] font-medium text-[#94a3b8]">说明</span>
                              <p>{item.explanation}</p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-[12px] leading-6 text-[#6b7280]">
                    这道题已配置 {examples.length} 组示例，可在右侧测试面板中查看输入与预期输出。
                  </p>
                )}
              </div>
            ) : null}

            {content.constraints?.length ? (
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-[#334155]">约束条件</p>
                <ul className="space-y-2 text-[13px] leading-6 text-[#5d556a]">
                  {content.constraints.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#94a3b8]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        <button
          type="button"
          aria-label="调整左右区域宽度"
          onPointerDown={(event) => {
            event.preventDefault();
            setIsResizing(true);
          }}
          className="group relative hidden bg-[#f8fafc] transition-colors hover:bg-[#eef2ff] xl:block"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 transition-colors group-hover:bg-primary/60" />
          <span className="absolute left-1/2 top-1/2 h-10 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#dbe3ef] transition-colors group-hover:bg-[#9fb6ff]" />
        </button>

        <section className="flex min-h-0 flex-col overflow-hidden bg-white">
          <div className="shrink-0 border-b border-[#edf0f6] px-5 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[13px] font-medium text-[#6b7280]">代码作答</div>

              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
                <div className="min-w-[140px] flex-1 sm:w-[160px] sm:flex-none">
                  <Select
                    value={language}
                    disabled={isRunning}
                    onValueChange={(value) => handleLanguageChange(value as CodeLanguage)}
                  >
                    <SelectTrigger className="h-10 rounded-full border-[#d8deea] bg-white text-[13px] text-[#1f2937]">
                      <SelectValue placeholder="选择语言" />
                    </SelectTrigger>
                    <SelectContent>
                      {supportedLanguages.map((item) => (
                        <SelectItem key={item} value={item}>
                          {LANGUAGE_LABELS[item]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <button
                  type="button"
                  onClick={handleResetCurrentLanguage}
                  disabled={isRunning}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-[#d8deea] bg-white px-3 py-2 text-[12px] font-medium text-[#4b5563] transition-colors hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RotateCcw size={13} />
                  恢复模板
                </button>

                <button
                  type="button"
                  onClick={handleRun}
                  disabled={isRunning}
                  aria-busy={isRunning}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-[#cddcfb] bg-[#eef4ff] px-4 py-2 text-[12px] font-medium text-[#315dca] transition-colors hover:bg-[#e2ecff] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <Play size={14} />
                  {isRunning ? "运行中..." : "运行代码"}
                </button>
              </div>
            </div>
          </div>

          <div
            ref={rightPaneRef}
            className={cn(
              "grid min-h-0 flex-1",
              isVerticalResizing ? "select-none cursor-row-resize" : "",
            )}
            style={{
              gridTemplateRows: `minmax(0, calc(${100 - bottomPaneHeight}% - 5px)) 10px minmax(0, calc(${bottomPaneHeight}% - 5px))`,
            }}
          >
            <div className="flex min-h-0 flex-col border-b border-[#edf0f6] bg-[#f7f9fc]">
              <div className="shrink-0 flex items-center justify-between border-b border-[#e7ecf4] bg-white px-5 py-3 text-[12px] text-[#6b7280]">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#f87171]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#34d399]" />
                </div>
                <span>{LANGUAGE_LABELS[language]}</span>
                {questionMode === "function" && content.function_name ? <span className="truncate text-[#9ca3af]">{content.function_name}</span> : <span className="w-6" />}
              </div>
              <div className="min-h-0 flex-1 overflow-hidden bg-[#f7f9fc]">
                <Editor
                  height="100%"
                  language={MONACO_LANGUAGE_MAP[language]}
                  path={getMonacoModelPath(question.question_id, language)}
                  theme="vs"
                  value={currentCode}
                  beforeMount={registerLanguageCompletions}
                  onChange={(value) => handleCodeChange(value ?? "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineHeight: 22,
                    roundedSelection: true,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    quickSuggestions: true,
                    suggestOnTriggerCharacters: true,
                    wordBasedSuggestions: "currentDocument",
                    tabSize: LANGUAGE_TAB_SIZE[language],
                    padding: { top: 16, bottom: 16 },
                  }}
                />
              </div>
            </div>

            <button
              type="button"
              aria-label="调整上下区域高度"
              onPointerDown={(event) => {
                event.preventDefault();
                setIsVerticalResizing(true);
              }}
              className="group relative bg-[#f8fafc] transition-colors hover:bg-[#eef2ff]"
            >
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/80 transition-colors group-hover:bg-primary/60" />
              <span className="absolute left-1/2 top-1/2 h-1.5 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#dbe3ef] transition-colors group-hover:bg-[#9fb6ff]" />
            </button>

            <div className="grid min-h-0 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1.05fr)_1px_minmax(280px,0.95fr)]">
              <div className="min-h-0 overflow-y-auto bg-[#fbfcfe]">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#edf0f6] bg-[#fbfcfe] px-5 py-3">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-[#334155]">
                    <TerminalSquare size={14} className="text-[#5b8def]" />
                    测试面板
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab("sample")}
                      disabled={isRunning}
                      className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                        activeTab === "sample"
                          ? "bg-white text-[#111827] shadow-sm"
                          : "text-[#6b7280] hover:bg-[#f1f5f9] hover:text-[#334155]"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      示例测试
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("custom")}
                      disabled={isRunning}
                      className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                        activeTab === "custom"
                          ? "bg-white text-[#111827] shadow-sm"
                          : "text-[#6b7280] hover:bg-[#f1f5f9] hover:text-[#334155]"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      自定义测试
                    </button>
                  </div>
                </div>

                <div className="space-y-4 px-5 py-4">
                  {activeTab === "sample" ? (
                    sampleTests.length > 0 ? (
                      sampleTests.map((item, index) => (
                        <div
                          key={`${item.input}-${index}`}
                          className="rounded-[0.95rem] border border-[#e6eaf2] bg-white px-4 py-3"
                        >
                          <p className="text-[12px] font-medium text-[#94a3b8]">测试 {index + 1}</p>
                          <div className="mt-3 grid gap-2 text-[13px] leading-6 text-[#334155]">
                            <div className="space-y-1">
                              <span className="text-[12px] font-medium text-[#94a3b8]">输入</span>
                              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2">{item.input}</pre>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[12px] font-medium text-[#94a3b8]">预期输出</span>
                              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2">{item.expected_output}</pre>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-[13px] text-[#94a3b8]">当前题目尚未配置示例测试。</p>
                    )
                  ) : (
                    <div className="space-y-3">
                      <textarea
                        aria-label="自定义输入"
                        value={normalized.custom_input ?? ""}
                        onChange={(event) => handleCustomInputChange(event.target.value)}
                        disabled={isRunning}
                        spellCheck={false}
                        className="min-h-[120px] w-full rounded-[0.95rem] border border-[#dbe3ef] bg-white px-4 py-3 font-mono text-[13px] leading-6 text-[#1f2937] outline-none placeholder:text-[#94a3b8] focus:border-[#7aa2ff]"
                        placeholder="输入你自己的测试用例，例如：nums = [2,7,11,15]\ntarget = 9"
                      />
                      <p className="text-[12px] leading-5 text-[#94a3b8]">
                        自定义输入会随作答一起保存，并用于本次运行结果展示。
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="hidden bg-border/70 lg:block" />

              <div className="min-h-0 overflow-y-auto bg-[#fbfcfe]">
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[#edf0f6] bg-[#fbfcfe] px-5 py-3 text-[12px] font-medium text-[#334155]">
                  <TerminalSquare size={14} className="text-[#10b981]" />
                  运行结果
                </div>

                <div className="space-y-4 px-5 py-4">
                  <div className="rounded-[0.95rem] border border-dashed border-[#dbe3ef] bg-white px-4 py-4">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[#94a3b8]">概览</p>
                    <div className="mt-3 space-y-3 text-[13px] leading-6 text-[#334155]">
                        <p className="font-medium text-[#1f2937]">
                          {isRunning
                            ? "正在运行代码..."
                            : runFeedback
                              || runSummary
                              || (isRunResultStale ? "代码已更新，请重新运行以查看最新结果。" : normalized.last_run_output)
                              || "点击“运行代码”后，这里会显示运行结果。"}
                        </p>

                      {runResult?.mode === "sample" && runResult.case_count > 0 ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2">
                            <p className="text-[12px] text-[#94a3b8]">通过用例</p>
                            <p className="mt-1 text-[14px] font-medium text-[#1f2937]">
                              {runResult.passed_count} / {runResult.case_count}
                            </p>
                          </div>
                          <div className="rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2">
                            <p className="text-[12px] text-[#94a3b8]">未通过用例</p>
                            <p className="mt-1 text-[14px] font-medium text-[#1f2937]">
                              {Math.max(runResult.case_count - runResult.passed_count, 0)}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {runResult?.mode === "sample" && (runResult.stderr || runResult.compile_output) ? (
                        <div className="space-y-3">
                          {runResult.stderr ? (
                            <div className="space-y-1">
                              <span className="text-[12px] font-medium text-[#94a3b8]">错误输出</span>
                              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2 font-mono text-[13px] leading-6 text-[#334155]">
                                {runResult.stderr}
                              </pre>
                            </div>
                          ) : null}
                          {runResult.compile_output ? (
                            <div className="space-y-1">
                              <span className="text-[12px] font-medium text-[#94a3b8]">编译输出</span>
                              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2 font-mono text-[13px] leading-6 text-[#334155]">
                                {runResult.compile_output}
                              </pre>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {runResult?.mode === "custom" ? (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <span className="text-[12px] font-medium text-[#94a3b8]">执行结果</span>
                            <p className="rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2 text-[13px] leading-6 text-[#334155]">
                              {runResult.status === "passed"
                                ? (runResult.stdout ? "代码已成功执行，并产生了运行输出。" : "代码已成功执行，但没有产生标准输出。")
                                : `执行失败：${getRunStatusLabel(runResult.status)}`}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <span className="text-[12px] font-medium text-[#94a3b8]">用户输入</span>
                            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2 font-mono text-[13px] leading-6 text-[#334155]">
                              {customRunInput || "无"}
                            </pre>
                          </div>
                          <div className="space-y-1">
                            <span className="text-[12px] font-medium text-[#94a3b8]">运行输出</span>
                            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2 font-mono text-[13px] leading-6 text-[#334155]">
                              {runResult.stdout || "程序没有输出任何内容。"}
                            </pre>
                          </div>
                          {runResult.stderr ? (
                            <div className="space-y-1">
                              <span className="text-[12px] font-medium text-[#94a3b8]">错误输出</span>
                              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2 font-mono text-[13px] leading-6 text-[#334155]">
                                {runResult.stderr}
                              </pre>
                            </div>
                          ) : null}
                          {runResult.compile_output ? (
                            <div className="space-y-1">
                              <span className="text-[12px] font-medium text-[#94a3b8]">编译输出</span>
                              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2 font-mono text-[13px] leading-6 text-[#334155]">
                                {runResult.compile_output}
                              </pre>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {runResult?.mode === "sample" && runResult.cases.length > 0 ? (
                    <div className="space-y-3">
                      {runResult.cases.map((item, index) => (
                        <div
                          key={`${item.name}-${index}`}
                          className="rounded-[0.95rem] border border-[#e6eaf2] bg-white px-4 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[13px] font-medium text-[#334155]">{item.name}</p>
                            <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[12px] text-[#475569]">
                              {formatCaseStatusLabel(item.status)}
                            </span>
                          </div>
                          <div className="mt-3 grid gap-3 text-[13px] leading-6 text-[#334155]">
                            <div className="space-y-1">
                              <span className="text-[12px] font-medium text-[#94a3b8]">输入</span>
                              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2 font-mono text-[13px] leading-6 text-[#334155]">
                                {item.input || "无"}
                              </pre>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[12px] font-medium text-[#94a3b8]">预期输出</span>
                              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2 font-mono text-[13px] leading-6 text-[#334155]">
                                {item.expected_output || "无"}
                              </pre>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[12px] font-medium text-[#94a3b8]">实际输出</span>
                              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2 font-mono text-[13px] leading-6 text-[#334155]">
                                {item.actual_output || "无输出"}
                              </pre>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[12px] font-medium text-[#94a3b8]">状态</span>
                              <p className="rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2 text-[13px] leading-6 text-[#334155]">
                                {formatCaseStatusLabel(item.status)}
                              </p>
                            </div>
                            {item.message ? (
                              <div className="space-y-1">
                                <span className="text-[12px] font-medium text-[#94a3b8]">说明</span>
                                <p className="rounded-lg border border-[#e7ecf4] bg-[#f8fafc] px-3 py-2 text-[13px] leading-6 text-[#334155]">
                                  {item.message}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="rounded-[0.95rem] border border-[#e6eaf2] bg-white px-4 py-3 text-[12px] leading-6 text-[#6b7280]">
                    <p className="font-medium text-[#334155]">说明</p>
                    <p className="mt-2">
                      {runResult?.mode === "custom"
                        ? "自定义测试会展示本次输入和执行输出，便于检查代码表现。"
                        : "运行代码会调用考试环境的在线执行接口，并展示本次返回的结果摘要。"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
    </div>
  );
}

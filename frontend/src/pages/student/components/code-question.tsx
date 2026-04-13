import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { renderLatexInHtml } from "@/components/ui/latex-text";
import { Braces, Play, TerminalSquare } from "lucide-react";
import type { ICodeAnswerContent, ICodeQuestionContent, IExamQuestionForStudent } from "@/types";
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

const DEFAULT_STARTER_CODE: Record<CodeLanguage, string> = {
  python: "class Solution:\n    def solve(self, *args):\n        # 请在这里实现你的代码\n        pass\n",
  javascript: "function solve(...args) {\n  // 请在这里实现你的代码\n}\n",
  java: "class Solution {\n    public Object solve() {\n        // 请在这里实现你的代码\n        return null;\n    }\n}\n",
  cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nclass Solution {\npublic:\n    int solve() {\n        // 请在这里实现你的代码\n        return 0;\n    }\n};\n",
  c: "#include <stdio.h>\n\nint solve() {\n    // 请在这里实现你的代码\n    return 0;\n}\n",
  go: "package main\n\nfunc solve() int {\n\t// 请在这里实现你的代码\n\treturn 0\n}\n",
};

function normalizeAnswer(answer: Record<string, unknown>): ICodeAnswerContent {
  return {
    language: (answer.language as CodeLanguage | undefined) ?? "python",
    code: typeof answer.code === "string" ? answer.code : "",
    custom_input: typeof answer.custom_input === "string" ? answer.custom_input : "",
    last_run_input: typeof answer.last_run_input === "string" ? answer.last_run_input : "",
    last_run_output: typeof answer.last_run_output === "string" ? answer.last_run_output : "",
  };
}

export function CodeQuestion({ question, answer, onChange }: Props) {
  const content = (question.content ?? {}) as ICodeQuestionContent;
  const normalized = normalizeAnswer(answer);
  const starterCode = content.starter_code ?? {};
  const supportedLanguages = DEFAULT_LANGUAGES.filter(
    (language) => typeof starterCode[language] === "string" || Boolean(DEFAULT_STARTER_CODE[language]),
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

  const descriptionHtml = useMemo(
    () => content.description ?? content.text ?? question.title,
    [content.description, content.text, question.title],
  );

  const currentCode = normalized.code || starterCode[language] || DEFAULT_STARTER_CODE[language];
  const currentRunInput = activeTab === "custom"
    ? normalized.custom_input ?? ""
    : sampleTests[0]?.input ?? "";

  useEffect(() => {
    if (!normalized.language || normalized.language !== language) {
      onChange({
        ...normalized,
        language,
        code: currentCode,
      });
    }
  }, [currentCode, language, normalized, onChange]);

  const handleLanguageChange = (nextLanguage: CodeLanguage) => {
    onChange({
      ...normalized,
      language: nextLanguage,
      code:
        normalized.language === nextLanguage && normalized.code
          ? normalized.code
          : starterCode[nextLanguage] || DEFAULT_STARTER_CODE[nextLanguage],
    });
    setRunFeedback("");
  };

  const handleCodeChange = (value: string) => {
    onChange({
      ...normalized,
      language,
      code: value,
    });
  };

  const handleCustomInputChange = (value: string) => {
    onChange({
      ...normalized,
      language,
      custom_input: value,
    });
  };

  const handleRun = () => {
    if (!currentCode.trim()) {
      setRunFeedback("请先输入代码，再执行示例测试。");
      return;
    }

    const feedback = activeTab === "custom"
      ? "当前考试环境未启用在线判题，本次已保存你的代码和自定义输入。请结合示例结果自行检查后提交。"
      : "当前考试环境未启用在线判题，本次已按示例测试保存代码。你可以继续修改代码或切换到自定义测试。";

    onChange({
      ...normalized,
      language,
      code: currentCode,
      last_run_input: currentRunInput,
      last_run_output:
        activeTab === "custom"
          ? "考试环境暂不执行自定义测试，仅保存输入。"
          : sampleTests.map((item, index) => `示例 ${index + 1} 预期输出：${item.expected_output}`).join("\n"),
    });
    setRunFeedback(feedback);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="overflow-hidden rounded-[1.1rem] border border-[#ece4f6] bg-white">
          <div className="border-b border-[#f0e9f8] px-5 py-4">
            <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.12em] text-[#8f85a0]">
              <Braces size={14} />
              编程题说明
            </div>
          </div>
          <div className="space-y-5 px-5 py-5">
            <div
              className="prose prose-sm max-w-none leading-7 text-[#40374d]"
              dangerouslySetInnerHTML={{ __html: renderLatexInHtml(descriptionHtml) }}
            />

            {content.signature ? (
              <div className="rounded-[0.95rem] bg-[#f7f3fc] px-4 py-3">
                <p className="text-[12px] text-[#8f85a0]">函数签名</p>
                <pre className="mt-2 overflow-x-auto text-[13px] leading-6 text-[#2c2438]">
                  {content.signature}
                </pre>
              </div>
            ) : null}

            {examples.length > 0 ? (
              <div className="space-y-3">
                <p className="text-[13px] font-medium text-[#2a2236]">示例测试用例</p>
                {examples.map((example, index) => (
                  <div key={`${example.input}-${index}`} className="rounded-[0.95rem] border border-[#efe8f8] bg-[#fcfbfe] px-4 py-4">
                    <p className="text-[12px] font-medium text-[#8f85a0]">示例 {index + 1}</p>
                    <div className="mt-3 space-y-2 text-[13px] leading-6 text-[#40374d]">
                      <div>
                        <span className="font-medium text-[#2a2236]">输入：</span>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-white px-3 py-2">{example.input}</pre>
                      </div>
                      <div>
                        <span className="font-medium text-[#2a2236]">输出：</span>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-white px-3 py-2">{example.output}</pre>
                      </div>
                      {example.explanation ? (
                        <div>
                          <span className="font-medium text-[#2a2236]">解释：</span>
                          <p className="mt-1">{example.explanation}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {content.constraints?.length ? (
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-[#2a2236]">约束条件</p>
                <ul className="space-y-2 text-[13px] leading-6 text-[#5d556a]">
                  {content.constraints.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6a4cdc]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        <section className="overflow-hidden rounded-[1.1rem] border border-[#ece4f6] bg-[#fbf9fe]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0e9f8] px-5 py-4">
            <div className="w-[180px]">
              <Select value={language} onValueChange={(value) => handleLanguageChange(value as CodeLanguage)}>
                <SelectTrigger className="h-10 rounded-full border-[#ddd2f5] bg-white text-[13px]">
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
              onClick={handleRun}
              className="inline-flex items-center gap-2 rounded-full border border-[#ddd2f5] bg-white px-4 py-2 text-[12px] font-medium text-[#6647d5] transition-colors hover:bg-[#f7f2ff]"
            >
              <Play size={14} />
              运行代码
            </button>
          </div>

          <div className="px-5 py-5">
            <div className="overflow-hidden rounded-[1rem] border border-[#e8def6] bg-[#1f1830] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3 text-[12px] text-[#d9d1ef]">
                <span>{LANGUAGE_LABELS[language]}</span>
                {content.function_name ? <span>{content.function_name}</span> : null}
              </div>
              <Editor
                height="420px"
                language={MONACO_LANGUAGE_MAP[language]}
                theme="vs-dark"
                value={currentCode}
                onChange={(value) => handleCodeChange(value ?? "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineHeight: 22,
                  roundedSelection: true,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  quickSuggestions: true,
                  suggestOnTriggerCharacters: true,
                  wordBasedSuggestions: "currentDocument",
                  tabSize: 2,
                  padding: { top: 16, bottom: 16 },
                }}
              />
            </div>

            <div className="mt-5 overflow-hidden rounded-[1rem] border border-[#ece4f6] bg-white">
              <div className="flex items-center gap-2 border-b border-[#f0e9f8] px-4 py-3">
                <button
                  type="button"
                  onClick={() => setActiveTab("sample")}
                  className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                    activeTab === "sample"
                      ? "bg-[#efe9ff] text-[#5c3fcf]"
                      : "text-[#7f748f] hover:bg-[#f7f2ff]"
                  }`}
                >
                  示例测试
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("custom")}
                  className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                    activeTab === "custom"
                      ? "bg-[#efe9ff] text-[#5c3fcf]"
                      : "text-[#7f748f] hover:bg-[#f7f2ff]"
                  }`}
                >
                  自定义测试
                </button>
              </div>

              <div className="space-y-4 px-4 py-4">
                {activeTab === "sample" ? (
                  sampleTests.length > 0 ? (
                    sampleTests.map((item, index) => (
                      <div key={`${item.input}-${index}`} className="rounded-[0.95rem] bg-[#faf8fd] px-4 py-3">
                        <p className="text-[12px] font-medium text-[#8f85a0]">测试 {index + 1}</p>
                        <div className="mt-2 grid gap-2 text-[13px] leading-6 text-[#463d53]">
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white px-3 py-2">{item.input}</pre>
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white px-3 py-2">{item.expected_output}</pre>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-[13px] text-[#8f85a0]">当前题目尚未配置示例测试。</p>
                  )
                ) : (
                  <div className="space-y-3">
                    <textarea
                      value={normalized.custom_input ?? ""}
                      onChange={(event) => handleCustomInputChange(event.target.value)}
                      spellCheck={false}
                      className="min-h-[120px] w-full rounded-[0.95rem] border border-[#e8def6] bg-[#faf8fd] px-4 py-3 font-mono text-[13px] leading-6 text-[#2f273c] outline-none focus:border-[#6a4cdc]"
                      placeholder="输入你自己的测试用例，例如：nums = [2,7,11,15]\ntarget = 9"
                    />
                    <p className="text-[12px] leading-5 text-[#8f85a0]">
                      当前考试环境会保存你的自定义输入，但不会在线执行代码。
                    </p>
                  </div>
                )}

                <div className="rounded-[0.95rem] border border-dashed border-[#ded2f5] bg-[#fcfbfe] px-4 py-3 text-[13px] leading-6 text-[#5e556c]">
                  <div className="flex items-center gap-2 font-medium text-[#463d53]">
                    <TerminalSquare size={14} className="text-[#6a4cdc]" />
                    运行结果
                  </div>
                  <p className="mt-2 whitespace-pre-wrap">
                    {runFeedback || normalized.last_run_output || "点击“运行代码”后，这里会显示示例测试保存结果。"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

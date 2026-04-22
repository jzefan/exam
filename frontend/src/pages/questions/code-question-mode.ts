import type { ICodeQuestionContent } from "@/types";

export type CodeQuestionMode = "program" | "function";

export interface CodeQuestionExampleDraft {
  input: string;
  output: string;
  explanation: string;
}

export interface CodeQuestionSampleTestDraft {
  input: string;
  expectedOutput: string;
}

export interface CodeQuestionDetails {
  mode: CodeQuestionMode;
  inputDescription: string;
  outputDescription: string;
  constraintsText: string;
  examples: CodeQuestionExampleDraft[];
  sampleTests: CodeQuestionSampleTestDraft[];
  functionName: string;
  signature: string;
  returnType: string;
  parametersText: string;
}

function trimOrEmpty(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeExample(value: unknown): CodeQuestionExampleDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = trimOrEmpty((value as Record<string, unknown>).input);
  const output = trimOrEmpty((value as Record<string, unknown>).output);
  const explanation = trimOrEmpty((value as Record<string, unknown>).explanation);

  if (!input && !output && !explanation) {
    return null;
  }

  return { input, output, explanation };
}

function normalizeSampleTest(value: unknown): CodeQuestionSampleTestDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = trimOrEmpty((value as Record<string, unknown>).input);
  const expectedOutput = trimOrEmpty((value as Record<string, unknown>).expected_output);

  if (!input && !expectedOutput) {
    return null;
  }

  return { input, expectedOutput };
}

export function createEmptyCodeQuestionDetails(): CodeQuestionDetails {
  return {
    mode: "program",
    inputDescription: "",
    outputDescription: "",
    constraintsText: "",
    examples: [{ input: "", output: "", explanation: "" }],
    sampleTests: [{ input: "", expectedOutput: "" }],
    functionName: "",
    signature: "",
    returnType: "",
    parametersText: "",
  };
}

export function extractCodeQuestionDetails(content: Record<string, unknown> | ICodeQuestionContent | null | undefined): CodeQuestionDetails {
  const details = createEmptyCodeQuestionDetails();
  if (!content || typeof content !== "object") {
    return details;
  }

  details.mode = content.mode === "function" ? "function" : "program";
  details.inputDescription = trimOrEmpty(content.input_description);
  details.outputDescription = trimOrEmpty(content.output_description);
  details.functionName = trimOrEmpty(content.function_name);
  details.signature = trimOrEmpty(content.signature);
  details.returnType = trimOrEmpty(content.return_type);

  if (Array.isArray(content.constraints)) {
    details.constraintsText = content.constraints
      .map((item) => trimOrEmpty(item))
      .filter(Boolean)
      .join("\n");
  }

  if (Array.isArray(content.examples)) {
    const examples = content.examples
      .map((item) => normalizeExample(item))
      .filter((item): item is CodeQuestionExampleDraft => item !== null);
    if (examples.length > 0) {
      details.examples = examples;
    }
  }

  if (Array.isArray(content.sample_tests)) {
    const sampleTests = content.sample_tests
      .map((item) => normalizeSampleTest(item))
      .filter((item): item is CodeQuestionSampleTestDraft => item !== null);
    if (sampleTests.length > 0) {
      details.sampleTests = sampleTests;
    }
  }

  if (Array.isArray(content.parameters)) {
    details.parametersText = content.parameters
      .filter((item): item is { name: string; type: string } => Boolean(item) && typeof item === "object" && typeof item.name === "string" && typeof item.type === "string")
      .map((item) => `${item.name}: ${item.type}`)
      .join("\n");
  }

  return details;
}

export function buildCodeQuestionContent({
  contentHtml,
  plainText,
  details,
}: {
  contentHtml: string;
  plainText: string;
  details: CodeQuestionDetails;
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    html: contentHtml,
    text: plainText,
    mode: details.mode,
  };

  const sampleTests = details.sampleTests
    .map((item) => ({
      input: item.input.trim(),
      expected_output: item.expectedOutput.trim(),
      is_public: true,
    }))
    .filter((item) => item.input || item.expected_output);

  if (sampleTests.length > 0) {
    base.sample_tests = sampleTests;
  }

  if (details.mode === "program") {
    if (details.inputDescription.trim()) {
      base.input_description = details.inputDescription.trim();
    }
    if (details.outputDescription.trim()) {
      base.output_description = details.outputDescription.trim();
    }

    const constraints = details.constraintsText
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    if (constraints.length > 0) {
      base.constraints = constraints;
    }

    const examples = details.examples
      .map((item) => ({
        input: item.input.trim(),
        output: item.output.trim(),
        explanation: item.explanation.trim(),
      }))
      .filter((item) => item.input || item.output || item.explanation)
      .map((item) => (item.explanation ? item : { input: item.input, output: item.output }));

    if (examples.length > 0) {
      base.examples = examples;
    }

    return base;
  }

  if (details.functionName.trim()) {
    base.function_name = details.functionName.trim();
  }
  if (details.signature.trim()) {
    base.signature = details.signature.trim();
  }
  if (details.returnType.trim()) {
    base.return_type = details.returnType.trim();
  }

  const parameters = details.parametersText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split(":");
      return {
        name: name?.trim() ?? "",
        type: rest.join(":").trim(),
      };
    })
    .filter((item) => item.name && item.type);

  if (parameters.length > 0) {
    base.parameters = parameters;
  }

  return base;
}

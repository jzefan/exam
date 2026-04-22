import { describe, expect, it } from "vitest";

import {
  buildCodeQuestionContent,
  createEmptyCodeQuestionDetails,
  extractCodeQuestionDetails,
} from "./code-question-mode";

describe("code-question-mode helpers", () => {
  it("builds program mode content with full-program fields", () => {
    const details = createEmptyCodeQuestionDetails();
    details.mode = "program";
    details.inputDescription = "输入两个整数。";
    details.outputDescription = "输出两个整数之和。";
    details.constraintsText = "1 <= a, b <= 1000";
    details.examples = [
      {
        input: "1 2",
        output: "3",
        explanation: "",
      },
    ];
    details.sampleTests = [
      {
        input: "1 2\n",
        expectedOutput: "3\n",
      },
    ];

    expect(
      buildCodeQuestionContent({
        contentHtml: "<p>求和</p>",
        plainText: "求和",
        details,
      }),
    ).toEqual({
      html: "<p>求和</p>",
      text: "求和",
      mode: "program",
      input_description: "输入两个整数。",
      output_description: "输出两个整数之和。",
      constraints: ["1 <= a, b <= 1000"],
      examples: [
        {
          input: "1 2",
          output: "3",
        },
      ],
      sample_tests: [
        {
          input: "1 2",
          expected_output: "3",
          is_public: true,
        },
      ],
    });
  });

  it("extracts function mode metadata from existing question content", () => {
    const details = extractCodeQuestionDetails({
      mode: "function",
      function_name: "twoSum",
      signature: "twoSum(nums: int[], target: int) -> int[]",
      return_type: "int[]",
      parameters: [
        { name: "nums", type: "int[]" },
        { name: "target", type: "int" },
      ],
      sample_tests: [
        {
          input: "nums=[2,7,11,15], target=9",
          expected_output: "[0,1]",
        },
      ],
    });

    expect(details.mode).toBe("function");
    expect(details.functionName).toBe("twoSum");
    expect(details.signature).toBe("twoSum(nums: int[], target: int) -> int[]");
    expect(details.returnType).toBe("int[]");
    expect(details.parametersText).toBe("nums: int[]\ntarget: int");
    expect(details.sampleTests).toEqual([
      {
        input: "nums=[2,7,11,15], target=9",
        expectedOutput: "[0,1]",
      },
    ]);
  });
});

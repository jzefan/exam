import { describe, expect, it } from "vitest";

import { render, screen } from "@/test/test-utils";
import type { IQuestion } from "@/types";

import { QuestionPreviewCard } from "./question-preview-card";

const sampleQuestion: IQuestion = {
  id: "question-1",
  type: "choice",
  title: "默认标题",
  content: { text: "下面关于 TCP 三次握手的说法，正确的是？" },
  options: {
    A: "客户端发送 SYN",
    B: "服务端发送 ACK",
    C: "客户端发送 FIN",
    D: "服务端直接关闭连接",
  },
  answer: { correct: "A" },
  analysis: "握手的第一步由客户端发起 SYN。",
  difficulty: 3,
  score: 5,
  usage_count: 2,
  question_bank_id: "bank-1",
  question_bank_name: "网络基础",
  tags: [
    { id: "tag-1", name: "TCP", type: "knowledge", question_count: 1, created_at: "2026-04-01T00:00:00Z" },
  ],
  knowledge_points: [
    {
      id: "kp-1",
      name: "三次握手",
      parent_id: null,
      description: "连接建立",
      created_at: "2026-04-01T00:00:00Z",
      direction_id: null,
      tags: [],
      difficulty: null,
      question_count: 1,
    },
  ],
  created_by: "user-1",
  created_by_name: "Teacher",
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

describe("QuestionPreviewCard", () => {
  it("renders the full question preview content in detailed mode", () => {
    render(<QuestionPreviewCard question={sampleQuestion} defaultExpanded />);

    expect(screen.getByText("下面关于 TCP 三次握手的说法，正确的是？")).toBeInTheDocument();
    expect(screen.getByText("A. 客户端发送 SYN")).toBeInTheDocument();
    expect(screen.getByText(/答案：A/)).toBeInTheDocument();
    expect(screen.getByText(/解析：/)).toBeInTheDocument();
    expect(screen.getByText("TCP")).toBeInTheDocument();
    expect(screen.getByText("三次握手")).toBeInTheDocument();
    expect(screen.getByText("5 分")).toBeInTheDocument();
  });

  it("supports compact mode while keeping the question stem visible", () => {
    render(<QuestionPreviewCard question={sampleQuestion} mode="compact" />);

    expect(screen.getByText("下面关于 TCP 三次握手的说法，正确的是？")).toBeInTheDocument();
    expect(screen.queryByText(/解析：/)).not.toBeInTheDocument();
  });
});

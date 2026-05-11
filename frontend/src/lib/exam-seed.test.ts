import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeExamSeed,
  peekExamSeed,
  purgeExpiredExamSeeds,
  writeExamSeed,
  type ExamSeedPayload,
} from "./exam-seed";

function makePayload(overrides: Partial<ExamSeedPayload> = {}): ExamSeedPayload {
  return {
    category: "exam",
    title: "考试标题",
    description: "描述",
    question_items: [
      { question_id: "q-1", order: 0, score_override: 10 },
      { question_id: "q-2", order: 1, score_override: null },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("exam-seed", () => {
  it("writeExamSeed 返回一个非空 key，并能被 peek 读出", () => {
    const payload = makePayload();
    const key = writeExamSeed(payload);
    expect(key).toMatch(/\S/);

    const got = peekExamSeed(key);
    expect(got).toEqual(payload);
  });

  it("peek 不会删除数据，可重复读取", () => {
    const key = writeExamSeed(makePayload());
    expect(peekExamSeed(key)).not.toBeNull();
    expect(peekExamSeed(key)).not.toBeNull();
  });

  it("consumeExamSeed 读完即清，第二次返回 null", () => {
    const payload = makePayload({ category: "practice" });
    const key = writeExamSeed(payload);

    const first = consumeExamSeed(key);
    expect(first).toEqual(payload);

    const second = consumeExamSeed(key);
    expect(second).toBeNull();
  });

  it("不存在的 key 返回 null", () => {
    expect(peekExamSeed("does-not-exist")).toBeNull();
    expect(consumeExamSeed("does-not-exist")).toBeNull();
  });

  it("超过 ttl 的数据被丢弃", () => {
    const key = writeExamSeed(makePayload());
    // ttl=0 直接判为过期
    expect(peekExamSeed(key, 0)).toBeNull();
    // 过期后同样从存储里清掉了
    expect(window.sessionStorage.getItem(`exam-seed:${key}`)).toBeNull();
  });

  it("purgeExpiredExamSeeds 清理过期条目且不影响有效条目", () => {
    const liveKey = writeExamSeed(makePayload());
    const staleKey = writeExamSeed(makePayload());

    // 手动把 staleKey 改成一个过期的时间戳
    const staleRaw = window.sessionStorage.getItem(`exam-seed:${staleKey}`);
    expect(staleRaw).not.toBeNull();
    const parsed = JSON.parse(staleRaw as string);
    parsed._ts = Date.now() - 10 * 60 * 1000;
    window.sessionStorage.setItem(`exam-seed:${staleKey}`, JSON.stringify(parsed));

    purgeExpiredExamSeeds(5 * 60 * 1000);

    expect(window.sessionStorage.getItem(`exam-seed:${staleKey}`)).toBeNull();
    expect(peekExamSeed(liveKey)).not.toBeNull();
  });

  it("损坏的 JSON 会被当作无效条目", () => {
    const key = writeExamSeed(makePayload());
    window.sessionStorage.setItem(`exam-seed:${key}`, "not-json{");
    expect(peekExamSeed(key)).toBeNull();
    expect(window.sessionStorage.getItem(`exam-seed:${key}`)).toBeNull();
  });
});

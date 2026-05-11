/**
 * 在"从题目列表直接创建考试/作业"场景下，用来临时传递预填数据。
 *
 * 设计要点：
 * - 数据只存 sessionStorage，避免把几十道题的 ID 塞进 URL。
 * - 一次性消费（consume 后自动删除），防止刷新向导时重复预填。
 * - 自带过期时间（30 分钟），避免旧 seed 残留。
 */

import { createRandomId } from "./random-id";

const STORAGE_PREFIX = "exam-seed:";
/** 30 分钟过期，足够用户在对话框里犹豫一会儿，又避免长期残留。 */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export interface ExamSeedQuestionItem {
  question_id: string;
  order: number;
  score_override: number | null;
}

export interface ExamSeedPayload {
  /** 考试或作业/练习。作业在后端用 category=practice 表示。 */
  category: "exam" | "practice";
  /** 预填的名称；允许缺省。 */
  title?: string;
  /** 预填的描述；允许缺省。 */
  description?: string;
  /** 题目列表，顺序以 order 为准。 */
  question_items: ExamSeedQuestionItem[];
}

interface StoredEnvelope extends ExamSeedPayload {
  /** 写入时的时间戳，用于判断过期。 */
  _ts: number;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function storageKey(seedKey: string): string {
  return `${STORAGE_PREFIX}${seedKey}`;
}

/**
 * 写入一份 seed，返回 seed_key。调用方把 seed_key 拼进 URL：
 *
 *   navigate(`/exams/create?seed_key=${seedKey}`)
 */
export function writeExamSeed(payload: ExamSeedPayload): string {
  const storage = getStorage();
  const seedKey = createRandomId();
  if (!storage) return seedKey;
  const envelope: StoredEnvelope = { ...payload, _ts: Date.now() };
  try {
    storage.setItem(storageKey(seedKey), JSON.stringify(envelope));
  } catch {
    // 存储失败（例如 quota），静默忽略；向导侧会走"没有 seed"的路径。
  }
  return seedKey;
}

/**
 * 读取但不删除，主要给测试或调试用。
 */
export function peekExamSeed(seedKey: string, ttlMs: number = DEFAULT_TTL_MS): ExamSeedPayload | null {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(storageKey(seedKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredEnvelope;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed._ts === "number" && Date.now() - parsed._ts >= ttlMs) {
      storage.removeItem(storageKey(seedKey));
      return null;
    }
    const { _ts: _unused, ...payload } = parsed;
    return payload;
  } catch {
    storage.removeItem(storageKey(seedKey));
    return null;
  }
}

/**
 * 读取并立即删除（一次性消费）。向导进入页面时应该调用这个。
 */
export function consumeExamSeed(seedKey: string, ttlMs: number = DEFAULT_TTL_MS): ExamSeedPayload | null {
  const payload = peekExamSeed(seedKey, ttlMs);
  const storage = getStorage();
  if (storage) {
    storage.removeItem(storageKey(seedKey));
  }
  return payload;
}

/**
 * 清理 sessionStorage 里所有已过期的 seed，防止泄漏。可选调用。
 */
export function purgeExpiredExamSeeds(ttlMs: number = DEFAULT_TTL_MS): void {
  const storage = getStorage();
  if (!storage) return;
  const now = Date.now();
  const toRemove: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as StoredEnvelope;
      if (typeof parsed._ts === "number" && now - parsed._ts > ttlMs) {
        toRemove.push(key);
      }
    } catch {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    storage.removeItem(key);
  }
}

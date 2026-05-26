/**
 * Local draft buffer for in-progress exam answers.
 *
 * Key format: exam-draft:<principal_id>:<attempt_id>
 * TTL: 14 days (defense-in-depth; server is authoritative for submission)
 */

const STORAGE_PREFIX = "exam-draft:";
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface DraftEnvelope {
  answers: Record<string, unknown>;
  last_local_save_ms: number;
  attempt_id: string;
  principal_id: string;
}

let memoryFallback: Map<string, string> | null = null;

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    window.localStorage.setItem("__test__", "1");
    window.localStorage.removeItem("__test__");
    return window.localStorage;
  } catch {
    return null;
  }
}

function draftKey(principalId: string, attemptId: string): string {
  return `${STORAGE_PREFIX}${principalId}:${attemptId}`;
}

function write(key: string, value: string): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(key, value);
      return;
    } catch {
      if (!memoryFallback) {
        console.warn("[exam-draft] localStorage quota exceeded; falling back to in-memory map");
        memoryFallback = new Map();
      }
    }
  }
  if (!memoryFallback) memoryFallback = new Map();
  memoryFallback.set(key, value);
}

function read(key: string): string | null {
  const storage = getStorage();
  if (storage) {
    const val = storage.getItem(key);
    if (val !== null) return val;
  }
  return memoryFallback?.get(key) ?? null;
}

function remove(key: string): void {
  const storage = getStorage();
  if (storage) storage.removeItem(key);
  memoryFallback?.delete(key);
}

function allKeys(): string[] {
  const storage = getStorage();
  const keys: string[] = [];
  if (storage) {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
  }
  if (memoryFallback) {
    for (const k of memoryFallback.keys()) {
      if (k.startsWith(STORAGE_PREFIX) && !keys.includes(k)) keys.push(k);
    }
  }
  return keys;
}

export function setDraft(
  principalId: string,
  attemptId: string,
  answers: Record<string, unknown>,
): void {
  const envelope: DraftEnvelope = {
    answers,
    last_local_save_ms: Date.now(),
    attempt_id: attemptId,
    principal_id: principalId,
  };
  write(draftKey(principalId, attemptId), JSON.stringify(envelope));
}

export function getDraft(principalId: string, attemptId: string): DraftEnvelope | null {
  const raw = read(draftKey(principalId, attemptId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DraftEnvelope;
    if (!parsed || typeof parsed !== "object") return null;
    if (Date.now() - (parsed.last_local_save_ms ?? 0) > TTL_MS) {
      remove(draftKey(principalId, attemptId));
      return null;
    }
    return parsed;
  } catch {
    remove(draftKey(principalId, attemptId));
    return null;
  }
}

export function clearDraft(principalId: string, attemptId: string): void {
  remove(draftKey(principalId, attemptId));
}

export function purgeForPrincipal(principalId: string): void {
  const prefix = `${STORAGE_PREFIX}${principalId}:`;
  allKeys()
    .filter((k) => k.startsWith(prefix))
    .forEach(remove);
}

export function purgeAllExcept(currentPrincipalId: string): void {
  const ownPrefix = `${STORAGE_PREFIX}${currentPrincipalId}:`;
  allKeys()
    .filter((k) => !k.startsWith(ownPrefix))
    .forEach(remove);
}

export function purgeAll(): void {
  allKeys().forEach(remove);
}

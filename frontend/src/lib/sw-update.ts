/**
 * Service worker registration with automatic update adoption.
 *
 * Background: the app precaches its shell + hashed assets via Workbox. Without
 * an explicit update flow a freshly deployed version stays in the SW "waiting"
 * state until every tab is closed, so users keep seeing the old build until they
 * manually (hard-)refresh. This module detects a new version and auto-reloads to
 * it — except during an exam or while a teacher is grading an answer, where an
 * unsolicited reload could discard work (the codebase deliberately avoids
 * clientsClaim for the same reason). The pending update is applied when the
 * user returns to a safe page and the next update check runs.
 */

// 正在答题或阅卷的路径：此时绝不自动重载，等离开后再更新。
const EXAM_PATH = /^\/student\/exam\//;

function onExamPath(): boolean {
  return EXAM_PATH.test(window.location.pathname);
}

function inCriticalWorkflow(): boolean {
  return onExamPath() || window.location.pathname === "/grading";
}

let pendingWorker: ServiceWorker | null = null;
let reloaded = false;

function reloadOnce(worker: ServiceWorker) {
  if (reloaded) return;
  if (inCriticalWorkflow()) {
    pendingWorker = worker;
    return;
  }
  reloaded = true;
  window.location.reload();
}

/** 让新 SW 接管（skipWaiting），激活后重载到最新版本。 */
function activateAndReload(worker: ServiceWorker) {
  if (worker.state === "activated") {
    reloadOnce(worker);
    return;
  }
  worker.addEventListener("statechange", () => {
    if (worker.state === "activated") reloadOnce(worker);
  });
  // sw.ts 已监听该消息并调用 self.skipWaiting()。
  worker.postMessage({ type: "SKIP_WAITING" });
}

/** 有挂起的新版本且当前不在答题或阅卷操作中时，应用更新。 */
function maybeApplyUpdate() {
  if (!pendingWorker || reloaded) return;
  if (inCriticalWorkflow()) return;
  const worker = pendingWorker;
  pendingWorker = null;
  activateAndReload(worker);
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    // 与既有策略保持一致：考试页不注册 SW。
    if (onExamPath()) return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        const markPending = (worker: ServiceWorker | null) => {
          if (!worker) return;
          pendingWorker = worker;
          maybeApplyUpdate();
        };

        // 上一轮已安装、处于 waiting 的新版本。
        if (registration.waiting && navigator.serviceWorker.controller) {
          markPending(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // installed + 已有 controller ⇒ 是“更新”而非首次安装。
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              markPending(registration.waiting ?? installing);
            }
          });
        });

        const check = () => {
          registration.update().catch(() => {});
          maybeApplyUpdate();
        };
        // 周期性检查 + 标签页重新可见/聚焦时检查，尽快发现新部署。
        window.setInterval(check, 60_000);
        window.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
        window.addEventListener("focus", check);
      })
      .catch(() => {
        // 注册失败不致命，应用仍可运行。
      });
  });
}

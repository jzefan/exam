import { useBeforeUnload, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type UseUnsavedGeneratedQuestionsGuardOptions = {
  when: boolean;
  message?: string;
  title?: string;
};

type GeneratedQuestionPersistShape = {
  type: string;
  title: string;
  content: { text: string };
  options: Record<string, string> | null;
  answer: unknown;
  analysis: string | null;
  difficulty: number;
};

const DEFAULT_MESSAGE = "已生成题目还未保存，确定离开当前页面吗？";
const DEFAULT_TITLE = "离开当前页面？";

export function getGeneratedQuestionPersistKey(question: GeneratedQuestionPersistShape) {
  return JSON.stringify({
    type: question.type,
    title: question.title,
    content: question.content,
    options: question.options,
    answer: question.answer,
    analysis: question.analysis,
    difficulty: question.difficulty,
  });
}

export function useUnsavedGeneratedQuestionsGuard({
  when,
  message = DEFAULT_MESSAGE,
  title = DEFAULT_TITLE,
}: UseUnsavedGeneratedQuestionsGuardOptions) {
  const navigate = useNavigate();
  const location = useLocation();
  const allowNextNavigationRef = useRef(false);
  const [pendingNavigation, setPendingNavigation] = useState<null | {
    path: string;
    replace?: boolean;
  }>(null);
  const allowNextNavigation = useCallback(() => {
    allowNextNavigationRef.current = true;
    setPendingNavigation(null);
  }, []);

  const requestNavigation = useCallback(
    (path: string, replace = false) => {
      if (!when || allowNextNavigationRef.current) {
        allowNextNavigationRef.current = true;
        navigate(path, { replace });
        return true;
      }
      setPendingNavigation({ path, replace });
      return false;
    },
    [navigate, when],
  );

  useBeforeUnload(
    useCallback((event: BeforeUnloadEvent) => {
      if (!when || allowNextNavigationRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }, [when]),
  );

  useEffect(() => {
    if (!when) {
      return;
    }

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);

    const shouldAllowHistoryChange = (url?: string | URL | null, replace = false) => {
      if (!when || allowNextNavigationRef.current || url == null) {
        return true;
      }

      const nextUrl = new URL(String(url), window.location.href);
      const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      const currentPath = `${location.pathname}${location.search}${location.hash}`;
      if (nextPath === currentPath) {
        return true;
      }

      setPendingNavigation({ path: nextPath, replace });
      return false;
    };

    window.history.pushState = function pushState(state, unused, url) {
      if (!shouldAllowHistoryChange(url, false)) {
        return;
      }
      originalPushState(state, unused, url);
    };

    window.history.replaceState = function replaceState(state, unused, url) {
      if (!shouldAllowHistoryChange(url, true)) {
        return;
      }
      originalReplaceState(state, unused, url);
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        allowNextNavigationRef.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) {
        return;
      }

      const nextUrl = new URL(anchor.href, window.location.href);
      if (nextUrl.origin !== window.location.origin) {
        return;
      }

      const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      const currentPath = `${location.pathname}${location.search}${location.hash}`;
      if (nextPath === currentPath) {
        return;
      }

      event.preventDefault();
      requestNavigation(nextPath);
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [location.hash, location.pathname, location.search, requestNavigation, when]);

  const dialog = useMemo(
    () => (
      <AlertDialog
        open={pendingNavigation !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingNavigation(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续留在此页</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                const next = pendingNavigation;
                setPendingNavigation(null);
                if (!next) {
                  return;
                }
                allowNextNavigationRef.current = true;
                navigate(next.path, { replace: next.replace });
              }}
            >
              确认离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ),
    [message, navigate, pendingNavigation, title],
  );

  return { dialog, allowNextNavigation };
}

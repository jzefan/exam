import { useSyncExternalStore } from "react";

function subscribe(query: string) {
  return (cb: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", cb);
    return () => mql.removeEventListener("change", cb);
  };
}

export function useMediaQuery(query: string, ssrDefault = false): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    () => ssrDefault,
  );
}

export const useIsMobile = () => {
  const narrowPhone = useMediaQuery("(max-width: 767px)", false);
  const phoneLandscape = useMediaQuery("(max-height: 500px) and (max-width: 950px)", false);
  return narrowPhone || phoneLandscape;
};

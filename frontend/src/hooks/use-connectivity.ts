import { useEffect, useRef, useState } from "react";

export interface ConnectivityState {
  online: boolean;
  lastChangedAt: number;
}

export function useConnectivity(): ConnectivityState {
  const [state, setState] = useState<ConnectivityState>(() => ({
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    lastChangedAt: Date.now(),
  }));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handle(online: boolean) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!online) {
        setState({ online: false, lastChangedAt: Date.now() });
      } else {
        debounceRef.current = setTimeout(() => {
          setState({ online: true, lastChangedAt: Date.now() });
        }, 2000);
      }
    }

    const onOnline = () => handle(true);
    const onOffline = () => handle(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return state;
}

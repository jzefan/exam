import { useEffect, useRef, useState } from "react";

type SaveState = "saved-local" | "syncing" | "synced" | "pending-sync";

interface SaveStateLabelProps {
  saveState: "idle" | "saving" | "saved" | "error";
  pendingCount?: number;
}

export function SaveStateLabel({ saveState, pendingCount = 0 }: SaveStateLabelProps) {
  const [displayState, setDisplayState] = useState<SaveState>("saved-local");
  const syncingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (saveState === "saving") {
      syncingTimerRef.current = setTimeout(() => {
        setDisplayState("syncing");
      }, 400);
    } else if (saveState === "saved") {
      if (syncingTimerRef.current) clearTimeout(syncingTimerRef.current);
      setDisplayState("synced");
      fadeTimerRef.current = setTimeout(() => {
        setDisplayState("saved-local");
      }, 2000);
    } else if (saveState === "error" && pendingCount > 0) {
      if (syncingTimerRef.current) clearTimeout(syncingTimerRef.current);
      setDisplayState("pending-sync");
    } else {
      if (syncingTimerRef.current) clearTimeout(syncingTimerRef.current);
      setDisplayState("saved-local");
    }
    return () => {
      if (syncingTimerRef.current) clearTimeout(syncingTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [saveState, pendingCount]);

  const labelMap: Record<SaveState, string> = {
    "saved-local": "已本地保存",
    syncing: "同步中...",
    synced: "已同步",
    "pending-sync": `${pendingCount} 题待同步`,
  };

  return (
    <span className="text-xs text-muted-foreground truncate max-w-[90px]">
      {labelMap[displayState]}
    </span>
  );
}

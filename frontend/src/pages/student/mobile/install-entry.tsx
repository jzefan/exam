import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let cachedPrompt: BeforeInstallPromptEvent | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    cachedPrompt = e as BeforeInstallPromptEvent;
  });
}

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(cachedPrompt);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      cachedPrompt = e as BeforeInstallPromptEvent;
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const triggerInstall = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      cachedPrompt = null;
      setPrompt(null);
    }
  };

  return { canInstall: !!prompt, triggerInstall };
}

export function InstallEntryRow() {
  const { canInstall, triggerInstall } = useInstallPrompt();

  if (!canInstall) {
    return (
      <div className="w-full flex items-center justify-between px-4 py-4 text-sm opacity-40">
        <span>安装应用</span>
        <span className="text-xs text-muted-foreground">（仅支持 Chrome/Android）</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm">安装到桌面</span>
      <Button size="sm" onClick={() => void triggerInstall()}>
        安装
      </Button>
    </div>
  );
}

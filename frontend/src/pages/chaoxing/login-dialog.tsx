import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { MousePointer2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PixelGrid, PixelLoader } from "@/components/ui/pixel-loader";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConnectionError, connectionFetch, connectionRequest } from "./api";
import type { Connection, Verified } from "./api";

type Point = { x: number; y: number };
export function LoginDialog({ session, open, onOpenChange, onVerified, onExpired }: {
  session: Connection; open: boolean; onOpenChange: (open: boolean) => void;
  onVerified: (data: Verified) => void; onExpired: (message: string) => void;
}) {
  const [frame, setFrame] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState("");
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const [pointer, setPointer] = useState<Point | null>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const gesture = useRef<Point[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const active = useRef(false);
  const base = `/sessions/${session.id}`;
  const callbacks = useRef({ onExpired });
  callbacks.current = { onExpired };

  const handleError = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : "登录窗口暂不可用";
    setError(message);
    if (cause instanceof ConnectionError && [401, 404, 410].includes(cause.status)) callbacks.current.onExpired(message);
  };

  useEffect(() => {
    if (!open) return;
    active.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let objectUrl = "";
    const abort = new AbortController();
    const poll = async () => {
      try {
        const response = await connectionFetch(`${base}/frame`, { signal: abort.signal });
        const blob = await response.blob();
        if (stopped) return;
        const next = URL.createObjectURL(blob);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = next;
        setFrame(next);
      } catch (cause) {
        if (stopped) return;
        handleError(cause);
        if (cause instanceof ConnectionError && [401, 404, 409, 410].includes(cause.status)) return;
      }
      if (!stopped) timer = setTimeout(poll, 900);
    };
    const prepare = async () => {
      try {
        const saved = await connectionRequest<{
          saved: boolean; filled: boolean; persistence_enabled: boolean; unreadable?: boolean;
        }>(`${base}/autofill`, { method: "POST" });
        if (stopped) return;
        setCredentialsSaved(saved.saved);
        setCredentialStatus(saved.unreadable
          ? "已保存的账号无法解密，请重新输入以更新"
          : saved.filled
            ? "已自动填写保存的账号，请核对后登录"
            : saved.saved
              ? "已记住账号；当前登录页已有内容，未覆盖"
              : saved.persistence_enabled
                ? "首次登录后会加密保存账号，下次自动填写"
                : "");
      } catch (cause) {
        if (!stopped) handleError(cause);
      }
      if (!stopped) void poll();
    };
    void prepare();
    return () => {
      stopped = true; active.current = false; abort.abort(); clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setFrame("");
      setInputFocused(false);
      setPointer(null);
      setCredentialStatus("");
      setCredentialsSaved(false);
    };
    // The session is stable while the dialog is open; callbacks are read through a ref.
  }, [base, open]);

  const send = (action: object) => {
    queue.current = queue.current.then(async () => {
      if (!active.current) return;
      const result = await connectionRequest<{ credentials_saved?: boolean; credentials_pending?: boolean }>(`${base}/actions`, { method: "POST", body: JSON.stringify(action) });
      if (result?.credentials_saved) {
        setCredentialsSaved(true);
        setCredentialStatus("账号已加密保存，下次会自动填写");
      } else if (result?.credentials_pending) {
        setCredentialStatus("输入停止后会自动加密保存账号");
      }
    }).catch(handleError);
  };
  const point = (event: PointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(session.width - 1, (event.clientX - rect.left) / rect.width * session.width)),
      y: Math.max(0, Math.min(session.height - 1, (event.clientY - rect.top) / rect.height * session.height)),
    };
  };
  const verify = async () => {
    setVerifying(true); setError("");
    try {
      await queue.current;
      const result = await connectionRequest<Verified>(`${base}/verify`, { method: "POST" });
      onVerified(result);
    } catch (cause) { handleError(cause); }
    finally { setVerifying(false); }
  };
  const forgetCredentials = async () => {
    try {
      await connectionRequest<void>("/credentials", { method: "DELETE" });
      setCredentialsSaved(false);
      setCredentialStatus("已清除记住的账号");
    } catch (cause) { handleError(cause); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[min(95dvh,900px)] max-h-[95dvh] max-w-[1128px] flex-col gap-0 overflow-hidden p-0 sm:w-[95vw]">
      <DialogHeader className="shrink-0 px-4 pb-3 pt-4">
        <DialogTitle>连接学习通</DialogTitle>
        <DialogDescription>在下方学习通页面登录。账号密码会加密记住并在下次自动填写；登录状态仍会在断开后清除。</DialogDescription>
      </DialogHeader>
      {error && <Alert className="mx-4 mb-3 shrink-0" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3">
      <div className="overflow-auto rounded-md border border-border bg-muted/30">
        <div
          role="group" aria-label="学习通远程登录页面"
          className={`relative min-w-[540px] touch-none select-none focus-within:ring-2 focus-within:ring-inset ${inputFocused ? "ring-2 ring-inset ring-primary/70" : "focus-within:ring-ring"}`}
          style={{ aspectRatio: `${session.width} / ${session.height}` }}
          onPointerDown={(event) => {
            if (!frame || verifying || event.button !== 0) return;
            const next = point(event);
            event.preventDefault(); setPointer(next); setInputFocused(true); keyboard.current?.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            gesture.current = [next];
          }}
          onPointerMove={(event) => {
            const next = point(event); setPointer(next);
            if (gesture.current.length && gesture.current.length < 119) gesture.current.push(next);
          }}
          onPointerUp={(event) => {
            if (!gesture.current.length) return;
            const next = point(event); setPointer(next);
            const points = [...gesture.current, next]; gesture.current = [];
            send({ kind: "pointer", points });
          }}
          onPointerCancel={() => { gesture.current = []; }}
          onWheel={(event) => { if (frame && !verifying) send({ kind: "scroll", delta: Math.round(Math.max(-1500, Math.min(1500, event.deltaY))) }); }}
        >
          {frame ? <img className="block size-full" src={frame} alt="学习通官方登录页面的实时画面" draggable={false} />
            : <div className="flex h-full min-h-60 items-center justify-center"><PixelLoader label="正在加载登录页面" /></div>}
          {pointer && <MousePointer2
            aria-hidden="true"
            className="pointer-events-none absolute z-10 size-5 -translate-x-0.5 -translate-y-0.5 fill-background text-primary drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
            style={{ left: `${pointer.x / session.width * 100}%`, top: `${pointer.y / session.height * 100}%` }}
          />}
          <textarea ref={keyboard} aria-label="学习通远程键盘输入" autoComplete="off" autoCapitalize="off" spellCheck={false}
            className="absolute left-0 top-0 size-px resize-none opacity-0" disabled={verifying}
            onFocus={() => setInputFocused(true)}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={(event) => {
              composing.current = false;
              if (event.currentTarget.value) send({ kind: "text", text: event.currentTarget.value });
              event.currentTarget.value = "";
            }}
            onChange={(event) => {
              if (composing.current) return;
              if (event.currentTarget.value) send({ kind: "text", text: event.currentTarget.value });
              event.currentTarget.value = "";
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              const keys = ["Tab", "Backspace", "Delete", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
                event.preventDefault(); send({ kind: "key", key: "ControlOrMeta+A" });
              } else if (keys.includes(event.key)) {
                event.preventDefault(); send({ kind: "key", key: event.key === "Tab" && event.shiftKey ? "Shift+Tab" : event.key });
              }
            }}
          />
        </div>
      </div>
      {credentialStatus && <div className="text-xs text-muted-foreground" role="status">{credentialStatus}</div>}
      </div>
      <DialogFooter className="shrink-0 border-t border-border px-4 py-3">
        {credentialsSaved && <Button className="mr-auto" variant="ghost" onClick={() => void forgetCredentials()}>清除记住的账号</Button>}
        <Button variant="outline" onClick={() => onOpenChange(false)}>暂时关闭</Button>
        <Button onClick={() => void verify()} disabled={verifying || !frame}>
          {verifying && <PixelGrid />}已完成登录，验证连接
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

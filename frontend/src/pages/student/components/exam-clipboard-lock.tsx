import type { FormEvent, KeyboardEvent, ReactNode } from "react";

function blockClipboard(event: { preventDefault: () => void; stopPropagation: () => void }) {
  event.preventDefault();
  event.stopPropagation();
}

function blockClipboardShortcut(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  const shortcut = event.metaKey || event.ctrlKey;
  if ((shortcut && (key === "c" || key === "v" || key === "x")) || (event.shiftKey && key === "insert")) {
    blockClipboard(event);
  }
}

function blockInsertedClipboard(event: FormEvent) {
  const inputType = (event.nativeEvent as InputEvent).inputType;
  if (inputType === "insertFromPaste" || inputType === "insertFromDrop") {
    blockClipboard(event);
  }
}

export function ExamClipboardLock({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={className}
      onCopyCapture={blockClipboard}
      onCutCapture={blockClipboard}
      onPasteCapture={blockClipboard}
      onDropCapture={blockClipboard}
      onDragStartCapture={blockClipboard}
      onContextMenuCapture={blockClipboard}
      onKeyDownCapture={blockClipboardShortcut}
      onBeforeInputCapture={blockInsertedClipboard}
    >
      {children}
      <p className="text-xs text-muted-foreground">不可复制、粘贴</p>
    </div>
  );
}

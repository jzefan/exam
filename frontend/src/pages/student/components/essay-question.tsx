import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { renderLatexInHtml } from "@/components/ui/latex-text";
import { Paperclip, X, FileIcon } from "lucide-react";
import type { IExamQuestionForStudent } from "@/types";

interface Attachment {
  name: string;
  url: string;
}

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

export function EssayQuestion({ question, answer, onChange }: Props) {
  const html = (answer?.html as string) ?? "";
  const attachments = (answer?.attachments as Attachment[]) ?? [];

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch("/api/uploads/file", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      const newAttachment: Attachment = { name: file.name, url: data.url };
      onChange({ html, attachments: [...attachments, newAttachment] });
    } catch {
      // Upload failed silently — user can retry
    }
    e.target.value = "";
  };

  const removeAttachment = (index: number) => {
    const next = attachments.filter((_, i) => i !== index);
    onChange({ html, attachments: next });
  };

  return (
    <div className="space-y-5">
      <div
        className="prose prose-sm dark:prose-invert max-w-none leading-relaxed"
        dangerouslySetInnerHTML={{
          __html: renderLatexInHtml(
            (question.content as { html?: string; text?: string }).html ??
            (question.content as { text?: string }).text ??
            question.title,
          ),
        }}
      />

      <RichTextEditor
        value={html}
        onChange={(content) => onChange({ html: content, attachments })}
        placeholder="请输入论述内容..."
        className="[&_.tiptap]:min-h-[200px]"
      />

      {/* Attachment area */}
      <div className="space-y-2.5">
        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
          <Paperclip size={13} />
          添加附件
          <input
            type="file"
            className="hidden"
            onChange={handleFileUpload}
          />
        </label>

        {attachments.length > 0 && (
          <div className="space-y-1.5">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="flex items-center gap-2.5 py-2 px-3 rounded-lg bg-muted/50 text-sm group"
              >
                <FileIcon
                  size={14}
                  className="shrink-0 text-muted-foreground"
                />
                <span className="flex-1 truncate text-foreground/70">
                  {att.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

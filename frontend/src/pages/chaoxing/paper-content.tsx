import { useEffect, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { RichContent } from "@/components/ui/rich-content";
import { connectionFetch, type ContentBlock } from "./api";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function PrivateImage({ assetId, name }: { assetId: string; name: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    setFailed(false);
    void connectionFetch(`/media/${assetId}`, { signal: controller.signal })
      .then(response => response.blob())
      .then(blob => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assetId]);
  return url
    ? <div className="my-2"><RichContent html={`<img src="${escape(url)}" alt="${escape(name)}">`} /><a className="text-xs text-primary underline" href={url} download={name}>{name} · 下载</a></div>
    : <span className="text-xs text-muted-foreground">{name} · {failed ? "加载失败" : "加载中…"}</span>;
}

/** Provider text is untrusted. Only KaTeX-generated markup is rendered as HTML. */
export function formulaHtml(value: string) {
  const formula = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)([^$\n]+?)(?<!\s)\$/g;
  let result = "";
  let offset = 0;
  for (const match of value.matchAll(formula)) {
    result += escape(value.slice(offset, match.index));
    result += katex.renderToString(match[1] ?? match[2] ?? match[3] ?? match[4], {
      displayMode: !!(match[1] ?? match[2]), throwOnError: false, trust: false, strict: "ignore", output: "html",
    });
    offset = match.index! + match[0].length;
  }
  return result + escape(value.slice(offset));
}

function MediaBlock({ block }: { block: ContentBlock }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!block.asset_id) return;
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    setFailed(false);
    void connectionFetch(`/media/${block.asset_id}`, { signal: controller.signal })
      .then(response => response.blob())
      .then(blob => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [block.asset_id]);
  const name = block.name || (block.kind === "image" ? "图片" : "附件");
  return <div className="my-2 min-w-0" data-no-card-toggle="true">
    {url && block.kind === "image" && <RichContent html={`<img src="${escape(url)}" alt="${escape(name)}">`} />}
    <div className="flex items-center gap-2 text-xs">
      {url ? <a className="break-all text-primary underline underline-offset-2" href={url} download={name}>{name} · 下载</a> : <span className="text-muted-foreground">{name} · {failed || block.unavailable || !block.asset_id ? "未能读取，请重新读取答卷" : "加载中…"}</span>}
      {block.size != null && <span className="shrink-0 text-muted-foreground">{Math.max(1, Math.ceil(block.size / 1024))} KB</span>}
    </div>
    {block.preview != null && <details className="mt-2" open>
      <summary className="cursor-pointer text-xs text-muted-foreground">代码 / 文本预览</summary>
      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre rounded bg-muted/40 p-3 font-mono text-xs">{block.preview}</pre>
    </details>}
    {block.embedded_images?.map(image => <PrivateImage key={image.asset_id} assetId={image.asset_id} name={image.name} />)}
  </div>;
}

export function PaperContent({ blocks, text, empty = "未读取到内容" }: { blocks?: ContentBlock[]; text: string; empty?: string }) {
  const parts = blocks?.length ? blocks : text ? [{ kind: "text" as const, text }] : [];
  return <div className="min-w-0 text-sm leading-relaxed">
    {parts.length ? parts.map((block, index) => block.kind === "text"
      ? <div key={index} className="whitespace-pre-wrap break-words [&_.katex-display]:overflow-x-auto" dangerouslySetInnerHTML={{ __html: formulaHtml(block.text ?? "") }} />
      : <MediaBlock key={`${index}-${block.asset_id ?? "missing"}`} block={block} />)
      : <p className="text-muted-foreground">{empty}</p>}
  </div>;
}

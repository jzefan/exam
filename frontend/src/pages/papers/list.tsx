import { useMemo, useState } from "react";
import { useList } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { Copy, Eye, FilePlus2, RefreshCcw, Search, Sparkles, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { IPaper, IPaperDetail, PaperSourceType } from "@/types";

import { paperApiRequest } from "./api";
import { PaperAIGenerateDialog } from "./ai-generate-dialog";

const SOURCE_LABELS: Record<PaperSourceType, string> = {
  manual: "手工",
  import: "导入",
  ai_generated: "AI 生成",
};

function formatDateTime(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PaperListPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [keyword, setKeyword] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | PaperSourceType>("all");
  const [busyPaperId, setBusyPaperId] = useState<string | null>(null);
  const [aiDialogPaper, setAiDialogPaper] = useState<IPaper | null>(null);

  const { query } = useList<IPaper>({
    resource: "papers",
    pagination: { currentPage: 1, pageSize: 500, mode: "server" },
    sorters: [{ field: "created_at", order: "desc" }],
  });

  const allPapers = query.data?.data ?? [];
  const filteredPapers = useMemo(
    () =>
      allPapers.filter((paper) => {
        const titleMatch = paper.title.toLowerCase().includes(keyword.trim().toLowerCase());
        const sourceMatch = sourceFilter === "all" || paper.source_type === sourceFilter;
        return titleMatch && sourceMatch;
      }),
    [allPapers, keyword, sourceFilter],
  );

  const withBusyGuard = async (paperId: string, fn: () => Promise<void>) => {
    setBusyPaperId(paperId);
    try {
      await fn();
      await query.refetch();
    } catch (error) {
      toast({
        title: "操作失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setBusyPaperId(null);
    }
  };

  const handleCopy = async (paper: IPaper) =>
    withBusyGuard(paper.id, async () => {
      const detail = await paperApiRequest<IPaperDetail>(`/papers/${paper.id}`);
      const created = await paperApiRequest<IPaperDetail>("/papers", {
        method: "POST",
        body: JSON.stringify({
          title: `${detail.title}（复制）`,
          description: detail.description,
          source_type: "manual",
          source_paper_id: detail.id,
          root_knowledge_point_id: detail.root_knowledge_point_id,
          question_items: detail.questions.map((item) => ({
            question_id: item.question_id,
            order: item.order,
            score_override: item.score_override,
          })),
        }),
      });
      toast({ title: "复制成功", description: `已创建试卷：${created.title}` });
    });

  const handleDelete = async (paper: IPaper) =>
    withBusyGuard(paper.id, async () => {
      if (!window.confirm(`确认删除试卷「${paper.title}」？`)) {
        return;
      }
      await paperApiRequest(`/papers/${paper.id}`, { method: "DELETE" });
      toast({ title: "已删除", description: paper.title });
    });

  return (
    <div className="mx-auto max-w-[1200px] space-y-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight text-foreground">试卷列表</h1>
          <p className="text-sm text-muted-foreground">统一管理手工与导入试卷，并支持复用出新卷</p>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <Button variant="outline" className="h-9 w-fit shrink-0 px-4 font-medium" onClick={() => navigate("/exams/create")}>
            <FilePlus2 className="mr-1.5 h-4 w-4" />
            新建试卷
          </Button>
          <Button className="h-9 w-fit shrink-0 px-4 font-medium" onClick={() => navigate("/papers/import")}>导入试卷</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-muted/5 p-4">
        <div className="inline-flex items-center rounded-lg border border-border/60 bg-background p-1">
          {(["all", "manual", "import", "ai_generated"] as const).map((source) => (
            <button
              key={source}
              type="button"
              className={`h-8 rounded-md px-3 text-xs font-semibold ${
                sourceFilter === source
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
              onClick={() => setSourceFilter(source)}
            >
              {source === "all" ? "全部来源" : SOURCE_LABELS[source]}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/40" />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="按试卷名称搜索"
            className="h-9 w-[240px] border-border/60 pl-9 text-xs font-medium focus-visible:ring-primary/20"
          />
        </div>

        <Button variant="ghost" size="sm" className="h-9 px-3 text-xs font-bold text-muted-foreground hover:text-foreground" onClick={() => query.refetch()} disabled={query.isLoading}>
          <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
          刷新
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/40 bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-3 text-xs font-semibold">试卷名称</th>
              <th className="px-4 py-3 text-xs font-semibold">来源</th>
              <th className="px-4 py-3 text-xs font-semibold">主知识点</th>
              <th className="px-4 py-3 text-xs font-semibold">题目数</th>
              <th className="px-4 py-3 text-xs font-semibold">状态</th>
              <th className="px-4 py-3 text-xs font-semibold">创建人</th>
              <th className="px-4 py-3 text-xs font-semibold">创建时间</th>
              <th className="px-4 py-3 text-right text-xs font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredPapers.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  {query.isLoading ? "加载中..." : "暂无试卷"}
                </td>
              </tr>
            )}
            {filteredPapers.map((paper) => {
              const isBusy = busyPaperId === paper.id;
              return (
                <tr key={paper.id} className="border-t border-border/60">
                  <td className="px-4 py-3 font-medium text-foreground">{paper.title}</td>
                  <td className="px-4 py-3">{SOURCE_LABELS[paper.source_type]}</td>
                  <td className="px-4 py-3 text-muted-foreground">{paper.root_knowledge_point?.name ?? "—"}</td>
                  <td className="px-4 py-3">{paper.question_count}</td>
                  <td className="px-4 py-3">
                    <Badge variant={paper.archived_at ? "secondary" : "default"}>
                      {paper.archived_at ? "归档" : "可用"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">{paper.created_by_name || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(paper.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => navigate(`/papers/${paper.id}`)} title="查看">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleCopy(paper)} disabled={isBusy} title="复制">
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setAiDialogPaper(paper)}
                        disabled={isBusy || Boolean(paper.archived_at)}
                        title="AI生成新试卷"
                      >
                        <Sparkles className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(paper)} disabled={isBusy} title="删除">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {aiDialogPaper ? (
        <PaperAIGenerateDialog
          open={Boolean(aiDialogPaper)}
          onOpenChange={(open) => {
            if (!open) {
              setAiDialogPaper(null);
            }
          }}
          paperId={aiDialogPaper.id}
          paperTitle={aiDialogPaper.title}
          rootKnowledgePointName={aiDialogPaper.root_knowledge_point?.name}
        />
      ) : null}
    </div>
  );
}

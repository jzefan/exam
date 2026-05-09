import { useState } from "react";
import { useOne } from "@refinedev/core";
import { Archive, ArrowLeft, Copy, FilePlus2, Loader2, Sparkles } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { IPaperDetail } from "@/types";

import { paperApiRequest } from "./api";

function formatDateTime(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PaperDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const { result: paper, query } = useOne<IPaperDetail>({
    resource: "papers",
    id: id!,
    queryOptions: { enabled: Boolean(id) },
  });

  const handleCopy = async () => {
    if (!paper) return;
    setBusy(true);
    try {
      const created = await paperApiRequest<IPaperDetail>("/papers", {
        method: "POST",
        body: JSON.stringify({
          title: `${paper.title}（复制）`,
          description: paper.description,
          source_type: "manual",
          source_paper_id: paper.id,
          root_knowledge_point_id: paper.root_knowledge_point_id,
          question_items: paper.questions.map((item) => ({
            question_id: item.question_id,
            order: item.order,
            score_override: item.score_override,
          })),
        }),
      });
      toast({ title: "复制成功", description: `已创建试卷：${created.title}` });
      navigate(`/papers/${created.id}`);
    } catch (error) {
      toast({
        title: "复制失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleArchive = async () => {
    if (!paper) return;
    setBusy(true);
    try {
      await paperApiRequest(`/papers/${paper.id}/archive`, { method: "POST" });
      await query.refetch();
      toast({ title: "已归档", description: paper.title });
    } catch (error) {
      toast({
        title: "归档失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (query.isLoading || !paper) {
    return (
      <div className="mx-auto flex w-full max-w-6xl items-center justify-center px-6 py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载试卷中...
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{paper.title}</h1>
            <Badge variant={paper.archived_at ? "secondary" : "default"}>
              {paper.archived_at ? "归档" : "可用"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{paper.description || "暂无描述"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/papers")}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            返回列表
          </Button>
          <Button variant="outline" onClick={handleCopy} disabled={busy}>
            <Copy className="mr-1.5 h-4 w-4" />
            复制
          </Button>
          <Button variant="outline" onClick={handleArchive} disabled={busy || Boolean(paper.archived_at)}>
            <Archive className="mr-1.5 h-4 w-4" />
            归档
          </Button>
          <Button variant="outline" disabled>
            <Sparkles className="mr-1.5 h-4 w-4" />
            AI生成新试卷
          </Button>
          <Button onClick={() => navigate(`/exams/create?paper_id=${paper.id}`)}>
            <FilePlus2 className="mr-1.5 h-4 w-4" />
            创建考试
          </Button>
          <Button variant="outline" onClick={() => navigate(`/exams/practice/create?paper_id=${paper.id}`)}>
            发布练习
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-border/70 bg-card p-4 text-sm md:grid-cols-4">
        <div>
          <div className="text-muted-foreground">来源</div>
          <div className="font-medium">{paper.source_type}</div>
        </div>
        <div>
          <div className="text-muted-foreground">主知识点</div>
          <div className="font-medium">{paper.root_knowledge_point?.name ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground">题目数 / 总分</div>
          <div className="font-medium">
            {paper.question_count} / {paper.total_score}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">创建时间</div>
          <div className="font-medium">{formatDateTime(paper.created_at)}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">序号</th>
              <th className="px-4 py-3 font-medium">题目</th>
              <th className="px-4 py-3 font-medium">题型</th>
              <th className="px-4 py-3 font-medium">分值</th>
            </tr>
          </thead>
          <tbody>
            {paper.questions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  暂无题目
                </td>
              </tr>
            )}
            {paper.questions.map((item, index) => (
              <tr key={item.question_id} className="border-t border-border/60">
                <td className="px-4 py-3">{index + 1}</td>
                <td className="px-4 py-3">{item.question?.title ?? "未知题目"}</td>
                <td className="px-4 py-3 text-muted-foreground">{item.question?.type ?? "—"}</td>
                <td className="px-4 py-3">{item.score_override ?? item.question?.score ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

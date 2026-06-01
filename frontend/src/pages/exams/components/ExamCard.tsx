import type { ReactNode } from "react";
import {
  Clock,
  ClipboardList,
  Eye,
  FileText,
  GraduationCap,
  Lock,
  Pencil,
  PieChart,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ExamStatusBadge } from "./ExamStatusBadge";
import { getEffectiveExamStatus } from "../utils";

export interface ExamCardKnowledgePoint {
  id: string;
  name: string;
}

export interface ExamCardData {
  id: string;
  category: string;
  title: string;
  status: string;
  start_time: string | null;
  end_time: string | null;
  total_questions: number;
  total_score: number;
  total_students: number;
  submitted_count: number;
  has_student_history: boolean;
  knowledge_points: ExamCardKnowledgePoint[];
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ExamCard({
  exam,
  onView,
  onEdit,
  onAnalysis,
  onClose,
  onDelete,
  extraBadges,
  extraActions,
  canManage = true,
}: {
  exam: ExamCardData;
  onView: () => void;
  onEdit: () => void;
  onAnalysis: () => void;
  onClose: () => void;
  onDelete: () => void;
  extraBadges?: ReactNode;
  extraActions?: ReactNode;
  canManage?: boolean;
}) {
  const effectiveStatus = getEffectiveExamStatus(exam);
  const canClose =
    effectiveStatus !== "ongoing" || exam.submitted_count >= exam.total_students;
  const canViewAnalysis =
    effectiveStatus !== "draft" &&
    effectiveStatus !== "upcoming" &&
    exam.submitted_count > 0;
  const categoryLabel = exam.category === "practice" ? "练习" : "考试";
  const categoryBadgeClass =
    exam.category === "practice"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  const visibleKnowledgePoints = exam.knowledge_points.slice(0, 4);
  const hiddenKnowledgePointCount = Math.max(
    0,
    exam.knowledge_points.length - visibleKnowledgePoints.length,
  );

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/50 bg-card p-0 transition-all hover:border-primary/20 hover:shadow-xl hover:shadow-primary/[0.03]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 p-5">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-base font-bold text-foreground tracking-tight truncate">
              {exam.title}
            </h3>
            <Badge variant="outline" className={categoryBadgeClass}>
              {categoryLabel}
            </Badge>
            <ExamStatusBadge status={effectiveStatus} />
            {extraBadges}
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground/80">
              <Clock size={14} className="text-muted-foreground/40" />
              <span>
                {formatDateTime(exam.start_time)} — {formatDateTime(exam.end_time)}
              </span>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80">
                <FileText size={14} className="text-muted-foreground/40" />
                <span>
                  {exam.total_questions} 题目 / {exam.total_score} 分
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80">
                <Users size={14} className="text-muted-foreground/40" />
                <span>考生 {exam.total_students} 人</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80">
                <UserCheck
                  size={14}
                  className={cn(
                    exam.submitted_count > 0
                      ? "text-emerald-500/60"
                      : "text-muted-foreground/40",
                  )}
                />
                <span
                  className={cn(
                    exam.submitted_count > 0 && "text-emerald-600/80",
                  )}
                >
                  已交 {exam.submitted_count} 人
                </span>
              </div>
            </div>
          </div>

          {exam.category === "practice" && exam.knowledge_points.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80">
                <GraduationCap size={14} className="text-muted-foreground/40" />
                <span>知识点</span>
              </div>
              {visibleKnowledgePoints.map((kp) => (
                <Badge
                  key={kp.id}
                  variant="outline"
                  className="max-w-[160px] truncate border-amber-500/15 bg-amber-500/5 text-[11px] text-amber-700 dark:text-amber-300"
                  title={kp.name}
                >
                  {kp.name}
                </Badge>
              ))}
              {hiddenKnowledgePointCount > 0 && (
                <Badge
                  variant="outline"
                  className="border-border/70 text-[11px] text-muted-foreground"
                >
                  +{hiddenKnowledgePointCount}
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 self-end md:self-center">
          <Button
            variant="ghost"
            size="sm"
            className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold"
            onClick={onView}
          >
            <Eye size={14} />
            <span>查看</span>
          </Button>

          {canManage ? (
            <Button
              variant="ghost"
              size="sm"
              className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold"
              onClick={onEdit}
            >
              <Pencil size={14} />
              <span>修改</span>
            </Button>
          ) : null}

          {canViewAnalysis && (
            <Button
              variant="ghost"
              size="sm"
              className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold"
              onClick={onAnalysis}
            >
              <PieChart size={14} />
              <span>结果分析</span>
            </Button>
          )}

          {canManage && (effectiveStatus === "upcoming" ||
            effectiveStatus === "ongoing" ||
            effectiveStatus === "completed") && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                      disabled={!canClose}
                      onClick={onClose}
                    >
                      <Lock size={14} />
                      <span>关闭</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canClose && (
                  <TooltipContent side="bottom">
                    <p className="text-xs">仍有考生在考试中，无法关闭</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}

          {canManage && (effectiveStatus === "draft" ||
            effectiveStatus === "upcoming" ||
            effectiveStatus === "completed" ||
            effectiveStatus === "closed" ||
            (effectiveStatus === "ongoing" && !exam.has_student_history)) && (
            <Button
              variant="ghost"
              size="sm"
              className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold text-destructive hover:bg-destructive/5 hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 size={14} />
              <span>删除</span>
            </Button>
          )}

          {canManage ? extraActions : null}
        </div>
      </div>
    </div>
  );
}

// Keep the empty state next to the card so the two places that render exam lists
// can share the same "暂无" panel without duplicating copy.
export function ExamCardEmptyState({
  title = "暂无考试或练习记录",
  description = "可以先创建考试，或按知识点发布一套练习",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 rounded-2xl border-2 border-dashed border-border/40 bg-muted/5">
      <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
        <ClipboardList size={32} className="text-muted-foreground/30" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground/60 mt-1">{description}</p>
    </div>
  );
}

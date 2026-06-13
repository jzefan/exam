import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  BookOpen,
  CalendarRange,
  Calculator,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  FilePlus2,
  Layers3,
  Link2,
  ListChecks,
  LoaderCircle,
  Lock,
  MoreHorizontal,
  Move,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageIntroHeader } from "@/components/ui/page-intro-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatKnowledgeDisplayPath } from "@/lib/knowledge-display";
import { writeExamSeed } from "@/lib/exam-seed";
import { cn } from "@/lib/utils";
import type { IQuestion, QuestionType } from "@/types";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import {
  normalizeQuestionType,
  questionTypeFullLabel,
} from "@/components/questions/question-preview-utils";
import {
  CreateFromSelectionDialog,
  type CreateFromSelectionCategory,
} from "@/pages/questions/components/create-from-selection-dialog";
import {
  type CourseKnowledgeUploadTarget,
  flattenKnowledgeUploadTargets,
  resolveDefaultKnowledgeUploadTargetId,
} from "./course-material-upload-target";
import { KnowledgeImportDialog } from "@/pages/knowledge/KnowledgeImportDialog";
import { KnowledgeCatalogPhotoDialog } from "@/pages/knowledge/KnowledgeCatalogPhotoDialog";
import { MaterialAIGenerateDialog } from "@/pages/knowledge/MaterialAIGenerateDialog";
import { getSeedUsage, kbIngestMaterial, kbStatus } from "@/pages/courses/question-gen-templates/api";
import type { SeedUsageMap } from "@/pages/courses/question-gen-templates/types";
import { ResourcePreview } from "@/pages/job-models/editor/resource-preview";
import {
  extractMaterialContent,
  MATERIAL_PAGE_LIMIT,
  MATERIAL_TEXT_LIMIT,
  UnsupportedMaterialFormatError,
} from "@/pages/knowledge/extract-material-content";
import type { KnowledgeImportPath } from "@/pages/knowledge/import-knowledge-utils";
import { apiRequest } from "@/pages/grading/api";
import {
  addCourseMaterialLink,
  archiveExamToSemester,
  clearCourseKnowledgePoints,
  clearCourseQuestions,
  deleteCourseMaterial,
  exportExam,
  getCourseAssignmentScoreSummary,
  getCourseKnowledgeTree,
  getTeacherCourse,
  listCourseAssignments,
  listCourseExams,
  listCourseMaterials,
  listCourseQuestions,
  listCourseSemesters,
  updateCourseKnowledgePointName,
  updateCourseMaterial,
  uploadCourseMaterialFile,
  type CourseAssignmentScoreSummary,
  type CourseKnowledgeNode,
  type CourseSemester,
  type TeacherCourseDetail,
  type TeacherCourseExam,
  type TeacherCourseMaterial,
} from "./api";
import { AddLinkDialog } from "./AddLinkDialog";
import { NewSemesterDialog } from "./NewSemesterDialog";
import {
  ExamCard,
  ExamCardEmptyState,
} from "@/pages/exams/components/ExamCard";
import { examStatusOptions } from "@/pages/exams/components/ExamStatusBadge";
import { getEffectiveExamStatus } from "@/pages/exams/utils";
import {
  buildAssignmentLinksByNodeId,
  filterAssignmentsForKnowledgeNode,
} from "./course-assignment-node-links";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const AI_PREFILL_KEY = "ai_generate_prefill_v1";

const ALL_SEMESTERS = "__all__";
const ALL_QUESTION_KNOWLEDGE = "__all_question_knowledge__";
const QUESTION_TYPE_FILTERS: QuestionType[] = [
  "choice",
  "true_false",
  "fill_in",
  "short_answer",
  "essay",
  "code",
];
type CourseTab =
  | "materials"
  | "exams"
  | "assignments"
  | "questions"
  | "knowledge";

type CourseMaterialExtractedContent = {
  sourceText: string;
  images: string[];
};

type CourseMaterialBatchGenerateItem = {
  material: TeacherCourseMaterial;
  count: number;
};

type CourseMaterialBatchProgress = {
  phase: "generating" | "saving" | "done";
  currentIndex: number;
  total: number;
  currentTitle: string;
  generated: number;
  saved: number;
};

type CourseMaterialGeneratedQuestion = {
  type: QuestionType;
  title: string;
  content: { text: string };
  options: Record<string, string> | null;
  answer: { text?: string; correct?: string };
  analysis: string | null;
  difficulty: number;
};

type CourseMaterialAIGenerateState = CourseMaterialExtractedContent & {
  materialTitle: string;
  knowledgePointId: string;
  knowledgePointName: string;
  knowledgePointPath: string;
};

type ExamMockGenerateResponse = {
  exam_id: string;
  generated_question_count: number;
  reused_source_question_count: number;
  reused_bank_question_count: number;
};

const PENDING_TONE = "text-[oklch(0.55_0.09_70)]"; // ochre

function formatDate(value: string | null) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未设置";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未设置";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readableApiError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  try {
    const parsed = JSON.parse(message) as { detail?: unknown; message?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) return parsed.detail;
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
  } catch {
    // apiRequest can throw either plain text or serialized FastAPI error JSON.
  }
  return message || fallback;
}

function formatScore(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) return "-";
  return Number(value).toFixed(digits).replace(/\.0+$/, "");
}

function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${Number(value).toFixed(1).replace(/\.0$/, "")}%`;
}

function normalizePercentScore(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return null;
  const numeric = Number(value);
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function formatRoutineScore(value: number | null | undefined) {
  const score = normalizePercentScore(value);
  return score == null ? "-" : formatScore(score);
}

function escapeCsvCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function getFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function mergeMaterialUploadFiles(current: File[], incoming: File[]) {
  const seen = new Set(current.map(getFileKey));
  const merged = [...current];
  for (const file of incoming) {
    const key = getFileKey(file);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(file);
    }
  }
  return merged;
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const MATERIAL_UPLOAD_AUTO_MATCH_MIN_SCORE = 0.62;

function stripMaterialFileExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function normalizeMaterialMatchText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,8}$/i, "")
    .replace(/[《》【】[\]()（）{}<>「」『』'"“”‘’]/g, "")
    .replace(/[_\-—–+.,，。:：;；/\\|·、\s]+/g, "");
}

function getBigrams(value: string) {
  if (value.length <= 1) return value ? [value] : [];
  const bigrams: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    bigrams.push(value.slice(index, index + 2));
  }
  return bigrams;
}

function diceSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftBigrams = getBigrams(left);
  const rightBigrams = getBigrams(right);
  if (leftBigrams.length === 0 || rightBigrams.length === 0) return 0;
  const rightCounts = new Map<string, number>();
  for (const item of rightBigrams) {
    rightCounts.set(item, (rightCounts.get(item) ?? 0) + 1);
  }
  let matches = 0;
  for (const item of leftBigrams) {
    const count = rightCounts.get(item) ?? 0;
    if (count > 0) {
      matches += 1;
      rightCounts.set(item, count - 1);
    }
  }
  return (2 * matches) / (leftBigrams.length + rightBigrams.length);
}

function scoreMaterialTargetMatch(
  file: File,
  target: CourseKnowledgeUploadTarget,
) {
  const fileText = normalizeMaterialMatchText(
    stripMaterialFileExtension(file.name),
  );
  const targetName = normalizeMaterialMatchText(target.name);
  const targetPath = normalizeMaterialMatchText(target.path);
  if (!fileText || !targetName) return 0;

  const nameContains =
    fileText.length >= 2 &&
    targetName.length >= 2 &&
    (fileText.includes(targetName) || targetName.includes(fileText));
  const pathContains =
    fileText.length >= 2 &&
    targetPath.length >= 2 &&
    (fileText.includes(targetPath) || targetPath.includes(fileText));

  const nameScore = nameContains ? 0.96 : diceSimilarity(fileText, targetName);
  const pathScore = pathContains
    ? 0.78
    : diceSimilarity(fileText, targetPath) * 0.82;

  // Prefer concrete chapters/knowledge nodes over the course root when scores tie.
  return Math.max(nameScore, pathScore) + Math.min(target.depth, 4) * 0.015;
}

function findAutoMatchedMaterialTarget(
  files: File[],
  targets: CourseKnowledgeUploadTarget[],
) {
  let best: {
    target: CourseKnowledgeUploadTarget;
    file: File;
    score: number;
  } | null = null;
  for (const file of files) {
    for (const target of targets) {
      const score = scoreMaterialTargetMatch(file, target);
      if (!best || score > best.score) {
        best = { target, file, score };
      }
    }
  }
  return best && best.score >= MATERIAL_UPLOAD_AUTO_MATCH_MIN_SCORE
    ? best
    : null;
}

function EmptyPanel({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground/60">
        {icon}
      </div>
      <p className="mt-3 text-sm font-medium text-muted-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-muted-foreground/75">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function LoadingPanel({ label = "正在加载数据..." }: { label?: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
      <LoaderCircle size={22} className="mb-3 animate-spin" />
      {label}
    </div>
  );
}

function materialIcon(resourceType: string, url: string | null) {
  if (
    resourceType === "link" ||
    (resourceType !== "video" && url && !url.startsWith("/"))
  ) {
    return <Link2 size={16} />;
  }
  if (resourceType === "video" || resourceType === "录播") {
    return <Video size={16} />;
  }
  return <FileText size={16} />;
}

function materialMetaLabel(resourceType: string): string {
  // Friendly label for the row meta — falls back to the raw type if unknown.
  switch (resourceType) {
    case "link":
      return "外部链接";
    case "video":
      return "录播";
    case "pdf":
      return "PDF";
    case "doc":
    case "docx":
      return "文档";
    case "ppt":
    case "pptx":
      return "幻灯片";
    default:
      return resourceType;
  }
}

const GENERATABLE_MATERIAL_EXTENSIONS = new Set(["pdf", "docx", "pptx"]);
const PREVIEWABLE_MATERIAL_EXTENSIONS = new Set(["pdf", "docx", "pptx"]);

function getCourseMaterialExtension(
  material: TeacherCourseMaterial,
): string | null {
  const candidates = [material.title, material.file_path, material.url].filter(
    (value): value is string => Boolean(value),
  );

  for (const candidate of candidates) {
    const clean = candidate.split(/[?#]/)[0] ?? candidate;
    const match = clean.match(/\.([a-z0-9]+)$/i);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  return null;
}

function canGenerateQuestionsFromCourseMaterial(
  material: TeacherCourseMaterial,
): boolean {
  return (
    material.source === "upload" &&
    GENERATABLE_MATERIAL_EXTENSIONS.has(
      getCourseMaterialExtension(material) ?? "",
    )
  );
}

function canPreviewCourseMaterial(material: TeacherCourseMaterial): boolean {
  return PREVIEWABLE_MATERIAL_EXTENSIONS.has(
    getCourseMaterialExtension(material) ?? "",
  );
}

async function fetchCourseMaterialFile(
  material: TeacherCourseMaterial,
): Promise<File> {
  if (!material.url) {
    throw new Error("资料文件缺少可下载地址");
  }

  const token = localStorage.getItem("access_token");
  const response = await fetch(material.url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error("资料文件下载失败");
  }

  const blob = await response.blob();
  return new File([blob], material.title, {
    type: blob.type || "application/octet-stream",
  });
}

function findCourseKnowledgeNode(
  node: CourseKnowledgeNode | null,
  nodeId: string | null,
): CourseKnowledgeNode | null {
  if (!node || !nodeId) {
    return null;
  }
  if (node.id === nodeId) {
    return node;
  }
  for (const child of node.children) {
    const found = findCourseKnowledgeNode(child, nodeId);
    if (found) {
      return found;
    }
  }
  return null;
}

function findCourseKnowledgeNodePath(
  node: CourseKnowledgeNode | null,
  nodeId: string | null,
  trail: string[] = [],
): string[] {
  if (!node || !nodeId) {
    return [];
  }
  const nextTrail = [...trail, node.name];
  if (node.id === nodeId) {
    return nextTrail;
  }
  for (const child of node.children) {
    const found = findCourseKnowledgeNodePath(child, nodeId, nextTrail);
    if (found.length > 0) {
      return found;
    }
  }
  return [];
}

function flattenCourseKnowledgeNodes(
  node: CourseKnowledgeNode | null,
  depth = 0,
): Array<{ id: string; name: string; depth: number; path: string }> {
  if (!node) {
    return [];
  }
  const current = {
    id: node.id,
    name: node.name,
    depth,
    path: node.name,
  };
  const children = node.children.flatMap((child) =>
    flattenCourseKnowledgeNodes(child, depth + 1).map((item) => ({
      ...item,
      path: `${node.name} / ${item.path}`,
    })),
  );
  return [current, ...children];
}

function collectCourseKnowledgeNodeIds(
  node: CourseKnowledgeNode | null,
): Set<string> {
  const ids = new Set<string>();
  const visit = (current: CourseKnowledgeNode | null) => {
    if (!current) return;
    ids.add(current.id);
    for (const child of current.children) {
      visit(child);
    }
  };
  visit(node);
  return ids;
}

function filterMaterialsForKnowledgeNode(
  materials: TeacherCourseMaterial[],
  tree: CourseKnowledgeNode | null,
  nodeId: string | null,
) {
  if (!nodeId) return materials;
  const node = findCourseKnowledgeNode(tree, nodeId);
  const nodeIds = collectCourseKnowledgeNodeIds(node);
  if (nodeIds.size === 0) return [];
  return materials.filter((material) => nodeIds.has(material.node_id));
}

function filterQuestionsForKnowledgeNode(
  questions: IQuestion[],
  tree: CourseKnowledgeNode | null,
  nodeId: string | null,
) {
  if (!nodeId) return questions;
  const node = findCourseKnowledgeNode(tree, nodeId);
  const nodeIds = collectCourseKnowledgeNodeIds(node);
  if (nodeIds.size === 0) return [];
  return questions.filter((question) =>
    question.knowledge_points.some((kp) => nodeIds.has(kp.id)),
  );
}

function buildCourseQuestionCountByNodeId(
  node: CourseKnowledgeNode | null,
): Record<string, number> {
  const result: Record<string, number> = {};
  const visit = (current: CourseKnowledgeNode | null) => {
    if (!current) return;
    result[current.id] = current.question_count;
    for (const child of current.children) {
      visit(child);
    }
  };
  visit(node);
  return result;
}

function courseQuestionBankName(courseName: string | undefined) {
  const normalized = courseName?.trim();
  return normalized ? `${normalized.slice(0, 197)}-题库` : "主知识对应题库";
}

function MaterialsTab({
  materials,
  canWrite,
  scopeLabel = "整门课程范围 · 含子知识点资料",
  questionCountByNodeId,
  onOpenAddLink,
  onPickUpload,
  onOpenBatchGenerate,
  onViewQuestions,
  onPublishAssignment,
  onAssociate,
  onGenerateFrom,
  onDelete,
}: {
  materials: TeacherCourseMaterial[];
  canWrite: boolean;
  scopeLabel?: string;
  questionCountByNodeId: Record<string, number>;
  onOpenAddLink: () => void;
  onPickUpload: () => void;
  onOpenBatchGenerate: () => void;
  onViewQuestions: (material: TeacherCourseMaterial) => void;
  onPublishAssignment: (material: TeacherCourseMaterial) => void;
  onAssociate: (material: TeacherCourseMaterial) => void;
  onGenerateFrom: (material: TeacherCourseMaterial) => void;
  onDelete: (material: TeacherCourseMaterial) => void;
}) {
  const [query, setQuery] = useState("");
  const generatableCount = materials.filter(
    canGenerateQuestionsFromCourseMaterial,
  ).length;
  const filtered = materials.filter((material) => {
    const text = `${material.title} ${material.node_name ?? ""}`.toLowerCase();
    return !query.trim() || text.includes(query.trim().toLowerCase());
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-[280px]">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索资料..."
            className="h-9 pl-9"
          />
        </div>
        <span className="text-xs text-muted-foreground">{scopeLabel}</span>
        <div className="flex-1" />
        {canWrite ? (
          <>
            <Button variant="outline" size="sm" onClick={onOpenAddLink}>
              <Link2 size={14} className="mr-1.5" />
              添加链接
            </Button>
            <Button size="sm" onClick={onPickUpload}>
              <Upload size={14} className="mr-1.5" />
              上传资料
            </Button>
            {generatableCount > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={onOpenBatchGenerate}
              >
                <Sparkles size={14} className="mr-1.5" />
                一键生成题目
              </Button>
            ) : null}
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            <Lock size={13} />
            只读
          </span>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyPanel
          icon={<FileText size={22} />}
          title="暂无课程资料"
          description="可以从课程资料生成题目，也可以把资料挂到具体子知识点。"
        />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((material) => {
            const canGenerate =
              canGenerateQuestionsFromCourseMaterial(material);
            const questionCount = questionCountByNodeId[material.node_id] ?? 0;

            return (
              <div
                key={material.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                  {materialIcon(material.resource_type, material.url)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {material.title}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge
                      variant="secondary"
                      className="rounded-md bg-muted px-1.5 py-0 text-[11px] font-normal text-muted-foreground shadow-none"
                    >
                      {material.node_name ?? "课程节点"}
                    </Badge>
                    <span>{materialMetaLabel(material.resource_type)}</span>
                    <span className="text-muted-foreground/50">·</span>
                    <span className="font-sans lining-nums tabular-nums">
                      {formatDate(material.created_at)}
                    </span>
                    {material.kb_status === "ready" ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0 text-[11px] text-emerald-700 dark:text-emerald-300"
                        title={`已切分为 ${material.kb_chunk_count} 个知识片段，可用于检索与出题`}
                      >
                        知识库 · {material.kb_chunk_count} 片段
                      </span>
                    ) : material.kb_status === "processing" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0 text-[11px] text-muted-foreground">
                        知识库入库中…
                      </span>
                    ) : material.kb_status === "failed" ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-destructive/25 bg-destructive/10 px-1.5 py-0 text-[11px] text-destructive"
                        title="资料入库失败，可重新上传触发"
                      >
                        知识库入库失败
                      </span>
                    ) : null}
                  </div>
                </div>
                {canWrite && canGenerate ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full bg-[oklch(0.95_0.02_260)] text-[oklch(0.42_0.07_260)] hover:bg-[oklch(0.93_0.03_260)] hover:text-[oklch(0.36_0.08_260)]"
                    onClick={() => onGenerateFrom(material)}
                  >
                    <Sparkles size={14} className="mr-1.5" />
                    从资料生成题目
                  </Button>
                ) : null}
                {questionCount > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-sans text-[11px] font-semibold lining-nums tabular-nums text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                        title={`查看「${material.node_name ?? material.title}」知识点下的题目`}
                      >
                        <BookOpen size={11} />
                        {questionCount} 题
                        <ChevronDown size={10} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-36">
                      <DropdownMenuItem
                        onClick={() => onViewQuestions(material)}
                      >
                        <Eye size={14} className="mr-2" />
                        查看
                      </DropdownMenuItem>
                      {canWrite ? (
                        <>
                          <DropdownMenuItem
                            onClick={() => onPublishAssignment(material)}
                          >
                            <FilePlus2 size={14} className="mr-2" />
                            发布练习
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-sans text-[11px] font-semibold lining-nums tabular-nums text-muted-foreground opacity-45">
                    <BookOpen size={11} />0 题
                  </span>
                )}
                {material.url ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    asChild
                  >
                    <a
                      href={material.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="打开资料"
                    >
                      <ExternalLink size={15} />
                    </a>
                  </Button>
                ) : canWrite && canGenerate ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label="预览资料"
                    onClick={() => onGenerateFrom(material)}
                    title="资料没有外链 — 点击直接进入 AI 出题"
                  >
                    <Eye size={15} />
                  </Button>
                ) : null}
                {canWrite ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="更多操作"
                      >
                        <MoreHorizontal size={15} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      {material.url ? (
                        <DropdownMenuItem asChild>
                          <a
                            href={material.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={14} className="mr-2" />
                            打开链接
                          </a>
                        </DropdownMenuItem>
                      ) : null}
                      {canGenerate ? (
                        <DropdownMenuItem
                          onClick={() => onGenerateFrom(material)}
                        >
                          <Sparkles size={14} className="mr-2" />
                          从资料生成题目
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onClick={() => onAssociate(material)}>
                        <Layers3 size={14} className="mr-2" />
                        关联知识点
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDelete(material)}
                      >
                        <Trash2 size={14} className="mr-2" />
                        删除资料
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KnowledgeTargetSelect({
  id,
  targets,
  value,
  onChange,
}: {
  id: string;
  targets: CourseKnowledgeUploadTarget[];
  value: string;
  onChange: (nodeId: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="选择知识点" />
      </SelectTrigger>
      <SelectContent>
        {targets.map((target) => (
          <SelectItem key={target.id} value={target.id}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-sans text-muted-foreground">
                {"　".repeat(target.depth)}
              </span>
              <span className="truncate">{target.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function UploadCourseMaterialDialog({
  open,
  uploading,
  targets,
  selectedNodeId,
  files,
  onOpenChange,
  onSelectedNodeChange,
  onFilesChange,
  onSubmit,
}: {
  open: boolean;
  uploading: boolean;
  targets: CourseKnowledgeUploadTarget[];
  selectedNodeId: string;
  files: File[];
  onOpenChange: (open: boolean) => void;
  onSelectedNodeChange: (nodeId: string) => void;
  onFilesChange: (files: File[]) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const autoMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragging, setDragging] = useState(false);
  const [autoMatchNotice, setAutoMatchNotice] = useState<{
    targetName: string;
    fileName: string;
  } | null>(null);
  const fileCount = files.length;
  const clearAutoMatchTimer = useCallback(() => {
    if (autoMatchTimerRef.current) {
      clearTimeout(autoMatchTimerRef.current);
      autoMatchTimerRef.current = null;
    }
  }, []);
  const flashAutoMatchedTarget = (
    target: CourseKnowledgeUploadTarget,
    file: File,
  ) => {
    clearAutoMatchTimer();
    setAutoMatchNotice({ targetName: target.name, fileName: file.name });
    autoMatchTimerRef.current = setTimeout(() => {
      setAutoMatchNotice(null);
      autoMatchTimerRef.current = null;
    }, 2200);
  };
  const addFiles = (incoming: FileList | File[]) => {
    const nextFiles = Array.from(incoming).filter((file) => file.size > 0);
    if (nextFiles.length === 0) return;
    const mergedFiles = mergeMaterialUploadFiles(files, nextFiles);
    const matched = findAutoMatchedMaterialTarget(nextFiles, targets);
    if (matched) {
      onSelectedNodeChange(matched.target.id);
      flashAutoMatchedTarget(matched.target, matched.file);
    }
    onFilesChange(mergedFiles);
  };
  const removeFile = (fileToRemove: File) => {
    const keyToRemove = getFileKey(fileToRemove);
    onFilesChange(files.filter((file) => getFileKey(file) !== keyToRemove));
  };
  const openFilePicker = () => {
    if (!uploading) inputRef.current?.click();
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!uploading) addFiles(event.dataTransfer.files);
  };
  const handleKeyboardOpen = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  };
  useEffect(() => {
    if (!open || fileCount === 0) {
      clearAutoMatchTimer();
      setAutoMatchNotice(null);
    }
  }, [clearAutoMatchTimer, fileCount, open]);
  useEffect(() => () => clearAutoMatchTimer(), [clearAutoMatchTimer]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>上传课程资料</DialogTitle>
          <DialogDescription>
            选择资料对应的课程知识点，可一次选择多个文件上传。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="course-material-upload-node">关联知识点</Label>
            <div
              className={cn(
                "rounded-md transition-all",
                autoMatchNotice &&
                  "animate-pulse ring-2 ring-primary/50 ring-offset-2 ring-offset-background",
              )}
            >
              <KnowledgeTargetSelect
                id="course-material-upload-node"
                targets={targets}
                value={selectedNodeId}
                onChange={(nodeId) => {
                  clearAutoMatchTimer();
                  setAutoMatchNotice(null);
                  onSelectedNodeChange(nodeId);
                }}
              />
            </div>
            {autoMatchNotice ? (
              <p className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                <CheckCircle2 size={13} />
                已根据《{autoMatchNotice.fileName}》自动匹配到：
                {autoMatchNotice.targetName}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                如果课程目录还未完善，默认选择课程本身。
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="course-material-upload-file">资料文件</Label>
            <div
              role="button"
              tabIndex={0}
              aria-disabled={uploading}
              onClick={openFilePicker}
              onKeyDown={handleKeyboardOpen}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!uploading) setDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (!uploading) setDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                const relatedTarget = event.relatedTarget;
                if (
                  relatedTarget instanceof Node &&
                  event.currentTarget.contains(relatedTarget)
                ) {
                  return;
                }
                setDragging(false);
              }}
              onDrop={handleDrop}
              className={cn(
                "group flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 px-4 py-8 text-center transition-colors",
                "hover:border-primary/70 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45",
                dragging
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground",
                uploading &&
                  "pointer-events-none cursor-not-allowed opacity-60",
              )}
            >
              <input
                ref={inputRef}
                id="course-material-upload-file"
                className="hidden"
                type="file"
                multiple
                disabled={uploading}
                onChange={(event) => {
                  addFiles(event.target.files ?? []);
                  event.currentTarget.value = "";
                }}
              />
              <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                <Upload size={20} />
              </div>
              <p className="text-sm font-semibold text-foreground">
                拖拽资料到这里，或点击选择文件
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                支持一次选择多个 PDF、Word、PPT、图片等资料文件
              </p>
            </div>
            {fileCount > 0 ? (
              <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
                <div className="flex items-center justify-between border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
                  <span>已选择 {fileCount} 个文件</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={uploading}
                    onClick={() => onFilesChange([])}
                  >
                    清空
                  </Button>
                </div>
                <div className="flex max-h-44 flex-col gap-1 overflow-y-auto p-2">
                  {files.map((file) => (
                    <div
                      key={getFileKey(file)}
                      className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted/70"
                    >
                      <FileText size={16} className="shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {file.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(file.size)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={uploading}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeFile(file);
                        }}
                        aria-label={`删除 ${file.name}`}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={!selectedNodeId || fileCount === 0 || uploading}
            onClick={onSubmit}
          >
            {uploading ? (
              <LoaderCircle size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Upload size={14} className="mr-1.5" />
            )}
            {fileCount > 1 ? `上传 ${fileCount} 个文件` : "上传"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssociateMaterialKnowledgeDialog({
  open,
  saving,
  material,
  targets,
  selectedNodeId,
  onOpenChange,
  onSelectedNodeChange,
  onSubmit,
}: {
  open: boolean;
  saving: boolean;
  material: TeacherCourseMaterial | null;
  targets: CourseKnowledgeUploadTarget[];
  selectedNodeId: string;
  onOpenChange: (open: boolean) => void;
  onSelectedNodeChange: (nodeId: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>关联知识点</DialogTitle>
          <DialogDescription>
            将资料关联到本课程下的某个知识点。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <p className="truncate text-sm font-medium">
              {material?.title ?? "课程资料"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              当前关联：{material?.node_name ?? "课程节点"}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="course-material-associate-node">关联知识点</Label>
            <KnowledgeTargetSelect
              id="course-material-associate-node"
              targets={targets}
              value={selectedNodeId}
              onChange={onSelectedNodeChange}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={!selectedNodeId || saving}
            onClick={onSubmit}
          >
            {saving ? (
              <LoaderCircle size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Layers3 size={14} className="mr-1.5" />
            )}
            保存关联
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchGenerateMaterialsDialog({
  open,
  materials,
  running,
  progress,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  materials: TeacherCourseMaterial[];
  running: boolean;
  progress: CourseMaterialBatchProgress | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (items: CourseMaterialBatchGenerateItem[]) => Promise<void>;
}) {
  const generatable = useMemo(
    () => materials.filter(canGenerateQuestionsFromCourseMaterial),
    [materials],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [countsById, setCountsById] = useState<Record<string, number>>({});
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    const nextIds = new Set(generatable.map((material) => material.id));
    setSelectedIds(nextIds);
    const nextCounts: Record<string, number> = {};
    for (const material of generatable) {
      nextCounts[material.id] = countsById[material.id] ?? 5;
    }
    setCountsById(nextCounts);
    setTotalCount(generatable.length * 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, generatable.length]);

  const selectedMaterials = generatable.filter((material) =>
    selectedIds.has(material.id),
  );
  const selectedCount = selectedMaterials.length;
  const effectiveTotal = selectedMaterials.reduce(
    (sum, material) => sum + Math.max(0, countsById[material.id] ?? 0),
    0,
  );
  const progressPercent = progress
    ? Math.min(
        100,
        Math.round(
          ((progress.currentIndex - 1 + (progress.phase === "done" ? 1 : 0.5)) /
            Math.max(1, progress.total)) *
            100,
        ),
      )
    : 0;

  const toggleMaterial = (materialId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(materialId)) {
        next.delete(materialId);
      } else {
        next.add(materialId);
      }
      return next;
    });
  };

  const applyAverage = (nextTotal: number) => {
    setTotalCount(nextTotal);
    const selected = generatable.filter((material) =>
      selectedIds.has(material.id),
    );
    if (selected.length === 0) return;
    const base = Math.floor(nextTotal / selected.length);
    const remainder = nextTotal % selected.length;
    setCountsById((current) => {
      const next = { ...current };
      selected.forEach((material, index) => {
        next[material.id] = Math.max(1, base + (index < remainder ? 1 : 0));
      });
      return next;
    });
  };

  const submit = async () => {
    const items = selectedMaterials
      .map((material) => ({
        material,
        count: Math.max(0, countsById[material.id] ?? 0),
      }))
      .filter((item) => item.count > 0);
    if (items.length === 0) return;
    await onSubmit(items);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (running) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="flex max-h-[86vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>一键生成题目</DialogTitle>
          <DialogDescription>
            按资料顺序批量生成题目。当前资料生成并保存完成后，系统会自动处理下一份资料。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="batch-material-total" className="text-xs">
                总题数
              </Label>
              <Input
                id="batch-material-total"
                type="number"
                min={selectedCount}
                max={selectedCount * 50 || 50}
                className="h-8 w-24"
                value={totalCount}
                disabled={running || selectedCount === 0}
                onChange={(event) =>
                  applyAverage(Math.max(1, Number(event.target.value) || 1))
                }
              />
            </div>
            <span className="text-xs text-muted-foreground">
              已选 {selectedCount} 份资料，当前将生成 {effectiveTotal} 道题
            </span>
          </div>

          <div className="space-y-2">
            {generatable.length === 0 ? (
              <EmptyPanel
                icon={<FileText size={22} />}
                title="没有可生成题目的资料"
                description="仅 PDF、DOCX、PPTX 上传资料支持一键生成题目。"
              />
            ) : (
              generatable.map((material, index) => {
                const checked = selectedIds.has(material.id);
                return (
                  <div
                    key={material.id}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5",
                      !checked && "opacity-60",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={running}
                      onCheckedChange={() => toggleMaterial(material.id)}
                      aria-label="选择资料"
                    />
                    <span className="w-7 shrink-0 font-sans text-sm font-semibold lining-nums tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {material.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {material.node_name ?? "课程节点"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`batch-material-count-${material.id}`}
                        className="whitespace-nowrap text-xs text-muted-foreground"
                      >
                        题数
                      </Label>
                      <Input
                        id={`batch-material-count-${material.id}`}
                        type="number"
                        min={1}
                        max={50}
                        className="h-8 w-20"
                        disabled={running || !checked}
                        value={countsById[material.id] ?? 5}
                        onChange={(event) =>
                          setCountsById((current) => ({
                            ...current,
                            [material.id]: Math.max(
                              1,
                              Math.min(50, Number(event.target.value) || 1),
                            ),
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {running && progress ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 px-3 py-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-foreground">
                  正在处理 {progress.currentIndex}/{progress.total}：
                  {progress.currentTitle}
                </span>
                <span className="shrink-0 font-sans lining-nums tabular-nums text-muted-foreground">
                  已保存 {progress.saved} 题
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {progress.phase === "generating"
                  ? `正在生成题目，已收到 ${progress.generated} 道。`
                  : progress.phase === "saving"
                    ? "正在保存到课程题库。"
                    : "当前资料已完成，准备处理下一份。"}
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={running}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={running || selectedCount === 0 || effectiveTotal === 0}
            onClick={() => void submit()}
          >
            {running ? (
              <LoaderCircle size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Sparkles size={14} className="mr-1.5" />
            )}
            {running ? "生成中" : "确定生成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentScoreSummaryDialog({
  open,
  loading,
  summary,
  courseName,
  semesterLabel,
  onOpenChange,
  onRefresh,
}: {
  open: boolean;
  loading: boolean;
  summary: CourseAssignmentScoreSummary | null;
  courseName: string;
  semesterLabel: string;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void | Promise<void>;
}) {
  const [routineScoreEdits, setRoutineScoreEdits] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    setRoutineScoreEdits({});
  }, [summary?.generated_at, summary?.course_id, summary?.semester_id, open]);

  const assignedTotal = useMemo(
    () =>
      summary?.students.reduce(
        (total, student) => total + student.assignment_count,
        0,
      ) ?? 0,
    [summary],
  );
  const submittedTotal = useMemo(
    () =>
      summary?.students.reduce(
        (total, student) => total + student.submitted_count,
        0,
      ) ?? 0,
    [summary],
  );
  const completionPercent =
    assignedTotal > 0 ? (submittedTotal / assignedTotal) * 100 : null;
  const getStudentRoutineScore = (
    student: CourseAssignmentScoreSummary["students"][number],
  ) => {
    const edited = routineScoreEdits[student.student_id];
    if (edited != null) {
      const trimmed = edited.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
    }
    return normalizePercentScore(student.average_percent);
  };
  const classAverageRoutineScore = useMemo(() => {
    if (!summary) return null;
    const scores = summary.students
      .map((student) => getStudentRoutineScore(student))
      .filter((score): score is number => score != null);
    if (scores.length === 0) return null;
    return scores.reduce((total, score) => total + score, 0) / scores.length;
  }, [routineScoreEdits, summary]);

  const exportCsv = () => {
    if (!summary) return;
    const headers = [
      "学号",
      "姓名",
      "用户名",
      "手机",
      "已交/已布置",
      "平时成绩(百分制)",
      "总得分",
      "总分",
      ...summary.assignments.map(
        (assignment) =>
          `${assignment.title}（满分${formatScore(assignment.total_score)}）`,
      ),
    ];
    const rows = summary.students.map((student) => {
      const cellsByAssignment = new Map(
        student.cells.map((cell) => [cell.assignment_id, cell]),
      );
      return [
        student.student_no ?? "",
        student.full_name ?? "",
        student.username ?? "",
        student.phone ?? "",
        `${student.submitted_count}/${student.assignment_count}`,
        getStudentRoutineScore(student) == null
          ? ""
          : Number(getStudentRoutineScore(student)).toFixed(2),
        Number(student.total_score).toFixed(2),
        Number(student.max_score).toFixed(2),
        ...summary.assignments.map((assignment) => {
          const cell = cellsByAssignment.get(assignment.id);
          if (!cell?.assigned) return "未布置";
          if (cell.score == null) return cell.submitted_at ? "待批" : "未交";
          return Number(cell.score).toFixed(2);
        }),
      ];
    });
    const csv = [headers, ...rows]
      .map((row) => row.map(escapeCsvCell).join(","))
      .join("\n");
    const blob = new Blob([`\ufeff${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeCourseName = (courseName || "课程").replace(/[\\/:*?"<>|]/g, "-");
    const safeSemester = semesterLabel.replace(/[\\/:*?"<>|]/g, "-");
    link.href = url;
    link.download = `${safeCourseName}-平时成绩汇总-${safeSemester}-${formatDate(new Date().toISOString())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderAssignmentCell = (
    student: CourseAssignmentScoreSummary["students"][number],
    assignmentId: string,
    totalScore: number,
  ) => {
    const cell = student.cells.find(
      (item) => item.assignment_id === assignmentId,
    );
    if (!cell?.assigned) {
      return <span className="text-xs text-muted-foreground/70">未布置</span>;
    }
    if (cell.score == null) {
      return (
        <span className="text-xs text-muted-foreground">
          {cell.submitted_at ? "待批" : "未交"}
        </span>
      );
    }
    return (
      <span className="inline-flex flex-col leading-tight">
        <span className="font-sans text-sm font-semibold lining-nums tabular-nums text-foreground">
          {formatScore(cell.score)}
          <span className="text-xs font-medium text-muted-foreground">
            /{formatScore(totalScore)}
          </span>
        </span>
        <span className="font-sans text-[11px] lining-nums tabular-nums text-muted-foreground">
          {formatPercent(cell.percent)}
        </span>
      </span>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle>平时成绩汇总</DialogTitle>
          <DialogDescription>
            {courseName} · {semesterLabel} · 练习成绩按学生已布置范围汇总
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
            <LoaderCircle size={18} className="mr-2 animate-spin" />
            正在汇总练习成绩...
          </div>
        ) : !summary || summary.assignment_count === 0 ? (
          <EmptyPanel
            icon={<ClipboardList size={22} />}
            title="暂无可汇总的练习"
            description="当前课程或学期下还没有练习成绩。"
          />
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-hidden">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["练习数", summary.assignment_count],
                ["学生数", summary.student_count],
                ["平均平时成绩", formatRoutineScore(classAverageRoutineScore)],
                ["提交率", formatPercent(completionPercent)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-border bg-muted/20 px-3 py-2.5"
                >
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 font-sans text-xl font-semibold lining-nums tabular-nums text-foreground">
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <div className="min-h-0 overflow-auto rounded-lg border border-border">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="sticky left-0 z-20 w-44 bg-muted px-3 py-2 font-medium">
                      学生
                    </th>
                    <th className="w-28 px-3 py-2 font-medium">完成</th>
                    <th className="w-32 px-3 py-2 font-medium">平时成绩(分)</th>
                    <th className="w-28 px-3 py-2 font-medium">总分</th>
                    {summary.assignments.map((assignment) => (
                      <th
                        key={assignment.id}
                        className="min-w-[150px] px-3 py-2 font-medium"
                      >
                        <div className="line-clamp-2 text-foreground">
                          {assignment.title}
                        </div>
                        <div className="mt-0.5 font-sans lining-nums tabular-nums">
                          {assignment.submitted_count}/
                          {assignment.total_students}
                          <span className="ml-1">
                            · {formatScore(assignment.total_score)} 分
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.students.map((student) => (
                    <tr
                      key={student.student_id}
                      className="border-t border-border bg-card hover:bg-muted/20"
                    >
                      <td className="sticky left-0 z-10 bg-card px-3 py-2 align-top shadow-[1px_0_0_hsl(var(--border))]">
                        <div className="font-medium text-foreground">
                          {student.full_name ||
                            student.username ||
                            "未命名学生"}
                        </div>
                        <div className="mt-0.5 font-sans text-[11px] lining-nums tabular-nums text-muted-foreground">
                          {student.student_no ||
                            student.username ||
                            student.phone ||
                            "-"}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top font-sans lining-nums tabular-nums">
                        {student.submitted_count}/{student.assignment_count}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step="0.1"
                          value={
                            routineScoreEdits[student.student_id] ??
                            (normalizePercentScore(student.average_percent) == null
                              ? ""
                              : formatScore(
                                  normalizePercentScore(
                                    student.average_percent,
                                  ),
                                ))
                          }
                          className="h-8 w-24 font-sans text-sm font-semibold lining-nums tabular-nums"
                          aria-label={`修改${student.full_name || student.username || "学生"}的平时成绩`}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setRoutineScoreEdits((current) => ({
                              ...current,
                              [student.student_id]: nextValue,
                            }));
                          }}
                          onBlur={(event) => {
                            const trimmed = event.target.value.trim();
                            if (!trimmed) return;
                            const parsed = Number(trimmed);
                            if (!Number.isFinite(parsed)) return;
                            setRoutineScoreEdits((current) => ({
                              ...current,
                              [student.student_id]: formatScore(
                                Math.max(0, Math.min(100, parsed)),
                              ),
                            }));
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 align-top font-sans lining-nums tabular-nums">
                        {formatScore(student.total_score)}/
                        {formatScore(student.max_score)}
                      </td>
                      {summary.assignments.map((assignment) => (
                        <td key={assignment.id} className="px-3 py-2 align-top">
                          {renderAssignmentCell(
                            student,
                            assignment.id,
                            assignment.total_score,
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => void onRefresh()}
          >
            {loading ? (
              <LoaderCircle size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Calculator size={14} className="mr-1.5" />
            )}
            重新汇总
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              关闭
            </Button>
            <Button
              type="button"
              disabled={loading || !summary || summary.students.length === 0}
              onClick={exportCsv}
            >
              <Download size={14} className="mr-1.5" />
              导出
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExamRows({
  items,
  kind,
  semesters,
  canWrite,
  onSummarize,
  onArchive,
  onNewSemester,
  onClose,
  onDelete,
  onGenerateMock,
  onCreate,
  onExport,
}: {
  items: TeacherCourseExam[];
  kind: "exam" | "assignment";
  semesters: CourseSemester[];
  canWrite: boolean;
  onSummarize?: () => void;
  onArchive: (examId: string, semesterId: string | null) => Promise<void>;
  onNewSemester: () => void;
  onClose: (exam: TeacherCourseExam) => void;
  onDelete: (exam: TeacherCourseExam) => void;
  onGenerateMock?: (exam: TeacherCourseExam) => void;
  onCreate: () => void;
  onExport?: (
    exam: TeacherCourseExam,
    format: "docx" | "pdf",
    answers: boolean,
  ) => void;
}) {
  const navigate = useNavigate();
  const header =
    kind === "assignment" || canWrite ? (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {kind === "assignment" ? (
          <Button variant="outline" size="sm" onClick={onSummarize}>
            <Calculator size={14} className="mr-1.5" />
            平时成绩汇总
          </Button>
        ) : null}
        {canWrite ? (
          <Button size="sm" onClick={onCreate}>
            <Plus size={14} className="mr-1.5" />
            新建{kind === "exam" ? "考试" : "练习"}
          </Button>
        ) : null}
      </div>
    ) : null;
  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <ExamCardEmptyState
          title={kind === "exam" ? "暂无考试" : "暂无练习"}
          description={
            kind === "exam"
              ? "从课程进入创建考试时，会默认带入当前课程。"
              : "教师侧显示为练习，底层仍复用 practice。"
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {header}
      {items.map((item) => {
        const semesterBadge = item.semester_name ? (
          <Badge
            variant="outline"
            className="gap-1 rounded-md border-border bg-muted px-1.5 py-0 text-[11px] font-medium text-muted-foreground"
          >
            <CalendarRange size={11} />
            {item.semester_name}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="rounded-md border-dashed border-border bg-transparent px-1.5 py-0 text-[11px] font-medium text-muted-foreground"
          >
            未归档
          </Badge>
        );
        const archiveMenuItems = canWrite ? (
          <>
              <DropdownMenuItem
                disabled
                className="text-[11px] uppercase tracking-wider text-muted-foreground/70"
              >
                归档到学期
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {semesters.length === 0 ? (
                <DropdownMenuItem onClick={onNewSemester}>
                  <Plus size={14} className="mr-2" />
                  新建学期
                </DropdownMenuItem>
              ) : (
                semesters.map((semester) => (
                  <DropdownMenuItem
                    key={semester.id}
                    onClick={() => void onArchive(item.id, semester.id)}
                    className={cn(
                      item.semester_id === semester.id && "bg-accent",
                    )}
                  >
                    <CalendarRange
                      size={14}
                      className="mr-2 text-muted-foreground"
                    />
                    {semester.name}
                  </DropdownMenuItem>
                ))
              )}
              {item.semester_id ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => void onArchive(item.id, null)}
                  >
                    移出学期（设为未归档）
                  </DropdownMenuItem>
                </>
              ) : null}
          </>
        ) : null;
        return (
          <ExamCard
            key={item.id}
            exam={item}
            onView={() => navigate(`/exams/${item.id}/view`)}
            onEdit={() =>
              navigate(
                item.category === "practice"
                  ? `/exams/practice/edit/${item.id}`
                  : `/exams/edit/${item.id}`,
              )
            }
            onAnalysis={() => navigate(`/exams/${item.id}/analysis`)}
            onGenerateMock={
              kind === "exam" && onGenerateMock
                ? () => onGenerateMock(item)
                : undefined
            }
            onClose={() => onClose(item)}
            onDelete={() => onDelete(item)}
            onExport={
              onExport
                ? (format, answers) => onExport(item, format, answers)
                : undefined
            }
            extraBadges={semesterBadge}
            moreActions={archiveMenuItems}
            collapseSecondaryActions
            canManage={canWrite}
          />
        );
      })}
    </div>
  );
}
function QuestionsTab({
  questions,
  courseId,
  courseName,
  courseSemesterId,
  courseSemester,
  targetCourseKpId = courseId,
  knowledgeFilterOptions,
  knowledgeFilterNodeId,
  onKnowledgeFilterChange,
  existingExamTitles,
  knowledgeTree,
  canWrite,
  showClearAllQuestions = true,
  seedUsage,
  onPublishedExamOrAssignment,
  onClearAllQuestions,
}: {
  questions: IQuestion[];
  courseId: string;
  courseName: string;
  courseSemesterId: string | null;
  courseSemester: CourseSemester | null;
  targetCourseKpId?: string;
  knowledgeFilterOptions: Array<{
    id: string;
    name: string;
    depth: number;
    path: string;
  }>;
  knowledgeFilterNodeId: string | null;
  onKnowledgeFilterChange: (nodeId: string | null) => void;
  existingExamTitles: string[];
  knowledgeTree: CourseKnowledgeNode | null;
  canWrite: boolean;
  showClearAllQuestions?: boolean;
  /** question_id -> 使用该题作为种子的出题技能（题库列表徽标） */
  seedUsage?: SeedUsageMap;
  onPublishedExamOrAssignment: (
    category: CreateFromSelectionCategory,
  ) => void | Promise<void>;
  onClearAllQuestions: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createFromSelectionOpen, setCreateFromSelectionOpen] = useState(false);
  const [allQuestionsExpanded, setAllQuestionsExpanded] = useState(false);
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<
    Set<QuestionType>
  >(new Set());

  useEffect(() => {
    const questionIds = new Set(questions.map((question) => question.id));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => questionIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [questions]);

  const questionTypeCounts = useMemo(() => {
    const counts = new Map<QuestionType, number>();
    for (const question of questions) {
      const type = normalizeQuestionType(question.type);
      if (!type) continue;
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return counts;
  }, [questions]);

  const availableQuestionTypes = QUESTION_TYPE_FILTERS.filter((type) =>
    questionTypeCounts.has(type),
  );
  const questionTypeFilterLabel =
    selectedQuestionTypes.size === 0
      ? "全部题型"
      : selectedQuestionTypes.size === 1
        ? questionTypeFullLabel[[...selectedQuestionTypes][0]]
        : `${selectedQuestionTypes.size} 种题型`;

  const toggleQuestionTypeFilter = (type: QuestionType) => {
    setSelectedQuestionTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const filtered = questions.filter((question) => {
    const normalizedType = normalizeQuestionType(question.type);
    const matchesType =
      selectedQuestionTypes.size === 0 ||
      (normalizedType ? selectedQuestionTypes.has(normalizedType) : false);
    if (!matchesType) return false;

    const text =
      `${question.title} ${question.knowledge_points.map((kp) => kp.name).join(" ")}`.toLowerCase();
    return !query.trim() || text.includes(query.trim().toLowerCase());
  });
  const visibleQuestionIds = new Set(filtered.map((question) => question.id));
  const selectedQuestionIds = [...selected].filter((id) =>
    visibleQuestionIds.has(id),
  );
  const selectedQuestionCount = selectedQuestionIds.length;
  const selectedQuestionsInOrder = filtered.filter((question) =>
    selectedQuestionIds.includes(question.id),
  );
  const selectedKnowledgeOption = knowledgeFilterOptions.find(
    (item) => item.id === knowledgeFilterNodeId,
  );
  const defaultCreateTitle = (() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 练习`;
  })();

  const toggleSelect = (questionId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((current) => {
      if (selectedQuestionCount === filtered.length) {
        const next = new Set(current);
        for (const question of filtered) {
          next.delete(question.id);
        }
        return next;
      }
      return new Set([...current, ...filtered.map((question) => question.id)]);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {knowledgeFilterOptions.length > 0 ? (
          <Select
            value={knowledgeFilterNodeId ?? ALL_QUESTION_KNOWLEDGE}
            onValueChange={(value) =>
              onKnowledgeFilterChange(
                value === ALL_QUESTION_KNOWLEDGE ? null : value,
              )
            }
          >
            <SelectTrigger className="h-9 min-w-[180px] flex-1 sm:max-w-[240px] lg:flex-none">
              <SelectValue placeholder="全部知识点" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_QUESTION_KNOWLEDGE}>全部知识点</SelectItem>
              {knowledgeFilterOptions.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {"　".repeat(Math.max(0, item.depth - 1))}
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="flex-1" />
        <div className="relative min-w-[220px] flex-1 sm:max-w-[280px] lg:flex-none">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索题目..."
            className="h-9 pl-9"
          />
        </div>
        {canWrite ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate("/questions/import", {
                  state: {
                    backTo: `/courses/${courseId}?tab=questions`,
                    backLabel: "返回课程详情",
                    successTo: `/courses/${courseId}?tab=questions`,
                    courseKpId: targetCourseKpId,
                    courseName,
                  },
                })
              }
            >
              <Upload size={14} className="mr-1.5" />
              导入
            </Button>
            {showClearAllQuestions && questions.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={onClearAllQuestions}
              >
                <Trash2 size={14} className="mr-1.5" />
                清除
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const seedKey = writeExamSeed({
                  category: "exam",
                  title: `${courseName.trim() || "课程"}-考试`,
                  description: courseSemester
                    ? `来自课程「${courseName}」${courseSemester.name}。`
                    : `来自课程「${courseName}」。`,
                  question_items: [],
                  student_ids: [],
                });
                const params = new URLSearchParams();
                params.set("seed_key", seedKey);
                navigate(`/exams/create?${params.toString()}`, {
                  state: {
                    backTo: `/courses/${courseId}?tab=questions`,
                    backLabel: "返回课程题目",
                    successTo: `/courses/${courseId}?tab=exams`,
                    courseKpId: targetCourseKpId,
                    courseName,
                    existingExamTitles,
                    defaultBankName: courseQuestionBankName(courseName),
                    mainKnowledgePointId: knowledgeTree?.id ?? courseId,
                    mainKnowledgePointName: courseName,
                    ...(selectedKnowledgeOption
                      ? {
                          knowledgePointId: selectedKnowledgeOption.id,
                          knowledgePointName: selectedKnowledgeOption.name,
                          knowledgePointPath: selectedKnowledgeOption.path,
                          initialStep: 1,
                        }
                      : {}),
                    ...(courseSemesterId
                      ? { courseSemesterId }
                      : {}),
                  },
                });
              }}
            >
              <ClipboardList size={14} className="mr-1.5" />
              发布考试
            </Button>
            <Button
              size="sm"
              onClick={() =>
                navigate("/questions/create", {
                  state: {
                    backTo: `/courses/${courseId}?tab=questions`,
                    backLabel: "返回课程详情",
                    successTo: `/courses/${courseId}?tab=questions`,
                    courseKpId: targetCourseKpId,
                  },
                })
              }
            >
              <Plus size={14} className="mr-1.5" />
              创建题目
            </Button>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            <Lock size={13} />
            只读
          </span>
        )}
      </div>
      {canWrite && filtered.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-muted/30 px-3">
            <Checkbox
              checked={
                selectedQuestionCount === filtered.length && filtered.length > 0
              }
              onCheckedChange={toggleSelectAll}
              aria-label="全选题目"
            />
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {selectedQuestionCount > 0
                ? `已选择 ${selectedQuestionCount} 题`
                : "全选"}
            </span>
          </div>
          {selectedQuestionCount > 0 ? (
            <Button
              type="button"
              size="sm"
              className="h-9 px-3 text-xs"
              onClick={() => setCreateFromSelectionOpen(true)}
            >
              <FilePlus2 size={13} className="mr-1.5" />
              发起考试/练习
            </Button>
          ) : null}
          <div className="flex-1" />
          {availableQuestionTypes.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 text-xs"
                >
                  题型：{questionTypeFilterLabel}
                  <ChevronDown size={13} className="ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onClick={() => setSelectedQuestionTypes(new Set())}
                >
                  全部题型
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {availableQuestionTypes.map((type) => (
                  <DropdownMenuCheckboxItem
                    key={type}
                    checked={selectedQuestionTypes.has(type)}
                    onCheckedChange={() => toggleQuestionTypeFilter(type)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    <span className="flex flex-1 items-center justify-between gap-3">
                      <span>{questionTypeFullLabel[type]}</span>
                      <span className="font-sans text-xs tabular-nums text-muted-foreground">
                        {questionTypeCounts.get(type)}
                      </span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs"
            onClick={() => setAllQuestionsExpanded((expanded) => !expanded)}
          >
            {allQuestionsExpanded ? "全部收起" : "全部展开"}
          </Button>
        </div>
      ) : null}
      {filtered.length === 0 ? (
        <EmptyPanel
          icon={<BookOpen size={22} />}
          title="暂无题目"
          description="题目会按当前课程及其子知识点聚合展示。"
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="space-y-3">
            {filtered.map((question, index) => (
              <QuestionPreviewCard
                key={question.id}
                question={question}
                index={index + 1}
                expanded={allQuestionsExpanded}
                expandOnClick
                hideAnswer
                markChoiceAnswer
                className="cursor-pointer transition-all hover:border-primary hover:shadow-md"
                trailing={
                  <div className="flex items-center gap-2">
                    {seedUsage?.[question.id]?.length ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-300"
                        title={`该题是出题技能的种子题：${seedUsage[question.id].map((u) => u.name).join("、")}`}
                      >
                        种子 · {seedUsage[question.id].map((u) => u.name).join("、")}
                      </Badge>
                    ) : null}
                    {canWrite ? (
                      <Checkbox
                        checked={selected.has(question.id)}
                        onCheckedChange={() => toggleSelect(question.id)}
                        aria-label={
                          selected.has(question.id) ? "取消选择题目" : "选择题目"
                        }
                      />
                    ) : null}
                  </div>
                }
                actions={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5 text-xs text-muted-foreground hover:text-primary sm:px-2"
                    onClick={() =>
                      navigate(`/questions/edit/${question.id}`, {
                        state: {
                          backTo: `/courses/${courseId}?tab=questions`,
                          backLabel: "返回课程题目",
                          successTo: `/courses/${courseId}?tab=questions`,
                        },
                      })
                    }
                  >
                    <Eye size={13} className="sm:mr-1" />
                    <span className="hidden sm:inline">打开题目</span>
                  </Button>
                }
              />
            ))}
          </div>
        </div>
      )}

      <CreateFromSelectionDialog
        open={createFromSelectionOpen}
        onOpenChange={setCreateFromSelectionOpen}
        selected={selectedQuestionsInOrder.map((question) => ({
          id: question.id,
          type: question.type,
          score: question.score,
        }))}
        defaultTitle={defaultCreateTitle}
        courseKpId={targetCourseKpId}
        courseSemesterId={courseSemesterId}
        onPublished={(_, category) => {
          void onPublishedExamOrAssignment(category);
        }}
      />
    </div>
  );
}

function CourseKnowledgeNodeDialog({
  open,
  node,
  nodePath,
  course,
  materials,
  questions,
  canWrite,
  onOpenChange,
  onRename,
  onAddLink,
  onUploadFiles,
  onUpdateMaterial,
  onDeleteMaterial,
  onGenerateFromMaterial,
  extractingMaterialId,
  onGenerateQuestions,
  onCreateQuestion,
  onViewQuestion,
  onOpenAddNode,
  onRequestDeleteNode,
}: {
  open: boolean;
  node: CourseKnowledgeNode | null;
  nodePath: string[];
  course: TeacherCourseDetail;
  materials: TeacherCourseMaterial[];
  questions: IQuestion[];
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (nodeId: string, name: string) => Promise<void>;
  onAddLink: (
    nodeId: string,
    payload: { title: string; url: string; description?: string | null },
  ) => Promise<void>;
  onUploadFiles: (nodeId: string, files: File[]) => Promise<void>;
  onUpdateMaterial: (
    materialId: string,
    payload: {
      title?: string;
      url?: string | null;
      description?: string | null;
    },
  ) => Promise<void>;
  onDeleteMaterial: (material: TeacherCourseMaterial) => void;
  onGenerateFromMaterial: (material: TeacherCourseMaterial) => void;
  extractingMaterialId: string | null;
  onGenerateQuestions: (node: CourseKnowledgeNode) => void;
  onCreateQuestion: (node: CourseKnowledgeNode) => void;
  onViewQuestion: (questionId: string) => void;
  onOpenAddNode: () => void;
  onRequestDeleteNode: (node: CourseKnowledgeNode) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [nameDraft, setNameDraft] = useState(node?.name ?? "");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkDescription, setLinkDescription] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(
    null,
  );
  const [materialDraft, setMaterialDraft] = useState({
    title: "",
    url: "",
    description: "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const nodeMaterials = node
    ? materials.filter((material) => material.node_id === node.id)
    : [];
  const nodeQuestions = node
    ? questions.filter((question) =>
        question.knowledge_points.some((kp) => kp.id === node.id),
      )
    : [];

  useEffect(() => {
    setNameDraft(node?.name ?? "");
    setLinkTitle("");
    setLinkUrl("");
    setLinkDescription("");
    setAddingLink(false);
    setNameSaved(false);
    setEditingMaterialId(null);
    setMaterialDraft({ title: "", url: "", description: "" });
    setBusy(null);
  }, [node?.id, open, node?.name]);

  const startEditMaterial = (material: TeacherCourseMaterial) => {
    setEditingMaterialId(material.id);
    setMaterialDraft({
      title: material.title,
      url: material.url ?? "",
      description: material.description ?? "",
    });
  };

  const saveName = async () => {
    if (!node) return;
    const nextName = nameDraft.trim();
    if (!nextName || nextName === node.name) return;
    setBusy("name");
    try {
      await onRename(node.id, nextName);
      setNameSaved(true);
      window.setTimeout(() => setNameSaved(false), 1600);
    } finally {
      setBusy(null);
    }
  };

  const saveLink = async () => {
    if (!node || !linkTitle.trim() || !linkUrl.trim()) return;
    setBusy("link");
    try {
      await onAddLink(node.id, {
        title: linkTitle.trim(),
        url: linkUrl.trim(),
        description: linkDescription.trim() || null,
      });
      setLinkTitle("");
      setLinkUrl("");
      setLinkDescription("");
      setAddingLink(false);
    } finally {
      setBusy(null);
    }
  };

  const saveMaterial = async (material: TeacherCourseMaterial) => {
    if (!materialDraft.title.trim()) return;
    setBusy(`material:${material.id}`);
    try {
      await onUpdateMaterial(material.id, {
        title: materialDraft.title.trim(),
        url: materialDraft.url.trim() || null,
        description: materialDraft.description.trim() || null,
      });
      setEditingMaterialId(null);
    } finally {
      setBusy(null);
    }
  };

  const uploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!node || files.length === 0) return;
    setBusy("upload");
    try {
      await onUploadFiles(node.id, files);
    } finally {
      setBusy(null);
      event.target.value = "";
    }
  };
  const nameDirty =
    nameDraft.trim().length > 0 && nameDraft.trim() !== (node?.name ?? "");
  const parentLabel =
    nodePath.length > 1 ? nodePath[nodePath.length - 2] : "课程根节点";
  const displayPath =
    nodePath.length > 0 ? nodePath.join(" / ") : course.display_path;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="left-auto right-0 top-0 flex h-dvh max-h-dvh w-[min(620px,94vw)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l bg-card p-0 shadow-[-20px_0_60px_hsl(var(--primary)/0.16)] sm:rounded-none [&>button]:hidden">
        {!node ? null : (
          <Tabs defaultValue="profile" className="flex min-h-0 flex-1 flex-col">
            <DialogHeader className="space-y-0 px-6 pt-[22px] text-left">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <DialogTitle className="truncate pr-0 text-[21px] font-bold leading-tight tracking-normal text-foreground">
                      {node.name}
                    </DialogTitle>
                    <Badge className="rounded-md bg-primary/10 px-2 py-0.5 font-sans text-[11.5px] font-semibold text-primary shadow-none hover:bg-primary/10">
                      知识点
                    </Badge>
                  </div>
                  <DialogDescription className="mt-1.5 text-[13px] leading-relaxed">
                    在课程「{course.name}」下维护这个节点的名称、资料与题目。
                  </DialogDescription>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-[34px] shrink-0 rounded-[9px] text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                  aria-label="关闭"
                  onClick={() => onOpenChange(false)}
                >
                  <X size={20} />
                </Button>
              </div>
            </DialogHeader>

            <TabsList className="mx-6 mt-[18px] h-auto w-fit gap-0.5 rounded-[11px] border border-border bg-muted/55 p-1">
              <TabsTrigger
                value="profile"
                className="rounded-lg px-[15px] py-[7px] text-[13.5px] font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
              >
                节点信息
              </TabsTrigger>
              <TabsTrigger
                value="materials"
                className="gap-1.5 rounded-lg px-[15px] py-[7px] text-[13.5px] font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
              >
                资料
                <span className="font-sans text-xs font-semibold tabular-nums opacity-80">
                  {nodeMaterials.length}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="questions"
                className="gap-1.5 rounded-lg px-[15px] py-[7px] text-[13.5px] font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
              >
                题目
                <span className="font-sans text-xs font-semibold tabular-nums opacity-80">
                  {nodeQuestions.length}
                </span>
              </TabsTrigger>
            </TabsList>

            <div className="mt-[18px] min-h-0 flex-1 overflow-y-auto border-t border-border px-6 pb-7 pt-[22px]">
              <TabsContent value="profile" className="mt-0 space-y-[22px]">
                <div>
                  <Label
                    htmlFor="course-node-name"
                    className="mb-[9px] block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
                  >
                    知识点名称
                  </Label>
                  <div className="flex gap-2.5">
                    <Input
                      id="course-node-name"
                      value={nameDraft}
                      disabled={!canWrite}
                      onChange={(event) => setNameDraft(event.target.value)}
                      className="h-[46px] rounded-[10px] border-input bg-card px-[13px] text-[14.5px] shadow-none focus-visible:ring-primary/20"
                    />
                    {canWrite ? (
                      <Button
                        type="button"
                        disabled={!nameDirty || busy === "name"}
                        onClick={() => void saveName()}
                        className={cn(
                          "h-[46px] shrink-0 rounded-[10px] px-5 text-sm font-semibold disabled:!bg-muted disabled:!text-muted-foreground",
                          nameSaved && "bg-primary hover:bg-primary",
                        )}
                      >
                        {busy === "name" ? (
                          <LoaderCircle
                            size={14}
                            className="mr-1.5 animate-spin"
                          />
                        ) : null}
                        {nameSaved ? "已保存" : "保存"}
                      </Button>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground/80">
                    名称将同步显示在课程目录树与题目归类中。
                  </p>
                </div>

                <div>
                  <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    节点概览
                  </p>
                  <div className="grid grid-cols-3 gap-2.5">
                    {[
                      ["直属资料", nodeMaterials.length, true],
                      ["直属题目", nodeQuestions.length, false],
                      ["下级节点", node.children.length, false],
                    ].map(([label, value, accent]) => (
                      <div
                        key={label.toString()}
                        className="rounded-[11px] border border-border bg-muted/35 px-3.5 py-3"
                      >
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p
                          className={cn(
                            "mt-1 font-sans text-[22px] font-bold leading-none tabular-nums",
                            accent ? "text-primary" : "text-foreground",
                          )}
                        >
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    位置与信息
                  </p>
                  <div className="overflow-hidden rounded-[11px] border border-border bg-card">
                    {[
                      ["所属课程", course.name],
                      ["上级节点", parentLabel],
                      ["节点路径", displayPath],
                    ].map(([label, value], index, rows) => (
                      <div
                        key={label}
                        className={cn(
                          "flex items-center gap-3.5 px-3.5 py-[11px]",
                          index < rows.length - 1 && "border-b border-border",
                        )}
                      >
                        <span className="w-[72px] shrink-0 text-[13px] text-muted-foreground">
                          {label}
                        </span>
                        <span className="min-w-0 truncate text-[13.5px] font-medium text-foreground/85">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {canWrite ? (
                  <div>
                    <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      节点操作
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-[9px] border-border bg-card px-3 text-[13px] font-medium text-primary hover:bg-primary/10 hover:text-primary"
                        onClick={onOpenAddNode}
                      >
                        <Layers3 size={15} className="mr-1.5" />
                        新增子知识点
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled
                        className="h-9 rounded-[9px] border-border bg-card px-3 text-[13px] font-medium"
                      >
                        <Move size={15} className="mr-1.5" />
                        移动节点
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-[9px] border-border bg-card px-3 text-[13px] font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onRequestDeleteNode(node)}
                      >
                        <Trash2 size={15} className="mr-1.5" />
                        删除此知识点
                      </Button>
                    </div>
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent value="materials" className="mt-0 space-y-4">
                {canWrite ? (
                  !addingLink ? (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-[9px] border-border bg-card px-3 text-[13px] font-medium text-primary hover:bg-primary/10 hover:text-primary"
                        onClick={() => setAddingLink(true)}
                      >
                        <Link2 size={15} className="mr-1.5" />
                        添加链接
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy === "upload"}
                        className="h-9 rounded-[9px] border-border bg-card px-3 text-[13px] font-medium"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {busy === "upload" ? (
                          <LoaderCircle
                            size={14}
                            className="mr-1.5 animate-spin"
                          />
                        ) : (
                          <Upload size={15} className="mr-1.5" />
                        )}
                        上传资料
                      </Button>
                      <input
                        ref={fileInputRef}
                        className="hidden"
                        type="file"
                        multiple
                        onChange={uploadFile}
                      />
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border bg-muted/35 p-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label
                            htmlFor="course-node-link-title"
                            className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
                          >
                            资料名称
                          </Label>
                          <Input
                            id="course-node-link-title"
                            value={linkTitle}
                            onChange={(event) =>
                              setLinkTitle(event.target.value)
                            }
                            className="h-[42px] rounded-[10px] bg-card"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label
                            htmlFor="course-node-link-url"
                            className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
                          >
                            资料链接
                          </Label>
                          <Input
                            id="course-node-link-url"
                            placeholder="https://..."
                            value={linkUrl}
                            onChange={(event) => setLinkUrl(event.target.value)}
                            className="h-[42px] rounded-[10px] bg-card"
                          />
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        <Label
                          htmlFor="course-node-link-desc"
                          className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
                        >
                          说明（可选）
                        </Label>
                        <Textarea
                          id="course-node-link-desc"
                          placeholder="对资料的简短说明..."
                          value={linkDescription}
                          onChange={(event) =>
                            setLinkDescription(event.target.value)
                          }
                          className="min-h-[60px] resize-none rounded-[10px] bg-card"
                        />
                      </div>
                      <div className="mt-3 flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="rounded-[9px]"
                          onClick={() => setAddingLink(false)}
                        >
                          取消
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={
                            !linkTitle.trim() ||
                            !linkUrl.trim() ||
                            busy === "link"
                          }
                          onClick={() => void saveLink()}
                        >
                          {busy === "link" ? (
                            <LoaderCircle
                              size={14}
                              className="mr-1.5 animate-spin"
                            />
                          ) : (
                            <Link2 size={14} className="mr-1.5" />
                          )}
                          添加链接
                        </Button>
                      </div>
                    </div>
                  )
                ) : null}

                {nodeMaterials.length === 0 ? (
                  <EmptyPanel
                    icon={<FileText size={22} />}
                    title="这个知识点还没有直属资料"
                    description="添加链接或上传文件后，可在这里维护资料并生成题目。"
                  />
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      已关联资料 · {nodeMaterials.length}
                    </p>
                    {nodeMaterials.map((material) => {
                      const isEditing = editingMaterialId === material.id;
                      const canGenerate =
                        canGenerateQuestionsFromCourseMaterial(material);
                      return (
                        <div
                          key={material.id}
                          className="rounded-xl border border-border bg-card p-3.5"
                        >
                          {isEditing ? (
                            <div className="space-y-3">
                              <Input
                                value={materialDraft.title}
                                onChange={(event) =>
                                  setMaterialDraft((current) => ({
                                    ...current,
                                    title: event.target.value,
                                  }))
                                }
                              />
                              <Input
                                value={materialDraft.url}
                                placeholder="资料链接"
                                onChange={(event) =>
                                  setMaterialDraft((current) => ({
                                    ...current,
                                    url: event.target.value,
                                  }))
                                }
                              />
                              <Textarea
                                value={materialDraft.description}
                                placeholder="资料说明"
                                onChange={(event) =>
                                  setMaterialDraft((current) => ({
                                    ...current,
                                    description: event.target.value,
                                  }))
                                }
                              />
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEditingMaterialId(null)}
                                >
                                  取消
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={
                                    !materialDraft.title.trim() ||
                                    busy === `material:${material.id}`
                                  }
                                  onClick={() => void saveMaterial(material)}
                                >
                                  {busy === `material:${material.id}` ? (
                                    <LoaderCircle
                                      size={14}
                                      className="mr-1.5 animate-spin"
                                    />
                                  ) : null}
                                  保存资料
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-3">
                              <div className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-primary/10 text-primary">
                                {materialIcon(
                                  material.resource_type,
                                  material.url,
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="break-all text-sm font-semibold leading-relaxed">
                                  {material.title}
                                </p>
                                <p className="mt-0.5 break-all text-xs leading-relaxed text-muted-foreground">
                                  {material.description ||
                                    material.url ||
                                    material.file_path ||
                                    "上传资料"}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {canWrite && canGenerate ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="secondary"
                                      className="h-8 rounded-[9px] bg-primary/10 text-primary hover:bg-primary/15"
                                      disabled={
                                        extractingMaterialId === material.id
                                      }
                                      onClick={() =>
                                        onGenerateFromMaterial(material)
                                      }
                                    >
                                      {extractingMaterialId === material.id ? (
                                        <LoaderCircle
                                          size={14}
                                          className="mr-1.5 animate-spin"
                                        />
                                      ) : (
                                        <Sparkles
                                          size={14}
                                          className="mr-1.5"
                                        />
                                      )}
                                      {extractingMaterialId === material.id
                                        ? "正在读取资料"
                                        : "从资料生成题目"}
                                    </Button>
                                  ) : null}
                                  {material.url ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-8 rounded-[9px]"
                                      asChild
                                    >
                                      <a
                                        href={material.url}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        <ExternalLink
                                          size={14}
                                          className="mr-1.5"
                                        />
                                        打开
                                      </a>
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                              {canWrite ? (
                                <div className="flex shrink-0 gap-1">
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="size-[30px] rounded-[7px] border border-border text-muted-foreground"
                                    aria-label="编辑资料"
                                    onClick={() => startEditMaterial(material)}
                                  >
                                    <Edit3 size={14} />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="size-[30px] rounded-[7px] border border-border text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    aria-label="删除资料"
                                    onClick={() => onDeleteMaterial(material)}
                                  >
                                    <Trash2 size={14} />
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="questions" className="mt-0 space-y-4">
                {nodeQuestions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
                    <div className="mb-4 flex size-[62px] items-center justify-center rounded-2xl border border-border bg-muted/35 text-muted-foreground/70">
                      <BookOpen size={22} />
                    </div>
                    <p className="text-[15px] font-semibold text-foreground/85">
                      该知识点暂无直属题目
                    </p>
                    <p className="mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-muted-foreground">
                      可从已关联的资料一键生成题目，或手动创建并归类到此知识点下。
                    </p>
                    <div className="mt-5 flex gap-2.5">
                      <Button
                        type="button"
                        disabled={!canWrite || nodeMaterials.length === 0}
                        onClick={() => onGenerateQuestions(node)}
                        className="h-10 rounded-[10px] px-[18px] text-sm font-semibold"
                      >
                        <Sparkles size={15} className="mr-1.5" />
                        从资料生成题目
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!canWrite}
                        onClick={() => onCreateQuestion(node)}
                        className="h-10 rounded-[10px] px-[18px] text-sm font-medium"
                      >
                        <Plus size={15} className="mr-1.5" />
                        手动创建
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={!canWrite || nodeMaterials.length === 0}
                        onClick={() => onGenerateQuestions(node)}
                        className="rounded-[9px]"
                      >
                        <Sparkles size={14} className="mr-1.5" />
                        自动生成题目
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!canWrite}
                        onClick={() => onCreateQuestion(node)}
                        className="rounded-[9px]"
                      >
                        <Plus size={14} className="mr-1.5" />
                        手动添加题目
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {nodeQuestions.map((question, index) => (
                        <QuestionPreviewCard
                          key={question.id}
                          question={question}
                          index={index + 1}
                          expandOnHover
                          hideAnswer
                          className="cursor-pointer transition-all hover:border-primary hover:shadow-md"
                          actions={
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-1.5 text-xs text-muted-foreground hover:text-primary sm:px-2"
                              onClick={() => onViewQuestion(question.id)}
                            >
                              <Eye size={13} className="sm:mr-1" />
                              <span className="hidden sm:inline">打开题目</span>
                            </Button>
                          }
                        />
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddKnowledgeNodeDialog({
  open,
  tree,
  saving,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  tree: CourseKnowledgeNode | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: { parentId: string; name: string }) => Promise<void>;
}) {
  const parentOptions = flattenCourseKnowledgeNodes(tree);
  const [parentId, setParentId] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) {
      setParentId(tree?.id ?? "");
      setName("");
    }
  }, [open, tree?.id]);

  const selectedParent = parentOptions.find((item) => item.id === parentId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新增子知识点</DialogTitle>
          <DialogDescription>
            选择父节点，并输入要新增的子知识点名称。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="course-kp-parent">父节点</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger id="course-kp-parent">
                <SelectValue placeholder="选择父节点" />
              </SelectTrigger>
              <SelectContent>
                {parentOptions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {"　".repeat(item.depth)}
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedParent ? (
              <p className="truncate text-xs text-muted-foreground">
                将添加到：{selectedParent.path}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="course-kp-name">子知识点名称</Label>
            <Input
              id="course-kp-name"
              value={name}
              placeholder="例如：函数的单调性"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  parentId &&
                  name.trim() &&
                  !saving
                ) {
                  event.preventDefault();
                  void onSubmit({ parentId, name: name.trim() });
                }
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={!parentId || !name.trim() || saving}
            onClick={() => void onSubmit({ parentId, name: name.trim() })}
          >
            {saving ? (
              <LoaderCircle size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Plus size={14} className="mr-1.5" />
            )}
            新增
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KnowledgeTreeRow({
  node,
  depth,
  canWrite,
  assignmentLinksByNodeId,
  onOpenNode,
  onViewMaterials,
  onViewQuestions,
  onViewAssignments,
  onGenerateFromMaterials,
  onUploadMaterial,
  onPublishAssignment,
  onRequestDelete,
}: {
  node: CourseKnowledgeNode;
  depth: number;
  canWrite: boolean;
  assignmentLinksByNodeId: Record<string, TeacherCourseExam[]>;
  onOpenNode: (kpId: string) => void;
  onViewMaterials: (node: CourseKnowledgeNode) => void;
  onViewQuestions: (node: CourseKnowledgeNode) => void;
  onViewAssignments: (node: CourseKnowledgeNode) => void;
  onGenerateFromMaterials: (node: CourseKnowledgeNode) => void;
  onUploadMaterial: (node: CourseKnowledgeNode) => void;
  onPublishAssignment: (node: CourseKnowledgeNode) => void;
  onRequestDelete: (node: CourseKnowledgeNode) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children.length > 0;
  const canDelete = canWrite && depth > 0;
  const isChapter = depth === 1;
  const linkedAssignments = assignmentLinksByNodeId[node.id] ?? [];

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-2 hover:bg-muted",
          hasChildren && "cursor-pointer select-none",
        )}
        style={{ paddingLeft: 12 + depth * 22 }}
        onClick={hasChildren ? () => setExpanded((value) => !value) : undefined}
      >
        <button
          type="button"
          className={cn(
            "text-muted-foreground/70",
            !hasChildren && "invisible",
          )}
          aria-label={expanded ? "收起" : "展开"}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <span className="text-muted-foreground/70">
          {depth === 0 ? <Layers3 size={15} /> : <BookOpen size={15} />}
        </span>
        <span
          className={cn(
            "min-w-0 truncate text-sm text-foreground",
            depth === 0 && "font-serif font-semibold",
          )}
        >
          {node.name}
        </span>
        {linkedAssignments.length > 0 ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 font-sans text-[11px] font-semibold text-primary transition hover:border-primary/45 hover:bg-primary/15"
            title={`查看「${node.name}」相关练习`}
            onClick={(event) => {
              event.stopPropagation();
              onViewAssignments(node);
            }}
          >
            <ListChecks size={11} />
            练习 {linkedAssignments.length}
          </button>
        ) : null}
        <span className="flex-1" />
        {isChapter ? (
          <>
            {node.question_count > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-sans text-[11px] font-semibold lining-nums tabular-nums text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                    title={`查看「${node.name}」下的题目`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <BookOpen size={11} />
                    {node.question_count} 题
                    <ChevronDown size={10} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.stopPropagation();
                      onViewQuestions(node);
                    }}
                  >
                    <Eye size={14} className="mr-2" />
                    查看
                  </DropdownMenuItem>
                  {canWrite ? (
                    <DropdownMenuItem
                      onClick={(event) => {
                        event.stopPropagation();
                        onPublishAssignment(node);
                      }}
                    >
                      <FilePlus2 size={14} className="mr-2" />
                      发布练习
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-sans text-[11px] font-semibold lining-nums tabular-nums text-muted-foreground opacity-45">
                <BookOpen size={11} />0 题
              </span>
            )}
            {node.material_count > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-sans text-[11px] font-semibold lining-nums tabular-nums text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                    title={`查看「${node.name}」下的资料`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <FileText size={11} />
                    {node.material_count} 资料
                    <ChevronDown size={10} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.stopPropagation();
                      onViewMaterials(node);
                    }}
                  >
                    <Eye size={14} className="mr-2" />
                    查看
                  </DropdownMenuItem>
                  {canWrite ? (
                    <DropdownMenuItem
                      onClick={(event) => {
                        event.stopPropagation();
                        onGenerateFromMaterials(node);
                      }}
                    >
                      <Sparkles size={14} className="mr-2" />
                      生成题目
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-sans text-[11px] font-semibold lining-nums tabular-nums text-muted-foreground opacity-45">
                <FileText size={11} />0 资料
              </span>
            )}
            {canWrite ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs text-primary hover:bg-primary/10 hover:text-primary"
                  onClick={(event) => {
                    event.stopPropagation();
                    onUploadMaterial(node);
                  }}
                >
                  <Upload size={13} className="mr-1" />
                  上传资料
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs text-primary hover:bg-primary/10 hover:text-primary"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPublishAssignment(node);
                  }}
                >
                  <FilePlus2 size={13} className="mr-1" />
                  发布练习
                </Button>
              </>
            ) : null}
          </>
        ) : (
          <>
            <span className="font-sans text-[11px] font-medium lining-nums tabular-nums text-muted-foreground">
              {node.question_count} 题
            </span>
            <span className="font-sans text-[11px] font-medium lining-nums tabular-nums text-muted-foreground">
              {node.material_count} 资料
            </span>
          </>
        )}
        {canWrite ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="编辑知识点"
            onClick={(event) => {
              event.stopPropagation();
              onOpenNode(node.id);
            }}
          >
            <Edit3 size={14} />
          </Button>
        ) : null}
        {canDelete ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:text-destructive"
            aria-label="删除知识点"
            onClick={(event) => {
              event.stopPropagation();
              onRequestDelete(node);
            }}
          >
            <Trash2 size={14} />
          </Button>
        ) : null}
      </div>
      {hasChildren && expanded
        ? node.children.map((child) => (
            <KnowledgeTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              canWrite={canWrite}
              assignmentLinksByNodeId={assignmentLinksByNodeId}
              onOpenNode={onOpenNode}
              onViewMaterials={onViewMaterials}
              onViewQuestions={onViewQuestions}
              onViewAssignments={onViewAssignments}
              onGenerateFromMaterials={onGenerateFromMaterials}
              onUploadMaterial={onUploadMaterial}
              onPublishAssignment={onPublishAssignment}
              onRequestDelete={onRequestDelete}
            />
          ))
        : null}
    </>
  );
}

function KnowledgeTab({
  tree,
  canWrite,
  assignmentLinksByNodeId,
  onOpenImport,
  onOpenCatalogPhoto,
  onOpenAddNode,
  onOpenNode,
  onViewMaterials,
  onViewQuestions,
  onViewAssignments,
  onGenerateFromMaterials,
  onUploadMaterial,
  onPublishAssignment,
  onRequestDeleteNode,
  onClearAll,
}: {
  tree: CourseKnowledgeNode | null;
  canWrite: boolean;
  assignmentLinksByNodeId: Record<string, TeacherCourseExam[]>;
  onOpenImport: () => void;
  onOpenCatalogPhoto: () => void;
  onOpenAddNode: () => void;
  onOpenNode: (kpId: string) => void;
  onViewMaterials: (node: CourseKnowledgeNode) => void;
  onViewQuestions: (node: CourseKnowledgeNode) => void;
  onViewAssignments: (node: CourseKnowledgeNode) => void;
  onGenerateFromMaterials: (node: CourseKnowledgeNode) => void;
  onUploadMaterial: (node: CourseKnowledgeNode) => void;
  onPublishAssignment: (node: CourseKnowledgeNode) => void;
  onRequestDeleteNode: (node: CourseKnowledgeNode) => void;
  onClearAll: () => void;
}) {
  const hasChildren = !!tree && tree.children.length > 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">
          默认展示到章节层，点击章节可展开下级知识点
        </span>
        <div className="flex-1" />
        {canWrite ? (
          <>
            <Button variant="outline" size="sm" onClick={onOpenImport}>
              <Upload size={14} className="mr-1.5" />
              导入
            </Button>
            <Button variant="outline" size="sm" onClick={onOpenCatalogPhoto}>
              <Camera size={14} className="mr-1.5" />
              书籍目录拍照导入
            </Button>
            <Button size="sm" onClick={onOpenAddNode}>
              <Plus size={14} className="mr-1.5" />
              新增
            </Button>
            {hasChildren ? (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={onClearAll}
              >
                <Trash2 size={14} className="mr-1.5" />
                清除全部
              </Button>
            ) : null}
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            <Lock size={13} />
            只读
          </span>
        )}
      </div>
      {!tree ? (
        <EmptyPanel icon={<Layers3 size={22} />} title="暂无课程目录" />
      ) : (
        <div className="rounded-xl border border-border bg-card p-2">
          <KnowledgeTreeRow
            node={tree}
            depth={0}
            canWrite={canWrite}
            assignmentLinksByNodeId={assignmentLinksByNodeId}
            onOpenNode={onOpenNode}
            onViewMaterials={onViewMaterials}
            onViewQuestions={onViewQuestions}
            onViewAssignments={onViewAssignments}
            onGenerateFromMaterials={onGenerateFromMaterials}
            onUploadMaterial={onUploadMaterial}
            onPublishAssignment={onPublishAssignment}
            onRequestDelete={onRequestDeleteNode}
          />
        </div>
      )}
    </div>
  );
}

type TodoTone = "warn" | "accent" | "soft";

function TodoRail({
  exams,
  assignments,
  materials,
  questions,
}: {
  exams: TeacherCourseExam[];
  assignments: TeacherCourseExam[];
  materials: TeacherCourseMaterial[];
  questions: IQuestion[];
}) {
  const pendingExams = exams.filter((item) => item.pending_count > 0).length;
  const pendingAssignments = assignments.filter(
    (item) => item.pending_count > 0,
  ).length;
  const uploadMaterials = materials.filter(
    canGenerateQuestionsFromCourseMaterial,
  ).length;
  const todos: {
    title: string;
    detail: string;
    icon: ReactNode;
    tone: TodoTone;
  }[] = [
    {
      title: "考试待阅卷",
      detail: `${pendingExams} 场考试有待处理提交`,
      icon: <ClipboardList size={15} />,
      tone: "warn",
    },
    {
      title: "练习待批改",
      detail: `${pendingAssignments} 项练习需要关注`,
      icon: <ListChecks size={15} />,
      tone: "warn",
    },
    {
      title: "资料可生成题目",
      detail: `${uploadMaterials} 份 PDF/Word/PPT 资料可继续使用`,
      icon: <Sparkles size={15} />,
      tone: "accent",
    },
    {
      title: "题目池",
      detail: `${questions.length} 道题可用于组卷`,
      icon: <BookOpen size={15} />,
      tone: "soft",
    },
  ];

  const toneClass: Record<TodoTone, string> = {
    warn: cn(PENDING_TONE, "bg-[oklch(0.95_0.03_70)]"),
    accent: "bg-accent text-accent-foreground",
    soft: "bg-muted text-muted-foreground",
  };

  return (
    <aside className="sticky top-20 hidden flex-col gap-3 lg:flex">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={16} className="text-foreground" />
        <h3 className="text-sm font-semibold text-foreground">教学待办</h3>
      </div>
      {todos.map((todo) => (
        <Card
          key={todo.title}
          className="rounded-lg border border-border bg-card shadow-none"
        >
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md",
                  toneClass[todo.tone],
                )}
              >
                {todo.icon}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {todo.title}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {todo.detail}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </aside>
  );
}

export function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const initialTab = ((): CourseTab => {
    const t = searchParams.get("tab");
    return t === "materials" ||
      t === "exams" ||
      t === "assignments" ||
      t === "questions" ||
      t === "knowledge"
      ? t
      : "knowledge";
  })();
  const [activeTab, setActiveTab] = useState<CourseTab>(initialTab);
  // 题库列表的「出题技能种子」徽标数据（question_id -> 技能列表）。
  const [seedUsage, setSeedUsage] = useState<SeedUsageMap>({});

  useEffect(() => {
    if (!id || activeTab !== "questions") return;
    getSeedUsage(id)
      .then(setSeedUsage)
      .catch(() => setSeedUsage({}));
  }, [id, activeTab]);
  const [course, setCourse] = useState<TeacherCourseDetail | null>(null);
  const [materials, setMaterials] = useState<TeacherCourseMaterial[]>([]);
  const [materialContentById, setMaterialContentById] = useState<
    Record<string, CourseMaterialExtractedContent>
  >({});
  const [materialAiGenerateState, setMaterialAiGenerateState] =
    useState<CourseMaterialAIGenerateState | null>(null);
  const [extractingMaterialId, setExtractingMaterialId] = useState<
    string | null
  >(null);
  const [exams, setExams] = useState<TeacherCourseExam[]>([]);
  const [assignments, setAssignments] = useState<TeacherCourseExam[]>([]);
  const [questions, setQuestions] = useState<IQuestion[]>([]);
  const [tree, setTree] = useState<CourseKnowledgeNode | null>(null);
  const [selectedMaterialUploadNodeId, setSelectedMaterialUploadNodeId] =
    useState("");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [materialUploadFiles, setMaterialUploadFiles] = useState<File[]>([]);
  const [materialToAssociate, setMaterialToAssociate] =
    useState<TeacherCourseMaterial | null>(null);
  const [previewMaterial, setPreviewMaterial] =
    useState<TeacherCourseMaterial | null>(null);
  const [associateMaterialNodeId, setAssociateMaterialNodeId] = useState("");
  const [associatingMaterial, setAssociatingMaterial] = useState(false);
  const [semesters, setSemesters] = useState<CourseSemester[]>([]);
  const [activeSemesterId, setActiveSemesterId] =
    useState<string>(ALL_SEMESTERS);
  const [newSemesterOpen, setNewSemesterOpen] = useState(false);
  const [semesterHintDismissed, setSemesterHintDismissed] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [catalogPhotoOpen, setCatalogPhotoOpen] = useState(false);
  const [addKnowledgeOpen, setAddKnowledgeOpen] = useState(false);
  const [addingKnowledge, setAddingKnowledge] = useState(false);
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [batchGenerateOpen, setBatchGenerateOpen] = useState(false);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchGenerateProgress, setBatchGenerateProgress] =
    useState<CourseMaterialBatchProgress | null>(null);
  const [assignmentScoreSummaryOpen, setAssignmentScoreSummaryOpen] =
    useState(false);
  const [assignmentScoreSummaryLoading, setAssignmentScoreSummaryLoading] =
    useState(false);
  const [assignmentScoreSummary, setAssignmentScoreSummary] =
    useState<CourseAssignmentScoreSummary | null>(null);
  const [selectedKnowledgeNodeId, setSelectedKnowledgeNodeId] = useState<
    string | null
  >(null);
  const [materialFilterNodeId, setMaterialFilterNodeId] = useState<
    string | null
  >(null);
  const [questionFilterNodeId, setQuestionFilterNodeId] = useState<
    string | null
  >(null);
  const [assignmentFilterNodeId, setAssignmentFilterNodeId] = useState<
    string | null
  >(null);
  const [knowledgeNodeToDelete, setKnowledgeNodeToDelete] =
    useState<CourseKnowledgeNode | null>(null);
  const [deletingKnowledgeNode, setDeletingKnowledgeNode] = useState(false);
  const [materialToDelete, setMaterialToDelete] =
    useState<TeacherCourseMaterial | null>(null);
  const [clearKpOpen, setClearKpOpen] = useState(false);
  const [clearingKp, setClearingKp] = useState(false);
  const [clearQuestionsOpen, setClearQuestionsOpen] = useState(false);
  const [clearingQuestions, setClearingQuestions] = useState(false);
  const [examToClose, setExamToClose] = useState<TeacherCourseExam | null>(
    null,
  );
  const [examToDelete, setExamToDelete] = useState<TeacherCourseExam | null>(
    null,
  );
  const [mockExamTarget, setMockExamTarget] =
    useState<TeacherCourseExam | null>(null);
  const [mockQuestionCount, setMockQuestionCount] = useState("");
  const [mockReuseRate, setMockReuseRate] = useState("80");
  const [mockTitle, setMockTitle] = useState("");
  const [mockSubmitting, setMockSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState<CourseTab | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restoredKnowledgeNodeIdRef = useRef<string | null>(null);

  const semesterFilter =
    activeSemesterId === ALL_SEMESTERS ? null : activeSemesterId;
  const selectedSemester =
    activeSemesterId === ALL_SEMESTERS
      ? null
      : (semesters.find((semester) => semester.id === activeSemesterId) ??
        null);
  const selectedSemesterLabel =
    activeSemesterId === ALL_SEMESTERS
      ? "全部学期"
      : (selectedSemester?.name ?? "当前学期");
  const mockExamQuestionCount = mockExamTarget?.total_questions ?? 0;
  const mockExamStartDate = mockExamTarget?.start_time
    ? new Date(mockExamTarget.start_time)
    : null;
  const mockExamEndDate =
    mockExamStartDate && Number.isFinite(mockExamStartDate.getTime())
      ? new Date(mockExamStartDate.getTime() - 60_000)
      : null;
  const examToCloseStatus = examToClose ? getEffectiveExamStatus(examToClose) : null;
  const examToCloseStatusLabel =
    examToCloseStatus
      ? examStatusOptions.find((option) => option.value === examToCloseStatus)?.label ?? examToCloseStatus
      : "—";
  const examToCloseNotSubmitted = examToClose
    ? Math.max(0, examToClose.total_students - examToClose.submitted_count)
    : 0;
  const shouldShowCreateSemesterHint =
    Boolean(course?.can_write) &&
    !course?.is_deleted &&
    !semesterHintDismissed &&
    semesters.length === 0 &&
    (course?.material_count ?? 0) === 0 &&
    (course?.exam_count ?? 0) === 0 &&
    (course?.assignment_count ?? 0) === 0 &&
    (course?.question_count ?? 0) === 0;
  const selectedKnowledgeNode = findCourseKnowledgeNode(
    tree,
    selectedKnowledgeNodeId,
  );
  const materialFilterNode = findCourseKnowledgeNode(
    tree,
    materialFilterNodeId,
  );
  const questionFilterNode = findCourseKnowledgeNode(
    tree,
    questionFilterNodeId,
  );
  const assignmentFilterNode = findCourseKnowledgeNode(
    tree,
    assignmentFilterNodeId,
  );
  const assignmentLinksByNodeId = useMemo(
    () => buildAssignmentLinksByNodeId(tree, assignments),
    [assignments, tree],
  );
  const filteredAssignments = useMemo(
    () =>
      filterAssignmentsForKnowledgeNode(
        tree,
        assignments,
        assignmentFilterNodeId,
      ),
    [assignments, assignmentFilterNodeId, tree],
  );
  const filteredMaterials = useMemo(
    () =>
      filterMaterialsForKnowledgeNode(materials, tree, materialFilterNodeId),
    [materials, materialFilterNodeId, tree],
  );
  const filteredQuestions = useMemo(
    () =>
      filterQuestionsForKnowledgeNode(questions, tree, questionFilterNodeId),
    [questions, questionFilterNodeId, tree],
  );
  const questionCountByNodeId = useMemo(
    () => buildCourseQuestionCountByNodeId(tree),
    [tree],
  );
  const questionKnowledgeFilterOptions = useMemo(
    () => flattenCourseKnowledgeNodes(tree).filter((item) => item.depth > 0),
    [tree],
  );
  const materialUploadTargets = useMemo(
    () => flattenKnowledgeUploadTargets(tree),
    [tree],
  );

  useEffect(() => {
    setSemesterHintDismissed(false);
  }, [id]);

  useEffect(() => {
    const defaultNodeId = resolveDefaultKnowledgeUploadTargetId(tree);
    if (!defaultNodeId) {
      setSelectedMaterialUploadNodeId("");
      return;
    }
    setSelectedMaterialUploadNodeId((current) =>
      materialUploadTargets.some((target) => target.id === current)
        ? current
        : defaultNodeId,
    );
  }, [materialUploadTargets, tree]);

  useEffect(() => {
    const nodeId = searchParams.get("node_id");
    let ignore = false;
    if (!nodeId) {
      restoredKnowledgeNodeIdRef.current = null;
      return () => {
        ignore = true;
      };
    }
    if (
      activeTab !== "knowledge" ||
      restoredKnowledgeNodeIdRef.current === nodeId ||
      !findCourseKnowledgeNode(tree, nodeId)
    ) {
      return;
    }
    restoredKnowledgeNodeIdRef.current = nodeId;
    setSelectedKnowledgeNodeId(nodeId);
    if (id) {
      void Promise.all([
        listCourseMaterials(id),
        listCourseQuestions(id),
        getTeacherCourse(id, semesterFilter),
      ])
        .then(([nextMaterials, nextQuestions, nextCourse]) => {
          if (ignore) return;
          setMaterials(nextMaterials);
          setQuestions(nextQuestions);
          setCourse(nextCourse);
        })
        .catch((err) => {
          if (ignore) return;
          toast({
            title: "节点信息加载失败",
            description: err instanceof Error ? err.message : "请稍后重试",
            variant: "destructive",
          });
        });
    }
    return () => {
      ignore = true;
    };
  }, [activeTab, id, searchParams, semesterFilter, toast, tree]);

  useEffect(() => {
    if (!materialToAssociate) return;
    setAssociateMaterialNodeId(materialToAssociate.node_id);
  }, [materialToAssociate]);

  useEffect(() => {
    if (materialFilterNodeId && !materialFilterNode) {
      setMaterialFilterNodeId(null);
    }
    if (questionFilterNodeId && !questionFilterNode) {
      setQuestionFilterNodeId(null);
    }
    if (assignmentFilterNodeId && !assignmentFilterNode) {
      setAssignmentFilterNodeId(null);
    }
  }, [
    assignmentFilterNode,
    assignmentFilterNodeId,
    materialFilterNode,
    materialFilterNodeId,
    questionFilterNode,
    questionFilterNodeId,
  ]);

  // 初始化只拉「课程 + 学期」(用于 PageIntroHeader 与各 Tab 上的徽标数字)，
  // 各 Tab 的实际数据由下面的 per-tab effect 按需懒加载。
  useEffect(() => {
    if (!id) return;
    let ignore = false;
    setLoading(true);
    Promise.all([getTeacherCourse(id), listCourseSemesters(id)])
      .then(([courseData, semesterData]) => {
        if (ignore) return;
        setCourse(courseData);
        setSemesters(semesterData);
        setActiveSemesterId((current) =>
          current !== ALL_SEMESTERS &&
          semesterData.some((s) => s.id === current)
            ? current
            : (semesterData[0]?.id ?? ALL_SEMESTERS),
        );
        setError(null);
      })
      .catch((err) => {
        if (!ignore)
          setError(err instanceof Error ? err.message : "课程工作台加载失败");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [id]);

  // 当前 Tab 切换 / 学期切换时，拉取对应 Tab 的数据并刷新课程徽标数字。
  // - 切到 materials/questions/knowledge：相应数据 + 课程概要
  // - 切到 exams/assignments：相应列表 + 课程概要（受学期过滤影响）
  useEffect(() => {
    if (!id) return;
    let ignore = false;
    setTabLoading(activeTab);
    const finishTabLoading = () => {
      if (!ignore) {
        setTabLoading((current) => (current === activeTab ? null : current));
      }
    };
    const refreshSummary = () => {
      getTeacherCourse(id, semesterFilter)
        .then((data) => {
          if (!ignore) setCourse(data);
        })
        .catch(() => {
          // 徽标数字非关键路径，静默失败。
        });
    };
    const fail = (err: unknown) => {
      if (ignore) return;
      toast({
        title: "数据加载失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    };

    if (activeTab === "materials") {
      Promise.all([listCourseMaterials(id), getCourseKnowledgeTree(id)])
        .then(([materialsData, treeData]) => {
          if (!ignore) {
            setMaterials(materialsData);
            setTree(treeData);
          }
        })
        .catch(fail)
        .finally(finishTabLoading);
    } else if (activeTab === "questions") {
      Promise.all([listCourseQuestions(id), getCourseKnowledgeTree(id)])
        .then(([questionData, treeData]) => {
          if (!ignore) {
            setQuestions(questionData);
            setTree(treeData);
          }
        })
        .catch(fail)
        .finally(finishTabLoading);
    } else if (activeTab === "knowledge") {
      Promise.all([
        getCourseKnowledgeTree(id),
        listCourseAssignments(id, semesterFilter),
      ])
        .then(([treeData, assignmentData]) => {
          if (!ignore) {
            setTree(treeData);
            setAssignments(assignmentData);
          }
        })
        .catch(fail)
        .finally(finishTabLoading);
    } else if (activeTab === "exams") {
      listCourseExams(id, semesterFilter)
        .then((data) => {
          if (!ignore) setExams(data);
        })
        .catch(fail)
        .finally(finishTabLoading);
    } else if (activeTab === "assignments") {
      listCourseAssignments(id, semesterFilter)
        .then((data) => {
          if (!ignore) setAssignments(data);
        })
        .catch(fail)
        .finally(finishTabLoading);
    }
    refreshSummary();
    return () => {
      ignore = true;
    };
  }, [id, activeTab, semesterFilter, toast]);

  const handleImportKnowledgePaths = useCallback(
    async (paths: KnowledgeImportPath[]) => {
      if (!id || !course) return;
      if (!course.direction_id) {
        throw new Error(
          "课程缺少方向信息，无法导入。请先在课程目录中检查课程根节点。",
        );
      }
      const directionId = course.direction_id;

      // Reuse current tree to dedupe before sending POSTs.
      const existingByKey = new Map<string, string>();
      if (tree) {
        const walk = (node: CourseKnowledgeNode) => {
          for (const child of node.children) {
            existingByKey.set(`${node.id}::${child.name.trim()}`, child.id);
            walk(child);
          }
        };
        walk(tree);
      }

      let createdCount = 0;
      for (const path of paths) {
        // Course is the root; first segment becomes child of course.id, then chain.
        let parentId: string | null = id;
        for (const segment of path) {
          const name = segment.trim();
          if (!name) continue;
          const key = `${parentId ?? "root"}::${name}`;
          const existing = existingByKey.get(key);
          if (existing) {
            parentId = existing;
            continue;
          }
          const created: { id: string; name: string } = await apiRequest<{
            id: string;
            name: string;
          }>("/knowledge/knowledge-points", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              direction_id: directionId,
              parent_id: parentId,
              name,
            }),
          });
          existingByKey.set(key, created.id);
          parentId = created.id;
          createdCount += 1;
        }
      }

      const fresh = await getCourseKnowledgeTree(id);
      setTree(fresh);
      toast({
        title: "知识库导入完成",
        description:
          createdCount > 0
            ? `新增 ${createdCount} 个知识点。`
            : "导入内容已存在，没有重复创建。",
      });
    },
    [course, id, toast, tree],
  );

  const handleRecognizeCatalogPhoto = useCallback(
    async (payload: { fileName: string; images: string[] }) => {
      const response = await apiRequest<{ paths: KnowledgeImportPath[] }>(
        "/knowledge/catalog-photo/recognize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_name: payload.fileName,
            images: payload.images,
          }),
        },
      );
      return response.paths;
    },
    [],
  );

  const handleAddKnowledgeNode = useCallback(
    async ({ parentId, name }: { parentId: string; name: string }) => {
      if (!course?.direction_id) {
        toast({
          title: "无法新增知识点",
          description: "课程缺少方向信息，请先检查课程目录。",
          variant: "destructive",
        });
        return;
      }
      setAddingKnowledge(true);
      try {
        await apiRequest<{ id: string; name: string }>(
          "/knowledge/knowledge-points",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              direction_id: course.direction_id,
              parent_id: parentId,
              name,
            }),
          },
        );
        setAddKnowledgeOpen(false);
        toast({
          title: "已新增子知识点",
          description: `「${name}」已添加到课程目录。`,
        });
        if (id) {
          const fresh = await getCourseKnowledgeTree(id);
          setTree(fresh);
          void getTeacherCourse(id, semesterFilter)
            .then(setCourse)
            .catch(() => {});
        }
      } catch (err) {
        toast({
          title: "新增失败",
          description: err instanceof Error ? err.message : "请稍后重试",
          variant: "destructive",
        });
      } finally {
        setAddingKnowledge(false);
      }
    },
    [course?.direction_id, id, semesterFilter, toast],
  );

  const refreshMaterials = useCallback(async () => {
    if (!id) return;
    try {
      const next = await listCourseMaterials(id);
      setMaterials(next);
    } catch (err) {
      toast({
        title: "资料列表刷新失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    }
  }, [id, toast]);

  const refreshKnowledgeTree = useCallback(async () => {
    if (!id) return;
    try {
      const fresh = await getCourseKnowledgeTree(id);
      setTree(fresh);
    } catch (err) {
      toast({
        title: "课程目录刷新失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    }
  }, [id, toast]);

  const refreshCourseSummary = useCallback(async () => {
    if (!id) return;
    try {
      setCourse(await getTeacherCourse(id, semesterFilter));
    } catch {
      // Summary badges are not critical after local edits.
    }
  }, [id, semesterFilter]);

  const refreshMaterialsAndTree = useCallback(async () => {
    await Promise.all([
      refreshMaterials(),
      refreshKnowledgeTree(),
      refreshCourseSummary(),
    ]);
  }, [refreshCourseSummary, refreshKnowledgeTree, refreshMaterials]);

  const handleOpenUploadDialog = useCallback(async (nodeId?: string) => {
    setUploadDialogOpen(true);
    setMaterialUploadFiles([]);
    if (nodeId) {
      setSelectedMaterialUploadNodeId(nodeId);
    }
    if (!tree && id) {
      try {
        const fresh = await getCourseKnowledgeTree(id);
        setTree(fresh);
        setSelectedMaterialUploadNodeId(
          nodeId || resolveDefaultKnowledgeUploadTargetId(fresh),
        );
      } catch (err) {
        toast({
          title: "知识点加载失败",
          description: err instanceof Error ? err.message : "请稍后重试",
          variant: "destructive",
        });
      }
    }
  }, [id, toast, tree]);

  const uploadAndExtractMaterial = useCallback(
    async (nodeId: string, file: File) => {
      const material = await uploadCourseMaterialFile(nodeId, file);
      let content: CourseMaterialExtractedContent | null = null;
      try {
        const extracted = await extractMaterialContent(file);
        content = {
          sourceText: extracted.text.trim().slice(0, MATERIAL_TEXT_LIMIT),
          images: extracted.images,
        };
        setMaterialContentById((current) => ({
          ...current,
          [material.id]: content as CourseMaterialExtractedContent,
        }));
        if (extracted.pageCount > MATERIAL_PAGE_LIMIT) {
          toast({
            title: "资料页数较多",
            description: `当前共 ${extracted.pageCount} 页/张。系统最多处理 ${MATERIAL_PAGE_LIMIT} 页/张。`,
          });
        }
        if (extracted.truncated) {
          toast({
            title: "资料已截断处理",
            description: `系统最多处理前 ${MATERIAL_PAGE_LIMIT} 页/张内容，超出部分已忽略。`,
          });
        }
      } catch (err) {
        if (err instanceof UnsupportedMaterialFormatError) {
          toast({
            title: "资料已上传",
            description: `该格式暂不支持直接生成题目。${err.message}`,
          });
        }
      }
      return { material, content };
    },
    [toast],
  );

  const extractExistingMaterial = useCallback(
    async (material: TeacherCourseMaterial) => {
      const file = await fetchCourseMaterialFile(material);
      const extracted = await extractMaterialContent(file);
      const content = {
        sourceText: extracted.text.trim().slice(0, MATERIAL_TEXT_LIMIT),
        images: extracted.images,
      };
      setMaterialContentById((current) => ({
        ...current,
        [material.id]: content,
      }));
      if (extracted.pageCount > MATERIAL_PAGE_LIMIT) {
        toast({
          title: "资料页数较多",
          description: `当前共 ${extracted.pageCount} 页/张。系统最多处理 ${MATERIAL_PAGE_LIMIT} 页/张。`,
        });
      }
      if (extracted.truncated) {
        toast({
          title: "资料已截断处理",
          description: `系统最多处理前 ${MATERIAL_PAGE_LIMIT} 页/张内容，超出部分已忽略。`,
        });
      }
      return content;
    },
    [toast],
  );

  // After upload, automatically build the course knowledge base from each
  // material (ArkLoop-style): chunk → embed → store for course-level RAG
  // retrieval. Fully automatic, no confirmation; the course tree is NOT modified
  // and nothing is shown per-material — knowledge belongs to the course (KB).
  const autoIngestMaterialsToKb = useCallback(
    async (items: Array<{ resourceId: string; title: string; text: string }>) => {
      if (!id || items.length === 0) return;
      const ingesting: string[] = [];
      for (const item of items) {
        try {
          await kbIngestMaterial(id, item.resourceId, item.text);
          ingesting.push(item.resourceId);
        } catch {
          // Soft-fail: KB ingest must never block uploads.
        }
      }
      if (ingesting.length === 0) return;
      toast({
        title: "资料正在进入课程知识库",
        description: "正在切分并向量化资料内容，完成后即可用于检索与出题。",
      });

      // Poll ingest status briefly, then refresh so KB badges appear.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        try {
          const statuses = await Promise.all(ingesting.map((rid) => kbStatus(id, rid)));
          if (statuses.every((s) => s.kb_status !== "processing")) break;
        } catch {
          break;
        }
      }
      await refreshMaterialsAndTree();
    },
    [id, toast, refreshMaterialsAndTree],
  );

  const handleUploadFiles = useCallback(
    async (nodeId: string, files: File[]) => {
      if (!nodeId || files.length === 0) return;
      setUploading(true);
      try {
        const failed: string[] = [];
        const forKnowledgeExtraction: Array<{
          resourceId: string;
          title: string;
          text: string;
        }> = [];
        for (const file of files) {
          try {
            const { material, content } = await uploadAndExtractMaterial(nodeId, file);
            if (content?.sourceText.trim() && canGenerateQuestionsFromCourseMaterial(material)) {
              forKnowledgeExtraction.push({
                resourceId: material.id,
                title: material.title,
                text: content.sourceText,
              });
            }
          } catch (err) {
            failed.push(
              `${file.name}：${err instanceof Error ? err.message : "上传失败"}`,
            );
          }
        }
        const successCount = files.length - failed.length;
        toast({
          title: failed.length > 0 ? "部分资料上传失败" : "上传成功",
          description:
            failed.length > 0
              ? `成功 ${successCount} 个，失败 ${failed.length} 个。${failed.slice(0, 2).join("；")}`
              : successCount > 1
                ? `${successCount} 个文件已添加到课程资料。`
                : `《${files[0]?.name ?? "资料"}》已添加到课程资料。`,
          variant: failed.length > 0 ? "destructive" : undefined,
        });
        if (successCount > 0) {
          setUploadDialogOpen(false);
          setMaterialUploadFiles([]);
          await refreshMaterialsAndTree();
          // Fire-and-forget: auto-tag the new materials with their knowledge points.
          if (forKnowledgeExtraction.length > 0) {
            void autoIngestMaterialsToKb(forKnowledgeExtraction);
          }
        }
      } catch (err) {
        toast({
          title: "上传失败",
          description: err instanceof Error ? err.message : "请稍后重试",
          variant: "destructive",
        });
      } finally {
        setUploading(false);
      }
    },
    [autoIngestMaterialsToKb, refreshMaterialsAndTree, toast, uploadAndExtractMaterial],
  );

  const handleUploadFilesToNode = useCallback(
    async (nodeId: string, files: File[]) => {
      if (files.length === 0) return;
      const failed: string[] = [];
      const forKnowledgeExtraction: Array<{
        resourceId: string;
        title: string;
        text: string;
      }> = [];
      for (const file of files) {
        try {
          const { material, content } = await uploadAndExtractMaterial(nodeId, file);
          if (content?.sourceText.trim() && canGenerateQuestionsFromCourseMaterial(material)) {
            forKnowledgeExtraction.push({
              resourceId: material.id,
              title: material.title,
              text: content.sourceText,
            });
          }
        } catch (err) {
          failed.push(
            `${file.name}：${err instanceof Error ? err.message : "上传失败"}`,
          );
        }
      }
      const successCount = files.length - failed.length;
      toast({
        title: failed.length > 0 ? "部分资料上传失败" : "上传成功",
        description:
          failed.length > 0
            ? `成功 ${successCount} 个，失败 ${failed.length} 个。${failed.slice(0, 2).join("；")}`
            : successCount > 1
              ? `${successCount} 个文件已添加到该知识点资料。`
              : `《${files[0]?.name ?? "资料"}》已添加到该知识点资料。`,
        variant: failed.length > 0 ? "destructive" : undefined,
      });
      if (successCount > 0) {
        await refreshMaterialsAndTree();
        if (forKnowledgeExtraction.length > 0) {
          void autoIngestMaterialsToKb(forKnowledgeExtraction);
        }
      }
    },
    [autoIngestMaterialsToKb, refreshMaterialsAndTree, toast, uploadAndExtractMaterial],
  );

  const handleAddNodeMaterialLink = useCallback(
    async (
      nodeId: string,
      payload: { title: string; url: string; description?: string | null },
    ) => {
      await addCourseMaterialLink(nodeId, payload);
      toast({
        title: "资料已添加",
        description: `《${payload.title}》已添加到该知识点。`,
      });
      await refreshMaterialsAndTree();
    },
    [refreshMaterialsAndTree, toast],
  );

  const handleUpdateNodeMaterial = useCallback(
    async (
      materialId: string,
      payload: {
        title?: string;
        url?: string | null;
        description?: string | null;
      },
    ) => {
      await updateCourseMaterial(materialId, payload);
      toast({
        title: "资料已更新",
      });
      await refreshMaterials();
    },
    [refreshMaterials, toast],
  );

  const handleAssociateMaterial = useCallback(async () => {
    if (!materialToAssociate || !associateMaterialNodeId) return;
    setAssociatingMaterial(true);
    try {
      await updateCourseMaterial(materialToAssociate.id, {
        node_id: associateMaterialNodeId,
      });
      const target = materialUploadTargets.find(
        (item) => item.id === associateMaterialNodeId,
      );
      toast({
        title: "关联已更新",
        description: target
          ? `《${materialToAssociate.title}》已关联到「${target.name}」。`
          : `《${materialToAssociate.title}》的知识点关联已更新。`,
      });
      setMaterialToAssociate(null);
      await refreshMaterialsAndTree();
    } catch (err) {
      toast({
        title: "关联失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setAssociatingMaterial(false);
    }
  }, [
    associateMaterialNodeId,
    materialToAssociate,
    materialUploadTargets,
    refreshMaterialsAndTree,
    toast,
  ]);

  const handleRenameKnowledgeNode = useCallback(
    async (nodeId: string, name: string) => {
      await updateCourseKnowledgePointName(nodeId, name);
      toast({
        title: "知识点已更新",
        description: `名称已改为「${name}」。`,
      });
      await refreshKnowledgeTree();
      if (nodeId === id) {
        await refreshCourseSummary();
      }
    },
    [id, refreshCourseSummary, refreshKnowledgeTree, toast],
  );

  const handleDeleteKnowledgeNode = useCallback(async () => {
    if (!knowledgeNodeToDelete) return;
    if (knowledgeNodeToDelete.id === id) {
      toast({
        title: "主知识不可删除",
        description: "课程主知识会作为课程根节点保留。",
        variant: "destructive",
      });
      setKnowledgeNodeToDelete(null);
      return;
    }

    setDeletingKnowledgeNode(true);
    try {
      await apiRequest(
        `/knowledge/knowledge-points/${knowledgeNodeToDelete.id}`,
        {
          method: "DELETE",
        },
      );
      toast({
        title: "已删除知识点",
        description: `「${knowledgeNodeToDelete.name}」已从课程目录移除。`,
      });
      setSelectedKnowledgeNodeId((current) =>
        current === knowledgeNodeToDelete.id ? null : current,
      );
      setKnowledgeNodeToDelete(null);
      await Promise.all([refreshKnowledgeTree(), refreshCourseSummary()]);
    } catch (err) {
      toast({
        title: "删除失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setDeletingKnowledgeNode(false);
    }
  }, [
    id,
    knowledgeNodeToDelete,
    refreshCourseSummary,
    refreshKnowledgeTree,
    toast,
  ]);

  const handleOpenKnowledgeNode = useCallback(
    (nodeId: string) => {
      setSelectedKnowledgeNodeId(nodeId);
      if (!id) return;
      void Promise.all([listCourseMaterials(id), listCourseQuestions(id)])
        .then(([nextMaterials, nextQuestions]) => {
          setMaterials(nextMaterials);
          setQuestions(nextQuestions);
        })
        .catch((err) => {
          toast({
            title: "节点信息加载失败",
            description: err instanceof Error ? err.message : "请稍后重试",
            variant: "destructive",
          });
        });
    },
    [id, toast],
  );

  const handleDeleteMaterial = useCallback(async () => {
    if (!materialToDelete) return;
    try {
      await deleteCourseMaterial(materialToDelete.id);
      toast({
        title: "已删除",
        description: `《${materialToDelete.title}》已从课程资料移除。`,
      });
      setMaterialToDelete(null);
      await refreshMaterialsAndTree();
    } catch (err) {
      toast({
        title: "删除失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    }
  }, [materialToDelete, refreshMaterialsAndTree, toast]);

  const handleClearKnowledgePoints = useCallback(async () => {
    if (!id) return;
    setClearingKp(true);
    try {
      const { deleted } = await clearCourseKnowledgePoints(id);
      const fresh = await getCourseKnowledgeTree(id);
      setTree(fresh);
      setClearKpOpen(false);
      toast({
        title: "已清除知识点",
        description:
          deleted > 0
            ? `已删除 ${deleted} 个直接子知识点（含其下所有后代）。`
            : "课程下没有可清除的知识点。",
      });
    } catch (err) {
      toast({
        title: "清除失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setClearingKp(false);
    }
  }, [id, toast]);

  const handleClearCourseQuestions = useCallback(async () => {
    if (!id) return;
    setClearingQuestions(true);
    try {
      const result = await clearCourseQuestions(id);
      setQuestions([]);
      setClearQuestionsOpen(false);
      await Promise.all([refreshCourseSummary(), refreshKnowledgeTree()]);
      toast({
        title: "已清除课程题目",
        description:
          result.deleted > 0
            ? `共处理 ${result.deleted} 道题：彻底删除 ${result.hard_deleted} 道，软删除 ${result.soft_deleted} 道。已用于考试或练习的题目仍可在对应记录中查看。`
            : "当前课程下没有可清除的题目。",
      });
    } catch (err) {
      toast({
        title: "清除题目失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setClearingQuestions(false);
    }
  }, [id, refreshCourseSummary, refreshKnowledgeTree, toast]);

  const handleGenerateFromMaterial = useCallback(
    async (material: TeacherCourseMaterial) => {
      let extracted = materialContentById[material.id];
      if (
        !extracted ||
        (!extracted.sourceText && extracted.images.length === 0)
      ) {
        setExtractingMaterialId(material.id);
        try {
          extracted = await extractExistingMaterial(material);
        } catch (err) {
          toast({
            title: "暂不能智能出题",
            description:
              err instanceof UnsupportedMaterialFormatError ||
              err instanceof Error
                ? err.message
                : "资料内容抽取失败，请稍后重试。",
            variant: "destructive",
          });
          return;
        } finally {
          setExtractingMaterialId(null);
        }
      }

      const pathParts = findCourseKnowledgeNodePath(tree, material.node_id);
      const fallbackNodeName = material.node_name ?? course?.name ?? "课程节点";
      const knowledgePointName =
        pathParts[pathParts.length - 1] ?? fallbackNodeName;
      const knowledgePointPath =
        pathParts.length > 0
          ? pathParts.join(" / ")
          : [course?.name, fallbackNodeName].filter(Boolean).join(" / ");

      setMaterialAiGenerateState({
        materialTitle: material.title,
        knowledgePointId: material.node_id,
        knowledgePointName,
        knowledgePointPath,
        sourceText: extracted.sourceText,
        images: extracted.images,
      });
    },
    [course, extractExistingMaterial, materialContentById, toast, tree],
  );

  const generateQuestionsForBatchMaterial = useCallback(
    async ({
      material,
      extracted,
      count,
    }: {
      material: TeacherCourseMaterial;
      extracted: CourseMaterialExtractedContent;
      count: number;
    }) => {
      const pathParts = findCourseKnowledgeNodePath(tree, material.node_id);
      const fallbackNodeName = material.node_name ?? course?.name ?? "课程节点";
      const knowledgePointName =
        pathParts[pathParts.length - 1] ?? fallbackNodeName;
      const requestBody = {
        total_count: count,
        difficulty: 3,
        knowledge_point_ids: [material.node_id],
        course_name: course?.name ?? undefined,
        prompt: `请优先依据上传的学习资料「${material.title}」，为知识点「${knowledgePointName}」批量生成题目。题目应覆盖资料中的核心概念、关键步骤和易错点。`,
        material_text: extracted.sourceText,
        material_images: extracted.images,
        model: "deepseek",
      };

      const token = localStorage.getItem("access_token");
      const response = await fetch("/api/questions/ai-generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail ?? `生成失败: ${response.status}`);
      }

      const generated: CourseMaterialGeneratedQuestion[] = [];
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;

      const processEventPart = (part: string) => {
        const dataLine = part
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) return;
        const payload = dataLine.replace(/^data:\s*/, "").trim();
        if (!payload || payload === "[DONE]") return;
        let event: { type?: string; data?: any; message?: string };
        try {
          event = JSON.parse(payload);
        } catch {
          return;
        }
        if (event.type === "question") {
          generated.push({
            type: (event.data?.type ?? "choice") as QuestionType,
            title: event.data?.title ?? "",
            content: {
              text: event.data?.content?.text ?? event.data?.title ?? "",
            },
            options: event.data?.options ?? null,
            answer: event.data?.answer ?? {},
            analysis: event.data?.analysis ?? null,
            difficulty: event.data?.difficulty ?? 3,
          });
          setBatchGenerateProgress((current) =>
            current
              ? {
                  ...current,
                  generated: generated.length,
                }
              : current,
          );
        } else if (event.type === "error") {
          streamError = event.message ?? "生成失败";
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          processEventPart(part);
          if (streamError) break;
        }
        if (streamError) {
          await reader.cancel();
          break;
        }
      }
      if (!streamError && buffer.trim()) {
        processEventPart(buffer);
      }
      if (streamError) {
        throw new Error(streamError);
      }
      if (generated.length === 0) {
        throw new Error("未生成任何题目");
      }

      setBatchGenerateProgress((current) =>
        current ? { ...current, phase: "saving" } : current,
      );
      const saveResult = await apiRequest<{
        created: number;
        created_question_ids?: string[];
      }>("/questions/save-generated-to-course-bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questions: generated.map((question) => ({
            ...question,
            score: 10,
            tag_ids: [],
            knowledge_point_ids: [material.node_id],
          })),
        }),
      });

      return {
        generated: generated.length,
        saved: saveResult.created ?? generated.length,
      };
    },
    [course?.name, tree],
  );

  const handleBatchGenerateMaterials = useCallback(
    async (items: CourseMaterialBatchGenerateItem[]) => {
      if (!id || items.length === 0) return;
      setBatchGenerating(true);
      let savedTotal = 0;
      const failures: string[] = [];
      try {
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          setBatchGenerateProgress({
            phase: "generating",
            currentIndex: index + 1,
            total: items.length,
            currentTitle: item.material.title,
            generated: 0,
            saved: savedTotal,
          });

          try {
            const extracted =
              materialContentById[item.material.id] ??
              (await extractExistingMaterial(item.material));
            setBatchGenerateProgress((current) =>
              current ? { ...current, phase: "generating" } : current,
            );
            const result = await generateQuestionsForBatchMaterial({
              material: item.material,
              extracted,
              count: item.count,
            });
            savedTotal += result.saved;
            setBatchGenerateProgress((current) =>
              current
                ? {
                    ...current,
                    phase: "done",
                    generated: result.generated,
                    saved: savedTotal,
                  }
                : current,
            );
          } catch (err) {
            failures.push(
              `${item.material.title}：${err instanceof Error ? err.message : "生成失败"}`,
            );
          }
        }

        await Promise.all([
          listCourseQuestions(id).then(setQuestions),
          refreshCourseSummary(),
          refreshKnowledgeTree(),
        ]);
        toast({
          title: failures.length > 0 ? "部分资料生成失败" : "批量生成完成",
          description:
            failures.length > 0
              ? `已保存 ${savedTotal} 道题，失败 ${failures.length} 份。${failures.slice(0, 2).join("；")}`
              : `已按顺序处理 ${items.length} 份资料，保存 ${savedTotal} 道题。`,
          variant: failures.length > 0 ? "destructive" : undefined,
        });
        if (failures.length === 0) {
          setBatchGenerateOpen(false);
        }
      } finally {
        setBatchGenerating(false);
        setBatchGenerateProgress(null);
      }
    },
    [
      extractExistingMaterial,
      generateQuestionsForBatchMaterial,
      id,
      materialContentById,
      refreshCourseSummary,
      refreshKnowledgeTree,
      toast,
    ],
  );

  const handleGenerateFromKnowledgeNode = useCallback(
    (node: CourseKnowledgeNode) => {
      try {
        sessionStorage.setItem(
          AI_PREFILL_KEY,
          JSON.stringify({
            kind: "course_material",
            node_id: node.id,
            node_name: node.name,
            course_id: id,
            course_name: course?.name ?? "",
            customPrompt: `请围绕课程「${course?.name ?? ""}」中的知识点「${node.name}」自动生成题目。`,
          }),
        );
      } catch {
        // sessionStorage can be unavailable in private modes — non-fatal.
      }
      navigate("/questions/ai-generate");
    },
    [course, id, navigate],
  );

  const handleCreateQuestionFromKnowledgeNode = useCallback(
    (node: CourseKnowledgeNode) => {
      if (!id) return;
      const returnTo = `/courses/${id}?tab=knowledge&node_id=${node.id}`;
      navigate("/questions/create", {
        state: {
          backTo: returnTo,
          backLabel: "返回课程详情",
          successTo: returnTo,
          courseKpId: node.id,
        },
      });
    },
    [id, navigate],
  );

  const handleViewAssignmentsForKnowledgeNode = useCallback(
    (node: CourseKnowledgeNode) => {
      setAssignmentFilterNodeId(node.id);
      setActiveTab("assignments");
    },
    [],
  );

  const handleViewMaterialsForKnowledgeNode = useCallback(
    async (node: CourseKnowledgeNode) => {
      if (!id) return;
      try {
        let nextMaterials = materials;
        if (nextMaterials.length === 0) {
          nextMaterials = await listCourseMaterials(id);
          setMaterials(nextMaterials);
        }
        const previewable = filterMaterialsForKnowledgeNode(
          nextMaterials,
          tree,
          node.id,
        ).filter(canPreviewCourseMaterial);
        if (previewable.length === 0) {
          toast({
            title: "暂不能预览资料",
            description: "该章节下没有可在线查看的 PDF、DOCX 或 PPTX 资料。",
            variant: "destructive",
          });
          return;
        }
        if (previewable.length > 1) {
          toast({
            title: "已打开一份资料",
            description: `该章节下有 ${previewable.length} 份可预览资料，当前打开《${previewable[0].title}》。如需指定其它资料，请到课程资料中选择。`,
          });
        }
        setPreviewMaterial(previewable[0]);
      } catch (err) {
        toast({
          title: "资料加载失败",
          description: err instanceof Error ? err.message : "请稍后重试",
          variant: "destructive",
        });
      }
    },
    [id, materials, toast, tree],
  );

  const handleViewQuestionsForKnowledgeNode = useCallback(
    (node: CourseKnowledgeNode) => {
      setQuestionFilterNodeId(node.id);
      setActiveTab("questions");
    },
    [],
  );

  const handleViewQuestionsForMaterial = useCallback(
    (material: TeacherCourseMaterial) => {
      setQuestionFilterNodeId(material.node_id);
      setActiveTab("questions");
    },
    [],
  );

  const handleGenerateQuestionsFromNodeMaterials = useCallback(
    async (node: CourseKnowledgeNode) => {
      if (!id) return;
      try {
        let nextMaterials = materials;
        if (nextMaterials.length === 0) {
          nextMaterials = await listCourseMaterials(id);
          setMaterials(nextMaterials);
        }
        const generatable = filterMaterialsForKnowledgeNode(
          nextMaterials,
          tree,
          node.id,
        ).filter(canGenerateQuestionsFromCourseMaterial);
        if (generatable.length === 0) {
          toast({
            title: "暂不能智能出题",
            description:
              "该章节下没有可用于出题的 PDF、DOCX 或 PPTX 上传资料。",
            variant: "destructive",
          });
          return;
        }
        if (generatable.length > 1) {
          toast({
            title: "已选择一份资料",
            description: `该章节下有 ${generatable.length} 份可生成题目的资料，当前使用《${generatable[0].title}》。如需指定其它资料，请到课程资料中选择。`,
          });
        }
        await handleGenerateFromMaterial(generatable[0]);
      } catch (err) {
        toast({
          title: "资料加载失败",
          description: err instanceof Error ? err.message : "请稍后重试",
          variant: "destructive",
        });
      }
    },
    [handleGenerateFromMaterial, id, materials, toast, tree],
  );

  const handleArchive = useCallback(
    async (examId: string, semesterId: string | null) => {
      if (!id) return;
      try {
        const updated = await archiveExamToSemester(id, examId, semesterId);
        const patch = (list: TeacherCourseExam[]) =>
          list.map((item) => (item.id === examId ? updated : item));
        setExams(patch);
        setAssignments(patch);
        toast({
          title: semesterId ? "已归档" : "已移出学期",
          description: updated.semester_name
            ? `已归档到《${updated.semester_name}》`
            : "已设为未归档",
        });
      } catch (err) {
        toast({
          title: "操作失败",
          description: err instanceof Error ? err.message : "请稍后重试",
          variant: "destructive",
        });
      }
    },
    [id, toast],
  );

  const goCreateExamOrAssignment = useCallback(
    (
      kind: "exam" | "assignment",
      options?: {
        courseKpId?: string;
        knowledgePointId?: string;
        knowledgePointName?: string;
        knowledgePointPath?: string;
        mainKnowledgePointId?: string;
        mainKnowledgePointName?: string;
        defaultBankName?: string;
        initialStep?: number;
      },
    ) => {
      navigate(kind === "exam" ? "/exams/create" : "/exams/practice/create", {
        state: {
          backTo: `/courses/${id}`,
          backLabel: "返回课程详情",
          successTo: `/courses/${id}?tab=${kind === "exam" ? "exams" : "assignments"}`,
          courseKpId: options?.courseKpId ?? id,
          ...(course?.name ? { courseName: course.name } : {}),
          ...(kind === "exam"
            ? { existingExamTitles: exams.map((exam) => exam.title) }
            : {}),
          ...(semesterFilter ? { courseSemesterId: semesterFilter } : {}),
          ...(options?.knowledgePointId
            ? {
                knowledgePointId: options.knowledgePointId,
                knowledgePointName: options.knowledgePointName,
                knowledgePointPath: options.knowledgePointPath,
              }
            : {}),
          ...(options?.mainKnowledgePointId
            ? {
                mainKnowledgePointId: options.mainKnowledgePointId,
                mainKnowledgePointName: options.mainKnowledgePointName,
              }
            : {}),
          ...(options?.defaultBankName
            ? { defaultBankName: options.defaultBankName }
            : {}),
          ...(options?.initialStep !== undefined
            ? { initialStep: options.initialStep }
            : {}),
        },
      });
    },
    [course?.name, exams, id, navigate, semesterFilter],
  );

  const handlePublishAssignmentForKnowledgeNode = useCallback(
    (node: CourseKnowledgeNode) => {
      const displayName = course?.name?.trim() || "课程";
      goCreateExamOrAssignment("assignment", {
        courseKpId: node.id,
        knowledgePointId: node.id,
        knowledgePointName: node.name,
        knowledgePointPath: [displayName, node.name]
          .filter(Boolean)
          .join(" / "),
        // 课程根节点带入第一步的"课程"字段；与具体知识点（章节）区分开。
        ...(tree?.id && tree.id !== node.id
          ? {
              mainKnowledgePointId: tree.id,
              mainKnowledgePointName: displayName,
            }
          : {}),
        defaultBankName: `${displayName}-题库`,
        initialStep: 1,
      });
    },
    [goCreateExamOrAssignment, course?.name, tree?.id],
  );

  const handlePublishAssignmentForMaterial = useCallback(
    (material: TeacherCourseMaterial) => {
      const displayName = course?.name?.trim() || "课程";
      const nodeName = material.node_name?.trim();
      goCreateExamOrAssignment("assignment", {
        courseKpId: material.node_id,
        ...(nodeName
          ? {
              knowledgePointId: material.node_id,
              knowledgePointName: nodeName,
              knowledgePointPath: [displayName, nodeName]
                .filter(Boolean)
                .join(" / "),
              ...(tree?.id && tree.id !== material.node_id
                ? {
                    mainKnowledgePointId: tree.id,
                    mainKnowledgePointName: displayName,
                  }
                : {}),
              defaultBankName: `${displayName}-题库`,
              initialStep: 1,
            }
          : {}),
      });
    },
    [goCreateExamOrAssignment, course?.name, tree?.id],
  );

  const handleExportExam = useCallback(
    async (
      exam: TeacherCourseExam,
      format: "docx" | "pdf",
      answers: boolean,
    ) => {
      try {
        await exportExam(exam.id, { format, answers });
      } catch (err) {
        toast({
          title: "导出失败",
          description: err instanceof Error ? err.message : "请稍后重试",
          variant: "destructive",
        });
      }
    },
    [toast],
  );

  const loadAssignmentScoreSummary = useCallback(async () => {
    if (!id) return;
    setAssignmentScoreSummaryLoading(true);
    try {
      const summary = await getCourseAssignmentScoreSummary(id, semesterFilter);
      setAssignmentScoreSummary(summary);
    } catch (err) {
      toast({
        title: "汇总失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setAssignmentScoreSummaryLoading(false);
    }
  }, [id, semesterFilter, toast]);

  const handleOpenAssignmentScoreSummary = useCallback(() => {
    setAssignmentScoreSummaryOpen(true);
    void loadAssignmentScoreSummary();
  }, [loadAssignmentScoreSummary]);

  // After close/delete, refetch whichever list the action belongs to so counts
  // and rows stay in sync with the server.
  const refreshExamList = useCallback(
    async (category: "exam" | "practice") => {
      if (!id) return;
      try {
        const [items, summary] = await Promise.all([
          category === "exam"
            ? listCourseExams(id, semesterFilter)
            : listCourseAssignments(id, semesterFilter),
          getTeacherCourse(id, semesterFilter),
        ]);
        if (category === "exam") {
          setExams(items);
        } else {
          setAssignments(items);
        }
        setCourse(summary);
      } catch {
        // Non-fatal — toast already shown by the calling handler on failure.
      }
    },
    [id, semesterFilter],
  );

  const normalizeMockNumber = useCallback(
    (value: string, fallback: number, min: number, max: number) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(max, Math.max(min, Math.trunc(parsed)));
    },
    [],
  );

  const openMockExamDialog = useCallback((exam: TeacherCourseExam) => {
    setMockExamTarget(exam);
    setMockQuestionCount(String(exam.total_questions));
    setMockReuseRate("80");
    setMockTitle(`${exam.title} - 模拟试卷`);
  }, []);

  const handleGenerateMockExam = useCallback(async () => {
    if (!mockExamTarget) return;
    const questionCount = normalizeMockNumber(
      mockQuestionCount,
      mockExamQuestionCount,
      mockExamQuestionCount,
      500,
    );
    const sourceReuseRate = normalizeMockNumber(mockReuseRate, 80, 0, 100);
    setMockQuestionCount(String(questionCount));
    setMockReuseRate(String(sourceReuseRate));
    setMockSubmitting(true);
    try {
      const result = await apiRequest<ExamMockGenerateResponse>(
        `/exams/${mockExamTarget.id}/mock-generate`,
        {
          method: "POST",
          body: JSON.stringify({
            question_count: questionCount,
            source_reuse_rate: sourceReuseRate,
            title: mockTitle.trim() || undefined,
          }),
        },
      );
      toast({
        title: "模拟试卷已生成",
        description: `复用原题 ${result.reused_source_question_count} 道，题库抽取 ${result.reused_bank_question_count} 道，AI 生成 ${result.generated_question_count} 道。`,
      });
      setMockExamTarget(null);
      await refreshExamList("exam");
    } catch (err) {
      toast({
        title: "生成失败",
        description: readableApiError(err, "生成模拟试卷失败，请稍后重试。"),
        variant: "destructive",
      });
    } finally {
      setMockSubmitting(false);
    }
  }, [
    mockExamQuestionCount,
    mockExamTarget,
    mockQuestionCount,
    mockReuseRate,
    mockTitle,
    normalizeMockNumber,
    refreshExamList,
    toast,
  ]);

  const handlePublishedFromSelection = useCallback(
    async (category: CreateFromSelectionCategory) => {
      if (!id) return;
      const targetTab: CourseTab =
        category === "exam" ? "exams" : "assignments";
      setActiveTab(targetTab);
      navigate(`/courses/${id}?tab=${targetTab}`, { replace: true });
      await Promise.all([
        category === "exam"
          ? listCourseExams(id, semesterFilter).then(setExams)
          : listCourseAssignments(id, semesterFilter).then(setAssignments),
        getTeacherCourse(id, semesterFilter).then(setCourse),
      ]);
    },
    [id, navigate, semesterFilter],
  );

  const handleConfirmCloseExam = useCallback(async () => {
    if (!examToClose) return;
    const target = examToClose;
    try {
      await apiRequest(`/exams/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      toast({
        title: "关闭成功",
        description: `「${target.title}」已关闭。`,
      });
      setExamToClose(null);
      await refreshExamList(
        target.category === "practice" ? "practice" : "exam",
      );
    } catch (err) {
      toast({
        title: "关闭失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    }
  }, [examToClose, refreshExamList, toast]);

  const handleConfirmDeleteExam = useCallback(async () => {
    if (!examToDelete) return;
    const target = examToDelete;
    try {
      await apiRequest(`/exams/${target.id}`, { method: "DELETE" });
      toast({
        title: "已删除",
        description: `「${target.title}」已删除。`,
      });
      setExamToDelete(null);
      await refreshExamList(
        target.category === "practice" ? "practice" : "exam",
      );
    } catch (err) {
      toast({
        title: "删除失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    }
  }, [examToDelete, refreshExamList, toast]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
          <LoaderCircle size={16} className="animate-spin" />
          正在加载课程详情...
        </div>
        <div className="h-14 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-4 lg:grid-cols-[1fr_312px]">
          <div className="h-[420px] animate-pulse rounded-xl bg-muted" />
          <div className="hidden h-[320px] animate-pulse rounded-xl bg-muted lg:block" />
        </div>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="mx-auto max-w-[760px] rounded-xl border border-destructive/25 bg-destructive/5 px-5 py-10 text-center text-sm text-destructive">
        {error ?? "课程不存在"}
      </div>
    );
  }

  const headerBadges = (
    <div className="flex items-center gap-2">
      {course.is_deleted ? (
        <Badge
          variant="outline"
          className="rounded-md border-destructive/25 bg-destructive/5 px-2 py-0 text-[11px] font-medium text-destructive"
        >
          已删除
        </Badge>
      ) : null}
      {course.visibility === "platform" ? (
        <Badge
          variant="outline"
          className="rounded-md border-border bg-muted px-2 py-0 text-[11px] font-medium text-muted-foreground"
        >
          共享
        </Badge>
      ) : null}
      {!course.can_write ? (
        <Badge
          variant="outline"
          className="gap-1 rounded-md border-border bg-muted px-2 py-0 text-[11px] font-medium text-muted-foreground"
        >
          <Lock size={11} />
          {course.is_deleted ? "只读查看" : "只读"}
        </Badge>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageIntroHeader
        title={course.name}
        description={formatKnowledgeDisplayPath(course.display_path)}
        onBack={() => navigate("/courses")}
        backLabel="返回我的课程"
        actions={
          <div className="flex items-center gap-2">
            {headerBadges}
            {course.can_write ? (
              <>
                <Button
                  variant="outline"
                  className="h-9 w-fit shrink-0 px-4 font-medium"
                  onClick={() => navigate(`/courses/${id}/question-skills`)}
                >
                  <Sparkles size={16} className="mr-1.5" />
                  智能出题
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="h-9 w-fit shrink-0 px-4 font-medium">
                      <Plus size={16} className="mr-1.5" />
                      新建内容
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onClick={() => void handleOpenUploadDialog()}
                    >
                      <Upload size={14} className="mr-2" />
                      上传资料
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setAddLinkOpen(true)}>
                      <Link2 size={14} className="mr-2" />
                      添加链接
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() =>
                        navigate("/exams/create", {
                          state: {
                            backTo: `/courses/${id}`,
                            backLabel: "返回课程详情",
                            successTo: `/courses/${id}?tab=exams`,
                            courseKpId: id,
                            courseName: course.name,
                            existingExamTitles: exams.map((exam) => exam.title),
                            defaultBankName: courseQuestionBankName(course.name),
                            mainKnowledgePointId: tree?.id ?? id,
                            mainKnowledgePointName: course.name,
                            ...(semesterFilter
                              ? { courseSemesterId: semesterFilter }
                              : {}),
                          },
                        })
                      }
                    >
                      <ClipboardList size={14} className="mr-2" />
                      创建考试
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        navigate("/exams/practice/create", {
                          state: {
                            backTo: `/courses/${id}`,
                            backLabel: "返回课程详情",
                            successTo: `/courses/${id}?tab=assignments`,
                            courseKpId: id,
                            ...(semesterFilter
                              ? { courseSemesterId: semesterFilter }
                              : {}),
                          },
                        })
                      }
                    >
                      <ListChecks size={14} className="mr-2" />
                      发布练习
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() =>
                        navigate("/questions/create", {
                          state: {
                            backTo: `/courses/${id}?tab=questions`,
                            backLabel: "返回课程详情",
                            successTo: `/courses/${id}?tab=questions`,
                            courseKpId: id,
                          },
                        })
                      }
                    >
                      <BookOpen size={14} className="mr-2" />
                      创建题目
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        navigate("/questions/import", {
                          state: {
                            backTo: `/courses/${id}?tab=questions`,
                            backLabel: "返回课程详情",
                            successTo: `/courses/${id}?tab=questions`,
                            courseKpId: id,
                            courseName: course.name,
                          },
                        })
                      }
                    >
                      <Upload size={14} className="mr-2" />
                      导入题目
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null}
          </div>
        }
      />

      {course.is_deleted ? (
        <div className="mx-auto w-full max-w-[1320px] rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          这门课程已删除。当前仅支持查看课程资料、考试、练习、题目和课程目录，不能新增、编辑或删除内容。
        </div>
      ) : null}

      {shouldShowCreateSemesterHint ? (
        <div className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <CalendarRange size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">建议先创建学期</div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              当前课程还没有资料、题目、考试或练习。创建学期后，后续发起的考试和练习可以归档到对应学期；这不是必填步骤。
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => setNewSemesterOpen(true)}
          >
            <Plus size={14} className="mr-1.5" />
            新建学期
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="关闭学期创建提醒"
            onClick={() => setSemesterHintDismissed(true)}
          >
            <X size={15} />
          </Button>
        </div>
      ) : null}

      <NewSemesterDialog
        courseId={course.id}
        open={newSemesterOpen}
        onOpenChange={setNewSemesterOpen}
        onCreated={(semester) => {
          setSemesters((current) => [
            semester,
            ...current.filter((item) => item.id !== semester.id),
          ]);
          setActiveSemesterId(semester.id);
        }}
      />

      <KnowledgeImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImport={handleImportKnowledgePaths}
        selectedTargetName={course.name}
      />

      <KnowledgeCatalogPhotoDialog
        open={catalogPhotoOpen}
        onOpenChange={setCatalogPhotoOpen}
        onImport={handleImportKnowledgePaths}
        onRecognize={handleRecognizeCatalogPhoto}
        selectedTargetName={course.name}
        lockedRootName={course.name}
        existingRootNames={[]}
      />

      <AddKnowledgeNodeDialog
        open={addKnowledgeOpen}
        tree={tree}
        saving={addingKnowledge}
        onOpenChange={setAddKnowledgeOpen}
        onSubmit={handleAddKnowledgeNode}
      />

      <UploadCourseMaterialDialog
        open={uploadDialogOpen}
        uploading={uploading}
        targets={materialUploadTargets}
        selectedNodeId={selectedMaterialUploadNodeId}
        files={materialUploadFiles}
        onOpenChange={(nextOpen) => {
          setUploadDialogOpen(nextOpen);
          if (!nextOpen) setMaterialUploadFiles([]);
        }}
        onSelectedNodeChange={setSelectedMaterialUploadNodeId}
        onFilesChange={setMaterialUploadFiles}
        onSubmit={() => {
          if (materialUploadFiles.length > 0) {
            void handleUploadFiles(
              selectedMaterialUploadNodeId,
              materialUploadFiles,
            );
          }
        }}
      />

      <BatchGenerateMaterialsDialog
        open={batchGenerateOpen}
        materials={materials}
        running={batchGenerating}
        progress={batchGenerateProgress}
        onOpenChange={setBatchGenerateOpen}
        onSubmit={handleBatchGenerateMaterials}
      />

      <ResourcePreview
        resource={
          previewMaterial as Parameters<typeof ResourcePreview>[0]["resource"]
        }
        open={Boolean(previewMaterial)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPreviewMaterial(null);
        }}
      />

      <AssignmentScoreSummaryDialog
        open={assignmentScoreSummaryOpen}
        loading={assignmentScoreSummaryLoading}
        summary={assignmentScoreSummary}
        courseName={course.name}
        semesterLabel={selectedSemesterLabel}
        onOpenChange={setAssignmentScoreSummaryOpen}
        onRefresh={loadAssignmentScoreSummary}
      />

      <AssociateMaterialKnowledgeDialog
        open={Boolean(materialToAssociate)}
        saving={associatingMaterial}
        material={materialToAssociate}
        targets={materialUploadTargets}
        selectedNodeId={associateMaterialNodeId}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setMaterialToAssociate(null);
        }}
        onSelectedNodeChange={setAssociateMaterialNodeId}
        onSubmit={() => void handleAssociateMaterial()}
      />

      <AddLinkDialog
        courseId={course.id}
        courseName={course.name}
        open={addLinkOpen}
        onOpenChange={setAddLinkOpen}
        onCreated={(material) =>
          setMaterials((current) => [material, ...current])
        }
      />

      <AlertDialog
        open={materialToDelete !== null}
        onOpenChange={(next) => {
          if (!next) setMaterialToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除资料</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除《{materialToDelete?.title}
              》？删除后不可恢复，但不会影响已挂这条资料的题目。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDeleteMaterial()}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={clearKpOpen}
        onOpenChange={(next) => {
          if (!clearingKp) setClearKpOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清除全部知识点</AlertDialogTitle>
            <AlertDialogDescription>
              将删除本课程下的所有子知识点及其后代。课程本身保留。已关联到这些知识点的题目和资料关系会随之失效，操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingKp}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={clearingKp}
              onClick={(event) => {
                event.preventDefault();
                void handleClearKnowledgePoints();
              }}
            >
              {clearingKp ? "清除中…" : "确认清除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={clearQuestionsOpen}
        onOpenChange={(next) => {
          if (!clearingQuestions) setClearQuestionsOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清除课程下全部题目</AlertDialogTitle>
            <AlertDialogDescription>
              将清除本课程及其子知识点下的全部题目。未被考试或练习使用过的题目会被彻底删除；已被使用过的题目会被软删除，仍可在原考试或练习记录中查看。此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingQuestions}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={clearingQuestions}
              onClick={(event) => {
                event.preventDefault();
                void handleClearCourseQuestions();
              }}
            >
              {clearingQuestions ? "清除中…" : "确认清除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={knowledgeNodeToDelete !== null}
        onOpenChange={(next) => {
          if (!next && !deletingKnowledgeNode) setKnowledgeNodeToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除知识点</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除「{knowledgeNodeToDelete?.name}
              」？其下级知识点也会一并删除。课程主知识会保留，不支持删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingKnowledgeNode}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingKnowledgeNode}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteKnowledgeNode();
              }}
            >
              {deletingKnowledgeNode ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={mockExamTarget !== null}
        onOpenChange={(next) => {
          if (!next && !mockSubmitting) setMockExamTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>生成模拟试卷</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-sm">
                <p>
                  系统会按原考试的题型比例和知识点分布组卷，优先从题库抽取，不足部分再由 AI 自动生成。
                </p>
                <div className="rounded-xl border bg-muted/40 p-4 text-muted-foreground">
                  <div>原考试题目：{mockExamQuestionCount} 题</div>
                  <div>模拟卷开始时间：不设置，生成后可直接开始</div>
                  <div>
                    模拟卷结束时间：
                    {mockExamEndDate && mockExamEndDate.getTime() > Date.now()
                      ? formatDateTime(mockExamEndDate.toISOString())
                      : "不限制结束时间，生成后可按需调整"}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="course-mock-title">模拟卷名称</Label>
                  <Input
                    id="course-mock-title"
                    value={mockTitle}
                    maxLength={200}
                    onChange={(event) => setMockTitle(event.target.value)}
                    placeholder={`${mockExamTarget?.title ?? "考试"} - 模拟试卷`}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="course-mock-question-count">题目数</Label>
                    <Input
                      id="course-mock-question-count"
                      type="number"
                      min={mockExamQuestionCount}
                      max={500}
                      value={mockQuestionCount}
                      onChange={(event) => setMockQuestionCount(event.target.value)}
                      onBlur={() =>
                        setMockQuestionCount(
                          String(
                            normalizeMockNumber(
                              mockQuestionCount,
                              mockExamQuestionCount,
                              mockExamQuestionCount,
                              500,
                            ),
                          ),
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">不能少于原考试的 {mockExamQuestionCount} 题。</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="course-mock-reuse-rate">与原考试重复率</Label>
                    <div className="relative">
                      <Input
                        id="course-mock-reuse-rate"
                        type="number"
                        min={0}
                        max={100}
                        value={mockReuseRate}
                        onChange={(event) => setMockReuseRate(event.target.value)}
                        onBlur={() => setMockReuseRate(String(normalizeMockNumber(mockReuseRate, 80, 0, 100)))}
                        className="pr-10"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                        %
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">默认 80%，其余题目优先从题库抽取。</p>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mockSubmitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={mockSubmitting}
              onClick={(event) => {
                event.preventDefault();
                void handleGenerateMockExam();
              }}
            >
              {mockSubmitting ? (
                <LoaderCircle size={14} className="mr-1.5 animate-spin" />
              ) : (
                <Sparkles size={14} className="mr-1.5" />
              )}
              生成模拟卷
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={examToClose !== null}
        onOpenChange={(next) => {
          if (!next) setExamToClose(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              关闭{examToClose?.category === "practice" ? "练习" : "考试"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-sm">
                <p>
                  确定要关闭「{examToClose?.title}」吗？关闭后考生将无法进入或继续作答。
                </p>
                <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-foreground">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <span className="text-muted-foreground">当前状态：</span>
                      <span className="font-medium">{examToCloseStatusLabel}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">考生人数：</span>
                      <span className="font-medium">{examToClose?.total_students ?? 0} 人</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">已提交：</span>
                      <span className="font-medium">{examToClose?.submitted_count ?? 0} 人</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">未提交：</span>
                      <span className="font-medium">{examToCloseNotSubmitted} 人</span>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-border/60 pt-3">
                    <span className="text-muted-foreground">进入/作答记录：</span>
                    <span
                      className={cn(
                        "font-medium",
                        examToClose?.has_student_history ? "text-amber-600" : "text-emerald-600",
                      )}
                    >
                      {examToClose?.has_student_history ? "已有考生进入或产生作答记录" : "暂无考生进入记录"}
                    </span>
                  </div>
                </div>
                {examToClose?.has_student_history || examToCloseNotSubmitted > 0 ? (
                  <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-amber-700">
                    关闭会立即中止未完成考生的作答入口，请确认这是主动结束本次
                    {examToClose?.category === "practice" ? "练习" : "考试"}。
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmCloseExam();
              }}
            >
              确认关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={examToDelete !== null}
        onOpenChange={(next) => {
          if (!next) setExamToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除{examToDelete?.category === "practice" ? "练习" : "考试"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              确认删除「{examToDelete?.title}」？删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDeleteExam();
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {uploading ? (
        <div className="pointer-events-none fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-md">
          <span className="size-2 animate-pulse rounded-full bg-foreground" />
          正在上传资料…
        </div>
      ) : null}

      {!shouldShowCreateSemesterHint ? (
      <div className="mx-auto w-full max-w-[1320px]">
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarRange size={14} />
            学期
          </div>
          <Select value={activeSemesterId} onValueChange={setActiveSemesterId}>
            <SelectTrigger className="h-8 w-[200px] text-sm">
              <SelectValue placeholder="选择学期" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SEMESTERS}>全部学期</SelectItem>
              {semesters.map((semester) => (
                <SelectItem key={semester.id} value={semester.id}>
                  {semester.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground">
            题目跟课程走；练习 / 考试按学期归档
          </span>
          <div className="flex-1" />
          {course.can_write ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewSemesterOpen(true)}
            >
              <Plus size={14} className="mr-1.5" />
              新建学期
            </Button>
          ) : null}
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_312px]">
          <main className="min-w-0">
            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as CourseTab)}
            >
              <TabsList className="mb-4 h-auto w-full flex-wrap justify-start gap-1 rounded-none border-b border-border bg-transparent p-0">
                {(
                  [
                    [
                      "knowledge",
                      "课程目录",
                      null,
                      <Layers3 key="i" size={14} />,
                    ],
                    [
                      "materials",
                      "课程资料",
                      course.material_count,
                      <FileText key="i" size={14} />,
                    ],
                    [
                      "exams",
                      "考试",
                      course.exam_count,
                      <ClipboardList key="i" size={14} />,
                    ],
                    [
                      "assignments",
                      "练习",
                      course.assignment_count,
                      <ListChecks key="i" size={14} />,
                    ],
                    [
                      "questions",
                      "题目",
                      course.question_count,
                      <BookOpen key="i" size={14} />,
                    ],
                  ] as const
                ).map(([key, label, count, icon]) => (
                  <TabsTrigger
                    key={key}
                    value={key}
                    className="group inline-flex items-center gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-3 py-2 text-muted-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                  >
                    <span className="text-muted-foreground/70 group-data-[state=active]:text-foreground">
                      {icon}
                    </span>
                    <span className="font-medium">{label}</span>
                    {count != null ? (
                      <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 font-sans text-[11px] font-semibold lining-nums tabular-nums text-muted-foreground group-data-[state=active]:bg-foreground/10 group-data-[state=active]:text-foreground">
                        {count}
                      </span>
                    ) : null}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="materials" className="mt-0">
                {tabLoading === "materials" ? (
                  <LoadingPanel label="正在加载课程资料..." />
                ) : (
                  <div className="space-y-3">
                    {materialFilterNode ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
                        <FileText size={15} />
                        <span className="font-medium">
                          正在查看「{materialFilterNode.name}」相关资料
                        </span>
                        <span className="text-primary/75">
                          共 {filteredMaterials.length} 份
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-7 px-2 text-primary hover:bg-primary/10 hover:text-primary"
                          onClick={() => setMaterialFilterNodeId(null)}
                        >
                          清除筛选
                        </Button>
                      </div>
                    ) : null}
                    <MaterialsTab
                      materials={filteredMaterials}
                      canWrite={course.can_write}
                      questionCountByNodeId={questionCountByNodeId}
                      scopeLabel={
                        materialFilterNode
                          ? `「${materialFilterNode.name}」目录范围 · 含下级资料`
                          : undefined
                      }
                      onOpenAddLink={() => setAddLinkOpen(true)}
                      onPickUpload={() => void handleOpenUploadDialog()}
                      onOpenBatchGenerate={() => setBatchGenerateOpen(true)}
                      onViewQuestions={handleViewQuestionsForMaterial}
                      onPublishAssignment={handlePublishAssignmentForMaterial}
                      onAssociate={setMaterialToAssociate}
                      onGenerateFrom={handleGenerateFromMaterial}
                      onDelete={(material) => setMaterialToDelete(material)}
                    />
                  </div>
                )}
              </TabsContent>
              <TabsContent value="exams" className="mt-0">
                {tabLoading === "exams" ? (
                  <LoadingPanel label="正在加载考试..." />
                ) : (
                  <ExamRows
                    items={exams}
                    kind="exam"
                    semesters={semesters}
                    canWrite={course.can_write}
                    onArchive={handleArchive}
                    onNewSemester={() => setNewSemesterOpen(true)}
                    onClose={(exam) => setExamToClose(exam)}
                    onDelete={(exam) => setExamToDelete(exam)}
                    onGenerateMock={openMockExamDialog}
                    onCreate={() => goCreateExamOrAssignment("exam")}
                    onExport={handleExportExam}
                  />
                )}
              </TabsContent>
              <TabsContent value="assignments" className="mt-0">
                {tabLoading === "assignments" ? (
                  <LoadingPanel label="正在加载练习..." />
                ) : (
                  <div className="space-y-3">
                    {assignmentFilterNode ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
                        <ListChecks size={15} />
                        <span className="font-medium">
                          正在查看「{assignmentFilterNode.name}」相关练习
                        </span>
                        <span className="text-primary/75">
                          共 {filteredAssignments.length} 项
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-7 px-2 text-primary hover:bg-primary/10 hover:text-primary"
                          onClick={() => setAssignmentFilterNodeId(null)}
                        >
                          清除筛选
                        </Button>
                      </div>
                    ) : null}
                    <ExamRows
                      items={filteredAssignments}
                      kind="assignment"
                      semesters={semesters}
                      canWrite={course.can_write}
                      onSummarize={handleOpenAssignmentScoreSummary}
                      onArchive={handleArchive}
                      onNewSemester={() => setNewSemesterOpen(true)}
                      onClose={(exam) => setExamToClose(exam)}
                      onDelete={(exam) => setExamToDelete(exam)}
                      onCreate={() => goCreateExamOrAssignment("assignment")}
                    />
                  </div>
                )}
              </TabsContent>
              <TabsContent value="questions" className="mt-0">
                {tabLoading === "questions" ? (
                  <LoadingPanel label="正在加载题目..." />
                ) : (
                  <div className="space-y-3">
                    {questionFilterNode ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
                        <BookOpen size={15} />
                        <span className="font-medium">
                          正在查看「{questionFilterNode.name}」相关题目
                        </span>
                        <span className="text-primary/75">
                          共 {filteredQuestions.length} 道
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-7 px-2 text-primary hover:bg-primary/10 hover:text-primary"
                          onClick={() => setQuestionFilterNodeId(null)}
                        >
                          清除筛选
                        </Button>
                      </div>
                    ) : null}
                    <QuestionsTab
                      questions={filteredQuestions}
                      courseId={id ?? ""}
                      courseName={course.name}
                      courseSemesterId={semesterFilter}
                      courseSemester={selectedSemester}
                      targetCourseKpId={questionFilterNode?.id ?? id ?? ""}
                      knowledgeFilterOptions={questionKnowledgeFilterOptions}
                      knowledgeFilterNodeId={questionFilterNodeId}
                      onKnowledgeFilterChange={setQuestionFilterNodeId}
                      existingExamTitles={exams.map((exam) => exam.title)}
                      knowledgeTree={tree}
                      canWrite={course.can_write}
                      showClearAllQuestions={!questionFilterNode}
                      seedUsage={seedUsage}
                      onPublishedExamOrAssignment={handlePublishedFromSelection}
                      onClearAllQuestions={() => setClearQuestionsOpen(true)}
                    />
                  </div>
                )}
              </TabsContent>
              <TabsContent value="knowledge" className="mt-0">
                {tabLoading === "knowledge" ? (
                  <LoadingPanel label="正在加载课程目录..." />
                ) : (
                  <KnowledgeTab
                    tree={tree}
                    canWrite={course.can_write}
                    assignmentLinksByNodeId={assignmentLinksByNodeId}
                    onOpenImport={() => setImportDialogOpen(true)}
                    onOpenCatalogPhoto={() => setCatalogPhotoOpen(true)}
                    onOpenAddNode={() => setAddKnowledgeOpen(true)}
                    onOpenNode={handleOpenKnowledgeNode}
                    onViewMaterials={handleViewMaterialsForKnowledgeNode}
                    onViewQuestions={handleViewQuestionsForKnowledgeNode}
                    onViewAssignments={handleViewAssignmentsForKnowledgeNode}
                    onGenerateFromMaterials={
                      handleGenerateQuestionsFromNodeMaterials
                    }
                    onUploadMaterial={(node) =>
                      void handleOpenUploadDialog(node.id)
                    }
                    onPublishAssignment={
                      handlePublishAssignmentForKnowledgeNode
                    }
                    onRequestDeleteNode={setKnowledgeNodeToDelete}
                    onClearAll={() => setClearKpOpen(true)}
                  />
                )}
              </TabsContent>
            </Tabs>
          </main>
          <TodoRail
            exams={exams}
            assignments={assignments}
            materials={materials}
            questions={questions}
          />
        </div>

        <CourseKnowledgeNodeDialog
          open={selectedKnowledgeNode !== null}
          node={selectedKnowledgeNode}
          nodePath={findCourseKnowledgeNodePath(tree, selectedKnowledgeNodeId)}
          course={course}
          materials={materials}
          questions={questions}
          canWrite={course.can_write}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setSelectedKnowledgeNodeId(null);
          }}
          onRename={handleRenameKnowledgeNode}
          onAddLink={handleAddNodeMaterialLink}
          onUploadFiles={handleUploadFilesToNode}
          onUpdateMaterial={handleUpdateNodeMaterial}
          onDeleteMaterial={(material) => setMaterialToDelete(material)}
          onGenerateFromMaterial={handleGenerateFromMaterial}
          extractingMaterialId={extractingMaterialId}
          onGenerateQuestions={handleGenerateFromKnowledgeNode}
          onCreateQuestion={handleCreateQuestionFromKnowledgeNode}
          onViewQuestion={(questionId) =>
            navigate(`/questions/edit/${questionId}`, {
              state: {
                backTo: `/courses/${id}?tab=knowledge${
                  selectedKnowledgeNodeId
                    ? `&node_id=${selectedKnowledgeNodeId}`
                    : ""
                }`,
                backLabel: "返回课程目录",
                successTo: `/courses/${id}?tab=knowledge${
                  selectedKnowledgeNodeId
                    ? `&node_id=${selectedKnowledgeNodeId}`
                    : ""
                }`,
              },
            })
          }
          onOpenAddNode={() => setAddKnowledgeOpen(true)}
          onRequestDeleteNode={setKnowledgeNodeToDelete}
        />

        {materialAiGenerateState ? (
          <MaterialAIGenerateDialog
            open={Boolean(materialAiGenerateState)}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) setMaterialAiGenerateState(null);
            }}
            knowledgePointId={materialAiGenerateState.knowledgePointId}
            knowledgePointName={materialAiGenerateState.knowledgePointName}
            knowledgePointPath={materialAiGenerateState.knowledgePointPath}
            materialTitle={materialAiGenerateState.materialTitle}
            materialSourceText={materialAiGenerateState.sourceText}
            materialImages={materialAiGenerateState.images}
            targetQuestionBankName={courseQuestionBankName(course.name)}
            onSaved={() => {
              if (id) {
                void Promise.all([
                  listCourseQuestions(id).then(setQuestions),
                  refreshKnowledgeTree(),
                  refreshCourseSummary(),
                ]).catch(() => {});
              } else {
                void Promise.all([
                  refreshKnowledgeTree(),
                  refreshCourseSummary(),
                ]).catch(() => {});
              }
            }}
          />
        ) : null}
      </div>
      ) : null}
    </div>
  );
}

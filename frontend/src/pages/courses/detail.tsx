import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  BookOpen,
  CalendarRange,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
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
import { cn } from "@/lib/utils";
import type { IQuestion } from "@/types";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
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
import {
  extractMaterialContent,
  MATERIAL_PAGE_LIMIT,
  UnsupportedMaterialFormatError,
} from "@/pages/knowledge/extract-material-content";
import type { KnowledgeImportPath } from "@/pages/knowledge/import-knowledge-utils";
import { apiRequest } from "@/pages/grading/api";
import {
  addCourseMaterialLink,
  archiveExamToSemester,
  clearCourseKnowledgePoints,
  deleteCourseMaterial,
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

type CourseMaterialAIGenerateState = CourseMaterialExtractedContent & {
  materialTitle: string;
  knowledgePointId: string;
  knowledgePointName: string;
  knowledgePointPath: string;
};

const PENDING_TONE = "text-[oklch(0.55_0.09_70)]"; // ochre

function formatDate(value: string | null) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未设置";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

function courseQuestionBankName(courseName: string | undefined) {
  const normalized = courseName?.trim();
  return normalized ? `${normalized.slice(0, 197)}-题库` : "主知识对应题库";
}

function MaterialsTab({
  materials,
  canWrite,
  onOpenAddLink,
  onPickUpload,
  onAssociate,
  onGenerateFrom,
  onDelete,
}: {
  materials: TeacherCourseMaterial[];
  canWrite: boolean;
  onOpenAddLink: () => void;
  onPickUpload: () => void;
  onAssociate: (material: TeacherCourseMaterial) => void;
  onGenerateFrom: (material: TeacherCourseMaterial) => void;
  onDelete: (material: TeacherCourseMaterial) => void;
}) {
  const [query, setQuery] = useState("");
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
        <span className="text-xs text-muted-foreground">
          整门课程范围 · 含子知识点资料
        </span>
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
  file,
  onOpenChange,
  onSelectedNodeChange,
  onFileChange,
  onSubmit,
}: {
  open: boolean;
  uploading: boolean;
  targets: CourseKnowledgeUploadTarget[];
  selectedNodeId: string;
  file: File | null;
  onOpenChange: (open: boolean) => void;
  onSelectedNodeChange: (nodeId: string) => void;
  onFileChange: (file: File | null) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>上传课程资料</DialogTitle>
          <DialogDescription>
            选择资料对应的课程知识点，再选择要上传的文件。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="course-material-upload-node">关联知识点</Label>
            <KnowledgeTargetSelect
              id="course-material-upload-node"
              targets={targets}
              value={selectedNodeId}
              onChange={onSelectedNodeChange}
            />
            <p className="text-xs text-muted-foreground">
              如果课程知识结构还未完善，默认选择课程本身。
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="course-material-upload-file">资料文件</Label>
            <Input
              id="course-material-upload-file"
              type="file"
              onChange={(event) =>
                onFileChange(event.target.files?.[0] ?? null)
              }
            />
            {file ? (
              <p className="truncate text-xs text-muted-foreground">
                已选择：{file.name}
              </p>
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
            disabled={!selectedNodeId || !file || uploading}
            onClick={onSubmit}
          >
            {uploading ? (
              <LoaderCircle size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Upload size={14} className="mr-1.5" />
            )}
            上传
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

function ExamRows({
  items,
  kind,
  semesters,
  canWrite,
  onArchive,
  onNewSemester,
  onClose,
  onDelete,
  onCreate,
}: {
  items: TeacherCourseExam[];
  kind: "exam" | "assignment";
  semesters: CourseSemester[];
  canWrite: boolean;
  onArchive: (examId: string, semesterId: string | null) => Promise<void>;
  onNewSemester: () => void;
  onClose: (exam: TeacherCourseExam) => void;
  onDelete: (exam: TeacherCourseExam) => void;
  onCreate: () => void;
}) {
  const navigate = useNavigate();
  const header = canWrite ? (
    <div className="flex items-center justify-end">
      <Button size="sm" onClick={onCreate}>
        <Plus size={14} className="mr-1.5" />
        新建{kind === "exam" ? "考试" : "作业"}
      </Button>
    </div>
  ) : null;
  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <ExamCardEmptyState
          title={kind === "exam" ? "暂无考试" : "暂无作业"}
          description={
            kind === "exam"
              ? "从课程进入创建考试时，会默认带入当前课程。"
              : "教师侧显示为作业，底层仍复用 practice。"
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
        const archiveMenu = canWrite ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold"
                aria-label="归档到学期"
              >
                <CalendarRange size={14} />
                <span>归档</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
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
            </DropdownMenuContent>
          </DropdownMenu>
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
            onClose={() => onClose(item)}
            onDelete={() => onDelete(item)}
            extraBadges={semesterBadge}
            extraActions={archiveMenu}
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
  canWrite,
  onPublishedExamOrAssignment,
}: {
  questions: IQuestion[];
  courseId: string;
  courseName: string;
  courseSemesterId: string | null;
  canWrite: boolean;
  onPublishedExamOrAssignment: (
    category: CreateFromSelectionCategory,
  ) => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createFromSelectionOpen, setCreateFromSelectionOpen] = useState(false);
  const filtered = questions.filter((question) => {
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
        {canWrite && filtered.length > 0 ? (
          <>
            <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-muted/30 px-3">
              <Checkbox
                checked={
                  selectedQuestionCount === filtered.length &&
                  filtered.length > 0
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
                发起考试/作业
              </Button>
            ) : null}
          </>
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
                    courseKpId: courseId,
                    courseName,
                  },
                })
              }
            >
              <Upload size={14} className="mr-1.5" />
              导入题目
            </Button>
            <Button
              size="sm"
              onClick={() =>
                navigate("/questions/create", {
                  state: {
                    backTo: `/courses/${courseId}?tab=questions`,
                    backLabel: "返回课程详情",
                    successTo: `/courses/${courseId}?tab=questions`,
                    courseKpId: courseId,
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
                expandOnHover
                hideAnswer
                className="cursor-pointer transition-all hover:border-primary hover:shadow-md"
                trailing={
                  canWrite ? (
                    <Checkbox
                      checked={selected.has(question.id)}
                      onCheckedChange={() => toggleSelect(question.id)}
                      aria-label={
                        selected.has(question.id) ? "取消选择题目" : "选择题目"
                      }
                    />
                  ) : null
                }
                actions={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5 text-xs text-muted-foreground hover:text-primary sm:px-2"
                    onClick={() => navigate(`/questions/edit/${question.id}`)}
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
        courseKpId={courseId}
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
  onUploadFile,
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
  onUploadFile: (nodeId: string, file: File) => Promise<void>;
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
    const file = event.target.files?.[0];
    if (!node || !file) return;
    setBusy("upload");
    try {
      await onUploadFile(node.id, file);
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
                    名称将同步显示在课程知识结构树与题目归类中。
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
  onViewAssignments,
  onRequestDelete,
}: {
  node: CourseKnowledgeNode;
  depth: number;
  canWrite: boolean;
  assignmentLinksByNodeId: Record<string, TeacherCourseExam[]>;
  onOpenNode: (kpId: string) => void;
  onViewAssignments: (node: CourseKnowledgeNode) => void;
  onRequestDelete: (node: CourseKnowledgeNode) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const canDelete = canWrite && depth > 0;
  const linkedAssignments = assignmentLinksByNodeId[node.id] ?? [];

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-2 hover:bg-muted",
          hasChildren && "cursor-pointer select-none",
        )}
        style={{ paddingLeft: 12 + depth * 22 }}
        onDoubleClick={
          hasChildren ? () => setExpanded((value) => !value) : undefined
        }
      >
        <button
          type="button"
          className={cn(
            "text-muted-foreground/70",
            !hasChildren && "invisible",
          )}
          aria-label={expanded ? "收起" : "展开"}
          onClick={() => setExpanded((value) => !value)}
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
            title={`查看「${node.name}」相关作业`}
            onClick={(event) => {
              event.stopPropagation();
              onViewAssignments(node);
            }}
          >
            <ListChecks size={11} />
            作业 {linkedAssignments.length}
          </button>
        ) : null}
        <span className="flex-1" />
        <span className="font-sans text-[11px] font-medium lining-nums tabular-nums text-muted-foreground">
          {node.question_count} 题
        </span>
        <span className="font-sans text-[11px] font-medium lining-nums tabular-nums text-muted-foreground">
          {node.material_count} 资料
        </span>
        {canWrite ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="编辑知识点"
            onClick={() => onOpenNode(node.id)}
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
            onClick={() => onRequestDelete(node)}
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
              onViewAssignments={onViewAssignments}
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
  onViewAssignments,
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
  onViewAssignments: (node: CourseKnowledgeNode) => void;
  onRequestDeleteNode: (node: CourseKnowledgeNode) => void;
  onClearAll: () => void;
}) {
  const hasChildren = !!tree && tree.children.length > 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">
          当前课程子树，不含其它课程主知识点
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
        <EmptyPanel icon={<Layers3 size={22} />} title="暂无知识结构" />
      ) : (
        <div className="rounded-xl border border-border bg-card p-2">
          <KnowledgeTreeRow
            node={tree}
            depth={0}
            canWrite={canWrite}
            assignmentLinksByNodeId={assignmentLinksByNodeId}
            onOpenNode={onOpenNode}
            onViewAssignments={onViewAssignments}
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
      title: "作业待批改",
      detail: `${pendingAssignments} 项作业需要关注`,
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
  const [materialUploadFile, setMaterialUploadFile] = useState<File | null>(
    null,
  );
  const [materialToAssociate, setMaterialToAssociate] =
    useState<TeacherCourseMaterial | null>(null);
  const [associateMaterialNodeId, setAssociateMaterialNodeId] = useState("");
  const [associatingMaterial, setAssociatingMaterial] = useState(false);
  const [semesters, setSemesters] = useState<CourseSemester[]>([]);
  const [activeSemesterId, setActiveSemesterId] =
    useState<string>(ALL_SEMESTERS);
  const [newSemesterOpen, setNewSemesterOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [catalogPhotoOpen, setCatalogPhotoOpen] = useState(false);
  const [addKnowledgeOpen, setAddKnowledgeOpen] = useState(false);
  const [addingKnowledge, setAddingKnowledge] = useState(false);
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [selectedKnowledgeNodeId, setSelectedKnowledgeNodeId] = useState<
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
  const [examToClose, setExamToClose] = useState<TeacherCourseExam | null>(
    null,
  );
  const [examToDelete, setExamToDelete] = useState<TeacherCourseExam | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState<CourseTab | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restoredKnowledgeNodeIdRef = useRef<string | null>(null);

  const semesterFilter =
    activeSemesterId === ALL_SEMESTERS ? null : activeSemesterId;
  const selectedKnowledgeNode = findCourseKnowledgeNode(
    tree,
    selectedKnowledgeNodeId,
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
  const materialUploadTargets = useMemo(
    () => flattenKnowledgeUploadTargets(tree),
    [tree],
  );

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
    if (assignmentFilterNodeId && !assignmentFilterNode) {
      setAssignmentFilterNodeId(null);
    }
  }, [assignmentFilterNode, assignmentFilterNodeId]);

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
      listCourseQuestions(id)
        .then((data) => {
          if (!ignore) setQuestions(data);
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
          "课程缺少方向信息，无法导入。请先在知识结构中检查课程根节点。",
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
          description: "课程缺少方向信息，请先检查课程知识结构。",
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
          description: `「${name}」已添加到课程知识结构。`,
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
        title: "知识结构刷新失败",
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

  const handleOpenUploadDialog = useCallback(async () => {
    setUploadDialogOpen(true);
    setMaterialUploadFile(null);
    if (!tree && id) {
      try {
        const fresh = await getCourseKnowledgeTree(id);
        setTree(fresh);
        setSelectedMaterialUploadNodeId(
          resolveDefaultKnowledgeUploadTargetId(fresh),
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
      try {
        const extracted = await extractMaterialContent(file);
        setMaterialContentById((current) => ({
          ...current,
          [material.id]: {
            sourceText: extracted.text.trim().slice(0, 120000),
            images: extracted.images,
          },
        }));
        if (extracted.pageCount > 30) {
          toast({
            title: "资料页数较多",
            description: `当前共 ${extracted.pageCount} 页/张。建议尽量控制在 30 页以内；系统最多处理 ${MATERIAL_PAGE_LIMIT} 页/张。`,
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
      return material;
    },
    [toast],
  );

  const extractExistingMaterial = useCallback(
    async (material: TeacherCourseMaterial) => {
      const file = await fetchCourseMaterialFile(material);
      const extracted = await extractMaterialContent(file);
      const content = {
        sourceText: extracted.text.trim().slice(0, 120000),
        images: extracted.images,
      };
      setMaterialContentById((current) => ({
        ...current,
        [material.id]: content,
      }));
      if (extracted.pageCount > 30) {
        toast({
          title: "资料页数较多",
          description: `当前共 ${extracted.pageCount} 页/张。建议尽量控制在 30 页以内；系统最多处理 ${MATERIAL_PAGE_LIMIT} 页/张。`,
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

  const handleUploadFile = useCallback(
    async (nodeId: string, file: File) => {
      if (!nodeId) return;
      setUploading(true);
      try {
        await uploadAndExtractMaterial(nodeId, file);
        toast({
          title: "上传成功",
          description: `《${file.name}》已添加到课程资料。`,
        });
        setUploadDialogOpen(false);
        setMaterialUploadFile(null);
        await refreshMaterialsAndTree();
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
    [refreshMaterialsAndTree, toast, uploadAndExtractMaterial],
  );

  const handleUploadFileToNode = useCallback(
    async (nodeId: string, file: File) => {
      await uploadAndExtractMaterial(nodeId, file);
      toast({
        title: "上传成功",
        description: `《${file.name}》已添加到该知识点资料。`,
      });
      await refreshMaterialsAndTree();
    },
    [refreshMaterialsAndTree, toast, uploadAndExtractMaterial],
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
        description: `「${knowledgeNodeToDelete.name}」已从课程知识结构移除。`,
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
    (kind: "exam" | "assignment") => {
      navigate(kind === "exam" ? "/exams/create" : "/exams/practice/create", {
        state: {
          backTo: `/courses/${id}`,
          backLabel: "返回课程详情",
          successTo: `/courses/${id}?tab=${kind === "exam" ? "exams" : "assignments"}`,
          courseKpId: id,
          ...(semesterFilter ? { courseSemesterId: semesterFilter } : {}),
        },
      });
    },
    [id, navigate, semesterFilter],
  );

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
                    发布作业
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
            ) : null}
          </div>
        }
      />

      {course.is_deleted ? (
        <div className="mx-auto w-full max-w-[1320px] rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          这门课程已删除。当前仅支持查看课程资料、考试、作业、题目和知识结构，不能新增、编辑或删除内容。
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
        file={materialUploadFile}
        onOpenChange={(nextOpen) => {
          setUploadDialogOpen(nextOpen);
          if (!nextOpen) setMaterialUploadFile(null);
        }}
        onSelectedNodeChange={setSelectedMaterialUploadNodeId}
        onFileChange={setMaterialUploadFile}
        onSubmit={() => {
          if (materialUploadFile) {
            void handleUploadFile(
              selectedMaterialUploadNodeId,
              materialUploadFile,
            );
          }
        }}
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
            <AlertDialogDescription>
              将「{examToClose?.title}
              」标记为已关闭。关闭后学生不再可参与，本操作不可撤销。
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
            题目跟课程走；作业 / 考试按学期归档
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
                      "知识结构",
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
                      "作业",
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
                  <MaterialsTab
                    materials={materials}
                    canWrite={course.can_write}
                    onOpenAddLink={() => setAddLinkOpen(true)}
                    onPickUpload={() => void handleOpenUploadDialog()}
                    onAssociate={setMaterialToAssociate}
                    onGenerateFrom={handleGenerateFromMaterial}
                    onDelete={(material) => setMaterialToDelete(material)}
                  />
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
                    onCreate={() => goCreateExamOrAssignment("exam")}
                  />
                )}
              </TabsContent>
              <TabsContent value="assignments" className="mt-0">
                {tabLoading === "assignments" ? (
                  <LoadingPanel label="正在加载作业..." />
                ) : (
                  <div className="space-y-3">
                    {assignmentFilterNode ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
                        <ListChecks size={15} />
                        <span className="font-medium">
                          正在查看「{assignmentFilterNode.name}」相关作业
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
                  <QuestionsTab
                    questions={questions}
                    courseId={id ?? ""}
                    courseName={course.name}
                    courseSemesterId={semesterFilter}
                    canWrite={course.can_write}
                    onPublishedExamOrAssignment={handlePublishedFromSelection}
                  />
                )}
              </TabsContent>
              <TabsContent value="knowledge" className="mt-0">
                {tabLoading === "knowledge" ? (
                  <LoadingPanel label="正在加载知识结构..." />
                ) : (
                  <KnowledgeTab
                    tree={tree}
                    canWrite={course.can_write}
                    assignmentLinksByNodeId={assignmentLinksByNodeId}
                    onOpenImport={() => setImportDialogOpen(true)}
                    onOpenCatalogPhoto={() => setCatalogPhotoOpen(true)}
                    onOpenAddNode={() => setAddKnowledgeOpen(true)}
                    onOpenNode={handleOpenKnowledgeNode}
                    onViewAssignments={handleViewAssignmentsForKnowledgeNode}
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
          onUploadFile={handleUploadFileToNode}
          onUpdateMaterial={handleUpdateNodeMaterial}
          onDeleteMaterial={(material) => setMaterialToDelete(material)}
          onGenerateFromMaterial={handleGenerateFromMaterial}
          extractingMaterialId={extractingMaterialId}
          onGenerateQuestions={handleGenerateFromKnowledgeNode}
          onCreateQuestion={handleCreateQuestionFromKnowledgeNode}
          onViewQuestion={(questionId) =>
            navigate(`/questions/edit/${questionId}`)
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
                void listCourseQuestions(id)
                  .then(setQuestions)
                  .catch(() => {});
              }
              void refreshCourseSummary();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

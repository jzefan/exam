import { useList, useCreate, useUpdate, useDelete, useGetIdentity, useInvalidate } from "@refinedev/core";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Tag, TagsIcon, ChevronLeft, ChevronRight, BookOpen } from "lucide-react";
import type { ITag, IQuestion } from "../../types";
import { getUserRole } from "@/types/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageIntroHeader } from "@/components/ui/page-intro-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
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

type TagType = ITag["type"];

const TAG_TYPE_LABELS: Record<TagType, string> = {
  knowledge: "知识点",
  subject: "学科",
  purpose: "用途",
  custom: "自定义",
};

const TAG_TYPE_BADGE_VARIANT: Record<TagType, "default" | "secondary" | "outline"> = {
  knowledge: "default",
  subject: "secondary",
  purpose: "outline",
  custom: "outline",
};

const STANDARD_TYPES: TagType[] = ["knowledge", "subject", "purpose"];

interface CreateDialogProps {
  open: boolean;
  isCustom: boolean;
  onClose: () => void;
  onSubmit: (name: string, type: TagType) => void;
  isLoading: boolean;
}

function CreateTagDialog({ open, isCustom, onClose, onSubmit, isLoading }: CreateDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<TagType>(isCustom ? "custom" : "knowledge");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim(), isCustom ? "custom" : type);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setName("");
      setType(isCustom ? "custom" : "knowledge");
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isCustom ? "添加自定义标签" : "添加标准标签"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">标签名称</label>
            <Input
              placeholder="输入标签名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={100}
            />
          </div>
          {!isCustom && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">标签类型</label>
              <Select value={type} onValueChange={(v) => setType(v as TagType)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择类型" />
                </SelectTrigger>
                <SelectContent>
                  {STANDARD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TAG_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                取消
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || isLoading}>
              {isLoading ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EditDialogProps {
  open: boolean;
  tag: ITag | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
  isLoading: boolean;
}

function EditTagDialog({ open, tag, onClose, onSubmit, isLoading }: EditDialogProps) {
  const [name, setName] = useState(tag?.name ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim());
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑标签</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">标签名称</label>
            <Input
              placeholder="输入标签名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={100}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                取消
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || isLoading}>
              {isLoading ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface TagRowProps {
  tag: ITag;
  canEdit: boolean;
  onEdit: (tag: ITag) => void;
  onDelete: (tag: ITag) => void;
  onViewQuestions: (tag: ITag) => void;
}

function TagRow({ tag, canEdit, onEdit, onDelete, onViewQuestions }: TagRowProps) {
  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-md hover:bg-muted/40 group transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <Tag size={14} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground truncate">{tag.name}</span>
        <Badge variant={TAG_TYPE_BADGE_VARIANT[tag.type]} className="text-xs shrink-0">
          {TAG_TYPE_LABELS[tag.type]}
        </Badge>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-4">
        <button
          type="button"
          className="text-xs text-muted-foreground whitespace-nowrap hover:text-foreground transition-colors"
          onClick={() => tag.question_count > 0 && onViewQuestions(tag)}
          disabled={tag.question_count === 0}
        >
          关联题目 {tag.question_count} 道
        </button>
        {canEdit && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onEdit(tag)}
            >
              <Pencil size={13} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => onDelete(tag)}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

const QUESTION_TYPE_LABEL: Record<string, string> = {
  choice: "选择",
  true_false: "判断",
  fill_in: "填空",
  short_answer: "简答",
  essay: "论述",
  code: "编程",
};

interface TagQuestionsDialogProps {
  tag: ITag | null;
  open: boolean;
  onClose: () => void;
}

function TagQuestionsDialog({ tag, open, onClose }: TagQuestionsDialogProps) {
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const { query } = useList<IQuestion>({
    resource: "questions",
    pagination: { currentPage: page, pageSize, mode: "server" },
    filters: tag ? [{ field: "tag_id", operator: "eq", value: tag.id }] : [],
    queryOptions: { enabled: open && !!tag },
  });

  const questions = query?.data?.data ?? [];
  const total = query?.data?.total ?? 0;
  const pageCount = Math.ceil(total / pageSize) || 1;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen size={16} />
            标签「{tag?.name}」关联的题目
            <span className="text-sm font-normal text-muted-foreground">共 {total} 道</span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {query?.isLoading ? (
            <div className="py-12 flex items-center justify-center text-muted-foreground">
              <span className="inline-block h-5 w-5 border-2 border-border border-t-foreground rounded-full animate-spin mr-2" />
              <span className="text-sm">加载中...</span>
            </div>
          ) : questions.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">暂无题目</div>
          ) : (
            <div className="divide-y divide-border/50">
              {questions.map((q, idx) => {
                const globalIdx = (page - 1) * pageSize + idx + 1;
                const title = typeof q.content?.text === "string" ? q.content.text : q.title;
                return (
                  <div key={q.id} className="py-2.5 flex gap-2">
                    <span className="text-xs text-muted-foreground w-6 pt-0.5 text-right shrink-0">{globalIdx}.</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground line-clamp-2">{title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="outline" className="text-[11px] px-1.5 py-0">
                          {QUESTION_TYPE_LABEL[q.type] ?? q.type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{q.score} 分</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-2 pt-3 border-t border-border/50">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={15} />
              上一页
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {page} / {pageCount}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs"
              disabled={page >= pageCount}
              onClick={() => setPage(page + 1)}
            >
              下一页
              <ChevronRight size={15} />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function generatePaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "ellipsis")[] = [1];
  if (current > 3) pages.push("ellipsis");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

interface TagSectionProps {
  tags: ITag[];
  total: number;
  isLoading: boolean;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  canEdit: boolean;
  onEdit: (tag: ITag) => void;
  onDelete: (tag: ITag) => void;
  onViewQuestions: (tag: ITag) => void;
  emptyText: string;
  onAdd?: () => void;
}

function TagSection({
  tags, total, isLoading, currentPage, pageSize, onPageChange,
  canEdit, onEdit, onDelete, onViewQuestions, emptyText, onAdd,
}: TagSectionProps) {
  const pageCount = Math.ceil(total / pageSize) || 1;
  const pages = generatePaginationPages(currentPage, pageCount);

  if (isLoading) {
    return (
      <div className="py-16 flex items-center justify-center text-muted-foreground">
        <span className="inline-block h-5 w-5 border-2 border-border border-t-foreground rounded-full animate-spin mr-2" />
        <span className="text-sm">加载中...</span>
      </div>
    );
  }

  if (tags.length === 0) {
    return (
      <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
        <TagsIcon size={32} strokeWidth={1.5} />
        <p className="text-sm">{emptyText}</p>
        {onAdd && (
          <Button size="sm" variant="ghost" className="mt-1 gap-1" onClick={onAdd}>
            <Plus size={14} />
            立即添加
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="divide-y divide-border/50">
        {tags.map((tag) => (
          <TagRow key={tag.id} tag={tag} canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} onViewQuestions={onViewQuestions} />
        ))}
      </div>

      {/* Pagination footer */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-1 py-3 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            <ChevronLeft size={15} />
            上一页
          </Button>
          {pages.map((page, idx) =>
            page === "ellipsis" ? (
              <span key={`e${idx}`} className="w-8 text-center text-sm text-muted-foreground select-none">…</span>
            ) : (
              <Button
                key={page}
                variant={page === currentPage ? "default" : "ghost"}
                size="icon"
                className="h-8 w-8 text-sm"
                onClick={() => onPageChange(page)}
              >
                {page}
              </Button>
            )
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            disabled={currentPage >= pageCount}
            onClick={() => onPageChange(currentPage + 1)}
          >
            下一页
            <ChevronRight size={15} />
          </Button>
        </div>
      )}
    </div>
  );
}

export function TagList() {
  const navigate = useNavigate();
  const { data: identity } = useGetIdentity<{ primary_org?: { role_name: string } | null }>();
  const userRole = identity ? getUserRole(identity) : undefined;
  const isAdminOrTeacher = userRole === "platform_admin" || userRole === "enterprise_admin" || userRole === "school_admin" || userRole === "teacher";

  const [pageSize, setPageSize] = useState(20);
  const [standardPage, setStandardPage] = useState(1);
  const [customPage, setCustomPage] = useState(1);

  const invalidate = useInvalidate();
  const refetch = () => invalidate({ resource: "tags", invalidates: ["list"] });

  const { query: standardQuery } = useList<ITag>({
    resource: "tags",
    pagination: { currentPage: standardPage, pageSize, mode: "server" },
    filters: [{ field: "type", operator: "in", value: ["knowledge", "subject", "purpose"] }],
  });
  const { query: customQuery } = useList<ITag>({
    resource: "tags",
    pagination: { currentPage: customPage, pageSize, mode: "server" },
    filters: [{ field: "type", operator: "eq", value: "custom" }],
  });

  const standardTags = standardQuery?.data?.data ?? [];
  const standardTotal = standardQuery?.data?.total ?? 0;
  const customTags = customQuery?.data?.data ?? [];
  const customTotal = customQuery?.data?.total ?? 0;

  const { mutate: createTag, mutation: createTagMutation } = useCreate();
  const { mutate: updateTagMutate, mutation: updateTagMutation } = useUpdate();
  const { mutate: deleteTagMutate } = useDelete();
  const isCreating = createTagMutation.isPending;
  const isUpdating = updateTagMutation.isPending;

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createIsCustom, setCreateIsCustom] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<ITag | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingTag, setDeletingTag] = useState<ITag | null>(null);
  const [questionsDialogTag, setQuestionsDialogTag] = useState<ITag | null>(null);

  const handleCreateOpen = (isCustom: boolean) => {
    setCreateIsCustom(isCustom);
    setCreateDialogOpen(true);
  };

  const handleCreate = (name: string, type: TagType) => {
    createTag(
      { resource: "tags", values: { name, type } },
      {
        onSuccess: () => {
          setCreateDialogOpen(false);
          refetch();
        },
      }
    );
  };

  const handleEditOpen = (tag: ITag) => {
    setEditingTag(tag);
    setEditDialogOpen(true);
  };

  const handleEdit = (name: string) => {
    if (!editingTag) return;
    updateTagMutate(
      { resource: "tags", id: editingTag.id, values: { name } },
      {
        onSuccess: () => {
          setEditDialogOpen(false);
          setEditingTag(null);
          refetch();
        },
      }
    );
  };

  const handleDeleteOpen = (tag: ITag) => {
    setDeletingTag(tag);
    setDeleteDialogOpen(true);
  };

  const handleDelete = () => {
    if (!deletingTag) return;
    deleteTagMutate(
      { resource: "tags", id: deletingTag.id },
      {
        onSuccess: () => {
          setDeleteDialogOpen(false);
          setDeletingTag(null);
          refetch();
        },
      }
    );
  };

  const handlePageSizeChange = (val: string) => {
    setPageSize(Number(val));
    setStandardPage(1);
    setCustomPage(1);
  };

  return (
    <div className="space-y-6">
      <PageIntroHeader
        title="标签管理"
        description="统一维护知识点、学科、用途与自定义标签，方便题目分类与筛选。"
        onBack={() => navigate("/questions")}
        backLabel="返回题目列表"
        fullBleed
      />

      <Card>
        <Tabs defaultValue="standard">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <TabsList className="bg-muted/60 gap-0.5">
                <TabsTrigger
                  value="standard"
                  className="gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
                >
                  标准标签
                  <span className="text-xs opacity-60 tabular-nums">
                    {standardQuery?.isLoading ? "—" : standardTotal}
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="custom"
                  className="gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
                >
                  自定义标签
                  <span className="text-xs opacity-60 tabular-nums">
                    {customQuery?.isLoading ? "—" : customTotal}
                  </span>
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-2">
                {/* Page size selector */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">每页</span>
                  <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                    <SelectTrigger className="h-8 w-16 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)} className="text-xs">
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">条</span>
                </div>

                {/* Add button */}
                <TabsContent value="standard" className="mt-0">
                  {isAdminOrTeacher && (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleCreateOpen(false)}>
                      <Plus size={14} />
                      添加标签
                    </Button>
                  )}
                </TabsContent>
                <TabsContent value="custom" className="mt-0">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleCreateOpen(true)}>
                    <Plus size={14} />
                    添加标签
                  </Button>
                </TabsContent>
              </div>
            </div>
          </CardHeader>

          <Separator className="mt-3" />

          <TabsContent value="standard">
            <CardContent className="pt-3 pb-2">
              <p className="text-xs text-muted-foreground mb-3">
                知识点、学科、用途类标签，仅管理员和教师可管理
              </p>
              <TagSection
                tags={standardTags}
                total={standardTotal}
                isLoading={standardQuery?.isLoading ?? true}
                currentPage={standardPage}
                pageSize={pageSize}
                onPageChange={setStandardPage}
                canEdit={isAdminOrTeacher}
                onEdit={handleEditOpen}
                onDelete={handleDeleteOpen}
                onViewQuestions={setQuestionsDialogTag}
                emptyText="暂无标准标签"
                onAdd={isAdminOrTeacher ? () => handleCreateOpen(false) : undefined}
              />
            </CardContent>
          </TabsContent>

          <TabsContent value="custom">
            <CardContent className="pt-3 pb-2">
              <p className="text-xs text-muted-foreground mb-3">
                所有用户均可自由创建和管理自定义标签
              </p>
              <TagSection
                tags={customTags}
                total={customTotal}
                isLoading={customQuery?.isLoading ?? true}
                currentPage={customPage}
                pageSize={pageSize}
                onPageChange={setCustomPage}
                canEdit={true}
                onEdit={handleEditOpen}
                onDelete={handleDeleteOpen}
                onViewQuestions={setQuestionsDialogTag}
                emptyText="暂无自定义标签"
                onAdd={() => handleCreateOpen(true)}
              />
            </CardContent>
          </TabsContent>
        </Tabs>
      </Card>

      {/* Create dialog */}
      <CreateTagDialog
        open={createDialogOpen}
        isCustom={createIsCustom}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={handleCreate}
        isLoading={isCreating}
      />

      {/* Edit dialog */}
      <EditTagDialog
        key={editingTag?.id ?? "edit-tag-dialog"}
        open={editDialogOpen}
        tag={editingTag}
        onClose={() => {
          setEditDialogOpen(false);
          setEditingTag(null);
        }}
        onSubmit={handleEdit}
        isLoading={isUpdating}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除标签</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除标签「{deletingTag?.name}」吗？
              {(deletingTag?.question_count ?? 0) > 0 && (
                <span className="block mt-1 text-amber-600 dark:text-amber-400">
                  该标签已关联 {deletingTag?.question_count} 道题目，删除后关联关系将移除。
                </span>
              )}
              此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Questions detail dialog */}
      <TagQuestionsDialog
        key={questionsDialogTag?.id ?? "tag-questions-dialog"}
        tag={questionsDialogTag}
        open={!!questionsDialogTag}
        onClose={() => setQuestionsDialogTag(null)}
      />
    </div>
  );
}

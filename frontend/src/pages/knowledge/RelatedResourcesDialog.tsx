import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Bot,
  ExternalLink,
  FileText,
  Link2,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";

import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMajorName } from "@/lib/knowledge-display";
import { ResourcePreview } from "@/pages/job-models/editor/resource-preview";
import { VideoSearchDialog } from "@/pages/job-models/editor/video-search";
import type { IQuestion } from "@/types";
import { MaterialAIGenerateDialog } from "./MaterialAIGenerateDialog";
import type { IDirection, IKnowledgePointDetail, IMajor } from "./types";

export interface LearningMaterial {
  id: string;
  node_id?: string;
  node_type?: string;
  title: string;
  url: string | null;
  file_path?: string | null;
  description?: string | null;
  source?: string | null;
  sort_order?: number;
  type?: "link" | "file";
  resource_type?: "link" | "document" | "video" | string;
  sourceTextAvailable?: boolean;
}

interface Props {
  open: boolean;
  node: IKnowledgePointDetail | null;
  rootKnowledge: IKnowledgePointDetail | null;
  major: IMajor | null;
  direction: IDirection | null;
  materials: LearningMaterial[];
  materialsLoading: boolean;
  relatedQuestions: IQuestion[];
  relatedQuestionsLoading: boolean;
  onAddMaterial: (payload: Pick<LearningMaterial, "title" | "url" | "resource_type">) => Promise<void> | void;
  onUploadMaterial: (file: File) => Promise<void>;
  onDeleteMaterial: (materialId: string) => Promise<void> | void;
  onClose: () => void;
  onViewQuestions: (nodeId: string) => void;
  onVideoSaved: () => void;
  /** Returns extracted multimodal material content, or null if unavailable. */
  onGenerateQuestionsFromMaterial: (material: LearningMaterial) => {
    sourceText: string;
    images: string[];
  } | null;
  onQuestionsSaved?: () => void;
}

function getMaterialIcon(material: LearningMaterial) {
  if (material.resource_type === "video") return <Video className="h-4 w-4 text-red-500" />;
  if (material.resource_type === "link" || material.type === "link") return <Link2 className="h-4 w-4 text-emerald-600" />;
  return <FileText className="h-4 w-4 text-blue-600" />;
}

function getMaterialTypeLabel(material: LearningMaterial) {
  if (material.resource_type === "video") return "视频";
  if (material.resource_type === "document" || material.type === "file") return "文档";
  return "链接";
}

function isUploadStoragePath(value: string) {
  return value.startsWith("/api/uploads/");
}

function getMaterialSubtitle(material: LearningMaterial) {
  if (material.description && !isUploadStoragePath(material.description)) return material.description;
  if (material.source === "upload" || material.resource_type === "document" || material.type === "file") {
    return "";
  }
  return material.url ?? "";
}

function getRootKnowledgeQuestionBankName(rootKnowledge: IKnowledgePointDetail | null) {
  if (!rootKnowledge?.name.trim()) return undefined;
  return `${rootKnowledge.name.trim().slice(0, 197)}-题库`;
}

export function RelatedResourcesDialog({
  open,
  node,
  rootKnowledge,
  major,
  direction,
  materials,
  materialsLoading,
  relatedQuestions,
  relatedQuestionsLoading,
  onAddMaterial,
  onUploadMaterial,
  onDeleteMaterial,
  onClose,
  onViewQuestions,
  onVideoSaved,
  onGenerateQuestionsFromMaterial,
  onQuestionsSaved,
}: Props) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [savingLink, setSavingLink] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showVideoSearch, setShowVideoSearch] = useState(false);
  const [previewMaterial, setPreviewMaterial] = useState<LearningMaterial | null>(null);
  const [aiGenerateState, setAiGenerateState] = useState<{
    materialTitle: string;
    sourceText: string;
    images: string[];
  } | null>(null);

  const knowledgePathParts = [major?.name, direction?.name, rootKnowledge?.name];
  if (node && rootKnowledge && node.id !== rootKnowledge.id) {
    knowledgePathParts.push(node.name);
  }
  const knowledgePathLabel = knowledgePathParts.filter(Boolean).join(" / ");
  const targetQuestionBankName = getRootKnowledgeQuestionBankName(rootKnowledge);

  const handleGenerateQuestionsClick = (material: LearningMaterial) => {
    const extracted = onGenerateQuestionsFromMaterial(material);
    if (!extracted || !node) return;
    setAiGenerateState({
      materialTitle: material.title,
      sourceText: extracted.sourceText,
      images: extracted.images,
    });
  };

  const questionCount = relatedQuestionsLoading
    ? node?.question_count ?? relatedQuestions.length
    : relatedQuestions.length;

  useEffect(() => {
    if (open) {
      setTitle("");
      setUrl("");
      setError(null);
      setShowAddForm(false);
      setShowVideoSearch(false);
      setPreviewMaterial(null);
    }
  }, [open, node?.id]);

  // Skip outside-click handling whenever a nested dialog is active. Once
  // a nested Radix dialog/select/popover takes over, its own dismissable
  // layer manages focus, and pointer events flowing through portals are
  // unreliable to classify from a document listener.
  const hasNestedOverlay = Boolean(
    showVideoSearch || previewMaterial || aiGenerateState,
  );

  useEffect(() => {
    if (!open || hasNestedOverlay) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || drawerRef.current?.contains(target)) {
        return;
      }
      if (
        target.closest(".react-flow__node") ||
        target.closest('[role="dialog"]') ||
        target.closest('[role="alertdialog"]') ||
        target.closest('[role="listbox"]') ||
        target.closest('[role="menu"]') ||
        target.closest("[data-radix-popper-content-wrapper]") ||
        target.closest("[data-sonner-toaster]")
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose, open, hasNestedOverlay]);

  const addMaterial = async () => {
    if (!title.trim() || !url.trim()) {
      setError("请填写资料名称和链接");
      return;
    }
    setSavingLink(true);
    try {
      await onAddMaterial({ title: title.trim(), url: url.trim(), resource_type: "link" });
      setTitle("");
      setUrl("");
      setError(null);
      setShowAddForm(false);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "添加资料失败");
    } finally {
      setSavingLink(false);
    }
  };

  const uploadMaterial = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await onUploadMaterial(file);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传文件失败");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  if (!open) {
    return null;
  }

  return (
    <aside
      ref={drawerRef}
      className="absolute bottom-0 right-0 top-0 z-30 flex w-[36%] min-w-[420px] max-w-[calc(100%-1rem)] flex-col overflow-hidden border-l border-border bg-background shadow-2xl"
    >
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="truncate text-lg font-semibold">学习资料与相关题目</h2>
            <p className="text-sm text-muted-foreground">
              {node ? `围绕「${node.name}」维护学习资料、查看题目，并可基于上传文件进行智能出题。` : "查看知识点资料。"}
            </p>
          </div>
          <Button className="h-8 w-8 shrink-0" onClick={onClose} size="icon" type="button" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="materials" className="flex min-h-0 flex-1 flex-col px-5 py-4">
          <TabsList className="w-fit shrink-0">
            <TabsTrigger value="materials">学习资料 {materials.length}</TabsTrigger>
            <TabsTrigger value="questions">相关题目 {questionCount}</TabsTrigger>
          </TabsList>

          <TabsContent value="materials" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="space-y-4 pr-1">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowAddForm((value) => !value)}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    添加链接
                  </Button>
                  <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                    {uploading ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
                    上传文件
                  </Button>
                  <Button size="sm" variant="outline" disabled={!node} onClick={() => setShowVideoSearch(true)}>
                    <Search className="mr-1 h-3.5 w-3.5" />
                    搜索视频
                  </Button>
                  <input ref={fileInputRef} className="hidden" type="file" onChange={uploadMaterial} />
                </div>
                <p className="text-xs text-muted-foreground">
                  文件智能出题支持 PDF / DOCX / PPTX；建议控制在 30 页以内，系统最多处理前 50 页/张。
                </p>
              </div>

              {showAddForm && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">新增链接资料</CardTitle>
                    <CardDescription>可添加课程网页、在线文档、公开视频等外部资料。</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-end">
                    <div className="space-y-2">
                      <Label htmlFor="material-title">资料名称</Label>
                      <Input id="material-title" value={title} onChange={(event) => setTitle(event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="material-url">资料链接</Label>
                      <Input id="material-url" placeholder="https://..." value={url} onChange={(event) => setUrl(event.target.value)} />
                    </div>
                    <Button disabled={savingLink} onClick={() => void addMaterial()} type="button">
                      {savingLink ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                      保存
                    </Button>
                  </CardContent>
                </Card>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              {materialsLoading ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    <LoaderCircle className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    正在加载学习资料...
                  </CardContent>
                </Card>
              ) : materials.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-sm text-muted-foreground">
                    暂无学习资料，点击上方按钮添加。
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-3">
                  {materials.map((material) => (
                    <Card key={material.id} className="group min-w-0 overflow-hidden transition-colors hover:border-primary/40">
                      <CardContent className="flex min-w-0 gap-3 py-4">
                        <div className="mt-0.5 shrink-0">{getMaterialIcon(material)}</div>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <button
                            className="block w-full truncate text-left text-sm font-medium hover:text-primary"
                            type="button"
                            onClick={() => setPreviewMaterial(material)}
                          >
                            {material.title}
                          </button>
                          {getMaterialSubtitle(material) && (
                            <p className="mt-1 max-w-full truncate text-xs text-muted-foreground">
                              {getMaterialSubtitle(material)}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {getMaterialTypeLabel(material)}
                            {material.source ? ` · ${material.source === "upload" ? "上传" : material.source}` : ""}
                          </p>
                          {material.source === "upload" && (
                            <Button
                              className="mt-3 h-7 px-2 text-xs"
                              disabled={!material.sourceTextAvailable}
                              onClick={() => handleGenerateQuestionsClick(material)}
                              type="button"
                              variant="secondary"
                            >
                              <Bot className="mr-1 h-3 w-3" />
                              用此文件智能出题
                            </Button>
                          )}
                        </div>
                        <div className="flex shrink-0 items-start gap-1">
                          {material.url && (
                            <Button asChild size="icon" type="button" variant="ghost">
                              <a href={material.url} rel="noreferrer" target="_blank">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                          <Button onClick={() => void onDeleteMaterial(material.id)} size="icon" type="button" variant="ghost">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              <Card>
                <CardContent className="grid gap-2 py-4 text-sm text-muted-foreground">
                  <p>专业：{major ? formatMajorName(major.name) : "未找到"}</p>
                  <p>方向：{direction?.name ?? "未找到"}</p>
                  <p>主知识点：{rootKnowledge?.name ?? "未选择"}</p>
                  <p>本知识点：{node?.name ?? "未选择"}</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="questions" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="space-y-3 pr-1">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BookOpen className="h-4 w-4" />
                    相关题目
                  </CardTitle>
                  <CardDescription>当前知识点已关联 {questionCount} 道题目。</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">可以查看已关联题目，也可以前往题库继续维护。</p>
                  <Button disabled={!node} onClick={() => node && onViewQuestions(node.id)} type="button">
                    前往题目列表
                  </Button>
                </CardContent>
              </Card>

              {relatedQuestionsLoading ? (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    <LoaderCircle className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    正在加载相关题目...
                  </CardContent>
                </Card>
              ) : relatedQuestions.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    当前知识点还没有可展示的题目。
                  </CardContent>
                </Card>
              ) : (
                relatedQuestions.map((question) => (
                  <QuestionPreviewCard key={question.id} question={question} mode="compact" defaultExpanded />
                ))
              )}
            </div>
          </TabsContent>
      </Tabs>

        <ResourcePreview
          resource={previewMaterial as Parameters<typeof ResourcePreview>[0]["resource"]}
          open={Boolean(previewMaterial)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setPreviewMaterial(null);
          }}
        />

        {node && (
          <VideoSearchDialog
            open={showVideoSearch}
            onOpenChange={setShowVideoSearch}
            nodeId={node.id}
            nodeName={node.name}
            nodeType="kp"
            onSaved={onVideoSaved}
          />
        )}

        {node && aiGenerateState && (
          <MaterialAIGenerateDialog
            open={Boolean(aiGenerateState)}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) setAiGenerateState(null);
            }}
            knowledgePointId={node.id}
            knowledgePointName={node.name}
            knowledgePointPath={knowledgePathLabel || node.name}
            materialTitle={aiGenerateState.materialTitle}
            materialSourceText={aiGenerateState.sourceText}
            materialImages={aiGenerateState.images}
            targetQuestionBankName={targetQuestionBankName}
            onSaved={onQuestionsSaved}
          />
        )}
    </aside>
  );
}

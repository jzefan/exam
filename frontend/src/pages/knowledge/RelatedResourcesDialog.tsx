import { useEffect, useState } from "react";
import { BookOpen, Bot, Check, ExternalLink, Film, FolderOpen, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { IQuestion } from "@/types";
import type {
  AIRecommendationModel,
  IDirection,
  IKnowledgePointDetail,
  IMajor,
  IRecommendationItem,
} from "./types";

export interface LearningMaterial {
  id: string;
  title: string;
  url: string;
  type: "link" | "file";
}

interface Props {
  open: boolean;
  node: IKnowledgePointDetail | null;
  major: IMajor | null;
  direction: IDirection | null;
  materials: LearningMaterial[];
  relatedQuestions: IQuestion[];
  relatedQuestionsLoading: boolean;
  onAddMaterial: (payload: Omit<LearningMaterial, "id">) => void;
  onDeleteMaterial: (materialId: string) => void;
  onClose: () => void;
  onViewQuestions: (nodeId: string) => void;
  onGenerateRecommendations: (
    nodeId: string,
    model: AIRecommendationModel,
  ) => Promise<IRecommendationItem[]>;
}

export function RelatedResourcesDialog({
  open,
  node,
  major,
  direction,
  materials,
  relatedQuestions,
  relatedQuestionsLoading,
  onAddMaterial,
  onDeleteMaterial,
  onClose,
  onViewQuestions,
  onGenerateRecommendations,
}: Props) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recommendationModel, setRecommendationModel] = useState<AIRecommendationModel>("deepseek");
  const [recommendations, setRecommendations] = useState<IRecommendationItem[]>([]);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const savedRecommendationUrls = new Set(materials.map((material) => material.url));

  useEffect(() => {
    if (open) {
      setTitle("");
      setUrl("");
      setError(null);
      setRecommendationError(null);
    }
  }, [open]);

  useEffect(() => {
    setRecommendations([]);
    setRecommendationError(null);
    setRecommendationLoading(false);
  }, [node?.id]);

  const addMaterial = () => {
    if (!title.trim() || !url.trim()) {
      setError("请填写资料名称和链接");
      return;
    }
    onAddMaterial({ title: title.trim(), url: url.trim(), type: "link" });
    setTitle("");
    setUrl("");
    setError(null);
  };

  const generateRecommendations = async () => {
    if (!node) {
      return;
    }
    setRecommendationLoading(true);
    setRecommendationError(null);
    try {
      const items = await onGenerateRecommendations(node.id, recommendationModel);
      setRecommendations(items);
    } catch (generationError) {
      setRecommendationError(generationError instanceof Error ? generationError.message : "生成推荐资料失败");
      setRecommendations([]);
    } finally {
      setRecommendationLoading(false);
    }
  };

  const saveRecommendation = (item: IRecommendationItem) => {
    if (savedRecommendationUrls.has(item.url)) {
      return;
    }
    onAddMaterial({
      title: item.title,
      url: item.url,
      type: "link",
    });
  };

  const saveAllRecommendations = () => {
    recommendations.forEach((item) => {
      if (!savedRecommendationUrls.has(item.url)) {
        onAddMaterial({
          title: item.title,
          url: item.url,
          type: "link",
        });
      }
    });
  };

  const unsavedRecommendationCount = recommendations.filter((item) => !savedRecommendationUrls.has(item.url)).length;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>查看关联资料</DialogTitle>
          <DialogDescription>
            {node ? `围绕「${node.name}」查看题目、学习资料和推荐资源。` : "查看知识点的关联资料。"}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="questions">
          <TabsList>
            <TabsTrigger value="questions">题目 {node?.question_count ?? 0}</TabsTrigger>
            <TabsTrigger value="materials">学习资料 {materials.length}</TabsTrigger>
            <TabsTrigger value="recommendations">推荐资料 {recommendations.length}</TabsTrigger>
          </TabsList>

          <TabsContent value="questions">
            <div className="space-y-3">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BookOpen className="h-4 w-4" />
                    关联题目
                  </CardTitle>
                  <CardDescription>当前知识点已关联 {node?.question_count ?? 0} 道题目。</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">你可以继续为这个知识点关联更多题目。</p>
                  <Button disabled={!node} onClick={() => node && onViewQuestions(node.id)} type="button">
                    前往题目列表
                  </Button>
                </CardContent>
              </Card>

              {relatedQuestionsLoading ? (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    <LoaderCircle className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    正在加载关联题目...
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
                  <QuestionPreviewCard
                    key={question.id}
                    question={question}
                    mode="compact"
                    defaultExpanded
                  />
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="materials">
            <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FolderOpen className="h-4 w-4" />
                    新增学习资料
                  </CardTitle>
                  <CardDescription>先提供资料链接，后续可以继续接真实上传能力。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="material-title">资料名称</Label>
                    <Input id="material-title" value={title} onChange={(event) => setTitle(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="material-url">资料链接</Label>
                    <Input id="material-url" value={url} onChange={(event) => setUrl(event.target.value)} />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button className="w-full" onClick={addMaterial} type="button">
                    <Plus className="h-4 w-4" />
                    添加资料
                  </Button>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {materials.length === 0 && (
                  <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                      还没有学习资料，可以先添加外部链接。
                    </CardContent>
                  </Card>
                )}
                {materials.map((material) => (
                  <Card key={material.id}>
                    <CardContent className="flex items-center justify-between gap-3 py-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{material.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{material.url}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button asChild size="icon" type="button" variant="ghost">
                          <a href={material.url} rel="noreferrer" target="_blank">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button
                          onClick={() => onDeleteMaterial(material.id)}
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="recommendations">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bot className="h-4 w-4" />
                    AI 生成推荐资料
                  </CardTitle>
                  <CardDescription>
                    根据专业、方向、知识点名称和描述，生成可直接跳转 B 站搜索的推荐资料。
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)] md:items-end">
                  <div className="space-y-2">
                    <Label htmlFor="recommendation-model">模型</Label>
                    <Select value={recommendationModel} onValueChange={(value) => setRecommendationModel(value as AIRecommendationModel)}>
                      <SelectTrigger id="recommendation-model">
                        <SelectValue placeholder="选择模型" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="deepseek">DeepSeek</SelectItem>
                        <SelectItem value="qwen">Qwen</SelectItem>
                        <SelectItem value="kimi">Kimi</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    className="md:justify-self-start"
                    disabled={!node || recommendationLoading}
                    onClick={() => void generateRecommendations()}
                    type="button"
                  >
                    {recommendationLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
                    使用 AI 生成推荐资料
                  </Button>
                </CardContent>
              </Card>

              {node && (
                <Card>
                  <CardContent className="grid gap-2 py-4 text-sm text-muted-foreground md:grid-cols-3">
                    <p>专业：{major?.name ?? "未找到"}</p>
                    <p>方向：{direction?.name ?? "未找到"}</p>
                    <p>知识点：{node.name}</p>
                  </CardContent>
                </Card>
              )}

              {recommendationError && (
                <Card>
                  <CardContent className="py-4 text-sm text-destructive">{recommendationError}</CardContent>
                </Card>
              )}

              {recommendations.length > 0 && (
                <div className="flex justify-end">
                  <Button
                    disabled={unsavedRecommendationCount === 0}
                    onClick={saveAllRecommendations}
                    type="button"
                    variant="secondary"
                  >
                    <Save className="h-4 w-4" />
                    全部保存到学习资料
                  </Button>
                </div>
              )}

              {!recommendationLoading && recommendations.length === 0 && !recommendationError && (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    选择模型后点击“使用 AI 生成推荐资料”。
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {recommendations.map((item, index) => (
                  <Card key={`${item.url}-${index}`}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Film className="h-4 w-4" />
                        {item.title}
                      </CardTitle>
                      <CardDescription>{item.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-0">
                      <p className="text-xs text-muted-foreground">来源：B 站搜索推荐</p>
                      <div className="flex gap-2">
                        <Button
                          disabled={savedRecommendationUrls.has(item.url)}
                          onClick={() => saveRecommendation(item)}
                          type="button"
                          variant="secondary"
                        >
                          {savedRecommendationUrls.has(item.url) ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          {savedRecommendationUrls.has(item.url) ? "已保存" : "保存"}
                        </Button>
                        <Button asChild className="flex-1" variant="outline">
                          <a href={item.url} rel="noreferrer" target="_blank">
                            打开 B 站
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

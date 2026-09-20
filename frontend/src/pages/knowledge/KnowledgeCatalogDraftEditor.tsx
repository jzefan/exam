/**
 * 草稿目录编辑器。
 *
 * 版式与「我的课程 → 课程详情 → 目录」的编辑页（`KnowledgeTreeEditorPage`）保持一致：
 * 顶部「返回目录 + 编辑课程目录」、左侧可展开的知识树、右侧「改名 / 新增下层 / 删除」。
 * 区别只在于这里编辑的是还没落库的草稿路径，所以改完直接回吐给调用方。
 */

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Layers3,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  DRAFT_ROOT_DEPTH,
  addKnowledgeDraftChildren,
  buildKnowledgeDraftTree,
  draftKeyFromPrefix,
  draftNodeKey,
  findKnowledgeDraftNode,
  removeKnowledgeDraftNode,
  renameKnowledgeDraftNode,
  type KnowledgeDraftTreeNode,
  type KnowledgeImportPath,
} from "./import-knowledge-utils";

type KnowledgeCatalogDraftEditorProps = {
  paths: KnowledgeImportPath[];
  /** 虚拟根节点的名字（课程名），对应目录页编辑树里的课程根节点。 */
  rootName: string;
  onBack: () => void;
  onChange: (paths: KnowledgeImportPath[]) => void;
  /** 可选的次级入口：切到文本批量编辑。 */
  onBatchEdit?: () => void;
};

function DraftEditorTreeNode({
  node,
  selectedKey,
  onSelect,
}: {
  node: KnowledgeDraftTreeNode;
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const key = draftNodeKey(node);
  const isRoot = node.depth === DRAFT_ROOT_DEPTH;
  const selected = key === selectedKey;

  return (
    <div>
      <div
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
          selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
        )}
        style={{ paddingLeft: 10 }}
        onClick={() => onSelect(key)}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          {hasChildren ? (
            <button
              type="button"
              className="inline-flex size-4 items-center justify-center rounded hover:bg-muted-foreground/10"
              aria-label={expanded ? "收起" : "展开"}
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((value) => !value);
              }}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : null}
        </span>
        {isRoot ? (
          <Layers3 size={15} className="shrink-0 text-primary" />
        ) : (
          <BookOpen
            size={15}
            className={cn("shrink-0", hasChildren ? "text-primary" : "text-muted-foreground")}
          />
        )}
        <span className={cn("min-w-0 flex-1 truncate", isRoot && "font-medium")}>
          {node.label}
        </span>
        {hasChildren ? (
          <span className="shrink-0 text-xs text-muted-foreground">{node.children.length}</span>
        ) : null}
      </div>
      {hasChildren && expanded ? (
        <div className="ml-4 border-l border-border/60 pl-2">
          {node.children.map((child) => (
            <DraftEditorTreeNode
              key={draftNodeKey(child)}
              node={child}
              selectedKey={selectedKey}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function KnowledgeCatalogDraftEditor({
  paths,
  rootName,
  onBack,
  onChange,
  onBatchEdit,
}: KnowledgeCatalogDraftEditorProps) {
  const tree = useMemo(() => buildKnowledgeDraftTree(rootName, paths), [paths, rootName]);
  const [selectedKey, setSelectedKey] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [childrenDraft, setChildrenDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const selectedNode = useMemo(
    () => findKnowledgeDraftNode(tree, selectedKey) ?? tree,
    [tree, selectedKey],
  );
  const isRoot = selectedNode.depth === DRAFT_ROOT_DEPTH;

  // 选中节点变了就重置草稿；节点只是被改名时保留用户已经敲进去的内容。
  useEffect(() => {
    setChildrenDraft("");
    setConfirmingDelete(false);
  }, [selectedKey]);

  useEffect(() => {
    setNameDraft(isRoot ? "" : selectedNode.label);
  }, [isRoot, selectedKey, selectedNode.label]);

  // 选中的节点被删掉（自己删的，或删了它的上级）时回到根节点。
  useEffect(() => {
    if (findKnowledgeDraftNode(tree, selectedKey) === null) {
      setSelectedKey("");
    }
  }, [selectedKey, tree]);

  const trimmedName = nameDraft.trim();
  const canRename = !isRoot && trimmedName.length > 0 && trimmedName !== selectedNode.label;

  const childNames = childrenDraft
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter((name, index, names) => name.length > 0 && names.indexOf(name) === index);

  const handleRename = () => {
    if (!canRename) return;
    const nextPrefix = [...selectedNode.prefix.slice(0, -1), trimmedName];
    onChange(renameKnowledgeDraftNode(paths, selectedNode.prefix, trimmedName));
    // 节点的 key 由路径算出来，改名后必须跟着换，否则选中状态会丢回根节点。
    setSelectedKey(draftKeyFromPrefix(nextPrefix));
    setNameDraft(trimmedName);
  };

  const handleAddChildren = () => {
    if (childNames.length === 0) return;
    onChange(addKnowledgeDraftChildren(paths, selectedNode.prefix, childNames));
    setChildrenDraft("");
  };

  const handleDelete = () => {
    if (isRoot) return;
    onChange(removeKnowledgeDraftNode(paths, selectedNode.prefix));
    setConfirmingDelete(false);
    setSelectedKey("");
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
          <ArrowLeft size={15} className="mr-1.5" />
          返回目录
        </Button>
        <div className="h-5 w-px bg-border" />
        <h1 className="text-base font-semibold text-foreground">编辑课程目录</h1>
        {onBatchEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground"
            onClick={onBatchEdit}
          >
            <Pencil size={15} className="mr-1.5" />
            批量编辑
          </Button>
        ) : null}
      </div>

      {/* 高度取「固定 520px」与「视口减去弹窗其余部分」的较小值，矮屏上不会被裁掉。 */}
      <div className="grid h-[min(520px,calc(100vh-340px))] min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.6fr)]">
        <section className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">知识树</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">点击节点查看和编辑</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <DraftEditorTreeNode node={tree} selectedKey={selectedKey} onSelect={setSelectedKey} />
          </div>
        </section>

        <section className="h-full min-h-0 overflow-y-auto rounded-xl border border-border bg-card p-5">
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-xs text-muted-foreground">
                {[rootName, ...selectedNode.prefix].join(" / ")}
              </p>
              <div className="mt-2 flex items-center gap-2">
                {isRoot ? (
                  <Layers3 size={18} className="shrink-0 text-primary" />
                ) : (
                  <BookOpen size={18} className="shrink-0 text-primary" />
                )}
                <h2 className="min-w-0 truncate text-lg font-semibold text-foreground">
                  {selectedNode.label}
                </h2>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="catalog-draft-node-name">名称</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="catalog-draft-node-name"
                  disabled={isRoot}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleRename();
                  }}
                  value={nameDraft}
                />
                <Button type="button" variant="outline" disabled={!canRename} onClick={handleRename}>
                  保存
                </Button>
              </div>
              {isRoot ? (
                <p className="text-xs text-muted-foreground">
                  课程根节点由课程本身决定，不能在这里改名。
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-5">
              <div>
                <Label htmlFor="catalog-draft-children">新增子知识点</Label>
                <p className="mt-1 text-xs text-muted-foreground">每行一个，同级创建</p>
              </div>
              <Textarea
                id="catalog-draft-children"
                onChange={(event) => setChildrenDraft(event.target.value)}
                placeholder={
                  isRoot
                    ? "例如：第一章 概述\n第二章 物理层"
                    : "例如：1.1 互联网概述\n1.2 互联网的组成"
                }
                rows={5}
                value={childrenDraft}
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {childNames.length > 0 ? `将新增 ${childNames.length} 项` : ""}
                </span>
                <Button
                  type="button"
                  disabled={childNames.length === 0}
                  onClick={handleAddChildren}
                >
                  <Plus size={14} className="mr-1.5" />
                  新增子知识点
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
              <div>
                <p className="text-sm font-medium text-foreground">删除知识点</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isRoot ? "课程根节点不可删除" : "删除后不可恢复，其下级节点会一并删除"}
                </p>
              </div>
              {confirmingDelete ? (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    取消
                  </Button>
                  <Button type="button" variant="destructive" onClick={handleDelete}>
                    确认删除
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 text-destructive hover:text-destructive"
                  disabled={isRoot}
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 size={14} className="mr-1.5" />
                  删除
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { type Edge, type Node } from "@xyflow/react";
import { useNavigate } from "react-router-dom";

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
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { createRandomId } from "@/lib/random-id";
import type { IQuestion } from "@/types";
import { KnowledgeImportDialog } from "./KnowledgeImportDialog";
import { KnowledgeCatalogPhotoDialog } from "./KnowledgeCatalogPhotoDialog";
import { KnowledgeTreeCanvas } from "./KnowledgeTreeCanvas";
import { MajorDirectionSidebar } from "./MajorDirectionSidebar";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { PrerequisiteSelectModal } from "./PrerequisiteSelectModal";
import { RelatedResourcesDialog, type LearningMaterial } from "./RelatedResourcesDialog";
import {
  getReadOnlyKnowledgeFeedback,
} from "./access-messages";
import type { KnowledgeImportPath } from "./import-knowledge-utils";
import { getFirstKnowledgeImportRootName } from "./import-knowledge-utils";
import type {
  AIRecommendationModel,
  IDirection,
  IFlowData,
  IKnowledgePointDetail,
  IMajor,
  IRecommendationItem,
} from "./types";

const API = "/api/knowledge";

type StructureFormState = {
  open: boolean;
  kind: "major" | "direction";
  mode: "create" | "edit";
  id?: string;
  majorId?: string;
  name: string;
  description: string;
};

type DeleteState =
  | { open: false }
  | {
      open: true;
      kind: "major" | "direction" | "knowledge-point";
      id: string;
      name: string;
      description: string;
      isCurrentDirection?: boolean;
    };

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("access_token");
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const detail = error?.detail;
    let message: string;
    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      message = detail
        .map((item: { loc?: unknown[]; msg?: string }) => {
          const msg = typeof item?.msg === "string" ? item.msg : "";
          const loc = Array.isArray(item?.loc) ? item.loc.slice(1).join(".") : "";
          return loc ? `${loc}: ${msg}` : msg;
        })
        .filter(Boolean)
        .join("；") || "Request failed";
    } else {
      message = "Request failed";
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function getKnowledgeSubtree(nodes: Node[], edges: Edge[], rootId: string | null) {
  if (!rootId) {
    return { nodes: [], edges: [] };
  }

  const visibleIds = new Set<string>([rootId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const node of nodes) {
      const data = node.data as IKnowledgePointDetail;
      if (data.parent_id && visibleIds.has(data.parent_id) && !visibleIds.has(node.id)) {
        visibleIds.add(node.id);
        changed = true;
      }
    }
  }

  return {
    nodes: nodes.filter((node) => visibleIds.has(node.id)),
    edges: edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
  };
}

export function KnowledgeManagementPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: identity } = useGetIdentity<{ id?: string; primary_org?: { role_name?: string } | null }>();
  const [majors, setMajors] = useState<IMajor[]>([]);
  const [directions, setDirections] = useState<IDirection[]>([]);
  const [selectedDirectionId, setSelectedDirectionId] = useState<string | null>(null);
  const [selectedRootKnowledgeId, setSelectedRootKnowledgeId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelInitial, setPanelInitial] = useState<Partial<IKnowledgePointDetail> & { directionId: string }>({
    directionId: "",
  });
  const [prereqModalOpen, setPrereqModalOpen] = useState(false);
  const [prereqTargetId, setPrereqTargetId] = useState<string | null>(null);
  const [formState, setFormState] = useState<StructureFormState>({
    open: false,
    kind: "major",
    mode: "create",
    name: "",
    description: "",
  });
  const [deleteState, setDeleteState] = useState<DeleteState>({ open: false });
  const [structureSaving, setStructureSaving] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [resourcesNodeId, setResourcesNodeId] = useState<string | null>(null);
  const [materialsByNode, setMaterialsByNode] = useState<Record<string, LearningMaterial[]>>({});
  const [relatedQuestions, setRelatedQuestions] = useState<IQuestion[]>([]);
  const [relatedQuestionsLoading, setRelatedQuestionsLoading] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [catalogPhotoDialogOpen, setCatalogPhotoDialogOpen] = useState(false);
  const roleName = identity?.primary_org?.role_name;
  const canManageSharedResources = roleName === "admin" || roleName === "platform_admin" || roleName === "school_admin";
  const isReadOnlySharedNode = useCallback(
    (node?: IKnowledgePointDetail | null) =>
      Boolean(
        node &&
          node.visibility === "platform" &&
          node.owner_id !== identity?.id &&
          !canManageSharedResources,
      ),
    [canManageSharedResources, identity?.id],
  );

  const notifyReadOnly = useCallback(
    (description: string) => {
      toast({
        title: "当前内容为公共只读",
        description,
        variant: "destructive",
      });
    },
    [toast],
  );

  useEffect(() => {
    const stored = localStorage.getItem("knowledge_materials_v1");
    if (stored) {
      try {
        setMaterialsByNode(JSON.parse(stored));
      } catch {
        setMaterialsByNode({});
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("knowledge_materials_v1", JSON.stringify(materialsByNode));
  }, [materialsByNode]);

  const getDirections = useCallback(
    (majorId: string) => directions.filter((direction) => direction.major_id === majorId),
    [directions],
  );

  const selectedDirection = useMemo(
    () => directions.find((direction) => direction.id === selectedDirectionId) ?? null,
    [directions, selectedDirectionId],
  );

  const rootKnowledgePoints = useMemo(
    () =>
      nodes
        .map((node) => node.data as IKnowledgePointDetail)
        .filter((node) => !node.parent_id)
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    [nodes],
  );

  const visibleFlow = useMemo(
    () => getKnowledgeSubtree(nodes, edges, selectedRootKnowledgeId),
    [edges, nodes, selectedRootKnowledgeId],
  );

  const getRootKnowledgePoints = useCallback(
    (directionId: string) => (directionId === selectedDirectionId ? rootKnowledgePoints : []),
    [rootKnowledgePoints, selectedDirectionId],
  );

  const refreshStructure = useCallback(async () => {
    const nextMajors = await apiFetch<IMajor[]>(`${API}/majors`);
    const directionGroups = await Promise.all(
      nextMajors.map(async (major) => apiFetch<IDirection[]>(`${API}/majors/${major.id}/directions`)),
    );
    const nextDirections = directionGroups.flat();
    setMajors(nextMajors);
    setDirections(nextDirections);
    setSelectedDirectionId((current) => {
      if (current && !nextDirections.some((direction) => direction.id === current)) {
        setNodes([]);
        setEdges([]);
        setTreeError(null);
        setSelectedRootKnowledgeId(null);
        return null;
      }
      return current;
    });
  }, []);

  useEffect(() => {
    void refreshStructure();
  }, [refreshStructure]);

  const loadTree = useCallback(async (directionId: string) => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const data = await apiFetch<IFlowData>(`${API}/directions/${directionId}/tree`);
      setNodes(data.nodes as unknown as Node[]);
      setEdges(data.edges as unknown as Edge[]);
      setSelectedRootKnowledgeId((current) => {
        if (!current) {
          return null;
        }
        return data.nodes.some((node) => node.id === current) ? current : null;
      });
      setSelectedNodeId((current) => (current && data.nodes.some((node) => node.id === current) ? current : null));
      setEditingNodeId((current) => (current && data.nodes.some((node) => node.id === current) ? current : null));
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : "加载失败");
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const handleSelectDirection = useCallback(
    (directionId: string) => {
      setSelectedDirectionId(directionId);
      setSelectedRootKnowledgeId(null);
      setSelectedNodeId(null);
      setEditingNodeId(null);
      void loadTree(directionId);
    },
    [loadTree],
  );

  const handleSelectRootKnowledge = useCallback(
    (directionId: string, knowledgeId: string) => {
      if (selectedDirectionId !== directionId) {
        setSelectedDirectionId(directionId);
        void loadTree(directionId);
      }
      setSelectedRootKnowledgeId(knowledgeId);
      setSelectedNodeId(knowledgeId);
      setEditingNodeId(null);
    },
    [loadTree, selectedDirectionId],
  );

  const handleCreateRootKnowledge = useCallback((direction: IDirection) => {
    setSelectedDirectionId(direction.id);
    setSelectedRootKnowledgeId(null);
    setSelectedNodeId(null);
    setEditingNodeId(null);
    setPanelInitial({ directionId: direction.id, parent_id: null });
    setPanelOpen(true);
    void loadTree(direction.id);
  }, [loadTree]);

  const handleImportKnowledgePaths = useCallback(
    async (paths: KnowledgeImportPath[]) => {
      if (!selectedDirectionId) {
        throw new Error("请先选择方向。");
      }

      const existingNodes = nodes.map((node) => node.data as IKnowledgePointDetail);
      const nodeIdByKey = new Map<string, string>();
      for (const node of existingNodes) {
        const key = `${node.parent_id ?? "root"}::${node.name.trim()}`;
        nodeIdByKey.set(key, node.id);
      }

      let createdCount = 0;

      for (const path of paths) {
        let parentId: string | null = null;
        for (const segment of path) {
          const name = segment.trim();
          if (!name) {
            continue;
          }
          const key = `${parentId ?? "root"}::${name}`;
          const existingId = nodeIdByKey.get(key);
          if (existingId) {
            parentId = existingId;
            continue;
          }

          const created: { id: string; name: string } = await apiFetch(`${API}/knowledge-points`, {
            method: "POST",
            body: JSON.stringify({
              direction_id: selectedDirectionId,
              parent_id: parentId,
              name,
            }),
          });
          nodeIdByKey.set(key, created.id);
          parentId = created.id;
          createdCount += 1;
        }
      }

      const focusRootName = getFirstKnowledgeImportRootName(paths);
      const focusRootId = focusRootName ? nodeIdByKey.get(`root::${focusRootName}`) ?? null : null;

      await loadTree(selectedDirectionId);
      if (focusRootId) {
        setSelectedRootKnowledgeId(focusRootId);
        setSelectedNodeId(focusRootId);
        setEditingNodeId(null);
      }
      toast({
        title: "知识库导入完成",
        description: createdCount > 0 ? `新增 ${createdCount} 个知识点。` : "导入内容已存在，没有重复创建。",
      });
    },
    [loadTree, nodes, selectedDirectionId, toast],
  );

  const handleRecognizeCatalogPhoto = useCallback(
    async (payload: { fileName: string; images: string[] }) => {
      const response = await apiFetch<{ paths: KnowledgeImportPath[] }>(`${API}/catalog-photo/recognize`, {
        method: "POST",
        body: JSON.stringify({
          file_name: payload.fileName,
          images: payload.images,
        }),
      });
      return response.paths;
    },
    [],
  );

  const handleCreateMajor = useCallback(async () => {
    setFormState({
      open: true,
      kind: "major",
      mode: "create",
      name: "",
      description: "",
    });
  }, []);

  const handleEditMajor = useCallback(
    (major: IMajor) => {
      setFormState({
        open: true,
        kind: "major",
        mode: "edit",
        id: major.id,
        name: major.name,
        description: major.description ?? "",
      });
    },
    [],
  );

  const handleDeleteMajor = useCallback(
    (major: IMajor) => {
      const majorDirections = directions.filter((direction) => direction.major_id === major.id);
      setDeleteState({
        open: true,
        kind: "major",
        id: major.id,
        name: major.name,
        description:
          majorDirections.length > 0
            ? `删除后会同时移除该专业下的 ${majorDirections.length} 个方向。`
            : "删除后该专业将不可恢复。",
      });
    },
    [directions],
  );

  const handleCreateDirection = useCallback(
    (major: IMajor) => {
      setFormState({
        open: true,
        kind: "direction",
        mode: "create",
        majorId: major.id,
        name: "",
        description: "",
      });
    },
    [],
  );

  const handleEditDirection = useCallback(
    (direction: IDirection) => {
      setFormState({
        open: true,
        kind: "direction",
        mode: "edit",
        id: direction.id,
        majorId: direction.major_id,
        name: direction.name,
        description: direction.description ?? "",
      });
    },
    [],
  );

  const handleDeleteDirection = useCallback(
    (direction: IDirection) => {
      const isCurrentDirection = selectedDirectionId === direction.id;
      const knowledgeCount = isCurrentDirection ? nodes.length : 0;
      setDeleteState({
        open: true,
        kind: "direction",
        id: direction.id,
        name: direction.name,
        description:
          knowledgeCount > 0
            ? `删除后该方向下的 ${knowledgeCount} 个知识点会一起移除，此操作不可恢复。`
            : "删除后该方向及其知识点树会一起移除，此操作不可恢复。",
        isCurrentDirection,
      });
    },
    [nodes.length, selectedDirectionId],
  );

  const handleAddChild = useCallback(
    (parentId: string) => {
      if (!selectedDirectionId) {
        return;
      }
      setPanelInitial({ directionId: selectedDirectionId, parent_id: parentId });
      setPanelOpen(true);
    },
    [selectedDirectionId],
  );

  const handleSetPrerequisite = useCallback((nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId)?.data as IKnowledgePointDetail | undefined;
    if (isReadOnlySharedNode(node)) {
      notifyReadOnly(getReadOnlyKnowledgeFeedback(node));
      return;
    }
    setPrereqTargetId(nodeId);
    setPrereqModalOpen(true);
  }, [isReadOnlySharedNode, nodes, notifyReadOnly]);

  const handlePrereqSelect = useCallback(
    async (fromId: string) => {
      if (!prereqTargetId) {
        return;
      }
      await apiFetch(`${API}/knowledge-points/${prereqTargetId}/prerequisites`, {
        method: "POST",
        body: JSON.stringify({ from_id: fromId }),
      });
      if (selectedDirectionId) {
        await loadTree(selectedDirectionId);
      }
    },
    [loadTree, prereqTargetId, selectedDirectionId],
  );

  const handleEdit = useCallback(
    (nodeId: string) => {
      const node = nodes.find((item) => item.id === nodeId);
      if (!node || !selectedDirectionId) {
        return;
      }
      if (isReadOnlySharedNode(node.data as unknown as IKnowledgePointDetail)) {
        notifyReadOnly(getReadOnlyKnowledgeFeedback(node.data as unknown as IKnowledgePointDetail));
        return;
      }
      setPanelInitial({
        ...(node.data as unknown as IKnowledgePointDetail),
        id: nodeId,
        directionId: selectedDirectionId,
      });
      setPanelOpen(true);
    },
    [isReadOnlySharedNode, nodes, notifyReadOnly, selectedDirectionId],
  );

  const handleDelete = useCallback(
    async (nodeId: string, name: string) => {
      const node = nodes.find((item) => item.id === nodeId)?.data as IKnowledgePointDetail | undefined;
      if (isReadOnlySharedNode(node)) {
        notifyReadOnly(getReadOnlyKnowledgeFeedback(node));
        return;
      }
      const childCount = nodes.filter((node) => (node.data as unknown as IKnowledgePointDetail).parent_id === nodeId).length;
      setDeleteState({
        open: true,
        kind: "knowledge-point",
        id: nodeId,
        name,
        description:
          childCount > 0 ? `删除后会同时移除 ${childCount} 个子知识点。` : "删除后该知识点将不可恢复。",
      });
    },
    [isReadOnlySharedNode, nodes, notifyReadOnly],
  );

  const getKnowledgeNode = useCallback(
    (nodeId: string) => nodes.find((node) => node.id === nodeId)?.data as IKnowledgePointDetail | undefined,
    [nodes],
  );

  const getNextAutoName = useCallback(
    (parentId: string | null, prefix: string) => {
      const siblings = nodes.filter((node) => {
        const data = node.data as IKnowledgePointDetail;
        return (data.parent_id ?? null) === parentId;
      });
      let index = 1;
      const existingNames = new Set(siblings.map((node) => ((node.data as IKnowledgePointDetail).name ?? "").toLowerCase()));
      while (existingNames.has(`${prefix}-${index}`.toLowerCase())) {
        index += 1;
      }
      return `${prefix}-${index}`;
    },
    [nodes],
  );

  const createKnowledgePoint = useCallback(
    async (payload: { parent_id: string | null; name: string }) => {
      if (!selectedDirectionId) {
        return;
      }
      const created = await apiFetch<{ id: string }>(`${API}/knowledge-points`, {
        method: "POST",
        body: JSON.stringify({
          direction_id: selectedDirectionId,
          parent_id: payload.parent_id,
          name: payload.name,
          description: null,
          tags: [],
          difficulty: null,
        }),
      });
      if (!payload.parent_id) {
        setSelectedRootKnowledgeId(created.id);
      }
      await loadTree(selectedDirectionId);
    },
    [loadTree, selectedDirectionId],
  );

  const handleStartRename = useCallback(
    (nodeId: string) => {
      const node = getKnowledgeNode(nodeId);
      if (!node) {
        return;
      }
      if (isReadOnlySharedNode(node)) {
        notifyReadOnly(getReadOnlyKnowledgeFeedback(node));
        return;
      }
      setSelectedNodeId(nodeId);
      setEditingNodeId(nodeId);
      setRenameDraft(node.name);
    },
    [getKnowledgeNode, isReadOnlySharedNode, notifyReadOnly],
  );

  const handleRenameSubmit = useCallback(async () => {
    if (!editingNodeId) {
      return;
    }
    const nextName = renameDraft.trim();
    if (!nextName) {
      setEditingNodeId(null);
      return;
    }
    if (isReadOnlySharedNode(getKnowledgeNode(editingNodeId))) {
      setEditingNodeId(null);
      notifyReadOnly(getReadOnlyKnowledgeFeedback(getKnowledgeNode(editingNodeId)));
      return;
    }
    await apiFetch(`${API}/knowledge-points/${editingNodeId}`, {
      method: "PUT",
      body: JSON.stringify({ name: nextName }),
    });
    setEditingNodeId(null);
    if (selectedDirectionId) {
      await loadTree(selectedDirectionId);
    }
  }, [editingNodeId, getKnowledgeNode, isReadOnlySharedNode, loadTree, notifyReadOnly, renameDraft, selectedDirectionId]);

  const handleRenameCancel = useCallback(() => {
    setEditingNodeId(null);
    setRenameDraft("");
  }, []);

  const resourcesNode = resourcesNodeId ? getKnowledgeNode(resourcesNodeId) ?? null : null;
  const resourcesDirection = resourcesNode?.direction_id
    ? directions.find((direction) => direction.id === resourcesNode.direction_id) ?? null
    : null;
  const resourcesMajor = resourcesDirection
    ? majors.find((major) => major.id === resourcesDirection.major_id) ?? null
    : null;
  const currentMaterials = resourcesNodeId ? materialsByNode[resourcesNodeId] ?? [] : [];

  useEffect(() => {
    if (!resourcesNodeId) {
      setRelatedQuestions([]);
      setRelatedQuestionsLoading(false);
      return;
    }

    let cancelled = false;

    const loadRelatedQuestions = async () => {
      setRelatedQuestionsLoading(true);
      try {
        const items = await apiFetch<IQuestion[]>(
          `/api/questions?knowledge_point_id=${resourcesNodeId}&_start=0&_end=20&_sort=updated_at&_order=DESC`,
        );
        if (!cancelled) {
          setRelatedQuestions(items);
        }
      } catch {
        if (!cancelled) {
          setRelatedQuestions([]);
        }
      } finally {
        if (!cancelled) {
          setRelatedQuestionsLoading(false);
        }
      }
    };

    void loadRelatedQuestions();

    return () => {
      cancelled = true;
    };
  }, [resourcesNodeId]);

  const addMaterial = useCallback(
    (payload: Omit<LearningMaterial, "id">) => {
      if (!resourcesNodeId) {
        return;
      }
      setMaterialsByNode((current) => ({
        ...current,
        [resourcesNodeId]: [
          ...(current[resourcesNodeId] ?? []),
          { ...payload, id: createRandomId() },
        ],
      }));
    },
    [resourcesNodeId],
  );

  const deleteMaterial = useCallback(
    (materialId: string) => {
      if (!resourcesNodeId) {
        return;
      }
      setMaterialsByNode((current) => ({
        ...current,
        [resourcesNodeId]: (current[resourcesNodeId] ?? []).filter((item) => item.id !== materialId),
      }));
    },
    [resourcesNodeId],
  );

  const generateRecommendations = useCallback(
    async (nodeId: string, model: AIRecommendationModel): Promise<IRecommendationItem[]> => {
      const response = await apiFetch<{ model: AIRecommendationModel; items: IRecommendationItem[] }>(
        `${API}/knowledge-points/${nodeId}/recommendations/generate`,
        {
          method: "POST",
          body: JSON.stringify({ model }),
        },
      );
      return response.items;
    },
    [],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!selectedNodeId || editingNodeId) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }

      const currentNode = getKnowledgeNode(selectedNodeId);
      if (!currentNode) {
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        void createKnowledgePoint({
          parent_id: selectedNodeId,
          name: getNextAutoName(selectedNodeId, "child"),
        });
      }

      if (event.key === "Enter" && currentNode.parent_id) {
        event.preventDefault();
        void createKnowledgePoint({
          parent_id: currentNode.parent_id,
          name: getNextAutoName(currentNode.parent_id, "sibling"),
        });
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [createKnowledgePoint, editingNodeId, getKnowledgeNode, getNextAutoName, selectedNodeId]);

  const closeForm = useCallback(() => {
    setFormState((current) => ({ ...current, open: false }));
    setFeedbackMessage(null);
  }, []);

  const submitStructureForm = useCallback(async () => {
    if (!formState.name.trim()) {
      setFeedbackMessage(formState.kind === "major" ? "请输入专业名称" : "请输入方向名称");
      return;
    }

    setStructureSaving(true);
    setFeedbackMessage(null);
    try {
      if (formState.kind === "major") {
        if (formState.mode === "create") {
          await apiFetch(`${API}/majors`, {
            method: "POST",
            body: JSON.stringify({
              name: formState.name.trim(),
              description: formState.description.trim() || null,
            }),
          });
        } else {
          await apiFetch(`${API}/majors/${formState.id}`, {
            method: "PUT",
            body: JSON.stringify({
              name: formState.name.trim(),
              description: formState.description.trim() || null,
            }),
          });
        }
        await refreshStructure();
        closeForm();
        return;
      }

      if (!formState.majorId) {
        setFeedbackMessage("缺少所属专业");
        return;
      }

      if (formState.mode === "create") {
        const created = await apiFetch<IDirection>(`${API}/directions`, {
          method: "POST",
          body: JSON.stringify({
            major_id: formState.majorId,
            name: formState.name.trim(),
            description: formState.description.trim() || null,
          }),
        });
        await refreshStructure();
        setSelectedDirectionId(created.id);
        setSelectedRootKnowledgeId(null);
        await loadTree(created.id);
      } else {
        await apiFetch(`${API}/directions/${formState.id}`, {
          method: "PUT",
          body: JSON.stringify({
            major_id: formState.majorId,
            name: formState.name.trim(),
            description: formState.description.trim() || null,
          }),
        });
        await refreshStructure();
      }
      closeForm();
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setStructureSaving(false);
    }
  }, [closeForm, formState, loadTree, refreshStructure]);

  const confirmDelete = useCallback(async () => {
    if (!deleteState.open) {
      return;
    }

    setDeleteSubmitting(true);
    setFeedbackMessage(null);
    try {
      if (deleteState.kind === "major") {
        await apiFetch(`${API}/majors/${deleteState.id}`, { method: "DELETE" });
        await refreshStructure();
      } else if (deleteState.kind === "direction") {
        await apiFetch(`${API}/directions/${deleteState.id}`, { method: "DELETE" });
        if (deleteState.isCurrentDirection) {
          setSelectedDirectionId(null);
          setSelectedRootKnowledgeId(null);
          setNodes([]);
          setEdges([]);
          setTreeError(null);
        }
        await refreshStructure();
      } else {
        await apiFetch(`${API}/knowledge-points/${deleteState.id}`, { method: "DELETE" });
        if (selectedDirectionId) {
          await loadTree(selectedDirectionId);
        }
      }
      setDeleteState({ open: false });
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setDeleteSubmitting(false);
    }
  }, [deleteState, loadTree, refreshStructure, selectedDirectionId]);

  const handleSave = useCallback(
    async (data: Partial<IKnowledgePointDetail>) => {
      if (panelInitial.id) {
        if (isReadOnlySharedNode(panelInitial as IKnowledgePointDetail)) {
          setFeedbackMessage(getReadOnlyKnowledgeFeedback(panelInitial as IKnowledgePointDetail));
          return;
        }
        await apiFetch(`${API}/knowledge-points/${panelInitial.id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        });
      } else {
        const created = await apiFetch<{ id: string }>(`${API}/knowledge-points`, {
          method: "POST",
          body: JSON.stringify({
            ...data,
            direction_id: panelInitial.directionId,
            parent_id: panelInitial.parent_id ?? null,
          }),
        });
        if (!panelInitial.parent_id) {
          setSelectedRootKnowledgeId(created.id);
          setSelectedNodeId(created.id);
        }
      }
      if (selectedDirectionId) {
        await loadTree(selectedDirectionId);
      }
    },
    [isReadOnlySharedNode, loadTree, panelInitial, selectedDirectionId],
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      <MajorDirectionSidebar
        getDirections={getDirections}
        getRootKnowledgePoints={getRootKnowledgePoints}
        majors={majors}
        onCreateDirection={handleCreateDirection}
        onCreateMajor={handleCreateMajor}
        onCreateRootKnowledge={handleCreateRootKnowledge}
        onDeleteDirection={handleDeleteDirection}
        onDeleteMajor={handleDeleteMajor}
        onDeleteRootKnowledge={(knowledge) => void handleDelete(knowledge.id, knowledge.name)}
        onEditDirection={handleEditDirection}
        onEditMajor={handleEditMajor}
        onEditRootKnowledge={(knowledge) => handleEdit(knowledge.id)}
        onSelect={handleSelectDirection}
        onSelectRootKnowledge={handleSelectRootKnowledge}
        selectedDirectionId={selectedDirectionId}
        selectedRootKnowledgeId={selectedRootKnowledgeId}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-300/80 px-5 py-4 dark:border-stone-800">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400">
              知识结构
            </p>
            <h1 className="mt-1 text-base font-semibold text-stone-900 dark:text-stone-100">知识点管理</h1>
          </div>
          {selectedDirectionId && (
            <div className="flex items-center gap-2">
              <Button onClick={() => setImportDialogOpen(true)} size="sm" type="button" variant="outline">
                导入知识库
              </Button>
              <Button onClick={() => setCatalogPhotoDialogOpen(true)} size="sm" type="button" variant="outline">
                书籍目录拍照导入
              </Button>
              <Button
                className="rounded-full"
                onClick={() => {
                  setPanelInitial({
                    directionId: selectedDirectionId,
                    parent_id: selectedRootKnowledgeId,
                  });
                  setPanelOpen(true);
                }}
                size="sm"
                type="button"
              >
                {selectedRootKnowledgeId ? "+ 添加子知识" : "+ 添加主知识/技能"}
              </Button>
            </div>
          )}
        </div>

        {!selectedDirectionId && (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-sm text-center">
              <p className="text-xs uppercase tracking-[0.22em] text-stone-400 dark:text-stone-500">等待选择</p>
              <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
                先在左侧选中一个方向，再开始绘制它的知识结构和前置依赖。
              </p>
            </div>
          </div>
        )}

        {selectedDirectionId && treeLoading && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">加载中…</div>
        )}

        {selectedDirectionId && treeError && !treeLoading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <p className="text-sm text-muted-foreground">{treeError}</p>
            <Button
              onClick={() => void loadTree(selectedDirectionId)}
              size="sm"
              variant="outline"
              type="button"
            >
              重试
            </Button>
          </div>
        )}

        {selectedDirectionId && !treeLoading && !treeError && !selectedRootKnowledgeId && (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-md text-center">
              <p className="text-xs uppercase tracking-[0.22em] text-stone-400 dark:text-stone-500">
                主知识/技能
              </p>
              <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
                {rootKnowledgePoints.length > 0
                  ? "在左侧选择一个主知识/技能后，右侧会展示它下面的子知识结构。"
                  : "当前方向还没有主知识/技能，先创建一个主知识/技能，再维护它的子知识。"}
              </p>
              <p className="mt-3 flex flex-wrap items-center justify-center gap-1 text-xs text-stone-500 dark:text-stone-400">
                <span>也可以直接</span>
                <button
                  type="button"
                  className="font-medium text-primary transition-colors hover:underline"
                  onClick={() => setImportDialogOpen(true)}
                >
                  导入知识点
                </button>
                <span>或从书本中的</span>
                <button
                  type="button"
                  className="font-medium text-primary transition-colors hover:underline"
                  onClick={() => setCatalogPhotoDialogOpen(true)}
                >
                  目录拍照导入
                </button>
                <span>。</span>
              </p>
              <Button
                className="mt-5 rounded-full"
                onClick={() => {
                  setPanelInitial({ directionId: selectedDirectionId, parent_id: null });
                  setPanelOpen(true);
                }}
                size="sm"
                type="button"
              >
                + 添加主知识/技能
              </Button>
            </div>
          </div>
        )}

        {selectedDirectionId && !treeLoading && !treeError && selectedRootKnowledgeId && (
          <KnowledgeTreeCanvas
            editingNodeId={editingNodeId}
            initialEdges={visibleFlow.edges}
            initialNodes={visibleFlow.nodes}
            onAddChild={handleAddChild}
            onDelete={handleDelete}
            onEdit={handleEdit}
            onRenameCancel={handleRenameCancel}
            onRenameDraftChange={setRenameDraft}
            onRenameSubmit={() => void handleRenameSubmit()}
            onSelectNode={setSelectedNodeId}
            onSetPrerequisite={handleSetPrerequisite}
            onStartRename={handleStartRename}
            onViewResources={setResourcesNodeId}
            renameDraft={renameDraft}
            selectedNodeId={selectedNodeId}
          />
        )}
      </div>

      <NodeDetailPanel
        initial={panelInitial}
        onClose={() => setPanelOpen(false)}
        onSave={handleSave}
        open={panelOpen}
      />

      <KnowledgeImportDialog
        onImport={handleImportKnowledgePaths}
        onOpenChange={setImportDialogOpen}
        open={importDialogOpen}
        selectedDirectionName={selectedDirection?.name ?? null}
      />

      <KnowledgeCatalogPhotoDialog
        onImport={handleImportKnowledgePaths}
        onOpenChange={setCatalogPhotoDialogOpen}
        onRecognize={handleRecognizeCatalogPhoto}
        open={catalogPhotoDialogOpen}
        selectedDirectionName={selectedDirection?.name ?? null}
      />

      <PrerequisiteSelectModal
        allNodes={nodes as unknown as Array<{ id: string; data: IKnowledgePointDetail }>}
        onClose={() => setPrereqModalOpen(false)}
        onSelect={handlePrereqSelect}
        open={prereqModalOpen}
        targetNodeId={prereqTargetId ?? ""}
      />

      <RelatedResourcesDialog
        direction={resourcesDirection}
        major={resourcesMajor}
        materials={currentMaterials}
        node={resourcesNode}
        relatedQuestions={relatedQuestions}
        relatedQuestionsLoading={relatedQuestionsLoading}
        onAddMaterial={addMaterial}
        onClose={() => setResourcesNodeId(null)}
        onDeleteMaterial={deleteMaterial}
        onGenerateRecommendations={generateRecommendations}
        onViewQuestions={(id) => navigate(`/questions?knowledge_point_id=${id}`)}
        open={Boolean(resourcesNodeId)}
      />

      <Dialog open={formState.open} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {formState.kind === "major"
                ? formState.mode === "create"
                  ? "新建专业"
                  : "编辑专业"
                : formState.mode === "create"
                  ? "新建方向"
                  : "编辑方向"}
            </DialogTitle>
            <DialogDescription>
              {formState.kind === "major" ? "设置专业名称与说明。" : "设置方向名称与说明。"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="structure-name">名称</Label>
              <Input
                id="structure-name"
                value={formState.name}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="structure-description">说明</Label>
              <Textarea
                id="structure-description"
                rows={4}
                value={formState.description}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </div>
            {feedbackMessage && <p className="text-sm text-destructive">{feedbackMessage}</p>}
          </div>

          <DialogFooter>
            <Button onClick={closeForm} variant="outline" type="button">
              取消
            </Button>
            <Button disabled={structureSaving} onClick={() => void submitStructureForm()} type="button">
              {structureSaving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteState.open} onOpenChange={(open) => !open && setDeleteState({ open: false })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteState.open ? `确定删除「${deleteState.name}」吗？` : "确认删除"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteState.open ? deleteState.description : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {feedbackMessage && <p className="text-sm text-destructive">{feedbackMessage}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSubmitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteSubmitting}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deleteSubmitting ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

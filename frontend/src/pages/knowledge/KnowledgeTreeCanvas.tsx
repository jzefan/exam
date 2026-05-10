import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { NODE_COLLAPSE_TOGGLE_SELECTOR } from "@/components/graph/node-collapse-toggle";
import { KnowledgeNode } from "./KnowledgeNode";
import { PrerequisiteEdge } from "./PrerequisiteEdge";
import {
  buildKnowledgeChildCountMap,
  getAnchoredViewport,
  layoutVisibleKnowledgeTree,
  toggleKnowledgeNodeCollapse,
} from "./knowledge-tree-visibility";
import type { IKnowledgePointDetail } from "./types";

const nodeTypes = { knowledgeNode: KnowledgeNode };
const edgeTypes = { prerequisite: PrerequisiteEdge };

function getFitViewSettings(nodes: Node[]) {
  const nodeCount = nodes.length;
  const xPositions = nodes.map((node) => node.position.x);
  const horizontalSpan = xPositions.length > 0 ? Math.max(...xPositions) - Math.min(...xPositions) : 0;
  const depthCount = Math.max(1, Math.round(horizontalSpan / 280) + 1);

  if (nodeCount <= 1) {
    return { minZoom: 1, maxZoom: 1.25, padding: 0.42 };
  }

  if (nodeCount <= 6) {
    return { minZoom: 0.82, maxZoom: 1.18, padding: 0.34 };
  }

  if (nodeCount <= 10) {
    return { minZoom: 0.72, maxZoom: 1.08, padding: 0.28 };
  }

  if (nodeCount <= 18) {
    return {
      minZoom: depthCount >= 4 ? 0.64 : 0.7,
      maxZoom: 0.98,
      padding: 0.2,
    };
  }

  return {
    minZoom: depthCount >= 5 ? 0.56 : 0.62,
    maxZoom: 0.9,
    padding: 0.16,
  };
}

interface Props {
  initialNodes: Node[];
  initialEdges: Edge[];
  onAddChild: (parentId: string) => void;
  onSetPrerequisite: (nodeId: string) => void;
  onEdit: (nodeId: string) => void;
  onViewResources: (nodeId: string) => void;
  onCloseResources: () => void;
  onDelete: (nodeId: string, name: string) => void;
  selectedNodeId: string | null;
  editingNodeId: string | null;
  renameDraft: string;
  onSelectNode: (nodeId: string | null) => void;
  onStartRename: (nodeId: string) => void;
  onRenameDraftChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
}

export function KnowledgeTreeCanvas({
  initialNodes,
  initialEdges,
  onAddChild,
  onSetPrerequisite,
  onEdit,
  onViewResources,
  onCloseResources,
  onDelete,
  selectedNodeId,
  editingNodeId,
  renameDraft,
  onSelectNode,
  onStartRename,
  onRenameDraftChange,
  onRenameSubmit,
  onRenameCancel,
}: Props) {
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const rootNodeId = useMemo(
    () => initialNodes.find((node) => !(node.data as IKnowledgePointDetail).parent_id)?.id ?? null,
    [initialNodes],
  );
  const childCountById = useMemo(() => buildKnowledgeChildCountMap(initialNodes), [initialNodes]);
  const resourceEligibleNodeIds = useMemo(() => {
    const eligibleIds = new Set<string>();
    if (!rootNodeId) {
      return eligibleIds;
    }
    eligibleIds.add(rootNodeId);
    for (const node of initialNodes) {
      const data = node.data as IKnowledgePointDetail;
      if (data.parent_id === rootNodeId) {
        eligibleIds.add(node.id);
      }
    }
    return eligibleIds;
  }, [initialNodes, rootNodeId]);
  const visibleGraph = useMemo(
    () => layoutVisibleKnowledgeTree(initialNodes, initialEdges, rootNodeId, collapsedNodeIds),
    [collapsedNodeIds, initialEdges, initialNodes, rootNodeId],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(visibleGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(visibleGraph.edges);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const pendingViewportRef = useRef<ReturnType<typeof getAnchoredViewport> | null>(null);

  useLayoutEffect(() => {
    const incomingTargets = new Set(visibleGraph.edges.map((edge) => edge.target));
    const outgoingSources = new Set(visibleGraph.edges.map((edge) => edge.source));
    setNodes(
      visibleGraph.nodes.map((node) => ({
        ...node,
        data: {
          ...(node.data as Record<string, unknown>),
          hasIncomingEdge: incomingTargets.has(node.id),
          hasOutgoingEdge: outgoingSources.has(node.id),
          hasChildren: (childCountById.get(node.id) ?? 0) > 0,
          childCount: childCountById.get(node.id) ?? 0,
          collapsed: collapsedNodeIds.has(node.id),
          canViewResources: resourceEligibleNodeIds.has(node.id),
          isSelected: selectedNodeId === node.id,
          isEditing: editingNodeId === node.id,
          renameDraft: editingNodeId === node.id ? renameDraft : "",
          onAddChild,
          onSetPrerequisite,
          onEdit,
          onDelete,
          onRenameDraftChange,
          onRenameSubmit,
          onRenameCancel,
        },
      })),
    );
    setEdges(visibleGraph.edges);
    if (flowInstance && pendingViewportRef.current) {
      flowInstance.setViewport(pendingViewportRef.current);
      pendingViewportRef.current = null;
    }
  }, [
    childCountById,
    collapsedNodeIds,
    editingNodeId,
    onAddChild,
    onDelete,
    onEdit,
    onCloseResources,
    onRenameCancel,
    onRenameDraftChange,
    onRenameSubmit,
    onSetPrerequisite,
    onViewResources,
    resourceEligibleNodeIds,
    renameDraft,
    selectedNodeId,
    setNodes,
    setEdges,
    flowInstance,
    visibleGraph.edges,
    visibleGraph.nodes,
  ]);

  useEffect(() => {
    const visibleNodeIds = new Set(initialNodes.map((node) => node.id));
    setCollapsedNodeIds((current) => {
      const next = new Set([...current].filter((nodeId) => visibleNodeIds.has(nodeId)));
      return next.size === current.size ? current : next;
    });
  }, [initialNodes]);

  useEffect(() => {
    if (!flowInstance || initialNodes.length === 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const settings = getFitViewSettings(initialNodes);
      void flowInstance.fitView({
        duration: 320,
        ...settings,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [flowInstance, initialNodes]);

  const handleNodeClick: NodeMouseHandler = (event, node) => {
    const target = event.target as HTMLElement;
    if (target.closest(NODE_COLLAPSE_TOGGLE_SELECTOR)) {
      const nextCollapsedNodeIds = toggleKnowledgeNodeCollapse(collapsedNodeIds, node.id);
      const anchorBefore = node.position;
      const anchorAfter = layoutVisibleKnowledgeTree(
        initialNodes,
        initialEdges,
        rootNodeId,
        nextCollapsedNodeIds,
      ).nodes.find((item) => item.id === node.id)?.position;

      if (flowInstance && anchorAfter) {
        pendingViewportRef.current = getAnchoredViewport(
          flowInstance.getViewport(),
          anchorBefore,
          anchorAfter,
        );
      }
      setCollapsedNodeIds(nextCollapsedNodeIds);
      return;
    }
    onSelectNode(node.id);
    if (resourceEligibleNodeIds.has(node.id)) {
      onViewResources(node.id);
    } else {
      onCloseResources();
    }
  };

  const handleNodeDoubleClick: NodeMouseHandler = (_, node) => {
    if (selectedNodeId === node.id) {
      onStartRename(node.id);
    }
  };

  return (
    <div className="relative flex-1">
      <svg style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <marker id="prereq-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="hsl(var(--primary))" />
          </marker>
        </defs>
      </svg>

      <ReactFlow
        edges={edges}
        edgeTypes={edgeTypes}
        fitView
        maxZoom={2}
        minZoom={0.3}
        nodeTypes={nodeTypes}
        nodes={nodes}
        onInit={setFlowInstance}
        onPaneClick={() => {
          onSelectNode(null);
          onCloseResources();
        }}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
      >
        <Background color="hsl(var(--primary) / 0.16)" gap={22} />
        <Controls />
      </ReactFlow>
    </div>
  );
}

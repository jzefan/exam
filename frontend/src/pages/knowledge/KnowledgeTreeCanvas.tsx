import { useEffect } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { KnowledgeNode } from "./KnowledgeNode";
import { PrerequisiteEdge } from "./PrerequisiteEdge";

const nodeTypes = { knowledgeNode: KnowledgeNode };
const edgeTypes = { prerequisite: PrerequisiteEdge };

interface Props {
  initialNodes: Node[];
  initialEdges: Edge[];
  onAddChild: (parentId: string) => void;
  onSetPrerequisite: (nodeId: string) => void;
  onEdit: (nodeId: string) => void;
  onViewResources: (nodeId: string) => void;
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
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    const incomingTargets = new Set(initialEdges.map((edge) => edge.target));
    const outgoingSources = new Set(initialEdges.map((edge) => edge.source));
    setNodes(
      initialNodes.map((node) => ({
        ...node,
        data: {
          ...(node.data as Record<string, unknown>),
          hasIncomingEdge: incomingTargets.has(node.id),
          hasOutgoingEdge: outgoingSources.has(node.id),
          isSelected: selectedNodeId === node.id,
          isEditing: editingNodeId === node.id,
          renameDraft: editingNodeId === node.id ? renameDraft : "",
          onAddChild,
          onSetPrerequisite,
          onEdit,
          onViewResources,
          onDelete,
          onRenameDraftChange,
          onRenameSubmit,
          onRenameCancel,
        },
      })),
    );
  }, [editingNodeId, initialEdges, initialNodes, onAddChild, onDelete, onEdit, onRenameCancel, onRenameDraftChange, onRenameSubmit, onSetPrerequisite, onViewResources, renameDraft, selectedNodeId, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const handleNodeClick: NodeMouseHandler = (_, node) => {
    onSelectNode(node.id);
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
        onPaneClick={() => onSelectNode(null)}
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

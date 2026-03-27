import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

export function PrerequisiteEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: "hsl(var(--primary))", strokeDasharray: "5 3", strokeWidth: 1.5, opacity: 0.78 }}
        markerEnd="url(#prereq-arrow)"
      />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          className="pointer-events-none absolute rounded bg-background/95 px-1 text-[9px] text-primary shadow-sm"
        >
          前置
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

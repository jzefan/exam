import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { IKnowledgePointDetail } from "./types";

interface Props {
  open: boolean;
  targetNodeId: string;
  allNodes: Array<{ id: string; data: IKnowledgePointDetail }>;
  onSelect: (fromId: string) => Promise<void>;
  onClose: () => void;
}

export function PrerequisiteSelectModal({ open, targetNodeId, allNodes, onSelect, onClose }: Props) {
  const candidates = allNodes.filter((node) => node.id !== targetNodeId);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>选择前置知识点</DialogTitle>
          <DialogDescription>从当前方向的其他知识点中选择一个作为前置依赖。</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {candidates.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">该方向暂无其他知识点</p>
          )}
          {candidates.map((node) => (
            <Button
              key={node.id}
              className="h-auto w-full justify-start rounded-lg px-3 py-2 text-left text-sm"
              onClick={async () => {
                await onSelect(node.id);
                onClose();
              }}
              type="button"
              variant="ghost"
            >
              <span>{node.data.name}</span>
              {node.data.difficulty && <span className="ml-2 text-xs text-muted-foreground">{node.data.difficulty}</span>}
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

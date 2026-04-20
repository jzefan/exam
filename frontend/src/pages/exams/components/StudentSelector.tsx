import { ClassStudentSelector } from "./ClassStudentSelector";

export function StudentSelector({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  return <ClassStudentSelector selectedIds={selectedIds} onChange={onChange} />;
}

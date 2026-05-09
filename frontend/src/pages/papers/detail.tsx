import { useParams } from "react-router-dom";

export function PaperDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
      <h1 className="text-xl font-semibold text-foreground">试卷详情</h1>
      <div className="rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
        试卷 {id} 详情页面开发中。
      </div>
    </div>
  );
}

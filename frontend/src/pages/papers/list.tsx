import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";

export function PaperListPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">试卷列表</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/exams/create")}>
            新建试卷
          </Button>
          <Button onClick={() => navigate("/papers/import")}>导入试卷</Button>
        </div>
      </div>
      <div className="rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
        试卷列表页面开发中。
      </div>
    </div>
  );
}

import { useNavigate } from "react-router-dom";
import { FilePlus2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageIntroHeader } from "@/components/ui/page-intro-header";

import { PaperListBody } from "./PaperListBody";

export function PaperListPage() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <PageIntroHeader
        title="试卷列表"
        description="统一管理手工与导入试卷，并支持复用出新卷"
        actions={
          <>
            <Button variant="outline" className="h-9 w-fit shrink-0 px-4 font-medium" onClick={() => navigate("/exams/create")}>
              <FilePlus2 className="mr-1.5 h-4 w-4" />
              新建试卷
            </Button>
            <Button className="h-9 w-fit shrink-0 px-4 font-medium" onClick={() => navigate("/papers/import")}>导入试卷</Button>
          </>
        }
      />

      <div className="mx-auto max-w-[1200px]">
        <PaperListBody />
      </div>
    </div>
  );
}

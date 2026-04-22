import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

export type ViewSettingsValues = {
  max_switch_count: number;
  show_result: boolean;
  allow_retake: boolean;
};

export function ExamSettingsPanel({
  category,
  values,
  onChange,
  onSave,
  dirty,
  saving,
}: {
  category: "exam" | "practice";
  values: ViewSettingsValues;
  onChange: (next: ViewSettingsValues) => void;
  onSave: () => void;
  dirty: boolean;
  saving: boolean;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">考试设置</h3>
        <p className="text-xs text-muted-foreground">这里适合做轻量调整，结构性修改仍建议回到完整修改流程。</p>
      </div>

      <div className="space-y-4 rounded-2xl border border-border/60 bg-background/80 p-4">
        {category === "exam" ? (
          <div className="space-y-2">
            <Label htmlFor="view-max-switch-count">允许切屏次数</Label>
            <Input
              id="view-max-switch-count"
              type="number"
              min={0}
              value={values.max_switch_count}
              onChange={(event) =>
                onChange({
                  ...values,
                  max_switch_count: Number(event.target.value || 0),
                })
              }
            />
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">允许查看考试结果</p>
            <p className="text-xs text-muted-foreground">学生提交后是否可以查看成绩与结果信息。</p>
          </div>
          <Switch
            checked={values.show_result}
            onCheckedChange={(checked) =>
              onChange({
                ...values,
                show_result: checked,
              })
            }
          />
        </div>

        {category === "exam" ? (
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">允许已提交学生在考试期间重考</p>
              <p className="text-xs text-muted-foreground">开启后，学生提交后只要考试未结束，仍可再次开始新的作答。</p>
            </div>
            <Switch
              checked={values.allow_retake}
              onCheckedChange={(checked) =>
                onChange({
                  ...values,
                  allow_retake: checked,
                })
              }
            />
          </div>
        ) : null}
      </div>

      <Button className="w-full" disabled={!dirty || saving} onClick={onSave}>
        {saving ? "保存中..." : "保存设置"}
      </Button>
    </section>
  );
}

import { useId, useState, useRef, useEffect } from "react";
import { Search, Check, Upload, Plus, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/pages/grading/api";
import {
  buildStudentBatchImportItems,
  parseStudentImportFile,
  type StudentImportClassOption,
} from "@/components/students/student-import-utils";
import type { IUser } from "@/types";

type Mode = "select" | "import" | "manual";
type ManualFeedbackTone = "default" | "destructive" | "success";

type ClassItem = StudentImportClassOption;

interface StudentRecord extends IUser {
  phone?: string | null;
  student_id?: string | null;
  class_id?: string | null;
  class_name?: string | null;
}

interface ImportResult {
  success_count: number;
  failed_count: number;
  errors: string[];
}

export function StudentSelector({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [mode, setMode] = useState<Mode>("select");
  const [search, setSearch] = useState("");
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>("__all__");
  const [users, setUsers] = useState<StudentRecord[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isManualSubmitting, setIsManualSubmitting] = useState(false);
  const [manualForm, setManualForm] = useState({
    full_name: "",
    phone: "",
    student_id: "",
    class_name: "",
  });
  const [importResults, setImportResults] = useState<string[]>([]);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [manualFeedback, setManualFeedback] = useState<string | null>(null);
  const [manualFeedbackTone, setManualFeedbackTone] = useState<ManualFeedbackTone>("default");
  const [matchedManualStudentId, setMatchedManualStudentId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const modeId = useId();

  const selectedSet = new Set(selectedIds);

  const resetManualForm = () => {
    setManualForm({
      full_name: "",
      phone: "",
      student_id: "",
      class_name: "",
    });
    setMatchedManualStudentId(null);
  };

  const setManualMessage = (message: string, tone: ManualFeedbackTone) => {
    setManualFeedback(message);
    setManualFeedbackTone(tone);
  };

  const normalizeValue = (value: string) => value.trim().toLowerCase();
  const loadStudentData = async (applyState = true) => {
    const [studentData, classData] = await Promise.all([
      apiRequest<StudentRecord[]>("/rbac/students"),
      apiRequest<ClassItem[]>("/rbac/students/classes"),
    ]);

    if (applyState) {
      setUsers(studentData);
      setClasses(classData);
    }

    return { studentData, classData };
  };

  // Load students/classes via specialized endpoints
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    void loadStudentData(isMounted)
      .catch((err) => {
        console.error("StudentSelector fetch error:", err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => { isMounted = false; };
  }, []);

  const normalizedSearch = search.trim().toLowerCase();
  const classFilteredUsers =
    selectedClassFilter === "__all__"
      ? users
      : selectedClassFilter === "__unassigned__"
        ? users.filter((user) => !user.class_id)
        : users.filter((user) => user.class_id === selectedClassFilter);
  const hasMatchingClass = classes.some(
    (item) => normalizeValue(item.name) === normalizeValue(manualForm.class_name),
  );
  const manualClassSelectValue = hasMatchingClass ? manualForm.class_name : "__custom__";
  const visibleUsers = normalizedSearch
    ? classFilteredUsers.filter((u) => {
        const username = u.username.toLowerCase();
        const fullName = u.full_name.toLowerCase();
        return username.includes(normalizedSearch) || fullName.includes(normalizedSearch);
      })
    : classFilteredUsers;
  const visibleUserIds = visibleUsers.map((user) => user.id);
  const allVisibleSelected =
    visibleUserIds.length > 0 && visibleUserIds.every((id) => selectedSet.has(id));
  const selectedStudentSummary = selectedIds
    .map((id) => {
      const user = users.find((item) => item.id === id);
      return user?.full_name ?? user?.username ?? id.slice(0, 8);
    })
    .join("、");
  const unassignedCount = users.filter((user) => !user.class_id).length;

  useEffect(() => {
    const fullName = manualForm.full_name.trim();
    if (!fullName) {
      setMatchedManualStudentId(null);
      setManualFeedback(null);
      return;
    }

    const matchedStudents = users.filter(
      (user) => normalizeValue(user.full_name) === normalizeValue(fullName),
    );

    if (matchedStudents.length === 1) {
      const matchedStudent = matchedStudents[0];
      setMatchedManualStudentId(matchedStudent.id);
      setManualForm((prev) => ({
        ...prev,
        phone: matchedStudent.phone ?? matchedStudent.username ?? prev.phone,
        student_id: matchedStudent.student_id ?? "",
        class_name: matchedStudent.class_name ?? "",
      }));
      setManualMessage(`已匹配到系统中的学生信息：${matchedStudent.full_name}。`, "default");
      return;
    }

    setMatchedManualStudentId(null);
    if (matchedStudents.length > 1) {
      setManualMessage("找到多名同名学生，请继续输入手机号或班级确认。", "default");
      return;
    }

    setManualFeedback(null);
  }, [manualForm.full_name, users]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const toggleVisibleUsers = () => {
    if (visibleUserIds.length === 0) return;
    if (allVisibleSelected) {
      onChange(selectedIds.filter((id) => !visibleUserIds.includes(id)));
      return;
    }
    onChange([...new Set([...selectedIds, ...visibleUserIds])]);
  };

  const toggleClassStudents = (classId: string | "__unassigned__") => {
    const classStudentIds = users
      .filter((user) => (classId === "__unassigned__" ? !user.class_id : user.class_id === classId))
      .map((user) => user.id);
    if (classStudentIds.length === 0) return;

    const alreadySelected = classStudentIds.every((id) => selectedSet.has(id));
    if (alreadySelected) {
      onChange(selectedIds.filter((id) => !classStudentIds.includes(id)));
      return;
    }

    onChange([...new Set([...selectedIds, ...classStudentIds])]);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportMessage(null);

    try {
      const rows = await parseStudentImportFile(file);
      const existingStudents = new Map(
        users.map((user) => [normalizeValue(user.phone ?? user.username), user]),
      );
      const existingSelectedIds: string[] = [];
      const rowsToCreate = rows.filter((row) => {
        const existing = existingStudents.get(normalizeValue(row.phone));
        if (!existing) {
          return true;
        }

        existingSelectedIds.push(existing.id);
        return false;
      });

      let response: ImportResult = {
        success_count: 0,
        failed_count: 0,
        errors: [],
      };

      if (rowsToCreate.length > 0) {
        const { students: payload } = await buildStudentBatchImportItems({
          rows: rowsToCreate,
          classes,
          createClass: (name) =>
            apiRequest<ClassItem>("/rbac/students/classes", {
              method: "POST",
              body: JSON.stringify({ name }),
            }),
        });

        response = await apiRequest<ImportResult>("/rbac/students/batch", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      const { studentData } = await loadStudentData();
      const createdPhones = new Set(rowsToCreate.map((row) => normalizeValue(row.phone)));
      const createdIds = studentData
        .filter((user) => createdPhones.has(normalizeValue(user.phone ?? user.username)))
        .map((user) => user.id);
      const matchedIds = [...existingSelectedIds, ...createdIds];
      const merged = [...new Set([...selectedIds, ...matchedIds])];
      onChange(merged);
      setImportResults(response.errors);
      setImportMessage(
        `已处理 ${rows.length} 条记录，已选中现有学生 ${existingSelectedIds.length} 人，新导入并选中 ${createdIds.length} 人。${
          response.failed_count > 0 ? ` 另有 ${response.failed_count} 条导入失败。` : ""
        }`,
      );
    } catch (error) {
      setImportResults([]);
      setImportError(
        error instanceof Error
          ? error.message
          : "文件解析失败，请上传包含“姓名”和“手机号”列的 Excel 文件。",
      );
    }
    // Reset file input
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleManualAdd = async () => {
    const fullName = manualForm.full_name.trim();
    const phone = manualForm.phone.trim();
    const studentId = manualForm.student_id.trim();
    const className = manualForm.class_name.trim();

    if (!fullName || !phone || !className) {
      setManualMessage("请填写姓名、手机号和班级。", "destructive");
      return;
    }

    const existingUser = users.find(
      (u) =>
        (matchedManualStudentId ? u.id === matchedManualStudentId : false) ||
        normalizeValue(u.phone ?? "") === normalizeValue(phone) ||
        normalizeValue(u.username) === normalizeValue(phone),
    );
    if (existingUser) {
      if (selectedSet.has(existingUser.id)) {
        setManualMessage("该学生已经在已选列表中。", "default");
      } else {
        onChange([...selectedIds, existingUser.id]);
        setManualMessage(`系统中已存在该学生，已加入当前考试：${existingUser.full_name || existingUser.username}。`, "success");
      }
      resetManualForm();
      return;
    }

    setIsManualSubmitting(true);
    setManualFeedback(null);
    try {
      let classId =
        classes.find((item) => normalizeValue(item.name) === normalizeValue(className))?.id ?? null;

      if (!classId) {
        const createdClass = await apiRequest<ClassItem>("/rbac/students/classes", {
          method: "POST",
          body: JSON.stringify({ name: className }),
        });
        classId = createdClass.id;
        setClasses((prev) => [...prev, createdClass]);
      }

      const createdStudent = await apiRequest<StudentRecord>("/rbac/students", {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName,
          phone,
          student_id: studentId || null,
          class_id: classId,
        }),
      });

      setUsers((prev) => [...prev, createdStudent]);
      onChange([...selectedIds, createdStudent.id]);
      setManualMessage(`已新建并添加学生：${createdStudent.full_name || fullName}。`, "success");
      resetManualForm();
    } catch (error) {
      setManualMessage(
        error instanceof Error ? error.message : "手动添加失败，请稍后重试。",
        "destructive",
      );
    } finally {
      setIsManualSubmitting(false);
    }
  };

  const modeButtons: { key: Mode; label: string; icon: React.ReactNode }[] = [
    { key: "select", label: "从列表选择", icon: <Check size={14} /> },
    { key: "import", label: "Excel导入", icon: <Upload size={14} /> },
    { key: "manual", label: "手动添加", icon: <Plus size={14} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-border bg-muted/30 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            已选 <span className="font-semibold text-foreground">{selectedIds.length}</span> 名考生
          </p>
          {selectedIds.length > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
              清空选择
            </Button>
          ) : null}
        </div>

        {selectedIds.length > 0 ? (
          <p
            className="truncate text-xs text-muted-foreground"
            title={selectedStudentSummary}
          >
            {selectedStudentSummary}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">还没有选择考生，可以从列表、Excel 或手动添加。</p>
        )}
      </div>

      {/* Mode tabs */}
      <div
        className="flex flex-wrap gap-1 rounded-lg bg-muted p-0.5"
        role="tablist"
        aria-label="选择考生方式"
      >
        {modeButtons.map((m) => (
          <button
            key={m.key}
            id={`${modeId}-${m.key}-tab`}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            aria-controls={`${modeId}-${m.key}-panel`}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
              mode === m.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setMode(m.key)}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {/* Select mode */}
      {mode === "select" && (
        <div
          id={`${modeId}-select-panel`}
          role="tabpanel"
          aria-labelledby={`${modeId}-select-tab`}
          className="space-y-3"
        >
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-3">
            <Select value={selectedClassFilter} onValueChange={setSelectedClassFilter}>
              <SelectTrigger aria-label="班级筛选" className="h-8 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部班级</SelectItem>
                {classes.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
                <SelectItem value="__unassigned__">未分班学生</SelectItem>
              </SelectContent>
            </Select>

            <Button type="button" variant="outline" size="sm" onClick={toggleVisibleUsers}>
              {allVisibleSelected ? "取消当前列表" : "全选当前列表"}
            </Button>

            {selectedClassFilter !== "__all__" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  toggleClassStudents(
                    selectedClassFilter === "__unassigned__" ? "__unassigned__" : selectedClassFilter,
                  )
                }
              >
                {selectedClassFilter === "__unassigned__" ? "切换未分班学生" : "切换当前班级"}
              </Button>
            )}
          </div>

          {classes.length > 0 || unassignedCount > 0 ? (
            <div className="flex flex-wrap gap-2">
              {classes.map((item) => {
                const classStudentIds = users
                  .filter((user) => user.class_id === item.id)
                  .map((user) => user.id);
                const classSelected =
                  classStudentIds.length > 0 && classStudentIds.every((id) => selectedSet.has(id));
                return (
                  <Button
                    key={item.id}
                    type="button"
                    variant={classSelected ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleClassStudents(item.id)}
                  >
                    {item.name}
                  </Button>
                );
              })}
              {unassignedCount > 0 && (
                <Button
                  type="button"
                  variant={
                    users.filter((user) => !user.class_id).every((user) => selectedSet.has(user.id))
                      ? "default"
                      : "outline"
                  }
                  size="sm"
                  onClick={() => toggleClassStudents("__unassigned__")}
                >
                  未分班
                </Button>
              )}
            </div>
          ) : null}

          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索学生"
              placeholder="搜索学生..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8 text-sm"
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto rounded-lg border p-2">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">加载中...</div>
            ) : visibleUsers.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <Users size={24} className="mx-auto mb-2 opacity-25" />
                {normalizedSearch ? "没有匹配的学生" : "暂无学生"}
              </div>
            ) : (
              <div data-student-grid="true" className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                {visibleUsers.map((u) => {
                  const isSelected = selectedSet.has(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={u.full_name || u.username}
                      className={`flex min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                        isSelected ? "border-primary/50" : "border-border"
                      } hover:bg-muted/50`}
                      onClick={() => toggle(u.id)}
                    >
                      <div
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                          isSelected
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-input"
                        }`}
                      >
                        {isSelected && <Check size={12} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{u.full_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{u.username}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Import mode */}
      {mode === "import" && (
        <div
          id={`${modeId}-import-panel`}
          role="tabpanel"
          aria-labelledby={`${modeId}-import-tab`}
          className="space-y-3"
        >
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-3">
              上传 Excel 文件，至少包含“姓名”和“手机号”列，可选“学号”和“班级”
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileImport}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={14} className="mr-1" />
              选择文件
            </Button>
          </div>
          {importError && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              {importError}
            </div>
          )}
          {importMessage && !importError && (
            <div className="rounded-lg border border-primary/15 bg-primary/5 p-3 text-sm text-foreground">
              {importMessage}
            </div>
          )}
          {importResults.length > 0 && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950 p-3 text-sm">
              <p className="font-medium text-amber-700 dark:text-amber-300 mb-1">
                以下记录导入失败：
              </p>
              <ul className="list-disc pl-5 text-amber-600 dark:text-amber-400 text-xs space-y-0.5">
                {importResults.map((name, i) => (
                  <li key={i}>{name}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Manual mode */}
      {mode === "manual" && (
        <div
          id={`${modeId}-manual-panel`}
          role="tabpanel"
          aria-labelledby={`${modeId}-manual-tab`}
          className="space-y-3"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor={`${modeId}-manual-name`}>
                姓名
              </Label>
              <Input
                id={`${modeId}-manual-name`}
                placeholder="输入学生姓名"
                value={manualForm.full_name}
                onChange={(e) => setManualForm((prev) => ({ ...prev, full_name: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor={`${modeId}-manual-phone`}>
                手机号
              </Label>
              <Input
                id={`${modeId}-manual-phone`}
                placeholder="输入手机号"
                value={manualForm.phone}
                onChange={(e) => setManualForm((prev) => ({ ...prev, phone: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleManualAdd();
                }}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor={`${modeId}-manual-student-id`}>
                学号（可选）
              </Label>
              <Input
                id={`${modeId}-manual-student-id`}
                placeholder="输入学号"
                value={manualForm.student_id}
                onChange={(e) => setManualForm((prev) => ({ ...prev, student_id: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                班级
              </Label>
              <Select
                value={manualClassSelectValue}
                onValueChange={(value) => {
                  if (value === "__custom__") {
                    setManualForm((prev) => ({ ...prev, class_name: hasMatchingClass ? "" : prev.class_name }));
                    return;
                  }

                  setManualForm((prev) => ({ ...prev, class_name: value }));
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="选择班级" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((item) => (
                    <SelectItem key={item.id} value={item.name}>
                      {item.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__">新建班级</SelectItem>
                </SelectContent>
              </Select>
              {!hasMatchingClass && (
                <Input
                  id={`${modeId}-manual-class`}
                  placeholder="输入新班级名称"
                  value={manualForm.class_name}
                  onChange={(e) => setManualForm((prev) => ({ ...prev, class_name: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleManualAdd();
                  }}
                  className="h-9 text-sm"
                />
              )}
              <datalist id={`${modeId}-class-options`} className="hidden">
                {classes.map((item) => (
                  <option key={item.id} value={item.name} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              className="h-9 w-fit"
              disabled={
                isManualSubmitting ||
                !manualForm.full_name.trim() ||
                !manualForm.phone.trim() ||
                !manualForm.class_name.trim()
              }
              onClick={() => void handleManualAdd()}
            >
              <Plus size={14} className="mr-1" />
              {isManualSubmitting ? "添加中..." : "添加考生"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            手动输入姓名、手机号和班级后，系统会优先匹配已有学生；若不存在，则自动创建并加入当前考试。
          </p>
          {manualFeedback && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                manualFeedbackTone === "destructive"
                  ? "border-destructive/20 bg-destructive/10 text-destructive"
                  : manualFeedbackTone === "success"
                    ? "border-primary/15 bg-primary/5 text-foreground"
                    : "border-border bg-muted/60 text-foreground"
              }`}
              role="status"
            >
              {manualFeedback}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

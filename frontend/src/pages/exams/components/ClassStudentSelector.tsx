import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Search, Check, Upload, Plus, Users, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  getStudentImportAccount,
  parseStudentImportFile,
  type StudentImportClassOption,
} from "@/components/students/student-import-utils";
import { cn } from "@/lib/utils";
import type { IUser } from "@/types";

type SupplementMode = "import" | "manual";
type ManualFeedbackTone = "default" | "destructive" | "success";

type ClassItem = StudentImportClassOption;

interface StudentRecord extends IUser {
  phone?: string | null;
  student_id?: string | null;
  class_id?: string | null;
  class_name?: string | null;
  /** Set when the phone already had an account and the student role was attached to it. */
  attached_to_existing_account?: boolean;
}

interface ImportResult {
  success_count: number;
  failed_count: number;
  errors: string[];
}

export function ClassStudentSelector({
  selectedIds,
  onChange,
  summaryLabel = "名考生",
  emptySummaryText = "还没有选择对象，可以优先按班级选择，导入和手动添加作为补充方式。",
  defaultSupplementCollapsed = false,
  defaultClassIds,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  summaryLabel?: string;
  emptySummaryText?: string;
  defaultSupplementCollapsed?: boolean;
  /**
   * 进入时默认勾选这些班级下的全部学生（一次性，且仅在尚未选择任何考生时生效）。
   * 用于从课程详情进入创建考试/练习时，自动带入当前学期关联班级。
   */
  defaultClassIds?: string[];
}) {
  const [supplementMode, setSupplementMode] = useState<SupplementMode>("import");
  const [isSupplementCollapsed, setIsSupplementCollapsed] = useState(defaultSupplementCollapsed);
  const [isStudentPickerOpen, setIsStudentPickerOpen] = useState(
    () => !defaultClassIds || defaultClassIds.length === 0,
  );
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

  const didAutoSelectClassesRef = useRef(false);
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    void loadStudentData(false)
      .then(({ studentData, classData }) => {
        if (!isMounted) return;
        setUsers(studentData);
        setClasses(classData);
      })
      .catch((err) => {
        console.error("ClassStudentSelector fetch error:", err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (didAutoSelectClassesRef.current) return;

    // 已有选择说明上层带入了名单，或用户已开始手动调整；之后即使默认班级
    // 才异步到达，也不能覆盖这份选择。
    if (selectedIds.length > 0) {
      didAutoSelectClassesRef.current = true;
      return;
    }
    if (!defaultClassIds || defaultClassIds.length === 0 || users.length === 0) {
      return;
    }

    const classIdSet = new Set(defaultClassIds);
    const autoIds = users
      .filter((user) => user.class_id && classIdSet.has(user.class_id))
      .map((user) => user.id);
    if (autoIds.length === 0) {
      setIsStudentPickerOpen(true);
      return;
    }

    didAutoSelectClassesRef.current = true;
    onChange(autoIds);
    setIsStudentPickerOpen(false);
  }, [defaultClassIds, onChange, selectedIds.length, users]);

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
  const selectedClassSummaries = classes
    .map((item) => {
      const studentIds = users
        .filter((user) => user.class_id === item.id)
        .map((user) => user.id);
      const selectedCount = studentIds.filter((studentId) => selectedSet.has(studentId)).length;
      return { name: item.name, studentIds, selectedCount };
    })
    .filter(({ selectedCount }) => selectedCount > 0);
  const selectedClassNames = selectedClassSummaries.map(({ name }) => name);
  const classMemberIds = new Set(selectedClassSummaries.flatMap(({ studentIds }) => studentIds));
  const manuallyAdjustedCount =
    selectedIds.filter((id) => !classMemberIds.has(id)).length +
    selectedClassSummaries.reduce(
      (count, { studentIds, selectedCount }) => count + studentIds.length - selectedCount,
      0,
    );
  const selectedClassSummary = selectedClassNames.length > 0
    ? `${selectedClassNames.join("、")}${manuallyAdjustedCount > 0 ? ` · 另有 ${manuallyAdjustedCount} 人已调整` : ""}`
    : `已手动选择 ${selectedIds.length} 人`;
  const unassignedCount = users.filter((user) => !user.class_id).length;
  const classGroups = [
    {
      id: "__all__",
      label: "全部班级",
      count: users.length,
      selected: users.length > 0 && users.every((user) => selectedSet.has(user.id)),
    },
    ...classes.map((item) => {
      const classStudentIds = users
        .filter((user) => user.class_id === item.id)
        .map((user) => user.id);
      return {
        id: item.id,
        label: item.name,
        count: classStudentIds.length,
        selected:
          classStudentIds.length > 0 && classStudentIds.every((id) => selectedSet.has(id)),
      };
    }),
    ...(unassignedCount > 0
      ? [
          {
            id: "__unassigned__",
            label: "未分班",
            count: unassignedCount,
            selected: users
              .filter((user) => !user.class_id)
              .every((user) => selectedSet.has(user.id)),
          },
        ]
      : []),
  ];

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

  const handleClassFilterSelect = (classId: string) => {
    setSelectedClassFilter(classId);
  };

  const handleFileImport = async (e: ChangeEvent<HTMLInputElement>) => {
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
        const existing = existingStudents.get(normalizeValue(getStudentImportAccount(row)));
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
      const createdAccounts = new Set(rowsToCreate.map((row) => normalizeValue(getStudentImportAccount(row))));
      const createdIds = studentData
        .filter((user) => createdAccounts.has(normalizeValue(user.phone ?? user.username)))
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
          : "文件解析失败，请上传包含“姓名”，并提供“手机号”或“学号”的 Excel 文件。",
      );
    }
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
        setManualMessage(
          `系统中已存在该学生，已加入当前列表：${existingUser.full_name || existingUser.username}。`,
          "success",
        );
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
      setManualMessage(
        createdStudent.attached_to_existing_account
          ? `该手机号已有账号，已为它添加学生身份并加入列表：${createdStudent.full_name || fullName}。`
          : `已新建并添加学生：${createdStudent.full_name || fullName}。`,
        "success",
      );
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

  const currentVisibleIds = visibleUsers.map((user) => user.id);
  const visibleAllSelected =
    currentVisibleIds.length > 0 && currentVisibleIds.every((id) => selectedSet.has(id));

  const toggleVisibleUsers = () => {
    if (currentVisibleIds.length === 0) return;
    if (visibleAllSelected) {
      onChange(selectedIds.filter((id) => !currentVisibleIds.includes(id)));
      return;
    }
    onChange([...new Set([...selectedIds, ...currentVisibleIds])]);
  };

  const supplementModes: { key: SupplementMode; label: string; icon: ReactNode }[] = [
    { key: "import", label: "Excel 导入", icon: <Upload data-icon="inline-start" /> },
    { key: "manual", label: "手动添加", icon: <Plus data-icon="inline-start" /> },
  ];

  return (
    <div className="flex flex-col gap-5">
      {selectedIds.length > 0 ? (
        <div className="flex items-start justify-between gap-3 overflow-hidden rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <Check className="size-4 shrink-0 text-primary" />
            <span className="shrink-0 text-sm font-semibold text-primary">
              已选 {selectedIds.length} {summaryLabel}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">·</span>
            <span
              className="min-w-0 flex-1 truncate text-xs leading-5 text-muted-foreground"
              title={selectedClassSummary}
            >
              {selectedClassSummary}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsStudentPickerOpen((value) => !value)}
            >
              <Users data-icon="inline-start" />
              {isStudentPickerOpen ? "收起学生列表" : "调整学生"}
            </Button>
            {isStudentPickerOpen && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange([]);
                  setIsStudentPickerOpen(true);
                }}
              >
                清空选择
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          {emptySummaryText}
        </div>
      )}

      {isStudentPickerOpen && (
        <>
      <div data-testid="student-picker" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-foreground">按班级选择</p>
          <p className="text-xs text-muted-foreground">优先从班级中批量选择学生，其它方式作为补充。</p>
        </div>

        <div className="flex h-[420px] overflow-hidden rounded-xl border border-border bg-background">
          <div className="w-40 shrink-0 overflow-y-auto border-r border-border bg-muted/25 py-2">
            <div className="flex flex-col gap-1">
              {classGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => handleClassFilterSelect(group.id)}
                  className={cn(
                    "flex w-full items-center justify-between border-l-2 px-3 py-2.5 text-left transition-colors",
                    selectedClassFilter === group.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground",
                  )}
                >
                  <span className="min-w-0 truncate text-sm font-medium">{group.label}</span>
                  <span
                    className={cn(
                      "ml-3 inline-flex min-w-7 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      selectedClassFilter === group.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground",
                    )}
                  >
                    {group.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="搜索学生"
                  placeholder="搜索学生..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 border-border/70 bg-muted/40 pl-8 text-xs shadow-none"
                />
              </div>
              <button
                type="button"
                className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={toggleVisibleUsers}
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded border",
                    visibleAllSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background",
                  )}
                >
                  {visibleAllSelected && <Check className="size-3" />}
                </span>
                全选
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {isLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">加载中...</div>
              ) : visibleUsers.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <Users className="mx-auto mb-2 size-6 opacity-25" />
                  {normalizedSearch ? "没有匹配的学生" : "暂无学生"}
                </div>
              ) : (
                <div data-student-grid="true" className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {visibleUsers.map((u) => {
                    const isSelected = selectedSet.has(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={u.full_name || u.username}
                        className={cn(
                          "flex min-w-0 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/50",
                          isSelected ? "border-primary" : "border-border",
                        )}
                        onClick={() => toggle(u.id)}
                      >
                        <div
                          className={`flex size-4 shrink-0 items-center justify-center rounded border transition-colors ${
                            isSelected
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-input"
                          }`}
                        >
                          {isSelected && <Check className="size-3" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-sm font-medium", isSelected && "text-primary")}>{u.full_name}</p>
                          <p className="truncate text-xs text-muted-foreground">{u.phone || u.username}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
          aria-expanded={!isSupplementCollapsed}
          onClick={() => setIsSupplementCollapsed((value) => !value)}
        >
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold text-foreground">补充方式</span>
            <span className="text-xs text-muted-foreground">如果列表里没有，也可以导入或手动新增后直接选中。</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
            {isSupplementCollapsed ? "展开补充方式" : "收起补充方式"}
            <ChevronDown className={cn("size-4 transition-transform", !isSupplementCollapsed && "rotate-180")} />
          </span>
        </button>

        {!isSupplementCollapsed && (
          <Tabs
            value={supplementMode}
            onValueChange={(value) => setSupplementMode(value as SupplementMode)}
            className="border-t border-border"
          >
            <TabsList className="h-10 rounded-none bg-muted/30 p-0">
              {supplementModes.map((m) => (
                <TabsTrigger
                  key={m.key}
                  value={m.key}
                  className="h-10 rounded-none border-b-2 border-transparent px-5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
                >
                  {m.icon}
                  {m.label}
                </TabsTrigger>
              ))}
            </TabsList>

          <TabsContent value="import" className="m-0 flex flex-col gap-3 p-5">
            <div className="flex flex-col items-center gap-3 rounded-lg py-4 text-center">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Upload className="size-5" />
              </div>
              <p className="text-sm text-muted-foreground">
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
                <Upload data-icon="inline-start" />
                选择文件
              </Button>
            </div>
            {importError && (
              <div
                className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
                role="alert"
              >
                {importError}
              </div>
            )}
            {importMessage && !importError && (
              <div className="rounded-lg border border-primary/15 bg-primary/5 p-3 text-sm text-foreground">
                {importMessage}
              </div>
            )}
            {importResults.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950">
                <p className="mb-1 font-medium text-amber-700 dark:text-amber-300">以下记录导入失败：</p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-600 dark:text-amber-400">
                  {importResults.map((name, i) => (
                    <li key={i}>{name}</li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>

          <TabsContent value="manual" className="m-0 flex flex-col gap-3 p-5">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
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
              <div className="flex flex-col gap-1">
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
              <div className="flex flex-col gap-1">
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
              <div className="flex flex-col gap-1">
                <Label className="text-xs">班级</Label>
                <Select
                  value={manualClassSelectValue}
                  onValueChange={(value) => {
                    if (value === "__custom__") {
                      setManualForm((prev) => ({
                        ...prev,
                        class_name: hasMatchingClass ? "" : prev.class_name,
                      }));
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
                <Plus data-icon="inline-start" />
                {isManualSubmitting ? "添加中..." : "添加学生"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              手动输入姓名、手机号和班级后，系统会优先匹配已有学生；若不存在，则自动创建并加入当前列表。
            </p>
            {manualFeedback && (
              <div
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  manualFeedbackTone === "destructive"
                    ? "border-destructive/20 bg-destructive/10 text-destructive"
                    : manualFeedbackTone === "success"
                      ? "border-primary/15 bg-primary/5 text-foreground"
                      : "border-border bg-muted/60 text-foreground",
                )}
                role="status"
              >
                {manualFeedback}
              </div>
            )}
          </TabsContent>
          </Tabs>
        )}
      </div>
        </>
      )}
    </div>
  );
}

import { useGetIdentity, usePermissions } from "@refinedev/core";
import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Upload, Search, FileSpreadsheet, X, Info, Users, CheckCircle2, AlertCircle, Trash2, KeyRound, ChevronDown, ChevronRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/pages/grading/api";
import { useToast } from "@/hooks/use-toast";
import { getPersonaCopy } from "@/lib/persona-copy";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-viewport";
import {
  buildStudentBatchImportItems,
  parseStudentImportFile,
  type StudentImportClassOption,
} from "@/components/students/student-import-utils";

type ClassItem = StudentImportClassOption;
type StudentFilterScope = string | "all" | "unassigned";

interface Student {
  id: string;
  full_name: string;
  phone: string | null;
  student_id: string | null;
  username: string;
  is_active: boolean;
  class_id: string | null;
  class_name: string | null;
  owner_teacher_id: string | null;
}

interface ImportResult {
  success_count: number;
  failed_count: number;
  errors: string[];
}

interface PasswordResetResult {
  password_source: "student_id" | "username";
}

export default function StudentManagementPage() {
  const { data: role } = usePermissions<string>({});
  const { data: identity } = useGetIdentity<{ persona?: string | null }>();
  const copy = getPersonaCopy(identity?.persona);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<StudentFilterScope>("all");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [studentsLoadError, setStudentsLoadError] = useState(false);
  const [importing, setImporting] = useState(false);
  const [resettingStudentId, setResettingStudentId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const isCompact = useMediaQuery("(max-width: 1199px)");
  const isPhone = useMediaQuery("(max-width: 767px)");
  const [isClassPickerOpen, setIsClassPickerOpen] = useState(false);
  const [isManagingClasses, setIsManagingClasses] = useState(false);
  const [classSearchTerm, setClassSearchTerm] = useState("");
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasLoadedStudentsRef = useRef(false);
  const studentRequestIdRef = useRef(0);
  const { toast } = useToast();

  const [isAddDialogOpen, setIsAddAddDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isAddClassDialogOpen, setIsAddClassDialogOpen] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const [newStudent, setNewStudent] = useState({
    full_name: "",
    phone: "",
    student_id: "",
    class_id: undefined as string | undefined,
  });

  const fetchClasses = async () => {
    try {
      const data = await apiRequest<ClassItem[]>("/rbac/students/classes");
      setClasses(data);
    } catch {
      // keep current classes when loading fails
    }
  };

  const fetchStudents = useCallback(async () => {
    const requestId = ++studentRequestIdRef.current;
    if (hasLoadedStudentsRef.current) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const url =
        selectedClassId === "all"
          ? "/rbac/students"
          : selectedClassId === "unassigned"
            ? "/rbac/students?unassigned=true"
            : `/rbac/students?class_id=${selectedClassId}`;
      const data = await apiRequest<Student[]>(url);
      if (requestId === studentRequestIdRef.current) {
        setStudents(data);
        setStudentsLoadError(false);
        hasLoadedStudentsRef.current = true;
      }
    } catch {
      if (requestId === studentRequestIdRef.current) {
        setStudentsLoadError(true);
        toast({
          title: "加载失败",
          description: `无法获取${copy.person}列表`,
          variant: "destructive",
        });
      }
    } finally {
      if (requestId === studentRequestIdRef.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [selectedClassId, toast, copy.person]);

  useEffect(() => {
    fetchClasses();
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const handleAddClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassName.trim()) return;
    try {
      await apiRequest("/rbac/students/classes", {
        method: "POST",
        body: JSON.stringify({ name: newClassName }),
      });
      toast({ title: "创建成功", description: `${copy.group} ${newClassName} 已创建。` });
      setNewClassName("");
      setIsAddClassDialogOpen(false);
      fetchClasses();
    } catch {
      toast({ title: "创建失败", variant: "destructive" });
    }
  };

  const handleDeleteClass = async (id: string, name: string) => {
    if (!confirm(`确定要删除${copy.group} "${name}" 吗？${copy.personPlural}将变为未分配${copy.group}状态。`)) return;
    try {
      await apiRequest(`/rbac/students/classes/${id}`, { method: "DELETE" });
      toast({ title: "已删除" });
      if (selectedClassId === id) {
        changeClass("all");
      } else {
        void fetchStudents();
      }
      void fetchClasses();
    } catch {
      toast({ title: "删除失败", description: `无法删除${copy.group}，请稍后重试`, variant: "destructive" });
    }
  };

  const isScopedClassSelected = selectedClassId !== "all" && selectedClassId !== "unassigned";
  const selectedClassName = isScopedClassSelected ? classes.find((c) => c.id === selectedClassId)?.name : null;

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest("/rbac/students", {
        method: "POST",
        body: JSON.stringify(newStudent),
      });
      toast({
        title: "添加成功",
        description: `${copy.person} ${newStudent.full_name} 已添加。`,
      });
      setIsAddAddDialogOpen(false);
      setNewStudent({ full_name: "", phone: "", student_id: "", class_id: undefined });
      void fetchStudents();
    } catch (error: unknown) {
      toast({
        title: "添加失败",
        description: error instanceof Error ? error.message : "手机号可能已存在",
        variant: "destructive",
      });
    }
  };

  const processFile = async (file: File) => {
    setImporting(true);
    try {
      const rows = await parseStudentImportFile(file);
      const { students: mappedStudents, classes: nextClasses } = await buildStudentBatchImportItems({
        rows,
        classes,
        fallbackClassId: isScopedClassSelected ? selectedClassId : undefined,
        createClass: (name) =>
          apiRequest<ClassItem>("/rbac/students/classes", {
            method: "POST",
            body: JSON.stringify({ name }),
          }),
      });

      const response = await apiRequest<ImportResult>("/rbac/students/batch", {
        method: "POST",
        body: JSON.stringify(mappedStudents),
      });

      setClasses(nextClasses);
      setImportResult(response);
      setIsImportDialogOpen(false);
      setIsResultDialogOpen(true);
      void fetchStudents();
    } catch (error: unknown) {
      toast({
        title: "导入失败",
        description: error instanceof Error ? error.message : "请检查导入文件后重试",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const filteredStudents = students.filter(
    (s) =>
      s.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.phone && s.phone.includes(searchTerm)) ||
      s.username.includes(searchTerm) ||
      (s.student_id && s.student_id.includes(searchTerm))
  );
  const allVisibleSelected =
    filteredStudents.length > 0 && filteredStudents.every((student) => selectedStudentIds.includes(student.id));
  const selectedVisibleCount = filteredStudents.filter((student) => selectedStudentIds.includes(student.id)).length;
  const showOwnershipColumn = role === "platform_admin";
  const activeStudent = students.find((student) => student.id === activeStudentId) ?? null;
  const currentScopeLabel = selectedClassId === "all"
    ? copy.allPeople
    : selectedClassId === "unassigned"
      ? copy.unassignedGroup
      : selectedClassName ?? copy.group;
  const matchingClasses = classes.filter((item) => item.name.toLocaleLowerCase().includes(classSearchTerm.trim().toLocaleLowerCase()));

  const changeClass = (scope: StudentFilterScope) => {
    setSelectedClassId(scope);
    setSelectedStudentIds([]);
    setIsSelecting(false);
    setActiveStudentId(null);
    setIsClassPickerOpen(false);
    setIsManagingClasses(false);
    setClassSearchTerm("");
  };

  const updateSearchTerm = (value: string) => {
    setSearchTerm(value);
    setSelectedStudentIds([]);
  };

  useEffect(() => {
    setSelectedStudentIds((current) => current.filter((id) => students.some((student) => student.id === id)));
  }, [students]);

  const toggleStudentSelection = (studentId: string) => {
    setSelectedStudentIds((current) =>
      current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]
    );
  };

  const toggleSelectAllVisible = (checked: boolean | "indeterminate") => {
    if (checked) {
      const next = new Set(selectedStudentIds);
      filteredStudents.forEach((student) => next.add(student.id));
      setSelectedStudentIds(Array.from(next));
      return;
    }
    setSelectedStudentIds((current) => current.filter((id) => !filteredStudents.some((student) => student.id === id)));
  };

  const deleteStudents = async (studentIds: string[]) => {
    if (studentIds.length === 0) {
      return;
    }
    const isBatch = studentIds.length > 1;
    const action = role === "platform_admin" ? "删除账号" : `从我的${copy.person}中移除`;
    const confirmed = window.confirm(
      isBatch ? `确定要将这 ${studentIds.length} 个${copy.person}${action}吗？` : `确定要将这名${copy.person}${action}吗？`
    );
    if (!confirmed) {
      return;
    }

    try {
      if (isBatch) {
        const result = await apiRequest<ImportResult>("/rbac/students/batch-delete", {
          method: "POST",
          body: JSON.stringify({ student_ids: studentIds }),
        });
        toast({
          title: result.failed_count === 0
            ? (showOwnershipColumn ? "批量删除成功" : "批量移除成功")
            : (showOwnershipColumn ? "批量删除已完成" : "批量移除已完成"),
          description:
            result.failed_count === 0
              ? `已处理 ${result.success_count} 个${copy.person}。`
              : `成功 ${result.success_count} 个，失败 ${result.failed_count} 个。`,
          variant: result.failed_count === 0 ? "default" : "destructive",
        });
      } else {
        await apiRequest(`/rbac/students/${studentIds[0]}`, { method: "DELETE" });
        toast({ title: showOwnershipColumn ? "删除成功" : "移除成功", description: showOwnershipColumn ? `${copy.person}账号已删除。` : `${copy.person}已从我的${copy.person}中移除。` });
      }
      setSelectedStudentIds((current) => current.filter((id) => !studentIds.includes(id)));
      setActiveStudentId(null);
      setIsSelecting(false);
      await fetchStudents();
    } catch (error: unknown) {
      toast({
        title: showOwnershipColumn ? "删除失败" : "移除失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    }
  };

  const resetStudentPassword = async (student: Student) => {
    const studentIdentifierLabel = copy.persona === "teacher" ? "学号" : "编号";
    const passwordSeed = (student.student_id || student.username).trim();
    const passwordSourceLabel = student.student_id ? studentIdentifierLabel : "账号";
    const confirmed = window.confirm(
      `确定要重置 ${student.full_name} 的密码吗？\n重置后初始密码为${passwordSourceLabel}：${passwordSeed}，${copy.person}下次登录需修改密码。`
    );
    if (!confirmed) {
      return;
    }

    setResettingStudentId(student.id);
    try {
      const result = await apiRequest<PasswordResetResult>(`/rbac/students/${student.id}/reset-password`, {
        method: "POST",
      });
      const sourceLabel = result.password_source === "student_id" ? studentIdentifierLabel : "账号";
      const sourceValue = result.password_source === "student_id" ? student.student_id : student.username;
      toast({
        title: "密码已重置",
        description: `${student.full_name} 的初始密码已重置为${sourceLabel}${sourceValue ? `：${sourceValue}` : ""}。`,
      });
    } catch (error: unknown) {
      toast({
        title: "重置失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setResettingStudentId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 gap-0 overflow-hidden xl:h-full">
      {/* Left Sidebar: Classes */}
      {!isCompact && <aside className="flex w-64 shrink-0 flex-col border-r border-border/60 bg-muted/10">
        <div className="p-4 border-b border-border/60 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">{copy.group}列表</h2>
          <Button variant="ghost" size="icon" aria-label={`新建${copy.group}`} onClick={() => setIsAddClassDialogOpen(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          <button
            onClick={() => changeClass("all")}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors",
              selectedClassId === "all" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            )}
          >
            <Users className="h-4 w-4" />
            <span>{copy.allPeople}</span>
          </button>
          <button
            onClick={() => changeClass("unassigned")}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors",
              selectedClassId === "unassigned" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            )}
          >
            <div className="h-4 w-4 rounded-full border border-current/50" />
            <span>{copy.unassignedGroup}</span>
          </button>
          {classes.map((c) => (
            <div key={c.id} className="group relative">
              <button
                onClick={() => changeClass(c.id)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors pr-8",
                  selectedClassId === c.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                )}
              >
                <div className="h-1.5 w-1.5 rounded-full bg-current opacity-40" />
                <span className="truncate">{c.name}</span>
              </button>
              <button
                onClick={() => handleDeleteClass(c.id, c.name)}
                aria-label={`删除${copy.group} ${c.name}`}
                className="absolute right-1 top-1/2 -translate-y-1/2 flex size-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="h-3 w-3 m-auto" />
              </button>
            </div>
          ))}
        </nav>
      </aside>}

      {/* Main Content: Student List */}
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 pt-4 xl:gap-6 xl:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
            <div>
              <h1 className="text-base font-bold tracking-tight">
                {selectedClassId === "all"
                  ? copy.allPeople
                  : selectedClassId === "unassigned"
                    ? copy.unassignedPeople
                    : selectedClassName}
              </h1>
              <p className="hidden text-sm text-muted-foreground xl:block">
                管理{copy.person}账号，新建账号初始密码默认为手机号；重置密码时优先使用{copy.persona === "teacher" ? "学号" : "编号"}，无{copy.persona === "teacher" ? "学号" : "编号"}则使用账号。
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!isPhone && <Button variant="outline" onClick={() => setIsImportDialogOpen(true)}>
                <Upload className="w-4 h-4 mr-2" />
                批量导入
              </Button>}
              <Button size={isCompact ? "sm" : "default"} onClick={() => setIsAddAddDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                添加{copy.person}
              </Button>
            </div>
          </div>

          {isCompact && <div className="flex items-center gap-2">
            <Button variant="outline" className="min-h-11 min-w-0 flex-1 justify-between font-normal" onClick={() => setIsClassPickerOpen(true)}>
              <span className="truncate">{copy.group}：{currentScopeLabel}</span>
              <ChevronDown className="shrink-0" />
            </Button>
            <Button variant="outline" className="min-h-11 shrink-0" onClick={() => { setIsSelecting((current) => !current); setSelectedStudentIds([]); }}>
              {isSelecting ? "取消" : "选择"}
            </Button>
          </div>}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder={`搜索姓名、手机号或${copy.persona === "teacher" ? "学号" : "编号"}...`}
              value={searchTerm}
              onChange={(e) => updateSearchTerm(e.target.value)}
            />
          </div>

          {studentsLoadError && <Alert variant="destructive" className="flex items-center justify-between gap-3">
            <div className="min-w-0"><AlertTitle>列表加载失败</AlertTitle><AlertDescription>无法获取{copy.person}列表，{hasLoadedStudentsRef.current ? "下方仍显示上次结果。" : "请重试。"}</AlertDescription></div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => void fetchStudents()}>重新加载</Button>
          </Alert>}

          {(!studentsLoadError || hasLoadedStudentsRef.current) && (!isCompact || isSelecting) && <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                aria-label={`全选当前列表${copy.person}`}
                checked={allVisibleSelected}
                onCheckedChange={toggleSelectAllVisible}
              />
              <span>{selectedVisibleCount > 0 ? `已选中 ${selectedVisibleCount} 名${copy.person}` : "全选当前列表"}</span>
              {isRefreshing ? <span className="text-xs text-muted-foreground">加载中...</span> : null}
            </div>
            {selectedStudentIds.length > 0 ? (
              <Button variant="destructive" size="sm" onClick={() => void deleteStudents(selectedStudentIds)}>
                <Trash2 className="mr-2 h-4 w-4" />
                {showOwnershipColumn ? "批量删除" : "批量移除"}
              </Button>
            ) : null}
          </div>}

          {studentsLoadError && !hasLoadedStudentsRef.current ? null : isCompact ? <div className="min-w-0">
            {loading ? <p className="py-12 text-center text-sm text-muted-foreground">正在加载...</p> :
              filteredStudents.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">未找到匹配的{copy.person}。</p> :
                filteredStudents.map((student) => <div key={student.id} className="flex min-h-18 items-center gap-3 border-b border-border/70 px-1 last:border-b-0">
                  {isSelecting && <Checkbox
                    aria-label={`选择 ${student.full_name}`}
                    checked={selectedStudentIds.includes(student.id)}
                    onCheckedChange={() => toggleStudentSelection(student.id)}
                  />}
                  <button
                    type="button"
                    className="flex min-h-18 min-w-0 flex-1 items-center justify-between gap-3 py-3 text-left"
                    onClick={() => isSelecting ? toggleStudentSelection(student.id) : setActiveStudentId(student.id)}
                    aria-label={isSelecting ? `选择 ${student.full_name}` : `查看 ${student.full_name}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{student.full_name}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {student.student_id || student.username} · {student.class_name || copy.unassignedGroup}
                      </span>
                    </span>
                    {!isSelecting && <ChevronRight className="shrink-0 text-muted-foreground" aria-hidden="true" />}
                  </button>
                </div>)}
          </div> : <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <Table className={cn(showOwnershipColumn ? "min-w-[980px]" : "min-w-[860px]", "[&_th]:whitespace-nowrap")}>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="w-[56px]">
                    <span className="sr-only">选择</span>
                  </TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>账号</TableHead>
                  <TableHead>{copy.persona === "teacher" ? "学号" : "编号"}</TableHead>
                  <TableHead>{copy.group}</TableHead>
                  {showOwnershipColumn && <TableHead>归属</TableHead>}
                  <TableHead className="w-[80px]">状态</TableHead>
                  <TableHead className="w-[184px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={showOwnershipColumn ? 8 : 7} className="text-center py-12 text-muted-foreground animate-pulse">正在加载...</TableCell></TableRow>
                ) : filteredStudents.length === 0 ? (
                  <TableRow><TableCell colSpan={showOwnershipColumn ? 8 : 7} className="text-center py-12 text-muted-foreground">未找到匹配的{copy.person}。</TableCell></TableRow>
                ) : (
                  filteredStudents.map((student) => (
                    <TableRow key={student.id}>
                      <TableCell>
                        <Checkbox
                          aria-label={`选择 ${student.full_name}`}
                          checked={selectedStudentIds.includes(student.id)}
                          onCheckedChange={() => toggleStudentSelection(student.id)}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-semibold text-foreground/80">{student.full_name}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{student.phone || student.username}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{student.student_id || "-"}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {student.class_name || "未分配"}
                        </span>
                      </TableCell>
                      {showOwnershipColumn && (
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-medium",
                              student.owner_teacher_id === null
                                ? "bg-muted text-muted-foreground"
                                : "bg-emerald-50 text-emerald-700"
                            )}
                          >
                            {student.owner_teacher_id === null ? "未分配" : `我的${copy.person}`}
                          </span>
                        </TableCell>
                      )}
                      <TableCell>
                        <span className={cn("h-2 w-2 rounded-full inline-block", student.is_active ? "bg-emerald-500" : "bg-rose-500")} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`重置密码 ${student.full_name}`}
                            disabled={resettingStudentId === student.id}
                            onClick={() => void resetStudentPassword(student)}
                          >
                            <KeyRound />
                            {resettingStudentId === student.id ? "重置中" : "重置密码"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`${showOwnershipColumn ? "删除" : "移除"} ${student.full_name}`}
                            className="text-destructive hover:text-destructive"
                            onClick={() => void deleteStudents([student.id])}
                          >
                            {showOwnershipColumn ? "删除" : "移除"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>}
        </div>
      </main>

      {isCompact && <Dialog open={isClassPickerOpen} onOpenChange={(open) => { setIsClassPickerOpen(open); if (!open) { setIsManagingClasses(false); setClassSearchTerm(""); } }}>
        <DialogContent className="top-0 flex h-dvh max-h-dvh flex-col gap-0 translate-y-0 rounded-none border-0 p-0 shadow-none sm:rounded-none md:top-1/2 md:h-auto md:max-h-[80vh] md:translate-y-[-50%] md:rounded-xl md:border md:p-6">
          <DialogHeader className="shrink-0 border-b border-border px-4 pb-3 pt-5 text-left md:border-0 md:p-0">
            {isManagingClasses && <Button variant="ghost" size="sm" className="mb-2 w-fit px-0" onClick={() => setIsManagingClasses(false)}><ArrowLeft /> 返回选择</Button>}
            <DialogTitle>{isManagingClasses ? `管理${copy.group}` : `选择${copy.group}`}</DialogTitle>
            <DialogDescription className="sr-only">{isManagingClasses ? `管理当前可访问的${copy.group}` : `搜索并切换当前列表的${copy.group}范围`}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3 md:p-0">
            {isManagingClasses ? <>
              <div className="divide-y divide-border/70 rounded-md border border-border/70">
                {classes.map((item) => <div key={item.id} className="flex min-h-12 items-center justify-between gap-3 px-3">
                  <span className="min-w-0 truncate text-sm">{item.name}</span>
                  <Button variant="ghost" size="sm" className="shrink-0 text-destructive hover:text-destructive" onClick={() => void handleDeleteClass(item.id, item.name)}><Trash2 /> 删除</Button>
                </div>)}
                {classes.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">暂无{copy.group}</p>}
              </div>
              <Button variant="outline" className="mt-4 w-full" onClick={() => { setIsClassPickerOpen(false); setIsManagingClasses(false); setIsAddClassDialogOpen(true); }}><Plus /> 新建{copy.group}</Button>
            </> : <>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label={`搜索${copy.group}`} className="pl-9" placeholder={`搜索${copy.group}`} value={classSearchTerm} onChange={(event) => setClassSearchTerm(event.target.value)} />
            </div>
            <div className="flex flex-col divide-y divide-border/70 rounded-md border border-border/70">
              {[
                { id: "all", name: copy.allPeople },
                { id: "unassigned", name: copy.unassignedGroup },
                ...matchingClasses,
              ].map((item) => <div key={item.id} className="flex min-h-12 items-center gap-1 px-1">
                <button type="button" className="min-h-12 min-w-0 flex-1 truncate px-3 text-left text-sm" onClick={() => changeClass(item.id)} aria-current={selectedClassId === item.id ? "true" : undefined}>
                  {item.name}
                  {selectedClassId === item.id && <span className="ml-2 text-xs text-muted-foreground">当前</span>}
                </button>
              </div>)}
              {matchingClasses.length === 0 && classSearchTerm.trim() && <p className="px-4 py-3 text-sm text-muted-foreground">没有匹配的{copy.group}</p>}
            </div>
            <Button variant="ghost" className="mt-4 w-full text-muted-foreground" onClick={() => { setClassSearchTerm(""); setIsManagingClasses(true); }}>管理{copy.group}</Button>
            </>}
          </div>
        </DialogContent>
      </Dialog>}

      {isCompact && <Dialog open={activeStudentId !== null} onOpenChange={(open) => { if (!open) setActiveStudentId(null); }}>
        <DialogContent className="top-0 flex h-dvh max-h-dvh flex-col gap-0 translate-y-0 rounded-none border-0 p-0 shadow-none sm:rounded-none md:top-1/2 md:h-auto md:max-h-[80vh] md:translate-y-[-50%] md:rounded-xl md:border md:p-6">
          {activeStudent && <>
            <DialogHeader className="shrink-0 border-b border-border px-4 pb-4 pt-5 text-left md:border-0 md:p-0">
              <Button variant="ghost" size="sm" className="mb-3 w-fit px-0" onClick={() => setActiveStudentId(null)}><ArrowLeft /> 返回列表</Button>
              <DialogTitle>{activeStudent.full_name}</DialogTitle>
              <DialogDescription>{activeStudent.class_name || copy.unassignedGroup}</DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 md:p-0">
              <dl className="divide-y divide-border/70 rounded-lg border border-border/70 px-4 text-sm">
                <div className="flex justify-between gap-3 py-3"><dt className="text-muted-foreground">{copy.persona === "teacher" ? "学号" : "编号"}</dt><dd className="break-all text-right">{activeStudent.student_id || "未填写"}</dd></div>
                <div className="flex justify-between gap-3 py-3"><dt className="text-muted-foreground">账号</dt><dd className="break-all text-right">{activeStudent.phone || activeStudent.username}</dd></div>
                <div className="flex justify-between gap-3 py-3"><dt className="text-muted-foreground">状态</dt><dd>{activeStudent.is_active ? "正常" : "已停用"}</dd></div>
                {showOwnershipColumn && <div className="flex justify-between gap-3 py-3"><dt className="text-muted-foreground">归属</dt><dd>{activeStudent.owner_teacher_id === null ? "未分配" : `我的${copy.person}`}</dd></div>}
              </dl>
              <div className="flex flex-col gap-2">
                <Button variant="outline" className="min-h-11 justify-start" disabled={resettingStudentId === activeStudent.id} onClick={() => void resetStudentPassword(activeStudent)}><KeyRound /> {resettingStudentId === activeStudent.id ? "重置中" : "重置密码"}</Button>
                <Button variant="ghost" className="min-h-11 justify-start text-destructive hover:text-destructive" onClick={() => void deleteStudents([activeStudent.id])}><Trash2 /> {role === "platform_admin" ? "删除账号" : `移除${copy.person}`}</Button>
              </div>
            </div>
          </>}
        </DialogContent>
      </Dialog>}

      {/* Dialogs: Add Student, Import, Add Class, Import Result */}
      <Dialog open={isAddClassDialogOpen} onOpenChange={setIsAddClassDialogOpen}>
        <DialogContent className="top-0 flex max-h-dvh min-h-dvh flex-col gap-0 translate-y-0 overflow-y-auto rounded-none p-5 sm:rounded-none md:top-1/2 md:min-h-0 md:translate-y-[-50%] md:max-w-[400px] md:rounded-xl md:p-6">
          <form onSubmit={handleAddClass} className="flex min-h-[calc(100dvh-2.5rem)] flex-col md:min-h-0">
            <DialogHeader><DialogTitle>新建{copy.group}</DialogTitle></DialogHeader>
            <div className="py-4">
              <Label htmlFor="className">{copy.group}名称</Label>
              <Input
                id="className"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                placeholder={copy.persona === "teacher" ? "例如：2024级计算机1班" : "例如：技术一部"}
                className="mt-2"
                required
              />
            </div>
            <DialogFooter className="mt-auto pb-[env(safe-area-inset-bottom)]"><Button type="submit">确认创建</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddAddDialogOpen}>
        <DialogContent className="top-0 flex max-h-dvh min-h-dvh flex-col gap-0 translate-y-0 overflow-y-auto rounded-none p-5 sm:rounded-none md:top-1/2 md:min-h-0 md:translate-y-[-50%] md:max-w-[425px] md:rounded-xl md:p-6">
          <form onSubmit={handleAddStudent} className="flex min-h-[calc(100dvh-2.5rem)] flex-col md:min-h-0">
            <DialogHeader><DialogTitle>添加新{copy.person}</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">姓名</Label>
                <Input id="name" required value={newStudent.full_name} onChange={(e) => setNewStudent({ ...newStudent, full_name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">手机号</Label>
                <Input id="phone" required value={newStudent.phone} onChange={(e) => setNewStudent({ ...newStudent, phone: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sid">{copy.persona === "teacher" ? "学号" : "编号"} (可选)</Label>
                <Input id="sid" value={newStudent.student_id} onChange={(e) => setNewStudent({ ...newStudent, student_id: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>所属{copy.group}</Label>
                <Select value={newStudent.class_id} onValueChange={(val) => setNewStudent({ ...newStudent, class_id: val })}>
                  <SelectTrigger><SelectValue placeholder={`选择${copy.group} (可选)`} /></SelectTrigger>
                  <SelectContent>
                    {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="mt-auto pb-[env(safe-area-inset-bottom)]"><Button type="submit">确认添加</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>批量导入{copy.person}</DialogTitle>
              <DialogDescription>
              {isScopedClassSelected ? `正在向 ${selectedClassName} 导入${copy.person}` : `导入${copy.person}数据`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-4 border border-blue-100 dark:border-blue-800 flex gap-3">
              <Info className="w-5 h-5 text-blue-600 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-blue-900">格式要求：</p>
                <p className="text-blue-800/80">
                  表格须包含“姓名”，及“手机号”或“{copy.persona === "teacher" ? "学号" : "编号"}”。若无手机号，默认以{copy.persona === "teacher" ? "学号" : "编号"}作为登录账号与初始密码。{isScopedClassSelected ? `未填${copy.group}时自动归入当前${copy.group}。` : `若包含${copy.group}列将自动归类。`}
                </p>
              </div>
            </div>
            <div
              className={cn(
                "relative cursor-pointer rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-12",
                dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/20 hover:border-primary/50"
              )}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files[0];
                if (file) {
                  void processFile(file);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void processFile(file);
                  }
                }}
                accept=".xlsx,.xls,.csv"
                className="hidden"
              />
              {importing ? <div className="flex flex-col items-center gap-2"><FileSpreadsheet className="w-8 h-8 animate-bounce text-primary" /><p className="text-sm font-medium">处理中...</p></div> : <><Upload className="w-8 h-8 mb-2 text-muted-foreground" /><p className="text-sm font-medium">点击或拖拽文件上传</p></>}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Result Dialog */}
      <Dialog open={isResultDialogOpen} onOpenChange={setIsResultDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {importResult && importResult.failed_count === 0 ? (
                <><CheckCircle2 className="w-5 h-5 text-emerald-500" /> 导入完成</>
              ) : (
                <><AlertCircle className="w-5 h-5 text-amber-500" /> 导入结果反馈</>
              )}
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 border border-emerald-100 dark:border-emerald-800 text-center">
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{importResult?.success_count ?? 0}</p>
                <p className="text-xs text-emerald-800/70 dark:text-emerald-400/70">成功导入</p>
              </div>
              <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 p-3 border border-rose-100 dark:border-rose-800 text-center">
                <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{importResult?.failed_count ?? 0}</p>
                <p className="text-xs text-rose-800/70 dark:text-rose-400/70">导入失败</p>
              </div>
            </div>

            {importResult && importResult.errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">异常详情清单</p>
                <div className="max-h-[200px] overflow-y-auto rounded-md border border-border/50 bg-muted/30 p-2">
                  <ul className="space-y-1.5 text-xs text-foreground/80">
                    {importResult.errors.map((err, i) => (
                      <li key={i} className="flex gap-2 leading-relaxed">
                        <span className="text-rose-500 font-bold shrink-0">•</span>
                        <span>{err}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setIsResultDialogOpen(false)}>我知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

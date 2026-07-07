import { useGetIdentity, usePermissions } from "@refinedev/core";
import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Upload, Search, FileSpreadsheet, X, Info, Users, CheckCircle2, AlertCircle, Trash2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
  const [importing, setImporting] = useState(false);
  const [resettingStudentId, setResettingStudentId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasLoadedStudentsRef = useRef(false);
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
      setStudents(data);
      hasLoadedStudentsRef.current = true;
    } catch {
      toast({
        title: "加载失败",
        description: `无法获取${copy.person}列表`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setIsRefreshing(false);
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
      if (selectedClassId === id) setSelectedClassId("all");
      fetchClasses();
      void fetchStudents();
    } catch {
      // ignore delete failures here; existing UI keeps current state
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
    const confirmed = window.confirm(
      isBatch ? `确定要批量删除这 ${studentIds.length} 个${copy.person}吗？` : `确定要删除这个${copy.person}吗？`
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
          title: result.failed_count === 0 ? "批量删除成功" : "批量删除已完成",
          description:
            result.failed_count === 0
              ? `已处理 ${result.success_count} 个${copy.person}。`
              : `成功 ${result.success_count} 个，失败 ${result.failed_count} 个。`,
          variant: result.failed_count === 0 ? "default" : "destructive",
        });
      } else {
        await apiRequest(`/rbac/students/${studentIds[0]}`, { method: "DELETE" });
        toast({ title: "删除成功", description: `${copy.person}已移除。` });
      }
      setSelectedStudentIds((current) => current.filter((id) => !studentIds.includes(id)));
      await fetchStudents();
    } catch (error: unknown) {
      toast({
        title: "删除失败",
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
    <div className="flex h-full min-h-0 gap-0 overflow-hidden">
      {/* Left Sidebar: Classes */}
      <aside className="w-64 border-r border-border/60 bg-muted/10 flex flex-col">
        <div className="p-4 border-b border-border/60 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">{copy.group}列表</h2>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsAddClassDialogOpen(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          <button
            onClick={() => setSelectedClassId("all")}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors",
              selectedClassId === "all" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            )}
          >
            <Users className="h-4 w-4" />
            <span>{copy.allPeople}</span>
          </button>
          <button
            onClick={() => setSelectedClassId("unassigned")}
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
                onClick={() => setSelectedClassId(c.id)}
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
                className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:bg-destructive/10 rounded"
              >
                <X className="h-3 w-3 m-auto" />
              </button>
            </div>
          ))}
        </nav>
      </aside>

      {/* Main Content: Student List */}
      <main className="flex-1 flex flex-col min-w-0 bg-background">
        <div className="p-6 space-y-6 overflow-y-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-base font-bold tracking-tight">
                {selectedClassId === "all"
                  ? copy.allPeople
                  : selectedClassId === "unassigned"
                    ? copy.unassignedPeople
                    : selectedClassName}
              </h1>
              <p className="text-sm text-muted-foreground">
                管理{copy.person}账号，新建账号初始密码默认为手机号；重置密码时优先使用{copy.persona === "teacher" ? "学号" : "编号"}，无{copy.persona === "teacher" ? "学号" : "编号"}则使用账号。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setIsImportDialogOpen(true)}>
                <Upload className="w-4 h-4 mr-2" />
                批量导入
              </Button>
              <Button onClick={() => setIsAddAddDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                添加{copy.person}
              </Button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder={`搜索姓名、手机号或${copy.persona === "teacher" ? "学号" : "编号"}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
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
                批量删除
              </Button>
            ) : null}
          </div>

          <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
            <Table>
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
                      <TableCell className="font-semibold text-foreground/80">{student.full_name}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{student.phone || student.username}</TableCell>
                      <TableCell className="text-muted-foreground">{student.student_id || "-"}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted text-[10px] font-medium text-muted-foreground">
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
                            aria-label={`删除 ${student.full_name}`}
                            className="text-destructive hover:text-destructive"
                            onClick={() => void deleteStudents([student.id])}
                          >
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </main>

      {/* Dialogs: Add Student, Import, Add Class, Import Result */}
      <Dialog open={isAddClassDialogOpen} onOpenChange={setIsAddClassDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <form onSubmit={handleAddClass}>
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
            <DialogFooter><Button type="submit">确认创建</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddAddDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleAddStudent}>
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
            <DialogFooter><Button type="submit">确认添加</Button></DialogFooter>
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
                  必须包含"姓名"，并提供"手机号"或"{copy.persona === "teacher" ? "学号" : "编号"}"。无手机号时使用{copy.persona === "teacher" ? "学号" : "编号"}作为账号和初始密码；识别到{copy.group}会自动创建或复用{copy.group}。
                  {isScopedClassSelected ? `如果文件中没有${copy.group}，导入的${copy.person}将自动加入当前${copy.group}。` : ""}
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

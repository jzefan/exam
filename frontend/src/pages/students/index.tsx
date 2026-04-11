import { usePermissions } from "@refinedev/core";
import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Upload, Search, FileSpreadsheet, X, Info, Users, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import {
  buildStudentBatchImportItems,
  parseStudentImportFile,
  type StudentImportClassOption,
} from "@/components/students/student-import-utils";

type ClassItem = StudentImportClassOption;

interface Student {
  id: string;
  full_name: string;
  phone: string;
  student_id: string;
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

export default function StudentManagementPage() {
  const { data: role } = usePermissions<string>({});
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | "all">("all");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    setLoading(true);
    try {
      const url = selectedClassId === "all" ? "/rbac/students" : `/rbac/students?class_id=${selectedClassId}`;
      const data = await apiRequest<Student[]>(url);
      setStudents(data);
    } catch {
      toast({
        title: "加载失败",
        description: "无法获取学生列表",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [selectedClassId, toast]);

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
      toast({ title: "创建成功", description: `班级 ${newClassName} 已创建。` });
      setNewClassName("");
      setIsAddClassDialogOpen(false);
      fetchClasses();
    } catch {
      toast({ title: "创建失败", variant: "destructive" });
    }
  };

  const handleDeleteClass = async (id: string, name: string) => {
    if (!confirm(`确定要删除班级 "${name}" 吗？学生将变为未分配班级状态。`)) return;
    try {
      await apiRequest(`/rbac/students/classes/${id}`, { method: "DELETE" });
      toast({ title: "已删除" });
      if (selectedClassId === id) setSelectedClassId("all");
      fetchClasses();
      fetchStudents();
    } catch {
      // ignore delete failures here; existing UI keeps current state
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest("/rbac/students", {
        method: "POST",
        body: JSON.stringify(newStudent),
      });
      toast({
        title: "添加成功",
        description: `学生 ${newStudent.full_name} 已添加。`,
      });
      setIsAddAddDialogOpen(false);
      setNewStudent({ full_name: "", phone: "", student_id: "", class_id: undefined });
      fetchStudents();
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
        fallbackClassId: selectedClassId === "all" ? undefined : selectedClassId,
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
      fetchStudents();
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
      s.phone.includes(searchTerm) ||
      (s.student_id && s.student_id.includes(searchTerm))
  );
  const showOwnershipColumn = role === "platform_admin";

  return (
    <div className="flex h-full min-h-0 gap-0 overflow-hidden">
      {/* Left Sidebar: Classes */}
      <aside className="w-64 border-r border-border/60 bg-muted/10 flex flex-col">
        <div className="p-4 border-b border-border/60 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">班级列表</h2>
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
            <span>全部学生</span>
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
                {selectedClassId === "all" ? "全部学生" : classes.find(c => c.id === selectedClassId)?.name}
              </h1>
              <p className="text-sm text-muted-foreground">管理学生账号，初始密码默认为手机号。</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setIsImportDialogOpen(true)}>
                <Upload className="w-4 h-4 mr-2" />
                批量导入
              </Button>
              <Button onClick={() => setIsAddAddDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                添加学生
              </Button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder="搜索姓名、手机号或学号..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>手机号 (账号)</TableHead>
                  <TableHead>学号</TableHead>
                  <TableHead>班级</TableHead>
                  {showOwnershipColumn && <TableHead>归属</TableHead>}
                  <TableHead className="w-[80px]">状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={showOwnershipColumn ? 6 : 5} className="text-center py-12 text-muted-foreground animate-pulse">正在加载...</TableCell></TableRow>
                ) : filteredStudents.length === 0 ? (
                  <TableRow><TableCell colSpan={showOwnershipColumn ? 6 : 5} className="text-center py-12 text-muted-foreground">未找到匹配的学生。</TableCell></TableRow>
                ) : (
                  filteredStudents.map((student) => (
                    <TableRow key={student.id}>
                      <TableCell className="font-semibold text-foreground/80">{student.full_name}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{student.phone}</TableCell>
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
                            {student.owner_teacher_id === null ? "未分配" : "我的学生"}
                          </span>
                        </TableCell>
                      )}
                      <TableCell>
                        <span className={cn("h-2 w-2 rounded-full inline-block", student.is_active ? "bg-emerald-500" : "bg-rose-500")} />
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
            <DialogHeader><DialogTitle>新建班级</DialogTitle></DialogHeader>
            <div className="py-4">
              <Label htmlFor="className">班级名称</Label>
              <Input id="className" value={newClassName} onChange={(e) => setNewClassName(e.target.value)} placeholder="例如：2024级计算机1班" className="mt-2" required />
            </div>
            <DialogFooter><Button type="submit">确认创建</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddAddDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleAddStudent}>
            <DialogHeader><DialogTitle>添加新学生</DialogTitle></DialogHeader>
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
                <Label htmlFor="sid">学号 (可选)</Label>
                <Input id="sid" value={newStudent.student_id} onChange={(e) => setNewStudent({ ...newStudent, student_id: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>所属班级</Label>
                <Select value={newStudent.class_id} onValueChange={(val) => setNewStudent({ ...newStudent, class_id: val })}>
                  <SelectTrigger><SelectValue placeholder="选择班级 (可选)" /></SelectTrigger>
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
            <DialogTitle>批量导入学生</DialogTitle>
            <DialogDescription>
              {selectedClassId !== "all" ? `正在向 "${classes.find(c => c.id === selectedClassId)?.name}" 导入学生` : "导入学生数据"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-4 border border-blue-100 dark:border-blue-800 flex gap-3">
              <Info className="w-5 h-5 text-blue-600 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-blue-900">格式要求：</p>
                <p className="text-blue-800/80">必须包含"姓名"和"手机号"列。{selectedClassId === "all" ? "将作为未分配班级学生导入。" : "导入的学生将自动加入当前班级。"}</p>
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

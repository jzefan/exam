import { useId, useState, useRef } from "react";
import { useList } from "@refinedev/core";
import { Search, Check, Upload, Plus, X, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { IUser } from "@/types";

type Mode = "select" | "import" | "manual";

export function StudentSelector({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [mode, setMode] = useState<Mode>("select");
  const [search, setSearch] = useState("");
  const [manualUsername, setManualUsername] = useState("");
  const [importResults, setImportResults] = useState<string[]>([]);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [manualFeedback, setManualFeedback] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const modeId = useId();

  const selectedSet = new Set(selectedIds);

  // Load students
  const { query: userQuery } = useList<IUser>({
    resource: "users",
    pagination: { currentPage: 1, pageSize: 200 },
    filters: [{ field: "role", operator: "eq", value: "student" }],
  });
  const users = userQuery.data?.data ?? [];
  const isLoading = userQuery.isLoading;
  const normalizedSearch = search.trim().toLowerCase();
  const visibleUsers = normalizedSearch
    ? users.filter((u) => {
        const username = u.username.toLowerCase();
        const fullName = u.full_name.toLowerCase();
        return username.includes(normalizedSearch) || fullName.includes(normalizedSearch);
      })
    : users;

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportMessage(null);

    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      if (wb.SheetNames.length === 0) {
        throw new Error("文件中没有可读取的工作表。");
      }
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);
      if (rows.length === 0) {
        throw new Error("文件内容为空，请检查模板。");
      }

      // Match by username or full_name
      const matched: string[] = [];
      const unmatched: string[] = [];
      for (const row of rows) {
        const name = row["姓名"] || row["username"] || row["name"] || "";
        const user = users.find(
          (u) => u.username === name || u.full_name === name,
        );
        if (user) {
          matched.push(user.id);
        } else if (name) {
          unmatched.push(name);
        }
      }

      // Merge with existing selection
      const merged = [...new Set([...selectedIds, ...matched])];
      onChange(merged);
      setImportResults(unmatched);
      setImportMessage(
        matched.length > 0
          ? `已匹配 ${matched.length} 名学生${unmatched.length > 0 ? `，另有 ${unmatched.length} 名未匹配。` : "。"}`
          : "没有匹配到任何系统学生。",
      );
    } catch (error) {
      setImportResults([]);
      setImportError(
        error instanceof Error
          ? error.message
          : "文件解析失败，请上传包含“姓名”或“username”列的 Excel 文件。",
      );
    }
    // Reset file input
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleManualAdd = () => {
    const username = manualUsername.trim();
    if (!username) return;
    const user = users.find(
      (u) => u.username === username || u.full_name === username,
    );
    if (!user) {
      setManualFeedback("未找到对应学生，请检查用户名或姓名是否正确。");
    } else if (selectedSet.has(user.id)) {
      setManualFeedback("该学生已经在已选列表中。");
    } else {
      onChange([...selectedIds, user.id]);
      setManualFeedback(`已添加学生：${user.full_name || user.username}。`);
    }
    setManualUsername("");
  };

  const modeButtons: { key: Mode; label: string; icon: React.ReactNode }[] = [
    { key: "select", label: "从列表选择", icon: <Check size={14} /> },
    { key: "import", label: "Excel导入", icon: <Upload size={14} /> },
    { key: "manual", label: "手动添加", icon: <Plus size={14} /> },
  ];

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          已选 <span className="font-semibold text-foreground">{selectedIds.length}</span> 名考生
        </p>
        {selectedIds.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            清空选择
          </Button>
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
          <div className="border rounded-lg divide-y max-h-[300px] overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">加载中...</div>
            ) : visibleUsers.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <Users size={24} className="mx-auto mb-2 opacity-25" />
                {normalizedSearch ? "没有匹配的学生" : "暂无学生"}
              </div>
            ) : (
              visibleUsers.map((u) => {
                const isSelected = selectedSet.has(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    aria-pressed={isSelected}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 ${
                      isSelected ? "bg-primary/5" : ""
                    }`}
                    onClick={() => toggle(u.id)}
                  >
                    <div
                      className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-input"
                      }`}
                    >
                      {isSelected && <Check size={12} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{u.full_name}</p>
                      <p className="text-xs text-muted-foreground">{u.username}</p>
                    </div>
                  </button>
                );
              })
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
              上传 Excel 文件，包含"姓名"或"username"列
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
                以下学生未匹配到系统用户：
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
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs" htmlFor={`${modeId}-manual-input`}>
                用户名或姓名
              </Label>
              <Input
                id={`${modeId}-manual-input`}
                placeholder="输入用户名或姓名"
                value={manualUsername}
                onChange={(e) => setManualUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleManualAdd();
                }}
                className="h-9 text-sm"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-9 sm:min-w-20"
              disabled={!manualUsername.trim()}
              onClick={handleManualAdd}
            >
              <Plus size={14} className="mr-1" />
              添加
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            输入学生的用户名或姓名，系统将自动匹配已有学生
          </p>
          {manualFeedback && (
            <div className="rounded-lg border border-border bg-muted/60 p-3 text-sm text-foreground" role="status">
              {manualFeedback}
            </div>
          )}
        </div>
      )}

      {/* Selected list preview */}
      {selectedIds.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">已选考生</p>
          <div className="flex flex-wrap gap-1.5">
            {selectedIds.slice(0, 20).map((id) => {
              const user = users.find((u) => u.id === id);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 bg-muted rounded-md px-2 py-1 text-xs"
                >
                  {user?.full_name ?? user?.username ?? id.slice(0, 8)}
                  <button
                    type="button"
                    aria-label={`移除考生 ${user?.full_name ?? user?.username ?? id.slice(0, 8)}`}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => toggle(id)}
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            })}
            {selectedIds.length > 20 && (
              <span className="text-xs text-muted-foreground py-1">
                ...还有 {selectedIds.length - 20} 人
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

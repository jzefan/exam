import { Fragment, useEffect, useMemo, useState } from "react";

import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";

import { OperationsTabs } from "./components/OperationsTabs";

type ActivityLog = {
  id: string;
  user_id: string | null;
  username: string | null;
  full_name: string | null;
  role_name: string | null;
  event_category: string;
  event_type: string;
  target_type: string | null;
  target_id: string | null;
  event_metadata: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  success: boolean;
  created_at: string;
};

type ActivityLogsResponse = {
  items: ActivityLog[];
  total: number;
  page: number;
  page_size: number;
};

type Facets = {
  event_categories: string[];
  event_types: string[];
  roles: string[];
};

const CATEGORY_LABELS: Record<string, string> = {
  auth: "登录/注册",
  exam: "考试",
  question: "题库",
};

const EVENT_LABELS: Record<string, string> = {
  login: "登录",
  register: "注册",
  exam_start: "开始考试",
  exam_submit: "提交考试",
  exam_retake: "重新作答",
  question_create: "创建题目",
  question_ai_generate: "AI 出题",
  question_import: "批量导入",
};

const ROLE_LABELS: Record<string, string> = {
  platform_admin: "平台管理员",
  school_admin: "学校管理员",
  enterprise_admin: "企业管理员",
  teacher: "教师",
  evaluator: "评估者",
  assessee: "被评估者",
  student: "学生",
  external_guest: "外部考生",
};

function prettyCategory(value: string) {
  return CATEGORY_LABELS[value] ?? value;
}

function prettyEvent(value: string) {
  return EVENT_LABELS[value] ?? value;
}

function prettyRole(value: string | null | undefined) {
  if (!value) return "—";
  return ROLE_LABELS[value] ?? value;
}

function formatTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

const PAGE_SIZE = 20;

export function OperationsActivityLogsPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<ActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [userSearch, setUserSearch] = useState("");
  const [debouncedUserSearch, setDebouncedUserSearch] = useState("");
  const [roleName, setRoleName] = useState<string>("all");
  const [eventCategory, setEventCategory] = useState<string>("all");
  const [eventType, setEventType] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [facets, setFacets] = useState<Facets>({
    event_categories: [],
    event_types: [],
    roles: [],
  });

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedUserSearch(userSearch.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [userSearch]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<Facets>("/api/operations/activity-logs/facets")
      .then((resp) => {
        if (!cancelled) setFacets(resp.data);
      })
      .catch(() => {
        // Facet failure is non-fatal — filters still work with text input.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string> = {
      page: String(page),
      page_size: String(PAGE_SIZE),
    };
    if (debouncedUserSearch) params.user_search = debouncedUserSearch;
    if (roleName !== "all") params.role_name = roleName;
    if (eventCategory !== "all") params.event_category = eventCategory;
    if (eventType !== "all") params.event_type = eventType;
    if (dateFrom) params.date_from = dateFrom.toISOString();
    if (dateTo) params.date_to = dateTo.toISOString();

    apiClient
      .get<ActivityLogsResponse>("/api/operations/activity-logs", { params })
      .then((resp) => {
        if (cancelled) return;
        setItems(resp.data.items);
        setTotal(resp.data.total);
      })
      .catch((error) => {
        if (cancelled) return;
        toast({
          title: "加载活动日志失败",
          description:
            error?.response?.data?.detail || "请稍后再试，或检查网络与权限。",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, debouncedUserSearch, roleName, eventCategory, eventType, dateFrom, dateTo, toast]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const hasFilters =
    userSearch ||
    roleName !== "all" ||
    eventCategory !== "all" ||
    eventType !== "all" ||
    dateFrom ||
    dateTo;

  function resetFilters() {
    setUserSearch("");
    setRoleName("all");
    setEventCategory("all");
    setEventType("all");
    setDateFrom(undefined);
    setDateTo(undefined);
    setPage(1);
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <section className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div className="flex flex-col gap-3">
          <OperationsTabs />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">活动日志</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              查看用户登录、注册、考试与题库等关键操作的发生情况。可按角色与事件类型过滤。
            </p>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-muted/5 p-4">
        <div className="relative min-w-[240px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
          <Input
            placeholder="搜索用户名 / 姓名"
            value={userSearch}
            onChange={(e) => {
              setUserSearch(e.target.value);
              setPage(1);
            }}
            className="h-9 w-full pl-9 text-xs font-medium border-border/60 focus-visible:ring-primary/20"
          />
        </div>

        <Select
          value={roleName}
          onValueChange={(value) => {
            setRoleName(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-[140px] text-xs font-medium">
            <SelectValue placeholder="所有角色" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有角色</SelectItem>
            {facets.roles.map((role) => (
              <SelectItem key={role} value={role}>
                {prettyRole(role)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={eventCategory}
          onValueChange={(value) => {
            setEventCategory(value);
            setEventType("all");
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-[140px] text-xs font-medium">
            <SelectValue placeholder="所有类别" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有类别</SelectItem>
            {facets.event_categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {prettyCategory(cat)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={eventType}
          onValueChange={(value) => {
            setEventType(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-[160px] text-xs font-medium">
            <SelectValue placeholder="所有事件" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有事件</SelectItem>
            {facets.event_types.map((t) => (
              <SelectItem key={t} value={t}>
                {prettyEvent(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2 ml-auto">
          <DatePicker
            value={dateFrom}
            onChange={(d) => {
              setDateFrom(d);
              setPage(1);
            }}
            placeholder="起始日期"
            className="h-9 w-[130px] text-xs font-medium"
          />
          <span className="text-muted-foreground/40 text-xs">至</span>
          <DatePicker
            value={dateTo}
            onChange={(d) => {
              setDateTo(d);
              setPage(1);
            }}
            placeholder="截止日期"
            className="h-9 w-[130px] text-xs font-medium"
          />
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-3 text-xs font-bold text-muted-foreground hover:text-foreground"
              onClick={resetFilters}
            >
              清除筛选
            </Button>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border/40 bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[170px]">时间</TableHead>
              <TableHead>用户</TableHead>
              <TableHead className="w-[120px]">角色</TableHead>
              <TableHead className="w-[120px]">类别</TableHead>
              <TableHead className="w-[140px]">事件</TableHead>
              <TableHead className="w-[120px]">IP</TableHead>
              <TableHead className="w-[80px]">状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                  加载中…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                  没有符合条件的活动日志
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => {
                const isExpanded = expandedId === item.id;
                const metaText = item.event_metadata
                  ? JSON.stringify(item.event_metadata, null, 2)
                  : null;
                return (
                  <Fragment key={item.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    >
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTime(item.created_at)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">
                            {item.full_name || item.username || "(未登录)"}
                          </span>
                          {item.username && item.full_name && (
                            <span className="text-[11px] text-muted-foreground">{item.username}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{prettyRole(item.role_name)}</TableCell>
                      <TableCell className="text-xs">{prettyCategory(item.event_category)}</TableCell>
                      <TableCell className="text-xs">{prettyEvent(item.event_type)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.ip_address ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[11px]",
                            item.success
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                              : "border-destructive/30 bg-destructive/10 text-destructive",
                          )}
                        >
                          {item.success ? "成功" : "失败"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs">
                          <div className="grid grid-cols-1 gap-3 py-2 md:grid-cols-2">
                            <div>
                              <p className="font-semibold text-foreground">目标</p>
                              <p className="text-muted-foreground">
                                {item.target_type ? `${item.target_type} · ${item.target_id ?? "—"}` : "—"}
                              </p>
                            </div>
                            <div>
                              <p className="font-semibold text-foreground">User-Agent</p>
                              <p className="break-all text-muted-foreground">
                                {item.user_agent ?? "—"}
                              </p>
                            </div>
                            {metaText && (
                              <div className="md:col-span-2">
                                <p className="font-semibold text-foreground">附加信息</p>
                                <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-border/60 bg-background p-2 text-[11px] text-muted-foreground">
                                  {metaText}
                                </pre>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>

        {items.length > 0 && (
          <div className="flex items-center justify-between border-t border-border/40 p-3 text-xs text-muted-foreground">
            <span>
              共 {total} 条 · 第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export default OperationsActivityLogsPage;

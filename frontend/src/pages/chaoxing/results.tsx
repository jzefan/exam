import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { connectionFetch, connectionRequest } from "./api";
import type { SavedExam, SavedItem, SavedPaper } from "./api";
import { buildQuestionPreview } from "./question-preview";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";

const statuses: Record<string, string> = { pending: "待评分", queued: "排队中", running: "评分中", review: "待教师确认", confirmed: "已确认", manual: "需人工评分", source: "沿用学习通客观分", failed: "评分失败", obsolete: "历史任务已停止" };
const display = (value: number | null | undefined) => value ?? "—";

function ItemReview({ item, disabled, historical, onConfirm }: { item: SavedItem; disabled: boolean; historical: boolean; onConfirm: (id: string, body: object) => Promise<void> }) {
  const [draftScore, setScore] = useState<string | null>(null);
  const score = draftScore ?? String(item.confirmed_score ?? item.ai_score ?? (item.objective ? item.source_score : null) ?? "");
  const [maximum, setMaximum] = useState("");
  const [draftReason, setReason] = useState<string | null>(null);
  const reason = draftReason ?? item.comment;
  const valid = score.trim() !== "" && Number.isFinite(Number(score)) && Number(score) >= 0 && Number(score) <= (item.max_score ?? Number(maximum)) && (item.max_score != null || Number(maximum) > 0);
  return <article className="space-y-3 text-sm">
    <QuestionPreviewCard
      question={buildQuestionPreview(item)}
      index={item.position}
      mode="compact"
      expandOnClick
      hideAnswer
      hideMeta
      hideSourceBadge
      hideScoreAndDifficulty
      className="cursor-pointer transition-colors hover:border-primary/40"
      trailing={<span className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><span>满分 {display(item.max_score)}</span><span>{statuses[item.status] ?? item.status}</span></span>}
    >
      <div className="mt-3"><h4 className="mb-1 text-xs text-muted-foreground">考生答案</h4><pre className="whitespace-pre-wrap break-words rounded bg-muted/40 p-3 font-mono text-xs">{item.student_answer || "无文字答案"}</pre></div>
    </QuestionPreviewCard>
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs"><span>学习通得分 {display(item.source_score)}</span><span>AI 建议 {display(item.ai_score)}</span><span className="font-medium">教师确认 {display(item.confirmed_score)}</span></div>
    {item.binding_version && <p className="text-xs text-muted-foreground">评分配置版本 {item.binding_version} · 主评与复核</p>}
    {item.feedback && <div className="space-y-1 border-l-2 border-border pl-3 text-xs text-muted-foreground">
      {[...Object.values(item.feedback.dimension_comments), ...item.feedback.deduction_reasons, ...item.feedback.improvement_suggestions].map((text, i) => <p key={i} className="whitespace-pre-wrap break-words">{text}</p>)}
      {item.feedback.risk_flags.length > 0 && <p>需核对：{item.feedback.risk_flags.join("；")}</p>}
    </div>}
    {item.requires_manual_review && <p className="text-xs text-muted-foreground">题型、附件或评分依据不完整，请对照学习通人工评分。</p>}
    {item.error && <p className="text-xs text-destructive">{item.error}</p>}
    {!historical && <form className="flex flex-wrap items-end gap-3 border-t border-border pt-3" onSubmit={event => { event.preventDefault(); if (valid && !disabled) void onConfirm(item.id, { version: item.version, score: Number(score), reason, ...(item.max_score == null ? { max_score: Number(maximum) } : {}) }); }}>
      {item.max_score == null && <label className="space-y-1 text-xs">题目满分<Input aria-label={`第 ${item.position} 题满分`} className="w-24" type="number" min="0.01" max="100000" step="0.01" value={maximum} onChange={e => setMaximum(e.target.value)} disabled={disabled} required /></label>}
      <label className="space-y-1 text-xs">确认分数<Input aria-label={`第 ${item.position} 题确认分数`} className="w-24" type="number" min="0" max={item.max_score ?? 100000} step="0.01" value={score} onChange={e => setScore(e.target.value)} disabled={disabled} required /></label>
      <label className="min-w-40 flex-1 space-y-1 text-xs">评语<Textarea aria-label={`第 ${item.position} 题评语`} rows={1} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} disabled={disabled} /></label>
      <Button size="sm" variant="outline" type="submit" disabled={disabled || !valid}>{item.status === "confirmed" ? "更新确认分" : "确认分数"}</Button>
    </form>}
  </article>;
}

export function ChaoxingResultsPage() {
  const [params, setParams] = useSearchParams();
  const candidateId = params.get("candidate");
  const revision = params.get("revision");
  const [exams, setExams] = useState<SavedExam[]>([]);
  const [paper, setPaper] = useState<SavedPaper>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const epoch = useRef(0);
  const endpoint = candidateId ? `/grading/candidates/${candidateId}` : "";
  const historical = !!paper && paper.revision !== paper.current_revision;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (candidateId) {
      const data = await connectionRequest<SavedPaper>(`${endpoint}${revision ? `?revision=${revision}` : ""}`, { signal });
      if (!signal?.aborted) setPaper(data);
    } else {
      const data = await connectionRequest<SavedExam[]>("/grading/exams", { signal });
      if (!signal?.aborted) setExams(data);
    }
  }, [candidateId, endpoint, revision]);
  useEffect(() => {
    epoch.current += 1;
    const abort = new AbortController();
    setPaper(undefined); setError(""); setMessage(""); setBusy(true);
    void refresh(abort.signal).catch((cause: unknown) => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "加载失败"); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => { abort.abort(); epoch.current += 1; };
  }, [refresh]);
  const running = !historical && paper?.items.some(i => ["queued", "running"].includes(i.status));
  useEffect(() => {
    if (!running || busy) return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => { void refresh(abort.signal).catch((cause: unknown) => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "刷新失败，请手动刷新"); }); }, 2000);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [running, busy, paper, refresh]);
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    const version = epoch.current;
    try { await work(); }
    catch (cause) { if (version === epoch.current) setError(cause instanceof Error ? cause.message : "操作失败"); }
    finally { inFlight.current = false; if (version === epoch.current) setBusy(false); }
  };
  const exportExam = (id: string) => run(async () => {
    const response = await connectionFetch(`/grading/exams/${id}/export`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = "学习通评分.csv"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-0">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><Button asChild size="icon" variant="ghost"><Link to={candidateId ? "/grading/chaoxing/results" : "/grading/chaoxing"} aria-label="返回"><ArrowLeft /></Link></Button><div><h1 className="text-base font-semibold">学习通阅卷记录</h1><p className="mt-1 text-xs text-muted-foreground">结果保存在本系统，教师确认后形成最终成绩</p></div></div>
      <div className="flex gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => refresh())}><RefreshCw className={busy ? "animate-spin" : ""} />刷新</Button><Button asChild size="sm" variant="outline"><Link to="/grading/chaoxing">读取答卷</Link></Button></div>
    </header>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    {busy && !paper && !exams.length && <p role="status" className="text-sm text-muted-foreground">正在加载…</p>}
    {!candidateId && <>
      {!busy && !exams.length && <p className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">暂无已保存答卷，请先连接学习通读取。</p>}
      {exams.map(exam => <section key={exam.id} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">{exam.course_title} · {exam.title}</h2><p className="mt-1 text-xs text-muted-foreground">已保存 {exam.candidates.length} 份 / 学习通已提交 {display(exam.expected_submitted)} 份</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => void exportExam(exam.id)}><Download />导出成绩</Button></div>
        <div className="overflow-hidden rounded-md border border-border"><Table><TableHeader><TableRow><TableHead>姓名</TableHead><TableHead>学号</TableHead><TableHead>已处理题目</TableHead><TableHead>最终成绩</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{exam.candidates.map(c => <TableRow key={c.id}><TableCell>{c.name}</TableCell><TableCell>{c.student_no}</TableCell><TableCell>{c.totals.resolved_count} / {c.totals.question_count}</TableCell><TableCell>{c.totals.final_score ?? "待确认"}</TableCell><TableCell><Button asChild size="sm" variant="ghost"><Link to={`?candidate=${c.id}`}>查看评分</Link></Button></TableCell></TableRow>)}</TableBody></Table></div>
      </section>)}
    </>}
    {paper && <>
      <section className="space-y-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">{paper.name} · {paper.student_no}</h2><p className="mt-1 text-xs text-muted-foreground">{paper.course_title} · {paper.exam_title}</p></div><div className="flex flex-wrap items-center gap-2">
          {paper.current_revision > 1 && <Select value={String(paper.revision)} disabled={busy} onValueChange={value => setParams({ candidate: paper.id, ...(Number(value) !== paper.current_revision ? { revision: value } : {}) })}><SelectTrigger className="w-36" aria-label="答卷版本"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: paper.current_revision }, (_, i) => i + 1).reverse().map(v => <SelectItem key={v} value={String(v)}>版本 {v}{v === paper.current_revision ? "（当前）" : ""}</SelectItem>)}</SelectContent></Select>}
          {!historical && <Button size="sm" disabled={busy || !paper.items.some(i => ["pending", "failed"].includes(i.status))} onClick={() => void run(async () => {
            const result = await connectionRequest<{ queued: number }>(`${endpoint}/grade`, { method: "POST" });
            await refresh(); setMessage(`已加入 ${result.queued} 道题，使用系统配置的主评与复核模型。`);
          })}>{running && <Loader2 className="animate-spin" />}AI 评分</Button>}
        </div></div>
        {paper.totals && <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs"><span>已处理 {paper.totals.resolved_count} / {paper.totals.question_count} 题</span><span>AI 主观题建议小计 {paper.totals.ai_subjective_score}（{paper.totals.ai_graded_count} 题）</span><span>已确认小计 {paper.totals.confirmed_subtotal}</span><span className="font-semibold">最终成绩 {paper.totals.final_score ?? "待确认"}</span></div>}
        {!historical && <p className="text-xs text-muted-foreground">AI 只评主观题（简答、论述、编程），客观题沿用学习通得分；点开题目可看参考答案。</p>}
        {paper.totals?.score_mismatch && <Alert><AlertDescription>题目满分之和与学习通试卷满分不一致，请重新核对并导入完整答卷。当前不生成最终成绩。</AlertDescription></Alert>}
        {historical && <p className="text-xs text-muted-foreground">历史版本，仅供查看。</p>}
      </section>
      {paper.items.map(item => <ItemReview key={`${paper.revision}:${item.id}`} item={item} historical={historical} disabled={busy} onConfirm={(id, body) => run(async () => {
        await connectionRequest(`${endpoint}/items/${id}/confirm`, { method: "POST", body: JSON.stringify(body) });
        await refresh(); setMessage("确认分数已保存");
      })} />)}
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">操作记录（{paper.audit.length}）</summary><ul className="mt-2 space-y-1">{paper.audit.map((a, i) => <li key={i}>{new Date(a.created_at).toLocaleString()} · {{ "paper.imported": "保存答卷", "grading.queued": "启动评分", "score.confirmed": "确认分数" }[a.action] ?? a.action} · 版本 {String(a.details.revision)}{a.details.score != null ? ` · ${String(a.details.score)} 分` : ""}</li>)}</ul></details>
    </>}
  </div>;
}

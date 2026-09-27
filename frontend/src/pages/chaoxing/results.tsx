import { PaperContent } from "./paper-content";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PixelGrid, PixelLoaderOverlay } from "@/components/ui/pixel-loader";
import { ChaoxingPageHeader } from "./page-header";
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
    questionBody={<PaperContent blocks={item.rich_content?.content} text={String(buildQuestionPreview(item).content.text ?? "")} />}
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
      <div className="mt-3"><h4 className="mb-1 text-xs text-muted-foreground">考生答案</h4><PaperContent blocks={item.rich_content?.student_answer} text={item.student_answer} empty="未读取到答案" /></div>
    </QuestionPreviewCard>
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs"><span>学习通得分 {display(item.source_score)}</span><span>AI 建议 {display(item.ai_score)}</span><span className="font-medium">教师确认 {display(item.confirmed_score)}</span></div>
    {item.binding_version && <p className="text-xs text-muted-foreground">评分配置版本 {item.binding_version} · 主评与复核</p>}
    {item.feedback && <div className="space-y-2 rounded-md border border-primary/25 bg-primary/5 p-3 text-xs"><h4 className="font-semibold">AI 评分建议 · {display(item.ai_score)} / {display(item.max_score)}</h4>
      {[...Object.values(item.feedback.dimension_comments), ...item.feedback.deduction_reasons, ...item.feedback.improvement_suggestions].map((text, i) => <p key={i} className="whitespace-pre-wrap break-words text-muted-foreground">{text}</p>)}
      {item.feedback.risk_flags.length > 0 && <p className="text-muted-foreground">需核对：{item.feedback.risk_flags.join("；")}</p>}
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
  const [selectedExamId, setSelectedExamId] = useState<string>();
  const [paper, setPaper] = useState<SavedPaper>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("正在加载阅卷记录");
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
    if (!candidateId) return;
    const abort = new AbortController();
    void connectionRequest<SavedExam[]>("/grading/exams", { signal: abort.signal }).then(data => {
      if (!abort.signal.aborted && Array.isArray(data)) setExams(data);
    }).catch(() => {});
    return () => abort.abort();
  }, [candidateId]);
  useEffect(() => {
    epoch.current += 1;
    const abort = new AbortController();
    setPaper(undefined); setError(""); setMessage(""); setBusy(true);
    void refresh(abort.signal).catch((cause: unknown) => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "加载失败"); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => { abort.abort(); epoch.current += 1; };
  }, [refresh]);
  const running = !historical && paper?.items.some(i => ["queued", "running"].includes(i.status));
  const savedCandidates = exams.find(exam => exam.id === paper?.exam_id)?.candidates ?? [];
  const selectedExam = exams.find(exam => exam.id === selectedExamId);
  useEffect(() => {
    if (!exams.length) {
      setSelectedExamId(undefined);
      return;
    }
    if (!selectedExamId || !exams.some(exam => exam.id === selectedExamId)) {
      setSelectedExamId(exams[0].id);
    }
  }, [exams, selectedExamId]);
  const savedIndex = savedCandidates.findIndex(candidate => candidate.id === paper?.id);
  const subjectiveItems = paper?.items.filter(item => !item.objective) ?? [];
  const objectiveCount = paper?.items.filter(item => item.objective).length ?? 0;
  useEffect(() => {
    if (!running || busy) return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => { void refresh(abort.signal).catch((cause: unknown) => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "刷新失败，请手动刷新"); }); }, 2000);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [running, busy, paper, refresh]);
  const run = async (label: string, work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setBusyLabel(label); setError(""); setMessage("");
    const version = epoch.current;
    try { await work(); }
    catch (cause) { if (version === epoch.current) setError(cause instanceof Error ? cause.message : "操作失败"); }
    finally { inFlight.current = false; if (version === epoch.current) setBusy(false); }
  };
  const exportExam = (id: string) => run("正在导出成绩", async () => {
    const response = await connectionFetch(`/grading/exams/${id}/export`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = "学习通评分.csv"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return <div className="flex w-full min-w-0 flex-col gap-5">
    <ChaoxingPageHeader title="学习通阅卷记录" subtitle="结果保存在本系统，教师确认后形成最终成绩" actions={<>
      <Button asChild size="sm" variant="outline"><Link to={candidateId ? "/grading/chaoxing/results" : "/grading/chaoxing"}><ArrowLeft />返回</Link></Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("正在刷新", () => refresh())}>{busy ? <PixelGrid /> : <RefreshCw />}刷新</Button>
      <Button asChild size="sm" variant="outline"><Link to="/grading/chaoxing">读取答卷</Link></Button>
    </>} />
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    {!candidateId && <>
      {!busy && !exams.length && <p className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">暂无已保存答卷，请先连接学习通读取。</p>}
      {!!exams.length && <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-2" aria-label="考试和作业列表">
          <h2 className="px-1 text-xs font-medium text-muted-foreground">考试 / 作业（{exams.length}）</h2>
          <nav className="max-h-[calc(100vh-15rem)] space-y-1 overflow-y-auto rounded-md border border-border bg-card p-2" aria-label="选择考试或作业">
            {exams.map(exam => <button key={exam.id} type="button" aria-pressed={selectedExam?.id === exam.id} onClick={() => setSelectedExamId(exam.id)} className={`w-full rounded-md border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedExam?.id === exam.id ? "border-primary/40 bg-accent" : "border-transparent hover:bg-muted/60"}`}>
              <span className="block text-sm font-medium leading-5">{exam.title}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">{exam.course_title}</span>
              <span className="mt-2 block text-xs text-muted-foreground">已保存 {exam.candidates.length} 份 / 已提交 {display(exam.expected_submitted)} 份</span>
            </button>)}
          </nav>
        </aside>
        {selectedExam && <section className="min-w-0 space-y-3" aria-label="考生名单">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><h2 className="truncate text-sm font-semibold">{selectedExam.course_title} · {selectedExam.title}</h2><p className="mt-1 text-xs text-muted-foreground">已保存 {selectedExam.candidates.length} 份 / 学习通已提交 {display(selectedExam.expected_submitted)} 份</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => void exportExam(selectedExam.id)}><Download />导出成绩</Button></div>
          <div className="overflow-x-auto rounded-md border border-border"><Table><TableHeader><TableRow><TableHead>姓名</TableHead><TableHead>学号</TableHead><TableHead>已处理题目</TableHead><TableHead>最终成绩</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{selectedExam.candidates.map(c => <TableRow key={c.id}><TableCell>{c.name}</TableCell><TableCell>{c.student_no}</TableCell><TableCell>{c.totals.resolved_count} / {c.totals.question_count}</TableCell><TableCell>{c.totals.final_score ?? "待确认"}</TableCell><TableCell><Button asChild size="sm" variant="ghost"><Link to={`?candidate=${c.id}`}>查看评分</Link></Button></TableCell></TableRow>)}{!selectedExam.candidates.length && <TableRow><TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">该考试 / 作业暂无已保存的考生答卷。</TableCell></TableRow>}</TableBody></Table></div>
        </section>}
      </div>}
    </>}
    {paper && <div className="grid min-w-0 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-4" aria-label="按考生阅卷导航">
        <section className="rounded-md border border-border bg-card p-4"><h2 className="truncate text-sm font-semibold">{paper.name}</h2><p className="mt-1 text-xs text-muted-foreground">学号 {paper.student_no}</p><p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">{paper.course_title} · {paper.exam_title}</p>
          <div className="mt-3 flex items-baseline justify-between text-xs"><span className="text-muted-foreground">最终成绩</span><span className="font-semibold">{paper.totals?.final_score ?? "待确认"} / {paper.totals?.max_score ?? "—"}</span></div>
          <div className="mt-3 grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={busy || savedIndex <= 0} onClick={() => setParams({ candidate: savedCandidates[savedIndex - 1].id })}><ChevronLeft />上一个</Button><Button size="sm" variant="outline" disabled={busy || savedIndex < 0 || savedIndex >= savedCandidates.length - 1} onClick={() => setParams({ candidate: savedCandidates[savedIndex + 1].id })}>下一个<ChevronRight /></Button></div>
        </section>
        <section className="rounded-md border border-border bg-card p-4"><h3 className="text-sm font-semibold">主观题答题卡</h3><p className="mt-1 text-xs text-muted-foreground">{subjectiveItems.length} 题 · 客观题 {objectiveCount} 题沿用学习通得分</p><div className="mt-3 flex flex-wrap gap-2">{subjectiveItems.map(item => <a key={item.id} href={`#chaoxing-saved-question-${item.position}`} className="inline-flex size-9 items-center justify-center rounded-md border border-border text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`跳转第 ${item.position} 题`}>{item.position}</a>)}{!subjectiveItems.length && <span className="text-xs text-muted-foreground">没有主观题</span>}</div></section>
      </aside>
      <section className="min-w-0 space-y-4" aria-label="主观题评分">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3"><div><h2 className="text-base font-semibold">主观题评分</h2><p className="mt-1 text-xs text-muted-foreground">{subjectiveItems.length} 题 · AI 只评主观题（简答、论述、编程），客观题沿用学习通得分；点开题目可看参考答案。</p></div><div className="flex flex-wrap items-center gap-2">
          {paper.current_revision > 1 && <Select value={String(paper.revision)} disabled={busy} onValueChange={value => setParams({ candidate: paper.id, ...(Number(value) !== paper.current_revision ? { revision: value } : {}) })}><SelectTrigger className="w-36" aria-label="答卷版本"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: paper.current_revision }, (_, i) => i + 1).reverse().map(v => <SelectItem key={v} value={String(v)}>版本 {v}{v === paper.current_revision ? "（当前）" : ""}</SelectItem>)}</SelectContent></Select>}
          {!historical && <Button size="sm" disabled={busy || !subjectiveItems.some(i => ["pending", "failed"].includes(i.status))} onClick={() => void run("正在提交评分", async () => {
            const result = await connectionRequest<{ queued: number }>(`${endpoint}/grade`, { method: "POST" });
            await refresh(); setMessage(`已加入 ${result.queued} 道题，使用系统配置的主评与复核模型。`);
          })}>{running && <PixelGrid />}AI 评分</Button>}
        </div></div>
        {paper.totals && <div className="grid gap-2 rounded-md border border-border p-3 text-xs sm:grid-cols-3"><div><span className="text-muted-foreground">客观题源站得分</span><p className="mt-1 font-semibold">{paper.totals.objective_score}</p></div><div><span className="text-muted-foreground">AI 主观题建议</span><p className="mt-1 font-semibold">{paper.totals.ai_subjective_score}（{paper.totals.ai_graded_count} 题）</p></div><div aria-label="最终成绩"><span className="text-muted-foreground">最终成绩</span><p className="mt-1 font-semibold">{paper.totals.final_score ?? "待确认"}</p></div></div>}
        {paper.totals?.score_mismatch && <Alert><AlertDescription>题目满分之和与学习通试卷满分不一致，请重新核对并导入完整答卷。当前不生成最终成绩。</AlertDescription></Alert>}
        {!historical && paper.completeness_confirmed === false && <Alert><AlertDescription>批量导入的答卷尚未逐份核对题目和分值。请在学习通核对后重新保存本份答卷，核对前不生成最终成绩。</AlertDescription></Alert>}
        {historical && <p className="text-xs text-muted-foreground">历史版本，仅供查看。</p>}
        {subjectiveItems.map(item => <div id={`chaoxing-saved-question-${item.position}`} key={`${paper.revision}:${item.id}`} className="scroll-mt-5"><ItemReview item={item} historical={historical} disabled={busy} onConfirm={(id, body) => run("正在保存确认分数", async () => {
          await connectionRequest(`${endpoint}/items/${id}/confirm`, { method: "POST", body: JSON.stringify(body) });
          await refresh(); setMessage("确认分数已保存");
        })} /></div>)}
        {!subjectiveItems.length && <p className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">本份答卷没有需要批改的主观题。</p>}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">操作记录（{paper.audit.length}）</summary><ul className="mt-2 space-y-1">{paper.audit.map((a, i) => <li key={i}>{new Date(a.created_at).toLocaleString()} · {{ "paper.imported": "保存答卷", "paper.completeness_confirmed": "核对答卷", "grading.queued": "启动评分", "score.confirmed": "确认分数" }[a.action] ?? a.action} · 版本 {String(a.details.revision)}{a.details.score != null ? ` · ${String(a.details.score)} 分` : ""}</li>)}</ul></details>
      </section>
    </div>}
    {(busy || running) && <PixelLoaderOverlay label={busy ? busyLabel : "AI 评分中，结果会自动刷新"} />}
  </div>;
}

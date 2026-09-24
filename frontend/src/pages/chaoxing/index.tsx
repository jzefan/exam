import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Link2, RefreshCw, Search, Sparkles, Unplug } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PixelGrid, PixelLoaderOverlay } from "@/components/ui/pixel-loader";
import { ConnectionError, connectionRequest } from "./api";
import type { Connection, Listing, RecordItem, Review, Semester, Verified } from "./api";
import { LoginDialog } from "./login-dialog";
import { ChaoxingPageHeader } from "./page-header";
import { buildQuestionPreview } from "./question-preview";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";

interface BatchProgress {
  total: number;
  processed: number;
  queuedCandidates: number;
  queuedQuestions: number;
  noNewTasks: number;
  failed: number;
  errors: string[];
  running: boolean;
}

const CANDIDATE_STATUS_LABELS: Record<string, string> = {
  submitted: "已提交",
  unsubmitted: "未提交",
  unknown: "未知",
};

const courseDetails = (item: RecordItem) => [
  item.course_code && `课程编号：${item.course_code}`,
  item.teacher_name && `教师：${item.teacher_name}`,
  item.teacher_team && `教师团队：${item.teacher_team}`,
  item.school_name && `院校：${item.school_name}`,
  item.semester_title && `学期：${item.semester_title}`,
  item.course_tags && `课程标签：${item.course_tags}`,
].filter((value): value is string => Boolean(value));

export function ChaoxingPage() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  const [capability, setCapability] = useState<{ enabled: boolean; reason: string }>();
  const [session, setSession] = useState<Connection | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("正在读取学习通页面");
  const [error, setError] = useState("");
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [semester, setSemester] = useState("");
  const [courses, setCourses] = useState<RecordItem[]>([]);
  const [course, setCourse] = useState<RecordItem>();
  const [exams, setExams] = useState<RecordItem[]>([]);
  const [assignmentNotice, setAssignmentNotice] = useState("");
  const [exam, setExam] = useState<RecordItem>();
  const [candidates, setCandidates] = useState<RecordItem[]>([]);
  const [expectedSubmitted, setExpectedSubmitted] = useState<number | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress>();
  const [candidate, setCandidate] = useState<RecordItem>();
  const [candidateSearch, setCandidateSearch] = useState("");
  const [review, setReview] = useState<Review>();
  const alive = useRef(true);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const detailRef = useRef<HTMLDivElement | null>(null);

  const clearData = () => {
    setCourses([]); setCourse(undefined); setExams([]); setAssignmentNotice(""); setExam(undefined);
    setCandidates([]); setExpectedSubmitted(null); setBatchProgress(undefined); setCandidate(undefined); setReview(undefined); setCandidateSearch(""); setSemesters([]); setSemester("");
  };
  const expire = (message: string) => {
    generation.current += 1;
    clearData(); setSession(null); setLoginOpen(false); setError(message);
  };
  const acceptCourses = (data: Listing) => {
    setCourses(data.items); setSemesters(data.semesters ?? []); setSemester(data.semester_id ?? "");
  };
  const run = async (label: string, work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setBusyLabel(label); setError("");
    try { await work(); }
    catch (cause) {
      if (!alive.current) return;
      const message = cause instanceof Error ? cause.message : "读取失败，请重试";
      if (cause instanceof ConnectionError && [401, 404, 410].includes(cause.status)) expire(message);
      else setError(message);
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    setBusy(true);
    const initialize = async () => {
      const [available, current] = await Promise.all([
        connectionRequest<{ enabled: boolean; reason: string }>("/capabilities", { signal: abort.signal }),
        connectionRequest<Connection | null>("/session", { signal: abort.signal }),
      ]);
      if (abort.signal.aborted) return;
      setCapability(available); setSession(current);
      if (current?.connected) {
        const data = await connectionRequest<Listing>(`/sessions/${current.id}/courses`, { signal: abort.signal });
        if (!abort.signal.aborted) acceptCourses(data);
      }
    };
    void initialize().catch((cause: unknown) => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "加载失败，请刷新重试");
    }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => { alive.current = false; abort.abort(); };
  }, []);
  useEffect(() => {
    if (review && window.matchMedia("(max-width: 1023px)").matches) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [review]);
  const base = `/sessions/${session?.id}`;
  const verified = (data: Verified) => {
    setSession(data.session); acceptCourses(data); setLoginOpen(false); setError("");
  };
  const items = course ? exams : courses;
  const visibleCandidates = candidates.filter(item => `${item.name ?? ""} ${item.student_no ?? ""}`.toLowerCase().includes(candidateSearch.trim().toLowerCase()));
  const submittedCandidates = candidates.filter(item => item.status === "submitted");
  const rosterIncomplete = expectedSubmitted === null || submittedCandidates.length !== expectedSubmitted;
  const readableCandidates = visibleCandidates.filter(item => item.readable);
  const candidateIndex = readableCandidates.findIndex(item => item.id === candidate?.id);
  const subjectiveQuestions = review?.questions.map((question, index) => ({ question, number: index + 1 })).filter(({ question }) => !question.objective) ?? [];
  const objectiveQuestions = review?.questions.filter(question => question.objective) ?? [];
  const subjectiveMax = subjectiveQuestions.reduce((sum, { question }) => sum + (question.max_score ?? 0), 0);
  const subjectiveMaxKnown = subjectiveQuestions.every(({ question }) => question.max_score != null);
  const objectiveScore = objectiveQuestions.reduce((sum, question) => sum + (question.source_score ?? 0), 0);
  const objectiveScoreKnown = objectiveQuestions.every(question => question.source_score != null);
  const canGrade = subjectiveQuestions.some(({ question }) => !question.requires_manual_review && !!question.content.trim() && !!question.reference_answer.trim() && (question.max_score ?? 0) > 0);
  const selectCandidate = (item: RecordItem, refresh = false) => void run(refresh ? "正在重新读取答卷" : "正在读取答卷", async () => {
    const version = generation.current;
    setCandidate(item); setReview(undefined); setChecked(false);
    const data = await connectionRequest<Review>(`${base}/candidates/${item.id}/review${refresh ? "?refresh=true" : ""}`);
    if (generation.current === version) setReview(data);
  });
  const savePaper = (startGrading: boolean) => {
    if (!candidate || !review) return;
    void run(startGrading ? "正在提交 AI 评分" : "正在保存答卷", async () => {
      const saved = await connectionRequest<{ id: string }>(`${base}/candidates/${candidate.id}/import`, {
        method: "POST", body: JSON.stringify({ review_hash: review.review_hash, completeness_confirmed: true }),
      });
      if (startGrading) {
        try {
          const result = await connectionRequest<{ queued: number }>(`/grading/candidates/${saved.id}/grade`, { method: "POST" });
          if (!result.queued) throw new Error("没有符合自动评分条件的主观题");
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : "评分启动失败";
          throw new Error(`答卷已保存，但 AI 评分未启动：${reason}。可在已保存的阅卷中重试。`);
        }
      }
      navigate(`/grading/chaoxing/results?candidate=${saved.id}`);
    });
  };
  const gradeExam = () => {
    if (!submittedCandidates.length || rosterIncomplete) return;
    void run("正在批量读取答卷", async () => {
      const targets = submittedCandidates;
      let progress: BatchProgress = { total: targets.length, processed: 0, queuedCandidates: 0, queuedQuestions: 0, noNewTasks: 0, failed: 0, errors: [], running: true };
      setBatchProgress(progress);
      for (const [index, item] of targets.entries()) {
        if (!alive.current) return;
        setBusyLabel(`正在处理 ${index + 1}/${targets.length}：${item.name || item.student_no}`);
        let stage = "读取";
        let stop = false;
        try {
          if (!item.readable || !item.student_no) throw new Error("答卷或学号未读取完整");
          const paper = await connectionRequest<Review>(`${base}/candidates/${item.id}/review`);
          stage = "保存";
          const saved = await connectionRequest<{ id: string }>(`${base}/candidates/${item.id}/import`, {
            method: "POST", body: JSON.stringify({ review_hash: paper.review_hash, completeness_confirmed: false }),
          });
          stage = "评分";
          const result = await connectionRequest<{ queued: number }>(`/grading/candidates/${saved.id}/grade`, { method: "POST" });
          progress = result.queued
            ? { ...progress, queuedCandidates: progress.queuedCandidates + 1, queuedQuestions: progress.queuedQuestions + result.queued }
            : { ...progress, noNewTasks: progress.noNewTasks + 1 };
        } catch (cause) {
          if (cause instanceof ConnectionError && [401, 404, 410].includes(cause.status)) throw cause;
          const reason = cause instanceof Error ? cause.message : "处理失败";
          progress = { ...progress, failed: progress.failed + 1, errors: [...progress.errors, `${item.name || item.student_no}：${stage}失败，${reason}`] };
          stop = stage === "评分" && cause instanceof ConnectionError && cause.status === 409;
        }
        progress = { ...progress, processed: index + 1 };
        setBatchProgress(progress);
        if (stop) break;
      }
      setBatchProgress({ ...progress, running: false });
    });
  };

  return <div className="flex w-full min-w-0 flex-col gap-5">
    <ChaoxingPageHeader title="学习通" subtitle="读取答卷 · AI 评分 · 教师复核" actions={<>
        <Button asChild size="sm" variant="outline"><Link to="/grading/chaoxing/results">已保存的阅卷</Link></Button>
        <span className="text-xs text-muted-foreground" role="status">{session?.connected ? "已连接" : session ? "等待登录" : "未连接"}</span>
        {session && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("正在断开连接", async () => {
          await connectionRequest(`${base}`, { method: "DELETE" });
          generation.current += 1; clearData(); setSession(null); setLoginOpen(false);
        })}><Unplug />断开</Button>}
        {!session?.connected && <Button size="sm" disabled={busy || !capability?.enabled} onClick={() => void run("正在连接学习通", async () => {
          const current = session ?? await connectionRequest<Connection>("/sessions", { method: "POST" });
          setSession(current); setLoginOpen(true);
        })}>{busy ? <PixelGrid /> : <Link2 />}{session ? "继续登录" : "连接学习通"}</Button>}
    </>} />
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {capability && !capability.enabled && <Alert className="border-border"><AlertDescription>{capability.reason}</AlertDescription></Alert>}
    {!session?.connected ? <div className="rounded-md border border-border px-5 py-12 text-center text-sm text-muted-foreground">
      使用教师账号连接，无需安装客户端。评分结果仅保留在本系统。
      <p className="mt-2 text-xs">读取并保存答卷后，可进行 AI 评分与教师确认。</p>
    </div> : <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="读取位置" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <Button asChild variant="ghost" size="sm"><Link to="/grading"><ArrowLeft />阅卷中心</Link></Button>
          <ChevronRight className="size-3 text-muted-foreground" /><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setCourse(undefined); setExam(undefined); setCandidate(undefined); setReview(undefined); }}>课程</Button>
          {course && <><ChevronRight className="size-3 text-muted-foreground" /><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setExam(undefined); setCandidate(undefined); setReview(undefined); }}>{course.title}</Button></>}
          {exam && <><ChevronRight className="size-3 text-muted-foreground" /><span className="break-words text-xs">{exam.title}</span></>}
        </nav>
        <div className="flex items-center gap-2">
          {!course && semesters.length > 0 && <Select value={semester} disabled={busy} onValueChange={(value) => void run("正在读取学习通列表", async () => {
            const data = await connectionRequest<Listing>(`${base}/courses?semester=${encodeURIComponent(value)}`);
            acceptCourses(data);
          })}><SelectTrigger className="w-52" aria-label="学期"><SelectValue placeholder="选择学期" /></SelectTrigger>
            <SelectContent>{semesters.map(s => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
          </Select>}
          <Button size="sm" variant="outline" disabled={busy} title="跳过缓存，从学习通重新读取" aria-label={course ? "重新读取考试与作业" : "重新读取课程"} onClick={() => void run(course ? "正在重新读取考试与作业" : "正在重新读取课程", async () => {
            if (course) {
              const data = await connectionRequest<Listing>(`${base}/courses/${course.id}/exams?refresh=true`);
              setExams(data.items); setAssignmentNotice(data.assignment_notice ?? "");
            } else {
              const query = semester ? `?semester=${encodeURIComponent(semester)}&refresh=true` : "?refresh=true";
              const data = await connectionRequest<Listing>(`${base}/courses${query}`);
              acceptCourses(data);
            }
          })}><RefreshCw />刷新</Button>
        </div>
      </div>
      {!exam && <div className="overflow-hidden rounded-md border border-border" aria-busy={busy}>
        <Table className="[&_th]:whitespace-nowrap [&_th]:px-3 [&_td]:px-3">
          <TableHeader><TableRow><TableHead>{course ? "考试与作业" : "课程"}</TableHead>{course && <TableHead>已提交</TableHead>}<TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
          <TableBody>{items.map(item => <TableRow key={item.id}>
            <TableCell className="font-medium"><div className="flex items-center gap-2"><span>{item.title}</span>{course && item.item_type && <span className="rounded border border-border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{item.item_type}</span>}</div>{!course && courseDetails(item).length > 0 && <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-normal text-muted-foreground">{courseDetails(item).map(detail => <span key={detail}>{detail}</span>)}</div>}</TableCell>
            {course && <TableCell className="whitespace-nowrap text-muted-foreground">{item.submitted_count ?? "未知"}</TableCell>}
            <TableCell className="text-right"><Button size="sm" variant="ghost" disabled={busy || !item.readable} onClick={() => void run(course ? "正在读取考生名单" : "正在读取考试与作业", async () => {
              if (course) {
                const data = await connectionRequest<Listing>(`${base}/exams/${item.id}/candidates`);
                setExam(item); setCandidates(data.items); setExpectedSubmitted(data.expected_submitted ?? item.submitted_count ?? null); setBatchProgress(undefined); setCandidate(undefined); setReview(undefined); setCandidateSearch("");
              } else {
                const data = await connectionRequest<Listing>(`${base}/courses/${item.id}/exams`);
                setCourse(item); setExams(data.items); setAssignmentNotice(data.assignment_notice ?? "");
              }
            })}>{course ? "读取考生" : "读取考试与作业"}<ChevronRight /></Button></TableCell>
          </TableRow>)}
          {!items.length && <TableRow><TableCell colSpan={course ? 3 : 2} className="h-28 text-center text-muted-foreground">{!busy && "当前列表为空"}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>}
      {course && assignmentNotice && <p role="status" className="text-xs text-muted-foreground">{assignmentNotice}</p>}
      {exam && !candidate && <section className="space-y-3" aria-label="考生列表">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">考生答卷</h2><p className="mt-1 text-xs text-muted-foreground">已识别 {candidates.length} 人</p></div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto"><Button size="sm" variant="outline" disabled={busy} title="跳过缓存，从学习通重新读取" onClick={() => void run("正在重新读取考生名单", async () => {
            const data = await connectionRequest<Listing>(`${base}/exams/${exam.id}/candidates?refresh=true`);
            setCandidates(data.items); setExpectedSubmitted(data.expected_submitted ?? exam.submitted_count ?? null); setBatchProgress(undefined);
          })}><RefreshCw />刷新名单</Button><Button size="sm" disabled={busy || !submittedCandidates.length || rosterIncomplete} onClick={gradeExam}><Sparkles />AI 评分</Button>
            <div className="relative min-w-0 flex-1 sm:w-60 sm:flex-none"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索考生" placeholder="姓名或学号" className="h-8 pl-8 text-sm" value={candidateSearch} onChange={event => setCandidateSearch(event.target.value)} /></div></div></div>
        {rosterIncomplete && <p className="text-xs text-muted-foreground">{expectedSubmitted === null ? "无法确认考试已提交总人数，暂不能批量评分。" : `已读取 ${submittedCandidates.length} / 已提交 ${expectedSubmitted} 份答卷，名单未齐，暂不能批量评分。`}</p>}
        {batchProgress && <Alert className="border-border text-sm" role="status"><AlertDescription>
          {batchProgress.running ? "批量处理中，请保持页面打开" : "批量处理结束"}：{batchProgress.processed}/{batchProgress.total} 份 · 已提交 AI {batchProgress.queuedCandidates} 份（{batchProgress.queuedQuestions} 题）· 无新增评分任务 {batchProgress.noNewTasks} 份 · 失败 {batchProgress.failed} 份
          {batchProgress.errors.length > 0 && <ul className="mt-2 list-inside list-disc text-xs">{batchProgress.errors.slice(0, 5).map((message, index) => <li key={index}>{message}</li>)}{batchProgress.errors.length > 5 && <li>另有 {batchProgress.errors.length - 5} 份失败</li>}</ul>}
        </AlertDescription></Alert>}
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="考生">
          {visibleCandidates.map(item => <li key={item.id} className="group flex min-w-0 items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.name}</p>
              <p className="truncate text-xs tabular-nums text-muted-foreground">{item.student_no || "学号未识别"}</p>
            </div>
            {item.readable
              ? <Button size="sm" variant="ghost" className="shrink-0 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100" disabled={busy} onClick={() => selectCandidate(item)}>查看答卷<ChevronRight /></Button>
              : <span className="shrink-0 text-xs text-muted-foreground">{CANDIDATE_STATUS_LABELS[item.status ?? "unknown"]}</span>}
          </li>)}
          {!visibleCandidates.length && <li className="col-span-full rounded-md border border-border py-12 text-center text-sm text-muted-foreground">{candidates.length ? "没有匹配的考生" : "当前列表为空"}</li>}
        </ul>
      </section>}
      {exam && candidate && <div ref={detailRef} className="grid min-w-0 scroll-mt-4 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]" aria-busy={busy}>
        <aside className="min-w-0 space-y-4" aria-label="按考生阅卷导航">
          <section className="rounded-md border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2"><h2 className="truncate text-sm font-semibold">{candidate.name}</h2><span className="text-xs text-muted-foreground">{CANDIDATE_STATUS_LABELS[candidate.status ?? "unknown"]}</span></div>
            <p className="mt-1 text-xs text-muted-foreground">学号 {candidate.student_no || "未识别"}</p>
            <div className="mt-4 flex items-baseline justify-between border-t border-border pt-3 text-xs"><span className="text-muted-foreground">学习通原分</span><span className="font-semibold">{candidate.source_score ?? "未知"}</span></div>
            <div className="mt-3 grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={busy || candidateIndex <= 0} onClick={() => selectCandidate(readableCandidates[candidateIndex - 1])}><ChevronLeft />上一个</Button><Button size="sm" variant="outline" disabled={busy || candidateIndex < 0 || candidateIndex >= readableCandidates.length - 1} onClick={() => selectCandidate(readableCandidates[candidateIndex + 1])}>下一个<ChevronRight /></Button></div>
          </section>
          {review && <section className="rounded-md border border-border bg-card p-4"><h3 className="text-sm font-semibold">主观题答题卡</h3><p className="mt-1 text-xs text-muted-foreground">{subjectiveQuestions.length} 题 · 客观题 {objectiveQuestions.length} 题沿用学习通得分</p>
            <div className="mt-3 flex flex-wrap gap-2">{subjectiveQuestions.map(({ question, number }) => <a key={question.source_id} href={`#chaoxing-question-${number}`} className="inline-flex size-9 items-center justify-center rounded-md border border-border text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`跳转第 ${number} 题`}>{number}</a>)}
              {!subjectiveQuestions.length && <span className="text-xs text-muted-foreground">没有主观题</span>}</div>
          </section>}
          <Button size="sm" variant="ghost" onClick={() => { setCandidate(undefined); setReview(undefined); setChecked(false); }}><ArrowLeft />返回考生列表</Button>
        </aside>
        <section className="min-w-0 space-y-4" aria-label="考生答卷">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3"><div><h2 className="text-base font-semibold">主观题</h2><p className="mt-1 text-xs text-muted-foreground">{subjectiveQuestions.length} 题 · 满分 {subjectiveMaxKnown ? subjectiveMax : "未知"} · 仅对主观题进行 AI 评分</p></div>
            <div className="flex flex-wrap items-center gap-2">{review && <><span className="text-xs text-muted-foreground">客观题源站得分 {objectiveScoreKnown ? objectiveScore : "未知"} · 试卷满分 {review.declared_max_score ?? "未知"}</span><Button size="sm" variant="outline" title="跳过缓存，从学习通重新读取" disabled={busy} onClick={() => selectCandidate(candidate, true)}><RefreshCw />重新读取答卷</Button></>}</div></div>
          {review && <>
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={checked} onCheckedChange={value => setChecked(value === true)} />已与学习通核对本份答卷的题目和分值</label>
              <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || !checked || !review.review_hash || !candidate.student_no} onClick={() => savePaper(false)}>保存答卷</Button>
                <Button size="sm" disabled={busy || !checked || !review.review_hash || !candidate.student_no || !canGrade} onClick={() => savePaper(true)}><Sparkles />AI 评分</Button></div>
            </div>
            {subjectiveQuestions.map(({ question, number }) => <div id={`chaoxing-question-${number}`} key={question.source_id} className="scroll-mt-5"><QuestionPreviewCard
              question={buildQuestionPreview({ ...question, id: question.source_id })}
              index={number}
              mode="compact"
              expandOnClick
              hideAnswer
              hideMeta
              hideSourceBadge
              hideScoreAndDifficulty
              className="cursor-pointer transition-colors hover:border-primary/40"
              trailing={<span className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><span>学习通得分 {question.source_score ?? "未知"}</span><span>满分 {question.max_score ?? "未知"}</span></span>}
            >
              <div className="mt-3"><h4 className="mb-1 text-xs text-muted-foreground">考生答案</h4><pre className="whitespace-pre-wrap break-words rounded bg-muted/40 p-3 font-mono text-xs">{question.student_answer || "未读取到文字答案"}</pre></div>
              {question.requires_manual_review && <p className="mt-2 text-xs text-muted-foreground">含附件或识别信息不全，需要教师在学习通核对。</p>}
            </QuestionPreviewCard></div>)}
            {!subjectiveQuestions.length && <p className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">本份答卷没有需要批改的主观题。</p>}
          </>}
        </section>
      </div>}
    </>}
    {session && <LoginDialog session={session} open={loginOpen} onOpenChange={setLoginOpen} onVerified={verified} onExpired={expire} />}
    {busy && <PixelLoaderOverlay label={busyLabel} />}
  </div>;
}

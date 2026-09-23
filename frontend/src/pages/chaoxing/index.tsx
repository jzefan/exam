import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Link2, Loader2, Unplug } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConnectionError, connectionRequest } from "./api";
import type { Connection, Listing, RecordItem, Review, Semester, Verified } from "./api";
import { LoginDialog } from "./login-dialog";
import { buildQuestionPreview } from "./question-preview";
import { QuestionPreviewCard } from "@/components/questions/question-preview-card";

export function ChaoxingPage() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  const [capability, setCapability] = useState<{ enabled: boolean; reason: string }>();
  const [session, setSession] = useState<Connection | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [semester, setSemester] = useState("");
  const [courses, setCourses] = useState<RecordItem[]>([]);
  const [course, setCourse] = useState<RecordItem>();
  const [exams, setExams] = useState<RecordItem[]>([]);
  const [exam, setExam] = useState<RecordItem>();
  const [candidates, setCandidates] = useState<RecordItem[]>([]);
  const [candidate, setCandidate] = useState<RecordItem>();
  const [review, setReview] = useState<Review>();
  const alive = useRef(true);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const reviewRef = useRef<HTMLElement | null>(null);

  const clearData = () => {
    setCourses([]); setCourse(undefined); setExams([]); setExam(undefined);
    setCandidates([]); setCandidate(undefined); setReview(undefined); setSemesters([]); setSemester(""); setNotice("");
  };
  const expire = (message: string) => {
    generation.current += 1;
    clearData(); setSession(null); setLoginOpen(false); setError(message);
  };
  const acceptCourses = (data: Listing) => {
    setCourses(data.items); setSemesters(data.semesters ?? []); setSemester(data.semester_id ?? ""); setNotice(data.notice);
  };
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
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
    // The answer sheet renders below the whole roster, so without this the
    // "查看答卷" click looks like it did nothing on a long candidate list.
    if (review) reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [review]);
  const base = `/sessions/${session?.id}`;
  const verified = (data: Verified) => {
    setSession(data.session); acceptCourses(data); setLoginOpen(false); setError("");
  };
  const items = exam ? candidates : course ? exams : courses;

  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-0">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Button asChild size="icon" variant="ghost"><Link to="/grading" aria-label="返回阅卷中心"><ArrowLeft /></Link></Button>
        <div><h1 className="text-base font-semibold">学习通</h1><p className="mt-1 text-xs text-muted-foreground">读取答卷 · AI 评分 · 教师复核</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline"><Link to="/grading/chaoxing/results">已保存的阅卷</Link></Button>
        <span className="text-xs text-muted-foreground" role="status">{session?.connected ? "已连接" : session ? "等待登录" : "未连接"}</span>
        {session && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
          await connectionRequest(`${base}`, { method: "DELETE" });
          generation.current += 1; clearData(); setSession(null); setLoginOpen(false);
        })}><Unplug />断开</Button>}
        {!session?.connected && <Button size="sm" disabled={busy || !capability?.enabled} onClick={() => void run(async () => {
          const current = session ?? await connectionRequest<Connection>("/sessions", { method: "POST" });
          setSession(current); setLoginOpen(true);
        })}>{busy ? <Loader2 className="animate-spin" /> : <Link2 />}{session ? "继续登录" : "连接学习通"}</Button>}
      </div>
    </header>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {capability && !capability.enabled && <Alert className="border-border"><AlertDescription>{capability.reason}</AlertDescription></Alert>}
    {!session?.connected ? <div className="rounded-md border border-border px-5 py-12 text-center text-sm text-muted-foreground">
      使用教师账号连接，无需安装客户端。评分结果仅保留在本系统。
      <p className="mt-2 text-xs">读取并保存答卷后，可进行 AI 评分与教师确认。</p>
    </div> : <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="读取位置" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setCourse(undefined); setExam(undefined); setCandidate(undefined); setReview(undefined); }}>课程</Button>
          {course && <><ChevronRight className="size-3 text-muted-foreground" /><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setExam(undefined); setCandidate(undefined); setReview(undefined); }}>{course.title}</Button></>}
          {exam && <><ChevronRight className="size-3 text-muted-foreground" /><span className="break-words text-xs">{exam.title}</span></>}
        </nav>
        {!course && semesters.length > 0 && <Select value={semester} disabled={busy} onValueChange={(value) => void run(async () => {
          const data = await connectionRequest<Listing>(`${base}/courses?semester=${encodeURIComponent(value)}`);
          acceptCourses(data);
        })}><SelectTrigger className="w-52" aria-label="学期"><SelectValue placeholder="选择学期" /></SelectTrigger>
          <SelectContent>{semesters.map(s => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
        </Select>}
      </div>
      {notice && <Alert className="border-border text-muted-foreground"><AlertDescription>{notice}</AlertDescription></Alert>}
      <div className="overflow-hidden rounded-md border border-border" aria-busy={busy}>
        <Table className="[&_th]:whitespace-nowrap [&_th]:px-3 [&_td]:px-3">
          <TableHeader><TableRow><TableHead>{exam ? "姓名" : course ? "考试" : "课程"}</TableHead>
            {exam && <TableHead>学号</TableHead>}<TableHead>{exam ? "提交状态" : course ? "已提交" : ""}</TableHead><TableHead className="text-right">操作</TableHead>
          </TableRow></TableHeader>
          <TableBody>{items.map(item => <TableRow key={item.id}>
            <TableCell className={exam ? "whitespace-nowrap font-medium" : "font-medium"}>{item.name ?? item.title}</TableCell>
            {exam && <TableCell>{item.student_no || "未识别"}</TableCell>}
            <TableCell className="whitespace-nowrap text-muted-foreground">{exam ? ({ submitted: "已提交", unsubmitted: "未提交", unknown: "未知" }[item.status ?? "unknown"]) : course ? item.submitted_count ?? "未知" : ""}</TableCell>
            <TableCell className="text-right"><Button size="sm" variant="ghost" disabled={busy || !item.readable} onClick={() => void run(async () => {
              const version = generation.current;
              if (exam) {
                setCandidate(undefined); setReview(undefined); setChecked(false);
                const data = await connectionRequest<Review>(`${base}/candidates/${item.id}/review`);
                if (generation.current === version) { setCandidate(item); setReview(data); }
              } else if (course) {
                const data = await connectionRequest<Listing>(`${base}/exams/${item.id}/candidates`);
                setExam(item); setCandidates(data.items); setNotice(data.notice);
              } else {
                const data = await connectionRequest<Listing>(`${base}/courses/${item.id}/exams`);
                setCourse(item); setExams(data.items); setNotice(data.notice);
              }
            })}>{exam ? "查看答卷" : course ? "读取考生" : "读取考试"}<ChevronRight /></Button></TableCell>
          </TableRow>)}
          {!items.length && <TableRow><TableCell colSpan={exam ? 4 : 3} className="h-28 text-center text-muted-foreground">{busy ? "正在读取…" : "当前列表为空"}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {busy && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />正在读取学习通页面…</p>}
      {review && candidate && <section ref={reviewRef} className="scroll-mt-4 space-y-4" aria-label="答卷内容">
        <h2 className="text-sm font-semibold">{candidate.name} · {candidate.student_no || "学号未识别"} <span className="font-normal text-muted-foreground">已读取 {review.questions.length} 题 · 点开题目可看参考答案</span></h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs"><Checkbox checked={checked} onCheckedChange={value => setChecked(value === true)} />已与学习通核对本份答卷的题目和分值</label>
          <Button size="sm" disabled={busy || !checked || !review.review_hash || !candidate.student_no} onClick={() => void run(async () => {
            const saved = await connectionRequest<{ id: string }>(`${base}/candidates/${candidate.id}/import`, {
              method: "POST", body: JSON.stringify({ review_hash: review.review_hash, completeness_confirmed: true }),
            });
            navigate(`/grading/chaoxing/results?candidate=${saved.id}`);
          })}>保存答卷并阅卷</Button>
          {review.declared_max_score != null && <span className="text-xs text-muted-foreground">源试卷满分 {review.declared_max_score}</span>}
        </div>
        {review.questions.map((question, index) => <QuestionPreviewCard
          key={question.source_id}
          question={buildQuestionPreview({ ...question, id: question.source_id })}
          index={index + 1}
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
        </QuestionPreviewCard>)}
      </section>}
    </>}
    {session && <LoginDialog session={session} open={loginOpen} onOpenChange={setLoginOpen} onVerified={verified} onExpired={expire} />}
  </div>;
}

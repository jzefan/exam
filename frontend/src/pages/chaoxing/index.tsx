import { PaperContent } from "./paper-content";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Link2, Maximize, Minimize, RefreshCw, Search, Sparkles, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PixelGrid, PixelLoaderOverlay } from "@/components/ui/pixel-loader";
import { dimensionLabel } from "@/lib/dimension-display";
import { ConnectionError, connectionRequest } from "./api";
import type { Connection, Listing, Question, RecordItem, Review, SavedPaper, Semester, Verified } from "./api";
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
  skippedGraded: number;
  skippedActive: number;
  noAiQuestions: number;
  failed: number;
  errors: string[];
  running: boolean;
}

/** 按题型给题号分组，答题卡与分值表用同一个题型口径。 */
function groupByType(items: { question: Question; number: number }[]) {
  const groups: { type: string; items: { question: Question; number: number }[] }[] = [];
  for (const item of items) {
    const label = item.question.question_type?.trim() || "未识别题型";
    let group = groups.find(entry => entry.type === label);
    if (!group) {
      group = { type: label, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

const CANDIDATE_STATUS_LABELS: Record<string, string> = {
  submitted: "已提交",
  unsubmitted: "未提交",
  unknown: "未知",
};

function readCacheCaption(source?: string, fetchedAt?: string, stale?: boolean) {
  if (!source || source === "live" || !fetchedAt) return "";
  const time = new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(fetchedAt));
  return `${stale ? "缓存数据" : "缓存读取"} · ${time}`;
}

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
  const [navTab, setNavTab] = useState<"objective" | "subjective">("subjective");
  const [capability, setCapability] = useState<{ enabled: boolean; reason: string }>();
  const [session, setSession] = useState<Connection | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("正在读取学习通页面");
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
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
  const [savedPaper, setSavedPaper] = useState<SavedPaper>();
  const [gradingPollFailed, setGradingPollFailed] = useState(false);
  const [selectedQuestionSourceId, setSelectedQuestionSourceId] = useState<string>();
  const [teacherScore, setTeacherScore] = useState("");
  const [teacherMaxScore, setTeacherMaxScore] = useState("");
  const [readCaption, setReadCaption] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const fullscreenRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === fullscreenRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    const target = fullscreenRef.current;
    if (!target) return;
    try {
      if (document.fullscreenElement === target) await document.exitFullscreen();
      else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await target.requestFullscreen();
      }
    } catch {
      setError("当前浏览器无法切换全屏模式");
    }
  };

  const clearData = () => {
    setCourses([]); setCourse(undefined); setExams([]); setAssignmentNotice(""); setExam(undefined);
    setCandidates([]); setExpectedSubmitted(null); setBatchProgress(undefined); setCandidate(undefined); setReview(undefined); setSavedPaper(undefined); setGradingPollFailed(false); setStatusMessage(""); setSelectedQuestionSourceId(undefined); setTeacherScore(""); setTeacherMaxScore(""); setCandidateSearch(""); setSemesters([]); setSemester(""); setReadCaption("");
  };
  const expire = (message: string) => {
    generation.current += 1;
    clearData(); setSession(null); setLoginOpen(false); setError(message);
  };
  const acceptCourses = (data: Listing) => {
    setCourses(data.items); setSemesters(data.semesters ?? []); setSemester(data.semester_id ?? "");
    setReadCaption(readCacheCaption(data.source, data.fetched_at, data.stale));
  };
  const run = async (label: string, work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setBusyLabel(label); setError(""); setStatusMessage("");
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
  const answerToolbarVisible = Boolean(exam && candidate && review);
  const numberedQuestions = review?.questions.map((question, index) => ({ question, number: index + 1 })) ?? [];
  const subjectiveQuestions = numberedQuestions.filter(({ question }) => !question.objective);
  const objectiveQuestions = numberedQuestions.filter(({ question }) => question.objective);
  const activeQuestionIndex = review?.questions.findIndex(question => question.source_id === selectedQuestionSourceId) ?? -1;
  const activeQuestion = activeQuestionIndex >= 0 ? review?.questions[activeQuestionIndex] : undefined;
  const activeSavedItem = activeQuestionIndex >= 0
    ? savedPaper?.items.find(item => item.position === activeQuestionIndex + 1)
    : undefined;
  const teacherMaxValue = activeQuestion?.max_score ?? Number(teacherMaxScore);
  const teacherScoreValue = Number(teacherScore);
  const teacherScoreValid = Boolean(activeQuestion)
    && teacherScore.trim() !== ""
    && Number.isFinite(teacherScoreValue)
    && Number.isFinite(teacherMaxValue)
    && teacherMaxValue > 0
    && teacherScoreValue >= 0
    && teacherScoreValue <= teacherMaxValue
    && !["queued", "running"].includes(activeSavedItem?.status ?? "");
  const pendingTeacherConfirmations = savedPaper
    ? savedPaper.items.filter(item => !item.objective && item.confirmed_score == null).length
    : subjectiveQuestions.length;
  const gradingInProgress = !gradingPollFailed && Boolean(savedPaper?.items.some(item => ["queued", "running"].includes(item.status)));
  useEffect(() => {
    const savedId = candidate?.saved_candidate_id;
    if (!savedId || !gradingInProgress) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const latest = await connectionRequest<SavedPaper>(`/grading/candidates/${savedId}`);
        if (stopped) return;
        setSavedPaper(latest);
        const stillRunning = latest.items.some(item => ["queued", "running"].includes(item.status));
        if (stillRunning) {
          timer = window.setTimeout(() => void poll(), 1500);
        } else if (latest.items.some(item => item.status === "failed")) {
          setStatusMessage("AI 评分已结束，部分题目失败；可重试评分或在当前页面手动确认分数。");
        } else if (latest.items.some(item => item.status === "review")) {
          setStatusMessage("AI 评分已完成，请核对建议分数并确认教师评分。");
        } else {
          setStatusMessage("AI 评分已完成。");
        }
      } catch (cause) {
        if (stopped) return;
        setGradingPollFailed(true);
        setError(`读取 AI 评分状态失败：${cause instanceof Error ? cause.message : "请稍后重试"}`);
      }
    };
    timer = window.setTimeout(() => void poll(), 1500);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [candidate?.saved_candidate_id, gradingInProgress]);
  useEffect(() => {
    if (!activeQuestion) {
      setTeacherScore("");
      setTeacherMaxScore("");
      return;
    }
    const score = activeSavedItem?.confirmed_score ?? activeSavedItem?.ai_score ?? activeSavedItem?.source_score ?? activeQuestion.source_score;
    setTeacherScore(score == null ? "" : String(score));
    const maximum = activeSavedItem?.max_score ?? activeQuestion.max_score;
    setTeacherMaxScore(maximum == null ? "" : String(maximum));
  }, [activeQuestion, activeSavedItem]);
  const subjectiveMax = subjectiveQuestions.reduce((sum, { question }) => sum + (question.max_score ?? 0), 0);
  const subjectiveMaxKnown = subjectiveQuestions.every(({ question }) => question.max_score != null);
  const objectiveMax = objectiveQuestions.reduce((sum, { question }) => sum + (question.max_score ?? 0), 0);
  const objectiveMaxKnown = objectiveQuestions.every(({ question }) => question.max_score != null);
  const objectiveScore = objectiveQuestions.reduce((sum, { question }) => sum + (question.source_score ?? 0), 0);
  const objectiveScoreKnown = objectiveQuestions.every(({ question }) => question.source_score != null);
  // 每种题型的应得分与学习通实得分，与阅卷中心的分值表同一口径：拿不到分的
  // 题型不显示数字，不把未知当 0。
  const typeRows: { type: string; expected: number; expectedComplete: boolean; actual: number; actualComplete: boolean }[] = [];
  for (const { question } of numberedQuestions) {
    const label = question.question_type?.trim() || "未识别题型";
    let row = typeRows.find(item => item.type === label);
    if (!row) {
      row = { type: label, expected: 0, expectedComplete: true, actual: 0, actualComplete: true };
      typeRows.push(row);
    }
    if (question.max_score == null) row.expectedComplete = false;
    else row.expected += question.max_score;
    if (question.source_score == null) row.actualComplete = false;
    else row.actual += question.source_score;
  }
  const expectedTotal = typeRows.reduce((sum, row) => sum + row.expected, 0);
  const expectedComplete = typeRows.every(row => row.expectedComplete);
  const actualTotal = typeRows.reduce((sum, row) => sum + row.actual, 0);
  const actualComplete = typeRows.every(row => row.actualComplete);
  const renderQuestionCard = ({ question, number }: (typeof numberedQuestions)[number]) => {
    const savedItem = savedPaper?.items.find(item => item.position === number);
    const aiStatus = savedItem ? ({ queued: "排队中", running: "AI 评分中", review: "待教师确认", confirmed: "已确认", failed: "评分失败", manual: "需人工评分", source: "沿用学习通分" } as Record<string, string>)[savedItem.status] : undefined;
    const feedback = savedItem?.feedback;
    const dimensionScores = feedback?.dimension_scores ?? {};
    const dimensionComments = feedback?.dimension_comments ?? {};
    const dimensionKeys = [...new Set([...Object.keys(dimensionScores), ...Object.keys(dimensionComments)])];
    const dimensions = dimensionKeys.filter(key => dimensionScores[key] != null || Boolean(dimensionComments[key]));
    const strengths = feedback?.strengths ?? [];
    const deductions = feedback?.deduction_reasons ?? [];
    const suggestions = feedback?.improvement_suggestions ?? [];
    const risks = feedback?.risk_flags ?? [];
    const aiResultAvailable = savedItem != null && (savedItem.ai_score != null || dimensions.length > 0 || Boolean(strengths.length || deductions.length || suggestions.length || risks.length));
    return <div id={`chaoxing-question-${number}`} key={question.source_id} onClick={() => setSelectedQuestionSourceId(question.source_id)} className={`scroll-mt-5 rounded-md ${selectedQuestionSourceId === question.source_id ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-background" : ""}`}><QuestionPreviewCard
    question={buildQuestionPreview({ ...question, id: question.source_id })}
    questionBody={<PaperContent blocks={question.rich_content?.content} text={String(buildQuestionPreview({ ...question, id: question.source_id }).content.text ?? "")} />}
    index={number}
    mode="compact"
    expandOnClick
    hideAnswer
    hideMeta
    hideSourceBadge
    hideScoreAndDifficulty
    className="cursor-pointer transition-colors hover:border-primary/40"
    trailing={<span className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><span>学习通得分 {question.source_score ?? "未知"}</span><span>满分 {question.max_score ?? "未知"}</span>{aiStatus && <span className={savedItem?.status === "failed" ? "text-destructive" : ""}>{aiStatus}{savedItem?.ai_score != null ? ` · ${savedItem.ai_score} 分` : ""}</span>}</span>}
  >
    <div className="mt-3"><h4 className="mb-1 text-xs text-muted-foreground">考生答案</h4><PaperContent blocks={question.rich_content?.student_answer} text={question.student_answer} empty="未读取到答案" /></div>
    {aiResultAvailable && savedItem && <section data-no-card-toggle="true" aria-label={`第 ${number} 题 AI 评分结果`} className="mt-3 space-y-3 rounded-md border border-primary/25 bg-primary/[0.035] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="inline-flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-primary" />AI 评分建议</h4>
        <span className="text-sm font-semibold tabular-nums text-primary">建议分数 {savedItem.ai_score ?? "—"} / {savedItem.max_score ?? question.max_score ?? "未知"}</span>
      </div>
      {!!dimensions.length && <div className="grid gap-2 sm:grid-cols-2">
        {dimensions.map(name => <div key={name} className="rounded-md bg-background/80 p-2.5">
          <h5 className="flex items-center justify-between gap-2 text-xs font-medium"><span>{feedback?.dimension_labels?.[name] ?? dimensionLabel(name)}</span>{dimensionScores[name] != null && <span className="shrink-0 text-primary">{dimensionScores[name]}{feedback?.dimension_max_scores?.[name] != null ? ` / ${feedback.dimension_max_scores[name]}` : " 分"}</span>}</h5>
          {dimensionComments[name] && <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{dimensionComments[name]}</p>}
        </div>)}
      </div>}
      {!!strengths.length && <div><h5 className="text-xs font-medium">优点</h5><ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">{strengths.map((text, index) => <li key={`${index}-${text}`} className="whitespace-pre-wrap break-words">{text}</li>)}</ul></div>}
      {!!deductions.length && <div><h5 className="text-xs font-medium">扣分依据</h5><ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">{deductions.map((text, index) => <li key={`${index}-${text}`} className="whitespace-pre-wrap break-words">{text}</li>)}</ul></div>}
      {!!suggestions.length && <div><h5 className="text-xs font-medium">改进建议</h5><ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">{suggestions.map((text, index) => <li key={`${index}-${text}`} className="whitespace-pre-wrap break-words">{text}</li>)}</ul></div>}
      {!!risks.length && <p className="text-xs text-amber-700 dark:text-amber-300">需核对：{risks.join("；")}</p>}
    </section>}
    {(savedItem?.requires_manual_review ?? question.requires_manual_review) && <p className="mt-2 text-xs text-muted-foreground">含附件或识别信息不全，需要教师在学习通核对。</p>}
    {savedItem?.error && <p className="mt-2 text-xs text-destructive">评分失败：{savedItem.error}</p>}
  </QuestionPreviewCard></div>;
  };
  const refreshCourseExams = async (selectedCourse: RecordItem) => {
    if (!selectedCourse.source_id) throw new Error("缓存中没有课程来源编号，无法刷新");
    const courseQuery = semester ? `?semester=${encodeURIComponent(semester)}&refresh=true` : "?refresh=true";
    const courses = await connectionRequest<Listing>(`${base}/courses${courseQuery}`);
    acceptCourses(courses);
    const freshCourse = courses.items.find(row => row.source_id === selectedCourse.source_id);
    if (!freshCourse) throw new Error("刷新后未找到原课程，请重新选择课程");
    const examsData = await connectionRequest<Listing>(`${base}/courses/${freshCourse.id}/exams?refresh=true`);
    setCourse(freshCourse); setExams(examsData.items); setAssignmentNotice(examsData.assignment_notice ?? "");
    setReadCaption(readCacheCaption(examsData.source, examsData.fetched_at, examsData.stale));
    return { freshCourse, examsData };
  };
  const refreshRosterRoute = async (selectedExam: RecordItem | undefined = exam) => {
    if (!course?.source_id || !selectedExam?.source_id) throw new Error("缓存中没有可恢复的考试入口，请返回课程列表刷新后重试");
    const { examsData } = await refreshCourseExams(course);
    const freshExam = examsData.items.find(row => row.source_id === selectedExam.source_id);
    if (!freshExam) throw new Error("刷新后未找到原考试或作业，请重新选择");
    const candidatesData = await connectionRequest<Listing>(`${base}/exams/${freshExam.id}/candidates?refresh=true`);
    setExam(freshExam); setCandidates(candidatesData.items);
    setReadCaption(readCacheCaption(candidatesData.source, candidatesData.fetched_at, candidatesData.stale));
    setExpectedSubmitted(candidatesData.expected_submitted ?? freshExam.submitted_count ?? null);
    return { freshExam, candidatesData };
  };
  const refreshCandidateRoute = async (item: RecordItem) => {
    if (!item.source_id) throw new Error("缓存中没有考生来源编号，无法刷新");
    const { candidatesData } = await refreshRosterRoute();
    const freshCandidate = candidatesData.items.find(row => row.source_id === item.source_id);
    if (!freshCandidate) throw new Error("刷新名单后未找到该考生，请重新选择考生");
    return freshCandidate;
  };
  const fetchCandidateReview = async (item: RecordItem, refresh: boolean) => {
    let target = item;
    let data: Review;
    try {
      data = await connectionRequest<Review>(`${base}/candidates/${target.id}/review${refresh ? "?refresh=true" : ""}`);
    } catch (cause) {
      if (!(cause instanceof ConnectionError) || cause.status !== 409 || !cause.message.includes("历史缓存")) throw cause;
      target = await refreshCandidateRoute(item);
      data = await connectionRequest<Review>(`${base}/candidates/${target.id}/review?refresh=true`);
    }
    return { candidate: target, review: data };
  };
  const loadCandidateIntoPage = async (item: RecordItem, refresh: boolean, version: number) => {
    setCandidate(item); setReview(undefined); setSavedPaper(undefined); setGradingPollFailed(false); setSelectedQuestionSourceId(undefined); setNavTab("subjective");
    const { candidate: target, review: data } = await fetchCandidateReview(item, refresh);
    let stored: SavedPaper | undefined;
    if (target.saved_candidate_id) {
      try { stored = await connectionRequest<SavedPaper>(`/grading/candidates/${target.saved_candidate_id}`); }
      catch { /* A stale list status must not prevent reading the source answer. */ }
    }
    if (generation.current === version) {
      const firstQuestion = data.questions.find(question => !question.objective) ?? data.questions[0];
      setCandidate(target); setReview(data); setSavedPaper(stored); setSelectedQuestionSourceId(firstQuestion?.source_id);
      setReadCaption(readCacheCaption(data.source, data.fetched_at, data.stale));
    }
  };
  const selectCandidate = (item: RecordItem, refresh = false) => void run(refresh ? "正在重新读取答卷" : "正在读取答卷", async () => {
    await loadCandidateIntoPage(item, refresh, generation.current);
  });
  const persistTeacherScore = async () => {
    if (!candidate || !review || !activeQuestion || activeQuestionIndex < 0) throw new Error("请先选择要评分的题目");
    if (!teacherScore.trim() || !Number.isFinite(Number(teacherScore))) throw new Error("请输入有效的教师评分");
    let activeCandidate = candidate;
    let activeReview = review;
    if (activeReview.source === "snapshot") {
      const fresh = await fetchCandidateReview(activeCandidate, true);
      activeCandidate = fresh.candidate;
      activeReview = fresh.review;
    }
    if (!activeCandidate.student_no) throw new Error("考生学号未识别，暂时无法保存评分");
    const questionIndex = activeReview.questions.findIndex(question => question.source_id === selectedQuestionSourceId);
    if (questionIndex < 0) throw new Error("答卷题目已变化，请重新选择题目");
    const saved = await connectionRequest<{ id: string }>(`${base}/candidates/${activeCandidate.id}/import`, {
      method: "POST",
      body: JSON.stringify({ review_hash: activeReview.review_hash, completeness_confirmed: true }),
    });
    const currentPaper = await connectionRequest<SavedPaper>(`/grading/candidates/${saved.id}`);
    const item = currentPaper.items.find(row => row.position === questionIndex + 1);
    if (!item) throw new Error("已保存答卷中找不到当前题目，请刷新后重试");
    if (["queued", "running"].includes(item.status)) throw new Error("AI 评分尚未完成，请稍后再确认教师分数");
    const maximum = item.max_score ?? Number(teacherMaxScore);
    const score = Number(teacherScore);
    if (!Number.isFinite(maximum) || maximum <= 0 || !Number.isFinite(score) || score < 0 || score > maximum) {
      throw new Error(maximum > 0 ? `教师评分需在 0 至 ${maximum} 分之间` : "请输入本题满分后再确认教师评分");
    }
    const updated = await connectionRequest<SavedPaper>(`/grading/candidates/${saved.id}/items/${item.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        version: item.version,
        score,
        reason: "教师人工评分",
        ...(item.max_score == null ? { max_score: maximum } : {}),
      }),
    });
    setCandidate({ ...activeCandidate, saved_candidate_id: saved.id, grading_state: "graded" });
    setReview(activeReview);
    setSavedPaper(updated);
    setCandidates(current => current.map(row => row.id === activeCandidate.id
      ? { ...row, saved_candidate_id: saved.id, grading_state: "graded" }
      : row));
  };
  const handleTeacherConfirm = (nextCandidate?: RecordItem) => {
    void run(nextCandidate ? "正在确认分数并读取下一份" : "正在保存教师评分", async () => {
      await persistTeacherScore();
      if (nextCandidate) await loadCandidateIntoPage(nextCandidate, false, generation.current);
    });
  };
  const handleNextCandidate = () => {
    const nextCandidate = readableCandidates[candidateIndex + 1];
    if (!nextCandidate || !candidate) return;
    if (activeQuestion && !teacherScoreValid) {
      setError("请先填写有效的教师评分；切换到下一位时会自动确认当前分数。");
      return;
    }
    const scoreChanged = teacherScore.trim() !== "" && Number(teacherScore) !== activeSavedItem?.confirmed_score;
    if (candidate.saved_candidate_id && !savedPaper) {
      setError("未能读取这份答卷的评分记录，暂不能自动确认分数。请重新读取答卷后再切换考生。");
      return;
    }
    if (scoreChanged && activeQuestion) handleTeacherConfirm(nextCandidate);
    else selectCandidate(nextCandidate);
  };
  const savePaper = (startGrading: boolean) => {
    if (!candidate || !review) return;
    void run(startGrading ? "正在提交 AI 评分" : "正在保存答卷", async () => {
      let activeReview = review;
      let activeCandidate = candidate;
      if (activeReview.source === "snapshot") {
        try {
          activeReview = await connectionRequest<Review>(`${base}/candidates/${activeCandidate.id}/review?refresh=true`);
        } catch (cause) {
          if (!(cause instanceof ConnectionError) || cause.status !== 409 || !cause.message.includes("历史缓存")) throw cause;
          activeCandidate = await refreshCandidateRoute(candidate);
          setCandidate(activeCandidate);
          activeReview = await connectionRequest<Review>(`${base}/candidates/${activeCandidate.id}/review?refresh=true`);
        }
        setReview(activeReview);
      }
      const saved = await connectionRequest<{ id: string }>(`${base}/candidates/${activeCandidate.id}/import`, {
        method: "POST", body: JSON.stringify({ review_hash: activeReview.review_hash, completeness_confirmed: true }),
      });
      const savedId = saved.id;
      const savedPaperData = await connectionRequest<SavedPaper>(`/grading/candidates/${savedId}`);
      activeCandidate = { ...activeCandidate, saved_candidate_id: savedId };
      setCandidate(activeCandidate);
      setSavedPaper(savedPaperData);
      setCandidates(current => current.map(row => row.id === activeCandidate.id ? activeCandidate : row));
      if (!startGrading) {
        navigate(`/grading/chaoxing/results?candidate=${savedId}`);
        return;
      }
      setGradingPollFailed(false);
      let result: { queued: number; state: string };
      try {
        result = await connectionRequest<{ queued: number; state: string }>(`/grading/candidates/${savedId}/grade`, { method: "POST" });
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : "评分启动失败";
        throw new Error(`答卷已保存，但 AI 评分未启动：${reason}`);
      }
      const latest = await connectionRequest<SavedPaper>(`/grading/candidates/${savedId}`);
      setSavedPaper(latest);
      const latestStatuses = latest.items.map(item => item.status);
      const state = latestStatuses.some(status => ["queued", "running"].includes(status))
        ? "grading"
        : latestStatuses.every(status => ["review", "confirmed", "source", "manual"].includes(status))
          ? "graded"
          : activeCandidate.grading_state;
      activeCandidate = { ...activeCandidate, grading_state: state };
      setCandidate(activeCandidate);
      setCandidates(current => current.map(row => row.id === activeCandidate.id ? activeCandidate : row));
      if (result.queued > 0) setStatusMessage(`已提交 ${result.queued} 道题的 AI 评分，评分完成后会自动更新结果。`);
      else if (result.state === "in_progress") setStatusMessage("AI 评分正在处理中，结果会自动更新。");
      else if (result.state === "no_ai_questions") setStatusMessage("这份答卷没有可由 AI 评分的题目，请在当前页面手动确认分数。");
      else if (result.state === "already_graded") setStatusMessage("这份答卷的 AI 评分已完成。");
      else if (result.state === "no_new_tasks") setStatusMessage("当前没有新的待评分题目。");
    });
  };
  const gradeExam = () => {
    const selectedExam = exam;
    if (!selectedExam || !submittedCandidates.length || rosterIncomplete) return;
    void run("正在批量读取答卷", async () => {
      const targets = submittedCandidates;
      let progress: BatchProgress = { total: targets.length, processed: 0, queuedCandidates: 0, queuedQuestions: 0, noNewTasks: 0, skippedGraded: 0, skippedActive: 0, noAiQuestions: 0, failed: 0, errors: [], running: true };
      setBatchProgress(progress);
      for (const [index, item] of targets.entries()) {
        if (!alive.current) return;
        setBusyLabel(`正在处理 ${index + 1}/${targets.length}：${item.name || item.student_no}`);
        let stage = "读取";
        let stop = false;
        try {
          if (!item.readable || !item.student_no) throw new Error("答卷或学号未读取完整");
          if (item.grading_state === "graded" || item.already_ai_graded) {
            progress = { ...progress, skippedGraded: progress.skippedGraded + 1 };
            progress = { ...progress, processed: index + 1 };
            setBatchProgress(progress);
            continue;
          }
          if (item.grading_state === "grading") {
            progress = { ...progress, skippedActive: progress.skippedActive + 1 };
            progress = { ...progress, processed: index + 1 };
            setBatchProgress(progress);
            continue;
          }
          if (item.grading_state === "no_ai") {
            progress = { ...progress, noAiQuestions: progress.noAiQuestions + 1 };
            progress = { ...progress, processed: index + 1 };
            setBatchProgress(progress);
            continue;
          }
          let savedId = item.saved_candidate_id;
          if (!savedId) {
            let liveCandidate = item;
            let paper: Review;
            try {
              paper = await connectionRequest<Review>(`${base}/candidates/${liveCandidate.id}/review?refresh=true`);
            } catch (cause) {
              if (!(cause instanceof ConnectionError) || cause.status !== 409 || !cause.message.includes("历史缓存")) throw cause;
              liveCandidate = await refreshCandidateRoute(item);
              paper = await connectionRequest<Review>(`${base}/candidates/${liveCandidate.id}/review?refresh=true`);
            }
            stage = "保存";
            const saved = await connectionRequest<{ id: string }>(`${base}/candidates/${liveCandidate.id}/import`, {
              method: "POST", body: JSON.stringify({ review_hash: paper.review_hash, completeness_confirmed: false }),
            });
            savedId = saved.id;
          }
          stage = "评分";
          const result = await connectionRequest<{ queued: number; state: string }>(`/grading/candidates/${savedId}/grade`, { method: "POST" });
          progress = result.queued
            ? { ...progress, queuedCandidates: progress.queuedCandidates + 1, queuedQuestions: progress.queuedQuestions + result.queued }
            : result.state === "already_graded"
              ? { ...progress, skippedGraded: progress.skippedGraded + 1 }
              : result.state === "in_progress"
                ? { ...progress, skippedActive: progress.skippedActive + 1 }
                : result.state === "no_ai_questions"
                  ? { ...progress, noAiQuestions: progress.noAiQuestions + 1 }
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
      const latest = await connectionRequest<Listing>(`${base}/exams/${selectedExam.id}/candidates`);
      setCandidates(latest.items);
      setReadCaption(readCacheCaption(latest.source, latest.fetched_at, latest.stale));
    });
  };

  return <div ref={fullscreenRef} className={isFullscreen
    ? "flex h-screen w-full min-w-0 flex-col gap-5 overflow-y-auto bg-background p-4 pb-24 sm:p-6"
    : `flex w-full min-w-0 flex-col gap-5${answerToolbarVisible ? " pb-24" : ""}`}>
    {!isFullscreen && <ChaoxingPageHeader title="学习通" subtitle="读取答卷 · AI 评分 · 教师复核" status={
      <Badge variant={session?.connected ? "success" : session ? "warning" : "outline"} role="status" className="gap-1.5 rounded-full px-3 py-1 text-xs">
        <span className={session?.connected ? "size-1.5 rounded-full bg-emerald-600" : session ? "size-1.5 rounded-full bg-amber-500" : "size-1.5 rounded-full bg-muted-foreground"} />
        {session?.connected ? "已连接" : session ? "等待登录" : "未连接"}
      </Badge>
    } actions={<>
        <Button asChild size="sm" variant="outline"><Link to="/grading/chaoxing/results">已保存的阅卷</Link></Button>
        {session && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("正在断开连接", async () => {
          await connectionRequest(`${base}`, { method: "DELETE" });
          generation.current += 1; clearData(); setSession(null); setLoginOpen(false);
        })}><Unplug />断开</Button>}
        {!session?.connected && <Button size="sm" disabled={busy || !capability?.enabled} onClick={() => void run("正在连接学习通", async () => {
          const current = session ?? await connectionRequest<Connection>("/sessions", { method: "POST" });
          setSession(current); setLoginOpen(true);
        })}>{busy ? <PixelGrid /> : <Link2 />}{session ? "继续登录" : "连接学习通"}</Button>}
        <Button asChild size="sm" variant="ghost"><Link to="/grading"><ArrowLeft />阅卷中心</Link></Button>
    </>} />}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {statusMessage && <p role="status" className="text-sm text-muted-foreground">{statusMessage}</p>}
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
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {!course && semesters.length > 0 && <Select value={semester} disabled={busy} onValueChange={(value) => void run("正在读取学习通列表", async () => {
            const data = await connectionRequest<Listing>(`${base}/courses?semester=${encodeURIComponent(value)}`);
            acceptCourses(data);
          })}><SelectTrigger className="w-52" aria-label="学期"><SelectValue placeholder="选择学期" /></SelectTrigger>
            <SelectContent>{semesters.map(s => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
          </Select>}
          {/* The roster screen refreshes through 「刷新名单」, so the list-level
              refresh is not repeated there. */}
          {!exam && <Button size="sm" variant="outline" disabled={busy} title="跳过缓存，从学习通重新读取" aria-label={course ? "重新读取考试与作业" : "重新读取课程"} onClick={() => void run(course ? "正在重新读取考试与作业" : "正在重新读取课程", async () => {
            if (course) {
              const { examsData } = await refreshCourseExams(course);
              setExams(examsData.items); setAssignmentNotice(examsData.assignment_notice ?? "");
            } else {
              const query = semester ? `?semester=${encodeURIComponent(semester)}&refresh=true` : "?refresh=true";
              const data = await connectionRequest<Listing>(`${base}/courses${query}`);
              acceptCourses(data);
            }
          })}><RefreshCw />刷新</Button>}
          {exam && candidate && review && <>
            <Button size="sm" variant="outline" aria-pressed={isFullscreen} title={isFullscreen ? "退出全屏" : "全屏"} onClick={() => void toggleFullscreen()}>
              {isFullscreen ? <Minimize /> : <Maximize />}{isFullscreen ? "退出全屏" : "全屏"}
            </Button>
            <Button size="sm" variant="outline" title="跳过缓存，从学习通重新读取" disabled={busy} onClick={() => selectCandidate(candidate, true)}><RefreshCw />重新读取答卷</Button>
          </>}
        </div>
      </div>
      {readCaption && !candidate && <p className="-mt-3 text-xs text-muted-foreground" role="status">{readCaption}</p>}
      {!exam && <div className="overflow-hidden rounded-md border border-border" aria-busy={busy}>
        <Table className="[&_th]:whitespace-nowrap [&_th]:px-3 [&_td]:px-3">
          <TableHeader><TableRow><TableHead>{course ? "考试与作业" : "课程"}</TableHead>{course && <TableHead>已提交</TableHead>}<TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
          <TableBody>{items.map(item => <TableRow key={item.id}>
            <TableCell className="font-medium"><div className="flex items-center gap-2"><span>{item.title}</span>{course && item.item_type && <span className="rounded border border-border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{item.item_type}</span>}</div>{!course && courseDetails(item).length > 0 && <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-normal text-muted-foreground">{courseDetails(item).map(detail => <span key={detail}>{detail}</span>)}</div>}</TableCell>
            {course && <TableCell className="whitespace-nowrap text-muted-foreground">{item.submitted_count ?? "未知"}</TableCell>}
            <TableCell className="text-right"><Button size="sm" variant="ghost" disabled={busy || !item.readable} onClick={() => void run(course ? "正在读取考生名单" : "正在读取考试与作业", async () => {
              if (course) {
                let data: Listing;
                let selectedExam = item;
                try {
                  data = await connectionRequest<Listing>(`${base}/exams/${item.id}/candidates`);
                } catch (cause) {
                  if (!(cause instanceof ConnectionError) || cause.status !== 409 || !cause.message.includes("历史缓存")) throw cause;
                  const restored = await refreshRosterRoute(item);
                  selectedExam = restored.freshExam;
                  data = restored.candidatesData;
                }
                setExam(selectedExam); setCandidates(data.items); setExpectedSubmitted(data.expected_submitted ?? selectedExam.submitted_count ?? null); setBatchProgress(undefined); setCandidate(undefined); setReview(undefined); setReadCaption(readCacheCaption(data.source, data.fetched_at, data.stale)); setCandidateSearch("");
              } else {
                let data: Listing;
                let selectedCourse = item;
                try {
                  data = await connectionRequest<Listing>(`${base}/courses/${item.id}/exams`);
                } catch (cause) {
                  if (!(cause instanceof ConnectionError) || cause.status !== 409 || !cause.message.includes("历史缓存")) throw cause;
                  const restored = await refreshCourseExams(item);
                  selectedCourse = restored.freshCourse;
                  data = restored.examsData;
                }
                setCourse(selectedCourse); setExams(data.items); setAssignmentNotice(data.assignment_notice ?? ""); setReadCaption(readCacheCaption(data.source, data.fetched_at, data.stale));
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
            let data: Listing;
            try {
              data = await connectionRequest<Listing>(`${base}/exams/${exam.id}/candidates?refresh=true`);
            } catch (cause) {
              if (!(cause instanceof ConnectionError) || cause.status !== 409 || !cause.message.includes("历史缓存")) throw cause;
              data = (await refreshRosterRoute()).candidatesData;
            }
            setCandidates(data.items); setExpectedSubmitted(data.expected_submitted ?? exam.submitted_count ?? null); setReadCaption(readCacheCaption(data.source, data.fetched_at, data.stale)); setBatchProgress(undefined);
          })}><RefreshCw />刷新名单</Button><Button size="sm" disabled={busy || !submittedCandidates.length || rosterIncomplete} onClick={gradeExam}><Sparkles />AI 评分</Button>
            <div className="relative min-w-0 flex-1 sm:w-60 sm:flex-none"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索考生" placeholder="姓名或学号" className="h-8 pl-8 text-sm" value={candidateSearch} onChange={event => setCandidateSearch(event.target.value)} /></div></div></div>
        {rosterIncomplete && <p className="text-xs text-muted-foreground">{expectedSubmitted === null ? "无法确认考试已提交总人数，暂不能批量评分。" : `已读取 ${submittedCandidates.length} / 已提交 ${expectedSubmitted} 份答卷，名单未齐，暂不能批量评分。`}</p>}
        {batchProgress && <Alert className="border-border text-sm" role="status"><AlertDescription>
          {batchProgress.running ? "批量处理中，请保持页面打开" : "批量处理结束"}：{batchProgress.processed}/{batchProgress.total} 份 · 新提交 AI {batchProgress.queuedCandidates} 份（{batchProgress.queuedQuestions} 题）· 已评分跳过 {batchProgress.skippedGraded} 份 · 评分中跳过 {batchProgress.skippedActive} 份 · 无需 AI {batchProgress.noAiQuestions} 份 · 失败 {batchProgress.failed} 份
          {batchProgress.errors.length > 0 && <ul className="mt-2 list-inside list-disc text-xs">{batchProgress.errors.slice(0, 5).map((message, index) => <li key={index}>{message}</li>)}{batchProgress.errors.length > 5 && <li>另有 {batchProgress.errors.length - 5} 份失败</li>}</ul>}
        </AlertDescription></Alert>}
        <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6" aria-label="考生">
          {visibleCandidates.map(item => <li key={item.id} className="group flex min-w-0 items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.name}</p>
              <p className="truncate text-xs tabular-nums text-muted-foreground">{item.student_no || "学号未识别"}</p>
              {item.submitted_at && <p className="truncate text-xs tabular-nums text-muted-foreground">提交 {item.submitted_at}</p>}
              {item.grading_state && <p className="truncate text-xs text-muted-foreground">{item.grading_state === "graded" ? "AI 已完成" : item.grading_state === "grading" ? "AI 评分中" : item.grading_state === "needs_grading" ? "待评分" : item.grading_state === "no_ai" ? "无需 AI" : "已保存"}</p>}
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
          </section>
          {review && <section className="rounded-md border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">答题卡</h3>
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-xs" role="tablist" aria-label="题型">
              {([["objective", `客观题 ${objectiveQuestions.length}`], ["subjective", `主观题 ${subjectiveQuestions.length}`]] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={navTab === value} onClick={() => setNavTab(value)} className={navTab === value ? "rounded bg-card px-2 py-1 font-medium shadow-sm" : "rounded px-2 py-1 text-muted-foreground hover:text-foreground"}>{label}</button>)}
            </div>
            <div className="mt-3 space-y-3">
              {(navTab === "objective" ? objectiveQuestions : subjectiveQuestions).length === 0
                ? <p className="text-xs text-muted-foreground">{navTab === "objective" ? "没有客观题" : "没有主观题"}</p>
                : groupByType(navTab === "objective" ? objectiveQuestions : subjectiveQuestions).map(group => <div key={group.type}>
                  <p className="text-xs text-muted-foreground">{group.type}</p>
                  <div className="mt-1 flex flex-wrap gap-2">{group.items.map(({ question, number }) => <a key={question.source_id} href={`#chaoxing-question-${number}`} onClick={() => setSelectedQuestionSourceId(question.source_id)} className={`inline-flex size-9 items-center justify-center rounded-md border text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedQuestionSourceId === question.source_id ? "border-primary bg-primary/10 text-primary" : "border-border"}`} aria-label={`跳转第 ${number} 题`}>{number}</a>)}</div>
                </div>)}
            </div>
          </section>}
          <Button size="sm" variant="ghost" onClick={() => { setCandidate(undefined); setReview(undefined); }}><ArrowLeft />返回考生列表</Button>
        </aside>
        <section className="min-w-0 space-y-4" aria-label="考生答卷">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3"><div><h2 className="text-base font-semibold">答卷内容</h2><p className="mt-1 text-xs text-muted-foreground">主观题 {subjectiveQuestions.length} 题 · 客观题 {objectiveQuestions.length} 题 · 试卷满分 {review?.declared_max_score ?? "未知"}{readCaption ? ` · ${readCaption}` : ""}</p></div></div>
          {review && <>
            {!!typeRows.length && <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">题型</th>
                  {typeRows.map(row => <th key={row.type} className="whitespace-nowrap px-4 py-2 text-center text-xs font-medium">{row.type}</th>)}
                  <th className="px-4 py-2 text-center text-xs font-semibold">总分</th>
                </tr></thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2 text-left text-xs text-muted-foreground">应得分</td>
                    {typeRows.map(row => <td key={row.type} className="px-4 py-2 text-center tabular-nums">{row.expectedComplete ? row.expected : "—"}</td>)}
                    <td className="px-4 py-2 text-center font-semibold tabular-nums">{expectedComplete ? expectedTotal : "—"}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 text-left text-xs text-muted-foreground">实得分</td>
                    {typeRows.map(row => <td key={row.type} className="px-4 py-2 text-center tabular-nums">{row.actualComplete ? row.actual : "—"}</td>)}
                    <td className="px-4 py-2 text-center font-semibold tabular-nums">{actualComplete ? actualTotal : actualTotal > 0 ? `${actualTotal}*` : "—"}</td>
                  </tr>
                </tbody>
              </table>
              <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">实得分取学习通已给出的分数；主观题由 AI 与教师评分，确认后在「已保存的阅卷」查看。{!actualComplete && actualTotal > 0 ? " * 仅为已给分小计，不含未评分题目。" : ""}</p>
            </div>}
            {!!subjectiveQuestions.length && <div className="space-y-3">
              <h3 className="text-sm font-semibold">主观题<span className="ml-2 font-normal text-muted-foreground">{subjectiveQuestions.length} 题 · 满分 {subjectiveMaxKnown ? subjectiveMax : "未知"} · 由 AI 与教师评分</span></h3>
              {subjectiveQuestions.map(renderQuestionCard)}
            </div>}
            {!!objectiveQuestions.length && <div className="space-y-3">
              <h3 className="text-sm font-semibold">客观题<span className="ml-2 font-normal text-muted-foreground">{objectiveQuestions.length} 题 · 满分 {objectiveMaxKnown ? objectiveMax : "未知"} · 沿用学习通得分 {objectiveScoreKnown ? objectiveScore : "未知"}</span></h3>
              {objectiveQuestions.map(renderQuestionCard)}
            </div>}
            {!numberedQuestions.length && <p className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">本份答卷没有可显示的题目。</p>}
          </>}
        </section>
      </div>}
    </>}
    {answerToolbarVisible && candidate && review && <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-3 py-3 shadow-[0_-4px_16px_hsl(var(--background)/0.12)] backdrop-blur-sm sm:px-6">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" disabled={busy || candidateIndex <= 0} onClick={() => selectCandidate(readableCandidates[candidateIndex - 1])}><ChevronLeft />上一个</Button>
          <Button size="sm" variant="ghost" disabled={busy || candidateIndex < 0 || candidateIndex >= readableCandidates.length - 1} onClick={handleNextCandidate}>下一个<ChevronRight /></Button>
          <span className="ml-1 whitespace-nowrap text-sm text-muted-foreground">待确认 <strong className="text-foreground">{pendingTeacherConfirmations}</strong> 题</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <span className="mr-1 whitespace-nowrap text-xs text-muted-foreground">第 {activeQuestionIndex >= 0 ? activeQuestionIndex + 1 : "—"} 题</span>
          <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground" htmlFor="chaoxing-teacher-score">教师评分
            <Input id="chaoxing-teacher-score" aria-label="教师评分" type="number" min="0" max={activeQuestion?.max_score ?? (teacherMaxScore || undefined)} step="0.01" value={teacherScore} onChange={event => setTeacherScore(event.target.value)} className="h-9 w-24" disabled={!activeQuestion} />
          </label>
          {activeQuestion?.max_score == null && <label className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground" htmlFor="chaoxing-teacher-max-score">本题满分
            <Input id="chaoxing-teacher-max-score" aria-label="本题满分" type="number" min="0.01" step="0.01" value={teacherMaxScore} onChange={event => setTeacherMaxScore(event.target.value)} className="h-9 w-24" />
          </label>}
          <span className="whitespace-nowrap text-xs text-muted-foreground">学习通原分 {candidate.source_score ?? "未知"} / {review.declared_max_score ?? "—"}</span>
          <Button size="sm" variant="outline" disabled={busy || !teacherScoreValid} onClick={() => handleTeacherConfirm()}>确定</Button>
          <Button size="sm" disabled={busy || !teacherScoreValid || candidateIndex < 0 || candidateIndex >= readableCandidates.length - 1} onClick={() => handleTeacherConfirm(readableCandidates[candidateIndex + 1])}>确定并进入下一个</Button>
          <Button size="sm" variant="outline" disabled={busy || !review.review_hash || !candidate.student_no} onClick={() => savePaper(false)}>保存答卷</Button>
          <Button size="sm" onClick={() => savePaper(true)}><Sparkles />AI 评分</Button>
        </div>
      </div>
    </footer>}
    {session && <LoginDialog session={session} open={loginOpen} onOpenChange={setLoginOpen} onVerified={verified} onExpired={expire} />}
    {(busy || gradingInProgress) && <PixelLoaderOverlay label={busy ? busyLabel : "AI 评分中，结果会自动刷新"} />}
  </div>;
}

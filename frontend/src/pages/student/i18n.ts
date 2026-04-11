export type StudentLocale = "zh" | "en";

type StudentMessageKey =
  | "load_exam_failed"
  | "exam_already_submitted"
  | "exam_not_found"
  | "exam_not_assigned"
  | "exam_not_started"
  | "exam_has_ended"
  | "exam_closed"
  | "submit_failed"
  | "auto_submit_failed"
  | "time_up_submitting"
  | "switch_limit_submitting"
  | "time_up_countdown"
  | "switch_limit_countdown"
  | "switch_remaining_warning"
  | "dashboard_greeting"
  | "dashboard_pending_summary"
  | "dashboard_empty_summary"
  | "dashboard_avg_score"
  | "dashboard_passed_exams"
  | "dashboard_pending_exams"
  | "dashboard_view_all"
  | "dashboard_no_pending_title"
  | "dashboard_no_pending_description"
  | "dashboard_exam_not_started"
  | "dashboard_enter_exam"
  | "dashboard_minutes"
  | "dashboard_completed_exams"
  | "dashboard_all"
  | "dashboard_graded"
  | "dashboard_pending_review"
  | "dashboard_exam_name"
  | "dashboard_exam_time"
  | "dashboard_submit_time"
  | "dashboard_duration_used"
  | "dashboard_final_score"
  | "dashboard_action"
  | "dashboard_detail"
  | "dashboard_score_pending"
  | "dashboard_no_permission"
  | "common_tbd"
  | "common_time_tbd"
  | "common_unsubmitted"
  | "common_today"
  | "common_tomorrow"
  | "common_minutes_suffix"
  | "common_hours_suffix"
  | "my_exams_title"
  | "my_exams_pending_summary"
  | "my_exams_empty_summary"
  | "my_exams_pending_tab"
  | "my_exams_completed_tab"
  | "my_exams_pending_empty"
  | "my_exams_completed_empty"
  | "my_exams_ongoing"
  | "my_exams_remaining_minutes"
  | "my_exams_questions"
  | "my_exams_total_score"
  | "my_exams_enter_exam"
  | "my_exams_start_time"
  | "my_exams_started"
  | "my_exams_minutes_later"
  | "my_exams_hours_later"
  | "my_exams_days_later"
  | "my_exams_completed_at"
  | "my_exams_grading"
  | "wrong_answers_title"
  | "wrong_answers_tab_to_review"
  | "wrong_answers_tab_mastered"
  | "wrong_answers_summary"
  | "wrong_answers_mastered_summary"
  | "wrong_answers_empty"
  | "wrong_answers_empty_desc"
  | "wrong_answers_wrong_times"
  | "wrong_answers_date"
  | "wrong_answers_mastered_at"
  | "wrong_answers_id"
  | "question_type_choice"
  | "question_type_true_false"
  | "question_type_fill_in"
  | "question_type_short_answer"
  | "question_type_essay"
  | "question_type_code"
  | "common_not_answered"
  | "common_none"
  | "common_correct"
  | "common_incorrect"
  | "common_code"
  | "common_submitted_lines"
  | "result_not_loaded"
  | "result_title"
  | "result_submitted_at"
  | "result_back_to_exams"
  | "result_no_permission"
  | "result_intro"
  | "result_total_score"
  | "result_question_number"
  | "result_correct"
  | "result_incorrect"
  | "result_score"
  | "result_your_answer"
  | "result_standard_answer"
  | "result_feedback"
  | "result_suggestions"
  | "result_analysis"
  | "result_question_nav"
  | "result_question_count"
  | "result_nav_group_type"
  | "result_nav_group_order"
  | "result_jump_to_question"
  | "result_view_mode_title"
  | "result_view_mode_desc"
  | "result_view_mode_nav"
  | "result_view_mode_all"
  | "result_expand_all"
  | "result_collapse_all"
  | "result_all_view_hint"
  | "result_analysis_section"
  | "result_feedback_panel"
  | "result_show_details"
  | "result_show_feedback_details"
  | "result_hide_details"
  | "result_feedback_empty"
  | "result_feedback_submitted_at"
  | "result_send_feedback"
  | "result_feedback_sent"
  | "result_appeal_status"
  | "result_appeal_pending"
  | "result_appeal_resolved"
  | "result_appeal_rejected"
  | "result_appeal_none"
  | "result_start_appeal"
  | "result_appeal_reason"
  | "result_teacher_reply"
  | "result_appeal_dialog_title"
  | "result_appeal_dialog_desc"
  | "result_appeal_placeholder"
  | "common_cancel"
  | "result_submit_appeal"
  | "wrong_detail_not_found"
  | "wrong_detail_title"
  | "wrong_detail_mark_mastered"
  | "wrong_detail_mastered"
  | "wrong_detail_back"
  | "wrong_detail_recent_wrong"
  | "wrong_detail_your_answer"
  | "wrong_detail_standard_answer"
  | "wrong_detail_feedback";

const STUDENT_DICTIONARY: Record<StudentLocale, Record<StudentMessageKey, string>> = {
  zh: {
    load_exam_failed: "无法加载考试数据",
    exam_already_submitted: "考试已提交",
    exam_not_found: "考试不存在",
    exam_not_assigned: "你未被分配到这场考试",
    exam_not_started: "考试尚未开始",
    exam_has_ended: "考试已结束",
    exam_closed: "考试已关闭",
    submit_failed: "提交失败，请稍后重试",
    auto_submit_failed: "自动提交失败，请手动交卷",
    time_up_submitting: "考试时间到，正在自动提交...",
    switch_limit_submitting: "切屏次数已达上限，正在自动提交...",
    time_up_countdown: "考试时间到，{seconds} 秒后自动提交...",
    switch_limit_countdown: "切屏次数已达上限，{seconds} 秒后自动提交...",
    switch_remaining_warning: "注意：切屏机会仅剩 {remaining} 次",
    dashboard_greeting: "你好，{name} 👋",
    dashboard_pending_summary: "本周有 {count} 场考试即将进行，加油！",
    dashboard_empty_summary: "当前没有待参加的考试，去复习下错题吧。",
    dashboard_avg_score: "平均得分",
    dashboard_passed_exams: "已过考试",
    dashboard_pending_exams: "待参加考试",
    dashboard_view_all: "查看全部",
    dashboard_no_pending_title: "暂无待参加的考试计划",
    dashboard_no_pending_description: "时间待定",
    dashboard_exam_not_started: "尚未开始",
    dashboard_enter_exam: "进入考试",
    dashboard_minutes: "{minutes} 分钟",
    dashboard_completed_exams: "已参加考试",
    dashboard_all: "全部",
    dashboard_graded: "已评分",
    dashboard_pending_review: "待评分",
    dashboard_exam_name: "考试名称",
    dashboard_exam_time: "考试时间",
    dashboard_submit_time: "提交时间",
    dashboard_duration_used: "用时",
    dashboard_final_score: "最终得分",
    dashboard_action: "操作",
    dashboard_detail: "详情",
    dashboard_score_pending: "评分中...",
    dashboard_no_permission: "暂无权限",
    common_tbd: "待定",
    common_time_tbd: "时间待定",
    common_unsubmitted: "未提交",
    common_today: "今天",
    common_tomorrow: "明天",
    common_minutes_suffix: "分钟",
    common_hours_suffix: "小时",
    my_exams_title: "我的考试",
    my_exams_pending_summary: "当前有 {count} 场考试待完成",
    my_exams_empty_summary: "目前没有需要参加的考试",
    my_exams_pending_tab: "未参加",
    my_exams_completed_tab: "已参加记录",
    my_exams_pending_empty: "暂无待参加的考试计划",
    my_exams_completed_empty: "暂无已参加记录",
    my_exams_ongoing: "正在进行中",
    my_exams_remaining_minutes: "剩余 {minutes} 分钟",
    my_exams_questions: "{count} 题",
    my_exams_total_score: "满分 {score}",
    my_exams_enter_exam: "立即进入考场",
    my_exams_start_time: "开始时间：{time}",
    my_exams_started: "已开始",
    my_exams_minutes_later: "{count} 分钟后",
    my_exams_hours_later: "{count} 小时后",
    my_exams_days_later: "{count} 天后",
    my_exams_completed_at: "完成于 {time}",
    my_exams_grading: "阅卷中",
    wrong_answers_title: "错题复习",
    wrong_answers_tab_to_review: "未掌握",
    wrong_answers_tab_mastered: "已掌握",
    wrong_answers_summary: "系统已为你自动收录 {count} 处知识盲点，建议定期回顾。",
    wrong_answers_mastered_summary: "你已掌握 {count} 个薄弱知识点，继续保持。",
    wrong_answers_empty: "暂无错题记录",
    wrong_answers_empty_desc: "恭喜！你在考试中表现优异，继续保持。",
    wrong_answers_wrong_times: "错误 {count} 次",
    wrong_answers_date: "{date}",
    wrong_answers_mastered_at: "掌握于 {date}",
    wrong_answers_id: "ID: {id}",
    question_type_choice: "选择题",
    question_type_true_false: "判断题",
    question_type_fill_in: "填空题",
    question_type_short_answer: "简答题",
    question_type_essay: "论述题",
    question_type_code: "编程题",
    common_not_answered: "未作答",
    common_none: "暂无",
    common_correct: "正确",
    common_incorrect: "错误",
    common_code: "代码",
    common_submitted_lines: "{language} · 已提交 {count} 行代码",
    result_not_loaded: "未能加载考试结果。",
    result_title: "考试结果",
    result_submitted_at: "提交时间：{time}",
    result_back_to_exams: "返回我的考试",
    result_no_permission: "暂无权限查看结果",
    result_intro: "查看标准答案、评分反馈和改进建议。",
    result_total_score: "总分",
    result_question_number: "第 {number} 题",
    result_correct: "答对",
    result_incorrect: "答错",
    result_score: "得分",
    result_your_answer: "你的答案",
    result_standard_answer: "标准答案",
    result_feedback: "评分详情",
    result_suggestions: "改进建议：{text}",
    result_analysis: "题目解析：{text}",
    result_question_nav: "题目导航",
    result_question_count: "共 {count} 题",
    result_nav_group_type: "按题型",
    result_nav_group_order: "按序号",
    result_jump_to_question: "跳转到第 {number} 题",
    result_view_mode_title: "查看方式",
    result_view_mode_desc: "可按题导航，也可从头到尾连续查看全部题目。",
    result_view_mode_nav: "题目导航",
    result_view_mode_all: "全部查看",
    result_expand_all: "全部展开",
    result_collapse_all: "全部收起",
    result_all_view_hint: "全部查看模式下，每题默认先展示题目和答案，评分详情、题目解析与反馈可按需展开。",
    result_analysis_section: "题目解析",
    result_feedback_panel: "反馈",
    result_show_details: "展开评分详情、题目解析和反馈",
    result_show_feedback_details: "展开题目解析和反馈",
    result_hide_details: "收起详细信息",
    result_feedback_empty: "暂未提交反馈。如对评分有疑问，可向教师补充说明。",
    result_feedback_submitted_at: "反馈提交于：{time}",
    result_send_feedback: "提交反馈",
    result_feedback_sent: "已提交反馈",
    result_appeal_status: "申诉状态：",
    result_appeal_pending: "待处理",
    result_appeal_resolved: "已处理",
    result_appeal_rejected: "已驳回",
    result_appeal_none: "未申诉",
    result_start_appeal: "提交反馈",
    result_appeal_reason: "反馈内容：{text}",
    result_teacher_reply: "教师回复：{text}",
    result_appeal_dialog_title: "提交题目反馈",
    result_appeal_dialog_desc: "请填写你希望教师关注的评分说明，提交后会同步到教师端查看。",
    result_appeal_placeholder: "请补充你的说明，例如答案已覆盖关键点、某段代码被误判，或希望教师重点查看的部分。",
    common_cancel: "取消",
    result_submit_appeal: "提交反馈",
    wrong_detail_not_found: "未找到错题详情。",
    wrong_detail_title: "错题详情",
    wrong_detail_mark_mastered: "标记已掌握",
    wrong_detail_mastered: "已标记掌握",
    wrong_detail_back: "返回错题本",
    wrong_detail_recent_wrong: "最近错误：{time}",
    wrong_detail_your_answer: "你的答案",
    wrong_detail_standard_answer: "正确答案",
    wrong_detail_feedback: "评分反馈",
  },
  en: {
    load_exam_failed: "Unable to load exam data",
    exam_already_submitted: "Exam already submitted",
    exam_not_found: "Exam not found",
    exam_not_assigned: "Exam not assigned",
    exam_not_started: "Exam has not started",
    exam_has_ended: "Exam has ended",
    exam_closed: "Exam is closed",
    submit_failed: "Submission failed, please try again later",
    auto_submit_failed: "Auto-submit failed, please submit manually",
    time_up_submitting: "Time is up, auto-submitting...",
    switch_limit_submitting: "Switch limit reached, auto-submitting...",
    time_up_countdown: "Time is up, auto-submitting in {seconds} seconds...",
    switch_limit_countdown: "Switch limit reached, auto-submitting in {seconds} seconds...",
    switch_remaining_warning: "Warning: only {remaining} tab-switch chances left",
    dashboard_greeting: "Hi, {name} 👋",
    dashboard_pending_summary: "{count} exams are coming up this week. Keep it up!",
    dashboard_empty_summary: "No pending exams right now. Review your mistakes instead.",
    dashboard_avg_score: "Average Score",
    dashboard_passed_exams: "Completed Exams",
    dashboard_pending_exams: "Upcoming Exams",
    dashboard_view_all: "View all",
    dashboard_no_pending_title: "No upcoming exams right now",
    dashboard_no_pending_description: "Time to be announced",
    dashboard_exam_not_started: "Not started",
    dashboard_enter_exam: "Enter Exam",
    dashboard_minutes: "{minutes} min",
    dashboard_completed_exams: "Completed Exams",
    dashboard_all: "All",
    dashboard_graded: "Graded",
    dashboard_pending_review: "Pending",
    dashboard_exam_name: "Exam",
    dashboard_exam_time: "Exam Time",
    dashboard_submit_time: "Submitted At",
    dashboard_duration_used: "Time Used",
    dashboard_final_score: "Score",
    dashboard_action: "Action",
    dashboard_detail: "Details",
    dashboard_score_pending: "Grading...",
    dashboard_no_permission: "Unavailable",
    common_tbd: "TBD",
    common_time_tbd: "Time TBD",
    common_unsubmitted: "Not submitted",
    common_today: "Today",
    common_tomorrow: "Tomorrow",
    common_minutes_suffix: "min",
    common_hours_suffix: "hr",
    my_exams_title: "My Exams",
    my_exams_pending_summary: "{count} exams are waiting for you",
    my_exams_empty_summary: "No exams need your attention right now",
    my_exams_pending_tab: "Pending",
    my_exams_completed_tab: "Completed",
    my_exams_pending_empty: "No upcoming exams right now",
    my_exams_completed_empty: "No completed exams yet",
    my_exams_ongoing: "Ongoing",
    my_exams_remaining_minutes: "{minutes} min left",
    my_exams_questions: "{count} questions",
    my_exams_total_score: "{score} pts",
    my_exams_enter_exam: "Enter Exam",
    my_exams_start_time: "Starts at: {time}",
    my_exams_started: "Started",
    my_exams_minutes_later: "In {count} min",
    my_exams_hours_later: "In {count} hr",
    my_exams_days_later: "In {count} day(s)",
    my_exams_completed_at: "Completed at {time}",
    my_exams_grading: "Grading",
    wrong_answers_title: "Wrong Answers",
    wrong_answers_tab_to_review: "To Review",
    wrong_answers_tab_mastered: "Mastered",
    wrong_answers_summary: "{count} weak spots have been collected for review.",
    wrong_answers_mastered_summary: "You've mastered {count} weak points. Keep it up!",
    wrong_answers_empty: "No wrong answers yet",
    wrong_answers_empty_desc: "Nice work. Keep up the strong performance.",
    wrong_answers_wrong_times: "{count} mistakes",
    wrong_answers_date: "{date}",
    wrong_answers_mastered_at: "Mastered at {date}",
    wrong_answers_id: "ID: {id}",
    question_type_choice: "Choice",
    question_type_true_false: "True/False",
    question_type_fill_in: "Fill in",
    question_type_short_answer: "Short Answer",
    question_type_essay: "Essay",
    question_type_code: "Code",
    common_not_answered: "Not answered",
    common_none: "None",
    common_correct: "Correct",
    common_incorrect: "Incorrect",
    common_code: "Code",
    common_submitted_lines: "{language} · {count} lines submitted",
    result_not_loaded: "Failed to load exam result.",
    result_title: "Exam Result",
    result_submitted_at: "Submitted at: {time}",
    result_back_to_exams: "Back to My Exams",
    result_no_permission: "You do not have permission to view the result yet",
    result_intro: "Review standard answers, scoring feedback, and suggestions.",
    result_total_score: "Total Score",
    result_question_number: "Question {number}",
    result_correct: "Correct",
    result_incorrect: "Incorrect",
    result_score: "Score",
    result_your_answer: "Your Answer",
    result_standard_answer: "Standard Answer",
    result_feedback: "Scoring Details",
    result_suggestions: "Suggestions: {text}",
    result_analysis: "Analysis: {text}",
    result_question_nav: "Question Navigation",
    result_question_count: "{count} questions",
    result_nav_group_type: "By Type",
    result_nav_group_order: "By Order",
    result_jump_to_question: "Jump to question {number}",
    result_view_mode_title: "View Mode",
    result_view_mode_desc: "Switch between question navigation and a full sequential review.",
    result_view_mode_nav: "Navigation",
    result_view_mode_all: "View All",
    result_expand_all: "Expand All",
    result_collapse_all: "Collapse All",
    result_all_view_hint: "In view-all mode, each question starts with the prompt and answers only. Expand scoring, analysis, and feedback when needed.",
    result_analysis_section: "Analysis",
    result_feedback_panel: "Feedback",
    result_show_details: "Show scoring, analysis, and feedback",
    result_show_feedback_details: "Show analysis and feedback",
    result_hide_details: "Hide details",
    result_feedback_empty: "No feedback has been submitted yet. You can still leave a note for the teacher about this score.",
    result_feedback_submitted_at: "Feedback submitted at: {time}",
    result_send_feedback: "Send Feedback",
    result_feedback_sent: "Feedback Sent",
    result_appeal_status: "Appeal status:",
    result_appeal_pending: "Pending",
    result_appeal_resolved: "Resolved",
    result_appeal_rejected: "Rejected",
    result_appeal_none: "Not appealed",
    result_start_appeal: "Send Feedback",
    result_appeal_reason: "Feedback: {text}",
    result_teacher_reply: "Teacher reply: {text}",
    result_appeal_dialog_title: "Send Question Feedback",
    result_appeal_dialog_desc: "Share the scoring context you want the teacher to review for this question.",
    result_appeal_placeholder: "Explain what the teacher should revisit, such as covered key points, misread wording, or code behavior that deserves another look.",
    common_cancel: "Cancel",
    result_submit_appeal: "Submit Feedback",
    wrong_detail_not_found: "Wrong-answer detail not found.",
    wrong_detail_title: "Wrong Answer Detail",
    wrong_detail_mark_mastered: "Mark as mastered",
    wrong_detail_mastered: "Marked as mastered",
    wrong_detail_back: "Back to Wrong Answers",
    wrong_detail_recent_wrong: "Last wrong attempt: {time}",
    wrong_detail_your_answer: "Your Answer",
    wrong_detail_standard_answer: "Correct Answer",
    wrong_detail_feedback: "Feedback",
  },
};

const DETAIL_TO_KEY: Record<string, StudentMessageKey> = {
  "Exam already submitted": "exam_already_submitted",
  "Exam not found": "exam_not_found",
  "Exam not assigned": "exam_not_assigned",
  "Exam has not started": "exam_not_started",
  "Exam has ended": "exam_has_ended",
  "Exam is closed": "exam_closed",
};

export function getStudentLocale(): StudentLocale {
  if (typeof window === "undefined") return "zh";
  const stored = window.localStorage.getItem("student_locale");
  return stored === "en" ? "en" : "zh";
}

export function tStudent(
  key: StudentMessageKey,
  vars?: Record<string, string | number>,
  locale: StudentLocale = getStudentLocale(),
): string {
  let message = STUDENT_DICTIONARY[locale][key] ?? STUDENT_DICTIONARY.zh[key];
  if (!vars) return message;
  for (const [name, value] of Object.entries(vars)) {
    message = message.replace(`{${name}}`, String(value));
  }
  return message;
}

export function translateStudentError(
  detail: string | null | undefined,
  locale: StudentLocale = getStudentLocale(),
): string {
  if (!detail) return tStudent("load_exam_failed", undefined, locale);
  const key = DETAIL_TO_KEY[detail];
  if (!key) return detail;
  return tStudent(key, undefined, locale);
}

export function getStudentDateLocale(locale: StudentLocale = getStudentLocale()): string {
  return locale === "en" ? "en-US" : "zh-CN";
}

export function getStudentQuestionTypeLabel(
  type: string,
  locale: StudentLocale = getStudentLocale(),
): string {
  const keyMap: Record<string, StudentMessageKey> = {
    choice: "question_type_choice",
    true_false: "question_type_true_false",
    fill_in: "question_type_fill_in",
    short_answer: "question_type_short_answer",
    essay: "question_type_essay",
    code: "question_type_code",
  };
  const key = keyMap[type];
  return key ? tStudent(key, undefined, locale) : type;
}

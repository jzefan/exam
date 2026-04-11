# Student Async Grading Design

## Goal

把学生交卷后的评分流程改成真正的双路径：

- 纯客观题考试：交卷后立即完成评分并可查看结果
- 含主观题/编程题考试：交卷后先进入 AI 异步评分，再进入教师审核确认

同时，学生端与教师端共享统一的评分状态，并在教师审核确认后给学生发送站内消息，学生登录时弹出提醒。

## Current State

当前学生交卷接口在 `backend/src/app/exams/student_router.py` 的 `submit_exam` 中同步遍历全部题目，并直接调用 `_grade_question(...)` 为所有题型打分。主观题与代码题目前也是本地启发式评分，不存在以下能力：

- 学生交卷后自动创建 AI 评分任务
- 主观题进入异步 AI 评分状态
- 教师审核确认后再升级为最终状态
- 审核确认后的学生站内消息提醒

现有 `backend/src/app/grading` 模块已经具备独立的 AI 评分能力，但没有接入学生交卷主链路。

## Product Behavior

### 1. 评分分流

学生交卷后分两类处理：

- 如果考试只包含客观题（选择题、判断题、填空题），系统立即评分并直接写入最终分数。
- 如果考试包含主观题或编程题，系统先完成客观题评分，再为主观题/编程题创建 AI 评分任务，考试记录进入 `pending_ai`。

### 2. 三个评分状态

学生考试记录新增统一评分状态：

- `pending_ai`：待 AI 评分
- `ai_scored`：AI 已评分
- `reviewed`：教师已审核确定

规则如下：

- 纯客观题考试提交后直接进入 `reviewed`
- 含主观题/编程题考试提交后先进入 `pending_ai`
- AI 评分完成并回填主观题得分后进入 `ai_scored`
- 教师确认 AI 结果后进入 `reviewed`

### 3. 学生可见性

- `pending_ai`：学生不能查看正式结果页，只能看到“待AI评分”
- `ai_scored`：学生可以查看结果页
- `reviewed`：学生可以查看结果页，并看到“已审核确定”的状态

### 4. 教师动作

教师端在现有阅卷/评分详情页面中查看 AI 评分结果，并执行“审核确认”。本轮不新增教师重评分流程，只实现：

- 查看 AI 评分结果
- 确认成绩
- 触发学生站内消息

### 5. 站内消息

教师审核确认后，为该学生创建一条站内消息。

消息目标行为：

- 学生登录时拉取未读消息
- 若存在未读消息，则弹出提醒
- 用户关闭后标记已读

示例文案：

- 标题：`考试成绩已审核确认`
- 内容：`《{exam_title}》成绩已由教师审核确认，你可以查看最新结果。`

## Data Model Changes

### 1. `ExamStudent`

在 `backend/src/app/exams/models.py` 的 `ExamStudent` 上新增：

- `grading_status: str`
- `objective_score: float | None`
- `subjective_score: float | None`
- `ai_scored_at: datetime | None`
- `reviewed_at: datetime | None`

字段语义：

- `objective_score`：客观题总得分
- `subjective_score`：主观题/编程题总得分
- `score`：整场考试当前总分，等于 `objective_score + subjective_score`
- `grading_status`：统一评分状态源

### 2. `StudentExamAnswer`

继续复用 `StudentExamAnswer` 作为每题作答记录，不新增平行表。

客观题：

- 交卷时直接写入 `score_awarded`
- `feedback` 使用现有本地反馈结构

主观题/编程题：

- 交卷时先只写答案内容
- 在 AI 评分完成后回填：
  - `score_awarded`
  - `is_correct`
  - `feedback`

### 3. 学生消息表

新增一张最小消息表，例如 `StudentNotification`：

- `id`
- `student_id`
- `type`
- `title`
- `content`
- `related_exam_id`
- `read_at`
- `created_at`

本轮只支持最基础的考试审核提醒。

## Backend Workflow

### 1. 学生提交考试

接口：`POST /api/student/exams/{exam_id}/submit`

处理规则：

1. 合并当前内存答案与已保存答案
2. 删除旧的 `StudentExamAnswer`
3. 按题目遍历
4. 客观题直接评分并累计到 `objective_score`
5. 主观题/编程题先创建答案记录，但不立即给最终分
6. 设置：
   - `submitted_at`
   - `objective_score`
   - `subjective_score`
   - `score`
   - `grading_status`

状态结果：

- 无主观题：`grading_status = "reviewed"`，`graded_at = now`
- 有主观题：`grading_status = "pending_ai"`，`score = objective_score`

### 2. 创建 AI 评分任务

对于含主观题/编程题的考试，在提交时自动为每道主观题/编程题创建 `GradingTask`，复用现有 `backend/src/app/grading`。

建议 `source_type` / `source_business_id` 采用稳定可解析格式，例如：

- `source_type = "exam_submission"`
- `source_business_id = "{exam_id}:{question_id}:{student_id}"`

然后触发现有 grading 运行入口，让任务进入执行队列或后台运行。

### 3. AI 评分结果回填

当 grading task 产出最终 AI 结果后：

1. 找到对应 `ExamStudent` 与 `StudentExamAnswer`
2. 回填该题的：
   - `score_awarded`
   - `feedback`
   - `is_correct`
3. 重新计算该学生整场考试：
   - `subjective_score`
   - `score`
4. 更新：
   - `grading_status = "ai_scored"`
   - `ai_scored_at = now`
   - `graded_at = now`

### 4. 教师审核确认

教师在现有 grading 详情页执行“审核确认”后：

1. 将对应 `ExamStudent.grading_status` 改为 `reviewed`
2. 写入 `reviewed_at = now`
3. 创建 `StudentNotification`

本轮不要求引入额外审核快照层；教师确认动作直接以当前 AI 最终结果作为确认结果。

## API Changes

### 1. 学生考试列表 `/api/exams`

学生端返回字段新增：

- `grading_status`
- `objective_score`
- `subjective_score`
- `ai_scored_at`
- `reviewed_at`

这样工作台和“我的考试”不再靠 `score === null` 猜测状态。

### 2. 学生结果页 `/api/student/exams/{exam_id}/result`

返回新增：

- `grading_status`

准入规则：

- `pending_ai`：返回 `can_view = false` 与对应提示
- `ai_scored`：返回 `can_view = true`
- `reviewed`：返回 `can_view = true`

### 3. 学生消息接口

新增两个最小接口：

- `GET /api/student/notifications/unread`
- `POST /api/student/notifications/{id}/read`

只支持未读消息拉取与已读标记。

## Frontend Behavior

### 1. 考试提交后的跳转

学生端根据提交返回值处理：

- 纯客观题：可直接进入结果页
- 含主观题：回到“我的考试”或结果占位页，显示 `待AI评分`

### 2. 工作台与我的考试

统一展示三种状态：

- `待AI评分`
- `AI已评分`
- `已审核确定`

学生端不再把“阅卷中”单纯等同于 `score === null`。

### 3. 结果页

- `pending_ai`：显示 AI 正在评分的占位说明，不展示详细结果
- `ai_scored`：允许查看结果页
- `reviewed`：允许查看结果页，并显示审核确认状态

### 4. 登录消息弹窗

学生登录后：

1. 拉取未读消息
2. 若有消息，则弹出提醒框
3. 关闭后标记已读

本轮只需支持串行弹出一条或第一条未读消息即可，不要求完整消息中心。

## File Impact

预计影响的核心文件：

### Backend

- `backend/src/app/exams/models.py`
- `backend/src/app/exams/router.py`
- `backend/src/app/exams/student_router.py`
- `backend/src/app/exams/schemas.py`
- `backend/src/app/exams/student_schemas.py`
- `backend/src/app/grading/service.py`
- `backend/src/app/grading/router.py`（如需暴露教师审核确认动作）
- 新增消息相关模型、schema、router

### Frontend

- `frontend/src/types/index.ts`
- `frontend/src/pages/student/my-exams.tsx`
- `frontend/src/pages/student/dashboard.tsx`
- `frontend/src/pages/student/exam-result.tsx`
- `frontend/src/pages/student/exam-taking.tsx`
- `frontend/src/components/student-layout.tsx`（登录弹窗挂载点）
- 新增学生消息弹窗/消息 hook

## Testing Strategy

### Backend

需要覆盖：

1. 纯客观题提交后直接 `reviewed`
2. 含主观题提交后进入 `pending_ai`
3. 创建 grading task 的数量与题目匹配
4. grading 结果回填后变成 `ai_scored`
5. 教师审核确认后变成 `reviewed`
6. 审核确认后创建学生消息

### Frontend

需要覆盖：

1. 学生考试列表能显示三种状态
2. `pending_ai` 时结果页不开放
3. `ai_scored` 时结果页开放
4. 登录时未读消息会弹出
5. 关闭消息后发送已读请求

## Out of Scope

本轮不包含：

- 教师手动修改 AI 评分细节的完整工作流
- 学生消息中心页面
- 多条未读消息队列交互
- 审核驳回或重新触发 AI 评分
- 更复杂的 AI 评分任务调度系统

## Recommendation

实现时应优先保持“状态唯一来源”原则：

- 学生端、教师端、消息提醒全部以 `ExamStudent.grading_status` 为准
- 不要再让前端通过 `score === null`、`submitted_at`、`graded_at` 组合推断流程状态

这样才能避免后续再次出现“已经提交但状态显示错误”“AI 已评分但学生端还显示待评分”这类反复问题。

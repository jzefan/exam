# 导入试卷与试卷资产设计

日期：2026-05-09

## 1. 背景

当前系统已经具备三类相关能力：

- 题目资产：`Question` 与 `QuestionBank` 承载题目内容、知识点、题库归属。
- 考试/练习发布：`Exam` 承载考试时间、学生、提交、阅卷结果等发布态数据。
- 题目导入与 AI 生成：已有文档识别、导入审核、题目批量入库、AI 生成题目能力。

这次需求里的“导入试卷”不是一次性 AI 工具，也不是已经发布给学生的考试实例。它是一份可复用的试卷资产：老师导入历史试卷，校对后入库，后续可以多次基于该试卷生成新试卷，也可以用于发布考试或练习。

因此本设计新增独立的 `Paper` 试卷资产层，不把导入状态和来源字段直接塞进 `Exam`。`Exam` 继续表示发布实例，`Paper` 表示可复用试卷。

## 2. 目标

### 2.1 功能目标

- 在“考试管理”下新增或强化“试卷列表”，统一管理手工、导入、AI 生成的试卷资产。
- 支持从文件导入历史试卷，复用现有题目识别与校对能力。
- 导入确认后创建可用 `Paper`，并将题目按顺序挂载到试卷。
- 支持从任意可用 `Paper` 发起 AI 生成新试卷。
- 支持后续发布考试/练习时从 `Paper` 选择题目集合。

### 2.2 非目标

- 不在 `Paper` 上保存“导入中/导入失败”等导入状态。
- 不把 `Exam` 改造成试卷资产表。
- V1 不做复杂 OCR 任务队列和高保真版面还原。
- V1 不做跨教师协作编辑、版本对比、复杂审计。
- V1 不要求导入失败的半成品出现在试卷列表中。

## 3. 核心原则

### 3.1 试卷资产与考试发布分离

`Paper` 表示“这份卷子是什么”，`Exam` 表示“这份卷子什么时候发给谁考”。发布考试时可以从 `Paper` 复制题目结构到 `ExamQuestion`，但发布后的考试历史不依赖 `Paper` 的后续编辑。

### 3.2 导入成功后才生成试卷资产

导入流程可以有上传、解析、校对、确认等步骤，但只有用户点击确认入库且题目创建成功后，系统才创建 `Paper`。解析失败和入库失败停留在导入向导或导入任务记录中，不产生失败状态的 `Paper`。

### 3.3 一次导入，多次复用

导入后的 `Paper` 是正式资产，可以反复用于：

- AI 生成新试卷
- 创建考试
- 发布练习
- 查看、复制、归档

### 3.4 复用现有题目能力

导入试卷不重新实现题目识别、题目展示、AI 出题的基础能力。V1 复用现有 `questions` 模块，新增的是“题目集合成为一份试卷资产”的组织层。

## 4. 信息架构

考试管理下建议形成两个层级：

- 试卷列表：管理可复用试卷资产。
- 考试与练习管理：管理已发布或待发布的考试/练习实例。

菜单建议：

- 考试管理
  - 试卷列表
  - 考试与练习

试卷列表中的主操作：

- 新建试卷
- 导入试卷
- AI 生成新试卷

试卷行级操作：

- 查看
- 编辑
- AI 生成新试卷
- 复制
- 归档
- 创建考试
- 发布练习

## 5. 数据模型

### 5.1 Paper

新增 `papers` 表。

字段：

- `id`
- `title`
- `description`
- `source_type`: `manual | import | ai_generated`
- `source_paper_id`: 可空，AI 生成或复制时记录来源试卷。
- `root_knowledge_point_id`: 主知识点，可空但导入流程中必选。
- `question_count`: 可冗余，也可响应时计算。
- `total_score`: 可冗余，也可响应时计算。
- `is_reusable`: 默认 `true`。
- `archived_at`: 可空，用于归档。
- `created_by`
- `owner_id`
- `created_at`
- `updated_at`
- `deleted_at`

明确不增加：

- `import_status`
- `import_error_message`
- `PENDING_UPLOAD`
- `PARSING`
- `PARSE_FAILED`
- `IMPORT_FAILED`

试卷列表只展示已经创建成功的 `Paper`。归档属于资产生命周期，不属于导入状态。

### 5.2 PaperQuestion

新增 `paper_questions` 表。

字段：

- `paper_id`
- `question_id`
- `order`
- `score_override`

约束：

- `(paper_id, question_id)` 唯一。
- 同一 `paper_id` 下 `order` 按前端提交顺序保存。
- 删除 `Paper` 时级联删除 `PaperQuestion`，不删除 `Question`。

### 5.3 PaperImportSession

V1 可新增轻量导入会话表，也可以先使用前端内存状态。推荐新增后端表，以支持“离开页面后回看结果”和错误定位。

新增 `paper_import_sessions` 表。

字段：

- `id`
- `file_name`
- `source_format`
- `root_knowledge_point_id`
- `error_detail`
- `preview_payload`
- `created_paper_id`
- `created_by`
- `created_at`
- `updated_at`

导入会话不定义状态机。成功创建试卷后写入 `created_paper_id`，失败时写入 `error_detail`，是否已导入由这两个字段直接判断。用户需要恢复失败时，从导入历史或导入向导入口读取 `preview_payload` 后重试。

## 6. 后端 API

### 6.1 Paper CRUD

新增 `/api/papers`。

接口：

- `GET /api/papers`
  - 支持分页、搜索、来源筛选、归档筛选、主知识点筛选。
- `GET /api/papers/{paper_id}`
  - 返回试卷详情和题目列表。
- `POST /api/papers`
  - 手工创建试卷资产。
- `PATCH /api/papers/{paper_id}`
  - 修改标题、描述、主知识点、题目顺序、分数。
- `POST /api/papers/{paper_id}/copy`
  - 复制为新试卷。
- `POST /api/papers/{paper_id}/archive`
  - 归档试卷。
- `DELETE /api/papers/{paper_id}`
  - 软删除试卷资产。

权限：

- 可读：本人创建或按现有资源可见规则授权。
- 可写：创建者或管理角色。
- 教师和 evaluator 可创建、导入、生成。

### 6.2 导入试卷

新增 `/api/papers/import/*`，内部复用 `questions` 模块识别能力。

接口：

- `POST /api/papers/import/recognize`
  - 输入：文件名、文本内容、格式、主知识点、图片列表。
  - 输出：导入会话 ID、识别草稿、摘要。
  - 行为：调用现有 `recognize_question_document`。

- `GET /api/papers/import/sessions/{session_id}`
  - 输出：导入会话错误、预览草稿、已创建试卷 ID。

- `POST /api/papers/import/sessions/{session_id}/confirm`
  - 输入：校对后的题目草稿、试卷名称、主知识点、分数策略。
  - 行为：批量创建题目，创建 `Paper`，创建 `PaperQuestion`。
  - 成功输出：`paper_id`。
  - 失败行为：写入 `error_detail`，保留 `preview_payload`。

- `POST /api/papers/import/sessions/{session_id}/retry`
  - 用于解析失败后重新解析，或入库失败后基于保留草稿重试。

### 6.3 从试卷生成新卷

新增：

- `POST /api/papers/{paper_id}/ai-generate`

输入：

- `count`: 生成份数，V1 可先限制为 `1`。
- `difficulty_strategy`: `similar | easier | harder`
- `question_type_strategy`: `inherit`
- `prefer_root_knowledge_point`: 默认 `true`

行为：

- 读取源试卷题型、题量、难度、知识点分布。
- 复用现有 AI 生成题目能力生成新题。
- 创建新 `Paper(source_type=ai_generated, source_paper_id=paper_id)`。
- 新试卷保存为可编辑资产，不直接发布。

输出：

- `paper_id`
- `generated_question_count`

## 7. 前端页面

### 7.1 试卷列表页

新增页面 `frontend/src/pages/papers/list.tsx`，或放在 `frontend/src/pages/exams/papers.tsx`。推荐 `/papers` 作为资源路径，导航归属“考试管理”。

字段：

- 试卷名称
- 来源：手工、导入、AI 生成
- 主知识点
- 题目数
- 总分
- 创建人
- 创建时间
- 是否归档

筛选：

- 来源
- 主知识点
- 是否归档
- 关键词

操作：

- 新建试卷
- 导入试卷
- 查看
- 编辑
- AI 生成新试卷
- 复制
- 归档
- 创建考试
- 发布练习

### 7.2 导入试卷向导

页面建议：`/papers/import`。

步骤：

1. 上传文件
2. 选择主知识点
3. 解析识别
4. 预览校对
5. 确认入库

交互复用现有题目导入审核组件：

- 文档解析工具复用 `frontend/src/pages/questions/import-utils.ts`
- 草稿类型可复用或扩展 `QuestionImportDraft`
- 预览校对工作区复用现有 import review 组件

差异：

- 入口文案是“导入试卷”，不是“导入题库”。
- 目标是创建 `Paper`，不是只创建散题。
- 主知识点为必选。
- 确认入库后跳转到新试卷详情页。

### 7.3 试卷详情页

页面建议：`/papers/:id`。

内容：

- 标题、来源、主知识点、题目数、总分。
- 按标准试卷样式展示题目。
- 侧栏提供行级操作：编辑、AI 生成、复制、归档、创建考试、发布练习。

可复用现有 `PaperPreview`，但需要让组件接收 `Paper` 数据结构。

### 7.4 AI 生成新试卷弹窗

从试卷列表和详情页进入。

参数：

- 难度策略：接近原卷、略降、略升。
- 题型配比：V1 默认继承原卷。
- 是否优先同主知识点：默认开启。

生成完成后：

- 跳转到新试卷详情页。
- 新试卷来源显示为 `AI 生成`，并记录来源试卷。

## 8. 业务流程

### 8.1 导入链路

1. 用户在试卷列表点击“导入试卷”。
2. 上传文件并选择主知识点。
3. 前端提取文本和图片，调用导入识别接口。
4. 后端创建导入会话，调用现有题目文档识别逻辑。
5. 用户预览并校对题目。
6. 用户确认入库。
7. 后端批量创建题目。
8. 后端创建 `Paper` 和 `PaperQuestion`。
9. 跳转到试卷详情页。

失败处理：

- 解析失败：返回错误详情，允许重新上传或重试解析；未成功解析时不创建试卷资产。
- 入库失败：导入会话记录错误详情，保留草稿，允许用户修正后重试。
- 失败不会创建 `Paper`，也不会污染试卷列表。

### 8.2 生成链路

1. 用户在可用试卷点击“AI 生成新试卷”。
2. 系统读取源试卷题量、题型、难度、知识点分布。
3. 用户确认生成参数。
4. 后端生成题目并创建新 `Paper`。
5. 用户进入新试卷详情页校对编辑。

### 8.3 发布链路

1. 用户在试卷详情页点击“创建考试”或“发布练习”。
2. 系统将 `PaperQuestion` 转为 `ExamQuestion` 初始题目集合。
3. 用户进入现有考试/练习发布流程，继续配置时间、学生、设置。
4. 发布后的 `Exam` 与 `Paper` 解耦，后续 Paper 编辑不影响已发布考试。

## 9. 权限与可见范围

角色：

- teacher
- evaluator
- school_admin
- platform_admin
- enterprise_admin

规则：

- 教师和 evaluator 可以创建、导入、AI 生成自己的试卷。
- 普通用户默认只能看到自己拥有的试卷。
- 管理角色按现有资源规则查看和管理。
- 创建考试/发布练习需要对试卷有读权限，并对目标考试有创建权限。
- 归档和删除需要对试卷有写权限。

## 10. 埋点

V1 埋点建议：

- `paper_import_started`
- `paper_import_recognize_succeeded`
- `paper_import_recognize_failed`
- `paper_import_confirm_succeeded`
- `paper_import_confirm_failed`
- `paper_ai_generate_started`
- `paper_ai_generate_succeeded`
- `paper_ai_generate_failed`
- `paper_published_to_exam`
- `paper_published_to_practice`

核心指标：

- 导入发起率
- 导入识别成功率
- 确认入库成功率
- 导入后 7 天内 AI 生成率
- 单份导入试卷平均派生次数

## 11. 验收标准

V1 完成后应满足：

1. 用户可在考试管理进入统一试卷列表。
2. 用户可手工创建试卷资产。
3. 用户可导入文件、选择主知识点、预览校对、确认入库。
4. 导入成功后生成 `Paper`，试卷列表只展示成功入库的试卷。
5. 导入失败可查看错误并重试，但不会创建失败状态的试卷资产。
6. 用户可从可用试卷 AI 生成新试卷。
7. 用户可从试卷创建考试或发布练习。
8. 已发布考试不受源试卷后续编辑影响。

## 12. 实施顺序

推荐按以下顺序实现：

1. 后端新增 `papers` 模块、模型、迁移、基础 CRUD。
2. 新增 `PaperQuestion` 并支持从题目 ID 创建试卷。
3. 前端新增试卷列表和详情页。
4. 新增导入试卷确认接口，复用现有题目识别结果创建 `Paper`。
5. 前端新增导入试卷向导，复用现有导入审核组件。
6. 新增从 `Paper` 创建考试/练习的入口。
7. 新增从 `Paper` AI 生成新试卷的接口和弹窗。
8. 补充权限、测试、埋点。

# 课程出题助手 落地设计 v3（模板优先 · 增量 + 复用 · 不破坏现有逻辑）

> 演进说明：v1（detailed-design）按理想终态新建整套子系统；v2 砍掉模板、只留课程级配置。
> v3 采纳产品决策：**出题模板是核心形态**——老师创建好模板，之后都按模板出题，可建多个模板。
> 模板四大基础：**课程资料 + 学生画像 + 种子题目 + 出题规则**。
> 同时保留 v2 的硬约束：系统已上线在用，**只新增、只复用，绝不破坏现有任何流程**。
>
> **v3.1 增补（已实现）：ArkLoop 式课程知识库（资料 RAG 层）**，见 §KB。

## §KB. 课程知识库（参考 ArkLoop book-kb-rag，已实现）

> 目标：老师上传的资料最终形成**课程知识库**；出题 = 知识库（RAG 检索）+ 出题技能
> （模板：种子题/学生画像/规则）→ 一系列可靠、可溯源的题目。

```text
上传资料（自动，无需干预）
  → 前端抽文本 [复用 extract-material-content]
  → POST kb-ingest（立即返回，后台流水线）
      chunk：heading-aware 切分，256–512 tokens，重叠 40
             代码/公式/表格独立成块；每块携带 heading_path（章节路径）
      embed：OpenAI 兼容 /embeddings（默认 Qwen text-embedding-v3, 1024 维）
      store：course_material_chunks（embedding 存 JSON；宿主 PG 无 pgvector，
             课程级语料量小，Python 余弦排序毫秒级；接口已隔离，今后镜像
             升级 pgvector/pgvector:pg17 可无缝替换存储实现）
  → 资料卡片显示状态徽标：入库中… / 知识库 · N 片段 / 入库失败
出题（模板 generate）
  → 由「范围知识点名 + 薄弱点 + 本次要求」组成查询
  → search_chunks：向量余弦 top-12（embedding 不可用时关键词降级）
  → prompt 注入【课程知识库检索片段】，每段带「出处：第X章 > X.Y 节」
  → 降级链：RAG 片段 → 旧 typed fragments 聚合 → 模板原文快照
```

- 模块：`backend/src/app/course_kb/`（chunker / embedder / models / service / router）
- 端点：`POST .../materials/{rid}/kb-ingest`、`GET .../kb-status`、`GET .../kb/search?q=`（调试）
- 迁移：`course_material_chunks` 表 + `learning_resources.kb_status/kb_error/kb_chunk_count`
- 配置：`EXAM_KB_EMBEDDING_PROVIDER/MODEL/DIM/BASE_URL/API_KEY`（默认复用 Qwen 凭据；
  换模型 = 需重新入库，向量维度必须一致）
- 与 ArkLoop 的差异：无独立 KB 实体（课程即 KB 边界）；无 sandbox 解析端（沿用前端抽取，
  覆盖 pptx）；向量存储为 JSON+Python 排序（pgvector 不可用的务实降级，接口可替换）。

## 0. 硬约束（不变）

1. **不破坏**：只允许「新增表 / 新增 nullable 字段 / 新增接口 / 新增可选 UI」。
   现有 `ai-generate/stream`、「从资料生成题目」（MaterialAIGenerateDialog）、
   `save_generated_questions_to_default_course_bank`、知识树、学期、题库一律不改签名、不改语义。
2. **能复用就不新建**：模板流程内部调用现有能力。
3. **分步骤交付**：每步独立上线、独立有价值。
4. **先草稿后确认**：知识点抽取、生成题目都要老师确认后落库。

## 1. 现状盘点（原样保留，作为模板的"零件库"）

| 能力 | 现有实现 | 在 v3 模板体系中的角色 |
|---|---|---|
| 多模态资料抽取（文本+整页图，pdf/docx/pptx） | `frontend/.../knowledge/extract-material-content.ts` | 模板**保存资料时**用它抽文本快照（pptx 只有前端能抽） |
| 服务端文件抽文本（pdf/docx/md） | `extract_paper_import_file_content`（`papers/service.py`） | 服务端兜底/重抽时复用 |
| AI 出题 SSE + prompt 扩展槽 | `POST /api/questions/ai-generate/stream`；`build_ai_generate_system_prompt` 已有 `user_prompt` 槽位 | **唯一出题引擎**；模板上下文从这里注入 |
| 从资料快捷出题 | `MaterialAIGenerateDialog` + 课程详情入口 | **保留不动**，作为无模板时的快捷路径 |
| 生成题落库 | `save_generated_questions_to_default_course_bank` | 模板出题审核通过后的落库 |
| 课程 = 根知识点 | `teacher_courses/router.py` | 模板归属 `course_kp_id` |
| 课程知识树 / KP 创建接口 | `getCourseKnowledgeTree` 等 | 资料→知识点抽取写入目标 |
| 学期 | `CourseSemester`（`semester_major_label/class_ids`） | 学生画像的**预填来源**与归属（见 §4.2） |
| 题目选择器 / 题型配置面板 / 生成卡片 | exams、questions 下现有组件 | 模板向导与生成页直接复用 |

## 2. 核心模型：出题模板（Template-first）

### 2.1 概念

一个模板 = 一份可复用的命题策略，归属某门课程，由四块组成：

```text
出题模板
├── 课程资料   选定的资料集合（保存时抽取文本快照，供出题引用）
├── 学生画像   教学对象描述（可从学期画像预填，可手工改）
├── 种子题目   风格样本（从课程题库选 + 手动输入，生成时作 few-shot 示例）
└── 出题规则   题型数量 / 难度分布 / 风格规则 / 规避项
```

- 一门课程可有多个模板（如「平时练习模板」「期末复习模板」「A 班基础模板」），其中一个可设为默认。
- 出题时选模板（默认模板预选），可对题型数量/难度做**本次覆盖**，不改模板本身。
- **可追溯但不引入版本表**：每次生成把"解析后的模板快照"存进生成记录（Step 3），
  模板就可以放心就地编辑；版本化推迟到确有跨课程共享/发布需求时再加。

### 2.2 数据表（Step 1 只加两张）

```text
question_gen_templates
  id            uuid PK
  course_kp_id  uuid FK -> knowledge_points.id      # 归属课程（根知识点）
  owner_id      uuid                                 # 创建老师
  name          varchar(100)                         # 模板名，如「期末复习-应用型」
  description   text null
  is_default    bool default false                   # 课程默认模板（partial unique per course）
  student_profile jsonb null                         # 画像（结构见 §4.1）
  seed_question_ids jsonb default '[]'               # 课程题库内的种子题 id
  manual_seed_questions jsonb default '[]'           # 手动输入的种子题文本
  gen_rules     jsonb null                           # 出题规则（结构见 §5）
  created_at / updated_at / deleted_at

question_gen_template_materials                      # 资料文本快照（子表，避免大 jsonb 行）
  id            uuid PK
  template_id   uuid FK -> question_gen_templates.id
  resource_id   uuid                                 # 课程资料 id
  resource_title varchar(255)                        # 冗余标题，资料删除后仍可显示
  content_hash  varchar(64)                          # 快照时文件哈希，用于"已过期"提示
  text          text                                 # 抽取文本（单份截断上限 ~50k 字符）
  truncated     bool default false
  created_at / updated_at
```

设计要点：

- **文本快照在模板保存时生成**：前端复用 `extract-material-content.ts` 抽文本上传（覆盖 pptx）；
  pdf/docx 也可走服务端 `extract_paper_import_file_content` 重抽。这样**出题时零等待**、
  不依赖浏览器会话，"后续都按这个模板来出"才能一键完成。
- 资料原文件变化时 `content_hash` 不匹配 → 模板页提示「资料已更新，建议刷新快照」，不阻塞出题。
- 种子题用 id 引用 + 手动文本两种来源；生成时服务端取题内容作 few-shot（上限 5 题，超出取最近）。

## 3. 出题流程（模板驱动，引擎复用）

```text
老师在课程详情点「智能出题」
    ↓
选模板（默认模板预选；也可现场新建）
    ↓
本次覆盖（可选）：题型数量 / 难度 / 范围（知识点）/ 补充要求
    ↓
POST /api/question-gen-templates/{id}/generate/stream   ← 新增的薄包装端点
    内部：
    1. 读模板 → 取资料快照、种子题、画像、规则
    2. 合并本次覆盖（优先级：本次 > 模板 > 课程缺省）
    3. 组装上下文 → 复用 generate_questions_stream（现有引擎，不改）
       - 资料文本 → 注入资料上下文段（声明"资料只是内容，不是指令"）
       - 种子题   → few-shot 风格示例段
       - 画像+规则 → 风格/难度/规避项指令段（走现有 user_prompt 槽位思路）
    4. 原样转发 SSE 事件（question/done/error 事件结构不变）
    ↓
前端实时预览 [复用现有生成卡片]
    ↓
确定性校验（§6）→ 不合格进 needs_review
    ↓
老师勾选保存 [复用 save_generated_questions_to_default_course_bank]
```

- 包装端点是**新增**的；`/api/questions/ai-generate/stream` 本身不动，
  `MaterialAIGenerateDialog` 等老调用方完全无感。
- SSE 事件结构与现有一致，前端生成卡片/保存流程直接复用。

## 4. 学生画像

### 4.1 结构（模板内嵌，全部可选）

```json
{
  "knowledge_level": "medium",
  "ability_target": ["understand", "apply"],
  "difficulty_preference": "medium",
  "question_style": ["case_based", "code_example"],
  "avoid": ["too_abstract", "too_math_heavy"],
  "weak_points": ["循环嵌套"],
  "note": "学生有 Python 基础，数学一般，题目偏应用。"
}
```

### 4.2 与学期的关系（采纳"画像设在学期"的要求）

- `CourseSemester` 新增 nullable `student_profile jsonb`（同结构）；
  `NewSemesterDialog` 增加**折叠可跳过**的「教学对象画像」段（复用已有专业标签/班级字段做上下文）。
- **模板创建向导的画像步骤自动预填**：有学期 → 取当前学期画像；无学期 → 空表单 + 引导文案。
- 无学期的兜底：课程详情新增「出题设置」入口可直接建模板（模板本身就承载画像），
  **不强改课程创建对话框**；若后续想做课程创建向导，作为可选增强。
- 取数优先级：**本次覆盖 > 模板画像 > 学期画像 > 空**。
  （模板高于学期：老师既然在模板里写了画像，就是明确意图；学期画像主要作预填与缺省。）

## 5. 出题规则（gen_rules 结构）

```json
{
  "type_distribution": {"choice": 5, "true_false": 3, "short_answer": 2, "code": 2},
  "difficulty_distribution": {"easy": 30, "medium": 50, "hard": 20},
  "style_rules": [
    "题目优先使用真实应用场景",
    "解析必须说明原因，不只给结论",
    "编程题优先 Python"
  ],
  "avoid_scenarios": ["过深数学推导"],
  "default_scope_kp_ids": []
}
```

- 题型 key 用**系统题型**（`choice/true_false/fill_in/short_answer/essay/code`），
  不引入 `single_choice/programming` 等第二套命名（展示层翻译即可）。
- 编程题严格走现有契约：顶层 `code_test_cases`、content 白名单
  `{sample_tests, test_cases, judge_cases}`、**program 模式**；
  function 模式、`starter_code`、`content.multi` 等系统不消费的键一律不引入（后置）。

## 6. 质量校验（与 v2 相同，便宜且确定）

不合格进 `needs_review`、不自动保存：题型/数量符合配置；禁用题型不出现；有答案有解析；
选择题选项 ≥4、单选恰一个正确、多选 ≥2；编程题至少 1 个公开用例。

**不做硬门槛**：资料证据（LLM 产物易幻觉，仅作展示/审计）；近重复检测、AI 复核后置。

## 7. 资料 → 知识点抽取（保留 v2 设计，兼为模板服务）

- 上传资料后提示「抽取知识点」；资料卡片新增按钮（与「从资料生成题目」并列）。
- 复用前端抽取拿文本 → 新接口产出**知识点候选**（name+简述+建议父节点）→
  老师确认面板勾选/改名/调父节点 → 复用现有 KP 接口写入课程知识树。**不自动写树**。
- 对模板的价值：抽出的知识点丰富课程树 → 模板的出题范围、`knowledge_point_ids` 更精准。

## 8. API（全部新增；现有接口零改动）

```http
# 模板 CRUD
GET    /api/courses/{course_id}/question-gen-templates
POST   /api/courses/{course_id}/question-gen-templates
GET    /api/question-gen-templates/{template_id}
PUT    /api/question-gen-templates/{template_id}
DELETE /api/question-gen-templates/{template_id}
POST   /api/question-gen-templates/{template_id}/set-default
POST   /api/question-gen-templates/{template_id}/duplicate        # 复制后调整，替代"版本化"

# 模板资料快照
PUT    /api/question-gen-templates/{template_id}/materials        # 提交 resource_id + 抽取文本
POST   /api/question-gen-templates/{template_id}/materials/refresh # 服务端重抽（pdf/docx/md）

# 模板出题（薄包装，内部转调现有 stream）
POST   /api/question-gen-templates/{template_id}/generate/stream

# 知识点抽取（Step 2）
POST   /api/courses/{course_id}/materials/{resource_id}/extract-knowledge-points
POST   /api/courses/{course_id}/knowledge-points/bulk-create

# 学期画像（Step 3，向后兼容扩展：不传即现状）
POST/PUT /api/courses/{course_id}/semesters[/{id}]   # body 增加可选 student_profile
```

## 9. 前端

```text
frontend/src/pages/courses/question-gen-templates/
  list.tsx              # 课程详情「出题模板」区：卡片列表、设为默认、复制
  template-wizard.tsx   # 创建/编辑向导（四步，对应四大基础）
  steps/
    materials-step.tsx  # 选资料 → 前端抽取 → 提交快照 [复用 extract-material-content]
    profile-step.tsx    # 学生画像（学期预填）
    seeds-step.tsx      # 种子题：题库选择 [复用题目选择器] + 手动输入
    rules-step.tsx      # 题型/难度/风格 [复用题型配置面板]
  generate.tsx          # 出题页：选模板 → 覆盖 → SSE 预览 → 审核保存 [复用生成卡片+保存]
  api.ts / types.ts
```

入口（全部新增、不动现有）：

- 课程详情新增「出题模板」分区 +「智能出题」按钮（无模板时引导先建模板，或走快捷路径）。
- 资料卡片新增「抽取知识点」（Step 2）。
- `NewSemesterDialog` 折叠画像段（Step 3）。
- 「从资料生成题目」原入口**原样保留**。

## 10. 分步实施（每步独立可上，全部 additive）

| Step | 内容 | 新增表 | 新增字段 | 改现有接口? |
|---|---|---|---|---|
| **1** | **模板 MVP**：两张表 + 模板向导（四步）+ 模板出题流（包装端点转调现有 stream）+ 确定性校验 + 复用保存 | `question_gen_templates`、`question_gen_template_materials` | — | 否 |
| **2** | 资料→知识点抽取（候选 + 确认面板 + 复用 KP 创建） | — | — | 否 |
| **3** | 学期画像 + 模板向导预填；生成记录落表（模板快照，审计/复盘） | `question_gen_runs`（含 resolved snapshot） | `course_semesters.student_profile` | 扩展（兼容） |
| **4**（可选） | 种子题风格画像（分析而非原文拼接）、近重复检测、AI 复核 | 按需 | — | 否 |
| **5**（可选） | 模板跨课程共享/发布/版本化、命题蓝图、function 模式代码题 | 按需 | — | 否 |

> Step 1 即交付完整的「模板创建 → 按模板出题 → 审核落库」闭环，
> 出题引擎、选择器、预览卡片、保存全部复用，新代码集中在模板 CRUD 与向导 UI。

## 11. 不破坏的保证

- 新表独立、新字段 nullable、新端点独立路径；老接口签名/语义零变化。
- `MaterialAIGenerateDialog`、`ai-generate/stream`、知识树、学期、题库现状路径一字不改。
- 模板出题走包装端点，内部转调现有引擎；SSE 事件结构不变，前端老组件直接复用。
- 知识点抽取、题目生成均"先草稿后确认"，不写脏数据。
- 编程题/多选题严格贴现有判分契约，不引入系统不消费的字段。

## 12. 与 v1 详细设计的对照

| v1（detailed-design） | v3 处理 |
|---|---|
| Skill 模板 + 版本表 + 课程绑定表（3 张） | **1 张模板表**（+资料快照子表）；`is_default` 替代绑定；`duplicate` + 生成时快照替代版本化 |
| 服务端结构化抽取缓存（outline/concepts/…） | 模板内**文本快照**（够用且零等待）；结构化资产后置 |
| 学生画像独立体系 | 画像内嵌模板 + 学期画像预填（jsonb，零新表） |
| 种子题风格画像分析 | Step 1 先 few-shot 原文示例（上限 5 题）；风格分析后置 Step 4 |
| 命题蓝图（硬约束覆盖控制） | 后置；先"软目标进 prompt + 事后覆盖统计" |
| runs/drafts 双表 | Step 3 单表 `question_gen_runs` 存模板快照与结果 |
| function 模式代码题 | 后置 Step 5（需判题包装器）；先 program 模式 |
| 资料即内容非指令（§5.7） | **保留**，注入资料上下文时显式声明 |

## 13. 一句话总结

**模板是产品核心**：老师把「资料 + 画像 + 种子题 + 规则」沉淀成模板，之后一键按模板出题；
**工程上是薄层**：模板只是"上下文配方"，出题引擎、抽取、选择器、预览、落库全部复用现有，
两张新表 + 一组新端点即可闭环，每一步纯增量、不碰线上任何已有路径。

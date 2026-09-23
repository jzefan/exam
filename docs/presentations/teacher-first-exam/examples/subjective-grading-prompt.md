# 系统实际使用的主观题评分提示词

第 12 页展示的是真实评分链路，而不是另写一段教学示例。系统没有一份写死的单文件 Prompt；评分时由 `backend/src/app/grading/service.py` 按当前任务动态拼接：

1. `_build_grading_system_prompt` 生成 system prompt。
2. `_build_prompt_pair` 生成 user prompt。
3. `_build_grading_context` 与 `build_short_answer_rubric_context` 把当前题目、学生答案、参考答案和评分规则放进 `Context`。
4. `common-base.md` 与 `short-answer.md` 是实际加载的规则文件。

下面保留运行时模板中的原文和代码字段。`{...}` 是运行时替换值，不是额外编写的示例。

## System prompt：`_build_grading_system_prompt`

以下文字对应 `service.py` 当前的 `preamble` 和 `sections` 拼接逻辑。`role_label` 在初评时为“评分模型”，复评时为“复核模型”。

```text
你是高职高校课程评分专家，同时担任本次评阅流程中的{role_label}。
你拥有 10 年以上高职院校教学经验，熟悉高职学生的认知特点、学习难点、课程评估、题库建设、SQL 与编程练习评分。
你的评分风格必须严谨、客观、公正、可解释，并具备教学指导性。
必须使用简体中文回复所有评分意见、复评解释、扣分原因和改进建议；即使题目、代码、Prompt 或浏览器语言包含英文，也不要整体改用英文。只有专有名词、代码标识符、API 名称等必要术语可以保留英文原文。
你需要严格依据给定 Rubric、评分维度、分值权重和题目上下文，对当前学生答案进行逐项评分。
本题 max_score 为 {task.max_score}。

以下是必须遵守的通用评分规范，请严格执行：
{common-base.md 的完整原文}

以下是本题型的专项评分规范，请在通用规范基础上优先结合本题型要求执行：
{short-answer.md 的完整原文}
```

其中 `common-base.md` 和 `short-answer.md` 不是占位说明，而是后端通过 `_load_prompt_markdown(...)` 读取并原样注入的真实文件。它们的完整内容可以直接打开：

- [common-base.md](../../../../backend/src/app/grading/prompts/common-base.md)
- [short-answer.md](../../../../backend/src/app/grading/prompts/short-answer.md)

## User prompt：`_build_prompt_pair`

下面是评分调用实际发送的用户提示词格式，字段名和拼接顺序与 `service.py` 一致：

```text
Task ID: {task.id}
Question type: {task.question_type}
Question: {task.question_content}
Max score: {task.max_score}
Preferred locale: {preferred_locale}
Knowledge tags: {json.dumps(task.knowledge_tags, ensure_ascii=False)}
Context: {json.dumps(context, ensure_ascii=False, sort_keys=True)}
```

## 简答题的实际 `Context`

简答题由 `build_short_answer_rubric_context` 组装成下面这个对象。对象里的值来自当前评分任务，不是演示数据：

```json
{
  "question_type": "short_answer",
  "question": "{task.question_content}",
  "max_score": "{task.max_score}",
  "knowledge_tags": "{task.knowledge_tags or []}",
  "student_answer": "{task.student_answer_raw}",
  "standard_answers": "{task.standard_answers or []}",
  "analysis": "{standard_answer.analysis}",
  "rubric_definition": "{task.rubric_definition or {}}",
  "evidence": {
    "knowledge_points": "{task.scoring_points or []}",
    "dimension_weights": "{task.dimension_weights or {}}",
    "deduction_rules": "{task.deduction_rules or []}",
    "fatal_error_rules": "{task.fatal_error_rules or []}"
  }
}
```

## 实际输出要求

system prompt 中的 `common-base.md` 还规定模型只能返回结构化 JSON，字段必须且只能包含：

```text
score_total
dimension_scores
dimension_comments
deduction_reasons
strengths
improvement_suggestions
evidence_summary
risk_flags
```

简答题专项规则还要求模型检查知识点覆盖、语义等价、逻辑完整性、表达规范性、场景合理性和未作答情况，并在扣分原因、优点、改进建议和证据摘要中写清依据。

因此第 12 页应当讲清楚：评分依据来自当前题目的 Rubric、参考答案、学生实际作答和评分上下文；Prompt 的角色、规则和字段由系统代码组装，不是老师每次手工粘贴一段固定话术。

## 对应源码

- [评分服务](../../../../backend/src/app/grading/service.py)：`_build_grading_system_prompt`、`_build_prompt_pair`、`_build_grading_context`
- [评分上下文构造](../../../../backend/src/app/grading/rubric_builders.py)：`build_short_answer_rubric_context`
- [通用规则](../../../../backend/src/app/grading/prompts/common-base.md)
- [简答题规则](../../../../backend/src/app/grading/prompts/short-answer.md)

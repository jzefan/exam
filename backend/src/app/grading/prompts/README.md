# 高职高校课程评分 Prompt 索引

为了方便按题型评审和持续迭代，评分 prompt 已拆分为多份文件：

- 通用基础 Prompt：[common-base.md](./common-base.md) — 通用评分规则 + 结构化 JSON 输出协议（运行时自动加载）
- 简答题 / 论述题 Prompt：[short-answer.md](./short-answer.md)
- 编程题 Prompt：[code.md](./code.md)
- SQL 题 Prompt：[sql.md](./sql.md)

## 阅读顺序

1. 先看 `common-base.md`
2. 再看对应题型专项文件
3. 主评 / 复核 / 仲裁 / 追评的角色差异由后端 `_build_grading_system_prompt`（`service.py`）动态注入

## 注意事项

- 这些 markdown 文件会被 `_load_prompt_markdown` 直接加载为系统提示，因此**不要在文件中放未被替换的 `{占位符}`**。
- 角色名称、`max_score`、语言要求等动态字段由后端 preamble 注入，不要在 markdown 里硬编码。
- 默认输出语言为中文；界面 locale 切换为英文时，运行时会替换语言指令。
- 后端要求模型最终返回结构化 JSON（字段集合见 `common-base.md`），prompt 文件描述的是评分心智 + 输出约束。
- `_load_prompt_markdown` 在进程级使用 `lru_cache`，**修改 prompt 文件后需重启后端进程才能生效**。

## 本目录文件

| 文件 | 何时被加载 |
|---|---|
| `common-base.md` | 每次评分都加载 |
| `short-answer.md` | 题型为 `short_answer` 或 `essay` 时加载 |
| `code.md` | 题型为 `code` 且不构成 SQL 题时加载 |
| `sql.md` | `programming_language=sql`、或 `student_answer_structured.language=sql`、或学生答案同时出现 SQL 动词与子句关键词时加载 |
| `README.md` | **不会被加载**，仅供团队阅读 |

# 智评线教师产品介绍

面向即将使用系统的教师。保留纸墨配色、仓耳今楷字体栈和线上系统截图，以课程为主线介绍产品，重点讲清资料出题、主观题 AI 评分和标准试卷输出。

## 放映

直接打开 [exam-teacher-preview.html](exam-teacher-preview.html)。请保留整个目录结构，HTML 依赖同目录的 CSS、screenshots 和 examples，并非可单独分发的文件。网络字体离线时会使用本机备用字体。

- `←` / `→`、空格、PageUp / PageDown：翻页。
- `N`：显示或隐藏讲者备注。
- `F`：全屏。
- `Home` / `End`：首页或末页。

也可在安装 Slidev CLI 的环境中运行：

```bash
slidev exam-teacher-slidev.md
```

## 内容安排（17 页）

| 页码 | 内容 |
| --- | --- |
| 1–3 | 产品定位、教学中的问题、课程使用流程 |
| 4–6 | 创建课程与关联学期班级、知识树、题库与试卷 |
| 7 | **资料出题**：带入课程资料，指定要求，核对后存入题库 |
| 8 | **标准试卷输出**：展示实际导出器输出的卷面，说明空白版、含答案版及 Word / PDF |
| 9 | 按班级组织考试与练习 |
| 10–11 | **主观题 AI 评分**：依据、老师复核、实际批阅界面 |
| 12 | **系统真实提示词**：展示评分服务实际拼接的 system prompt、user prompt 和 Context |
| 13–15 | 成绩分析、学生端、学习通连接 |
| 16–17 | 教师工作的变化与三个现场演示环节 |

讲解重点放在第 7、8、10–12 页。目录创建等设置环节简要介绍，现场演示可直接使用已准备好的课程、资料和答卷。

## 示例与来源

- [主观题评价提示词](examples/subjective-grading-prompt.md)：按当前评分服务还原真实提示词模板、Context 字段和输出协议，附系统规则源码链接。
- [空白试卷 PDF](examples/standard-paper-blank.pdf) / [Word](examples/standard-paper-blank.docx)：当前 `backend/src/app/exams/paper_export/` 导出器生成，使用演示学校、演示题目，不读取数据库。
- [含答案试卷 PDF](examples/standard-paper-answers.pdf) / [Word](examples/standard-paper-answers.docx)：同一组示例题目的含答案版本。
- `examples/standard-paper-preview.png`：空白 PDF 首页面的渲染图。
- `screenshots/`：沿用已有线上截图。涉及答卷的截图使用原有安全裁切版本。

“标准试卷”指系统现有卷面模板，不能承诺符合所有学校的专用格式。学习通页面截图时尚未启用连接，实际使用需配置并授权。资料知识点提取须经过教师核对，提示词中的规则也不等于模型结果必然正确。

## 后续维护

修改 `exam-teacher-slidev.md` 与 `style.css` 后，运行以下命令同步预览内容和讲者备注：

```bash
node build-preview.mjs
```

脚本保留现有预览外壳和放映操作，读取本稿的 HTML 正文；页码在源稿中维护。新增或删页后也要更新页码及本文件目录。

对应实现：

- 资料出题：`frontend/src/pages/knowledge/MaterialAIGenerateDialog.tsx`。
- 评分规则：`backend/src/app/grading/prompts/common-base.md`、`short-answer.md` 和 `backend/src/app/grading/service.py`。
- 试卷导出：`backend/src/app/papers/router.py` 的 `export_paper_endpoint` 及 `backend/src/app/exams/paper_export/`。

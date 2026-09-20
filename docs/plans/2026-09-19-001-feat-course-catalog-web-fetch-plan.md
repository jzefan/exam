# 课程目录「获取目录」功能设计（书名/封面 → 自动获取目录）

- 日期：2026-09-19
- 状态：已实现
- 入口：我的课程 → 课程详情 → 目录 页工具条

## 1. 目标

在课程详情 → 目录 页新增 **「获取目录」** 按钮。用户上传**书籍封面**或填写**书名 / 版本**，系统自动从网上获取该书目录，展示为可编辑的层级目录树，确认后导入为课程目录。

## 2. 可行性实测结论（2026-09-19 实测）

| 访问方式 | 当当 | 京东 | 出版社官网 |
| --- | --- | --- | --- |
| 纯 HTTP（httpx/curl） | 商品详情页返回阿里云 WAF 的 JS 挑战页 | 搜索 302、商品页只回首页空壳 | 部分可达，但多为 SPA/CMS，正文需 JS 渲染 |
| 真实浏览器（Playwright + 本机 Chrome） | **搜索页可用**；**详情页被 WAF 拦截**（"由于您访问的URL有可能对网站造成安全威胁，您的访问被阻断"） | **搜索强制跳登录页** | 站点异构，电子工业社 / 人卫社实测不稳定 |
| 可用碎片 | 搜索页能稳定拿到书名 / 作者 / 出版社 / 价格 / 链接 | 无 | 人卫社 `search?keyword=` 可用 |

**结论：京东与当当的图书目录页都有反爬，程序拿不到逐字目录。** 因此采用「检索候选 → 出版社官网 → 大模型兜底」的多级降级方案（已与用户确认路线）。

## 3. 方案：多级降级管线

```
① 输入        上传封面（VL 识别书名/版本）  或  手填 书名 / 版本
                        ↓
② 检索书源     当当搜索（httpx + GBK 编码）
               → 候选列表：书名 / 作者 / 出版社 / 出版日期 / 价格 / 链接
                        ↓  用户选定「是哪一本」
③ 取目录
   L1  出版社官网（候选里拿到出版社时优先）
       内置「出版社 → 官网域名 + 站内搜索 URL 模板」映射表
       → 抓图书详情页正文 → 正文交给 LLM 结构化 → paths
   L2  大模型还原（L1 无出版社 / 抓取失败 / 正文无目录时）
       用 书名 + 版本 + 作者 + 出版社 让 LLM 输出 paths
                        ↓
④ 审核        前端预览目录树，逐条可增 / 删 / 改，标注来源
                        ↓
⑤ 导入        复用现有课程目录导入接口写入课程目录
```

### 关键设计取舍

- **L1 不为每家出版社写适配器。** 只维护「出版社 → 官网域名 + 搜索 URL 模板」的配置表；正文抽取走通用逻辑，目录结构化统一交给 LLM。站点改版时只会**降级**到 L2，不会报错中断。
- **来源标注。** 返回值带 `source`（`publisher_site` / `llm`）与 `source_url`。前端明确提示：来自官网的请核对，来自模型推断的务必逐条校对。
- **人工审核是准确性的最终保证。** 目录树在导入前始终可编辑，用户不满意可整体丢弃。
- **不做「粘贴目录文本」兜底入口**（按用户决定）。

## 4. 接口设计

均在现有 `learning/router.py` 下，前缀 `/api/teacher/courses`：

| 方法 | 路径 | 入参 | 出参 |
| --- | --- | --- | --- |
| POST | `/catalog-web/recognize-cover` | `image`(base64)、`file_name` | `{title, edition, author, publisher, confidence}` |
| POST | `/catalog-web/search` | `keyword`(书名/ISBN)、`limit` | `{candidates: [{title, author, publisher, publish_date, price, url, source}]}` |
| POST | `/catalog-web/fetch` | `title`、`edition?`、`author?`、`publisher?` | `{paths: [[...]], source, source_url, notes}` |

- 权限：复用 `WriteUser`（与 `catalog-photo/recognize` 一致）。
- 导入：不新增接口，复用课程目录现有的导入 / 批量创建知识点能力。

## 5. 前端交互

新组件 `KnowledgeCatalogWebDialog.tsx`，三步式：

1. **输入步**：两个 Tab —「上传封面」/「填写书名」。填写书名时带版本输入框（如「第 8 版」）。
2. **选书步**：候选书卡片列表（书名 / 作者 / 出版社 / 出版日期 / 价格），点选一本。
3. **预览步**：目录树预览（复用 `KnowledgeImportTreePreview`），支持增删改；顶部显示来源徽标；底部「确认导入」。

入口按钮加在 `KnowledgeTab` 工具条，位于「书籍目录拍照导入」旁边。

## 6. 任务清单

**后端**
- T1 新增 `learning/catalog_sources/` 模块骨架（`models` / `dangdang` / `publisher` / `llm` / `service`）
- T2 当当搜索适配器（GBK 编码 + 候选解析）
- T3 出版社官网映射表 + 通用正文抽取
- T4 LLM 目录结构化 / 还原（复用现有 httpx + settings 约定）
- T5 编排服务：三级降级 + 来源标注
- T6 三个路由 + schemas

**前端**
- T7 `catalog-web` API 调用层
- T8 `KnowledgeCatalogWebDialog.tsx` 三步式弹窗
- T9 `KnowledgeTab` 增加「获取目录」按钮与接线
- T10 目录树可编辑（增删改）能力

**测试**
- T11 后端单测：当当解析、正文抽取、降级分支、编排
- T12 前端单测：弹窗流程、按钮接线

## 7. 风险与待确认点

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 出版社官网覆盖率有限（多为 SPA） | L1 命中率低，多数请求落到 L2 | 先内置主流出版社；命中率可后续按实际使用补充 |
| 大模型还原的目录可能不准确 | 目录内容错误 | 强制人工审核编辑；标注来源 |
| 当当搜索页改版或加反爬 | 检索环节失效 | 适配器隔离，失败时提示用户手填目录关键字重试 |
| 生产服务器网络环境与本地不同 | 抓取表现可能不同 | 上线前在生产服务器复测 |

## 8. 待确认

- 出版社官网首批覆盖范围：内置主流出版社（教育 / 医学 / 计算机方向），未覆盖走大模型 —— 是否认可？

## 9. 实现落地（2026-09-19）

### 后端

| 文件 | 内容 |
| --- | --- |
| `backend/src/app/learning/catalog_web/dangdang.py` | 当当搜索适配器。`encode_keyword()` 按 GB2312→GBK→GB18030 逐级编码；`parse_search_results()` 解析 `li[id^="p"]`，取书名 / 链接 / 作者 / 出版社 / 出版日期 / 现价；识别「搜索无结果页」。 |
| `backend/src/app/learning/catalog_web/publisher.py` | 12 家出版社官网映射（含别名与后缀归一）。`normalize_publisher_name()` 反复剥离「有限公司 / 出版社」等后缀；前缀模糊匹配设了 4 字下限，避免「人民出版社」误配「人民邮电出版社」。`html_to_text()` 去脚本样式、保留块级换行；`catalog_confidence()` 判断页面是否值得送去结构化；`extract_book_links()` 排除 news/about/login 等非图书链接。 |
| `backend/src/app/learning/catalog_web/llm_toc.py` | `structure_catalog_from_text()`（正文 → 目录）与 `generate_catalog_from_knowledge()`（凭书名还原）。按 DeepSeek → Qwen 顺序降级，低温度、只输出 JSON。 |
| `backend/src/app/learning/catalog_web/service.py` | 编排：有出版社先走官网，失败 / 无目录则降级大模型；返回值带 `source` / `source_url` / `notes`。另含 `recognize_book_cover()` 走 Qwen VL 读封面。 |
| `backend/src/app/learning/schemas.py` / `router.py` | 新增 3 个路由：`/api/knowledge/catalog-web/recognize-cover`、`/search`、`/fetch`，权限复用 `WriteUser`，异常映射与 `catalog-photo/recognize` 一致（ValueError→422、RuntimeError→503）。 |

### 前端

| 文件 | 内容 |
| --- | --- |
| `frontend/src/pages/knowledge/catalog-web-api.ts` | 三个接口的调用层 + `extractErrorMessage()`（解 FastAPI 的 `detail`）+ 目录文本 ↔ 目录树互转。 |
| `frontend/src/pages/knowledge/KnowledgeCatalogWebDialog.tsx` | 三步式弹窗：①填写书名 / 上传封面（封面走 VL 识别后自动检索）②确认是哪一本 ③校对目录并导入。预览步支持来源徽标、逐条删除、以及「编辑目录」文本模式（每行一条，`>` 分隔层级）。 |
| `frontend/src/pages/courses/detail.tsx` | `KnowledgeTab` 工具条在「书籍目录拍照导入」旁新增「获取目录」按钮；导入复用既有 `handleImportKnowledgePaths`。 |

### 验证结果

- 实测当当检索：`计算机网络 谢希仁` → 命中 5 条，出版社正确识别为「电子工业出版社」。
- 实测大模型链路：谢希仁《计算机网络》第 8 版 → 生成 64 条目录（第一章 概述 / 第二章 物理层 / 第三章 数据链路层…），与真书结构一致；返回 `source=llm` 并提示「大模型推断，请逐条确认」。
- 实测出版社官网：高教社 / 电子工业社均为 SPA，未取到目录 → 按设计降级，不报错。
- 测试：后端 `tests/test_catalog_web.py` 18 项通过；前端 `catalog-web-api.test.ts` + `KnowledgeCatalogWebDialog.test.tsx` 共 12 项通过；`tsc -b` 无错误。

### 已知限制

- 出版社官网命中率低（站点多为 SPA/CMS），绝大多数请求会落到大模型推断 —— 这是当前方案的主要短板，也是「目录准确性靠人工校对兜底」的原因。
- 京东完全无法使用（搜索强制登录），因此检索只接了当当。

## 10. 上线后修订（2026-09-19 下午）

### 修复：检索图书返回 500

- **现象**：弹窗点「检索图书」得到 `Internal Server Error`。
- **根因**：`/catalog-web/search` 把数据层的 `dangdang.BookCandidate`（dataclass）直接传给 Pydantic 响应模型 `CatalogWebSearchResponse`。Pydantic v2 默认不从对象读属性，校验抛错后由 Starlette 兜底成纯文本 500。
- **修复**：`CatalogWebCandidate` 增加 `model_config = ConfigDict(from_attributes=True)`。
- **回归防护**：`tests/test_catalog_web.py` 新增「路由响应模型」节 2 条用例（dataclass → 响应模型；路由端到端序列化）。

### 界面调整（`KnowledgeCatalogWebDialog.tsx`）

- 弹窗宽度收窄为 `w-[55vw] min-w-[600px] max-w-[880px]`（原 `max-w-[1100px] w-[95vw]`）。
- 书名输入、版本输入与「检索图书」按钮排到同一行（`flex flex-wrap items-end gap-3`），移除原先独立的右对齐按钮行。

### 修复：目录只返回第一章

- **现象**：对「计算机网络简明教程」只拿到 6 条（全部是第一章的小节），其余章节缺失。
- **根因**：生成提示词原第 5 条要求「只输出你有把握的内容，不确定就只输出很确定的章」，
  模型对冷门版本没把握时便只答了第一章。UI 层（`KnowledgeImportTreePreview`）无任何截断逻辑。
- **修复**（`catalog_web/llm_toc.py`）：
  1. 提示词改为**必须输出全书完整目录**（从第一章排到最后一章，每章小节列全），
     同时保留「记不确切时至少保留章名、不要编造无关章节」的边界。
  2. `generate_catalog_from_knowledge` 的 `max_tokens` 6144 → **8192**。
  3. 新增 `_salvage_truncated_payload()`：输出被 `max_tokens` 截断导致 JSON 不完整时，
     回退到最后一个完整的 path 元素并补齐括号，**保住已生成条目而非整体判空**。
- **实测**：同一本书 6 条 → **56 条 / 9 章**，结构正确。

### 界面调整（二）：步骤条可回退

- 步骤条由 `<span>` 改为可点击的 `<button>`：第 1 步随时可回，第 2 步需已有候选，
  第 3 步需已生成目录，条件不满足则禁用；执行中（`busy`）一律禁用。
- `runSearch` 成功后清空 `result/paths` —— 重新检索意味着重新选书，旧目录作废。

### 调整：候选列表只显示有效字段

- **问题**：候选卡片整条端出当当的商品标题，夹带「正版旧书，保证质量，此书为单本而非一套，电子发票。」
  之类的广告，并且展示价格。
- **实测**：`<p class="name">` 的 `title` 属性与 `<a>` 文本内容完全一致 —— 换取值来源无效，必须在解析层清洗。
- **后端**（`catalog_web/dangdang.py`）：
  - `clean_book_title(raw, *, author, publisher)`：先按已知**出版社 → 作者**倒着切尾
    （当当标题拼接顺序即 书名→作者→出版社），再按标点分段剥离营销文案，
    段内截断后不足 4 字则整段丢弃；**全部剥光时退回原文**，避免误伤《正版语文》这类书名。
  - `extract_edition()` 提取「第八版 / 第8版」；`clean_person_name()` 去掉作者字段的「著 / 编著」后缀。
  - `BookCandidate` 与 `CatalogWebCandidate` 增加 `edition` 字段。
- **前端**：候选卡片显示 `书名 + 版次` 与 `作者 · 出版社 · 年份`，**不再显示价格**；
  `handlePick` 改用 `candidate.edition || book.edition`（候选自带版次时优先）。

### 调整（三）：候选去重 + 第 3 步「编辑目录」与目录页对齐

- **候选去重**（`catalog_web/dangdang.py`）：当当把同一本书按卖家 / 新旧拆成多条，
  元数据完全一样，界面上就是几行重复。新增 `candidate_signature()`，指纹按
  「书名 + 作者 + 出版社 + **年份** + 版次」算（年份只取 4 位 —— 同年不同印次在列表里
  显示成同一年，拆开去重对用户没有意义）；`parse_search_results` 逐条去重后**继续往后扫**
  直到凑满 `limit`，所以清理重复不会让候选变少。
  实测搜「计算机网络简明」：3 条完全相同的 2017 版合并成 1 条。
- **第 3 步「编辑目录」改成与目录页同款编辑器**：新增
  `frontend/src/pages/knowledge/KnowledgeCatalogDraftEditor.tsx`，版式照搬
  `courses/detail.tsx` 的 `KnowledgeTreeEditorPage` —— 顶部「返回目录 + 编辑课程目录」、
  左侧「知识树」（可展开 / 可选中）、右侧「名称（改名 + 保存）/ 新增子知识点 / 删除知识点」。
  差别只有两点：操作对象是**还没落库的草稿 paths**；树根是课程本身（取 `lockedRootName`），
  根节点不可改名、不可删除。
- **配套纯函数**（`import-knowledge-utils.ts`）：`buildKnowledgeDraftTree` / `draftNodeKey` /
  `draftKeyFromPrefix` / `findKnowledgeDraftNode` / `countKnowledgeDraftNodes` /
  `renameKnowledgeDraftNode` / `addKnowledgeDraftChildren` / `removeKnowledgeDraftNode` /
  `dedupeKnowledgeImportPaths`。改名作用于该节点下**所有路径的同一层**；删除**级联**下级。
- **弹窗**（`KnowledgeCatalogWebDialog.tsx`）：`editing: boolean` 换成
  `editorView: "preview" | "tree" | "text"`；编辑态下弹窗加宽到
  `w-[86vw] max-w-[1180px]`（要过 `lg` 断点才排得下两栏）；编辑器内保留「批量编辑」
  作为原有文本编辑的次级入口。
- **踩坑**：节点 key 由路径算出来，改名后 key 变了 → 选中状态被重置回根节点。
  修法是在 `handleRename` 里同步 `setSelectedKey(draftKeyFromPrefix(nextPrefix))`。
- **验证**：后端 `test_catalog_web.py` 30 passed；前端 `import-knowledge-utils.test.ts`
  14 passed、`KnowledgeCatalogWebDialog.test.tsx` 8 passed；`tsc -b` 干净；
  编辑器两栏高度 `min(520px, calc(100vh - 340px))` 已确认编译生效，矮屏不会被裁掉。


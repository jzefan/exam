# PDF 智能题目导入设计

## 背景

当前题库导入支持 PDF、DOCX、Markdown、JSON、ZIP 等格式，但 PDF 题库的高质量结构化仍依赖多步流程：用户先用外部工具识别 PDF 为 JSON，再将 JSON 与图片打包上传。这个流程对用户不友好，尤其是包含大量病理、影像、图表题的 PDF。

目标是把“抽取 JSON + 图片 + 上传导入”合并成一个步骤：用户只上传 PDF，系统内部完成题目识别、图片抽取、JSON 校验和草稿生成，然后进入现有审核导入页面。

## 目标

- 用户上传一个 PDF 后，直接看到可审核的题目草稿。
- 识别结果包含题干、选项、答案、解析和题目图片。
- 用户不需要手动生成 JSON、不需要打 ZIP、不需要手动上传 images 文件夹。
- 复用现有审核、编辑、批量导入流程。
- 保留现有 JSON、ZIP、DOCX、Markdown 导入能力。

## 非目标

- 不在第一版实现整页截图识别。
- 不要求自动裁剪题目区域截图。
- 不把 PDF 原文转成可下载中间 ZIP。
- 不重写现有导入审核 UI。

## 方案选择

采用后端一体化 PDF 智能导入。

流程：

```text
用户上传 PDF
→ 后端读取 PDF
→ 提取每页文本与内嵌图片
→ 上传/生成图片 URL
→ 调用 DeepSeek V4 Pro 输出标准 JSON 数组
→ 校验 JSON schema
→ 按 filename 匹配题目图片
→ 转换成现有 QuestionImportDraft[]
→ 前端进入现有核对导入内容页面
```

选择该方案的原因：

- API key 不暴露到浏览器。
- 大 PDF 和大量图片处理在后端完成，更可控。
- 可记录日志、重试、限流和错误原因。
- 前端只需要处理上传和展示结果。

## 后端接口

新增接口：

```text
POST /api/questions/import/pdf-json-recognize
Content-Type: multipart/form-data
file=<pdf>
```

返回：

```json
{
  "mode": "ai_full",
  "summary": {
    "total": 120,
    "duplicates_removed": 0,
    "high_confidence": 100,
    "medium_confidence": 18,
    "low_confidence": 2,
    "issue_count": 5,
    "pending_review": 120,
    "approved": 0,
    "skipped": 0,
    "incomplete_choice_count": 0,
    "visual_retry_recommended": false
  },
  "drafts": []
}
```

返回结构复用 `QuestionImportDocumentRecognizeResponse`，前端不需要新增审核数据结构。

## PDF 处理

后端处理 PDF 时执行：

1. 提取每页文本。
2. 提取 PDF 内嵌图片对象。
3. 为图片生成稳定文件名，例如按页内顺序使用 `q0001_1.png`、`q0001_2.png`，无法归属题号时使用 `pdf-img-001.png`。
4. 上传图片或写入现有上传目录，生成可访问 URL。
5. 构造图片清单供模型引用。

图片对象结构：

```json
{
  "image_id": "pdf-img-001",
  "filename": "q69_1.png",
  "page": 15,
  "url": "/uploads/.../q69_1.png",
  "description": ""
}
```

第一版只抽取内嵌图片，不渲染整页截图。

限制：

- 最大图片数默认 300。
- 超过限制时返回清晰错误：`PDF 图片过多，请拆分后上传。`
- 图片提取失败不阻断纯文本题识别，但会返回 warning issue。

## DeepSeek V4 Pro JSON 识别

后端构造 prompt，让 DeepSeek V4 Pro 只输出 JSON 数组。

目标 JSON schema：

```json
[
  {
    "id": 69,
    "type": "single_choice",
    "content": "题干",
    "options": {
      "A": "选项A",
      "B": "选项B"
    },
    "answer": "D",
    "analysis": "",
    "images": [
      {
        "filename": "q69_1.png",
        "position": "题干后",
        "description": "主动脉粥样硬化病理图片"
      }
    ]
  }
]
```

允许题型：

- `single_choice`
- `multiple_choice`
- `true_false`
- `fill_in`
- `short_answer`
- `essay`
- `code`

校验规则：

- 顶层必须是数组。
- 每题必须有 `content`。
- 选择题必须有 `options`。
- `answer` 可为空，但会产生 `未识别到答案` issue。
- `images[].filename` 必须能匹配后端抽取图片，否则产生 `图片未匹配` issue。
- 合法 JSON 转成现有 `QuestionImportDraft[]`。

失败策略：

- 第一次 JSON 解析失败时，追加“修复 JSON 格式”提示重试一次。
- 重试仍失败，返回清晰错误，不进入审核页。
- 部分题有问题时仍返回草稿，题目标记为待审核。

## 图片绑定

后端使用 `filename` 做图片匹配。

匹配成功：

```json
{
  "image_id": "pdf-img-001",
  "url": "/uploads/.../q69_1.png",
  "order": 1,
  "page": 15,
  "alt": "主动脉粥样硬化病理图片"
}
```

写入对应 `QuestionImportDraft.images`。

匹配失败：

- 不阻断导入。
- 题目 `issues` 增加 `图片未匹配：q69_1.png`。
- 前端审核页显示 warning。

## 前端体验

上传区文案：

```text
支持 PDF、Word、JSON、ZIP，PDF 可自动识别题目和图片
```

当用户上传 PDF：

1. 显示 loading overlay：`正在解析 PDF 并识别题目...`
2. 调用 `/api/questions/import/pdf-json-recognize`
3. 成功后进入现有“核对导入内容”页面
4. 显示 badge：`PDF 智能解析`
5. 图片直接显示在题目审核编辑器中
6. 若有图片未匹配或题目异常，显示 warning

其他格式保持现有行为：

- JSON：前端 JSON parser
- ZIP：前端 JSON + images parser
- DOCX/Markdown：现有识别链路
- PDF：默认走新的一体化后端识别

## 错误处理

用户可见错误：

- 非 PDF 调新接口：`请上传 PDF 文件。`
- PDF 图片过多：`PDF 图片过多，请拆分后上传。`
- 未识别到题目：`未识别到题目，请检查 PDF 内容或拆分后重试。`
- AI 服务不可用：`题目识别服务暂不可用，请稍后重试。`
- JSON 解析失败：`AI 返回 JSON 格式无效，请重试。`

部分错误进入审核页：

- 未识别答案
- 图片未匹配
- 选择题选项不足
- 题型置信度低

## 测试计划

后端测试：

- 非 PDF 上传返回 400。
- PDF 成功路径：模拟文本、图片提取和 DeepSeek JSON 返回，断言返回 drafts。
- 图片匹配成功：`images.filename` 绑定到抽取图片 URL。
- 图片未匹配：题目包含 issue，整体返回成功。
- JSON 修复重试：第一次非法 JSON，第二次合法 JSON。
- 图片数量超限：返回清晰错误。
- 空识别结果：返回清晰错误。

前端测试：

- 上传 PDF 调用新接口。
- PDF 成功后进入审核页。
- 成功后显示 `PDF 智能解析` 标识。
- PDF 失败显示错误。
- JSON、ZIP、DOCX、Markdown 路径不受影响。

## 验收标准

- 用户只上传 PDF，就能看到题目、选项、答案、解析和图片。
- 用户不需要手动生成 JSON、打 ZIP 或上传 images 文件夹。
- 现有审核、编辑、批量导入流程可继续使用。
- PDF 识别失败时给出明确错误，不出现空白页面或无提示失败。

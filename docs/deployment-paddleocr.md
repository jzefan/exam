# PaddleOCR 部署说明

知识库的“书籍目录拍照导入”依赖后端 OCR 能力。部署环境必须安装 PaddleOCR，否则普通用户会看到：

```text
目录识别服务暂不可用，请联系管理员处理。
```

## 安装

在后端环境中安装 OCR 依赖：

```bash
cd backend
uv sync --extra ocr
```

如果部署环境没有使用 `uv sync`，也可以按项目依赖管理方式安装：

```bash
cd backend
uv add --optional ocr paddleocr paddlepaddle
```

## 验证

启动后端前，先确认 PaddleOCR 可以被 Python 导入：

```bash
cd backend
PYTHONPATH=src uv run --extra ocr python -c "from paddleocr import PaddleOCR; print('PaddleOCR ready')"
```

然后启动后端服务，进入知识点管理页面，使用“书籍目录拍照导入”上传目录照片进行验证。

## 性能建议

- 默认会在服务启动后做一次 OCR 预热，减少首个识别请求的冷启动等待。
- 默认同一时刻只允许 1 个 PaddleOCR 任务执行；如需调整，可设置环境变量：

```bash
export PADDLE_OCR_MAX_CONCURRENCY=1
```

- 不建议把并发调得过高。PaddleOCR 会常驻模型内存，并发越高越容易出现内存占用大、整体更慢的问题。
- 目录拍照导入时，建议每次上传 2 到 4 张连续目录页，避免一次上传过多图片。
- 前端会自动压缩和限制目录图片尺寸，但仍建议优先上传清晰、只包含目录区域的图片。

## 常见问题

- 如果用户看到“目录识别服务暂不可用，请联系管理员处理”，优先检查后端环境是否安装了 `paddleocr` 和 `paddlepaddle`。
- 如果识别结果为空，通常是目录照片不清晰、文字过小、拍摄角度过斜，建议重新拍摄更清晰的目录页。
- 如果识别到文字但无法整理层级，建议检查图片顺序是否正确，或确认目录中是否包含明显的章、节、小节编号。

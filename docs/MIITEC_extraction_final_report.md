# MIITEC 标准岗位模型提取与导入完成报告（更新）

## 执行时间
2026-04-16

## 原始提取来源
- T/MIITEC 001-2023《人工智能产业人才岗位能力要求》
- T/MIITEC 032-2025《低空产业人才岗位能力要求》
- T/MIITEC 026-2025《生物医药产业人才岗位能力要求》

## 本轮补齐（模板实数化）
本轮在既有提取成果基础上，完成了三批模板文件的实数化替换与导入验证：

### 第一批
- `backend/scripts/data/templates/ic_industry.json`
- `backend/scripts/data/templates/big_data.json`
- `backend/scripts/data/templates/data_annotation.json`

对应岗位规模（文件内）：
- 集成电路产业：31
- 大数据产业：8
- 数据标注产业：4

### 第二批（AI 八方向）
- `backend/scripts/data/templates/ai_industry_smart_chip.json`（智能芯片，4）
- `backend/scripts/data/templates/ai_industry_machine_learning.json`（机器学习，7）
- `backend/scripts/data/templates/ai_industry_deep_learning.json`（深度学习，4）
- `backend/scripts/data/templates/ai_industry_speech.json`（智能语音，6）
- `backend/scripts/data/templates/ai_industry_nlp.json`（自然语言处理，8）
- `backend/scripts/data/templates/ai_industry_cv.json`（计算机视觉，7）
- `backend/scripts/data/templates/ai_industry_kg.json`（知识图谱，5）
- `backend/scripts/data/templates/ai_industry_robot.json`（服务机器人，3）

对应岗位规模（文件内）：
- AI 八方向模板合计：44

### 第三批（生物医药）
- `backend/scripts/data/templates/biopharma.json`（由 `seed_standard_job_models.py` 中 `industry_name == "生物医药"` 的结构化数据转换）

对应岗位规模（文件内）：
- 生物医药：34

## 结果边界（重要）
- ✅ 已完成：上述 12 个模板文件（3 + AI 8 + 生物医药 1）的占位内容替换、JSON 校验、导入与幂等验证。
- ✅ 已完成：后端 job_models 核心测试与前端标准库/快创页面测试通过。
- ⚠️ 边界说明：本报告仅覆盖上述模板文件与导入链路，不对未列入文件作完成性声明。

## 复现命令

### 1) 导入
```bash
cd backend
PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/ic_industry.json
PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/big_data.json
PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/data_annotation.json

PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/ai_industry_smart_chip.json
PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/ai_industry_machine_learning.json
PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/ai_industry_deep_learning.json
PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/ai_industry_speech.json
PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/ai_industry_nlp.json
PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/ai_industry_cv.json
PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/ai_industry_kg.json
PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/ai_industry_robot.json

PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/biopharma.json
```

### 2) 幂等验证
重复执行上面导入命令，期望 `Created 0, skipped N`。

### 3) 测试验证
```bash
# backend
cd backend
PYTHONPATH=src uv run pytest tests/job_models/test_fast_create_phase1.py tests/job_models/test_router.py tests/job_models/test_service.py -v

# frontend
cd ../frontend
pnpm vitest run src/pages/job-models/standard-library.test.tsx src/pages/job-models/fast-create.test.tsx
```

## 总结
- 报告已更新为“按范围完成”，并纳入生物医药模板补齐结果。
- 本轮目标（IC/大数据/数据标注 + AI 八方向 + 生物医药）已按可复现流程完成并验证通过。

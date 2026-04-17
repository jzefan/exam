# MIITEC 标准岗位模型导入完成报告（更新）

## 更新时间
2026-04-16

## 本次变更范围（实数化）
已将以下模板文件中的占位内容替换为可导入的真实结构化数据：

### 第一批（已完成）
- `backend/scripts/data/templates/ic_industry.json`（由 `ic_design_manufacturing.json + ic_package_test.json` 合并）
- `backend/scripts/data/templates/big_data.json`（同步 `big_data_complete.json`）
- `backend/scripts/data/templates/data_annotation.json`（从 `big_data_complete.json` 的“数据标注”方向拆分）

### 第二批（AI 八方向，已完成）
- `backend/scripts/data/templates/ai_industry_smart_chip.json`（智能芯片，4）
- `backend/scripts/data/templates/ai_industry_machine_learning.json`（机器学习，7）
- `backend/scripts/data/templates/ai_industry_deep_learning.json`（深度学习，4）
- `backend/scripts/data/templates/ai_industry_speech.json`（智能语音，6）
- `backend/scripts/data/templates/ai_industry_nlp.json`（自然语言处理，8）
- `backend/scripts/data/templates/ai_industry_cv.json`（计算机视觉，7）
- `backend/scripts/data/templates/ai_industry_kg.json`（知识图谱，5）
- `backend/scripts/data/templates/ai_industry_robot.json`（服务机器人，3）

### 第三批（生物医药，已完成）
- `backend/scripts/data/templates/biopharma.json`（来源于 `seed_standard_job_models.py` 中 `industry_name == "生物医药"` 的结构化数据转换）

### 第四批（新材料，已完成）
- `backend/scripts/data/templates/new_materials.json`（来源于 `backend/scripts/data/extracted/new_materials_complete.json`）

### 第五批（制造业可靠性，已完成）
- `backend/scripts/data/templates/manufacturing_reliability.json`（基于《制造业可靠性人才岗位能力要求》直接整理为 importer 可消费模板）

## 本次文件级数据规模
- 集成电路产业：31 个岗位
- 大数据产业：8 个岗位
- 数据标注产业：4 个岗位
- AI 八方向模板合计：44 个岗位
- 生物医药：34 个岗位
- 新材料产业：13 个岗位
- 制造业可靠性：17 个岗位

## 导入验证

### 导入命令
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
PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/new_materials.json
PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/manufacturing_reliability.json
```

### 幂等性验证
- 首次导入 `biopharma.json`：`Created 34, skipped 0`
- 二次导入 `biopharma.json`：`Created 0, skipped 34`
- 新材料 `new_materials.json`：已纳入完成范围，本报告不补记当次 created/skipped 明细
- 首次导入 `manufacturing_reliability.json`：`Created 17, skipped 0`
- 二次导入 `manufacturing_reliability.json`：`Created 0, skipped 17`

### 占位符检查（目标文件）
```bash
python3 - <<'PY'
from pathlib import Path
base=Path('backend/scripts/data/templates')
names=[
  'ic_industry.json','big_data.json','data_annotation.json',
  'ai_industry_smart_chip.json','ai_industry_machine_learning.json','ai_industry_deep_learning.json',
  'ai_industry_speech.json','ai_industry_nlp.json','ai_industry_cv.json','ai_industry_kg.json','ai_industry_robot.json',
  'biopharma.json','new_materials.json','manufacturing_reliability.json'
]
for name in names:
    txt=(base/name).read_text(encoding='utf-8')
    bad=[k for k in ['TODO','待补充','placeholder','占位'] if k in txt]
    print(name, 'OK' if not bad else f'BAD:{bad}')
PY
```

## 回归验证

### Backend
```bash
cd backend
PYTHONPATH=src uv run pytest tests/job_models/test_fast_create_phase1.py tests/job_models/test_router.py tests/job_models/test_service.py -v
```
结果：17 passed

### Frontend
```bash
cd frontend
pnpm vitest run src/pages/job-models/standard-library.test.tsx src/pages/job-models/fast-create.test.tsx
```
结果：8 passed

## 说明
- 本次是“模板实数化 + 导入链路验证”，未重写导入架构，继续复用 `import_standard_models.py`。
- 生物医药来源为 seed 结构化数据转换（`seed_standard_job_models.py`），并已纳入与其他产业一致的模板导入路径。
- 报告内容保持“按范围完成”，避免过度声明。

# 制造业可靠性 MIITEC 导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将《制造业可靠性人才岗位能力要求》纳入现有 MIITEC 标准岗位模型链路，完成提取、模板生成、导入、幂等验证、回归测试与报告更新。

**Architecture:** 复用现有成熟流程：在 `backend/scripts/extract_pdfs_intelligent.py` 中新增 PDF 配置，产出 `backend/scripts/data/extracted/manufacturing_reliability_complete.json`，再映射到 `backend/scripts/data/templates/manufacturing_reliability.json` 并通过 `backend/scripts/import_standard_models.py` 导入。所有验证沿用当前 job models 回归测试与 MIITEC 报告口径，不重构提取器和 importer。

**Tech Stack:** Python (uv, pytest, json.tool), Anthropic SDK extraction script, FastAPI backend, React + Vitest frontend, existing MIITEC import scripts.

---

## File Structure

- Modify: `backend/scripts/extract_pdfs_intelligent.py`
  - 增加“制造业可靠性”PDF 配置，复用现有提取器生成中间 JSON。
- Create: `backend/scripts/data/extracted/manufacturing_reliability_complete.json`
  - 保存结构化提取结果。
- Create: `backend/scripts/data/templates/manufacturing_reliability.json`
  - 保存 importer 可直接消费的模板数据。
- Modify: `backend/scripts/batch_import.sh`
  - 若模板列表仍为显式枚举，则加入 `manufacturing_reliability.json`。
- Modify: `docs/MIITEC_import_report.md`
  - 补充制造业可靠性导入命令、幂等结果、计数与批次描述。
- Modify: `docs/MIITEC_extraction_final_report.md`
  - 补充制造业可靠性提取来源、模板文件、完成边界。
- Verify: `backend/tests/job_models/test_fast_create_phase1.py`
- Verify: `backend/tests/job_models/test_router.py`
- Verify: `backend/tests/job_models/test_service.py`
- Verify: `frontend/src/pages/job-models/standard-library.test.tsx`
- Verify: `frontend/src/pages/job-models/fast-create.test.tsx`

## Task 1: 接入 PDF 提取配置并生成结构化结果

**Files:**
- Modify: `backend/scripts/extract_pdfs_intelligent.py`
- Create: `backend/scripts/data/extracted/manufacturing_reliability_complete.json`

- [ ] **Step 1: 确认 PDF 文件路径存在**

Run:
```bash
ls -l "docs/miitec_pdfs/《制造业可靠性人才岗位能力要求》"*
```
Expected: 输出目标 PDF 文件路径，文件存在且可读。

- [ ] **Step 2: 在提取脚本中定位 `pdf_configs` 配置块**

Run:
```bash
grep -n "pdf_configs = \[" backend/scripts/extract_pdfs_intelligent.py
```
Expected: 返回 `pdf_configs` 定义行号，用于最小范围修改。

- [ ] **Step 3: 在 `pdf_configs` 中新增制造业可靠性配置**

在 `backend/scripts/extract_pdfs_intelligent.py` 的 `pdf_configs` 列表中加入一项：

```python
        {
            "file": "制造业可靠性人才岗位能力要求.pdf",
            "industry": "制造业可靠性",
            "output": "manufacturing_reliability_complete.json",
            "source": "《制造业可靠性人才岗位能力要求》"
        },
```

要求：
- 保持与现有列表中其他行业相同的字段顺序
- 不修改提取器其余逻辑

- [ ] **Step 4: 运行提取脚本生成结构化结果**

Run:
```bash
PYTHONPATH=backend/src uv run python backend/scripts/extract_pdfs_intelligent.py
```
Expected: 脚本成功运行，并在 `backend/scripts/data/extracted/` 目录下生成 `manufacturing_reliability_complete.json`。

- [ ] **Step 5: 检查中间 JSON 文件已生成**

Run:
```bash
ls -l backend/scripts/data/extracted/manufacturing_reliability_complete.json
```
Expected: 文件存在，大小大于 0。

- [ ] **Step 6: 校验中间 JSON 的顶层结构**

Run:
```bash
python - <<'PY'
import json
from pathlib import Path
path = Path("backend/scripts/data/extracted/manufacturing_reliability_complete.json")
data = json.loads(path.read_text())
print(sorted(data.keys()))
print(data["metadata"]["industry"])
print(type(data["models"]).__name__)
print(len(data["models"]))
PY
```
Expected: 输出包含 `metadata` 和 `models`；行业名为 `制造业可靠性`；`models` 类型为 `list`；岗位数量大于 0。

## Task 2: 生成模板并完成静态校验

**Files:**
- Read: `backend/scripts/data/extracted/manufacturing_reliability_complete.json`
- Create: `backend/scripts/data/templates/manufacturing_reliability.json`

- [ ] **Step 1: 查看中间 JSON 中首个岗位结构，确认模板映射字段**

Run:
```bash
python - <<'PY'
import json
from pathlib import Path
path = Path("backend/scripts/data/extracted/manufacturing_reliability_complete.json")
data = json.loads(path.read_text())
print(json.dumps(data["metadata"], ensure_ascii=False, indent=2))
print(json.dumps(data["models"][0], ensure_ascii=False, indent=2)[:4000])
PY
```
Expected: 能看到 metadata 与第一个岗位对象，足够据此映射模板结构。

- [ ] **Step 2: 参考已有模板文件结构**

Run:
```bash
python - <<'PY'
import json
from pathlib import Path
for name in [
    "backend/scripts/data/templates/new_materials.json",
    "backend/scripts/data/templates/biopharma.json",
]:
    data = json.loads(Path(name).read_text())
    print(name)
    print(json.dumps(data["metadata"], ensure_ascii=False, indent=2))
    print(json.dumps(data["models"][0], ensure_ascii=False, indent=2)[:2000])
PY
```
Expected: 清楚已有模板的 metadata 和单岗位结构，以便保持契约一致。

- [ ] **Step 3: 生成 `manufacturing_reliability.json` 模板文件**

将 `backend/scripts/data/extracted/manufacturing_reliability_complete.json` 映射为 `backend/scripts/data/templates/manufacturing_reliability.json`，要求模板顶层结构为：

```json
{
  "metadata": {
    "source": "《制造业可靠性人才岗位能力要求》",
    "industry": "制造业可靠性",
    "version_note": "来源：《制造业可靠性人才岗位能力要求》",
    "model_type": "standard"
  },
  "models": []
}
```

并保持每个岗位对象字段命名、层级和数组/对象结构与现有模板一致。

- [ ] **Step 4: 检查模板中是否残留占位词**

Run:
```bash
grep -RInE "TODO|待补充|placeholder|占位" backend/scripts/data/templates/manufacturing_reliability.json
```
Expected: 无输出。

- [ ] **Step 5: 做 JSON 语法校验**

Run:
```bash
python -m json.tool backend/scripts/data/templates/manufacturing_reliability.json >/dev/null
```
Expected: 命令退出码为 0，无报错。

- [ ] **Step 6: 核对模板 metadata 与岗位数量**

Run:
```bash
python - <<'PY'
import json
from pathlib import Path
path = Path("backend/scripts/data/templates/manufacturing_reliability.json")
data = json.loads(path.read_text())
print(json.dumps(data["metadata"], ensure_ascii=False, indent=2))
print(len(data["models"]))
print(data["models"][0]["job_role"])
PY
```
Expected: metadata 中 industry/source/version_note 正确；岗位数大于 0；首个岗位存在 `job_role`。

## Task 3: 导入数据库并验证幂等

**Files:**
- Read: `backend/scripts/data/templates/manufacturing_reliability.json`
- Modify: `backend/scripts/batch_import.sh`

- [ ] **Step 1: 首次导入制造业可靠性模板**

Run:
```bash
cd backend && PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/manufacturing_reliability.json
```
Expected: 输出 `Importing N models` 且 `Done. Created N, skipped 0`，其中 `N` 大于 0。

- [ ] **Step 2: 二次导入验证幂等**

Run:
```bash
cd backend && PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/manufacturing_reliability.json
```
Expected: 输出 `Done. Created 0, skipped N`，其中 `N` 与模板岗位数一致。

- [ ] **Step 3: 统计制造业可靠性模板岗位数量**

Run:
```bash
python - <<'PY'
import json
from pathlib import Path
path = Path("backend/scripts/data/templates/manufacturing_reliability.json")
data = json.loads(path.read_text())
print(len(data["models"]))
PY
```
Expected: 输出明确的岗位总数，供报告填写。

- [ ] **Step 4: 检查 `batch_import.sh` 是否已显式列出模板**

Run:
```bash
grep -n "templates/.*\.json" backend/scripts/batch_import.sh
```
Expected: 输出模板列表；可判断是否需要新增 `templates/manufacturing_reliability.json`。

- [ ] **Step 5: 如果 `batch_import.sh` 为显式枚举，则加入新模板**

若上一步输出为显式模板数组，则在 `backend/scripts/batch_import.sh` 中追加：

```bash
    "templates/manufacturing_reliability.json"
```

要求：
- 保持现有排序策略；若当前脚本是按处理批次追加，则放在末尾
- 不修改脚本其它控制流

- [ ] **Step 6: 验证批量导入脚本包含新模板**

Run:
```bash
grep -n "manufacturing_reliability.json" backend/scripts/batch_import.sh
```
Expected: 能找到对应行。

## Task 4: 回归验证与报告更新

**Files:**
- Verify: `backend/tests/job_models/test_fast_create_phase1.py`
- Verify: `backend/tests/job_models/test_router.py`
- Verify: `backend/tests/job_models/test_service.py`
- Verify: `frontend/src/pages/job-models/standard-library.test.tsx`
- Verify: `frontend/src/pages/job-models/fast-create.test.tsx`
- Modify: `docs/MIITEC_import_report.md`
- Modify: `docs/MIITEC_extraction_final_report.md`

- [ ] **Step 1: 运行 backend job_models 关键测试**

Run:
```bash
cd backend && PYTHONPATH=src uv run pytest \
  tests/job_models/test_fast_create_phase1.py \
  tests/job_models/test_router.py \
  tests/job_models/test_service.py
```
Expected: 所有测试通过。

- [ ] **Step 2: 运行 frontend job-models 关键测试**

Run:
```bash
cd frontend && npm test -- --runInBand \
  src/pages/job-models/standard-library.test.tsx \
  src/pages/job-models/fast-create.test.tsx
```
Expected: 所有测试通过。

- [ ] **Step 3: 更新导入报告，新增制造业可靠性批次**

在 `docs/MIITEC_import_report.md` 中补充：

```md
### 第五批（制造业可靠性，已完成）
- `backend/scripts/data/templates/manufacturing_reliability.json`（来源于 `backend/scripts/data/extracted/manufacturing_reliability_complete.json`）
```

并在数据规模或统计部分新增一行：

```md
- 制造业可靠性：<岗位总数> 个岗位
```

同时补充实际执行过的导入命令与幂等结果，措辞保持“按范围完成”。

- [ ] **Step 4: 更新提取报告，新增制造业可靠性来源与边界**

在 `docs/MIITEC_extraction_final_report.md` 中补充：

```md
- 《制造业可靠性人才岗位能力要求》
```

新增一个制造业可靠性批次小节，写明：

```md
### 第五批（制造业可靠性）
- `backend/scripts/data/templates/manufacturing_reliability.json`（来源于 `backend/scripts/data/extracted/manufacturing_reliability_complete.json` 的结构化提取结果）
```

并把结果边界更新为仅声明已实际完成的模板、导入、幂等与测试结果。

- [ ] **Step 5: 校验两份报告中的制造业可靠性条目已写入**

Run:
```bash
grep -n "制造业可靠性\|manufacturing_reliability" docs/MIITEC_import_report.md docs/MIITEC_extraction_final_report.md
```
Expected: 两份报告都能找到新增条目。

- [ ] **Step 6: 复核变更与验证结果**

Run:
```bash
git diff -- backend/scripts/extract_pdfs_intelligent.py \
  backend/scripts/batch_import.sh \
  backend/scripts/data/templates/manufacturing_reliability.json \
  docs/MIITEC_import_report.md \
  docs/MIITEC_extraction_final_report.md
```
Expected: diff 只包含本次行业接入所需最小改动。

## Verification Checklist

1. `backend/scripts/data/extracted/manufacturing_reliability_complete.json` 已生成，且包含 `metadata` 与非空 `models`。
2. `backend/scripts/data/templates/manufacturing_reliability.json` 无占位词且 JSON 合法。
3. 首次导入成功，二次导入输出 `Created 0, skipped N`。
4. `backend/scripts/batch_import.sh` 在需要时已纳入新模板。
5. backend 与 frontend 关键测试通过。
6. 两份 MIITEC 报告已更新且只声明真实完成范围。

## Spec Coverage Self-Review

- 已覆盖 spec 的接入方式：Task 1 在现有提取器新增配置，不重构提取器。
- 已覆盖 spec 的数据流：Task 1 生成 extracted JSON，Task 2 生成 template JSON，Task 3 导入并验证幂等，Task 4 更新报告。
- 已覆盖 spec 的静态校验：Task 2 包含占位词检查与 JSON 语法校验。
- 已覆盖 spec 的失败收口：每个任务都以显式命令和 Expected 输出验证，避免未验证即继续。
- 已覆盖 spec 的边界：Task 4 的报告更新明确要求按真实完成范围书写。
- Placeholder scan: 计划中无 TBD/TODO/“类似 Task N” 之类占位描述；所有命令、路径、字段名均已写明。
- Consistency check: 全文统一使用 `manufacturing_reliability_complete.json`、`manufacturing_reliability.json` 与行业名 `制造业可靠性`。

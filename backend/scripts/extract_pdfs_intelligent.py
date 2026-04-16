"""
Intelligent PDF extraction using Claude API to extract complete job model data.

This script:
1. Extracts text from PDF files
2. Uses Claude to intelligently parse and structure the data
3. Generates complete JSON files (no TODOs)
"""

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Dict, List

import PyPDF2
from anthropic import AsyncAnthropic


async def extract_job_models_with_claude(
    pdf_text: str,
    industry: str,
    client: AsyncAnthropic
) -> Dict:
    """Use Claude to extract complete job model data from PDF text."""

    prompt = f"""你是一个专业的文档分析助手。请从以下中文产业标准文档中提取岗位能力要求信息。

产业名称：{industry}

请仔细阅读文档内容，提取以下信息：

1. **产业方向**（如：物联网、智能芯片、机器学习等）
2. **岗位名称**（如：物联网架构师、算法工程师等）
3. **能力维度**（通常包括：专业知识、技术技能、工程实践、综合能力）
4. **具体技能**和**知识点**

文档中通常按照以下格式组织：
- 5.X.Y 岗位名称
- a) 专业知识
  - 具体知识点列表
- b) 技术技能
  - 具体技能列表
- c) 工程实践
  - 具体经验要求
- d) 综合能力
  - 综合素质要求

请返回JSON格式，结构如下：
{{
  "directions": ["方向1", "方向2"],
  "jobs": [
    {{
      "job_role": "岗位名称",
      "direction_name": "所属方向",
      "dimensions": [
        {{
          "name": "专业知识",
          "skills": [
            {{
              "name": "技能名称",
              "level": "L3",
              "knowledge_points": ["知识点1", "知识点2"]
            }}
          ]
        }},
        {{
          "name": "技术技能",
          "skills": [...]
        }},
        {{
          "name": "工程实践",
          "skills": [...]
        }},
        {{
          "name": "综合能力",
          "skills": [...]
        }}
      ]
    }}
  ]
}}

重要提示：
1. 提取所有明确的能力要求，不要遗漏
2. 将相关的知识点归类到合适的技能下
3. 能力等级通常为 L1-L4，如果文档中没有明确标注，根据描述推断（L1=基础，L2=熟悉，L3=精通，L4=专家）
4. 确保每个维度都有具体的技能和知识点，不要留空
5. 只返回JSON，不要有其他解释文字

文档内容：
{pdf_text[:30000]}

请返回完整的JSON数据："""

    message = await client.messages.create(
        model="claude-opus-4-20250514",
        max_tokens=16000,
        temperature=0,
        messages=[{"role": "user", "content": prompt}]
    )

    response_text = message.content[0].text

    # Extract JSON from response
    json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError as e:
            print(f"JSON decode error: {e}")
            print(f"Response: {response_text[:500]}")
            return {"directions": [], "jobs": []}

    return {"directions": [], "jobs": []}


async def process_pdf_file(
    pdf_path: Path,
    industry: str,
    source: str,
    client: AsyncAnthropic
) -> Dict:
    """Process a single PDF file and extract all job models."""

    print(f"\n{'='*80}")
    print(f"Processing: {pdf_path.name}")
    print(f"Industry: {industry}")
    print(f"{'='*80}\n")

    # Extract text from PDF
    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)
        full_text = ""
        for i, page in enumerate(reader.pages):
            text = page.extract_text()
            full_text += text + "\n"
            if i % 10 == 0:
                print(f"  Extracted page {i+1}/{len(reader.pages)}")

    print(f"  Total text length: {len(full_text)} characters")

    # Split into chunks if needed (Claude has context limits)
    chunk_size = 30000
    chunks = []

    # Try to split at section boundaries
    sections = re.split(r'(\d+\.\d+\.\d+\s+[\u4e00-\u9fa5]+)', full_text)

    current_chunk = ""
    for section in sections:
        if len(current_chunk) + len(section) < chunk_size:
            current_chunk += section
        else:
            if current_chunk:
                chunks.append(current_chunk)
            current_chunk = section

    if current_chunk:
        chunks.append(current_chunk)

    print(f"  Split into {len(chunks)} chunks")

    # Process each chunk
    all_jobs = []
    all_directions = set()

    for i, chunk in enumerate(chunks):
        print(f"\n  Processing chunk {i+1}/{len(chunks)}...")
        try:
            result = await extract_job_models_with_claude(chunk, industry, client)

            jobs = result.get("jobs", [])
            directions = result.get("directions", [])

            print(f"    Found {len(jobs)} jobs, {len(directions)} directions")

            all_jobs.extend(jobs)
            all_directions.update(directions)

            # Show sample
            if jobs:
                print(f"    Sample: {jobs[0]['job_role']}")

        except Exception as e:
            print(f"    Error: {e}")
            continue

    print(f"\n  Total extracted: {len(all_jobs)} jobs across {len(all_directions)} directions")

    return {
        "metadata": {
            "source": source,
            "industry": industry,
            "version_note": f"来源：{source}",
            "model_type": "standard"
        },
        "models": all_jobs
    }


async def main():
    """Main extraction function."""

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set")
        return

    client = AsyncAnthropic(api_key=api_key)

    pdf_dir = Path("docs/MIITEC_PDFs")
    output_dir = Path("backend/scripts/data/extracted")
    output_dir.mkdir(parents=True, exist_ok=True)

    # PDF files to process
    pdf_configs = [
        {
            "file": "人工智能产业人才岗位能力要求.pdf",
            "industry": "人工智能产业",
            "output": "ai_industry_complete.json",
            "source": "T/MIITEC 001-2023《人工智能产业人才岗位能力要求》"
        },
        {
            "file": "大数据产业人才岗位能力要求.pdf",
            "industry": "大数据产业",
            "output": "big_data_complete.json",
            "source": "T/MIITEC《大数据产业人才岗位能力要求》"
        },
        {
            "file": "集成电路产业人才岗位能力要求.pdf",
            "industry": "集成电路产业",
            "output": "ic_industry_complete.json",
            "source": "T/MIITEC《集成电路产业人才岗位能力要求》"
        },
        {
            "file": "数据标注产业人才岗位能力要求.pdf",
            "industry": "数据标注产业",
            "output": "data_annotation_complete.json",
            "source": "T/MIITEC《数据标注产业人才岗位能力要求》"
        },
    ]

    for config in pdf_configs:
        pdf_path = pdf_dir / config["file"]
        if not pdf_path.exists():
            print(f"Skipping {config['file']} - file not found")
            continue

        try:
            result = await process_pdf_file(
                pdf_path,
                config["industry"],
                config["source"],
                client
            )

            output_path = output_dir / config["output"]
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False, indent=2)

            print(f"\n✓ Saved to: {output_path}")
            print(f"  Industry: {config['industry']}")
            print(f"  Models: {len(result['models'])}")

        except Exception as e:
            print(f"\n✗ Error processing {config['file']}: {e}")
            continue

    print("\n" + "="*80)
    print("Extraction complete!")
    print("="*80)


if __name__ == "__main__":
    asyncio.run(main())

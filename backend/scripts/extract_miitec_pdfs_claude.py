"""Extract job models from MIITEC PDF files using Claude API for intelligent parsing.

This script:
1. Extracts text from PDF files
2. Uses Claude API to intelligently parse job structures and competencies
3. Generates JSON files compatible with import_standard_models.py
"""

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Dict, List

import PyPDF2
from anthropic import AsyncAnthropic


async def extract_with_claude(text_chunk: str, industry: str, client: AsyncAnthropic) -> Dict:
    """Use Claude to extract structured job model data from PDF text."""

    prompt = f"""You are extracting job model data from a Chinese industry standards document.

Industry: {industry}

Extract the following information from the text:
1. Direction names (方向名称) - e.g., 物联网, 智能芯片, 机器学习
2. Job roles (岗位名称) - e.g., 物联网架构师, 算法工程师
3. For each job role, extract competency dimensions:
   - 专业知识 (Professional Knowledge)
   - 技术技能 (Technical Skills)
   - 工程实践 (Engineering Practice)
   - 综合能力 (Comprehensive Ability)

4. For each dimension, extract skills and their knowledge points

Return ONLY a JSON object in this exact format:
{{
  "directions": ["direction1", "direction2"],
  "jobs": [
    {{
      "job_role": "岗位名称",
      "direction_name": "方向名称",
      "dimensions": [
        {{
          "name": "专业知识",
          "skills": [
            {{
              "name": "skill name",
              "level": "L3",
              "knowledge_points": ["point1", "point2"]
            }}
          ]
        }}
      ]
    }}
  ]
}}

Text to parse:
{text_chunk[:15000]}

Return ONLY valid JSON, no explanations."""

    message = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )

    response_text = message.content[0].text
    # Extract JSON from response
    json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
    if json_match:
        return json.loads(json_match.group())
    return {"directions": [], "jobs": []}


async def process_pdf(pdf_path: Path, industry: str, client: AsyncAnthropic) -> Dict:
    """Process a single PDF file."""

    print(f"Processing {pdf_path.name}...")

    # Extract text
    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)
        full_text = ""
        for page in reader.pages:
            full_text += page.extract_text() + "\n"

    # Split text into chunks (Claude has context limits)
    chunk_size = 15000
    chunks = [full_text[i:i+chunk_size] for i in range(0, len(full_text), chunk_size)]

    all_jobs = []
    all_directions = set()

    for i, chunk in enumerate(chunks[:5]):  # Process first 5 chunks
        print(f"  Processing chunk {i+1}/{min(5, len(chunks))}...")
        try:
            result = await extract_with_claude(chunk, industry, client)
            all_jobs.extend(result.get("jobs", []))
            all_directions.update(result.get("directions", []))
        except Exception as e:
            print(f"  Error processing chunk {i+1}: {e}")

    return {
        "directions": list(all_directions),
        "jobs": all_jobs
    }


async def main():
    """Main extraction function."""

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set")
        return

    client = AsyncAnthropic(api_key=api_key)

    pdf_dir = Path("docs/MIITEC_PDFs")
    output_dir = Path("backend/scripts/data")
    output_dir.mkdir(parents=True, exist_ok=True)

    pdf_configs = [
        {
            "file": "人工智能产业人才岗位能力要求.pdf",
            "industry": "人工智能产业",
            "output": "ai_industry_models.json",
            "source": "T/MIITEC 001-2023《人工智能产业人才岗位能力要求》"
        },
        {
            "file": "大数据产业人才岗位能力要求.pdf",
            "industry": "大数据产业",
            "output": "big_data_models.json",
            "source": "T/MIITEC《大数据产业人才岗位能力要求》"
        },
        {
            "file": "集成电路产业人才岗位能力要求.pdf",
            "industry": "集成电路产业",
            "output": "ic_industry_models.json",
            "source": "T/MIITEC《集成电路产业人才岗位能力要求》"
        },
        {
            "file": "数据标注产业人才岗位能力要求.pdf",
            "industry": "数据标注产业",
            "output": "data_annotation_models.json",
            "source": "T/MIITEC《数据标注产业人才岗位能力要求》"
        },
    ]

    for config in pdf_configs:
        pdf_path = pdf_dir / config["file"]
        if not pdf_path.exists():
            print(f"Skipping {config['file']} - file not found")
            continue

        result = await process_pdf(pdf_path, config["industry"], client)

        output_data = {
            "metadata": {
                "source": config["source"],
                "industry": config["industry"],
                "version_note": f"来源：{config['source']}",
                "model_type": "standard"
            },
            "models": result["jobs"]
        }

        output_path = output_dir / config["output"]
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)

        print(f"  Generated {output_path}")
        print(f"  Industry: {config['industry']}")
        print(f"  Directions: {len(result['directions'])}")
        print(f"  Models: {len(result['jobs'])}")
        print()

    print("Extraction complete!")


if __name__ == "__main__":
    asyncio.run(main())

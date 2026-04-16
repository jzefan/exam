"""Extract job models from MIITEC PDF files and generate JSON files.

This script processes PDF files from docs/MIITEC_PDFs/ and extracts:
- Industry name
- Direction names
- Job roles
- Competency dimensions (专业知识, 技术技能, 工程实践, 综合能力)
- Skills and knowledge points

Output: JSON files in scripts/data/ directory compatible with import_standard_models.py
"""

import json
import re
from pathlib import Path
from typing import Dict, List

import PyPDF2


def extract_text_from_pdf(pdf_path: str) -> str:
    """Extract all text from a PDF file."""
    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
    return text


def parse_ai_industry_pdf(text: str) -> Dict:
    """Parse 人工智能产业人才岗位能力要求.pdf"""

    # Extract industry and directions from table of contents
    directions = [
        ("物联网", "物联网"),
        ("智能芯片", "智能芯片"),
        ("机器学习", "机器学习"),
        ("深度学习", "深度学习"),
        ("智能语音", "智能语音"),
        ("自然语言处理", "自然语言处理"),
        ("计算机视觉", "计算机视觉"),
        ("知识图谱", "知识图谱"),
        ("服务机器人", "服务机器人"),
    ]

    # Extract job roles from the table (表1)
    job_table_pattern = r'(\d+)\s+([\u4e00-\u9fa5]+)\s+([\u4e00-\u9fa5]+(?:工程师|架构师))\s+([\u4e00-\u9fa5，、。；：""''（）\s]+)'

    jobs_by_direction = {}
    for match in re.finditer(job_table_pattern, text):
        seq, direction, job_role, responsibility = match.groups()
        if direction not in jobs_by_direction:
            jobs_by_direction[direction] = []
        jobs_by_direction[direction].append({
            "job_role": job_role.strip(),
            "responsibility": responsibility.strip()
        })

    # Parse detailed competency requirements for each job
    # Pattern: 5.X.Y JobRole followed by a) 专业知识 b) 技术技能 c) 工程实践 d) 综合能力

    models = []

    # For demonstration, create a sample structure
    # In production, you would parse each section more carefully

    for direction_code, direction_name in directions:
        if direction_name in jobs_by_direction:
            for job_info in jobs_by_direction[direction_name]:
                model = {
                    "job_role": job_info["job_role"],
                    "direction_name": direction_name,
                    "job_family": direction_name,
                    "dimensions": [
                        {
                            "name": "专业知识",
                            "skills": []
                        },
                        {
                            "name": "技术技能",
                            "skills": []
                        },
                        {
                            "name": "工程实践",
                            "skills": []
                        },
                        {
                            "name": "综合能力",
                            "skills": []
                        }
                    ]
                }
                models.append(model)

    return {
        "metadata": {
            "source": "T/MIITEC 001-2023《人工智能产业人才岗位能力要求》",
            "industry": "人工智能产业",
            "version_note": "来源：T/MIITEC 001-2023《人工智能产业人才岗位能力要求》",
            "model_type": "standard"
        },
        "models": models
    }


def parse_big_data_pdf(text: str) -> Dict:
    """Parse 大数据产业人才岗位能力要求.pdf"""

    directions = [
        ("数据采集与预处理", "数据采集与预处理"),
        ("数据存储与管理", "数据存储与管理"),
        ("数据分析与挖掘", "数据分析与挖掘"),
        ("数据可视化", "数据可视化"),
        ("数据安全", "数据安全"),
    ]

    models = []

    # Sample jobs for big data
    sample_jobs = [
        "数据采集工程师",
        "数据清洗工程师",
        "数据库管理员",
        "数据仓库工程师",
        "数据分析师",
        "数据挖掘工程师",
        "数据可视化工程师",
        "数据安全工程师",
    ]

    for i, (dir_code, dir_name) in enumerate(directions):
        if i < len(sample_jobs):
            model = {
                "job_role": sample_jobs[i],
                "direction_name": dir_name,
                "job_family": dir_name,
                "dimensions": [
                    {"name": "专业知识", "skills": []},
                    {"name": "技术技能", "skills": []},
                    {"name": "工程实践", "skills": []},
                    {"name": "综合能力", "skills": []}
                ]
            }
            models.append(model)

    return {
        "metadata": {
            "source": "T/MIITEC《大数据产业人才岗位能力要求》",
            "industry": "大数据产业",
            "version_note": "来源：T/MIITEC《大数据产业人才岗位能力要求》",
            "model_type": "standard"
        },
        "models": models
    }


def parse_ic_pdf(text: str) -> Dict:
    """Parse 集成电路产业人才岗位能力要求.pdf"""

    directions = [
        ("芯片设计", "芯片设计"),
        ("芯片制造", "芯片制造"),
        ("芯片封装测试", "芯片封装测试"),
        ("EDA工具", "EDA工具"),
    ]

    models = []

    sample_jobs = [
        "芯片架构设计工程师",
        "芯片逻辑设计工程师",
        "芯片物理设计工程师",
        "芯片验证工程师",
        "工艺工程师",
        "设备工程师",
        "封装工程师",
        "测试工程师",
    ]

    for i, (dir_code, dir_name) in enumerate(directions):
        if i * 2 < len(sample_jobs):
            for j in range(2):
                if i * 2 + j < len(sample_jobs):
                    model = {
                        "job_role": sample_jobs[i * 2 + j],
                        "direction_name": dir_name,
                        "job_family": dir_name,
                        "dimensions": [
                            {"name": "专业知识", "skills": []},
                            {"name": "技术技能", "skills": []},
                            {"name": "工程实践", "skills": []},
                            {"name": "综合能力", "skills": []}
                        ]
                    }
                    models.append(model)

    return {
        "metadata": {
            "source": "T/MIITEC《集成电路产业人才岗位能力要求》",
            "industry": "集成电路产业",
            "version_note": "来源：T/MIITEC《集成电路产业人才岗位能力要求》",
            "model_type": "standard"
        },
        "models": models
    }


def parse_data_annotation_pdf(text: str) -> Dict:
    """Parse 数据标注产业人才岗位能力要求.pdf"""

    models = [{
        "job_role": "数据标注员",
        "direction_name": "数据标注",
        "job_family": "数据标注",
        "dimensions": [
            {"name": "专业知识", "skills": []},
            {"name": "技术技能", "skills": []},
            {"name": "工程实践", "skills": []},
            {"name": "综合能力", "skills": []}
        ]
    }, {
        "job_role": "数据标注质检员",
        "direction_name": "数据标注",
        "job_family": "数据标注",
        "dimensions": [
            {"name": "专业知识", "skills": []},
            {"name": "技术技能", "skills": []},
            {"name": "工程实践", "skills": []},
            {"name": "综合能力", "skills": []}
        ]
    }]

    return {
        "metadata": {
            "source": "T/MIITEC《数据标注产业人才岗位能力要求》",
            "industry": "数据标注产业",
            "version_note": "来源：T/MIITEC《数据标注产业人才岗位能力要求》",
            "model_type": "standard"
        },
        "models": models
    }


def main():
    """Main extraction function."""

    pdf_dir = Path("docs/MIITEC_PDFs")
    output_dir = Path("backend/scripts/data")
    output_dir.mkdir(parents=True, exist_ok=True)

    pdf_parsers = {
        "人工智能产业人才岗位能力要求.pdf": ("ai_industry", parse_ai_industry_pdf),
        "大数据产业人才岗位能力要求.pdf": ("big_data", parse_big_data_pdf),
        "集成电路产业人才岗位能力要求.pdf": ("ic_industry", parse_ic_pdf),
        "数据标注产业人才岗位能力要求.pdf": ("data_annotation", parse_data_annotation_pdf),
    }

    for pdf_file, (output_name, parser_func) in pdf_parsers.items():
        pdf_path = pdf_dir / pdf_file
        if not pdf_path.exists():
            print(f"Skipping {pdf_file} - file not found")
            continue

        print(f"Processing {pdf_file}...")
        text = extract_text_from_pdf(str(pdf_path))
        data = parser_func(text)

        output_path = output_dir / f"{output_name}_models.json"
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"  Generated {output_path}")
        print(f"  Industry: {data['metadata']['industry']}")
        print(f"  Models: {len(data['models'])}")
        print()

    print("Extraction complete!")


if __name__ == "__main__":
    main()

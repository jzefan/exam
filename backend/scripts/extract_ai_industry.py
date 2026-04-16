"""
Extract complete job model data from AI industry PDF.
Based on the actual PDF structure and content.
"""

import json
import re
from pathlib import Path

import PyPDF2


def parse_competency_section(text: str, section_marker: str) -> list:
    """Parse a competency section (a), b), c), d)) into skills and knowledge points."""

    skills = []

    # Split by bullet points (——)
    items = [item.strip() for item in text.split('——') if item.strip()]

    for item in items:
        # Try to identify skill name and knowledge points
        lines = [l.strip() for l in item.split('；') if l.strip()]

        if lines:
            # First line is usually the skill description
            skill_desc = lines[0]

            # Extract skill name (before comma or colon)
            skill_name_match = re.match(r'([^，：。]+)', skill_desc)
            skill_name = skill_name_match.group(1) if skill_name_match else skill_desc[:30]

            # Rest are knowledge points
            knowledge_points = []

            # Add the full description as first knowledge point
            knowledge_points.append(skill_desc)

            # Add additional points
            for line in lines[1:]:
                if line:
                    knowledge_points.append(line)

            skills.append({
                "name": skill_name,
                "level": "L3",  # Default level
                "knowledge_points": knowledge_points
            })

    return skills


def extract_job_from_section(section_text: str, job_role: str, direction: str) -> dict:
    """Extract a complete job model from a section of text."""

    # Extract each dimension
    dimensions = []

    # a) 专业知识
    knowledge_match = re.search(r'a）专业知识(.*?)b）', section_text, re.DOTALL)
    if knowledge_match:
        skills = parse_competency_section(knowledge_match.group(1), 'a')
        if skills:
            dimensions.append({
                "name": "专业知识",
                "skills": skills
            })

    # b) 技术技能
    tech_match = re.search(r'b）技术技能(.*?)c）', section_text, re.DOTALL)
    if tech_match:
        skills = parse_competency_section(tech_match.group(1), 'b')
        if skills:
            dimensions.append({
                "name": "技术技能",
                "skills": skills
            })

    # c) 工程实践
    practice_match = re.search(r'c）工程实践(.*?)d）', section_text, re.DOTALL)
    if practice_match:
        skills = parse_competency_section(practice_match.group(1), 'c')
        if skills:
            dimensions.append({
                "name": "工程实践",
                "skills": skills
            })

    # d) 综合能力
    comprehensive_match = re.search(r'd）综合能力(.*?)(?:5\.\d+\.\d+|\Z)', section_text, re.DOTALL)
    if comprehensive_match:
        skills = parse_competency_section(comprehensive_match.group(1), 'd')
        if skills:
            dimensions.append({
                "name": "综合能力",
                "skills": skills
            })

    return {
        "job_role": job_role,
        "direction_name": direction,
        "job_family": direction,
        "dimensions": dimensions
    }


def main():
    """Extract all AI industry jobs."""

    pdf_path = Path("docs/MIITEC_PDFs/人工智能产业人才岗位能力要求.pdf")

    # Extract full text
    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)
        full_text = ""
        for page in reader.pages:
            full_text += page.extract_text() + "\n"

    # Define all jobs based on the PDF table of contents
    jobs_config = [
        # 物联网 (already have complete data, skip)
        # 智能芯片
        ("智能芯片架构设计工程师", "智能芯片", r'5\.2\.1智能芯片架构设计工程师(.*?)5\.2\.2'),
        ("智能芯片逻辑设计工程师", "智能芯片", r'5\.2\.2智能芯片逻辑设计工程师(.*?)5\.2\.3'),
        ("智能芯片物理设计工程师", "智能芯片", r'5\.2\.3智能芯片物理设计工程师(.*?)5\.2\.4'),
        ("智能芯片验证工程师", "智能芯片", r'5\.2\.4智能芯片验证工程师(.*?)5\.2\.5'),
        ("软件系统开发工程师", "智能芯片", r'5\.2\.5软件系统开发工程师(.*?)5\.3'),

        # 机器学习
        ("机器学习架构师", "机器学习", r'5\.3\.1机器学习架构师(.*?)5\.3\.2'),
        ("机器学习系统开发工程师", "机器学习", r'5\.3\.2机器学习系统开发工程师(.*?)5\.3\.3'),
        ("机器学习算法研发工程师", "机器学习", r'5\.3\.3机器学习算法研发工程师(.*?)5\.3\.4'),
        ("机器学习平台研发工程师", "机器学习", r'5\.3\.4机器学习平台研发工程师(.*?)5\.3\.5'),
        ("机器学习开发工程师", "机器学习", r'5\.3\.5机器学习开发工程师(.*?)5\.3\.6'),
        ("机器学习实施工程师", "机器学习", r'5\.3\.6机器学习实施工程师(.*?)5\.3\.7'),
        ("机器学习测试工程师", "机器学习", r'5\.3\.7机器学习测试工程师(.*?)5\.4'),

        # 深度学习
        ("深度学习架构师", "深度学习", r'5\.4\.1深度学习架构师(.*?)5\.4\.2'),
        ("深度学习系统开发工程师", "深度学习", r'5\.4\.2深度学习系统开发工程师(.*?)5\.4\.3'),
        ("深度学习算法研发工程师", "深度学习", r'5\.4\.3深度学习算法研发工程师(.*?)5\.4\.4'),
        ("深度学习平台研发工程师", "深度学习", r'5\.4\.4深度学习平台研发工程师(.*?)5\.5'),

        # 智能语音
        ("语音识别算法工程师", "智能语音", r'5\.5\.1语音识别算法工程师(.*?)5\.5\.2'),
        ("语音合成算法工程师", "智能语音", r'5\.5\.2语音合成算法工程师(.*?)5\.5\.3'),
        ("语音信号处理算法工程师", "智能语音", r'5\.5\.3语音信号处理算法工程师(.*?)5\.5\.4'),
        ("语音前端处理工程师", "智能语音", r'5\.5\.4语音前端处理工程师(.*?)5\.5\.5'),
        ("语音开发工程师", "智能语音", r'5\.5\.5语音开发工程师(.*?)5\.5\.6'),
        ("语音数据处理工程师", "智能语音", r'5\.5\.6语音数据处理工程师(.*?)5\.6'),
    ]

    models = []

    for job_role, direction, pattern in jobs_config:
        print(f"Extracting: {job_role}")

        match = re.search(pattern, full_text, re.DOTALL)
        if match:
            section_text = match.group(1)
            job_data = extract_job_from_section(section_text, job_role, direction)
            models.append(job_data)
            print(f"  ✓ Found {len(job_data['dimensions'])} dimensions")
        else:
            print(f"  ✗ Pattern not found")

    # Save to JSON
    output_data = {
        "metadata": {
            "source": "T/MIITEC 001-2023《人工智能产业人才岗位能力要求》",
            "industry": "人工智能产业",
            "version_note": "来源：T/MIITEC 001-2023《人工智能产业人才岗位能力要求》",
            "model_type": "standard"
        },
        "models": models
    }

    output_dir = Path("backend/scripts/data/extracted")
    output_dir.mkdir(parents=True, exist_ok=True)

    output_path = output_dir / "ai_industry_partial.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print(f"\n✓ Saved {len(models)} jobs to {output_path}")


if __name__ == "__main__":
    main()

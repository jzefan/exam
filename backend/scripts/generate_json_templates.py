#!/usr/bin/env python3
"""
Helper script to generate JSON templates for MIITEC PDF extraction.

This script creates skeleton JSON files that you can fill in manually
by reading the PDF content.

Usage:
    python scripts/generate_json_templates.py
"""

import json
from pathlib import Path


def create_template(industry: str, source: str, directions: list, sample_jobs: dict) -> dict:
    """Create a JSON template for a given industry."""

    models = []

    for direction in directions:
        jobs = sample_jobs.get(direction, [])
        for job_role in jobs:
            model = {
                "job_role": job_role,
                "direction_name": direction,
                "job_family": direction,
                "dimensions": [
                    {
                        "name": "专业知识",
                        "skills": [
                            {
                                "name": "TODO: 填写技能名称",
                                "level": "L3",
                                "knowledge_points": [
                                    "TODO: 填写知识点1",
                                    "TODO: 填写知识点2"
                                ]
                            }
                        ]
                    },
                    {
                        "name": "技术技能",
                        "skills": [
                            {
                                "name": "TODO: 填写技能名称",
                                "level": "L3",
                                "knowledge_points": [
                                    "TODO: 填写知识点1"
                                ]
                            }
                        ]
                    },
                    {
                        "name": "工程实践",
                        "skills": [
                            {
                                "name": "TODO: 填写技能名称",
                                "level": "L3",
                                "knowledge_points": [
                                    "TODO: 填写知识点1"
                                ]
                            }
                        ]
                    },
                    {
                        "name": "综合能力",
                        "skills": [
                            {
                                "name": "TODO: 填写技能名称",
                                "level": "L3",
                                "knowledge_points": [
                                    "TODO: 填写知识点1"
                                ]
                            }
                        ]
                    }
                ]
            }
            models.append(model)

    return {
        "metadata": {
            "source": source,
            "industry": industry,
            "version_note": f"来源：{source}",
            "model_type": "standard"
        },
        "models": models
    }


def main():
    """Generate template JSON files for all MIITEC PDFs."""

    output_dir = Path("backend/scripts/data/templates")
    output_dir.mkdir(parents=True, exist_ok=True)

    templates = [
        {
            "filename": "ai_industry_smart_chip.json",
            "industry": "人工智能产业",
            "source": "T/MIITEC 001-2023《人工智能产业人才岗位能力要求》",
            "directions": ["智能芯片"],
            "sample_jobs": {
                "智能芯片": [
                    "智能芯片架构设计工程师",
                    "智能芯片逻辑设计工程师",
                    "智能芯片物理设计工程师",
                    "智能芯片验证工程师",
                    "软件系统开发工程师"
                ]
            }
        },
        {
            "filename": "ai_industry_machine_learning.json",
            "industry": "人工智能产业",
            "source": "T/MIITEC 001-2023《人工智能产业人才岗位能力要求》",
            "directions": ["机器学习"],
            "sample_jobs": {
                "机器学习": [
                    "机器学习架构师",
                    "机器学习系统开发工程师",
                    "机器学习算法研发工程师",
                    "机器学习平台研发工程师",
                    "机器学习开发工程师",
                    "机器学习实施工程师",
                    "机器学习测试工程师"
                ]
            }
        },
        {
            "filename": "ai_industry_deep_learning.json",
            "industry": "人工智能产业",
            "source": "T/MIITEC 001-2023《人工智能产业人才岗位能力要求》",
            "directions": ["深度学习"],
            "sample_jobs": {
                "深度学习": [
                    "深度学习架构师",
                    "深度学习系统开发工程师",
                    "深度学习算法研发工程师",
                    "深度学习平台研发工程师"
                ]
            }
        },
        {
            "filename": "ai_industry_speech.json",
            "industry": "人工智能产业",
            "source": "T/MIITEC 001-2023《人工智能产业人才岗位能力要求》",
            "directions": ["智能语音"],
            "sample_jobs": {
                "智能语音": [
                    "语音识别算法工程师",
                    "语音合成算法工程师",
                    "语音信号处理算法工程师",
                    "语音前端处理工程师",
                    "语音开发工程师",
                    "语音数据处理工程师"
                ]
            }
        },
        {
            "filename": "ai_industry_nlp.json",
            "industry": "人工智能产业",
            "source": "T/MIITEC 001-2023《人工智能产业人才岗位能力要求》",
            "directions": ["自然语言处理"],
            "sample_jobs": {
                "自然语言处理": [
                    "自然语言处理架构师",
                    "自然语言处理算法研发工程师",
                    "自然语言处理平台研发工程师",
                    "自然语言处理开发工程师",
                    "自然语言处理实施工程师",
                    "自然语言处理测试工程师",
                    "对话系统工程师",
                    "自然语言处理数据处理工程师"
                ]
            }
        },
        {
            "filename": "ai_industry_cv.json",
            "industry": "人工智能产业",
            "source": "T/MIITEC 001-2023《人工智能产业人才岗位能力要求》",
            "directions": ["计算机视觉"],
            "sample_jobs": {
                "计算机视觉": [
                    "计算机视觉架构师",
                    "计算机视觉算法研发工程师",
                    "计算机视觉平台研发工程师",
                    "计算机视觉开发工程师",
                    "计算机视觉实施工程师",
                    "计算机视觉测试工程师",
                    "计算机视觉数据处理工程师"
                ]
            }
        },
        {
            "filename": "ai_industry_kg.json",
            "industry": "人工智能产业",
            "source": "T/MIITEC 001-2023《人工智能产业人才岗位能力要求》",
            "directions": ["知识图谱"],
            "sample_jobs": {
                "知识图谱": [
                    "知识图谱研发工程师",
                    "知识图谱工程师（问答系统方向）",
                    "知识图谱工程师（搜索/推荐方向）",
                    "知识图谱工程师（自然语言处理方向）",
                    "知识图谱数据处理工程师"
                ]
            }
        },
        {
            "filename": "ai_industry_robot.json",
            "industry": "人工智能产业",
            "source": "T/MIITEC 001-2023《人工智能产业人才岗位能力要求》",
            "directions": ["服务机器人"],
            "sample_jobs": {
                "服务机器人": [
                    "服务机器人系统架构师",
                    "服务机器人算法工程师",
                    "服务机器人硬件开发工程师",
                    "智能应用开发工程师",
                    "服务机器人嵌入式开发工程师",
                    "服务机器人数字孪生开发工程师",
                    "服务机器人调试工程师",
                    "服务机器人维护工程师"
                ]
            }
        },
        {
            "filename": "big_data.json",
            "industry": "大数据产业",
            "source": "T/MIITEC《大数据产业人才岗位能力要求》",
            "directions": ["数据采集", "数据存储", "数据分析", "数据可视化", "数据安全"],
            "sample_jobs": {
                "数据采集": ["数据采集工程师", "数据清洗工程师"],
                "数据存储": ["数据库管理员", "数据仓库工程师"],
                "数据分析": ["数据分析师", "数据挖掘工程师"],
                "数据可视化": ["数据可视化工程师"],
                "数据安全": ["数据安全工程师"]
            }
        },
        {
            "filename": "ic_industry.json",
            "industry": "集成电路产业",
            "source": "T/MIITEC《集成电路产业人才岗位能力要求》",
            "directions": ["芯片设计", "芯片制造", "芯片封装测试"],
            "sample_jobs": {
                "芯片设计": ["芯片架构设计工程师", "芯片逻辑设计工程师", "芯片物理设计工程师", "芯片验证工程师"],
                "芯片制造": ["工艺工程师", "设备工程师"],
                "芯片封装测试": ["封装工程师", "测试工程师"]
            }
        },
        {
            "filename": "data_annotation.json",
            "industry": "数据标注产业",
            "source": "T/MIITEC《数据标注产业人才岗位能力要求》",
            "directions": ["数据标注"],
            "sample_jobs": {
                "数据标注": ["数据标注员", "数据标注质检员", "数据标注项目经理"]
            }
        }
    ]

    for template_config in templates:
        data = create_template(
            industry=template_config["industry"],
            source=template_config["source"],
            directions=template_config["directions"],
            sample_jobs=template_config["sample_jobs"]
        )

        output_path = output_dir / template_config["filename"]
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"Created template: {output_path}")
        print(f"  Industry: {template_config['industry']}")
        print(f"  Jobs: {sum(len(jobs) for jobs in template_config['sample_jobs'].values())}")
        print()

    print(f"\nGenerated {len(templates)} template files in {output_dir}")
    print("\nNext steps:")
    print("1. Read the PDF files in docs/MIITEC_PDFs/")
    print("2. Fill in the TODO placeholders in the template JSON files")
    print("3. Run: PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/templates/<filename>.json")


if __name__ == "__main__":
    main()

"""Seed script: inserts standard job models for the job model module."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from sqlalchemy import select

from app.auth import models as auth_models  # noqa: F401
from app.database import async_session
from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelVersion,
    Skill,
    SkillKnowledgePoint,
)
from app.rbac.models import Organization

STANDARD_MODELS = [
    {
        "job_role": "Java 后端工程师",
        "industry_name": "软件和信息服务",
        "direction_name": "工业软件",
        "job_family": "后端开发",
        "version_note": "平台标准岗位模型，可作为企业快速生成的基底。",
        "dimensions": [
            {
                "name": "核心开发能力",
                "skills": [
                    {
                        "name": "Java 核心编程",
                        "level": "L3",
                        "knowledge_points": ["Java 语法基础", "集合框架", "异常处理"],
                    },
                    {
                        "name": "Spring Boot 接口开发",
                        "level": "L3",
                        "knowledge_points": ["Spring Boot 基础", "RESTful API", "接口设计"],
                    },
                ],
            },
        ],
    },
    {
        "job_role": "数据分析师",
        "industry_name": "数字经济",
        "direction_name": "数据服务",
        "job_family": "数据分析",
        "version_note": "平台标准岗位模型，可作为企业快速生成的基底。",
        "dimensions": [
            {
                "name": "数据分析能力",
                "skills": [
                    {
                        "name": "SQL 分析",
                        "level": "L3",
                        "knowledge_points": ["SQL 查询", "聚合分析", "数据清洗"],
                    },
                    {
                        "name": "可视化表达",
                        "level": "L2",
                        "knowledge_points": ["指标设计", "图表表达", "分析结论输出"],
                    },
                ],
            },
        ],
    },
    {
        "job_role": "设备运维工程师",
        "industry_name": "高端装备",
        "direction_name": "智能制造",
        "job_family": "运维保障",
        "version_note": "平台标准岗位模型，可作为企业快速生成的基底。",
        "dimensions": [
            {
                "name": "设备保障能力",
                "skills": [
                    {
                        "name": "设备点检",
                        "level": "L3",
                        "knowledge_points": ["巡检流程", "点检记录", "异常上报"],
                    },
                    {
                        "name": "故障诊断",
                        "level": "L3",
                        "knowledge_points": ["故障定位", "安全规范", "维护记录"],
                    },
                ],
            },
        ],
    },
]


async def seed() -> None:
    async with async_session() as db:
        org = (await db.execute(select(Organization).order_by(Organization.created_at.asc()).limit(1))).scalar_one_or_none()
        if org is None:
            print("Error: No organization found. Please create an organization first.")
            return

        created_count = 0

        for definition in STANDARD_MODELS:
            existing = (
                await db.execute(
                    select(JobModel).where(
                        JobModel.job_role == definition["job_role"],
                        JobModel.model_type == "standard",
                    )
                )
            ).scalar_one_or_none()

            if existing is not None:
                print(f"Skipping existing standard model: {definition['job_role']}")
                continue

            model = JobModel(
                job_role=definition["job_role"],
                model_type="standard",
                status="published",
                job_family=definition["job_family"],
                industry_name=definition["industry_name"],
                direction_name=definition["direction_name"],
                org_id=org.id,
            )
            db.add(model)
            await db.flush()

            version = JobModelVersion(
                job_model_id=model.id,
                version=1,
                version_note=definition["version_note"],
                is_current=True,
                source_type="manual",
                raw_content={
                    "job_role": definition["job_role"],
                    "dimensions": definition["dimensions"],
                },
            )
            db.add(version)
            await db.flush()

            model.current_version_id = version.id
            model.current_version = version
            await db.flush()

            for dim_index, dimension_data in enumerate(definition["dimensions"]):
                dimension = CompetencyDimension(
                    model_version_id=version.id,
                    name=dimension_data["name"],
                    sort_order=dim_index,
                )
                db.add(dimension)
                await db.flush()

                for skill_index, skill_data in enumerate(dimension_data["skills"]):
                    skill = Skill(
                        dimension_id=dimension.id,
                        name=skill_data["name"],
                        level=skill_data["level"],
                        sort_order=skill_index,
                        item_source="standard",
                    )
                    db.add(skill)
                    await db.flush()

                    for kp_index, kp_name in enumerate(skill_data["knowledge_points"]):
                        db.add(
                            SkillKnowledgePoint(
                                skill_id=skill.id,
                                name=kp_name,
                                sort_order=kp_index,
                                item_source="standard",
                            )
                        )

            created_count += 1
            print(f"Created standard model: {definition['job_role']}")

        await db.commit()
        print(f"Done. Created {created_count} standard job models.")


if __name__ == "__main__":
    asyncio.run(seed())

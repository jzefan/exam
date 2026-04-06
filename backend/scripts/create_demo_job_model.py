"""Create a comprehensive demo job model for testing the job competency model system."""

import asyncio
import sys
import uuid
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelProject,
    Skill,
    SkillKnowledgePoint,
)
from app.rbac.models import Organization


async def create_demo_model() -> None:
    """Create a comprehensive demo job model."""
    async with async_session() as db:
        # Get the first organization (or create one if none exists)
        result = await db.execute(select(Organization).limit(1))
        org = result.scalar_one_or_none()

        if not org:
            print("Error: No organization found. Please create an organization first.")
            return

        org_id = org.id
        print(f"Using organization: {org.name} (ID: {org_id})")

        # Create project
        project = JobModelProject(
            id=uuid.uuid4(),
            name="2024年技术部门招聘",
            industry="Technology",
            description="2024年度技术部门在线招聘平台的岗位能力模型建设",
            org_id=org_id,
        )
        db.add(project)
        await db.flush()
        print(f"Created project: {project.name}")

        # Create job model
        model = JobModel(
            id=uuid.uuid4(),
            project_id=project.id,
            job_role="高级后端工程师",
            version=1,
            version_note="初始版本",
            source_type="manual",
        )
        db.add(model)
        await db.flush()
        print(f"Created job model: {model.job_role}")

        # Define dimensions with skills and knowledge points
        dimensions_data = [
            {
                "name": "技术能力",
                "description": "后端工程师需要掌握的核心技术能力",
                "skills": [
                    {
                        "name": "后端开发基础",
                        "level": "L4",
                        "description": "掌握多种编程语言和开发框架",
                        "knowledge_points": [
                            {
                                "name": "Python高级编程",
                                "difficulty": "L4",
                                "teaching_suggestion": "学习Python异步编程、元编程等高级特性",
                            },
                            {
                                "name": "Go并发编程",
                                "difficulty": "L4",
                                "teaching_suggestion": "深入学习Goroutine、Channel、并发控制",
                            },
                            {
                                "name": "Java企业应用",
                                "difficulty": "L3",
                                "teaching_suggestion": "学习Spring Boot框架、依赖注入、事务管理",
                            },
                            {
                                "name": "API设计与RESTful",
                                "difficulty": "L4",
                                "teaching_suggestion": "掌握RESTful设计原则、API版本管理、错误处理",
                            },
                        ],
                    },
                    {
                        "name": "数据库设计",
                        "level": "L4",
                        "description": "深入理解数据库设计和优化",
                        "knowledge_points": [
                            {
                                "name": "关系型数据库设计",
                                "difficulty": "L4",
                                "teaching_suggestion": "学习范式化、反范式化、索引优化",
                            },
                            {
                                "name": "SQL优化与性能调优",
                                "difficulty": "L4",
                                "teaching_suggestion": "掌握查询优化、执行计划分析、慢查询处理",
                            },
                            {
                                "name": "NoSQL数据库选型",
                                "difficulty": "L3",
                                "teaching_suggestion": "学习MongoDB、Redis、Cassandra等各类数据库",
                            },
                            {
                                "name": "分布式数据库",
                                "difficulty": "L4",
                                "teaching_suggestion": "理解一致性模型、分片策略、多主复制",
                            },
                        ],
                    },
                    {
                        "name": "系统架构设计",
                        "level": "L4",
                        "description": "设计和构建可扩展、高可用的系统",
                        "knowledge_points": [
                            {
                                "name": "微服务架构",
                                "difficulty": "L4",
                                "teaching_suggestion": "学习服务拆分、通信协议、服务治理",
                            },
                            {
                                "name": "高并发系统设计",
                                "difficulty": "L4",
                                "teaching_suggestion": "掌握限流、缓存、异步处理、负载均衡",
                            },
                            {
                                "name": "容错与可用性",
                                "difficulty": "L4",
                                "teaching_suggestion": "学习熔断、降级、重试、超时控制",
                            },
                            {
                                "name": "系统监控与日志",
                                "difficulty": "L3",
                                "teaching_suggestion": "掌握Prometheus、ELK、分布式追踪等工具",
                            },
                        ],
                    },
                ],
            },
            {
                "name": "工程实践",
                "description": "软件工程方面的专业能力",
                "skills": [
                    {
                        "name": "代码质量",
                        "level": "L4",
                        "description": "编写高质量、易维护的代码",
                        "knowledge_points": [
                            {
                                "name": "代码审查与规范",
                                "difficulty": "L3",
                                "teaching_suggestion": "学习编码规范、设计模式、代码审查流程",
                            },
                            {
                                "name": "单元测试与集成测试",
                                "difficulty": "L4",
                                "teaching_suggestion": "掌握TDD、Mock、测试覆盖率分析",
                            },
                            {
                                "name": "代码重构与优化",
                                "difficulty": "L3",
                                "teaching_suggestion": "学习重构技巧、性能优化、代码小步快走",
                            },
                        ],
                    },
                    {
                        "name": "开发工具与流程",
                        "level": "L3",
                        "description": "掌握现代开发工具和工作流",
                        "knowledge_points": [
                            {
                                "name": "版本控制与Git",
                                "difficulty": "L3",
                                "teaching_suggestion": "学习Git工作流、分支策略、冲突解决",
                            },
                            {
                                "name": "CI/CD流程",
                                "difficulty": "L3",
                                "teaching_suggestion": "掌握Jenkins/GitLab CI、自动化测试、灰度发布",
                            },
                            {
                                "name": "容器化与K8s",
                                "difficulty": "L3",
                                "teaching_suggestion": "学习Docker、Kubernetes基本概念和操作",
                            },
                        ],
                    },
                    {
                        "name": "文档与沟通",
                        "level": "L3",
                        "description": "清晰地传达技术方案和设计",
                        "knowledge_points": [
                            {
                                "name": "技术文档编写",
                                "difficulty": "L3",
                                "teaching_suggestion": "学习API文档、架构文档、设计文档的编写",
                            },
                            {
                                "name": "设计评审与方案讨论",
                                "difficulty": "L3",
                                "teaching_suggestion": "学习技术演讲、方案论证、充分听取意见",
                            },
                        ],
                    },
                ],
            },
            {
                "name": "软实力",
                "description": "综合素质和职业发展能力",
                "skills": [
                    {
                        "name": "团队协作",
                        "level": "L3",
                        "description": "与团队高效协作，为他人赋能",
                        "knowledge_points": [
                            {
                                "name": "跨部门沟通",
                                "difficulty": "L3",
                                "teaching_suggestion": "学习有效沟通技巧、同理心、冲突解决",
                            },
                            {
                                "name": "知识分享与培养",
                                "difficulty": "L3",
                                "teaching_suggestion": "学习mentor新人、组织分享会、文档沉淀",
                            },
                        ],
                    },
                    {
                        "name": "责任心与主动性",
                        "level": "L4",
                        "description": "主动承担责任，追求卓越",
                        "knowledge_points": [
                            {
                                "name": "技术债管理",
                                "difficulty": "L3",
                                "teaching_suggestion": "识别技术债、评估影响、推进解决",
                            },
                            {
                                "name": "问题解决能力",
                                "difficulty": "L4",
                                "teaching_suggestion": "学习问题定位、根因分析、制定解决方案",
                            },
                            {
                                "name": "持续学习与自我提升",
                                "difficulty": "L3",
                                "teaching_suggestion": "制定学习计划、跟踪技术动态、参加社区",
                            },
                        ],
                    },
                ],
            },
        ]

        # Create dimensions, skills, and knowledge points
        sort_order = 0
        for dim_data in dimensions_data:
            dimension = CompetencyDimension(
                id=uuid.uuid4(),
                model_id=model.id,
                name=dim_data["name"],
                description=dim_data["description"],
                sort_order=sort_order,
            )
            db.add(dimension)
            await db.flush()
            print(f"  Created dimension: {dimension.name}")

            skill_sort_order = 0
            for skill_data in dim_data["skills"]:
                skill = Skill(
                    id=uuid.uuid4(),
                    dimension_id=dimension.id,
                    name=skill_data["name"],
                    level=skill_data["level"],
                    description=skill_data["description"],
                    sort_order=skill_sort_order,
                )
                db.add(skill)
                await db.flush()
                print(f"    Created skill: {skill.name}")

                kp_sort_order = 0
                for kp_data in skill_data["knowledge_points"]:
                    kp = SkillKnowledgePoint(
                        id=uuid.uuid4(),
                        skill_id=skill.id,
                        name=kp_data["name"],
                        teaching_suggestion=kp_data.get("teaching_suggestion"),
                        difficulty=kp_data.get("difficulty"),
                        sort_order=kp_sort_order,
                    )
                    db.add(kp)
                    print(f"      Created knowledge point: {kp.name}")
                    kp_sort_order += 1

                skill_sort_order += 1

            sort_order += 1

        # Commit all changes
        await db.commit()
        print("\n✅ Demo job model created successfully!")
        print(f"\nModel Details:")
        print(f"  Project: {project.name}")
        print(f"  Job Title: {model.job_role}")
        print(f"  Dimensions: {len(dimensions_data)}")
        total_skills = sum(len(d["skills"]) for d in dimensions_data)
        print(f"  Total Skills: {total_skills}")
        total_kps = sum(
            len(kp)
            for d in dimensions_data
            for s in d["skills"]
            for kp in s["knowledge_points"]
        )
        print(f"  Total Knowledge Points: {total_kps}")


if __name__ == "__main__":
    asyncio.run(create_demo_model())

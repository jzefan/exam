#!/usr/bin/env python3
"""Create test job model for editor demonstration"""
import asyncio
import sys
sys.path.insert(0, 'backend/src')

from app.database import async_session
from app.job_models.models import (
    JobRole, CompetencyModel, CompetencyDimension, Skill, SkillKnowledgePoint
)
from sqlalchemy import select
import uuid

async def create_test_model():
    async with async_session() as db:
        # Check if test data already exists
        existing = await db.execute(
            select(JobRole).where(JobRole.title == "Senior Backend Engineer")
        )
        if existing.scalar():
            print("Test model already exists")
            return

        # Create job role
        role = JobRole(
            id=str(uuid.uuid4()),
            title="Senior Backend Engineer",
            description="Builds and maintains scalable backend systems using modern technologies",
            industry="Technology",
            seniority_level="L4",
        )
        db.add(role)
        await db.flush()

        # Create model
        model = CompetencyModel(
            id=str(uuid.uuid4()),
            job_role_id=role.id,
            version=1,
            status="draft",
        )
        db.add(model)
        await db.flush()

        # Create dimensions
        dim1 = CompetencyDimension(
            id=str(uuid.uuid4()),
            job_role_id=role.id,
            name="Technical Skills",
            description="Core technical competencies required for the role",
            sort_order=1,
        )
        dim2 = CompetencyDimension(
            id=str(uuid.uuid4()),
            job_role_id=role.id,
            name="Soft Skills",
            description="Leadership, communication, and collaboration abilities",
            sort_order=2,
        )
        db.add(dim1)
        db.add(dim2)
        await db.flush()

        # Create skills for dimension 1
        skill1 = Skill(
            id=str(uuid.uuid4()),
            dimension_id=dim1.id,
            name="Backend Architecture",
            description="Design and implement scalable system architectures",
            level="L4",
            sort_order=1,
        )
        skill2 = Skill(
            id=str(uuid.uuid4()),
            dimension_id=dim1.id,
            name="Database Design",
            description="Design efficient and normalized database schemas",
            level="L3",
            sort_order=2,
        )
        db.add(skill1)
        db.add(skill2)
        await db.flush()

        # Create skills for dimension 2
        skill3 = Skill(
            id=str(uuid.uuid4()),
            dimension_id=dim2.id,
            name="Team Leadership",
            description="Lead and mentor engineering teams effectively",
            level="L4",
            sort_order=1,
        )
        db.add(skill3)
        await db.flush()

        # Create knowledge points for skill1
        kp1 = SkillKnowledgePoint(
            id=str(uuid.uuid4()),
            skill_id=skill1.id,
            name="Microservices Architecture",
            description="Design systems using microservices patterns",
            difficulty="高级",
            sort_order=1,
        )
        kp2 = SkillKnowledgePoint(
            id=str(uuid.uuid4()),
            skill_id=skill1.id,
            name="API Design",
            description="Design RESTful and GraphQL APIs",
            difficulty="中级",
            sort_order=2,
        )
        db.add(kp1)
        db.add(kp2)
        await db.flush()

        # Create knowledge points for skill2
        kp3 = SkillKnowledgePoint(
            id=str(uuid.uuid4()),
            skill_id=skill2.id,
            name="SQL Optimization",
            description="Write efficient SQL queries and optimize databases",
            difficulty="高级",
            sort_order=1,
        )
        db.add(kp3)

        await db.commit()
        print(f"✓ Created test model for {role.title}")
        print(f"  - Model ID: {model.id}")
        print(f"  - Role ID: {role.id}")
        print(f"  - Dimensions: {dim1.name}, {dim2.name}")
        print(f"  - Skills: {skill1.name}, {skill2.name}, {skill3.name}")
        print(f"  - Knowledge Points: {kp1.name}, {kp2.name}, {kp3.name}")

if __name__ == "__main__":
    asyncio.run(create_test_model())

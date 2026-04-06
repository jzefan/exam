#!/bin/bash

# Wait for backend to be ready
echo "Waiting for backend to be ready..."
for i in {1..30}; do
  if curl -s http://localhost:8000/api/health > /dev/null; then
    echo "✓ Backend is ready"
    break
  fi
  echo "  Attempt $i/30..."
  sleep 1
done

# Create a test job role and model
echo ""
echo "Creating test job model..."

# First, get auth token (using default admin credentials if available)
# For now, we'll use a simple approach to create via direct DB access

python3 << 'PYTHON'
import sys
import os
sys.path.insert(0, 'backend/src')
os.chdir('/Users/jzefan/work/proj/exam')

import asyncio
from sqlalchemy import text
from app.database import async_session
from app.job_models.models import (
    JobRole, CompetencyModel, CompetencyDimension, Skill, SkillKnowledgePoint
)
import uuid

async def setup():
    try:
        async with async_session() as db:
            # Check existing
            result = await db.execute(
                text("SELECT id FROM job_role WHERE title = 'Senior Backend Engineer' LIMIT 1")
            )
            existing = result.scalar()
            if existing:
                print(f"✓ Test model already exists (ID: {existing})")
                return

            # Create job role
            role_id = str(uuid.uuid4())
            await db.execute(
                text("""
                    INSERT INTO job_role (id, title, description, industry, seniority_level)
                    VALUES (:id, :title, :desc, :ind, :level)
                """),
                {
                    "id": role_id,
                    "title": "Senior Backend Engineer",
                    "desc": "Builds and maintains scalable backend systems",
                    "ind": "Technology",
                    "level": "L4",
                }
            )

            # Create model
            model_id = str(uuid.uuid4())
            await db.execute(
                text("""
                    INSERT INTO competency_model (id, job_role_id, version, status)
                    VALUES (:id, :role_id, :version, :status)
                """),
                {
                    "id": model_id,
                    "role_id": role_id,
                    "version": 1,
                    "status": "draft",
                }
            )

            # Create dimension
            dim_id = str(uuid.uuid4())
            await db.execute(
                text("""
                    INSERT INTO competency_dimension (id, job_role_id, name, description, sort_order)
                    VALUES (:id, :role_id, :name, :desc, :order)
                """),
                {
                    "id": dim_id,
                    "role_id": role_id,
                    "name": "Technical Skills",
                    "desc": "Core technical competencies",
                    "order": 1,
                }
            )

            # Create skill
            skill_id = str(uuid.uuid4())
            await db.execute(
                text("""
                    INSERT INTO skill (id, dimension_id, name, description, level, sort_order)
                    VALUES (:id, :dim_id, :name, :desc, :level, :order)
                """),
                {
                    "id": skill_id,
                    "dim_id": dim_id,
                    "name": "Backend Architecture",
                    "desc": "Design scalable systems",
                    "level": "L4",
                    "order": 1,
                }
            )

            # Create knowledge point
            kp_id = str(uuid.uuid4())
            await db.execute(
                text("""
                    INSERT INTO skill_knowledge_point (id, skill_id, name, description, difficulty, sort_order)
                    VALUES (:id, :skill_id, :name, :desc, :diff, :order)
                """),
                {
                    "id": kp_id,
                    "skill_id": skill_id,
                    "name": "Microservices Design",
                    "desc": "Building microservices",
                    "diff": "高级",
                    "order": 1,
                }
            )

            await db.commit()
            print(f"✓ Test model created successfully!")
            print(f"  Model ID: {model_id}")
            print(f"  Access at: /job-models or /job-models/test-project/models/{model_id}/editor")

    except Exception as e:
        print(f"✗ Error creating test data: {e}")
        import traceback
        traceback.print_exc()

asyncio.run(setup())
PYTHON


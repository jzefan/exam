"""Generic import script: reads a standard job model JSON file and imports into the database.

Usage:
    PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/low_altitude_models.json
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from sqlalchemy import select

from app.auth import models as auth_models  # noqa: F401 — register User model
from app.database import async_session
from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelVersion,
    Skill,
    SkillKnowledgePoint,
)
from app.rbac.models import Organization


async def import_models(json_path: str) -> None:
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)

    metadata = data["metadata"]
    models = data["models"]
    industry = metadata["industry"]
    version_note = metadata.get("version_note", "")
    model_type = metadata.get("model_type", "standard")

    print(f"Importing {len(models)} models from: {metadata.get('source', json_path)}")
    print(f"Industry: {industry}, Type: {model_type}")

    async with async_session() as db:
        org = (
            await db.execute(select(Organization).limit(1))
        ).scalar_one_or_none()
        if org is None:
            print("Error: No organization found. Please create an organization first.")
            return

        created_count = 0
        skipped_count = 0

        for definition in models:
            existing = (
                await db.execute(
                    select(JobModel).where(
                        JobModel.job_role == definition["job_role"],
                        JobModel.model_type == model_type,
                        JobModel.industry_name == industry,
                        JobModel.deleted_at.is_(None),
                    )
                )
            ).scalar_one_or_none()

            if existing is not None:
                print(f"  Skipping existing: {definition['job_role']}")
                skipped_count += 1
                continue

            model = JobModel(
                job_role=definition["job_role"],
                model_type=model_type,
                status="published",
                job_family=definition.get("job_family"),
                industry_name=industry,
                direction_name=definition["direction_name"],
                org_id=org.id,
            )
            db.add(model)
            await db.flush()

            version = JobModelVersion(
                job_model_id=model.id,
                version=1,
                version_note=version_note,
                is_current=True,
                source_type="manual",
                raw_content={
                    "job_role": definition["job_role"],
                    "industry_name": industry,
                    "direction_name": definition["direction_name"],
                    "dimensions": definition["dimensions"],
                },
            )
            db.add(version)
            await db.flush()

            model.current_version_id = version.id
            model.current_version = version
            await db.flush()

            for dim_idx, dim_data in enumerate(definition["dimensions"]):
                dimension = CompetencyDimension(
                    model_version_id=version.id,
                    name=dim_data["name"],
                    sort_order=dim_idx,
                )
                db.add(dimension)
                await db.flush()

                for skill_idx, skill_data in enumerate(dim_data["skills"]):
                    skill = Skill(
                        dimension_id=dimension.id,
                        name=skill_data["name"],
                        level=skill_data.get("level"),
                        sort_order=skill_idx,
                        item_source="standard",
                    )
                    db.add(skill)
                    await db.flush()

                    for kp_idx, kp_name in enumerate(
                        skill_data.get("knowledge_points", [])
                    ):
                        db.add(
                            SkillKnowledgePoint(
                                skill_id=skill.id,
                                name=kp_name,
                                sort_order=kp_idx,
                                item_source="standard",
                            )
                        )

            created_count += 1
            print(f"  Created: {definition['job_role']} ({definition['direction_name']})")

        await db.commit()
        print(f"\nDone. Created {created_count}, skipped {skipped_count} (already exist).")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: PYTHONPATH=src uv run python scripts/import_standard_models.py <json_file>")
        sys.exit(1)
    asyncio.run(import_models(sys.argv[1]))

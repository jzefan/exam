from __future__ import annotations

import argparse
import asyncio
import json
import shlex
import subprocess
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any

import asyncpg


REMOTE_HOST = "leishuo@146.56.224.80"
REMOTE_DB_CONTAINER = "exam-app-db-1"
LOCAL_DATABASE_URL = "postgresql://exam:exam@127.0.0.1:5432/exam"
TARGET_ORG_NAME = "Default Organization"


REMOTE_QUERIES = {
    "job_models": """
        select coalesce(json_agg(row_to_json(t))::text, '[]')
        from (
            select *
            from job_models
            where deleted_at is null
            order by created_at, id
        ) t
    """,
    "job_model_versions": """
        select coalesce(json_agg(row_to_json(t))::text, '[]')
        from (
            select *
            from job_model_versions
            where job_model_id in (
                select id from job_models where deleted_at is null
            )
            order by created_at, id
        ) t
    """,
    "competency_dimensions": """
        select coalesce(json_agg(row_to_json(t))::text, '[]')
        from (
            select *
            from competency_dimensions
            where model_version_id in (
                select id
                from job_model_versions
                where job_model_id in (
                    select id from job_models where deleted_at is null
                )
            )
            order by sort_order, created_at, id
        ) t
    """,
    "skills": """
        select coalesce(json_agg(row_to_json(t))::text, '[]')
        from (
            select *
            from skills
            where dimension_id in (
                select id
                from competency_dimensions
                where model_version_id in (
                    select id
                    from job_model_versions
                    where job_model_id in (
                        select id from job_models where deleted_at is null
                    )
                )
            )
            order by sort_order, created_at, id
        ) t
    """,
    "skill_knowledge_points": """
        select coalesce(json_agg(row_to_json(t))::text, '[]')
        from (
            select *
            from skill_knowledge_points
            where skill_id in (
                select id
                from skills
                where dimension_id in (
                    select id
                    from competency_dimensions
                    where model_version_id in (
                        select id
                        from job_model_versions
                        where job_model_id in (
                            select id from job_models where deleted_at is null
                        )
                    )
                )
            )
            order by sort_order, created_at, id
        ) t
    """,
    "learning_resources": """
        with selected_dimensions as (
            select id
            from competency_dimensions
            where model_version_id in (
                select id
                from job_model_versions
                where job_model_id in (
                    select id from job_models where deleted_at is null
                )
            )
        ),
        selected_skills as (
            select id
            from skills
            where dimension_id in (select id from selected_dimensions)
        ),
        selected_kps as (
            select id
            from skill_knowledge_points
            where skill_id in (select id from selected_skills)
        )
        select coalesce(json_agg(row_to_json(t))::text, '[]')
        from (
            select *
            from learning_resources
            where (node_type = 'dimension' and node_id in (select id from selected_dimensions))
               or (node_type = 'skill' and node_id in (select id from selected_skills))
               or (node_type = 'kp' and node_id in (select id from selected_kps))
            order by sort_order, created_at, id
        ) t
    """,
}


def run_remote_sql(sql: str) -> list[dict[str, Any]]:
    remote_cmd = (
        f"cd ~/exam-app && docker exec {REMOTE_DB_CONTAINER} "
        f"psql -U exam -d exam -At -c {shlex.quote(sql)}"
    )
    result = subprocess.run(
        ["ssh", REMOTE_HOST, remote_cmd],
        capture_output=True,
        text=True,
        check=True,
    )
    payload = result.stdout.strip() or "[]"
    return json.loads(payload)


def normalize_value(value: Any) -> Any:
    if isinstance(value, list):
        return [normalize_value(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_value(val) for key, val in value.items()}
    if isinstance(value, str):
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        for parser in (uuid.UUID, datetime.fromisoformat):
            try:
                return parser(value)
            except (ValueError, TypeError, AttributeError):
                pass
    return value


def normalize_rows(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: normalize_value(value) for key, value in row.items()} for row in rows]


async def fetch_local_org_id(conn: asyncpg.Connection) -> uuid.UUID:
    row = await conn.fetchrow(
        "select id from organizations where name = $1 order by created_at limit 1",
        TARGET_ORG_NAME,
    )
    if not row:
        raise RuntimeError(f"Local organization named {TARGET_ORG_NAME!r} not found.")
    return row["id"]


async def truncate_local_job_model_tables(conn: asyncpg.Connection) -> None:
    await conn.execute(
        """
        truncate table
            learning_resources,
            source_documents,
            skill_kp_mappings,
            skill_knowledge_points,
            skills,
            competency_dimensions,
            job_model_versions,
            job_models
        cascade
        """
    )


async def insert_rows(
    conn: asyncpg.Connection,
    table: str,
    rows: Sequence[dict[str, Any]],
) -> None:
    if not rows:
        return
    columns = [column for column in rows[0].keys() if not column.startswith("_")]
    column_sql = ", ".join(columns)
    value_sql = ", ".join(f"${idx}" for idx in range(1, len(columns) + 1))
    query = f"insert into {table} ({column_sql}) values ({value_sql})"
    encoded_rows = []
    for row in rows:
        encoded_row = []
        for column in columns:
            value = row[column]
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False)
            encoded_row.append(value)
        encoded_rows.append(tuple(encoded_row))
    await conn.executemany(query, encoded_rows)


async def main() -> None:
    parser = argparse.ArgumentParser(description="Import remote job model data into local PostgreSQL.")
    parser.add_argument("--dry-run", action="store_true", help="Only fetch and summarize remote rows.")
    args = parser.parse_args()

    print("Fetching remote job-model data...")
    payloads = {name: normalize_rows(run_remote_sql(sql)) for name, sql in REMOTE_QUERIES.items()}
    for name, rows in payloads.items():
        print(f"  {name}: {len(rows)}")

    if args.dry_run:
        return

    local_conn = await asyncpg.connect(LOCAL_DATABASE_URL)
    try:
        local_org_id = await fetch_local_org_id(local_conn)

        for row in payloads["job_models"]:
            row["org_id"] = local_org_id
            row["created_by"] = None
            row["origin_standard_model_id"] = row.get("origin_standard_model_id")
            row["_current_version_id"] = row.pop("current_version_id", None)
            row["_origin_standard_model_id"] = row.pop("origin_standard_model_id", None)
            row["current_version_id"] = None
            row["origin_standard_model_id"] = None

        for row in payloads["job_model_versions"]:
            row["created_by"] = None

        for row in payloads["learning_resources"]:
            row["uploaded_by"] = None

        async with local_conn.transaction():
            await truncate_local_job_model_tables(local_conn)
            await insert_rows(local_conn, "job_models", payloads["job_models"])
            await insert_rows(local_conn, "job_model_versions", payloads["job_model_versions"])

            for row in payloads["job_models"]:
                await local_conn.execute(
                    """
                    update job_models
                    set current_version_id = $2,
                        origin_standard_model_id = $3
                    where id = $1
                    """,
                    row["id"],
                    row["_current_version_id"],
                    row["_origin_standard_model_id"],
                )

            await insert_rows(local_conn, "competency_dimensions", payloads["competency_dimensions"])
            await insert_rows(local_conn, "skills", payloads["skills"])
            await insert_rows(local_conn, "skill_knowledge_points", payloads["skill_knowledge_points"])
            await insert_rows(local_conn, "learning_resources", payloads["learning_resources"])

        print("Import complete.")
    finally:
        await local_conn.close()


if __name__ == "__main__":
    asyncio.run(main())

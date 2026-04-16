#!/bin/bash
# Import extracted MIITEC standard job models

cd "$(dirname "$0")/.."

echo "Importing extracted MIITEC standard job models..."
echo ""

extracted_dir="scripts/data/extracted"

if [ ! -d "$extracted_dir" ]; then
    echo "Error: $extracted_dir directory not found"
    exit 1
fi

# Import all extracted JSON files
for json_file in "$extracted_dir"/*.json; do
    if [ -f "$json_file" ]; then
        filename=$(basename "$json_file")
        echo "=== Importing $filename ==="
        PYTHONPATH=src uv run python scripts/import_standard_models.py "$json_file"
        echo ""
    fi
done

echo "Import complete!"
echo ""
echo "Checking statistics..."
PYTHONPATH=src uv run python << 'PYEOF'
import asyncio
from sqlalchemy import select, func
from app.database import async_session
from app.job_models.models import JobModel

async def check_stats():
    async with async_session() as db:
        result = await db.execute(
            select(
                JobModel.industry_name,
                func.count(JobModel.id).label('count')
            )
            .where(JobModel.deleted_at.is_(None))
            .group_by(JobModel.industry_name)
            .order_by(JobModel.industry_name)
        )

        print("\n=== Job Models by Industry ===")
        total = 0
        for row in result:
            print(f"{row.industry_name}: {row.count} models")
            total += row.count
        print(f"\nTotal: {total} models\n")

asyncio.run(check_stats())
PYEOF

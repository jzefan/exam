#!/bin/bash
# Batch import all MIITEC standard job models

cd "$(dirname "$0")/.."

echo "Starting batch import of MIITEC standard job models..."
echo ""

# Import IoT models (already complete)
echo "=== Importing AI Industry - IoT ==="
PYTHONPATH=src uv run python scripts/import_standard_models.py scripts/data/ai_industry_iot_models.json
echo ""

# Import template files
templates=(
    "templates/ai_industry_smart_chip.json"
    "templates/ai_industry_machine_learning.json"
    "templates/ai_industry_deep_learning.json"
    "templates/ai_industry_speech.json"
    "templates/ai_industry_nlp.json"
    "templates/ai_industry_cv.json"
    "templates/ai_industry_kg.json"
    "templates/ai_industry_robot.json"
    "templates/big_data.json"
    "templates/ic_industry.json"
    "templates/data_annotation.json"
    "templates/biopharma.json"
)

for template in "${templates[@]}"; do
    filename=$(basename "$template")
    echo "=== Importing $filename ==="
    PYTHONPATH=src uv run python scripts/import_standard_models.py "scripts/data/$template"
    echo ""
done

echo "Batch import complete!"

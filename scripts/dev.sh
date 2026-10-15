#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

if [ ! -d ".venv" ]; then
    echo "Creating virtual environment in .venv..."
    python3 -m venv .venv
    .venv/bin/pip install --upgrade pip
    .venv/bin/pip install -r requirements.txt
elif [ ! -f ".venv/bin/uvicorn" ]; then
    echo "Installing dependencies into .venv..."
    .venv/bin/pip install -r requirements.txt
fi

export PROJECT_ID="${PROJECT_ID:-zacks-sandbox}"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-$PROJECT_ID}"
export GCP_LOCATION="${GCP_LOCATION:-global}"
export GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.5-flash-lite}"
export DEV_MODE="true"
export PORT="${PORT:-8080}"

echo "Starting Word Meaning Scouter in DEV_MODE on http://localhost:$PORT (Project: $PROJECT_ID)..."

exec .venv/bin/uvicorn server.main:app --reload --host 0.0.0.0 --port "$PORT"

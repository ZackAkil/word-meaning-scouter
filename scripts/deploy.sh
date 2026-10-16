#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
fi

# Configuration (sourced from .env or environment)
PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID in .env or environment}"
SERVICE_NAME="${SERVICE_NAME:-word-meaning-scouter}"
REGION="${REGION:-us-central1}"
GCP_LOCATION="${GCP_LOCATION:-global}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.5-flash-lite}"

# 1. Bot Protection (reCAPTCHA Enterprise v3 / Score-based)
RECAPTCHA_SITE_KEY="${RECAPTCHA_SITE_KEY:?Set RECAPTCHA_SITE_KEY in .env or environment}"
RECAPTCHA_SCORE_THRESHOLD="${RECAPTCHA_SCORE_THRESHOLD:-0.5}"

# 2. Distributed Rate Limiting (Google Cloud Memorystore for Valkey / Redis)
REDIS_URL="${REDIS_URL:?Set REDIS_URL in .env or environment}"
GLOBAL_RATE_LIMIT="${GLOBAL_RATE_LIMIT:-1000 per 5 minutes}"
PER_USER_RATE_LIMIT="${PER_USER_RATE_LIMIT:-10 per minute}"
MAX_BODY_BYTES="${MAX_BODY_BYTES:-131072}"

# 3. Non-Blocking BigQuery Telemetry
DATASET_ID="${BQ_DATASET:-simple_demo_tracking}"
TABLE_ID="${BQ_TABLE:-demo_usage}"
DEMO_NAME="${DEMO_NAME:-$SERVICE_NAME}"

# Enforce production mode on Cloud Run unless explicitly overridden
DEV_MODE="${PROD_DEV_MODE:-false}"
MAX_INSTANCES="${MAX_INSTANCES:-5}"

echo "Building production frontend bundle..."
"$ROOT_DIR/scripts/build_client.sh"

echo "Deploying $SERVICE_NAME to Cloud Run in $PROJECT_ID..."

gcloud run deploy "$SERVICE_NAME" \
  --source "$ROOT_DIR" \
  --region "$REGION" \
  --allow-unauthenticated \
  --project "$PROJECT_ID" \
  --max-instances "$MAX_INSTANCES" \
  --network default \
  --subnet default \
  --clear-base-image \
  --set-env-vars PROJECT_ID="$PROJECT_ID" \
  --set-env-vars GOOGLE_CLOUD_PROJECT="$PROJECT_ID" \
  --set-env-vars GCP_LOCATION="$GCP_LOCATION" \
  --set-env-vars GEMINI_MODEL="$GEMINI_MODEL" \
  --set-env-vars GLOBAL_RATE_LIMIT="$GLOBAL_RATE_LIMIT" \
  --set-env-vars PER_USER_RATE_LIMIT="$PER_USER_RATE_LIMIT" \
  --set-env-vars MAX_BODY_BYTES="$MAX_BODY_BYTES" \
  --set-env-vars RECAPTCHA_SITE_KEY="$RECAPTCHA_SITE_KEY" \
  --set-env-vars RECAPTCHA_SCORE_THRESHOLD="$RECAPTCHA_SCORE_THRESHOLD" \
  --set-env-vars REDIS_URL="$REDIS_URL" \
  --set-env-vars DEV_MODE="$DEV_MODE" \
  --set-env-vars BQ_DATASET="$DATASET_ID" \
  --set-env-vars BQ_TABLE="$TABLE_ID" \
  --set-env-vars DEMO_NAME="$DEMO_NAME"

SHORT_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format="value(status.url)")
echo "Deployment finished."
echo "Short URL: $SHORT_URL"

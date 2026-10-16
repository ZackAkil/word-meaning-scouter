#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
fi

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID in .env or environment}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-word-meaning-scouter}"
DOMAIN="${DOMAIN:?Set DOMAIN in .env or environment}"

echo "Mapping $DOMAIN and www.$DOMAIN to Cloud Run service '$SERVICE_NAME'..."

gcloud beta run domain-mappings create \
  --service="$SERVICE_NAME" \
  --domain="$DOMAIN" \
  --region="$REGION" \
  --project="$PROJECT_ID" || true

gcloud beta run domain-mappings create \
  --service="$SERVICE_NAME" \
  --domain="www.$DOMAIN" \
  --region="$REGION" \
  --project="$PROJECT_ID" || true

echo ""
echo "Current Domain Mappings:"
gcloud beta run domain-mappings list --region="$REGION" --project="$PROJECT_ID"

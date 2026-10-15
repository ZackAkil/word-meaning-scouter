#!/bin/bash
set -e

PROJECT_ID="starter-apps-base"
REGION="us-central1"
SERVICE_NAME="word-meaning-scouter"
DOMAIN="word-meaning-scouter.com"

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

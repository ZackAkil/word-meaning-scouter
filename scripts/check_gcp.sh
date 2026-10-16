#!/bin/bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
fi

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID in .env or environment}"
REGION="${REGION:-us-central1}"
DATASET_ID="${BQ_DATASET:-simple_demo_tracking}"
TABLE_ID="${BQ_TABLE:-demo_usage}"

FAILURES=0

pass() {
    echo "  [OK]   $1"
}

fail() {
    echo "  [MISS] $1"
    FAILURES=$((FAILURES + 1))
}

echo "============================================================"
echo "GCP Production Readiness Check"
echo "Project : $PROJECT_ID"
echo "Region  : $REGION"
echo "============================================================"
echo ""

# 0. Verify Project Access
echo "1. Checking GCP Project Access..."
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
    pass "Project '$PROJECT_ID' is accessible"
else
    fail "Cannot access project '$PROJECT_ID' (check gcloud auth or project ID)"
    exit 1
fi
echo ""

# 1. Verify Required APIs
echo "2. Checking Required GCP APIs..."
REQUIRED_APIS=(
    "run.googleapis.com"
    "aiplatform.googleapis.com"
    "recaptchaenterprise.googleapis.com"
    "redis.googleapis.com"
    "bigquery.googleapis.com"
)
ENABLED_APIS=$(gcloud services list --enabled --project="$PROJECT_ID" --format="value(config.name)" 2>/dev/null || true)

for api in "${REQUIRED_APIS[@]}"; do
    if echo "$ENABLED_APIS" | grep -qx "$api"; then
        pass "API enabled: $api"
    else
        fail "API not enabled: $api (run: gcloud services enable $api --project=$PROJECT_ID)"
    fi
done
echo ""

# 2. Check Memorystore (Redis / Valkey)
echo "3. Checking Memorystore (Redis / Valkey) in $REGION..."
REDIS_INSTANCES=$(gcloud redis instances list --region="$REGION" --project="$PROJECT_ID" --format="value(name,host,port,state)" 2>/dev/null || true)
VALKEY_INSTANCES=$(gcloud memorystore instances list --location="$REGION" --project="$PROJECT_ID" --format="value(name,state)" 2>/dev/null || true)

if [ -n "$REDIS_INSTANCES" ]; then
    while IFS=$'\t' read -r name host port state; do
        pass "Redis instance '$name' ($state) -> REDIS_URL=redis://${host}:${port}/0"
    done <<< "$REDIS_INSTANCES"
elif [ -n "$VALKEY_INSTANCES" ]; then
    while IFS=$'\t' read -r name state; do
        valkey_ip=$(gcloud memorystore instances describe "$name" --location="$REGION" --project="$PROJECT_ID" --format="value(endpoints[0].connections[0].pscAutoConnection.ipAddress)" 2>/dev/null || true)
        pass "Memorystore Valkey instance '$name' ($state) -> REDIS_URL=redis://${valkey_ip:-<ip>}:6379/0"
    done <<< "$VALKEY_INSTANCES"
else
    fail "No Memorystore Redis/Valkey instances found in region '$REGION'"
fi
echo ""

# 3. Check reCAPTCHA Enterprise Keys
echo "4. Checking reCAPTCHA Enterprise Keys..."
RECAPTCHA_KEYS=$(gcloud recaptcha keys list --project="$PROJECT_ID" --format="value(name,displayName,webSettings.allowedDomains)" 2>/dev/null || true)

if [ -n "$RECAPTCHA_KEYS" ]; then
    while IFS=$'\t' read -r key_path display_name domains; do
        key_id="${key_path##*/}"
        pass "Key '$display_name' -> RECAPTCHA_SITE_KEY=$key_id (domains: ${domains:-any})"
    done <<< "$RECAPTCHA_KEYS"
else
    fail "No reCAPTCHA Enterprise keys found in '$PROJECT_ID'"
fi
echo ""

# 4. Check BigQuery Dataset & Table
echo "5. Checking BigQuery Telemetry ($PROJECT_ID:$DATASET_ID.$TABLE_ID)..."
if bq show --project_id="$PROJECT_ID" "${PROJECT_ID}:${DATASET_ID}" >/dev/null 2>&1; then
    pass "BigQuery dataset exists: ${DATASET_ID}"
    if bq show --project_id="$PROJECT_ID" "${PROJECT_ID}:${DATASET_ID}.${TABLE_ID}" >/dev/null 2>&1; then
        pass "BigQuery table exists: ${DATASET_ID}.${TABLE_ID}"
    else
        fail "BigQuery table missing: ${DATASET_ID}.${TABLE_ID}"
    fi
else
    fail "BigQuery dataset missing: ${DATASET_ID}"
fi
echo ""

echo "============================================================"
if [ "$FAILURES" -eq 0 ]; then
    echo "READY: All checks passed for '$PROJECT_ID'."
    exit 0
else
    echo "NOT READY: $FAILURES check(s) failed for '$PROJECT_ID'."
    exit 1
fi

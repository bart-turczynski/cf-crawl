#!/usr/bin/env bash
# crawl.sh — Crawl a website using Cloudflare Browser Rendering /crawl
#
# Usage:
#   ./scripts/crawl.sh <url>
#   ./scripts/crawl.sh https://example.com
#
# Requires: curl, jq
# Config:   copy .env.example → .env and fill in your Cloudflare credentials

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env
if [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
else
  echo "Error: .env file not found. Copy .env.example to .env and fill in your credentials."
  exit 1
fi

# Validate
: "${CF_ACCOUNT_ID:?Set CF_ACCOUNT_ID in .env}"
: "${CF_API_TOKEN:?Set CF_API_TOKEN in .env}"

BASE_URL="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering"
START_URL="${1:?Usage: ./scripts/crawl.sh <url>}"
OUTPUT_DIR="$PROJECT_DIR/output"
mkdir -p "$OUTPUT_DIR"

echo "Starting crawl of: $START_URL"
echo "---"

# Step 1: Kick off the crawl
RESPONSE=$(curl -s -X POST "${BASE_URL}/crawl" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${START_URL}\",
    \"render\": true
  }")

# Check for errors
if echo "$RESPONSE" | jq -e '.errors[0]' > /dev/null 2>&1; then
  echo "Error starting crawl:"
  echo "$RESPONSE" | jq '.errors'
  exit 1
fi

JOB_ID=$(echo "$RESPONSE" | jq -r 'if (.result | type) == "string" then .result else (.result.id // .result.jobId // empty) end')

if [[ -z "$JOB_ID" ]]; then
  echo "Could not extract job ID from response:"
  echo "$RESPONSE" | jq .
  exit 1
fi

echo "Crawl job started! Job ID: $JOB_ID"
echo "---"

# Step 2: Poll for results
POLL_INTERVAL=10
MAX_ATTEMPTS=120  # 20 minutes max

for (( i=1; i<=MAX_ATTEMPTS; i++ )); do
  echo "Polling attempt $i / $MAX_ATTEMPTS ..."

  RESULT=$(curl -s -X GET "${BASE_URL}/crawl/${JOB_ID}" \
    -H "Authorization: Bearer ${CF_API_TOKEN}")

  STATUS=$(echo "$RESULT" | jq -r '.result.status // "unknown"')

  case "$STATUS" in
    completed|done|finished)
      echo ""
      echo "Crawl complete!"
      TIMESTAMP=$(date +%Y%m%d_%H%M%S)
      HOST=$(echo "$START_URL" | sed 's|https\?://||;s|^www\.||;s|/.*||')
      OUTFILE="$OUTPUT_DIR/crawl_${HOST}_${TIMESTAMP}.json"
      echo "$RESULT" | jq . > "$OUTFILE"
      echo "Results saved to: $OUTFILE"

      # Print summary
      PAGE_COUNT=$(echo "$RESULT" | jq '.result.pages // .result.data | length')
      echo "Pages crawled: ${PAGE_COUNT:-unknown}"
      exit 0
      ;;
    failed|error)
      echo "Crawl failed!"
      echo "$RESULT" | jq '.result'
      exit 1
      ;;
    *)
      # Still running — show progress if available
      PAGES_SO_FAR=$(echo "$RESULT" | jq -r '.result.pagesProcessed // .result.progress // "in progress"')
      echo "  Status: $STATUS | Progress: $PAGES_SO_FAR"
      sleep "$POLL_INTERVAL"
      ;;
  esac
done

echo "Timed out after $((MAX_ATTEMPTS * POLL_INTERVAL)) seconds."
echo "Job ID for manual checking: $JOB_ID"
exit 1

#!/usr/bin/env bash
# DEPRECATED: This is a reference implementation that may lack feature parity
# with the JS CLI. Prefer: node index.js scrape <url>
#
# scrape.sh — Scrape specific elements from a page using /scrape
#
# Usage:
#   ./scripts/scrape.sh <url>
#   ./scripts/scrape.sh https://example.com/blog
#
# Requires: curl, jq

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env
if [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
else
  echo "Error: .env file not found."
  exit 1
fi

: "${CF_ACCOUNT_ID:?Set CF_ACCOUNT_ID in .env}"
: "${CF_API_TOKEN:?Set CF_API_TOKEN in .env}"

BASE_URL="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering"
TARGET_URL="${1:?Usage: ./scripts/scrape.sh <url>}"
OUTPUT_DIR="$PROJECT_DIR/output"
mkdir -p "$OUTPUT_DIR"

echo "Scraping: $TARGET_URL"
echo "---"

RESPONSE=$(curl -s -X POST "${BASE_URL}/scrape" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${TARGET_URL}\",
    \"elements\": [
      { \"selector\": \"h1\" },
      { \"selector\": \"h2\" },
      { \"selector\": \"h3\" },
      { \"selector\": \"p\" },
      { \"selector\": \"a[href]\" },
      { \"selector\": \"meta[name='description']\" },
      { \"selector\": \"title\" }
    ],
    \"waitForSelector\": \"h1\"
  }")

# Check for errors
if echo "$RESPONSE" | jq -e '.errors[0]' > /dev/null 2>&1; then
  echo "Error:"
  echo "$RESPONSE" | jq '.errors'
  exit 1
fi

# Save full result
SLUG=$(echo "$TARGET_URL" | sed 's|https\?://||;s|/|_|g;s|_$||')
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTFILE="$OUTPUT_DIR/scrape_${SLUG}_${TIMESTAMP}.json"
echo "$RESPONSE" | jq . > "$OUTFILE"
echo "Full results saved to: $OUTFILE"

# Print quick summary
echo ""
echo "=== Quick Summary ==="
echo "Title: $(echo "$RESPONSE" | jq -r '.result[6].results[0].text // "N/A"')"
echo "H1 tags: $(echo "$RESPONSE" | jq '.result[0].results | length')"
echo "H2 tags: $(echo "$RESPONSE" | jq '.result[1].results | length')"
echo "Links:   $(echo "$RESPONSE" | jq '.result[4].results | length')"

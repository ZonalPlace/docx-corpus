  #!/bin/bash
  set -e

  CRAWL_ID="${1:-CC-MAIN-2025-51}"
  REGION="${2:-us-east-1}"

  echo "Fetching CDX paths for $CRAWL_ID..."
  PATHS=$(curl -s "https://data.commoncrawl.org/crawl-data/${CRAWL_ID}/cc-index.paths.gz" | gunzip)

  TOTAL=$(echo "$PATHS" | wc -l | tr -d ' ')
  echo "Found $TOTAL CDX files. Invoking lambdas (10 parallel)..."

  echo "$PATHS" | xargs -P 10 -I {} aws lambda invoke \
    --function-name cdx-filter \
    --region "$REGION" \
    --invocation-type Event \
    --cli-binary-format raw-in-base64-out \
    --payload "{\"cdxPath\":\"{}\",\"crawlId\":\"$CRAWL_ID\"}" \
    /dev/null --no-cli-pager 2>&1 | grep -v "^$"

  echo "Done! All $TOTAL Lambda invocations queued."
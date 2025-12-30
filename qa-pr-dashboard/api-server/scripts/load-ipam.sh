#!/bin/bash

# Script to load IPAM UUID and IP data for use in curl commands
# Usage: source scripts/load-ipam.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_FILE="$API_SERVER_DIR/data/ipam-data.json"

if [ ! -f "$DATA_FILE" ]; then
    echo "❌ IPAM data file not found: $DATA_FILE"
    echo "   Run: node scripts/fetch-ipam.js first"
    return 1
fi

# Load data using jq
if ! command -v jq &> /dev/null; then
    echo "❌ jq is required but not installed"
    return 1
fi

# Export arrays
export IPAM_UUIDS=($(jq -r '.simpleArray[].uuid' "$DATA_FILE"))
export IPAM_IPS=($(jq -r '.simpleArray[].ip' "$DATA_FILE"))
export IPAM_COUNT=$(jq '.simpleArray | length' "$DATA_FILE")

echo "✅ Loaded $IPAM_COUNT IPAM records"
echo ""
echo "Usage examples:"
echo "  echo \${IPAM_UUIDS[0]}  # First UUID"
echo "  echo \${IPAM_IPS[0]}    # First IP"
echo ""
echo "Loop through all:"
echo "  for i in \${!IPAM_UUIDS[@]}; do"
echo "    echo \"UUID: \${IPAM_UUIDS[\$i]}, IP: \${IPAM_IPS[\$i]}\""
echo "  done"


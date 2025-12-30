#!/bin/bash

# Script to delete all IPAM entries automatically
# Uses UUID and IP from the stored data

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_FILE="$API_SERVER_DIR/data/ipam-data.json"

# Check if data file exists
if [ ! -f "$DATA_FILE" ]; then
    echo "❌ IPAM data file not found: $DATA_FILE"
    echo "   Run: node scripts/fetch-ipam.js first"
    exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "❌ jq is required but not installed"
    exit 1
fi

# Load UUIDs, IPs, and Availability Zones
UUIDS=($(jq -r '.items[].uuid' "$DATA_FILE"))
IPS=($(jq -r '.items[].ip' "$DATA_FILE"))
AZS=($(jq -r '.items[].az_name // "N2"' "$DATA_FILE"))
COUNT=$(jq '.items | length' "$DATA_FILE")

if [ "$COUNT" -eq 0 ]; then
    echo "❌ No IPAM records found in data file"
    exit 1
fi

echo "📋 Found $COUNT IPAM records to delete"
echo "🗑️  Starting deletion process..."
echo ""

# Authorization token
AUTH_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJreVhaOG8xS2ZvcDEtOHJLZGotLUE2cTBmZ25IY2RGdDhWek4xYnBvQ1drIn0.eyJleHAiOjE3NjY1NjY5MjQsImlhdCI6MTc2NjU2NjYyNCwiYXV0aF90aW1lIjoxNzY2NTU5NTM0LCJqdGkiOiI1ZWE5OTQ2NS1jOTMxLTRkNjQtOTQxZi03N2Q5OWNhNDMxNTkiLCJpc3MiOiJodHRwczovL25vcnRoLWF1dGguY2xvdWQuYWlydGVsLmluL2F1dGgvcmVhbG1zL2FpcnRlbCIsImF1ZCI6WyJjb250cm9sbGVyIiwiYWNjb3VudCJdLCJzdWIiOiIzZmEyNWU4ZC0yZjdlLTQ0NmEtODc5Yi1lNDUxM2EwYWVmY2QiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJjb250cm9sbGVyIiwibm9uY2UiOiI4MGIxODkxNS1lYTBkLTQ5NjQtYmI3MC1kOWJjMDhkMmRhMjAiLCJzZXNzaW9uX3N0YXRlIjoiYmFjYWI2NWMtNmM5ZC00Zjk4LTgyNmEtMWMyODYwMTg1MDllIiwiYWNyIjoiMCIsImFsbG93ZWQtb3JpZ2lucyI6WyIqIl0sInJlYWxtX2FjY2VzcyI6eyJyb2xlcyI6WyJvZmZsaW5lX2FjY2VzcyIsInVtYV9hdXRob3JpemF0aW9uIiwiZGVmYXVsdC1yb2xlcy1haXJ0ZWwiXX0sInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiLCJ2aWV3LXByb2ZpbGUiXX19LCJzY29wZSI6Im9wZW5pZCBlbWFpbCBwcm9maWxlIiwic2lkIjoiYmFjYWI2NWMtNmM5ZC00Zjk4LTgyNmEtMWMyODYwMTg1MDllIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJhbWl0IG5pZ2FtIiwicmVhbG0iOiJhaXJ0ZWwiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJhbWl0Lm5pZ2FtQGNvcmVkZ2UuaW8iLCJnaXZlbl9uYW1lIjoiYW1pdCIsImZhbWlseV9uYW1lIjoibmlnYW0iLCJlbWFpbCI6ImFtaXQubmlnYW1AY29yZWRnZS5pbyJ9.o9AJ8kuz1GjLv-ewRtWzE9Ti6IXsDdQrDWftaGG0RyQLHHtr1oetE9fm6H47QnP4CPVBAf0JF3UQyQ_zGl9gXt9znSFUiScV2nV2tvnD4-6HuLIU3P3hggIxOydLdNymW0jhzvXCa_lFxh_bRXwdL7jcNFKPegtml2UqmXVFOQsCV_bq0uCqAQf71CIOLJqKA49ZC0Y0Zbwk1DmiQCOAefGWS9v5UzUht_Wl6cj_uuiBFR3PRdAh7ySSATMnX8Krim4dSehve_muPWlNTgn1zD-xcD5wHHvTHwKNi3mYtUwDh6Kck_PlD-uGP4HbBhNMLMkBwvys29RlXDS1VfLjhw"

# Base URL
BASE_URL="https://north.cloud.airtel.in/api/v1/ipam"

# Counters
success_count=0
failed_count=0
failed_items=()

# Loop through each item and delete
for i in "${!UUIDS[@]}"; do
    UUID="${UUIDS[$i]}"
    IP="${IPS[$i]}"
    AZ="${AZS[$i]}"
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📌 Deleting item $((i+1)) of $COUNT"
    echo "   UUID: $UUID"
    echo "   IP:   $IP"
    echo "   AZ:   $AZ"
    
    # Construct the delete URL
    DELETE_URL="${BASE_URL}/${UUID}?ip=${IP}"
    
    # Execute delete
    echo "🗑️  Sending DELETE request..."
    response=$(curl -s -w "\n%{http_code}" --location --request DELETE "$DELETE_URL" \
        --header 'accept: */*' \
        --header "Ce-Availability-Zone: $AZ" \
        --header 'Ce-Region: north' \
        --header 'organisation-id: 2d9ec5aa-ee7e-424f-b74d-aac23b54f427' \
        --header 'organisation-name: perftest' \
        --header 'project-name: cell-1' \
        --header "Authorization: Bearer $AUTH_TOKEN")
    
    # Extract HTTP status code (last line)
    http_code=$(echo "$response" | tail -n1)
    # Extract response body (all but last line)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 204 ]; then
        echo "✅ Successfully deleted (HTTP $http_code)"
        ((success_count++))
    else
        echo "❌ Delete failed (HTTP $http_code)"
        if [ -n "$body" ]; then
            echo "   Response: $body"
        fi
        ((failed_count++))
        failed_items+=("$UUID:$IP")
    fi
    
    echo ""
    
    # Small delay between requests
    sleep 1
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Deletion Summary:"
echo "   ✅ Successful: $success_count"
echo "   ❌ Failed: $failed_count"
echo "   📋 Total: $COUNT"
echo ""

if [ ${#failed_items[@]} -gt 0 ]; then
    echo "❌ Failed items:"
    for item in "${failed_items[@]}"; do
        echo "   - $item"
    done
fi

echo ""
echo "✅ Deletion process completed"


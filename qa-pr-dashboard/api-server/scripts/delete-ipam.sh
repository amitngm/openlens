#!/bin/bash

# Script to delete IPAM entries one by one with confirmation
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
echo ""

# Authorization token (update this if needed)
AUTH_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJreVhaOG8xS2ZvcDEtOHJLZGotLUE2cTBmZ25IY2RGdDhWek4xYnBvQ1drIn0.eyJleHAiOjE3NjY1NjY5MjQsImlhdCI6MTc2NjU2NjYyNCwiYXV0aF90aW1lIjoxNzY2NTU5NTM0LCJqdGkiOiI1ZWE5OTQ2NS1jOTMxLTRkNjQtOTQxZi03N2Q5OWNhNDMxNTkiLCJpc3MiOiJodHRwczovL25vcnRoLWF1dGguY2xvdWQuYWlydGVsLmluL2F1dGgvcmVhbG1zL2FpcnRlbCIsImF1ZCI6WyJjb250cm9sbGVyIiwiYWNjb3VudCJdLCJzdWIiOiIzZmEyNWU4ZC0yZjdlLTQ0NmEtODc5Yi1lNDUxM2EwYWVmY2QiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJjb250cm9sbGVyIiwibm9uY2UiOiI4MGIxODkxNS1lYTBkLTQ5NjQtYmI3MC1kOWJjMDhkMmRhMjAiLCJzZXNzaW9uX3N0YXRlIjoiYmFjYWI2NWMtNmM5ZC00Zjk4LTgyNmEtMWMyODYwMTg1MDllIiwiYWNyIjoiMCIsImFsbG93ZWQtb3JpZ2lucyI6WyIqIl0sInJlYWxtX2FjY2VzcyI6eyJyb2xlcyI6WyJvZmZsaW5lX2FjY2VzcyIsInVtYV9hdXRob3JpemF0aW9uIiwiZGVmYXVsdC1yb2xlcy1haXJ0ZWwiXX0sInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiLCJ2aWV3LXByb2ZpbGUiXX19LCJzY29wZSI6Im9wZW5pZCBlbWFpbCBwcm9maWxlIiwic2lkIjoiYmFjYWI2NWMtNmM5ZC00Zjk4LTgyNmEtMWMyODYwMTg1MDllIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJhbWl0IG5pZ2FtIiwicmVhbG0iOiJhaXJ0ZWwiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJhbWl0Lm5pZ2FtQGNvcmVkZ2UuaW8iLCJnaXZlbl9uYW1lIjoiYW1pdCIsImZhbWlseV9uYW1lIjoibmlnYW0iLCJlbWFpbCI6ImFtaXQubmlnYW1AY29yZWRnZS5pbyJ9.o9AJ8kuz1GjLv-ewRtWzE9Ti6IXsDdQrDWftaGG0RyQLHHtr1oetE9fm6H47QnP4CPVBAf0JF3UQyQ_zGl9gXt9znSFUiScV2nV2tvnD4-6HuLIU3P3hggIxOydLdNymW0jhzvXCa_lFxh_bRXwdL7jcNFKPegtml2UqmXVFOQsCV_bq0uCqAQf71CIOLJqKA49ZC0Y0Zbwk1DmiQCOAefGWS9v5UzUht_Wl6cj_uuiBFR3PRdAh7ySSATMnX8Krim4dSehve_muPWlNTgn1zD-xcD5wHHvTHwKNi3mYtUwDh6Kck_PlD-uGP4HbBhNMLMkBwvys29RlXDS1VfLjhw"

# Base URL
BASE_URL="https://north.cloud.airtel.in/api/v1/ipam"

# Loop through each item
for i in "${!UUIDS[@]}"; do
    UUID="${UUIDS[$i]}"
    IP="${IPS[$i]}"
    AZ="${AZS[$i]}"
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📌 Item $((i+1)) of $COUNT"
    echo "   UUID: $UUID"
    echo "   IP:   $IP"
    echo "   AZ:   $AZ"
    echo ""
    
    # Construct the delete URL
    DELETE_URL="${BASE_URL}/${UUID}?ip=${IP}"
    
    # Show what will be deleted
    echo "🔗 DELETE URL: $DELETE_URL"
    echo ""
    
    # Ask for confirmation
    read -p "❓ Do you want to delete this IPAM entry? (y/n/skip): " confirm
    
    case $confirm in
        [yY]|[yY][eE][sS])
            echo "🗑️  Deleting..."
            
            # Execute delete
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
            else
                echo "❌ Delete failed (HTTP $http_code)"
                echo "Response: $body"
            fi
            ;;
        [nN]|[nN][oO])
            echo "⏭️  Skipped"
            ;;
        [sS]|[sS][kK][iI][pP])
            echo "⏭️  Skipped"
            ;;
        *)
            echo "❌ Invalid input. Skipping..."
            ;;
    esac
    
    echo ""
    
    # Ask if user wants to continue
    if [ $i -lt $((${#UUIDS[@]} - 1)) ]; then
        read -p "➡️  Continue to next item? (y/n): " continue_choice
        case $continue_choice in
            [nN]|[nN][oO])
                echo "🛑 Stopped by user"
                exit 0
                ;;
            *)
                echo ""
                ;;
        esac
    fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Finished processing all items"
echo ""


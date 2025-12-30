#!/bin/bash

# Example: How to use IPAM data in curl commands

# First, load the IPAM data
source "$(dirname "$0")/load-ipam.sh"

# Example 1: Use first UUID and IP in a curl command
if [ ${#IPAM_UUIDS[@]} -gt 0 ]; then
    UUID="${IPAM_UUIDS[0]}"
    IP="${IPAM_IPS[0]}"
    
    echo "Example curl using first UUID and IP:"
    echo "curl -X GET 'https://api.example.com/resource/${UUID}' \\"
    echo "  -H 'X-IP: ${IP}'"
    echo ""
fi

# Example 2: Loop through all UUIDs and IPs
echo "All UUID and IP pairs:"
for i in "${!IPAM_UUIDS[@]}"; do
    echo "  [$i] UUID: ${IPAM_UUIDS[$i]}, IP: ${IPAM_IPS[$i]}"
done

# Example 3: Use in a curl command for each item
echo ""
echo "Example: Loop through and make API calls:"
for i in "${!IPAM_UUIDS[@]}"; do
    UUID="${IPAM_UUIDS[$i]}"
    IP="${IPAM_IPS[$i]}"
    echo "# Processing item $i: UUID=$UUID, IP=$IP"
    # Uncomment to actually make the call:
    # curl -X POST "https://api.example.com/endpoint" \
    #   -H "Content-Type: application/json" \
    #   -d "{\"uuid\":\"$UUID\",\"ip\":\"$IP\",\"status\":\"creating\"}"
done




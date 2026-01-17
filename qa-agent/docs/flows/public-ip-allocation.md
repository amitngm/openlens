# Public IP Allocation Flow

## Overview

This flow tests the complete public IP allocation workflow in the CMP, including:

1. UI-based IP allocation with status transitions
2. API verification of TCPWave IPAM records
3. NAT state verification
4. Kubernetes service health checks

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Public IP Allocation Flow                     │
└─────────────────────────────────────────────────────────────────┘

Setup:
┌─────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐
│ Navigate│───▶│ Enter       │───▶│ Enter       │───▶│ Submit   │
│ to Login│    │ Username    │    │ Password    │    │ Login    │
└─────────┘    └─────────────┘    └─────────────┘    └──────────┘

Main Flow:
┌─────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐
│ Navigate│───▶│ Open IP     │───▶│ Fill        │───▶│ Submit   │
│ to Net  │    │ Allocation  │    │ Form        │    │ Request  │
└─────────┘    └─────────────┘    └─────────────┘    └──────────┘
                                                           │
                                                           ▼
┌─────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐
│ Verify  │◀───│ Check NAT   │◀───│ Check       │◀───│ Wait for │
│ in UI   │    │ State       │    │ TCPWave     │    │ Created  │
└─────────┘    └─────────────┘    └─────────────┘    └──────────┘

Teardown:
┌─────────┐    ┌─────────────┐
│ Delete  │───▶│ Logout      │
│ Test IP │    │             │
└─────────┘    └─────────────┘
```

## Required Variables

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `testTenant` | boolean | Yes | Must be `true` (security guard) |
| `region` | string | No | Target region (default: `us-east-1`) |
| `ipCount` | number | No | Number of IPs (default: `1`) |
| `ipName` | string | No | IP name prefix (default: `qa-test-ip`) |

## Usage

### Basic Execution

```bash
curl -X POST http://qa-agent-api:8080/runs \
  -H "Content-Type: application/json" \
  -d '{
    "flow_name": "public-ip-allocation",
    "env": "staging",
    "tenant": "qa-test-tenant",
    "variables": {
      "testTenant": true,
      "region": "us-east-1"
    }
  }'
```

### With Custom IP Name

```bash
curl -X POST http://qa-agent-api:8080/runs \
  -H "Content-Type: application/json" \
  -d '{
    "flow_name": "public-ip-allocation",
    "env": "staging",
    "tenant": "qa-test-tenant",
    "variables": {
      "testTenant": true,
      "region": "eu-west-1",
      "ipName": "smoke-test-ip"
    }
  }'
```

## Step Details

### Setup Steps

1. **Login to CMP**
   - Navigates to login page
   - Enters test credentials from secrets
   - Submits login form
   - Waits for dashboard

### Main Steps

1. **Navigate to Network Section**
   - Clicks network navigation item
   - Waits for IP management panel

2. **Open IP Allocation**
   - Clicks allocation link
   - Waits for allocation form

3. **Fill Allocation Form**
   - Enters IP name with run ID suffix
   - Selects target region
   - Chooses Public IP type

4. **Submit and Wait**
   - Submits allocation request
   - Verifies "Allocating" status appears
   - Waits for "Created" status (up to 2 minutes)

5. **API Verifications**
   - Gets allocated IP details from CMP API
   - Verifies TCPWave record exists and is active
   - Checks NAT state transitions (Creating → Created)

6. **K8s Health Checks**
   - Verifies network service is available
   - Checks IP controller pod is ready

7. **UI Verification**
   - Navigates to IP list
   - Searches for allocated IP
   - Verifies IP address appears

### Teardown Steps

1. **Cleanup**
   - Deletes test IP via API
   - Logs out of CMP

## Placeholder Endpoints

The following endpoints are placeholders that need to be configured for your environment:

### TCPWave API

```yaml
# Current placeholder
url: "${API_BASE_URL}/api/v1/integrations/tcpwave/records/${tcpwaveRecordId}"

# Replace with actual endpoint, e.g.:
url: "https://tcpwave.internal.example.com/api/records/${tcpwaveRecordId}"
```

### NAT State API

```yaml
# Current placeholder
url: "${API_BASE_URL}/api/v1/network/nat/${allocatedIpId}/state"

# Replace with actual endpoint based on your infrastructure
```

## Customization

### Adding Region Support

Edit `flows/samples/public-ip-allocation.yaml`:

```yaml
default_variables:
  region: "us-east-1"

# Add to step
- name: "Select Region"
  type: ui
  ui:
    action: select
    selector: "#region-select"
    value: "${region}"
```

### Adding Multiple IP Support

```yaml
# Add loop variable
default_variables:
  ipCount: 3

# Add loop in steps (requires flow engine enhancement)
```

### Skipping Optional Steps

```yaml
- name: "Verify TCPWave Record"
  skip_condition: "${skipTcpwaveCheck} == true"
  # ... rest of step
```

## Expected Results

### Successful Run

```json
{
  "run_id": "run-abc123def456",
  "status": "completed",
  "summary": {
    "total_steps": 18,
    "passed": 18,
    "failed": 0,
    "skipped": 0
  },
  "duration_ms": 45000
}
```

### Artifacts Generated

```
run-abc123def456/
├── screenshots/
│   ├── Login_to_CMP_1705312800000.png
│   ├── Navigate_to_Network_section_1705312810000.png
│   ├── Submit_IP_Allocation_Request_1705312830000.png
│   ├── Verify_Allocating_Status_1705312835000.png
│   ├── Wait_for_Created_Status_1705312900000.png
│   └── Verify_IP_Appears_in_List_1705312920000.png
├── reports/
│   ├── report.json
│   └── network.har
└── videos/
    └── (if video capture enabled)
```

## Troubleshooting

### Login Fails

**Symptom:** Step "Submit login form" fails

**Possible causes:**
1. Incorrect credentials in secrets
2. Login page selectors changed
3. MFA enabled on test account

**Resolution:**
1. Verify secrets: `kubectl get secret qa-agent-secrets -o yaml`
2. Update selectors in flow definition
3. Disable MFA for test account

### TCPWave Verification Fails

**Symptom:** "Check TCPWave Record" step fails

**Possible causes:**
1. Placeholder endpoint not updated
2. TCPWave service unreachable
3. Record creation delayed

**Resolution:**
1. Update endpoint URL to actual TCPWave API
2. Check network connectivity
3. Increase retry count/delay

### NAT State Stuck in Creating

**Symptom:** "Check NAT State - Created" fails after retries

**Possible causes:**
1. NAT provisioning slow in environment
2. Backend service issue
3. Resource constraints

**Resolution:**
1. Increase timeout: `timeout_ms: 180000`
2. Increase retries: `retries: 5`
3. Check backend service logs

## Related Flows

- `health-check.yaml` - Basic connectivity test (run first)
- `ip-deallocation.yaml` - IP cleanup flow (if needed separately)
- `network-policy-test.yaml` - Network policy verification

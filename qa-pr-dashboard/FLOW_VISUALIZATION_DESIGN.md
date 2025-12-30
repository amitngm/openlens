# Flow Visualization Design - Namespace & Pod-Based View

## Important Context
- `qa-pr-dashboard` API server runs in its own namespace (likely `qa-pr-dashboard` or `default`)
- We want to **track and visualize flows from services/pods in the SELECTED namespace** (ccs, dbaas, etc.)
- A flow should be shown if **any service/pod in that flow is in the selected namespace**
- The API server itself may initiate requests, but we're tracking the target services in the selected namespace

## Current Issues
1. Flow details show "default" namespace even when "ccs" is selected
2. Pod names show as "unknown" 
3. No visual connection between pods and their service calls
4. Flows not properly filtered by selected namespace
5. Not distinguishing between API server namespace vs. target service namespace

## Proposed Design

### 1. Flow Details Modal - Enhanced View (Realistic)

```
┌─────────────────────────────────────────────────────────────┐
│ Flow Details: GET /api/users                    [X]        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ 📊 Flow Overview                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Trace ID: 7b5064dafff764011d78bf33eafd5a10              │ │
│ │ Duration: 176.64ms                                       │ │
│ │ Target Namespace: ccs ✅ (selected)                      │ │
│ │ Status: Success                                           │ │
│ │ Services: 3 | Spans: 12 | Errors: 0                     │ │
│ │ Services in ccs: 2 | Services in other: 1                │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                               │
│ 🔗 Service Flow with Pod Connections                         │
│                                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🟢 qa-pr-dashboard-api (qa-pr-dashboard)                 │ │
│ │    Pod: qa-api-pod-abc123-xyz                            │ │
│ │    ┌─────────────────────────────────────────────────┐   │ │
│ │    │ Requests: 1  │ Errors: 0  │ Avg: 6.42ms         │   │ │
│ │    │ P95: 6.42ms  │ P99: 6.42ms                      │   │ │
│ │    └─────────────────────────────────────────────────┘   │ │
│ │    ↓ Calls to services in ccs namespace:                 │ │
│ │    ├─→ 🟢 user-service (ccs) ⭐ TARGET NAMESPACE         │ │
│ │    │     Pod: user-pod-def456-uvw                        │ │
│ │    │     ┌───────────────────────────────────────────┐   │ │
│ │    │     │ Requests: 1  │ Errors: 0  │ Avg: 4.2ms    │   │ │
│ │    │     └───────────────────────────────────────────┘   │ │
│ │    │     ↓ Calls to:                                     │ │
│ │    │     └─→ 🟢 database-service (ccs) ⭐ TARGET          │ │
│ │    │           Pod: db-pod-ghi789-rst                    │ │
│ │    │           ┌─────────────────────────────────────┐   │ │
│ │    │           │ Requests: 1  │ Errors: 0  │ Avg: 2.1ms│ │ │
│ │    │           └─────────────────────────────────────┘   │ │
│ │    └─→ 🟢 auth-service (ccs) ⭐ TARGET NAMESPACE           │ │
│ │          Pod: auth-pod-jkl012-mno                         │ │
│ │          ┌─────────────────────────────────────────────┐ │ │
│ │          │ Requests: 1  │ Errors: 0  │ Avg: 3.5ms      │ │ │
│ │          └─────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                               │
│ 📋 Pod Call Chain (Visual Timeline) - ccs Namespace         │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ qa-api-pod-abc123 (qa-pr-dashboard)                      │ │
│ │    └─[6.42ms]──→ user-pod-def456 (ccs) ⭐                │ │
│ │                      │                                    │ │
│ │                      └─[4.2ms]──→ db-pod-ghi789 (ccs) ⭐  │ │
│ │                                                           │ │
│ │ qa-api-pod-abc123 (qa-pr-dashboard)                      │ │
│ │    └─[3.5ms]──→ auth-pod-jkl012 (ccs) ⭐                 │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                               │
│ [Close]                                                       │
└─────────────────────────────────────────────────────────────┘
```

### 2. Flow List View - Namespace Filtered (Realistic)

```
┌─────────────────────────────────────────────────────────────┐
│ Filters: [Namespace: ccs ▼] [Operation: GET ▼] [Refresh]  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ Showing flows involving services/pods in: ccs namespace     │
│ (12 pods active in ccs)                                      │
│                                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ GET /api/users                              [View Details]│ │
│ │ Trace: 7b5064... | Duration: 176ms | Status: ✅ Success  │ │
│ │ Target Namespace: ccs | Services: 3 (2 in ccs)          │ │
│ │                                                           │ │
│ │ Pod Flow (ccs namespace pods):                           │ │
│ │ qa-api-pod-abc123 → user-pod-def456 (ccs) ⭐              │ │
│ │                          ↓                                │ │
│ │                    db-pod-ghi789 (ccs) ⭐                 │ │
│ │                                                           │ │
│ │ qa-api-pod-abc123 → auth-pod-jkl012 (ccs) ⭐              │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ POST /api/users/create                    [View Details] │ │
│ │ Trace: 8c6175... | Duration: 234ms | Status: ✅ Success  │ │
│ │ Namespace: ccs | Services: 4 | Pods: 4                  │ │
│ │                                                           │ │
│ │ Pod Flow:                                                 │ │
│ │ api-pod-abc123 → user-pod-def456 → db-pod-ghi789         │ │
│ │ api-pod-abc123 → validation-pod-mno345                    │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 3. Key Features

#### A. Namespace Enforcement (Realistic)
- ✅ Show flows where **any service/pod in the flow is in the selected namespace**
- ✅ Filter flows list to show only flows involving services in selected namespace
- ✅ Show which services are in the selected namespace vs. other namespaces
- ✅ Highlight services/pods in the selected namespace with ⭐ badge
- ✅ Show API server namespace separately (it's the initiator, not the target)

#### B. Pod Name Display
- ✅ Show actual pod names from trace attributes (`k8s.pod.name`)
- ✅ Display pod names in service flow cards
- ✅ Show pod call chain visually
- ✅ Link pods to their services

#### C. Visual Pod Connections
- ✅ Tree/hierarchical view showing pod-to-pod calls
- ✅ Timeline view showing call sequence
- ✅ Color coding: Green (success), Yellow (degraded), Red (error)
- ✅ Connection lines showing call direction

#### D. Enhanced Flow Cards
- ✅ Show pod count per flow
- ✅ Show pod names in compact format
- ✅ Click pod name to see pod details
- ✅ Filter flows by pod name

## Implementation Plan

### Phase 1: Namespace Filtering
1. Ensure all API calls include namespace filter
2. Filter flows list by selected namespace
3. Validate flow namespace matches selected namespace
4. Show warning if mismatch

### Phase 2: Pod Name Extraction
1. Extract pod names from trace spans (`k8s.pod.name`)
2. Store pod names in flow graph nodes
3. Display pod names in UI
4. Handle "unknown" pod gracefully

### Phase 3: Visual Pod Connections
1. Create pod call chain visualization
2. Add tree/hierarchical view
3. Add timeline view
4. Add pod-to-service connections

### Phase 4: Enhanced UI
1. Update flow details modal with pod information
2. Add pod name filters
3. Add pod click handlers
4. Improve visual hierarchy

## Technical Changes

### Backend (`flowAnalyzer.js`)
- Ensure pod names are extracted from spans (`k8s.pod.name`)
- Store pod names in node.service.pod
- Store namespace for each service in node.service.namespace
- Filter flows in `getFlowGraphs()` to include flows where **any node has namespace === selectedNamespace**
- Don't exclude flows just because API server is in different namespace

### Frontend (`FlowVisualization.tsx`)
- Filter flows to show only those involving services in selected namespace
- Display pod names in flow cards
- Highlight services/pods in selected namespace
- Show API server namespace separately (it's the initiator)
- Create pod call chain visualization showing namespace context
- Update flow details modal to distinguish target namespace vs. API server namespace

## Realistic Implementation Notes

### Namespace Filtering Logic
- **Show a flow if**: At least one service/node in the flow has `namespace === selectedNamespace`
- **Don't exclude flows** just because the API server (qa-pr-dashboard-api) is in a different namespace
- **Highlight services** in the selected namespace vs. services in other namespaces
- **Show namespace context** for each service/pod in the flow

### Example Flow
- API server: `qa-pr-dashboard-api` (namespace: `qa-pr-dashboard` or `default`)
- Target services: `user-service`, `auth-service` (namespace: `ccs`)
- **Result**: Show this flow when "ccs" is selected, highlight the ccs services

## Questions for User
1. Should pod names be clickable to view pod details?
2. Preferred visualization: Tree view, Timeline, or both?
3. Should we show pod IP addresses or just names?
4. Should we show the API server namespace in the flow, or hide it since it's always the same?


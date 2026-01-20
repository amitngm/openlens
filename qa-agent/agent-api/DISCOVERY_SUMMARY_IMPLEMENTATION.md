# DISCOVERY_SUMMARY and WAIT_TEST_INTENT Implementation

## Overview

Implemented DISCOVERY_SUMMARY state to generate a summary from discovery results and transition to WAIT_TEST_INTENT with a test selection question.

## Implementation Details

### Flow

1. **DISCOVERY_RUN** completes → transitions to `DISCOVERY_SUMMARY`
2. **DISCOVERY_SUMMARY** performs:
   - Reads `discovery.json` from artifacts
   - Generates summary with counts
   - Saves to `artifacts/<run_id>/discovery_summary.json`
   - Stores in RunContext.discovery_summary
   - Captures screenshot
3. Transitions to `WAIT_TEST_INTENT` with select_one question

### Summary Generation

The summary includes:
- **pages_count**: Number of pages discovered
- **actions_count**: Total number of forms/actions found
- **forms_count**: Number of forms discovered
- **potential_crud_actions_count**: Forms/APIs with POST/PUT/PATCH/DELETE methods
- **network_errors_count**: Sum of 4xx and 5xx errors
- **slow_requests_count**: Number of requests >3 seconds

### Summary File

**Path**: `artifacts/<run_id>/discovery_summary.json`

**Schema**:
```json
{
  "pages_count": 15,
  "actions_count": 8,
  "forms_count": 8,
  "potential_crud_actions_count": 5,
  "network_errors_count": 2,
  "slow_requests_count": 3
}
```

### WAIT_TEST_INTENT Question

**Type**: `select_one`

**Text**: Includes counts in the question text:
```
"Discovery complete. Found {pages_count} pages, {forms_count} forms, {potential_crud_actions_count} CRUD actions. What should I test now?"
```

**Options**:
1. `smoke` - Smoke tests
2. `crud_sanity` - CRUD sanity tests
3. `module_based` - Module-based tests
4. `exploratory_15m` - 15-minute exploratory tests

**Screenshot**: Attached via `screenshot_path` (discovery_summary.png)

## Files Created/Modified

### New Files

1. **`app/services/discovery_summarizer.py`**
   - `DiscoverySummarizer` class
   - `generate_summary()` method
   - Reads discovery.json
   - Generates summary counts
   - Creates WAIT_TEST_INTENT question

### Modified Files

1. **`app/routers/interactive_qa.py`**
   - Updated all discovery completion points to call summarizer
   - Transitions: DISCOVERY_SUMMARY → WAIT_TEST_INTENT

2. **`app/services/__init__.py`**
   - Exports `DiscoverySummarizer` and `get_discovery_summarizer()`

## State Transitions

```
DISCOVERY_RUN → DISCOVERY_SUMMARY → WAIT_TEST_INTENT
```

## Example Flow

1. **DISCOVERY_RUN** completes
2. **DISCOVERY_SUMMARY**:
   - Reads discovery.json
   - Generates summary: {pages_count: 15, forms_count: 8, ...}
   - Saves to discovery_summary.json
   - Stores in RunContext
3. **WAIT_TEST_INTENT**:
   - Question created with counts
   - User selects test type

**Response:**
```json
{
  "run_id": "abc123",
  "state": "WAIT_TEST_INTENT",
  "question": {
    "id": "test_intent",
    "type": "select_one",
    "text": "Discovery complete. Found 15 pages, 8 forms, 5 CRUD actions. What should I test now?",
    "options": [
      {"id": "smoke", "label": "smoke"},
      {"id": "crud_sanity", "label": "crud_sanity"},
      {"id": "module_based", "label": "module_based"},
      {"id": "exploratory_15m", "label": "exploratory_15m"}
    ],
    "screenshot_path": "artifacts/abc123/discovery_summary.png"
  },
  "discovery_summary": {
    "pages_count": 15,
    "actions_count": 8,
    "forms_count": 8,
    "potential_crud_actions_count": 5,
    "network_errors_count": 2,
    "slow_requests_count": 3
  }
}
```

## Notes

- **Summary generation**: Reads from discovery.json (does not modify it)
- **CRUD detection**: Counts forms/APIs with POST/PUT/PATCH/DELETE methods
- **Network stats**: Aggregates 4xx and 5xx errors from network_stats
- **Screenshot**: Captured at discovery_summary.png
- **Question text**: Includes actual counts for user context
- **Storage**: Summary saved to both JSON file and RunContext

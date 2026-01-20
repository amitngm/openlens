# DISCOVERY_RUN State Implementation

## Overview

Implemented DISCOVERY_RUN state logic that reuses the active Playwright page/session to crawl navigation, capture URLs, identify forms/actions, and collect network stats.

## Implementation Details

### Flow

1. **CONTEXT_DETECT** completes → transitions to `DISCOVERY_RUN`
2. **DISCOVERY_RUN** executes:
   - Crawls navigation links
   - Visits pages and captures URLs
   - Identifies forms and actions
   - Collects network stats (4xx/5xx/slow requests)
   - Saves to `artifacts/<run_id>/discovery.json`
3. Transitions to `DISCOVERY_SUMMARY`

### Discovery Process

#### Step 1: Find Navigation Links
- Searches multiple navigation selectors:
  - `nav a`, `.sidebar a`, `.menu a`, `.nav-link`
  - `[role='navigation'] a`, `aside a`, `.menu-item a`
- Limits to 50 navigation items per selector
- Only includes same-domain URLs
- Deduplicates URLs

#### Step 2: Visit Pages
- Visits base URL first
- Visits up to 20 navigation pages (to prevent timeout)
- For each page:
  - Navigates and waits for network idle
  - Extracts page metadata (title, URL)
  - Finds forms and inputs
  - Captures screenshots for first 5 pages

#### Step 3: Analyze Forms
- Finds all `<form>` elements (limit 10 per page)
- Extracts form attributes (action, method)
- Extracts input fields (input, select, textarea)
- Filters out hidden/submit/button inputs
- Limits to 20 inputs per form

#### Step 4: Network Monitoring
- Captures API requests (URLs containing `/api/`, `/v1/`, `/v2/`, `/graphql`, `/rest/`, `/auth/`)
- Monitors responses for:
  - 4xx errors
  - 5xx errors
  - Slow requests (>3 seconds)
- Limits to 100 API endpoints and 20 slow requests

#### Step 5: Save Results
- Saves to `artifacts/<run_id>/discovery.json`
- Does NOT change discovery output schema
- Stores discovery summary in RunContext

### Discovery Output Schema

```json
{
  "run_id": "abc123",
  "base_url": "https://app.example.com",
  "status": "completed",
  "started_at": "2026-01-20T10:00:00Z",
  "completed_at": "2026-01-20T10:05:00Z",
  "pages": [
    {
      "url": "https://app.example.com/dashboard",
      "nav_text": "Dashboard",
      "title": "Dashboard",
      "forms": [
        {
          "action": "/api/submit",
          "method": "POST",
          "inputs": [
            {"type": "text", "name": "name", "id": "name"}
          ],
          "page_url": "https://app.example.com/dashboard"
        }
      ]
    }
  ],
  "navigation_items": [
    {
      "text": "Dashboard",
      "href": "/dashboard",
      "full_url": "https://app.example.com/dashboard"
    }
  ],
  "forms_found": [...],
  "api_endpoints": [
    {
      "url": "https://app.example.com/api/users",
      "method": "GET",
      "type": "xhr"
    }
  ],
  "network_stats": {
    "total_requests": 45,
    "errors_4xx": 2,
    "errors_5xx": 0,
    "slow_requests": [
      {
        "url": "https://app.example.com/api/slow",
        "duration_ms": 3500,
        "status": 200
      }
    ]
  },
  "summary": {
    "total_pages": 15,
    "pages_visited": 15,
    "forms_count": 8,
    "api_endpoints_count": 45
  }
}
```

## Files Created/Modified

### New Files

1. **`app/services/discovery_runner.py`**
   - `DiscoveryRunner` class
   - `run_discovery()` method
   - `_analyze_page()` method
   - Network monitoring
   - Form detection

### Modified Files

1. **`app/routers/interactive_qa.py`**
   - Updated `start_run()` to execute discovery when transitioning to `DISCOVERY_RUN`
   - Updated `answer_question()` to execute discovery after context selection
   - Updated `answer_question()` to execute discovery when user confirms logged in

2. **`app/services/__init__.py`**
   - Exports `DiscoveryRunner` and `get_discovery_runner()`

## Integration Points

### 1. From CONTEXT_DETECT (Single Context)
- Context detected → `DISCOVERY_RUN` → Discovery executes → `DISCOVERY_SUMMARY`

### 2. From WAIT_CONTEXT_INPUT
- User selects context → `DISCOVERY_RUN` → Discovery executes → `DISCOVERY_SUMMARY`

### 3. From WAIT_LOGIN_CONFIRM (Yes)
- User confirms logged in → `CONTEXT_DETECT` → `DISCOVERY_RUN` → Discovery executes → `DISCOVERY_SUMMARY`

## State Transitions

```
CONTEXT_DETECT (single) → DISCOVERY_RUN → DISCOVERY_SUMMARY
WAIT_CONTEXT_INPUT (answer) → DISCOVERY_RUN → DISCOVERY_SUMMARY
```

## Features

- **Reuses active page**: Uses existing Playwright page/session (no new browser)
- **Navigation crawling**: Finds and visits navigation links
- **URL capture**: Records all discovered URLs
- **Form identification**: Detects forms and input fields
- **Network stats**: Monitors 4xx/5xx errors and slow requests
- **Schema preservation**: Does NOT change discovery output schema
- **Artifact storage**: Saves to `artifacts/<run_id>/discovery.json`
- **Summary storage**: Stores summary in RunContext.discovery_summary

## Notes

- **Page limits**: Visits up to 20 pages to prevent timeout
- **Form limits**: Analyzes up to 10 forms per page, 20 inputs per form
- **API limits**: Captures up to 100 API endpoints
- **Screenshots**: Captures screenshots for first 5 pages
- **Error handling**: On failure, saves error state to discovery.json
- **Network monitoring**: Uses Playwright request/response listeners

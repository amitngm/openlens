# REPORT_GENERATE Implementation

## Overview

Implemented REPORT_GENERATE state to generate HTML reports from report.json and discovery_summary.json, with an endpoint to retrieve the report.

## Implementation Details

### Flow

1. **TEST_EXECUTE** completes → transitions to `REPORT_GENERATE`
2. **REPORT_GENERATE** performs:
   - Checks if HTML report already exists → Skip if exists
   - Loads report.json and discovery_summary.json
   - Generates HTML report with Bootstrap styling
   - Includes links to screenshots/videos/HAR using relative paths
   - Saves to `artifacts/<run_id>/report.html`
3. Transitions to `DONE`

### HTML Report Features

#### Sections

1. **Header**
   - Run ID
   - Test Intent
   - Start/End times
   - Duration

2. **Statistics Cards**
   - Total Tests
   - Passed
   - Failed
   - Skipped

3. **Discovery Summary** (if available)
   - Pages count
   - Forms count
   - CRUD actions count
   - Network errors count
   - Slow requests count

4. **Test Results**
   - Test name and ID
   - Status badge
   - Duration
   - Error messages (if any)
   - Evidence links (screenshots, videos, HAR)
   - Step-by-step breakdown

#### Evidence Links

- **Screenshots**: Displayed as thumbnails (max-width: 200px)
- **Videos**: Link with video icon
- **HAR/Trace**: Link with document icon
- **Other files**: Link with attachment icon

All links use relative paths from the artifacts directory.

### Endpoint

**GET `/runs/{run_id}/report`**

- Returns HTML report if available
- If report doesn't exist, attempts to generate it
- Returns 404 if generation fails

**Response**: HTML content (Content-Type: text/html)

### State Transitions

```
TEST_EXECUTE → REPORT_GENERATE → DONE
```

## Files Created/Modified

### New Files

1. **`app/services/report_generator.py`**
   - `ReportGenerator` class
   - `generate_html_report()` method
   - `_generate_html()` method
   - HTML template with Bootstrap styling

### Modified Files

1. **`app/routers/interactive_qa.py`**
   - Added `REPORT_GENERATE` handler in `answer_question()`
   - Added `GET /runs/{run_id}/report` endpoint
   - Auto-generates report after test execution

2. **`app/services/__init__.py`**
   - Exports `ReportGenerator` and `get_report_generator()`

## Example Usage

### Generate Report

**Request:**
```bash
POST /runs/{run_id}/answer
{
  "question_id": "report_generate",
  "answer": "yes"
}
```

**Response:**
```json
{
  "run_id": "abc123",
  "state": "DONE",
  "message": "HTML report generated: artifacts/abc123/report.html"
}
```

### Get Report

**Request:**
```bash
GET /runs/{run_id}/report
```

**Response:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Test Report - abc123</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    ...
</head>
<body>
    ...
</body>
</html>
```

## HTML Report Structure

```html
<!DOCTYPE html>
<html>
<head>
    <title>Test Report - {run_id}</title>
    <link href="bootstrap.css" rel="stylesheet">
</head>
<body>
    <div class="header">
        <h1>Test Execution Report</h1>
        <p>Run ID: {run_id} | Test Intent: {test_intent}</p>
        <p>Started: {started_at} | Completed: {completed_at} | Duration: {duration}</p>
    </div>
    
    <div class="stats">
        <div class="stat-card">
            <div class="stat-value">{total_tests}</div>
            <div class="stat-label">Total Tests</div>
        </div>
        ...
    </div>
    
    <div class="discovery-summary">
        ...
    </div>
    
    <div class="test-results">
        {test_results_html}
    </div>
</body>
</html>
```

## Notes

- **Skip if exists**: If HTML report already exists, skips generation
- **Relative paths**: All artifact links use relative paths from artifacts directory
- **Bootstrap styling**: Uses Bootstrap 5.1.3 CDN for modern, responsive design
- **Schema preservation**: Does NOT change JSON schemas (read-only view)
- **Auto-generation**: Report is automatically generated after test execution
- **Error handling**: On failure, returns error message but doesn't block state transition

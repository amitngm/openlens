# QA Automation API Endpoints

This document describes the API endpoints needed for the QA Automation module in FlowLens.

## Base URL
All endpoints are prefixed with `/api/qa`

## Endpoints

### 1. Get Test Runs
**GET** `/api/qa/test-runs`

Retrieve a list of test runs with optional filtering.

**Query Parameters:**
- `status` (optional): Filter by status (`running`, `passed`, `failed`, `skipped`, `cancelled`)
- `framework` (optional): Filter by framework (`playwright`, `selenium`, `cypress`, `jest`)
- `environment` (optional): Filter by environment (`staging`, `production`, `development`)
- `limit` (optional): Number of results to return (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Response:**
```json
{
  "success": true,
  "testRuns": [
    {
      "id": "run-123",
      "name": "VM Creation Tests",
      "status": "passed",
      "totalTests": 10,
      "passedTests": 9,
      "failedTests": 1,
      "skippedTests": 0,
      "duration": 120,
      "startedAt": "2024-01-15T10:00:00Z",
      "completedAt": "2024-01-15T10:02:00Z",
      "triggeredBy": "user@example.com",
      "environment": "staging",
      "framework": "playwright",
      "linkedPR": "https://github.com/org/repo/pull/123",
      "linkedJira": "PROJ-456",
      "reportUrl": "/api/qa/test-runs/run-123/report",
      "videoUrl": "/api/qa/test-runs/run-123/video",
      "traceUrl": "/api/qa/test-runs/run-123/trace"
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

### 2. Trigger Test Run
**POST** `/api/qa/test-runs`

Trigger a new test run.

**Request Body:**
```json
{
  "testSuite": "tests/vm.spec.ts",
  "environment": "staging",
  "framework": "playwright",
  "linkedPR": "https://github.com/org/repo/pull/123",
  "linkedJira": "PROJ-456"
}
```

**Response:**
```json
{
  "success": true,
  "testRun": {
    "id": "run-123",
    "name": "VM Creation Tests",
    "status": "running",
    "startedAt": "2024-01-15T10:00:00Z",
    "triggeredBy": "user@example.com",
    "environment": "staging",
    "framework": "playwright"
  }
}
```

### 3. Get Test Run Details
**GET** `/api/qa/test-runs/:runId`

Get detailed information about a specific test run.

**Response:**
```json
{
  "success": true,
  "testRun": {
    "id": "run-123",
    "name": "VM Creation Tests",
    "status": "passed",
    "totalTests": 10,
    "passedTests": 9,
    "failedTests": 1,
    "skippedTests": 0,
    "duration": 120,
    "startedAt": "2024-01-15T10:00:00Z",
    "completedAt": "2024-01-15T10:02:00Z",
    "triggeredBy": "user@example.com",
    "environment": "staging",
    "framework": "playwright",
    "testResults": [
      {
        "testName": "Create VM with basic config",
        "status": "passed",
        "duration": 12,
        "error": null
      },
      {
        "testName": "Create VM with advanced config",
        "status": "failed",
        "duration": 8,
        "error": "Timeout waiting for VM to be ready"
      }
    ],
    "reportUrl": "/api/qa/test-runs/run-123/report",
    "videoUrl": "/api/qa/test-runs/run-123/video",
    "traceUrl": "/api/qa/test-runs/run-123/trace"
  }
}
```

### 4. Cancel Test Run
**POST** `/api/qa/test-runs/:runId/cancel`

Cancel a running test execution.

**Response:**
```json
{
  "success": true,
  "message": "Test run cancelled successfully"
}
```

### 5. Get Test Statistics
**GET** `/api/qa/stats`

Get aggregated statistics about test runs.

**Query Parameters:**
- `timeframe` (optional): Time range (`7d`, `30d`, `90d`, `all`) - default: `30d`

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalRuns": 150,
    "passedRuns": 120,
    "failedRuns": 25,
    "skippedRuns": 5,
    "averageDuration": 95,
    "passRate": 80.0,
    "totalTests": 1500,
    "flakyTests": 12,
    "lastRunAt": "2024-01-15T10:00:00Z"
  }
}
```

### 6. Get Test Cases
**GET** `/api/qa/test-cases`

Get list of test cases.

**Query Parameters:**
- `suite` (optional): Filter by test suite
- `framework` (optional): Filter by framework
- `status` (optional): Filter by status (`active`, `inactive`, `deprecated`)

**Response:**
```json
{
  "success": true,
  "testCases": [
    {
      "id": "test-1",
      "name": "Create VM with basic config",
      "description": "Tests VM creation with minimal configuration",
      "suite": "tests/vm.spec.ts",
      "framework": "playwright",
      "tags": ["vm", "creation", "basic"],
      "status": "active",
      "lastRun": "2024-01-15T10:00:00Z",
      "lastStatus": "passed"
    }
  ]
}
```

### 7. Link Test Run to PR/Jira
**POST** `/api/qa/test-runs/:runId/link`

Link a test run to a PR or Jira issue.

**Request Body:**
```json
{
  "linkedPR": "https://github.com/org/repo/pull/123",
  "linkedJira": "PROJ-456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Test run linked successfully"
}
```

### 8. Get Test Report
**GET** `/api/qa/test-runs/:runId/report`

Get the HTML report for a test run (serves the Playwright HTML report).

**Response:** HTML content

### 9. Get Test Video
**GET** `/api/qa/test-runs/:runId/video`

Get the video recording for a test run.

**Response:** Video file (MP4)

### 10. Get Test Trace
**GET** `/api/qa/test-runs/:runId/trace`

Get the trace file for a test run (Playwright trace).

**Response:** Trace file (ZIP)

## Implementation Notes

### Test Run Execution
The API server should:
1. Accept test run requests
2. Execute tests using the specified framework (Playwright, Selenium, etc.)
3. Store test results in MongoDB
4. Generate reports (HTML, Allure, etc.)
5. Store artifacts (videos, screenshots, traces)
6. Update test run status in real-time

### Integration with Playwright
For Playwright tests:
- Execute: `npx playwright test <test-suite>`
- Reports are generated in `playwright-report/`
- Videos are in `test-results/`
- Traces are in `test-results/`

### Database Schema

**test_runs collection:**
```javascript
{
  _id: ObjectId,
  id: String,
  name: String,
  status: String,
  totalTests: Number,
  passedTests: Number,
  failedTests: Number,
  skippedTests: Number,
  duration: Number,
  startedAt: Date,
  completedAt: Date,
  triggeredBy: String,
  environment: String,
  framework: String,
  testSuite: String,
  linkedPR: String,
  linkedJira: String,
  reportUrl: String,
  videoUrl: String,
  traceUrl: String,
  testResults: Array,
  createdAt: Date,
  updatedAt: Date
}
```

**test_cases collection:**
```javascript
{
  _id: ObjectId,
  id: String,
  name: String,
  description: String,
  suite: String,
  framework: String,
  tags: Array,
  status: String,
  lastRun: Date,
  lastStatus: String,
  createdAt: Date,
  updatedAt: Date
}
```

## Error Responses

All endpoints return errors in the following format:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

Common error codes:
- `TEST_RUN_NOT_FOUND`: Test run with given ID not found
- `TEST_RUN_ALREADY_RUNNING`: Cannot trigger new run while another is running
- `INVALID_TEST_SUITE`: Test suite path is invalid
- `FRAMEWORK_NOT_SUPPORTED`: Framework is not supported
- `EXECUTION_FAILED`: Test execution failed




# TEST_EXECUTE Implementation

## Overview

Implemented TEST_EXECUTE state to execute generated tests using existing executor patterns, with safety checks for destructive operations.

## Implementation Details

### Flow

1. **TEST_PLAN_BUILD** completes → transitions to `TEST_EXECUTE`
2. **TEST_EXECUTE** performs:
   - Checks for unsafe DELETE operations
   - If unsafe deletes found → `WAIT_TEST_INTENT` (ask for confirmation)
   - If safe → Execute all tests
   - Captures screenshots on failure
   - Captures video/HAR if supported
   - Saves report.json
3. Transitions to `REPORT_GENERATE` (or `DONE` if HTML already exists)

### Safety Checks

#### Unsafe DELETE Detection

DELETE operations are considered unsafe unless:
1. Test is tagged `SAFE_DELETE`
2. Resource was created by this run (run_id prefix check)

If unsafe deletes are detected:
- Pause execution
- Ask user for confirmation via `WAIT_TEST_INTENT` question
- If confirmed → Execute all tests (including deletes)
- If declined → Skip unsafe DELETE operations

### Test Execution

#### Supported Actions

- **navigate**: Navigate to URL
- **fill_form**: Fill form fields
- **submit**: Submit form
- **click**: Click element
- **wait**: Wait for timeout
- **verify**: Verify condition (no_errors, success_or_redirect)
- **request**: API request (simplified)
- **assert_status**: Assert HTTP status

#### Evidence Capture

- **Screenshots**: Always captured on failure
  - Path: `artifacts/<run_id>/test_{index:03d}_step_{step:03d}_failure.png`
- **Video**: Captured if supported (Playwright video recording)
- **HAR/Trace**: Captured if supported (Playwright tracing)
  - Path: `artifacts/<run_id>/trace.zip`

### Report Schema

**Path**: `artifacts/<run_id>/report.json`

```json
{
  "run_id": "abc123",
  "test_intent": "smoke",
  "status": "completed",
  "started_at": "2026-01-20T10:00:00Z",
  "completed_at": "2026-01-20T10:05:00Z",
  "total_tests": 8,
  "passed": 7,
  "failed": 1,
  "skipped": 0,
  "tests": [
    {
      "test_id": "SMOKE-001",
      "name": "Load Dashboard",
      "status": "passed",
      "duration_ms": 1500,
      "steps": [
        {
          "action": "navigate",
          "status": "passed",
          "duration_ms": 1200,
          "details": {...}
        }
      ],
      "evidence": [],
      "error": null
    },
    {
      "test_id": "SMOKE-002",
      "name": "Load Users Page",
      "status": "failed",
      "duration_ms": 2000,
      "steps": [...],
      "evidence": [
        "test_001_step_002_failure.png"
      ],
      "error": "Navigation timeout"
    }
  ]
}
```

## Files Created/Modified

### New Files

1. **`app/services/test_executor.py`**
   - `TestExecutor` class
   - `execute_tests()` method
   - `_check_unsafe_deletes()` method
   - `_execute_single_test()` method
   - `_execute_step()` method
   - `_capture_screenshot()` method
   - `_redact_secrets()` method

### Modified Files

1. **`app/routers/interactive_qa.py`**
   - Added test execution after test plan build
   - Added `TEST_EXECUTE` handler for unsafe delete confirmation
   - Integrates with test executor

2. **`app/services/__init__.py`**
   - Exports `TestExecutor` and `get_test_executor()`

## State Transitions

```
TEST_PLAN_BUILD → TEST_EXECUTE → REPORT_GENERATE (or DONE)
TEST_PLAN_BUILD → TEST_EXECUTE → WAIT_TEST_INTENT → TEST_EXECUTE → REPORT_GENERATE
```

## Example Flows

### Flow 1: Safe Tests (No Unsafe Deletes)

1. **TEST_PLAN_BUILD** completes
2. **TEST_EXECUTE**:
   - No unsafe deletes detected
   - Executes all tests
   - Captures screenshots on failures
   - Saves report.json
3. **REPORT_GENERATE**

**Response:**
```json
{
  "run_id": "abc123",
  "state": "REPORT_GENERATE",
  "message": "Test execution completed: 7 passed, 1 failed"
}
```

### Flow 2: Unsafe Deletes Detected

1. **TEST_PLAN_BUILD** completes
2. **TEST_EXECUTE**:
   - Unsafe deletes detected
   - Transitions to `WAIT_TEST_INTENT`
3. **WAIT_TEST_INTENT**:
   - User confirms or declines
4. **TEST_EXECUTE**:
   - If confirmed → Execute all tests
   - If declined → Skip unsafe deletes
5. **REPORT_GENERATE**

**Response (after detection):**
```json
{
  "run_id": "abc123",
  "state": "WAIT_TEST_INTENT",
  "question": {
    "id": "confirm_unsafe_deletes",
    "type": "confirm",
    "text": "Found 2 potentially unsafe DELETE operations. These will only run if tagged SAFE_DELETE and resource created by this run. Continue?"
  }
}
```

## Notes

- **Safety first**: DELETE operations require explicit confirmation unless tagged SAFE_DELETE
- **Evidence capture**: Screenshots always captured on failure
- **Video/HAR**: Captured if Playwright supports it
- **Secret redaction**: Sensitive data redacted in logs and reports
- **Report schema**: Uses existing report.json schema
- **Error handling**: On failure, creates error report and transitions to FAILED state
- **HTML check**: If HTML report exists, transitions to DONE instead of REPORT_GENERATE

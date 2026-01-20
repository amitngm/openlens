# Testing Guide

## Overview

Two test scripts are provided for the Interactive QA Buddy:

1. **test_api_contract.py** - Unit tests for API contract validation
2. **test_interactive_flow.py** - Integration test for interactive flow

## Quick Start

### Run Contract Tests (No Dependencies)

```bash
python3 test_api_contract.py
```

This validates API schemas and state transitions without requiring a server.

### Run Mock Flow Demo (No Dependencies)

```bash
python3 test_interactive_flow.py --mock
```

This demonstrates the complete state transition flow without making API calls.

### Run Real API Test (Requires Server)

```bash
# Terminal 1: Start API server
cd qa-agent/agent-api
uvicorn app.main:app --reload

# Terminal 2: Run test
python3 test_interactive_flow.py --url https://example.com
```

## Test Scripts

### test_api_contract.py

**Purpose**: Validates API request/response schemas and state transitions.

**Tests**:
- StartRunRequest/Response schemas
- AnswerRequest/Response schemas
- StatusResponse schema
- State transitions (19 states)
- Question types (text, select_one, confirm)
- Interactive flow scenarios

**Usage**:
```bash
python3 test_api_contract.py
```

**Output**:
```
============================================================
Interactive QA Buddy API Contract Tests
============================================================

✓ StartRunRequest schema valid
✓ StartRunResponse schema valid
✓ AnswerRequest schema valid
✓ AnswerResponse schema valid
✓ StatusResponse schema valid
✓ State transitions valid (19 states)
✓ Question types valid
✓ Interactive flow scenarios valid

============================================================
✓ All contract tests passed!
============================================================
```

### test_interactive_flow.py

**Purpose**: Tests the complete interactive flow with real or mocked API calls.

**Features**:
- Demonstrates WAIT_LOGIN_INPUT, WAIT_CONTEXT_INPUT, WAIT_TEST_INTENT
- Prints status transitions
- Auto-handles common question types
- Supports mock mode (no API required)

**Usage**:

**Mock Mode** (no API required):
```bash
python3 test_interactive_flow.py --mock
```

**Real API Mode** (requires server):
```bash
python3 test_interactive_flow.py --url https://example.com --api-url http://localhost:8000
```

**Options**:
- `--url <url>`: Target URL to test (default: https://example.com)
- `--api-url <url>`: API base URL (default: http://localhost:8000)
- `--mock`: Run mock flow instead of real API calls
- `--headless`: Run browser in headless mode (default: True)

**Mock Output**:
```
============================================================
Testing with mocked state transitions
============================================================

State Transition Flow:

 1. START
 2. OPEN_URL
 3. SESSION_CHECK
 4. WAIT_LOGIN_INPUT
     └─ Question: Please provide login credentials...
 5. LOGIN_ATTEMPT
 6. POST_LOGIN_VALIDATE
 7. CONTEXT_DETECT
 8. WAIT_CONTEXT_INPUT
     └─ Question: Multiple contexts detected...
        Options: ['Tenant A', 'Tenant B']
 9. DISCOVERY_RUN
10. DISCOVERY_SUMMARY
11. WAIT_TEST_INTENT
     └─ Question: Discovery complete...
        Options: ['smoke', 'crud_sanity', 'module_based', 'exploratory_15m']
12. TEST_PLAN_BUILD
13. TEST_EXECUTE
14. REPORT_GENERATE
15. DONE
```

## Interactive States Demonstrated

### 1. WAIT_LOGIN_INPUT
- **Trigger**: When login credentials are needed
- **Question Type**: `text`
- **Auto-handled**: Script provides `username,password` format
- **Example**: `testuser,testpass123`

### 2. WAIT_CONTEXT_INPUT
- **Trigger**: When multiple contexts (tenant/project/cell) detected
- **Question Type**: `select_one`
- **Auto-handled**: Script selects first available option
- **Example**: Selects "Tenant A" from options

### 3. WAIT_TEST_INTENT
- **Trigger**: After discovery completes
- **Question Type**: `select_one`
- **Auto-handled**: Script selects "smoke" if available, otherwise first option
- **Options**: smoke, crud_sanity, module_based, exploratory_15m

## State Transition Flow

```
START → OPEN_URL → SESSION_CHECK → WAIT_LOGIN_INPUT → 
LOGIN_ATTEMPT → POST_LOGIN_VALIDATE → CONTEXT_DETECT → 
WAIT_CONTEXT_INPUT → DISCOVERY_RUN → DISCOVERY_SUMMARY → 
WAIT_TEST_INTENT → TEST_PLAN_BUILD → TEST_EXECUTE → 
REPORT_GENERATE → DONE
```

## Dependencies

### Contract Tests
- No dependencies (pure Python)

### Flow Tests
- **Mock mode**: No dependencies
- **Real API mode**: `httpx` (install with `pip install httpx`)

## Notes

- Contract tests can run without any server or dependencies
- Mock flow demonstrates the complete state machine without API calls
- Real API tests require the API server to be running
- Script automatically handles common question types
- For custom questions, script will print and pause for manual handling

## Troubleshooting

### "httpx not installed"
- For mock mode: Not needed, use `--mock` flag
- For real API: Install with `pip install httpx`

### "Connection refused"
- Ensure API server is running: `uvicorn app.main:app --reload`
- Check API URL: `--api-url http://localhost:8000`

### "Run not found"
- Ensure run was started successfully
- Check run_id is correct

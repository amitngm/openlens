# Interactive QA Flow Test Script

## Overview

A developer test script that demonstrates the Interactive QA Buddy flow, including state transitions and interactive question handling.

## Features

- Tests the complete interactive flow
- Demonstrates WAIT_LOGIN_INPUT, WAIT_CONTEXT_INPUT, WAIT_TEST_INTENT states
- Prints status transitions
- Supports both real API calls and mock demonstrations

## Usage

### Mock Flow (No API Required)

```bash
python test_interactive_flow.py --mock
```

This demonstrates the state transitions without making API calls.

### Real API Test

```bash
# Start the API server first
cd qa-agent/agent-api
uvicorn app.main:app --reload

# In another terminal, run the test
python test_interactive_flow.py --url https://example.com
```

### Options

- `--url <url>`: Target URL to test (default: https://example.com)
- `--api-url <url>`: API base URL (default: http://localhost:8000)
- `--mock`: Run mock flow instead of real API calls
- `--headless`: Run browser in headless mode (default: True)

## Example Output

### Mock Flow

```
============================================================
Testing with mocked state transitions
============================================================

State Transition Flow:

 1. START
 2. OPEN_URL
 3. SESSION_CHECK
 4. WAIT_LOGIN_INPUT
     └─ Question: Please provide login credentials. Format: 'username,password'...
 5. LOGIN_ATTEMPT
 6. POST_LOGIN_VALIDATE
 7. CONTEXT_DETECT
 8. WAIT_CONTEXT_INPUT
     └─ Question: Multiple contexts detected. Which tenant/project/cell should I test?...
        Options: ['Tenant A', 'Tenant B']
 9. DISCOVERY_RUN
10. DISCOVERY_SUMMARY
11. WAIT_TEST_INTENT
     └─ Question: Discovery complete. Found 15 pages, 8 forms, 5 CRUD actions. What should I test now?...
        Options: ['smoke', 'crud_sanity', 'module_based', 'exploratory_15m']
12. TEST_PLAN_BUILD
13. TEST_EXECUTE
14. REPORT_GENERATE
15. DONE

✓ Mock flow demonstration complete

Key Interactive States:
  - WAIT_LOGIN_INPUT: User provides credentials
  - WAIT_CONTEXT_INPUT: User selects tenant/project/cell
  - WAIT_TEST_INTENT: User selects test type
```

### Real API Flow

```
============================================================
Starting run for URL: https://example.com
============================================================

✓ Run started: abc123def456
  State: WAIT_LOGIN_INPUT
  Question: Please provide login credentials. Format: 'username,password' or JSON {"username":"...","password":"..."}.
  Question type: text

============================================================
Current Status
============================================================
Run ID: abc123def456
State: WAIT_LOGIN_INPUT
Progress: 25%

Pending Question:
  ID: login_creds
  Type: text
  Text: Please provide login credentials. Format: 'username,password' or JSON {"username":"...","password":"..."}.
============================================================

→ Detected WAIT_LOGIN_INPUT
  Providing credentials: testuser,testpass123

============================================================
Answering question: testuser,testpass123
============================================================

✓ Answer submitted
  New state: LOGIN_ATTEMPT
  Message: Credentials provided, attempting login...

[... continues through states ...]
```

## Interactive States Demonstrated

### 1. WAIT_LOGIN_INPUT
- Triggered when login credentials are needed
- User provides: `username,password` or JSON
- Auto-detected and handled by script

### 2. WAIT_CONTEXT_INPUT
- Triggered when multiple contexts (tenant/project/cell) are detected
- User selects from options
- Auto-selects first option in test script

### 3. WAIT_TEST_INTENT
- Triggered after discovery completes
- User selects test type: smoke, crud_sanity, module_based, exploratory_15m
- Auto-selects "smoke" if available

## State Transitions

The script demonstrates the complete flow:

```
START → OPEN_URL → SESSION_CHECK → WAIT_LOGIN_INPUT → 
LOGIN_ATTEMPT → POST_LOGIN_VALIDATE → CONTEXT_DETECT → 
WAIT_CONTEXT_INPUT → DISCOVERY_RUN → DISCOVERY_SUMMARY → 
WAIT_TEST_INTENT → TEST_PLAN_BUILD → TEST_EXECUTE → 
REPORT_GENERATE → DONE
```

## Requirements

```bash
pip install httpx
```

## Notes

- The script automatically handles common question types
- For custom questions, the script will print the question and pause
- Use `--mock` to see the flow without requiring a running API server
- Real API tests require the API server to be running and a valid target URL

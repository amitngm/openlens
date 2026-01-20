# Interactive QA Buddy API - Level 2

## Overview

API endpoints for Interactive QA Buddy with state machine and pause/resume capability.

## Endpoints

### 1. POST /runs/start

Start a new interactive QA run.

**Request Body:**
```json
{
  "base_url": "https://app.example.com",
  "env": "staging",
  "headless": true,
  "auth": {
    "type": "keycloak",
    "username": "user@example.com"
  }
}
```

**Response:**
```json
{
  "run_id": "abc123def456",
  "state": "WAIT_LOGIN_INPUT",
  "question": {
    "id": "login_creds",
    "type": "text",
    "text": "Please provide login credentials (username,password or JSON)"
  }
}
```

**OpenAPI Example:**
- **base_url**: `"https://app.example.com"` (required)
- **env**: `"staging"` (optional, default: "staging")
- **headless**: `true` (optional, default: true)
- **auth**: Optional auth config with type, username, password

### 2. GET /runs/{run_id}/status

Get current status of a run.

**Response:**
```json
{
  "run_id": "abc123def456",
  "state": "WAIT_LOGIN_INPUT",
  "question": {
    "id": "login_creds",
    "type": "text",
    "text": "Please provide login credentials"
  },
  "progress": 15,
  "last_step": "OPEN_URL",
  "current_url": "https://app.example.com/login"
}
```

**OpenAPI Example:**
- Returns current state, question (if waiting), progress percentage, last step, and current URL

### 3. POST /runs/{run_id}/answer

Answer a question for an interactive run.

**Request Body:**
```json
{
  "question_id": "login_creds",
  "answer": "user@example.com,password123"
}
```

**For select_one questions:**
```json
{
  "question_id": "context_select",
  "answer": "tenant_a",
  "selector": "select[name='tenant']",
  "option_text": "Tenant A"
}
```

**For confirm questions:**
```json
{
  "question_id": "login_confirm",
  "answer": "yes"
}
```

**Response:**
```json
{
  "run_id": "abc123def456",
  "state": "LOGIN_ATTEMPT",
  "question": null,
  "message": "Credentials accepted, attempting login..."
}
```

**OpenAPI Examples:**
- **question_id**: ID of the question being answered (required)
- **answer**: Answer value - text, option ID, or yes/no (required)
- **selector**: CSS selector for UI interaction (optional, for WAIT_CONTEXT_INPUT)
- **option_text**: Visible text for option selection (optional)

## Question Schema

Questions follow this schema:

```json
{
  "id": "question_id",
  "type": "select_one|confirm|text",
  "text": "Question text/prompt",
  "options": [
    {
      "id": "option_id",
      "label": "Display Label"
    }
  ],
  "screenshot_path": "screenshots/page.png"
}
```

**Question Types:**
- **text**: Free-form text input (e.g., credentials)
- **select_one**: Select from options (requires `options` array)
- **confirm**: Yes/no confirmation

## State Machine

Run states progress through:
1. START → OPEN_URL
2. OPEN_URL → SESSION_CHECK
3. SESSION_CHECK → LOGIN_DETECT or POST_LOGIN_VALIDATE
4. LOGIN_DETECT → WAIT_LOGIN_INPUT or WAIT_LOGIN_CONFIRM
5. WAIT_LOGIN_INPUT → LOGIN_ATTEMPT (after answer)
6. WAIT_LOGIN_CONFIRM → CONTEXT_DETECT (yes) or WAIT_LOGIN_INPUT (no)
7. LOGIN_ATTEMPT → POST_LOGIN_VALIDATE
8. POST_LOGIN_VALIDATE → CONTEXT_DETECT
9. CONTEXT_DETECT → WAIT_CONTEXT_INPUT
10. WAIT_CONTEXT_INPUT → DISCOVERY_RUN (after answer)
11. DISCOVERY_RUN → DISCOVERY_SUMMARY
12. DISCOVERY_SUMMARY → WAIT_TEST_INTENT
13. WAIT_TEST_INTENT → TEST_PLAN_BUILD
14. TEST_PLAN_BUILD → TEST_EXECUTE
15. TEST_EXECUTE → REPORT_GENERATE
16. REPORT_GENERATE → DONE

## Files Created

- `app/models/run_state.py` - RunState enum
- `app/models/run_context.py` - RunContext, Question, AuthConfig, AnswerRequest models
- `app/services/run_store.py` - RunStore service for persistence
- `app/routers/interactive_qa.py` - API endpoints
- `app/main.py` - FastAPI app with router included

## Notes

- Runs are stored in-memory and persisted to `{base_path}/{run_id}/run_context.json`
- Discovery and test execution are not implemented yet - only run creation and state management
- All endpoints include OpenAPI examples in their schema
- Question schema supports screenshots for visual context

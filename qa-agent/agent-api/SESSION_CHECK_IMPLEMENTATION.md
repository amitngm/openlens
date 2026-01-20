# SESSION_CHECK State Implementation

## Overview

Implemented SESSION_CHECK state logic that determines if a user is already logged in or needs authentication after opening the base URL.

## Implementation Details

### Flow

1. **POST /runs/start** creates run and transitions: `START → OPEN_URL → SESSION_CHECK`
2. **SESSION_CHECK** opens base URL and performs heuristics
3. **State transitions** based on detection:
   - Keycloak detected → `LOGIN_DETECT`
   - Logged-in indicators found → `CONTEXT_DETECT`
   - Ambiguous → `WAIT_LOGIN_CONFIRM` (with confirm question)

### Heuristics

#### A) Keycloak Detection
- **URL patterns**: Contains `/realms/` OR `openid-connect`
- **Form selectors**: 
  - `#username`, `#password`
  - `input[name='username']`, `input[name='password']`
  - `#kc-login`, `form#kc-form-login`
- **Result**: Login required → `LOGIN_DETECT`

#### B) Logged-In Detection
- **Indicators**:
  - Navigation elements: `nav`, `.sidebar`, `.menu`
  - User elements: `.user-menu`, `.profile`, `.avatar`
  - Logout buttons: `button:has-text('Logout')`, `a:has-text('Logout')`
  - Context selectors: `.tenant-selector`, `.context-selector`
  - Data attributes: `[data-logged-in]`
- **Result**: Session valid → `CONTEXT_DETECT`

#### C) Ambiguous Case
- **Condition**: Not Keycloak AND no login form AND no logged-in indicators
- **Action**: Create confirm question with screenshot
- **Question**:
  ```json
  {
    "id": "login_confirm",
    "type": "confirm",
    "text": "Login required? I am not sure. Are you already logged in?",
    "screenshot_path": "artifacts/{run_id}/session_check.png"
  }
  ```
- **Result**: `WAIT_LOGIN_CONFIRM`

### Screenshot Capture

- **Path**: `{artifacts_path}/session_check.png`
- **Attached to question**: If ambiguous, screenshot path is included in question
- **Always captured**: Screenshot taken regardless of detection result

## Files Created/Modified

### New Files

1. **`app/services/browser_manager.py`**
   - Manages Playwright browser contexts per run
   - Methods: `get_or_create_context()`, `get_page()`, `close_context()`

2. **`app/services/session_checker.py`**
   - Implements SESSION_CHECK logic
   - Methods: `check_session()`, `_detect_keycloak()`, `_has_login_form()`, `_has_logged_in_indicators()`

### Modified Files

1. **`app/routers/interactive_qa.py`**
   - Updated `start_run()` to perform SESSION_CHECK
   - Updated `answer_question()` to handle `WAIT_LOGIN_CONFIRM` correctly

2. **`app/services/__init__.py`**
   - Exports new services

## State Transitions

```
START → OPEN_URL → SESSION_CHECK → [LOGIN_DETECT | CONTEXT_DETECT | WAIT_LOGIN_CONFIRM]
```

### WAIT_LOGIN_CONFIRM Handling

When user answers the confirm question:

- **"yes"** (already logged in) → `CONTEXT_DETECT`
- **"no"** (needs login) → `LOGIN_DETECT` → `WAIT_LOGIN_INPUT` (if no credentials) OR `LOGIN_ATTEMPT` (if credentials available)

## Example Flow

1. **Start run**:
   ```bash
   POST /runs/start
   {
     "base_url": "https://app.example.com",
     "env": "staging"
   }
   ```

2. **Response** (if ambiguous):
   ```json
   {
     "run_id": "abc123",
     "state": "WAIT_LOGIN_CONFIRM",
     "question": {
       "id": "login_confirm",
       "type": "confirm",
       "text": "Login required? I am not sure. Are you already logged in?",
       "screenshot_path": "artifacts/abc123/session_check.png"
     }
   }
   ```

3. **Answer question**:
   ```bash
   POST /runs/abc123/answer
   {
     "question_id": "login_confirm",
     "answer": "no"
   }
   ```

4. **Result**: Transitions to `LOGIN_DETECT` or `WAIT_LOGIN_INPUT`

## Notes

- SESSION_CHECK is **landing-page independent** - works with any URL
- Screenshot is always captured for debugging
- Heuristics are conservative - defaults to ambiguous if unsure
- Browser context is managed per run and cleaned up on error

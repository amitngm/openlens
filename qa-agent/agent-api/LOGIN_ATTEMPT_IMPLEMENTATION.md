# LOGIN_ATTEMPT State Implementation

## Overview

Implemented LOGIN_ATTEMPT state logic for Keycloak authentication with comprehensive error handling, loop protection, and success detection.

## Implementation Details

### Flow

1. **LOGIN_DETECT** finds credentials → transitions to `LOGIN_ATTEMPT`
2. **LOGIN_ATTEMPT** executes:
   - Fill username/password using selectors with fallbacks
   - Click submit button
   - Wait for redirect or error
   - Check success criteria
   - Handle failures, timeouts, and login loops

### Selectors (with fallbacks)

- **Username**: `input#username, input[name='username'], input[type='text']`
- **Password**: `input#password, input[name='password'], input[type='password']`
- **Submit**: `input[type='submit'], button[type='submit'], #kc-login`
- **Error**: `.kc-feedback-text, .alert-error, .pf-m-danger, .error-message, [role='alert']`

### Steps

1. **Fill Username**: Try each selector until one works
2. **Fill Password**: Try each selector until one works
3. **Click Submit**: Try each selector, wait for navigation (30s timeout)
4. **Wait for Result**: Wait for network idle + 2s additional
5. **Check for Errors**: Look for error selectors on page
6. **Check Success**: Validate success criteria
7. **Handle Edge Cases**: Timeout, loop, uncertain

### Success Criteria (Landing-Page Agnostic)

- ✅ Current URL host matches base_url host (or ends with same parent domain)
- ✅ Current URL does NOT contain `/realms/` and does NOT contain `openid-connect`
- ✅ Keycloak login form not visible (implicit - if URL checks pass)

### State Transitions

- **Success** → `POST_LOGIN_VALIDATE`
- **Failure** (error detected) → `WAIT_LOGIN_INPUT` with error message + screenshot
- **Timeout/Uncertain** → `WAIT_LOGIN_CONFIRM` with confirm question + screenshot
- **Loop** (>2 redirects) → `WAIT_LOGIN_INPUT` with loop message + screenshot

### Login Loop Protection

- Tracks login attempts per run_id
- If redirected to Keycloak >2 times → stops and asks for new credentials
- Error message: "Login loop detected (redirected to Keycloak N times)"
- Includes current URL in question text

## Files Created/Modified

### New Files

1. **`app/services/login_executor.py`**
   - `LoginExecutor` class
   - `attempt_login()` method
   - Error detection, success validation, loop protection
   - Screenshot capture for all outcomes

### Modified Files

1. **`app/routers/interactive_qa.py`**
   - Updated `start_run()` to execute login when transitioning to `LOGIN_ATTEMPT`
   - Updated `answer_question()` to execute login when credentials provided

2. **`app/services/__init__.py`**
   - Exports `LoginExecutor` and `get_login_executor()`

## Example Flows

### Flow 1: Successful Login

1. **LOGIN_ATTEMPT** executes
2. Fills username/password
3. Clicks submit
4. Redirects to app domain
5. Success criteria met
6. Transitions to `POST_LOGIN_VALIDATE`

**Response:**
```json
{
  "run_id": "abc123",
  "state": "POST_LOGIN_VALIDATE",
  "question": null
}
```

### Flow 2: Login Failure (Error Detected)

1. **LOGIN_ATTEMPT** executes
2. Fills username/password
3. Clicks submit
4. Error message appears on page
5. Transitions to `WAIT_LOGIN_INPUT`

**Response:**
```json
{
  "run_id": "abc123",
  "state": "WAIT_LOGIN_INPUT",
  "question": {
    "id": "login_error",
    "type": "text",
    "text": "Login failed: Invalid username or password. Please check credentials and try again.",
    "screenshot_path": "artifacts/abc123/login_attempt.png"
  }
}
```

### Flow 3: Login Loop Detected

1. **LOGIN_ATTEMPT** executes (attempt #3)
2. Loop protection triggers (>2 redirects)
3. Stops and asks for new credentials

**Response:**
```json
{
  "run_id": "abc123",
  "state": "WAIT_LOGIN_INPUT",
  "question": {
    "id": "login_loop",
    "type": "text",
    "text": "Login loop detected (redirected to Keycloak 3 times). Please check credentials or session. Current URL: https://keycloak.example.com/auth/realms/...",
    "screenshot_path": "artifacts/abc123/login_loop.png"
  }
}
```

### Flow 4: Timeout/Uncertain

1. **LOGIN_ATTEMPT** executes
2. Submit clicked but status uncertain
3. Still on Keycloak or ambiguous redirect
4. Transitions to `WAIT_LOGIN_CONFIRM`

**Response:**
```json
{
  "run_id": "abc123",
  "state": "WAIT_LOGIN_CONFIRM",
  "question": {
    "id": "login_uncertain",
    "type": "confirm",
    "text": "Login status uncertain. Still on Keycloak page. Did login succeed?",
    "screenshot_path": "artifacts/abc123/login_attempt.png"
  }
}
```

## Screenshots

All outcomes capture screenshots:
- **Success**: `login_attempt.png`
- **Failure**: `login_attempt.png` (with error visible)
- **Loop**: `login_loop.png`
- **Timeout**: `login_attempt.png` (uncertain state)

## Notes

- **Landing-page agnostic**: Success detection works with any app domain
- **Robust selectors**: Multiple fallback selectors for reliability
- **Error extraction**: Captures actual error text from page
- **Loop protection**: Prevents infinite redirect loops
- **Timeout handling**: Gracefully handles slow redirects
- **Screenshot evidence**: All outcomes include visual evidence

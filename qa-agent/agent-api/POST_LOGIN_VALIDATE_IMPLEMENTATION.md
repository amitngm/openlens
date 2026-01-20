# POST_LOGIN_VALIDATE State Implementation

## Overview

Implemented POST_LOGIN_VALIDATE state logic to verify that the login session is properly established and we don't bounce back to Keycloak immediately after login.

## Implementation Details

### Flow

1. **LOGIN_ATTEMPT** succeeds → transitions to `POST_LOGIN_VALIDATE`
2. **POST_LOGIN_VALIDATE** performs:
   - Reload base_url once
   - Check if we bounce back to Keycloak
   - If bounced → `WAIT_LOGIN_INPUT` with error message
   - If not bounced → `CONTEXT_DETECT`

### Steps

1. **Reload base_url**: Navigate to base_url once to test session persistence
2. **Wait for redirects**: Wait 2 seconds after network idle for any redirects
3. **Check for Keycloak bounce**: Check if current URL contains Keycloak patterns
4. **Capture screenshot**: Always capture screenshot for evidence
5. **Store current_url**: Update run context with current URL
6. **Transition**: Based on bounce detection

### Bounce Detection

- **Keycloak patterns**: `/realms/` or `openid-connect` in URL
- **If detected**: Session not established, bounced back to Keycloak
- **If not detected**: Session appears valid, proceed to context detection

### State Transitions

- **Bounced** → `WAIT_LOGIN_INPUT`
  - Question: "Session not established / still redirecting to Keycloak. Please check credentials and try again."
  - Includes screenshot
  
- **Valid** → `CONTEXT_DETECT`
  - No question
  - Session validated

## Files Created/Modified

### New Files

1. **`app/services/post_login_validator.py`**
   - `PostLoginValidator` class
   - `validate_session()` method
   - Bounce detection logic
   - Screenshot capture

### Modified Files

1. **`app/routers/interactive_qa.py`**
   - Updated `start_run()` to call validation when transitioning to `POST_LOGIN_VALIDATE`
   - Updated `answer_question()` to call validation after successful login

2. **`app/services/__init__.py`**
   - Exports `PostLoginValidator` and `get_post_login_validator()`

## Example Flows

### Flow 1: Session Valid (No Bounce)

1. **LOGIN_ATTEMPT** succeeds → `POST_LOGIN_VALIDATE`
2. **POST_LOGIN_VALIDATE**:
   - Reloads base_url
   - Stays on app domain (no Keycloak patterns)
   - Transitions to `CONTEXT_DETECT`

**Response:**
```json
{
  "run_id": "abc123",
  "state": "CONTEXT_DETECT",
  "question": null,
  "current_url": "https://app.example.com/dashboard"
}
```

### Flow 2: Session Bounced (Back to Keycloak)

1. **LOGIN_ATTEMPT** succeeds → `POST_LOGIN_VALIDATE`
2. **POST_LOGIN_VALIDATE**:
   - Reloads base_url
   - Immediately redirects to Keycloak
   - Transitions to `WAIT_LOGIN_INPUT`

**Response:**
```json
{
  "run_id": "abc123",
  "state": "WAIT_LOGIN_INPUT",
  "question": {
    "id": "session_not_established",
    "type": "text",
    "text": "Session not established / still redirecting to Keycloak. Please check credentials and try again.",
    "screenshot_path": "artifacts/abc123/post_login_validate.png"
  },
  "current_url": "https://keycloak.example.com/auth/realms/..."
}
```

## Screenshots

- **Path**: `{artifacts_path}/post_login_validate.png`
- **Always captured**: Screenshot taken regardless of outcome
- **Attached to question**: If bounced, screenshot path included in question

## Notes

- **Single reload**: Only reloads base_url once (not multiple times)
- **Bounce detection**: Checks for Keycloak patterns in URL immediately after reload
- **Host validation**: Also checks if we're on the app domain (logs warning if mismatch)
- **Error handling**: On exception, defaults to asking for credentials again
- **Current URL stored**: Always updates run context with current URL after validation

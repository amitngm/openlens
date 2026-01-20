# LOGIN_DETECT State Implementation

## Overview

Implemented LOGIN_DETECT state logic for Keycloak-first behavior. This state determines if credentials are available and transitions accordingly.

## Implementation Details

### Flow

1. **SESSION_CHECK** detects Keycloak → transitions to `LOGIN_DETECT`
2. **LOGIN_DETECT** performs:
   - Sets `auth.type="keycloak"` if Keycloak detected (if not already set)
   - Checks if username/password exist
   - If missing → `WAIT_LOGIN_INPUT` with text question
   - If exist → `LOGIN_ATTEMPT`

### Logic

#### Step 1: Set Auth Type
- If Keycloak detected and `auth` is None → Create `AuthConfig(type="keycloak")`
- If Keycloak detected and `auth.type != "keycloak"` → Update to `"keycloak"`

#### Step 2: Check Credentials
- Check if `auth.username` exists
- Check if `auth.password` exists
- Both must be present to proceed

#### Step 3: State Transition
- **No credentials** → `WAIT_LOGIN_INPUT`
  - Question: `"Please provide login credentials. Format: 'username,password' or JSON {\"username\":\"...\",\"password\":\"...\"}. Alternatively, provide a profile name if configured."`
  - Question type: `"text"`
  
- **Credentials exist** → `LOGIN_ATTEMPT`
  - No question needed
  - Ready for login execution

## State Transitions

```
SESSION_CHECK (Keycloak detected) → LOGIN_DETECT → [WAIT_LOGIN_INPUT | LOGIN_ATTEMPT]
```

### From WAIT_LOGIN_CONFIRM

When user answers "no" (needs login):
```
WAIT_LOGIN_CONFIRM (answer="no") → LOGIN_DETECT → [WAIT_LOGIN_INPUT | LOGIN_ATTEMPT]
```

## Files Created/Modified

### New Files

1. **`app/services/login_detector.py`**
   - `LoginDetector` class
   - `detect_login()` method
   - Handles auth type setting and credential checking

### Modified Files

1. **`app/routers/interactive_qa.py`**
   - Updated `start_run()` to call `detect_login()` when transitioning to `LOGIN_DETECT`
   - Updated `answer_question()` to handle `WAIT_LOGIN_CONFIRM` → `LOGIN_DETECT` flow

2. **`app/services/__init__.py`**
   - Exports `LoginDetector` and `get_login_detector()`

## Example Flows

### Flow 1: Keycloak Detected, No Credentials

1. **SESSION_CHECK** detects Keycloak → `LOGIN_DETECT`
2. **LOGIN_DETECT**:
   - Sets `auth.type="keycloak"`
   - No credentials found
   - Transitions to `WAIT_LOGIN_INPUT`
3. **Response**:
   ```json
   {
     "run_id": "abc123",
     "state": "WAIT_LOGIN_INPUT",
     "question": {
       "id": "login_creds",
       "type": "text",
       "text": "Please provide login credentials..."
     }
   }
   ```

### Flow 2: Keycloak Detected, Credentials Provided

1. **POST /runs/start** with auth:
   ```json
   {
     "base_url": "https://app.example.com",
     "auth": {
       "type": "keycloak",
       "username": "user@example.com",
       "password": "password123"
     }
   }
   ```

2. **SESSION_CHECK** detects Keycloak → `LOGIN_DETECT`
3. **LOGIN_DETECT**:
   - Sets `auth.type="keycloak"` (already set)
   - Credentials found
   - Transitions to `LOGIN_ATTEMPT`
4. **Response**:
   ```json
   {
     "run_id": "abc123",
     "state": "LOGIN_ATTEMPT",
     "question": null
   }
   ```

### Flow 3: From WAIT_LOGIN_CONFIRM

1. User answers "no" to confirm question
2. **LOGIN_DETECT** is triggered
3. Same logic as above (check credentials, transition accordingly)

## Notes

- **Keycloak-first**: Always sets `auth.type="keycloak"` when Keycloak is detected
- **Profile name support**: Question mentions "profile name" for future configuration support
- **No normal/SSO yet**: Only Keycloak is implemented as requested
- **Auth persistence**: Auth config is saved to run context when updated

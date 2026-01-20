# CONTEXT_DETECT State Implementation

## Overview

Implemented CONTEXT_DETECT state logic to detect tenant/project/cell selectors after login and extract available options.

## Implementation Details

### Flow

1. **POST_LOGIN_VALIDATE** succeeds → transitions to `CONTEXT_DETECT`
2. **CONTEXT_DETECT** performs:
   - Finds context-related elements (tenant/project/cell selectors)
   - Extracts option labels from dropdowns/selects (limit 25)
   - If multiple options → `WAIT_CONTEXT_INPUT` with select_one question
   - If single or none → `DISCOVERY_RUN` with default context

### Heuristics

#### Step 1: Find Context Elements

Searches for elements containing keywords:
- **Keywords**: tenant, project, cell, workspace, org, organization, environment, env, region, zone, namespace
- **Selector patterns**:
  - `select[name*='tenant']`, `select[id*='project']`, etc.
  - `[data-tenant]`, `[data-project]`, etc.
  - `.tenant-selector`, `.project-selector`, etc.
  - Attribute searches: `[name*='keyword']`, `[id*='keyword']`, `[class*='keyword']`

#### Step 2: Extract Options

For each found element:
- **Select elements**: Extract `<option>` labels
- **Menu/Dropdown elements**: Extract child items (li, a, [role='option'])
- **Text elements**: Extract visible text if short (< 50 chars)
- **Limit**: 25 options total, 30 per element

#### Step 3: Filter Options

- Remove empty, placeholder text ("Select...", "Choose...", "--")
- Filter out URLs (starting with "http")
- Keep options between 2-100 characters

#### Step 4: Determine Next State

- **Multiple options (>1)** → `WAIT_CONTEXT_INPUT`
  - Question type: `select_one`
  - Question text: "Multiple contexts detected. Which tenant/project/cell should I test?"
  - Options: List of QuestionOption with id and label
  - Screenshot attached
  
- **Single or no options** → `DISCOVERY_RUN`
  - Selected context: First option if exists, None otherwise
  - No question needed
  - Proceeds automatically

## Files Created/Modified

### New Files

1. **`app/services/context_detector.py`**
   - `ContextDetector` class
   - `detect_context()` method
   - `_find_context_elements()` method
   - `_extract_options()` method

### Modified Files

1. **`app/routers/interactive_qa.py`**
   - Updated `start_run()` to call context detection when transitioning to `CONTEXT_DETECT`
   - Updated `answer_question()` to call context detection after post-login validation
   - Updated `answer_question()` to call context detection when user confirms they're logged in

2. **`app/services/__init__.py`**
   - Exports `ContextDetector` and `get_context_detector()`

## Example Flows

### Flow 1: Multiple Contexts Detected

1. **POST_LOGIN_VALIDATE** succeeds → `CONTEXT_DETECT`
2. **CONTEXT_DETECT**:
   - Finds tenant selector with 3 options: "Tenant A", "Tenant B", "Tenant C"
   - Transitions to `WAIT_CONTEXT_INPUT`

**Response:**
```json
{
  "run_id": "abc123",
  "state": "WAIT_CONTEXT_INPUT",
  "question": {
    "id": "context_select",
    "type": "select_one",
    "text": "Multiple contexts detected. Which tenant/project/cell should I test?",
    "options": [
      {"id": "tenant_a", "label": "Tenant A"},
      {"id": "tenant_b", "label": "Tenant B"},
      {"id": "tenant_c", "label": "Tenant C"}
    ],
    "screenshot_path": "artifacts/abc123/context_detect.png"
  }
}
```

### Flow 2: Single Context Detected

1. **POST_LOGIN_VALIDATE** succeeds → `CONTEXT_DETECT`
2. **CONTEXT_DETECT**:
   - Finds project selector with 1 option: "Project Alpha"
   - Automatically selects it
   - Transitions to `DISCOVERY_RUN`

**Response:**
```json
{
  "run_id": "abc123",
  "state": "DISCOVERY_RUN",
  "question": null,
  "selected_context": "Project Alpha"
}
```

### Flow 3: No Context Detected

1. **POST_LOGIN_VALIDATE** succeeds → `CONTEXT_DETECT`
2. **CONTEXT_DETECT**:
   - No context selectors found
   - Transitions to `DISCOVERY_RUN` with no context

**Response:**
```json
{
  "run_id": "abc123",
  "state": "DISCOVERY_RUN",
  "question": null,
  "selected_context": null
}
```

## Screenshots

- **Path**: `{artifacts_path}/context_detect.png`
- **Always captured**: Screenshot taken during context detection
- **Attached to question**: If multiple options, screenshot path included in question

## Notes

- **Keyword-based detection**: Searches for common context-related keywords
- **Multiple selector patterns**: Tries various CSS selectors to find context elements
- **Option extraction**: Handles select elements, menus, and dropdowns
- **Filtering**: Removes placeholders and invalid options
- **Limit protection**: Caps at 25 options to avoid overwhelming UI
- **Automatic selection**: Single option is automatically selected
- **Error handling**: On error, defaults to proceeding without context

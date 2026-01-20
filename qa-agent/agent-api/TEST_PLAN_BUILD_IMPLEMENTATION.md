# TEST_PLAN_BUILD Implementation

## Overview

Implemented TEST_PLAN_BUILD state to generate test plans based on user's selected intent (smoke, crud_sanity, module_based, exploratory_15m).

## Implementation Details

### Flow

1. **WAIT_TEST_INTENT** → User selects intent → `TEST_PLAN_BUILD`
2. **TEST_PLAN_BUILD** executes:
   - Reads discovery.json
   - Generates tests based on intent
   - Saves to `artifacts/<run_id>/test_plan.json`
   - Stores in RunContext.test_plan
3. Transitions to `TEST_EXECUTE` (or `WAIT_TEST_INTENT_MODULE` for module_based)

### Test Intent Handlers

#### 1. smoke
- **Purpose**: Minimal happy-path tests for top modules/pages
- **Tests Generated**:
  - Homepage/Dashboard load test
  - Top 5 pages load tests
  - Top 3 GET API health checks
- **Priority**: Critical/High/Medium
- **Type**: UI and API

#### 2. crud_sanity
- **Purpose**: Create/update/delete/validation tests for CRUD actions (SAFE only)
- **Tests Generated**:
  - CREATE tests (POST forms/APIs only)
  - UPDATE tests (PUT/PATCH APIs)
  - VALIDATION tests (required fields)
  - **NO DELETE tests** (safe mode)
- **Priority**: High/Medium
- **Type**: UI and API

#### 3. module_based
- **Purpose**: Module-specific tests
- **Flow**:
  1. Infer modules from URLs/pages/APIs
  2. If multiple modules → `WAIT_TEST_INTENT_MODULE` (ask user to select)
  3. If single module → Generate tests for that module
- **Tests Generated**:
  - Page load tests for module pages (up to 5)
  - Form submission tests for module forms (up to 3)
- **Priority**: High/Medium

#### 4. exploratory_15m
- **Purpose**: Guided exploration with safe actions only (no deletes)
- **Tests Generated**:
  - Page exploration tests (up to 10 pages)
  - Safe form fill tests (POST/PUT/PATCH only, not submitted)
  - Safe API exploration (GET/POST only, up to 5)
- **Priority**: Medium/Low
- **Mode**: exploratory_safe

### Module Inference

Modules are inferred from:
- URL path segments (first segment often indicates module)
- Page titles and nav text
- Common keywords: dashboard, users, settings, admin, reports, analytics, billing, inventory, orders, products

### Test Plan Schema

```json
{
  "run_id": "abc123",
  "test_intent": "smoke",
  "module": "Users",  // Only for module_based
  "generated_at": "2026-01-20T10:00:00Z",
  "total_tests": 8,
  "tests": [
    {
      "id": "SMOKE-001",
      "name": "Load Dashboard",
      "description": "Verify homepage loads without errors",
      "template": "page_load",
      "priority": "critical",
      "type": "ui",
      "steps": [
        {"action": "navigate", "target": "https://app.example.com"},
        {"action": "wait", "timeout": 5000},
        {"action": "verify", "condition": "no_errors"}
      ],
      "expected_result": "Page should load without console errors",
      "tags": ["smoke", "page_load"]
    }
  ]
}
```

## Files Created/Modified

### New Files

1. **`app/services/test_plan_builder.py`**
   - `TestPlanBuilder` class
   - `build_test_plan()` method
   - `_generate_smoke_tests()` method
   - `_generate_crud_sanity_tests()` method
   - `_infer_modules()` method
   - `_generate_module_tests()` method
   - `_generate_exploratory_tests()` method

### Modified Files

1. **`app/routers/interactive_qa.py`**
   - Added `WAIT_TEST_INTENT` handler
   - Added `WAIT_TEST_INTENT_MODULE` handler
   - Calls test plan builder
   - Stores test plan in context

2. **`app/models/run_state.py`**
   - Added `WAIT_TEST_INTENT_MODULE` state

3. **`app/services/__init__.py`**
   - Exports `TestPlanBuilder` and `get_test_plan_builder()`

## State Transitions

```
WAIT_TEST_INTENT → TEST_PLAN_BUILD → TEST_EXECUTE
WAIT_TEST_INTENT → TEST_PLAN_BUILD → WAIT_TEST_INTENT_MODULE → TEST_PLAN_BUILD → TEST_EXECUTE
```

## Example Flows

### Flow 1: Smoke Tests

1. User selects "smoke"
2. **TEST_PLAN_BUILD**:
   - Generates 8 tests (homepage + 5 pages + 3 APIs)
   - Saves to test_plan.json
3. **TEST_EXECUTE**

**Response:**
```json
{
  "run_id": "abc123",
  "state": "TEST_EXECUTE",
  "test_plan": {
    "test_intent": "smoke",
    "total_tests": 8,
    "tests": [...]
  }
}
```

### Flow 2: Module-Based (Multiple Modules)

1. User selects "module_based"
2. **TEST_PLAN_BUILD**:
   - Infers modules: ["Users", "Settings", "Reports"]
   - Transitions to `WAIT_TEST_INTENT_MODULE`
3. **WAIT_TEST_INTENT_MODULE**:
   - User selects "Users"
   - Generates tests for Users module
   - Saves to test_plan.json
4. **TEST_EXECUTE**

**Response (after module selection):**
```json
{
  "run_id": "abc123",
  "state": "WAIT_TEST_INTENT_MODULE",
  "question": {
    "id": "test_intent_module",
    "type": "select_one",
    "text": "Found 3 modules. Which module should I test?",
    "options": [
      {"id": "users", "label": "Users"},
      {"id": "settings", "label": "Settings"},
      {"id": "reports", "label": "Reports"}
    ]
  }
}
```

### Flow 3: CRUD Sanity

1. User selects "crud_sanity"
2. **TEST_PLAN_BUILD**:
   - Generates CREATE tests (POST forms/APIs)
   - Generates UPDATE tests (PUT/PATCH)
   - Generates VALIDATION tests
   - **NO DELETE tests** (safe mode)
   - Saves to test_plan.json
3. **TEST_EXECUTE**

## Notes

- **Safe mode**: CRUD sanity and exploratory tests exclude DELETE operations
- **Module inference**: Extracts modules from URLs, titles, and common keywords
- **Test limits**: Limits tests to prevent overwhelming (e.g., 5 pages, 3 forms per module)
- **Schema preservation**: Uses existing test case schema from testcase_generator.py patterns
- **File storage**: Saves to `artifacts/<run_id>/test_plan.json`
- **Context storage**: Stores test plan in RunContext.test_plan

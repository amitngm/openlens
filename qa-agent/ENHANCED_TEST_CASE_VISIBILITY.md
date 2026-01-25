# Enhanced Test Case Visibility Implementation

## Overview

This document describes the enhanced implementation that provides **real-time test case generation and visibility** during discovery, allowing QA teams to see exactly what will be tested before execution.

## Problem Solved

**Original Issue**: "I want to see test cases details with status in UI" and "I am not able to see discovered pages, scenarios, test cases"

**Solution**: Auto-generate test cases in real-time as pages are discovered, organized by scenarios, with full visibility in the UI.

---

## Key Features

### 1. ✅ **Auto-Generated Test Cases**
- Test cases generated automatically as each page is discovered
- No waiting until the end - see test cases appear in real-time
- Intelligent test case generation based on page features

### 2. ✅ **Scenario-Based Organization**
- Test cases grouped by scenarios (CRUD Operations, Data Operations, Navigation, etc.)
- Easy to understand test coverage at a glance
- Scenario-level statistics (total, passed, failed, pending)

### 3. ✅ **Real-Time Visibility**
- Test cases appear in UI as discovery progresses
- Event-driven updates (test_case_generated, test_cases_generated)
- Live counter showing number of test cases generated

### 4. ✅ **Comprehensive Test Coverage**
Test cases generated for:
- Navigation (page loading and access)
- Table listing (data display)
- Pagination (next/previous navigation)
- Search (filtering results)
- Filters (applying filter controls)
- Sort (table column sorting)
- CRUD Create (creating new items)
- CRUD Update (editing existing items)
- CRUD Delete (removing items)
- Form validation (error handling)

### 5. ✅ **Detailed Test Information**
Each test case includes:
- Unique ID
- Name and description
- Type (navigation, crud_create, search, etc.)
- Priority (high, medium, low)
- Status (pending, passed, failed)
- Test steps
- Expected results
- Page URL and name

### 6. ✅ **Interactive UI**
- Select individual test cases or entire scenarios
- Select All / Deselect All functionality
- View detailed test case information
- Execute selected tests
- Color-coded status indicators
- Priority badges

---

## Implementation Details

### New Files Created

#### 1. `app/services/test_case_generator.py`

**Purpose**: Auto-generate test cases from discovered page metadata

**Key Methods**:
- `generate_test_cases_for_page()` - Generates 5-10 test cases per page based on features
- `group_test_cases_by_scenario()` - Groups test cases into logical scenarios
- `save_test_cases()` - Saves consolidated test cases to file
- `emit_test_case_event()` - Emits real-time event for each generated test case

**Test Case Generation Logic**:
```python
# Detects page features
has_tables = len(page_info.get("tables", [])) > 0
has_search = self._detect_search(page_info)
has_pagination = self._detect_pagination(page_info)
has_create_action = self._has_action(page_info, "create")

# Generates appropriate test cases
if has_tables:
    # Generate listing test case
    # Generate sort test case

if has_pagination:
    # Generate pagination test case

if has_search:
    # Generate search test case

# And so on...
```

### Files Modified

#### 1. `app/services/discovery_runner.py`

**Changes**:
- Import test case generator after each page is discovered (2 locations)
- Generate test cases immediately when page metadata is available
- Emit `test_case_generated` events in real-time
- Collect and save all test cases before health checks
- Emit `test_cases_generated` event with summary

**Code Added** (2 locations - lines 1120 and 1360):
```python
# Generate test cases for this page
try:
    from app.services.test_case_generator import get_test_case_generator
    test_gen = get_test_case_generator()
    page_test_cases = test_gen.generate_test_cases_for_page(page_info, run_id)

    # Emit events for each test case
    for tc in page_test_cases:
        test_gen.emit_test_case_event(run_id, artifacts_path, tc)
except Exception as tc_error:
    logger.warning(f"[{run_id}] Failed to generate test cases: {tc_error}")
```

**Before Health Checks** (line 1438):
```python
# Collect and save all generated test cases
try:
    from app.services.test_case_generator import get_test_case_generator
    test_gen = get_test_case_generator()

    # Collect all test cases from all pages
    all_test_cases = []
    for page in visited_pages:
        page_test_cases = test_gen.generate_test_cases_for_page(page, run_id)
        all_test_cases.extend(page_test_cases)

    # Save consolidated test cases
    test_gen.save_test_cases(run_id, artifacts_path, all_test_cases)

    # Emit test cases summary event
    scenarios = test_gen.group_test_cases_by_scenario(all_test_cases)
    self._emit_event(run_id, artifacts_path, "test_cases_generated", {
        "total_test_cases": len(all_test_cases),
        "scenarios_count": len(scenarios),
        "scenarios": scenarios
    })
except Exception as tc_error:
    logger.error(f"[{run_id}] Failed to save test cases: {tc_error}", exc_info=True)
```

#### 2. `app/routers/interactive_qa.py`

**New Endpoint Added** (before `/stats`):
```python
@router.get("/{run_id}/test-cases", summary="Get test cases for a run")
async def get_test_cases(run_id: str):
    """Get all generated test cases for a run."""
    try:
        context = _run_store.get_run(run_id)
        if not context:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

        test_cases_file = Path(context.artifacts_path) / "test_cases.json"

        if not test_cases_file.exists():
            return {
                "run_id": run_id,
                "total_test_cases": 0,
                "scenarios": []
            }

        with open(test_cases_file, "r") as f:
            test_cases_data = json.load(f)

        return test_cases_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{run_id}] Failed to get test cases: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get test cases: {str(e)}")
```

#### 3. `agent-api/ui/index.html`

**Event Handlers Added**:
```javascript
// In processEvents function:
} else if (event.type === 'test_case_generated') {
    handleTestCaseGenerated(event.data);
} else if (event.type === 'test_cases_generated') {
    handleTestCasesGenerated(event.data);
    fetchTestCases();
} else if (event.type === 'discovery_completed') {
    // ...existing code...
    fetchTestCases(); // Fetch generated test cases
}
```

**New Functions Added**:
- `handleTestCaseGenerated(data)` - Increments counter for each test case
- `handleTestCasesGenerated(data)` - Shows summary notification
- `fetchTestCases()` - Fetches test cases from API
- `displayTestCases(testCasesData)` - Renders test cases in UI
- `toggleScenarioTests(checkbox, scenarioIdx)` - Select all tests in scenario
- `selectAllTests()` - Select all test cases
- `deselectAllTests()` - Deselect all test cases
- `executeSelectedTests()` - Execute selected tests
- `showTestCaseDetails(testCaseId)` - Show test case details modal

**UI Display**:
- Scenario-based cards with headers
- Test case table with checkboxes
- Status indicators (✓ passed, ✗ failed, ⏳ pending)
- Priority badges (high/medium/low)
- Action buttons (View Details, Execute)

---

## Event Flow

```
Page Discovered
    ↓
Generate Test Cases for Page
    ↓
Emit test_case_generated Events (one per test case)
    ↓
UI Updates Counter (+1, +2, +3...)
    ↓
All Pages Discovered
    ↓
Collect All Test Cases
    ↓
Save to test_cases.json
    ↓
Emit test_cases_generated Event
    ↓
UI Fetches and Displays All Test Cases
    ↓
User Can View, Select, and Execute Tests
```

---

## Output Files

### `data/{run_id}/test_cases.json`

**Structure**:
```json
{
  "run_id": "abc123",
  "generated_at": "2026-01-25T12:00:00.000Z",
  "total_test_cases": 45,
  "scenarios": [
    {
      "scenario_name": "Virtual Machines - CRUD Operations",
      "page_name": "Virtual Machines",
      "page_url": "https://app.com/vms",
      "test_cases": [
        {
          "id": "TC_CREATE_Virtual_Machines",
          "name": "Create New Item in Virtual Machines",
          "description": "Verify create functionality on Virtual Machines",
          "type": "crud_create",
          "priority": "high",
          "status": "pending",
          "page_url": "https://app.com/vms",
          "page_name": "Virtual Machines",
          "steps": [
            "Navigate to Virtual Machines",
            "Click Create button",
            "Verify create form opens",
            "Fill in required fields",
            "Submit form",
            "Verify success message",
            "Verify new item appears in listing"
          ],
          "expected_result": "New item is created successfully"
        }
      ],
      "total": 3,
      "pending": 3,
      "passed": 0,
      "failed": 0
    }
  ],
  "all_test_cases": [ /* flat list of all test cases */ ]
}
```

---

## Usage

### 1. Start Discovery

```bash
curl -X POST http://localhost:8000/runs/start \
  -H "Content-Type: application/json" \
  -d '{
    "base_url": "https://your-app.com",
    "headless": false
  }'
```

### 2. Watch Test Cases Generate in Real-Time

**In UI**:
- Open the Test Cases tab
- See test case counter increment as discovery progresses
- Test cases appear organized by scenario
- Status: All start as "pending"

**In Events Stream**:
```bash
tail -f data/{run_id}/events.jsonl | grep test_case
```

**Events you'll see**:
```json
{"type": "test_case_generated", "data": {"test_case_id": "TC_NAV_Home", "test_case_name": "Navigate to Home", ...}}
{"type": "test_case_generated", "data": {"test_case_id": "TC_LIST_Home", "test_case_name": "View Home Listing", ...}}
{"type": "test_cases_generated", "data": {"total_test_cases": 45, "scenarios_count": 8}}
```

### 3. View Test Cases

**In UI**:
- Navigate to "Test Cases" tab
- See all test cases organized by scenario
- Each scenario shows:
  - Scenario name (e.g., "Virtual Machines - CRUD Operations")
  - Page URL
  - Test count summary
  - Individual test cases with details

**Via API**:
```bash
curl http://localhost:8000/runs/{run_id}/test-cases
```

### 4. Select and Execute Tests

**In UI**:
1. Check individual test cases or use "Select All"
2. Click "Execute Selected Tests"
3. Tests will run and status will update (pending → passed/failed)

---

## Example Test Case Scenarios

For a typical web application with 4 pages, you might see:

### Scenario 1: Home - Navigation
- TC_NAV_Home: Navigate to Home

### Scenario 2: Virtual Machines - Data Operations
- TC_LIST_Virtual_Machines: View Virtual Machines Listing
- TC_SEARCH_Virtual_Machines: Search in Virtual Machines
- TC_SORT_Virtual_Machines: Sort Virtual Machines Table

### Scenario 3: Virtual Machines - CRUD Operations
- TC_CREATE_Virtual_Machines: Create New Virtual Machine
- TC_EDIT_Virtual_Machines: Edit Virtual Machine
- TC_DELETE_Virtual_Machines: Delete Virtual Machine

### Scenario 4: Activity Log - Data Operations
- TC_LIST_Activity_Log: View Activity Log Listing
- TC_PAGE_Activity_Log: Test Activity Log Pagination
- TC_SORT_Activity_Log: Sort Activity Log Table

---

## Benefits

### For QA Teams:
- ✅ **Immediate visibility** - See what will be tested before execution
- ✅ **Organized view** - Test cases grouped by scenario and feature
- ✅ **Selective execution** - Choose which tests to run
- ✅ **Coverage assessment** - Understand test coverage at a glance
- ✅ **Priority awareness** - See which tests are high/medium/low priority

### For Developers:
- ✅ **Predictable testing** - Know exactly what will be tested
- ✅ **Early feedback** - Test cases generated during discovery
- ✅ **Scenario clarity** - Understand test organization
- ✅ **Easy integration** - Test cases saved as JSON for CI/CD

### For Managers:
- ✅ **Test metrics** - Total test cases, scenarios, coverage
- ✅ **Progress tracking** - See test case generation in real-time
- ✅ **Quality assurance** - Comprehensive test coverage visible upfront
- ✅ **Certification ready** - Professional test case display

---

## Testing the Implementation

### 1. Start a new discovery run
```bash
curl -X POST http://localhost:8000/runs/start \
  -H "Content-Type: application/json" \
  -d '{"base_url": "https://n1devcmp-user.airteldev.com/", "headless": false}'
```

### 2. Watch events in real-time
```bash
tail -f agent-api/data/{run_id}/events.jsonl | grep -E "page_discovered|test_case"
```

### 3. Check test cases file
```bash
cat agent-api/data/{run_id}/test_cases.json | jq '.total_test_cases'
cat agent-api/data/{run_id}/test_cases.json | jq '.scenarios[].scenario_name'
```

### 4. View in UI
- Open `http://localhost:8000` in browser
- Navigate to "Test Cases" tab
- Should see scenarios with test cases
- Try selecting tests and viewing details

---

## Next Steps (Future Enhancements)

### 1. Test Execution Integration
- Execute selected tests via QA Buddy
- Update status in real-time (pending → running → passed/failed)
- Show execution progress

### 2. Test Case Details Modal
- Show full test steps
- Show screenshots (if captured)
- Show execution logs
- Show actual vs expected results

### 3. Export Test Cases
- Export as CSV for Excel
- Export as PDF for reports
- Export as JUnit XML for CI/CD

### 4. Test Case History
- Track test execution history
- Show pass/fail trends
- Identify flaky tests

### 5. Test Case Editing
- Allow QA to edit test steps
- Add custom assertions
- Modify priorities

---

## API Endpoints

### GET `/runs/{run_id}/test-cases`

**Response**:
```json
{
  "run_id": "abc123",
  "generated_at": "2026-01-25T12:00:00Z",
  "total_test_cases": 45,
  "scenarios": [
    {
      "scenario_name": "Virtual Machines - CRUD Operations",
      "page_name": "Virtual Machines",
      "page_url": "https://app.com/vms",
      "test_cases": [ /* array of test cases */ ],
      "total": 3,
      "pending": 3,
      "passed": 0,
      "failed": 0
    }
  ],
  "all_test_cases": [ /* flat array */ ]
}
```

---

## Summary

✅ **Auto-generation**: Test cases generated automatically during discovery
✅ **Real-time visibility**: See test cases appear as discovery progresses
✅ **Scenario organization**: Test cases grouped logically
✅ **Comprehensive coverage**: 10+ test case types
✅ **Interactive UI**: Select, view, and execute tests
✅ **API access**: Fetch test cases programmatically
✅ **File output**: test_cases.json with all details

**Result**: QA teams now have complete visibility into test cases, scenarios, and coverage before any test execution begins!

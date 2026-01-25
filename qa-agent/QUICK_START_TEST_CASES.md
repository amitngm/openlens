# Quick Start: View Test Cases

## ✅ Test Cases Generated Successfully!

For run `044ec3a4-51e`, **10 test cases** have been generated across **6 scenarios**.

---

## 📊 View Test Cases (3 Ways)

### Option 1: Open HTML Viewer (Easiest)

```bash
# Open the viewer in your browser
open view_test_cases.html
# Or on Linux: xdg-open view_test_cases.html
```

This shows a beautiful view of all test cases with:
- Summary statistics
- Test cases grouped by scenario
- Click test name to see detailed steps
- Expected results for each test

### Option 2: Via API (If Server Running)

```bash
# Fetch all test cases
curl http://localhost:8000/runs/044ec3a4-51e/test-cases | jq

# Show just summary
curl -s http://localhost:8000/runs/044ec3a4-51e/test-cases | jq '{total: .total_test_cases, scenarios: .scenarios | length}'

# Show scenario names
curl -s http://localhost:8000/runs/044ec3a4-51e/test-cases | jq '.scenarios[].scenario_name'
```

### Option 3: View JSON File Directly

```bash
# Pretty print full file
cat agent-api/data/044ec3a4-51e/test_cases.json | jq

# Show just test case names
cat agent-api/data/044ec3a4-51e/test_cases.json | jq '.all_test_cases[].name'

# Show scenarios with counts
cat agent-api/data/044ec3a4-51e/test_cases.json | jq '.scenarios[] | {scenario: .scenario_name, tests: .total}'
```

---

## 📋 Generated Test Cases

### Scenario 1: Virtual Machine as a Service (VMaaS) - Navigation (2 tests)
- TC_NAV_Virtual_Machine_as_a_Service_VMaaS
- TC_LIST_Virtual_Machine_as_a_Service_VMaaS

### Scenario 2: Virtual Machine as a Service (VMaaS) - CRUD Operations (2 tests)
- TC_CREATE_Virtual_Machine_as_a_Service_VMaaS
- TC_SORT_Virtual_Machine_as_a_Service_VMaaS

### Scenario 3: Activity Log - Navigation (1 test)
- TC_NAV_Activity_Log

### Scenario 4: Activity Log - Data Operations (3 tests)
- TC_LIST_Activity_Log
- TC_PAGE_Activity_Log (Pagination)
- TC_SORT_Activity_Log

### Scenario 5: Activity Log - CRUD Operations (1 test)
- TC_CREATE_Activity_Log

### Scenario 6: Create Virtual Machine - Navigation (1 test)
- TC_NAV_Create_Virtual_Machine

---

## 🔄 For New Discovery Runs

For any **NEW** discovery run, test cases will be generated automatically in real-time!

### Start a New Run:

```bash
curl -X POST http://localhost:8000/runs/start \
  -H "Content-Type: application/json" \
  -d '{
    "base_url": "https://n1devcmp-user.airteldev.com/",
    "headless": false
  }'
```

### Watch Test Cases Generate:

```bash
# Get the run_id from the response above, then:
tail -f agent-api/data/{run_id}/events.jsonl | grep test_case
```

You'll see events like:
```json
{"type": "test_case_generated", "data": {"test_case_id": "TC_NAV_Home", ...}}
{"type": "test_cases_generated", "data": {"total_test_cases": 45, ...}}
```

### View in UI:

1. Open `http://localhost:8000` in browser
2. Navigate to **"Test Cases"** tab
3. Test cases will appear automatically as discovery progresses!

---

## 🛠️ Generate Test Cases for Existing Run

If you have an old run without test cases:

```bash
# Activate virtual environment
cd agent-api && source .venv/bin/activate && cd ..

# Generate test cases
python3 generate_test_cases_for_run.py <run_id>

# Example
python3 generate_test_cases_for_run.py 044ec3a4-51e
```

---

## 📄 Test Case Structure

Each test case includes:

```json
{
  "id": "TC_NAV_Activity_Log",
  "name": "Navigate to Activity Log",
  "description": "Verify user can navigate to Activity Log page",
  "type": "navigation",
  "priority": "high",
  "status": "pending",
  "page_url": "https://n1devcmp-user.airteldev.com/project/activity-log",
  "page_name": "Activity Log",
  "steps": [
    "Navigate to https://n1devcmp-user.airteldev.com/project/activity-log",
    "Verify page loads successfully",
    "Verify page title contains 'Activity Log'"
  ],
  "expected_result": "Page loads without errors"
}
```

---

## 🎯 Test Case Types Generated

1. **Navigation** - Page loading and access
2. **Listing** - Table data display
3. **Pagination** - Next/previous page navigation
4. **Search** - Search functionality
5. **Filters** - Filter controls
6. **Sort** - Table column sorting
7. **CRUD Create** - Creating new items
8. **CRUD Update** - Editing items
9. **CRUD Delete** - Deleting items
10. **Form Validation** - Field validation

---

## ✨ Next Steps

1. **View your test cases** using the HTML viewer (fastest)
2. **Review test coverage** - Do you need additional test cases?
3. **Start a new run** to see real-time test case generation
4. **Execute tests** - Coming soon in the UI!

---

## 🐛 Troubleshooting

### Can't see test cases in UI?

1. Make sure you're on the **"Test Cases"** tab
2. Check if `test_cases.json` exists:
   ```bash
   ls -la agent-api/data/044ec3a4-51e/test_cases.json
   ```
3. If file doesn't exist, run the generator script above

### Server not running?

```bash
cd agent-api
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Want to see test case generation in action?

Start a NEW discovery run - test cases will generate automatically!

---

## 📚 Documentation

- **Full Details**: See `ENHANCED_TEST_CASE_VISIBILITY.md`
- **Phase 1 Health Checks**: See `PHASE1_HEALTH_CHECKS_IMPLEMENTATION.md`

---

**🎉 You now have 10 test cases ready for your application!**

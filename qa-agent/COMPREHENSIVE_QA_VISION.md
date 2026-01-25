# Comprehensive QA Buddy - Vision & Implementation Plan

## 🎯 Vision

Transform QA Buddy into an **enterprise-grade, intelligent QA automation platform** that:
- Provides **100% predictable test coverage** based on actual features discovered
- Performs **live validation during discovery** (not just test case generation)
- Generates **comprehensive test cases** covering all validation scenarios
- Accepts **rich inputs** (PRD, Figma, Jira, images, videos) for smarter discovery
- Delivers **mature, production-ready** test reports with clear metrics

---

## 📊 Current State Analysis

### What Works Today ✅
- Basic page discovery with navigation
- Simple test case generation (navigation, CRUD, pagination, search)
- Real-time test case visibility in UI
- Duplicate prevention
- Run history tracking

### Critical Gaps ❌

#### 1. **No Live Validation During Discovery**
- Discovery only **discovers** pages, doesn't **test** them
- Test cases are generated but not executed during discovery
- No real-time feedback on what's working/broken

#### 2. **Incomplete Test Coverage**
- Missing comprehensive validations:
  - ❌ Form field validations (required, min/max, regex, email, phone, etc.)
  - ❌ Error message validations
  - ❌ Toast/notification validations
  - ❌ Permission/access control tests
  - ❌ Data integrity tests (create → verify in list → edit → verify → delete)
  - ❌ Cross-browser compatibility
  - ❌ API response validations
  - ❌ Loading state validations
  - ❌ Empty state validations
  - ❌ Bulk operations (select all, bulk delete, bulk export)

#### 3. **Unpredictable Test Count**
- Test count varies randomly based on what pages are visited
- No way to predict "expected vs actual" test cases
- Can't measure completeness (e.g., "80% of expected tests generated")

#### 4. **No PRD/Design Integration**
- Can't upload PRD to guide discovery
- Can't compare Figma designs vs actual implementation
- Can't link Jira tickets to test cases
- No visual regression testing with screenshots/videos

#### 5. **Immature Test Execution**
- Tests run sequentially (slow)
- No retry mechanism for flaky tests
- No test data management
- No test environment configuration
- No CI/CD integration

---

## 🚀 Proposed Solution Architecture

### Phase 1: Live Validation During Discovery ⚡
**Goal:** Test features AS they're discovered, not after

#### Implementation:

**1.1 Health Check Executor (NEW)**
```python
class HealthCheckExecutor:
    """Execute health checks in real-time during discovery."""

    async def validate_page(self, page, page_info):
        """Run comprehensive validations on a page immediately after discovery."""

        results = {
            "page_url": page_info["url"],
            "validations": []
        }

        # Navigation validation
        results["validations"].append(
            await self._validate_navigation(page, page_info)
        )

        # If has tables: validate listing, pagination, search, filters
        if page_info.get("tables"):
            results["validations"].append(
                await self._validate_table_listing(page, page_info)
            )
            results["validations"].append(
                await self._validate_pagination(page, page_info)
            )
            results["validations"].append(
                await self._validate_search(page, page_info)
            )
            results["validations"].append(
                await self._validate_filters(page, page_info)
            )
            results["validations"].append(
                await self._validate_sorting(page, page_info)
            )

        # If has forms: validate all form fields
        if page_info.get("forms"):
            results["validations"].append(
                await self._validate_form_fields(page, page_info)
            )
            results["validations"].append(
                await self._validate_form_submission(page, page_info)
            )

        # If has CRUD actions: validate end-to-end CRUD flow
        if self._has_crud_actions(page_info):
            results["validations"].append(
                await self._validate_crud_flow(page, page_info)
            )

        # UI validations
        results["validations"].append(
            await self._validate_loading_states(page, page_info)
        )
        results["validations"].append(
            await self._validate_error_messages(page, page_info)
        )
        results["validations"].append(
            await self._validate_empty_states(page, page_info)
        )

        return results
```

**1.2 Discovery Flow Update**
```python
# In discovery_runner.py - after analyzing a page:

# Old flow:
page_info = await self._analyze_page(page, url, nav_path)
visited_pages.append(page_info)

# New flow:
page_info = await self._analyze_page(page, url, nav_path)

# IMMEDIATELY validate this page
health_checker = HealthCheckExecutor()
validation_results = await health_checker.validate_page(page, page_info)

# Emit validation results in real-time
await self._emit_event(run_id, "page_validated", {
    "url": url,
    "passed": len([v for v in validation_results["validations"] if v["status"] == "passed"]),
    "failed": len([v for v in validation_results["validations"] if v["status"] == "failed"])
})

visited_pages.append({**page_info, "validation_results": validation_results})
```

**1.3 Real-Time UI Updates**
```javascript
// In index.html - show live validation results as pages are discovered

function handlePageValidatedEvent(event) {
    const { url, passed, failed } = event.data;

    // Add to live feed
    addToFeed(`
        ✅ Validated: ${url}
        Passed: ${passed} | Failed: ${failed}
    `);

    // Update dashboard counters
    updateValidationCounters(passed, failed);
}
```

---

### Phase 2: Comprehensive Test Case Generation 📋
**Goal:** Generate predictable, complete test coverage

#### 2.1 Feature-Based Test Matrix

**Define expected test cases per feature type:**

```python
class TestCoverageMatrix:
    """Defines expected test cases for each feature type."""

    FEATURE_TESTS = {
        "table_listing": [
            "verify_table_visible",
            "verify_headers_present",
            "verify_data_loads",
            "verify_row_count",
            "verify_column_data_types",
            "verify_empty_state"
        ],
        "pagination": [
            "verify_pagination_controls",
            "verify_next_button",
            "verify_previous_button",
            "verify_page_numbers",
            "verify_first_last_buttons",
            "verify_items_per_page_selector",
            "verify_total_count_display"
        ],
        "search": [
            "verify_search_box_visible",
            "verify_search_placeholder",
            "verify_search_filters_results",
            "verify_search_clear",
            "verify_search_no_results",
            "verify_search_case_insensitive",
            "verify_search_debounce"
        ],
        "filters": [
            "verify_filter_controls",
            "verify_filter_options",
            "verify_single_filter_apply",
            "verify_multiple_filters",
            "verify_filter_clear",
            "verify_filter_persistence"
        ],
        "sort": [
            "verify_sortable_columns",
            "verify_sort_ascending",
            "verify_sort_descending",
            "verify_sort_persistence",
            "verify_multi_column_sort"
        ],
        "create_form": [
            "verify_form_opens",
            "verify_required_fields",
            "verify_optional_fields",
            "verify_field_validations",
            "verify_submit_button_disabled_invalid",
            "verify_submit_success",
            "verify_error_messages",
            "verify_success_toast",
            "verify_item_in_listing"
        ],
        "edit_form": [
            "verify_form_opens_with_data",
            "verify_data_prepopulated",
            "verify_field_modifications",
            "verify_save_updates",
            "verify_changes_reflected",
            "verify_cancel_discards_changes"
        ],
        "delete": [
            "verify_delete_button",
            "verify_confirmation_dialog",
            "verify_confirm_deletes",
            "verify_cancel_preserves",
            "verify_item_removed_from_list",
            "verify_cannot_access_deleted_item"
        ],
        "bulk_operations": [
            "verify_select_all_checkbox",
            "verify_individual_selection",
            "verify_bulk_action_buttons",
            "verify_bulk_delete",
            "verify_bulk_export",
            "verify_selection_count"
        ]
    }

    def get_expected_test_count(self, discovered_features):
        """Calculate expected test count based on discovered features."""
        expected = 0

        for feature, tests in self.FEATURE_TESTS.items():
            if feature in discovered_features:
                expected += len(tests)

        return expected
```

#### 2.2 Predictable Test Generation

```python
class TestCaseGenerator:

    def generate_comprehensive_test_cases(self, page_info):
        """Generate complete test coverage for a page."""

        test_cases = []
        discovered_features = self._detect_all_features(page_info)

        # Calculate expected test count
        matrix = TestCoverageMatrix()
        expected_count = matrix.get_expected_test_count(discovered_features)

        # Generate all tests for each feature
        for feature in discovered_features:
            test_templates = matrix.FEATURE_TESTS.get(feature, [])

            for test_template in test_templates:
                test_case = self._generate_test_from_template(
                    test_template,
                    page_info,
                    feature
                )
                test_cases.append(test_case)

        # Verify we generated expected count
        assert len(test_cases) == expected_count, \
            f"Expected {expected_count} tests, generated {len(test_cases)}"

        return {
            "test_cases": test_cases,
            "expected_count": expected_count,
            "actual_count": len(test_cases),
            "coverage_percentage": 100.0,
            "discovered_features": discovered_features
        }
```

#### 2.3 Test Coverage Dashboard

```javascript
// In UI - show test coverage metrics

function displayTestCoverage(data) {
    return `
        <div class="coverage-dashboard">
            <h3>Test Coverage</h3>

            <div class="coverage-summary">
                <div class="metric">
                    <div class="value">${data.actual_count} / ${data.expected_count}</div>
                    <div class="label">Tests Generated</div>
                </div>
                <div class="metric">
                    <div class="value">${data.coverage_percentage}%</div>
                    <div class="label">Coverage</div>
                </div>
            </div>

            <h4>Features Discovered</h4>
            <ul>
                ${data.discovered_features.map(f => `
                    <li>
                        ✅ ${f}
                        (${TestCoverageMatrix.FEATURE_TESTS[f].length} tests)
                    </li>
                `).join('')}
            </ul>
        </div>
    `;
}
```

---

### Phase 3: PRD/Design/Jira Integration 📄
**Goal:** Accept rich inputs to guide smarter discovery

#### 3.1 Input Sources

**Upload PRD Document:**
```python
class PRDAnalyzer:
    """Analyze PRD document to extract expected features."""

    async def analyze_prd(self, prd_file_path):
        """Parse PRD to identify expected features, pages, workflows."""

        # Use Claude API to extract structured data from PRD
        prd_content = self._read_file(prd_file_path)

        prompt = f"""
        Analyze this PRD and extract:
        1. All pages/screens mentioned
        2. All features per page (tables, forms, search, filters, etc.)
        3. All workflows (e.g., "Create VM → Configure → Deploy")
        4. All validation rules mentioned
        5. All user roles and permissions

        PRD Content:
        {prd_content}

        Return as structured JSON.
        """

        response = await claude_api.analyze(prompt)

        return {
            "expected_pages": response["pages"],
            "expected_features": response["features"],
            "expected_workflows": response["workflows"],
            "validation_rules": response["validation_rules"],
            "user_roles": response["user_roles"]
        }
```

**Upload Figma Designs:**
```python
class FigmaAnalyzer:
    """Analyze Figma designs to extract UI components."""

    async def analyze_figma(self, figma_url, figma_token):
        """Fetch Figma file and extract components."""

        # Use Figma API
        figma_data = await self._fetch_figma_file(figma_url, figma_token)

        return {
            "pages": self._extract_pages(figma_data),
            "components": self._extract_components(figma_data),
            "styles": self._extract_styles(figma_data)
        }
```

**Link Jira Issues:**
```python
class JiraIntegration:
    """Link test cases to Jira tickets."""

    async def fetch_jira_issues(self, jira_url, jira_token, project_key):
        """Fetch all issues for a project."""

        issues = await self._fetch_jira_issues(jira_url, jira_token, project_key)

        return {
            "stories": [i for i in issues if i["type"] == "Story"],
            "bugs": [i for i in issues if i["type"] == "Bug"],
            "tasks": [i for i in issues if i["type"] == "Task"]
        }

    def link_test_to_jira(self, test_case, jira_issues):
        """Auto-link test cases to relevant Jira issues."""

        # Match test case to Jira issues by keywords
        test_keywords = self._extract_keywords(test_case["name"])

        for issue in jira_issues:
            issue_keywords = self._extract_keywords(issue["summary"])

            if len(set(test_keywords) & set(issue_keywords)) >= 2:
                test_case["jira_issue"] = issue["key"]
                test_case["jira_url"] = issue["url"]
```

**Upload Screenshots/Videos:**
```python
class VisualRegressionTester:
    """Compare screenshots for visual regression testing."""

    async def capture_and_compare(self, page, page_info, baseline_screenshot):
        """Capture current screenshot and compare with baseline."""

        current_screenshot = await page.screenshot(full_page=True)

        # Use image diff algorithm
        diff_percentage = self._compare_images(
            baseline_screenshot,
            current_screenshot
        )

        return {
            "page_url": page_info["url"],
            "diff_percentage": diff_percentage,
            "status": "passed" if diff_percentage < 5 else "failed",
            "baseline_path": baseline_screenshot,
            "current_path": current_screenshot
        }
```

#### 3.2 Smart Discovery with Context

```python
class SmartDiscoveryRunner:
    """Discovery guided by PRD, Figma, and Jira data."""

    async def run_smart_discovery(self, base_url, context):
        """
        Run discovery with rich context.

        Args:
            context: {
                "prd": PRDAnalyzer.analyze_prd(),
                "figma": FigmaAnalyzer.analyze_figma(),
                "jira": JiraIntegration.fetch_jira_issues(),
                "baseline_screenshots": {...}
            }
        """

        # Extract expected pages from PRD
        expected_pages = context["prd"]["expected_pages"]

        # Discover pages
        discovered_pages = await self._discover_pages(base_url)

        # Compare expected vs discovered
        missing_pages = set(expected_pages) - set(discovered_pages.keys())
        extra_pages = set(discovered_pages.keys()) - set(expected_pages)

        # For each discovered page:
        for page_url, page_info in discovered_pages.items():

            # Get expected features from PRD
            expected_features = context["prd"]["expected_features"].get(page_url, [])

            # Validate all expected features exist
            for feature in expected_features:
                validation = await self._validate_feature(page_info, feature)

                if validation["status"] == "failed":
                    self._report_missing_feature(page_url, feature)

            # Compare with Figma design
            if page_url in context["figma"]["pages"]:
                design_diff = await self._compare_with_figma(
                    page_info,
                    context["figma"]["pages"][page_url]
                )

            # Capture visual regression
            if page_url in context["baseline_screenshots"]:
                visual_diff = await self._compare_screenshot(
                    page_info,
                    context["baseline_screenshots"][page_url]
                )

        # Generate comprehensive report
        return {
            "discovered_pages": discovered_pages,
            "missing_pages": missing_pages,
            "extra_pages": extra_pages,
            "feature_coverage": self._calculate_feature_coverage(discovered_pages, context),
            "design_compliance": self._calculate_design_compliance(discovered_pages, context),
            "visual_regression_results": visual_diff
        }
```

---

### Phase 4: Mature Test Execution 🚀
**Goal:** Production-ready test execution with enterprise features

#### 4.1 Parallel Test Execution

```python
class ParallelTestExecutor:
    """Execute tests in parallel with worker pool."""

    async def execute_tests_parallel(self, test_cases, max_workers=5):
        """Execute tests in parallel."""

        semaphore = asyncio.Semaphore(max_workers)

        async def run_test_with_semaphore(test):
            async with semaphore:
                return await self._execute_single_test(test)

        # Run all tests in parallel (bounded by semaphore)
        results = await asyncio.gather(
            *[run_test_with_semaphore(tc) for tc in test_cases],
            return_exceptions=True
        )

        return results
```

#### 4.2 Flaky Test Detection & Retry

```python
class FlakyTestHandler:
    """Detect and retry flaky tests."""

    async def execute_with_retry(self, test_case, max_retries=3):
        """Execute test with automatic retry on failure."""

        attempts = []

        for attempt in range(max_retries):
            result = await self._execute_test(test_case)
            attempts.append(result)

            if result["status"] == "passed":
                return {
                    **result,
                    "flaky": attempt > 0,
                    "attempts": attempts
                }

            # Wait before retry
            await asyncio.sleep(2 ** attempt)  # Exponential backoff

        # Mark as flaky if passed on any retry
        passed_count = len([a for a in attempts if a["status"] == "passed"])

        return {
            **attempts[-1],
            "flaky": passed_count > 0,
            "attempts": attempts
        }
```

#### 4.3 Test Data Management

```python
class TestDataManager:
    """Manage test data for consistent test execution."""

    def __init__(self):
        self.test_data = {
            "users": [
                {"email": "test1@example.com", "password": "Test@123"},
                {"email": "test2@example.com", "password": "Test@123"}
            ],
            "vm_configs": [
                {"name": "test-vm-1", "cpu": 2, "ram": 4096},
                {"name": "test-vm-2", "cpu": 4, "ram": 8192}
            ]
        }

    def get_test_data(self, data_type, index=0):
        """Get test data by type."""
        return self.test_data.get(data_type, [])[index]

    def cleanup_test_data(self, run_id):
        """Clean up test data after run."""
        # Delete all test records created during this run
        pass
```

#### 4.4 CI/CD Integration

```yaml
# .github/workflows/qa-buddy.yml

name: QA Buddy Automated Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  qa-tests:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2

      - name: Start QA Buddy
        run: |
          cd qa-agent/agent-api
          uvicorn app.main:app --host 0.0.0.0 --port 8000 &

      - name: Run Discovery
        run: |
          curl -X POST http://localhost:8000/runs/start \
            -H "Content-Type: application/json" \
            -d '{
              "base_url": "${{ secrets.TEST_URL }}",
              "headless": true,
              "prd_path": "docs/prd.md",
              "figma_url": "${{ secrets.FIGMA_URL }}",
              "jira_project": "PROJ"
            }'

      - name: Wait for completion
        run: |
          # Poll until discovery completes
          while true; do
            status=$(curl -s http://localhost:8000/runs/$RUN_ID/status | jq -r '.state')
            if [ "$status" = "DONE" ]; then break; fi
            sleep 10
          done

      - name: Upload Test Report
        uses: actions/upload-artifact@v2
        with:
          name: qa-report
          path: qa-agent/agent-api/data/${{ env.RUN_ID }}/report.html

      - name: Comment PR with Results
        if: github.event_name == 'pull_request'
        run: |
          # Post test results as PR comment
          gh pr comment ${{ github.event.pull_request.number }} \
            --body "$(cat qa-agent/agent-api/data/$RUN_ID/summary.md)"
```

---

### Phase 5: Comprehensive Reporting 📊
**Goal:** Production-grade reports with clear metrics

#### 5.1 Enhanced Report Structure

```json
{
  "run_id": "abc123",
  "started_at": "2026-01-25T10:00:00Z",
  "completed_at": "2026-01-25T10:30:00Z",
  "duration_minutes": 30,

  "inputs": {
    "base_url": "https://app.example.com",
    "prd_provided": true,
    "figma_provided": true,
    "jira_linked": true,
    "baseline_screenshots": true
  },

  "discovery_summary": {
    "pages_discovered": 15,
    "pages_expected": 18,
    "pages_missing": ["admin/settings", "reports/analytics", "user/profile"],
    "pages_unexpected": [],
    "coverage_percentage": 83.3
  },

  "feature_coverage": {
    "total_features_expected": 45,
    "total_features_found": 42,
    "features_missing": ["bulk_export", "advanced_filters", "email_notifications"],
    "coverage_percentage": 93.3
  },

  "test_execution": {
    "total_tests_generated": 127,
    "total_tests_executed": 127,
    "passed": 118,
    "failed": 7,
    "flaky": 2,
    "pass_rate": 92.9,
    "execution_time_minutes": 15
  },

  "validation_results": {
    "navigation": {"passed": 15, "failed": 0},
    "pagination": {"passed": 8, "failed": 1},
    "search": {"passed": 6, "failed": 0},
    "filters": {"passed": 5, "failed": 2},
    "forms": {"passed": 12, "failed": 3},
    "crud": {"passed": 10, "failed": 1}
  },

  "design_compliance": {
    "pages_matching_figma": 12,
    "pages_with_design_issues": 3,
    "compliance_percentage": 80.0
  },

  "visual_regression": {
    "screenshots_compared": 15,
    "visual_changes_detected": 2,
    "regression_percentage": 13.3
  },

  "jira_integration": {
    "test_cases_linked": 95,
    "unlinked_test_cases": 32,
    "coverage_by_story": {
      "PROJ-123": 12,
      "PROJ-124": 8,
      "PROJ-125": 15
    }
  },

  "recommendations": [
    "Missing pages: Implement admin/settings page (expected from PRD)",
    "Failed validations: Fix pagination on Virtual Machines page",
    "Design issues: Header spacing differs from Figma on Dashboard",
    "Flaky tests: Stabilize 'Delete VM' test (passed on retry)"
  ]
}
```

#### 5.2 Beautiful HTML Report

```html
<!DOCTYPE html>
<html>
<head>
    <title>QA Buddy Report - Run abc123</title>
    <style>
        /* Professional report styling */
        body { font-family: 'Segoe UI', sans-serif; }
        .metric { display: inline-block; padding: 20px; margin: 10px; border-radius: 8px; }
        .passed { background: #d1fae5; color: #065f46; }
        .failed { background: #fee2e2; color: #991b1b; }
        .coverage { background: #dbeafe; color: #1e40af; }
    </style>
</head>
<body>
    <h1>QA Buddy Comprehensive Report</h1>

    <div class="summary">
        <div class="metric passed">
            <h3>118</h3>
            <p>Tests Passed</p>
        </div>
        <div class="metric failed">
            <h3>7</h3>
            <p>Tests Failed</p>
        </div>
        <div class="metric coverage">
            <h3>93.3%</h3>
            <p>Feature Coverage</p>
        </div>
    </div>

    <!-- Detailed sections... -->
</body>
</html>
```

---

## 📅 Implementation Roadmap

### Sprint 1 (Week 1-2): Live Validation Foundation
- [ ] Create `HealthCheckExecutor` class
- [ ] Implement core validation methods (pagination, search, filters)
- [ ] Integrate with `discovery_runner.py`
- [ ] Add real-time validation events to UI
- [ ] Test on sample application

### Sprint 2 (Week 3-4): Comprehensive Test Matrix
- [ ] Define `TestCoverageMatrix` with all feature tests
- [ ] Update `TestCaseGenerator` to use matrix
- [ ] Calculate expected vs actual test counts
- [ ] Add coverage percentage to UI
- [ ] Ensure predictable test generation

### Sprint 3 (Week 5-6): PRD/Figma Integration
- [ ] Create `PRDAnalyzer` class
- [ ] Integrate Claude API for PRD parsing
- [ ] Create `FigmaAnalyzer` class
- [ ] Implement Figma API integration
- [ ] Build upload UI for PRD/Figma files

### Sprint 4 (Week 7-8): Jira & Visual Regression
- [ ] Create `JiraIntegration` class
- [ ] Auto-link test cases to Jira issues
- [ ] Implement `VisualRegressionTester`
- [ ] Add screenshot comparison
- [ ] Display Jira links in test case details

### Sprint 5 (Week 9-10): Mature Test Execution
- [ ] Implement `ParallelTestExecutor`
- [ ] Add `FlakyTestHandler` with retry logic
- [ ] Create `TestDataManager`
- [ ] Add test data cleanup
- [ ] Optimize performance

### Sprint 6 (Week 11-12): Reporting & CI/CD
- [ ] Generate comprehensive JSON report
- [ ] Build beautiful HTML report
- [ ] Create GitHub Actions workflow
- [ ] Add PR comment integration
- [ ] Documentation and examples

---

## 🎯 Success Metrics

### Quantitative:
- **Test Coverage:** 95%+ of features have test cases
- **Predictability:** Expected test count within ±5% of actual
- **Execution Speed:** 10+ tests per minute (parallel)
- **Pass Rate:** 90%+ on stable applications
- **Feature Detection Accuracy:** 98%+

### Qualitative:
- **Maturity:** Production-ready for enterprise use
- **Intelligence:** Learns from PRD, Figma, Jira
- **Actionability:** Clear recommendations in reports
- **Integration:** Works seamlessly in CI/CD pipelines
- **User Experience:** QA teams love using it

---

## 💡 Example User Journey

### Before (Current State):
```
1. QA Engineer manually creates 50 test cases (2 days)
2. Runs tests manually, finds 10 bugs (1 day)
3. Documents in Excel, shares via email
4. Developers ask "which Jira ticket?" - back and forth
5. Regression testing? Run everything again manually (1 day)
Total: 4+ days, tedious, error-prone
```

### After (With Comprehensive QA Buddy):
```
1. Upload PRD + Figma + Jira link (5 minutes)
2. Start discovery → 127 tests auto-generated + validated live (30 minutes)
3. Beautiful report shows: 7 bugs found, linked to Jira tickets
4. Push to GitHub → CI runs tests automatically on PR
5. Next release? Baseline screenshots auto-compared
Total: <1 hour, automated, comprehensive, linked
```

---

## 🚀 Getting Started (After Implementation)

### Upload PRD:
```bash
# Via UI
Click "Upload PRD" → Select file → Auto-analyzed

# Via API
curl -X POST http://localhost:8000/runs/upload-prd \
  -F "file=@prd.pdf" \
  -F "run_id=abc123"
```

### Link Figma:
```bash
curl -X POST http://localhost:8000/runs/link-figma \
  -d '{"figma_url": "...", "figma_token": "..."}'
```

### Run Smart Discovery:
```bash
curl -X POST http://localhost:8000/runs/start-smart \
  -d '{
    "base_url": "https://app.example.com",
    "prd_id": "prd_123",
    "figma_id": "figma_456",
    "jira_project": "PROJ"
  }'
```

---

## 📝 Summary

This comprehensive vision transforms QA Buddy from a basic discovery tool into an **enterprise-grade, intelligent QA automation platform** that:

✅ **Tests live during discovery** (not just generates test cases)
✅ **Provides 100% predictable coverage** (expected vs actual test counts)
✅ **Validates everything** (pagination, search, filters, forms, CRUD, UI)
✅ **Learns from PRD, Figma, Jira** (smart, context-aware discovery)
✅ **Delivers mature reports** (comprehensive, actionable, beautiful)
✅ **Integrates with CI/CD** (production-ready, automated)

**This makes QA Buddy truly impactful and production-ready!** 🚀

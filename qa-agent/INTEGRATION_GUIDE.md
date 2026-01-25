# Live Validation Integration Guide

## Overview

This guide shows how to integrate `LiveValidator` into the discovery flow to enable **real-time feature validation** during page discovery.

## Integration Points

### 1. Import LiveValidator

Add to `discovery_runner.py` (after line 13):

```python
from app.services.live_validator import LiveValidator
```

### 2. Initialize LiveValidator

In `DiscoveryRunner.__init__()` (around line 60):

```python
def __init__(self, config: Optional[DiscoveryConfig] = None):
    self.config = config or DiscoveryConfig()
    self.live_validator = LiveValidator()  # ADD THIS LINE
```

### 3. Add Validation After Page Analysis

Find all locations where `visited_pages.append(page_info)` is called and add validation BEFORE appending.

**Example integration (line ~1100):**

```python
# BEFORE:
page_info = await self._analyze_page_enhanced(
    page, base_url, "Home", run_id, discovery_dir, len(visited_pages), artifacts_path
)
visited_pages.append(page_info)

# AFTER:
page_info = await self._analyze_page_enhanced(
    page, base_url, "Home", run_id, discovery_dir, len(visited_pages), artifacts_path
)

# 🆕 LIVE VALIDATION - Test features immediately
try:
    validation_results = await self.live_validator.validate_page_live(
        page=page,
        page_info=page_info,
        run_id=run_id,
        artifacts_path=artifacts_path
    )
    page_info["validation_results"] = validation_results

    logger.info(
        f"[{run_id}] ✅ Validated: {page_info.get('title')} | "
        f"Passed: {validation_results['passed_count']}, "
        f"Failed: {validation_results['failed_count']}"
    )
except Exception as e:
    logger.error(f"[{run_id}] ❌ Validation error: {e}")
    page_info["validation_results"] = {"error": str(e)}

visited_pages.append(page_info)
```

## Integration Locations

Based on grep results, add validation at these lines in `discovery_runner.py`:

1. **Line 1101** - Home page analysis
2. **Line 1244** - Navigation link click
3. **Line 3278** - Context switching
4. **Line 3331** - Table row clicking
5. **Line 3519** - Form submission
6. **Line 3551** - Pagination navigation
7. **Line 4981** - API endpoint discovery

## Complete Integration Example

```python
# In discovery_runner.py

from app.services.live_validator import LiveValidator

class DiscoveryRunner:
    def __init__(self, config: Optional[DiscoveryConfig] = None):
        self.config = config or DiscoveryConfig()
        self.live_validator = LiveValidator()  # Initialize validator

    async def run_discovery(self, ...):
        # ... existing code ...

        # After analyzing any page:
        page_info = await self._analyze_page_enhanced(...)

        # 🆕 ADD LIVE VALIDATION HERE
        validation_results = await self.live_validator.validate_page_live(
            page=page,
            page_info=page_info,
            run_id=run_id,
            artifacts_path=artifacts_path
        )
        page_info["validation_results"] = validation_results

        visited_pages.append(page_info)

        # ... continue discovery ...

        # At end of discovery, save validation stats
        validation_stats = self.live_validator.get_validation_stats()
        await self._save_validation_report(run_id, artifacts_path, validation_stats)
```

## Save Validation Report

Add this method to `DiscoveryRunner`:

```python
async def _save_validation_report(
    self,
    run_id: str,
    artifacts_path: Path,
    validation_stats: Dict[str, Any]
):
    """Save comprehensive validation report."""
    report_file = artifacts_path / "validation_report.json"

    report = {
        "run_id": run_id,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "statistics": validation_stats,
        "pages_validated": [
            {
                "page_url": page.get("url"),
                "page_name": page.get("page_signature", {}).get("page_name"),
                "validation_results": page.get("validation_results", {})
            }
            for page in self.visited_pages
            if "validation_results" in page
        ]
    }

    with open(report_file, "w") as f:
        json.dump(report, f, indent=2)

    logger.info(f"[{run_id}] 💾 Saved validation report: {report_file}")
```

## UI Integration

### 1. Add Validation Dashboard Tab

In `ui/index.html`, add new tab:

```html
<div class="app-tabs">
    <div class="app-tab active" onclick="switchAppTab('testcases')">✅ Test Cases</div>
    <div class="app-tab" onclick="switchAppTab('progress')">📊 Live Progress</div>
    <div class="app-tab" onclick="switchAppTab('validation')">🧪 Live Validation</div> <!-- NEW -->
    <div class="app-tab" onclick="switchAppTab('history')">📜 Run History</div>
</div>
```

### 2. Add Validation View

```html
<div id="validation_view" class="tab-content" style="display:none;">
    <h2>🧪 Live Validation Results</h2>

    <!-- Summary Cards -->
    <div class="validation-summary">
        <div class="summary-card passed">
            <div class="card-value" id="validation_passed">0</div>
            <div class="card-label">Validations Passed</div>
        </div>
        <div class="summary-card failed">
            <div class="card-value" id="validation_failed">0</div>
            <div class="card-label">Validations Failed</div>
        </div>
        <div class="summary-card rate">
            <div class="card-value" id="validation_rate">0%</div>
            <div class="card-label">Pass Rate</div>
        </div>
    </div>

    <!-- Validation Feed -->
    <div id="validation_feed" class="live-feed">
        <!-- Populated by JavaScript -->
    </div>
</div>
```

### 3. Handle Validation Events

```javascript
// In index.html <script> section

function handleLiveValidationEvent(event) {
    const { page_name, page_url, passed, failed, skipped, validations } = event.data;

    // Update counters
    updateValidationCounters(passed, failed);

    // Add to feed
    const feedHtml = `
        <div class="validation-result ${failed > 0 ? 'has-failures' : 'all-passed'}">
            <div class="validation-header">
                <strong>${page_name}</strong>
                <span class="validation-stats">
                    ✅ ${passed} | ❌ ${failed} | ⏭️ ${skipped}
                </span>
            </div>
            <div class="validation-details">
                ${validations.map(v => `
                    <div class="validation-item ${v.status}">
                        <span class="validation-icon">${getValidationIcon(v.status)}</span>
                        <span class="validation-name">${v.name}</span>
                        <span class="validation-severity">${v.severity}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    document.getElementById('validation_feed').insertAdjacentHTML('afterbegin', feedHtml);
}

function updateValidationCounters(passed, failed) {
    const passedElem = document.getElementById('validation_passed');
    const failedElem = document.getElementById('validation_failed');
    const rateElem = document.getElementById('validation_rate');

    const currentPassed = parseInt(passedElem.textContent) + passed;
    const currentFailed = parseInt(failedElem.textContent) + failed;
    const total = currentPassed + currentFailed;
    const passRate = total > 0 ? Math.round((currentPassed / total) * 100) : 0;

    passedElem.textContent = currentPassed;
    failedElem.textContent = currentFailed;
    rateElem.textContent = passRate + '%';
}

function getValidationIcon(status) {
    switch(status) {
        case 'passed': return '✅';
        case 'failed': return '❌';
        case 'skipped': return '⏭️';
        default: return '⏳';
    }
}

// Listen for validation events
function handleEvent(event) {
    // ... existing event handling ...

    if (event.type === 'live_validation_completed') {
        handleLiveValidationEvent(event);
    }
}
```

## Testing Integration

### 1. Run Discovery with Live Validation

```bash
cd agent-api
python -m pytest tests/test_live_validation.py -v
```

### 2. Test on Actual Portal

```bash
# Start server
uvicorn app.main:app --reload

# In UI:
# 1. Enter URL: https://n1devcmp-user.airteldev.com
# 2. Username: testapi
# 3. Password: Welcome@123
# 4. Click "Start Discovery"
# 5. Switch to "🧪 Live Validation" tab
# 6. Watch real-time validation results
```

### 3. Expected Output

```
Discovery Progress:
================================================================================
Page 1/10: Virtual Machine as a Service (VMaaS)
  🧪 LIVE VALIDATION
  ✅ Listing Validation - PASSED
     ✓ Table element visible
     ✓ Table has column headers (8 headers)
     ✓ Table has data rows (15 rows)
     ✓ Rows have cells with data
  ✅ Pagination Validation - PASSED
     ✓ Pagination controls visible
     ✓ Next button present and works
     ✓ Previous button works
  ✅ Search Validation - PASSED
     ✓ Search input visible and enabled
     ✓ Search filters results
  ❌ Filter Validation - FAILED
     ✗ Filter controls not found
  ⏭️ CRUD Operations - SKIPPED (coming soon)

  Summary: 3 passed, 1 failed, 1 skipped
================================================================================
```

## Benefits

### Immediate (Phase 1)
- ✅ Real-time validation during discovery
- ✅ See what's working/broken immediately
- ✅ Comprehensive FILTER, SEARCH, PAGINATION, LISTING checks
- ✅ Foundation for complete testing (CRUD, forms, bulk ops)

### Short-term (Phase 2)
- ✅ Predictable test coverage
- ✅ "Expected: 127 | Generated: 127"
- ✅ Complete sanity & regression testing

### Long-term (Phases 3-6)
- ✅ PRD/Figma/Jira integration
- ✅ Mature test execution (parallel, retry)
- ✅ Beautiful comprehensive reports
- ✅ CI/CD integration

## Next Steps

1. ✅ **Integrate LiveValidator into discovery_runner.py** (this guide)
2. ✅ **Add UI validation dashboard** (HTML/CSS/JS)
3. ✅ **Test on actual portal** (https://n1devcmp-user.airteldev.com)
4. ✅ **Iterate based on findings**
5. 🔜 **Expand to comprehensive CRUD validation**
6. 🔜 **Add predictable test coverage matrix**
7. 🔜 **Integrate PRD/Figma/Jira**

---

## Quick Start (5 Minutes)

```bash
# 1. Code is ready in live_validator.py ✅

# 2. Integrate into discovery (add 3 lines):
# - Import LiveValidator
# - Initialize in __init__
# - Call validate_page_live after analyze_page

# 3. Add UI tab (copy HTML from above)

# 4. Test!
uvicorn app.main:app --reload
# Open http://localhost:8000/ui
# Start discovery
# Watch live validation ✅
```

🎯 **You'll see real-time validation as discovery progresses!**

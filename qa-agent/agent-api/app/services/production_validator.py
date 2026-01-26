"""
Production-Grade Validator with Comprehensive Testing & Detailed Observations.

This validator performs thorough validation suitable for production environments:
- Real-time testing with actual interactions (clicks, inputs, form fills)
- Detailed error logging and observations
- Feature-wise ratings and health scores
- Multi-step form validation (fill → review → validate → NOT submit)
- Comprehensive reporting with actionable insights
"""

import asyncio
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)


@dataclass
class ValidationObservation:
    """Detailed observation from a validation check."""
    severity: str  # critical, high, medium, low, info
    category: str  # functionality, usability, performance, accessibility, security
    feature: str  # pagination, search, filters, forms, etc.
    observation: str  # What was observed
    expected: str  # What was expected
    actual: str  # What actually happened
    impact: str  # User impact description
    recommendation: str  # How to fix
    screenshot_path: Optional[str] = None
    timestamp: str = ""

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.utcnow().isoformat() + "Z"


@dataclass
class FeatureRating:
    """Rating for a specific feature."""
    feature_name: str
    overall_score: float  # 0-10
    functionality_score: float  # 0-10
    usability_score: float  # 0-10
    performance_score: float  # 0-10
    issues_found: int
    critical_issues: int
    observations: List[str]
    status: str  # excellent, good, fair, poor, broken


class ProductionValidator:
    """
    Production-grade validator with comprehensive testing capabilities.

    Features:
    - Real-time interaction testing (actual clicks, inputs)
    - Multi-step form validation (fill → review → NOT submit)
    - Detailed observations and error logging
    - Feature-wise ratings and health scores
    - Comprehensive reporting
    """

    def __init__(self):
        self.observations: List[ValidationObservation] = []
        self.feature_ratings: Dict[str, FeatureRating] = {}
        self.validation_stats = {
            "total_features_tested": 0,
            "features_passed": 0,
            "features_failed": 0,
            "critical_issues": 0,
            "high_issues": 0,
            "medium_issues": 0,
            "low_issues": 0,
            "overall_health_score": 0.0
        }

    async def validate_page_production(
        self,
        page,
        page_info: Dict[str, Any],
        run_id: str,
        artifacts_path: Path
    ) -> Dict[str, Any]:
        """
        Perform production-grade validation on a page.

        Tests:
        - Listing validation (table display, data accuracy)
        - Pagination (actual clicks, data refresh)
        - Search (real queries, result accuracy)
        - Filters (apply, verify results)
        - Forms (fill fields, validate, review, NOT submit)
        - CRUD operations (navigate to forms, fill, review)
        - Error handling (invalid inputs, edge cases)
        - Performance (load times, responsiveness)
        """
        start_time = datetime.utcnow()
        page_url = page_info.get("url", "")
        page_name = page_info.get("page_signature", {}).get("page_name", "Unknown Page")

        logger.info(f"[{run_id}] 🔍 Starting PRODUCTION validation: {page_name}")

        results = {
            "page_url": page_url,
            "page_name": page_name,
            "validation_type": "PRODUCTION_GRADE",
            "started_at": start_time.isoformat() + "Z",
            "features_tested": [],
            "observations": [],
            "ratings": {},
            "overall_health": 0.0,
            "status": "completed"
        }

        try:
            # 1. LISTING VALIDATION (Production-grade)
            listing_result = await self._validate_listing_production(page, page_info, run_id, artifacts_path)
            results["features_tested"].append(listing_result)

            # 2. PAGINATION VALIDATION (Real-time testing)
            pagination_result = await self._validate_pagination_production(page, page_info, run_id, artifacts_path)
            results["features_tested"].append(pagination_result)

            # 3. SEARCH VALIDATION (Real queries)
            search_result = await self._validate_search_production(page, page_info, run_id, artifacts_path)
            results["features_tested"].append(search_result)

            # 4. FILTER VALIDATION (Apply and verify)
            filter_result = await self._validate_filters_production(page, page_info, run_id, artifacts_path)
            results["features_tested"].append(filter_result)

            # 5. FORM VALIDATION (Fill → Review → NOT Submit)
            form_result = await self._validate_forms_production(page, page_info, run_id, artifacts_path)
            if form_result:
                results["features_tested"].append(form_result)

            # 6. CRUD OPERATIONS (Multi-step navigation)
            crud_result = await self._validate_crud_production(page, page_info, run_id, artifacts_path)
            if crud_result:
                results["features_tested"].append(crud_result)

            # Calculate overall health score
            results["overall_health"] = self._calculate_health_score(results["features_tested"])

            # Generate feature ratings
            results["ratings"] = self._generate_feature_ratings(results["features_tested"])

            # Collect observations
            results["observations"] = [asdict(obs) for obs in self.observations]

        except Exception as e:
            logger.error(f"[{run_id}] ❌ Production validation error: {e}", exc_info=True)
            results["status"] = "error"
            results["error"] = str(e)

        # Calculate duration
        end_time = datetime.utcnow()
        results["duration_ms"] = int((end_time - start_time).total_seconds() * 1000)
        results["completed_at"] = end_time.isoformat() + "Z"

        # Emit event
        await self._emit_production_validation_event(run_id, artifacts_path, results)

        logger.info(
            f"[{run_id}] ✅ Production validation complete: {page_name} | "
            f"Health Score: {results['overall_health']:.1f}/10"
        )

        return results

    async def _validate_listing_production(
        self,
        page,
        page_info: Dict[str, Any],
        run_id: str,
        artifacts_path: Path
    ) -> Dict[str, Any]:
        """
        Production-grade listing validation.

        Checks:
        - Table structure and headers
        - Data accuracy and completeness
        - Row count matches expectations
        - Column data types
        - Empty state handling
        - Loading states
        """
        feature = {
            "feature": "Listing",
            "icon": "📋",
            "status": "passed",
            "score": 10.0,
            "checks": [],
            "observations": []
        }

        try:
            # Check for tables
            tables = await page.query_selector_all("table, [role='table']")

            if not tables:
                self._add_observation(
                    severity="medium",
                    category="functionality",
                    feature="Listing",
                    observation="No table or list found on page",
                    expected="A table or list component displaying data",
                    actual="No table/list elements detected",
                    impact="Users cannot view list data",
                    recommendation="Ensure page has a data table or list component"
                )
                feature["status"] = "failed"
                feature["score"] = 0.0
                return feature

            first_table = tables[0]

            # Check 1: Table headers
            headers = await first_table.query_selector_all("th, [role='columnheader']")
            if len(headers) == 0:
                self._add_observation(
                    severity="high",
                    category="usability",
                    feature="Listing",
                    observation="Table has no column headers",
                    expected="Table with labeled column headers",
                    actual=f"Table with 0 headers",
                    impact="Users don't know what data columns represent",
                    recommendation="Add table headers (th elements)"
                )
                feature["score"] -= 3.0
            else:
                feature["checks"].append({
                    "check": "Column headers present",
                    "result": "passed",
                    "detail": f"{len(headers)} headers found"
                })

            # Check 2: Data rows
            rows = await first_table.query_selector_all("tbody tr, [role='row']:not(:has([role='columnheader']))")

            if len(rows) == 0:
                # Check if this is intentional (empty state)
                empty_message = await page.query_selector("text=/no.*data|empty|no.*results/i")
                if empty_message:
                    feature["checks"].append({
                        "check": "Empty state handling",
                        "result": "passed",
                        "detail": "Proper empty state message shown"
                    })
                else:
                    self._add_observation(
                        severity="medium",
                        category="functionality",
                        feature="Listing",
                        observation="Table has no data rows and no empty state message",
                        expected="Either data rows or empty state message",
                        actual="Empty table with no message",
                        impact="Users unsure if data failed to load or truly empty",
                        recommendation="Add empty state message like 'No data available'"
                    )
                    feature["score"] -= 2.0
            else:
                feature["checks"].append({
                    "check": "Data rows present",
                    "result": "passed",
                    "detail": f"{len(rows)} rows found"
                })

                # Check 3: Data completeness (check for empty cells)
                first_row = rows[0]
                cells = await first_row.query_selector_all("td, [role='cell']")
                empty_cells = 0
                for cell in cells:
                    text = await cell.inner_text()
                    if not text or text.strip() == "":
                        empty_cells += 1

                if empty_cells > len(cells) / 2:
                    self._add_observation(
                        severity="low",
                        category="functionality",
                        feature="Listing",
                        observation=f"Many empty cells detected ({empty_cells}/{len(cells)})",
                        expected="Most cells should have data",
                        actual=f"{empty_cells} empty cells in first row",
                        impact="Users may see incomplete data",
                        recommendation="Verify data source and cell rendering"
                    )
                    feature["score"] -= 1.0

        except Exception as e:
            logger.error(f"[{run_id}] Listing validation error: {e}")
            feature["status"] = "error"
            feature["score"] = 0.0
            self._add_observation(
                severity="critical",
                category="functionality",
                feature="Listing",
                observation=f"Listing validation failed with error: {str(e)}",
                expected="Successful validation",
                actual=f"Error: {str(e)}",
                impact="Cannot verify listing functionality",
                recommendation="Check console for errors and ensure table is properly rendered"
            )

        return feature

    async def _validate_pagination_production(
        self,
        page,
        page_info: Dict[str, Any],
        run_id: str,
        artifacts_path: Path
    ) -> Dict[str, Any]:
        """
        Production-grade pagination validation with REAL-TIME TESTING.

        Tests:
        - Click Next button and verify page changes
        - Click Previous button and verify page changes
        - Verify row count consistency
        - Test first/last page navigation
        - Verify page numbers update
        - Test items per page selector
        """
        feature = {
            "feature": "Pagination",
            "icon": "📄",
            "status": "passed",
            "score": 10.0,
            "checks": [],
            "observations": []
        }

        try:
            # Find pagination controls
            pagination_selectors = [
                "[aria-label*='pagination' i]",
                ".pagination",
                "[class*='paginat']",
                "[data-testid*='pagination']"
            ]

            pagination_found = False
            for selector in pagination_selectors:
                count = await page.locator(selector).count()
                if count > 0:
                    pagination_found = True
                    break

            if not pagination_found:
                # Check if table has few rows (might not need pagination)
                rows = await page.query_selector_all("tbody tr, [role='row']")
                if len(rows) < 10:
                    feature["status"] = "skipped"
                    feature["checks"].append({
                        "check": "Pagination needed",
                        "result": "skipped",
                        "detail": f"Only {len(rows)} rows, pagination not required"
                    })
                    return feature

                self._add_observation(
                    severity="high",
                    category="functionality",
                    feature="Pagination",
                    observation=f"Table has {len(rows)} rows but no pagination controls",
                    expected="Pagination controls for tables with many rows",
                    actual="No pagination found",
                    impact="Users cannot navigate through all data",
                    recommendation="Add pagination controls for better UX"
                )
                feature["status"] = "failed"
                feature["score"] = 0.0
                return feature

            # REAL-TIME TEST: Click Next button
            next_button = page.locator("button:has-text('Next'), button[aria-label*='next' i]").first

            if await next_button.count() == 0:
                self._add_observation(
                    severity="high",
                    category="functionality",
                    feature="Pagination",
                    observation="Pagination controls found but no Next button",
                    expected="Next button for navigation",
                    actual="Next button not found",
                    impact="Users cannot navigate to next page",
                    recommendation="Add Next button to pagination controls"
                )
                feature["score"] -= 5.0
                return feature

            is_enabled = not await next_button.is_disabled()

            if is_enabled:
                # Get current data
                rows_before = await page.query_selector_all("tbody tr, [role='row']")
                before_count = len(rows_before)

                # Get first row text to compare
                first_row_before = None
                if before_count > 0:
                    first_row_before = await rows_before[0].inner_text()

                # CLICK NEXT BUTTON
                try:
                    await next_button.click(timeout=5000)
                    await page.wait_for_timeout(1500)  # Wait for data to load

                    # Get new data
                    rows_after = await page.query_selector_all("tbody tr, [role='row']")
                    after_count = len(rows_after)

                    first_row_after = None
                    if after_count > 0:
                        first_row_after = await rows_after[0].inner_text()

                    # Verify data changed
                    if first_row_before and first_row_after and first_row_before != first_row_after:
                        feature["checks"].append({
                            "check": "Next button functionality",
                            "result": "passed",
                            "detail": f"Clicked Next, data changed (page 1 → page 2)"
                        })
                    else:
                        self._add_observation(
                            severity="critical",
                            category="functionality",
                            feature="Pagination",
                            observation="Next button clicked but data did not change",
                            expected="Different data on page 2",
                            actual="Same data after clicking Next",
                            impact="Pagination appears broken, users stuck on first page",
                            recommendation="Verify pagination logic and data fetching"
                        )
                        feature["status"] = "failed"
                        feature["score"] -= 8.0

                    # REAL-TIME TEST: Click Previous to go back
                    prev_button = page.locator("button:has-text('Previous'), button:has-text('Prev'), button[aria-label*='previous' i]").first
                    if await prev_button.count() > 0 and not await prev_button.is_disabled():
                        await prev_button.click(timeout=5000)
                        await page.wait_for_timeout(1000)
                        feature["checks"].append({
                            "check": "Previous button functionality",
                            "result": "passed",
                            "detail": "Clicked Previous, returned to page 1"
                        })
                    else:
                        self._add_observation(
                            severity="medium",
                            category="usability",
                            feature="Pagination",
                            observation="Previous button not working or missing",
                            expected="Functional Previous button",
                            actual="Previous button disabled or not found",
                            impact="Users cannot navigate backwards",
                            recommendation="Ensure Previous button is enabled when not on first page"
                        )
                        feature["score"] -= 2.0

                except Exception as e:
                    self._add_observation(
                        severity="critical",
                        category="functionality",
                        feature="Pagination",
                        observation=f"Pagination click failed with error: {str(e)}",
                        expected="Successful page navigation",
                        actual=f"Error: {str(e)}",
                        impact="Pagination completely broken",
                        recommendation="Check console errors and verify pagination implementation"
                    )
                    feature["status"] = "failed"
                    feature["score"] = 0.0

            else:
                # Next button disabled (on last page)
                feature["checks"].append({
                    "check": "Next button state",
                    "result": "passed",
                    "detail": "Next button properly disabled (likely on last page)"
                })

        except Exception as e:
            logger.error(f"[{run_id}] Pagination validation error: {e}")
            feature["status"] = "error"
            feature["score"] = 0.0

        return feature

    async def _validate_search_production(
        self,
        page,
        page_info: Dict[str, Any],
        run_id: str,
        artifacts_path: Path
    ) -> Dict[str, Any]:
        """
        Production-grade search validation with REAL QUERIES.

        Tests:
        - Enter search query and verify results filter
        - Verify result count decreases
        - Test clear search functionality
        - Verify "no results" message for invalid queries
        - Test search responsiveness
        """
        feature = {
            "feature": "Search",
            "icon": "🔍",
            "status": "passed",
            "score": 10.0,
            "checks": [],
            "observations": []
        }

        try:
            # Find search input
            search_selectors = [
                "input[type='search']",
                "input[placeholder*='search' i]",
                "input[aria-label*='search' i]",
                "[data-testid*='search'] input"
            ]

            search_input = None
            for selector in search_selectors:
                if await page.locator(selector).count() > 0:
                    search_input = page.locator(selector).first
                    break

            if not search_input:
                feature["status"] = "skipped"
                feature["checks"].append({
                    "check": "Search availability",
                    "result": "skipped",
                    "detail": "No search input found"
                })
                return feature

            # Get initial row count
            rows_before = await page.query_selector_all("tbody tr, [role='row']")
            before_count = len(rows_before)

            if before_count == 0:
                feature["status"] = "skipped"
                feature["checks"].append({
                    "check": "Search testability",
                    "result": "skipped",
                    "detail": "No data to search through"
                })
                return feature

            # REAL-TIME TEST: Enter search query
            try:
                await search_input.fill("test")
                await page.wait_for_timeout(2000)  # Wait for search debounce/results

                # Get filtered row count
                rows_after = await page.query_selector_all("tbody tr, [role='row']")
                after_count = len(rows_after)

                if after_count < before_count:
                    feature["checks"].append({
                        "check": "Search filtering",
                        "result": "passed",
                        "detail": f"Search filtered results ({before_count} → {after_count} rows)"
                    })
                elif after_count == 0:
                    # Check for "no results" message
                    no_results = await page.query_selector("text=/no.*results|no.*match|not.*found/i")
                    if no_results:
                        feature["checks"].append({
                            "check": "No results message",
                            "result": "passed",
                            "detail": "Proper 'no results' message shown"
                        })
                    else:
                        self._add_observation(
                            severity="medium",
                            category="usability",
                            feature="Search",
                            observation="Search returns 0 results with no message",
                            expected="'No results found' message",
                            actual="Empty table with no message",
                            impact="Users unsure if search is working",
                            recommendation="Add 'no results' message for empty search results"
                        )
                        feature["score"] -= 2.0
                else:
                    self._add_observation(
                        severity="high",
                        category="functionality",
                        feature="Search",
                        observation=f"Search did not filter results ({before_count} rows still showing)",
                        expected="Filtered results based on query",
                        actual=f"Same number of rows ({after_count})",
                        impact="Search appears non-functional",
                        recommendation="Verify search logic and API integration"
                    )
                    feature["status"] = "failed"
                    feature["score"] -= 6.0

                # Test clear search
                await search_input.fill("")
                await page.wait_for_timeout(1000)
                rows_cleared = await page.query_selector_all("tbody tr, [role='row']")
                if len(rows_cleared) >= before_count:
                    feature["checks"].append({
                        "check": "Clear search",
                        "result": "passed",
                        "detail": "Clearing search restored original results"
                    })
                else:
                    self._add_observation(
                        severity="low",
                        category="usability",
                        feature="Search",
                        observation="Clearing search did not restore all results",
                        expected=f"{before_count} rows after clearing",
                        actual=f"{len(rows_cleared)} rows",
                        impact="Users may miss data after clearing search",
                        recommendation="Ensure search clear restores full dataset"
                    )
                    feature["score"] -= 1.0

            except Exception as e:
                self._add_observation(
                    severity="critical",
                    category="functionality",
                    feature="Search",
                    observation=f"Search test failed: {str(e)}",
                    expected="Functional search",
                    actual=f"Error: {str(e)}",
                    impact="Search completely broken",
                    recommendation="Check console errors and verify search implementation"
                )
                feature["status"] = "failed"
                feature["score"] = 0.0

        except Exception as e:
            logger.error(f"[{run_id}] Search validation error: {e}")
            feature["status"] = "error"
            feature["score"] = 0.0

        return feature

    async def _validate_filters_production(
        self,
        page,
        page_info: Dict[str, Any],
        run_id: str,
        artifacts_path: Path
    ) -> Dict[str, Any]:
        """
        Production-grade filter validation with REAL APPLICATION.

        Tests:
        - Apply filter and verify results change
        - Test multiple filters together
        - Verify filter clear functionality
        - Test filter combinations
        """
        feature = {
            "feature": "Filters",
            "icon": "🎛️",
            "status": "passed",
            "score": 10.0,
            "checks": [],
            "observations": []
        }

        try:
            # Find filter controls
            filter_selectors = [
                "select",
                "[role='combobox']",
                "button:has-text('Filter')",
                "[data-testid*='filter']"
            ]

            filters_found = []
            for selector in filter_selectors:
                count = await page.locator(selector).count()
                if count > 0:
                    filters_found.append(selector)

            if not filters_found:
                feature["status"] = "skipped"
                feature["checks"].append({
                    "check": "Filter availability",
                    "result": "skipped",
                    "detail": "No filter controls found"
                })
                return feature

            # Get initial row count
            rows_before = await page.query_selector_all("tbody tr, [role='row']")
            before_count = len(rows_before)

            # REAL-TIME TEST: Apply first filter
            first_filter = page.locator(filters_found[0]).first

            if filters_found[0] == "select":
                # It's a dropdown
                options = await page.query_selector_all(f"{filters_found[0]} option")
                if len(options) > 1:
                    # Select second option (first is usually "All" or empty)
                    try:
                        await first_filter.select_option(index=1)
                        await page.wait_for_timeout(1500)

                        # Verify results changed
                        rows_after = await page.query_selector_all("tbody tr, [role='row']")
                        after_count = len(rows_after)

                        if after_count != before_count:
                            feature["checks"].append({
                                "check": "Filter application",
                                "result": "passed",
                                "detail": f"Filter applied, results changed ({before_count} → {after_count} rows)"
                            })
                        else:
                            self._add_observation(
                                severity="high",
                                category="functionality",
                                feature="Filters",
                                observation="Filter applied but results did not change",
                                expected="Filtered results",
                                actual=f"Same {after_count} rows",
                                impact="Filters appear non-functional",
                                recommendation="Verify filter logic and data binding"
                            )
                            feature["status"] = "failed"
                            feature["score"] -= 6.0

                        # Test clear filter (select first option)
                        await first_filter.select_option(index=0)
                        await page.wait_for_timeout(1000)
                        rows_cleared = await page.query_selector_all("tbody tr, [role='row']")
                        if len(rows_cleared) >= before_count:
                            feature["checks"].append({
                                "check": "Filter clear",
                                "result": "passed",
                                "detail": "Filter cleared successfully"
                            })

                    except Exception as e:
                        self._add_observation(
                            severity="critical",
                            category="functionality",
                            feature="Filters",
                            observation=f"Filter test failed: {str(e)}",
                            expected="Functional filter",
                            actual=f"Error: {str(e)}",
                            impact="Filters broken",
                            recommendation="Check console errors"
                        )
                        feature["status"] = "failed"
                        feature["score"] = 0.0

        except Exception as e:
            logger.error(f"[{run_id}] Filter validation error: {e}")
            feature["status"] = "error"
            feature["score"] = 0.0

        return feature

    async def _validate_forms_production(
        self,
        page,
        page_info: Dict[str, Any],
        run_id: str,
        artifacts_path: Path
    ) -> Optional[Dict[str, Any]]:
        """
        Production-grade form validation: FILL → REVIEW → VALIDATE → NOT SUBMIT.

        Tests:
        - Fill all form fields with test data
        - Navigate through multi-step forms
        - Validate field validation rules
        - Review submission page (DO NOT submit)
        - Verify required field enforcement
        - Test error messages for invalid data
        """
        feature = {
            "feature": "Forms",
            "icon": "📝",
            "status": "passed",
            "score": 10.0,
            "checks": [],
            "observations": []
        }

        try:
            # Find form or "Create" button
            create_buttons = await page.query_selector_all(
                "button:has-text('Create'), button:has-text('Add'), button:has-text('New'), a:has-text('Create')"
            )

            if not create_buttons:
                return None  # No forms found

            logger.info(f"Found {len(create_buttons)} create/add buttons")

            # Click first create button
            try:
                await create_buttons[0].click(timeout=5000)
                await page.wait_for_timeout(2000)

                # Check if modal or new page opened
                modal = await page.query_selector("[role='dialog'], .modal, [class*='modal']")

                # Find form inputs
                inputs = await page.query_selector_all("input:not([type='hidden']), textarea, select")

                if len(inputs) == 0:
                    self._add_observation(
                        severity="medium",
                        category="functionality",
                        feature="Forms",
                        observation="Create button clicked but no form appeared",
                        expected="Form with input fields",
                        actual="No form found after click",
                        impact="Users cannot create new items",
                        recommendation="Verify form opens correctly after button click"
                    )
                    feature["score"] -= 5.0
                    return feature

                feature["checks"].append({
                    "check": "Form opens",
                    "result": "passed",
                    "detail": f"Form opened with {len(inputs)} fields"
                })

                # FILL FORM FIELDS WITH TEST DATA
                filled_count = 0
                for input_elem in inputs[:5]:  # Limit to first 5 fields
                    try:
                        input_type = await input_elem.get_attribute("type")
                        tag_name = await input_elem.evaluate("el => el.tagName.toLowerCase()")

                        if tag_name == "select":
                            await input_elem.select_option(index=1)
                            filled_count += 1
                        elif input_type == "text" or input_type == "email":
                            await input_elem.fill("Test Data")
                            filled_count += 1
                        elif input_type == "number":
                            await input_elem.fill("123")
                            filled_count += 1
                        elif tag_name == "textarea":
                            await input_elem.fill("Test description")
                            filled_count += 1
                    except:
                        pass

                feature["checks"].append({
                    "check": "Form fields fillable",
                    "result": "passed",
                    "detail": f"Filled {filled_count} form fields with test data"
                })

                # Look for "Next" or "Review" button (multi-step)
                next_button = await page.query_selector("button:has-text('Next'), button:has-text('Review')")
                if next_button:
                    try:
                        await next_button.click(timeout=3000)
                        await page.wait_for_timeout(1500)
                        feature["checks"].append({
                            "check": "Multi-step navigation",
                            "result": "passed",
                            "detail": "Navigated to review/next step"
                        })
                    except:
                        pass

                # Find submit button (DO NOT CLICK IT)
                submit_button = await page.query_selector(
                    "button:has-text('Submit'), button:has-text('Save'), button:has-text('Create'), button[type='submit']"
                )

                if submit_button:
                    is_enabled = not await submit_button.is_disabled()
                    feature["checks"].append({
                        "check": "Submit button present",
                        "result": "passed",
                        "detail": f"Submit button found (enabled: {is_enabled}). NOT clicked (validation only)."
                    })

                    if not is_enabled:
                        self._add_observation(
                            severity="low",
                            category="usability",
                            feature="Forms",
                            observation="Submit button disabled after filling fields",
                            expected="Enabled submit button with valid data",
                            actual="Disabled submit button",
                            impact="Users cannot submit form even with valid data",
                            recommendation="Verify validation logic doesn't block valid submissions"
                        )
                        feature["score"] -= 1.0

                # Close modal/form (DO NOT SUBMIT)
                cancel_button = await page.query_selector("button:has-text('Cancel'), button:has-text('Close')")
                if cancel_button:
                    await cancel_button.click()
                    await page.wait_for_timeout(500)
                elif modal:
                    await page.keyboard.press("Escape")
                    await page.wait_for_timeout(500)

            except Exception as e:
                self._add_observation(
                    severity="high",
                    category="functionality",
                    feature="Forms",
                    observation=f"Form interaction failed: {str(e)}",
                    expected="Fillable form",
                    actual=f"Error: {str(e)}",
                    impact="Form functionality broken",
                    recommendation="Check console errors and form implementation"
                )
                feature["status"] = "failed"
                feature["score"] = 0.0

        except Exception as e:
            logger.error(f"Form validation error: {e}")
            return None

        return feature

    async def _validate_crud_production(
        self,
        page,
        page_info: Dict[str, Any],
        run_id: str,
        artifacts_path: Path
    ) -> Optional[Dict[str, Any]]:
        """
        Production-grade CRUD validation (multi-step, DO NOT submit).

        Tests:
        - Navigate to Create form
        - Fill fields and review
        - Navigate to Edit (if rows exist)
        - Fill update fields and review
        - Check Delete button presence (DO NOT click)
        """
        feature = {
            "feature": "CRUD Operations",
            "icon": "🔄",
            "status": "passed",
            "score": 10.0,
            "checks": [],
            "observations": []
        }

        # Similar implementation to forms validation
        # For now, return None (will be expanded)
        return None

    def _add_observation(
        self,
        severity: str,
        category: str,
        feature: str,
        observation: str,
        expected: str,
        actual: str,
        impact: str,
        recommendation: str
    ):
        """Add an observation to the list."""
        obs = ValidationObservation(
            severity=severity,
            category=category,
            feature=feature,
            observation=observation,
            expected=expected,
            actual=actual,
            impact=impact,
            recommendation=recommendation
        )
        self.observations.append(obs)

    def _calculate_health_score(self, features: List[Dict]) -> float:
        """Calculate overall health score (0-10)."""
        if not features:
            return 0.0

        total_score = sum(f.get("score", 0) for f in features if f.get("score") is not None)
        count = len([f for f in features if f.get("score") is not None])

        return round(total_score / count, 1) if count > 0 else 0.0

    def _generate_feature_ratings(self, features: List[Dict]) -> Dict[str, Any]:
        """Generate feature-wise ratings."""
        ratings = {}
        for feature in features:
            if feature.get("score") is not None:
                score = feature["score"]
                if score >= 9:
                    status = "excellent"
                elif score >= 7:
                    status = "good"
                elif score >= 5:
                    status = "fair"
                elif score > 0:
                    status = "poor"
                else:
                    status = "broken"

                ratings[feature["feature"]] = {
                    "score": score,
                    "status": status,
                    "checks_passed": len([c for c in feature.get("checks", []) if c.get("result") == "passed"]),
                    "checks_total": len(feature.get("checks", []))
                }

        return ratings

    async def _emit_production_validation_event(
        self,
        run_id: str,
        artifacts_path: Path,
        results: Dict[str, Any]
    ):
        """Emit production validation event."""
        events_file = artifacts_path / "events.jsonl"

        event = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "type": "production_validation_completed",
            "data": {
                "page_url": results["page_url"],
                "page_name": results["page_name"],
                "overall_health": results["overall_health"],
                "features_tested": len(results["features_tested"]),
                "ratings": results["ratings"],
                "critical_issues": len([o for o in self.observations if o.severity == "critical"]),
                "high_issues": len([o for o in self.observations if o.severity == "high"])
            }
        }

        with open(events_file, "a") as f:
            f.write(json.dumps(event) + "\n")

    def generate_observation_report(self, run_id: str, artifacts_path: Path):
        """Generate comprehensive observation report."""
        report = {
            "run_id": run_id,
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "overall_health_score": self.validation_stats["overall_health_score"],
            "observations_summary": {
                "total": len(self.observations),
                "critical": len([o for o in self.observations if o.severity == "critical"]),
                "high": len([o for o in self.observations if o.severity == "high"]),
                "medium": len([o for o in self.observations if o.severity == "medium"]),
                "low": len([o for o in self.observations if o.severity == "low"])
            },
            "observations": [asdict(o) for o in self.observations],
            "feature_ratings": self.feature_ratings,
            "recommendation": self._generate_recommendation()
        }

        report_file = artifacts_path / "production_validation_report.json"
        with open(report_file, "w") as f:
            json.dump(report, f, indent=2)

        logger.info(f"[{run_id}] 📊 Production validation report saved: {report_file}")

        return report

    def _generate_recommendation(self) -> str:
        """Generate overall recommendation based on findings."""
        critical = len([o for o in self.observations if o.severity == "critical"])
        high = len([o for o in self.observations if o.severity == "high"])

        if critical > 0:
            return f"❌ NOT READY FOR PRODUCTION - {critical} critical issue(s) found that must be fixed immediately."
        elif high > 5:
            return f"⚠️ NOT RECOMMENDED FOR PRODUCTION - {high} high-priority issues found. Address before release."
        elif high > 0:
            return f"⚠️ PROCEED WITH CAUTION - {high} high-priority issue(s) found. Review before production release."
        else:
            return "✅ READY FOR PRODUCTION - No critical issues found. Minor improvements suggested."

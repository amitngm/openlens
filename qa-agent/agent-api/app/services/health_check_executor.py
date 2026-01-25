"""
Health Check Executor with Parallel Execution Support.

Executes comprehensive health checks on discovered pages including:
- Pagination validation
- Search functionality testing
- Filter controls testing
- Table listing validation
- Sort functionality testing

Features:
- Parallel execution with configurable concurrency
- Real-time event streaming to UI
- Individual check timeout handling
- Automatic screenshot capture on failures
"""

import asyncio
import json
import logging
from typing import List, Dict
from datetime import datetime
from pathlib import Path

from app.models.health_check import (
    HealthCheckType, HealthCheckStatus, HealthCheckResult,
    PageHealthCheck, HealthCheckReport
)

logger = logging.getLogger(__name__)


class HealthCheckExecutor:
    """Execute health checks in parallel with real-time event streaming."""

    def __init__(self, max_concurrent: int = 3):
        """
        Initialize health check executor.

        Args:
            max_concurrent: Maximum number of pages to validate concurrently (default: 3)
        """
        self.max_concurrent = max_concurrent

    async def execute_health_checks(
        self,
        run_id: str,
        pages: List[Dict],
        browser_context,
        debug: bool = False
    ) -> HealthCheckReport:
        """
        Execute health checks on all pages with parallel execution.

        Args:
            run_id: Run identifier
            pages: List of discovered pages with metadata
            browser_context: Playwright browser context
            debug: Enable debug logging

        Returns:
            Complete health check report
        """
        report = HealthCheckReport(
            run_id=run_id,
            started_at=datetime.utcnow().isoformat(),
            total_pages=len(pages)
        )

        # Emit start event
        await self._emit_event(run_id, "health_check_started", {
            "total_pages": len(pages),
            "concurrent_limit": self.max_concurrent
        })

        # Create health check tasks for all pages
        tasks = []
        for page_info in pages:
            page_checks = self._determine_checks_for_page(page_info)

            page_health = PageHealthCheck(
                page_url=page_info["url"],
                page_title=page_info.get("title", "Untitled"),
                page_type=page_info.get("page_type", "unknown"),
                checks=page_checks
            )

            report.pages.append(page_health)
            report.total_checks += len(page_checks)

            # Create task for this page
            task = self._validate_page_health(
                run_id, page_health, browser_context, debug
            )
            tasks.append(task)

        # Execute with concurrency limit
        semaphore = asyncio.Semaphore(self.max_concurrent)

        async def bounded_task(task):
            async with semaphore:
                return await task

        # Run all tasks in parallel (bounded by semaphore)
        await asyncio.gather(
            *[bounded_task(task) for task in tasks],
            return_exceptions=True
        )

        # Update report with results
        for page_health in report.pages:
            report.pages_validated += 1
            for check in page_health.checks:
                if check.status == HealthCheckStatus.PASSED:
                    report.checks_passed += 1
                elif check.status == HealthCheckStatus.FAILED:
                    report.checks_failed += 1
                elif check.status == HealthCheckStatus.SKIPPED:
                    report.checks_skipped += 1

        report.completed_at = datetime.utcnow().isoformat()

        # Emit completion event
        await self._emit_event(run_id, "health_check_completed", {
            "total_checks": report.total_checks,
            "passed": report.checks_passed,
            "failed": report.checks_failed,
            "skipped": report.checks_skipped
        })

        return report

    def _determine_checks_for_page(self, page_info: Dict) -> List[HealthCheckResult]:
        """Determine which health checks to run based on page characteristics."""
        checks = []

        # All pages get table listing check
        checks.append(HealthCheckResult(
            check_type=HealthCheckType.TABLE_LISTING,
            status=HealthCheckStatus.PENDING,
            page_url=page_info["url"],
            page_title=page_info.get("title", "")
        ))

        # If page has tables, add table-specific checks
        if page_info.get("tables_count", 0) > 0:
            checks.extend([
                HealthCheckResult(
                    check_type=HealthCheckType.PAGINATION,
                    status=HealthCheckStatus.PENDING,
                    page_url=page_info["url"],
                    page_title=page_info.get("title", "")
                ),
                HealthCheckResult(
                    check_type=HealthCheckType.SORT,
                    status=HealthCheckStatus.PENDING,
                    page_url=page_info["url"],
                    page_title=page_info.get("title", "")
                )
            ])

        # If page has search, add search check
        if page_info.get("has_search", False):
            checks.append(HealthCheckResult(
                check_type=HealthCheckType.SEARCH,
                status=HealthCheckStatus.PENDING,
                page_url=page_info["url"],
                page_title=page_info.get("title", "")
            ))

        # If page has filters, add filter check
        if page_info.get("has_filters", False):
            checks.append(HealthCheckResult(
                check_type=HealthCheckType.FILTERS,
                status=HealthCheckStatus.PENDING,
                page_url=page_info["url"],
                page_title=page_info.get("title", "")
            ))

        return checks

    async def _validate_page_health(
        self,
        run_id: str,
        page_health: PageHealthCheck,
        browser_context,
        debug: bool
    ):
        """Execute all health checks for a single page."""
        # Emit page validation start
        await self._emit_event(run_id, "page_validation_started", {
            "url": page_health.page_url,
            "title": page_health.page_title,
            "checks_count": len(page_health.checks)
        })

        # Create new page for this validation
        page = await browser_context.new_page()

        try:
            # Navigate to page
            await page.goto(page_health.page_url, timeout=30000, wait_until="networkidle")

            # Execute each health check
            for check in page_health.checks:
                await self._execute_single_check(run_id, check, page, debug)

            # Determine overall page status
            if all(c.status == HealthCheckStatus.PASSED for c in page_health.checks):
                page_health.overall_status = HealthCheckStatus.PASSED
            elif any(c.status == HealthCheckStatus.FAILED for c in page_health.checks):
                page_health.overall_status = HealthCheckStatus.FAILED
            else:
                page_health.overall_status = HealthCheckStatus.SKIPPED

        except Exception as e:
            logger.error(f"[{run_id}] Page validation failed: {e}")
            page_health.overall_status = HealthCheckStatus.FAILED

        finally:
            await page.close()

            # Emit page validation complete
            await self._emit_event(run_id, "page_validation_completed", {
                "url": page_health.page_url,
                "status": page_health.overall_status.value,
                "checks": [
                    {
                        "type": c.check_type.value,
                        "status": c.status.value
                    } for c in page_health.checks
                ]
            })

    async def _execute_single_check(
        self,
        run_id: str,
        check: HealthCheckResult,
        page,
        debug: bool
    ):
        """Execute a single health check."""
        check.started_at = datetime.utcnow().isoformat()
        check.status = HealthCheckStatus.RUNNING

        # Emit check started event
        await self._emit_event(run_id, "health_check_started_individual", {
            "url": check.page_url,
            "type": check.check_type.value
        })

        start_time = datetime.utcnow()

        try:
            if check.check_type == HealthCheckType.PAGINATION:
                await self._check_pagination(check, page)
            elif check.check_type == HealthCheckType.SEARCH:
                await self._check_search(check, page)
            elif check.check_type == HealthCheckType.FILTERS:
                await self._check_filters(check, page)
            elif check.check_type == HealthCheckType.TABLE_LISTING:
                await self._check_table_listing(check, page)
            elif check.check_type == HealthCheckType.SORT:
                await self._check_sort(check, page)

            check.status = HealthCheckStatus.PASSED

        except Exception as e:
            check.status = HealthCheckStatus.FAILED
            check.error = str(e)

            # Capture screenshot on failure
            try:
                screenshot_dir = Path(f"data/{run_id}/health_checks")
                screenshot_dir.mkdir(parents=True, exist_ok=True)
                screenshot_path = screenshot_dir / f"fail_{check.check_type.value}_{int(datetime.utcnow().timestamp())}.png"
                await page.screenshot(path=str(screenshot_path))
                check.screenshot = str(screenshot_path)
            except Exception as screenshot_error:
                logger.warning(f"Failed to capture screenshot: {screenshot_error}")

        finally:
            check.completed_at = datetime.utcnow().isoformat()
            check.duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

            # Emit check completed event
            await self._emit_event(run_id, "health_check_completed_individual", {
                "url": check.page_url,
                "type": check.check_type.value,
                "status": check.status.value,
                "duration_ms": check.duration_ms,
                "error": check.error
            })

    async def _check_pagination(self, check: HealthCheckResult, page):
        """Validate pagination functionality."""
        # Look for pagination controls
        pagination_selectors = [
            "[aria-label*='pagination']",
            ".pagination",
            "[class*='paginat']",
            "button:has-text('Next')",
            "button:has-text('Previous')",
            "[data-testid*='pagination']"
        ]

        pagination_found = False
        for selector in pagination_selectors:
            count = await page.locator(selector).count()
            if count > 0:
                pagination_found = True
                break

        if pagination_found:
            # Click next button
            next_button = page.locator("button:has-text('Next'), button[aria-label*='next' i]").first

            if await next_button.count() > 0 and await next_button.is_enabled():
                await next_button.click()
                await page.wait_for_timeout(1000)
                check.details["pagination_works"] = True
                check.details["navigated_to_page_2"] = True
            else:
                check.details["pagination_works"] = False
                check.details["next_button_disabled"] = True
        else:
            check.status = HealthCheckStatus.SKIPPED
            check.details["reason"] = "No pagination controls found"

    async def _check_search(self, check: HealthCheckResult, page):
        """Validate search functionality."""
        search_selectors = [
            "input[type='search']",
            "input[placeholder*='search' i]",
            "input[aria-label*='search' i]",
            "[data-testid*='search']"
        ]

        search_input = None
        for selector in search_selectors:
            if await page.locator(selector).count() > 0:
                search_input = page.locator(selector).first
                break

        if search_input:
            # Get initial count
            rows_before = await page.locator("table tbody tr, [role='row']").count()

            # Type search term
            await search_input.fill("test")
            await page.wait_for_timeout(1000)

            # Get filtered count
            rows_after = await page.locator("table tbody tr, [role='row']").count()

            check.details["search_works"] = True
            check.details["rows_before"] = rows_before
            check.details["rows_after"] = rows_after
        else:
            check.status = HealthCheckStatus.SKIPPED
            check.details["reason"] = "No search input found"

    async def _check_filters(self, check: HealthCheckResult, page):
        """Validate filter functionality."""
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

        if filters_found:
            # Try first filter
            first_filter = page.locator(filters_found[0]).first

            if await first_filter.count() > 0:
                # Get options count if it's a select
                if filters_found[0] == "select":
                    options = await page.locator(f"{filters_found[0]} option").count()
                    check.details["first_filter_options"] = options

                check.details["filters_found"] = len(filters_found)

                # Click/interact with filter
                await first_filter.click()
                await page.wait_for_timeout(500)
                check.details["filter_interactable"] = True
        else:
            check.status = HealthCheckStatus.SKIPPED
            check.details["reason"] = "No filter controls found"

    async def _check_table_listing(self, check: HealthCheckResult, page):
        """Validate table listing displays correctly."""
        tables = await page.locator("table, [role='table']").count()

        if tables > 0:
            rows = await page.locator("table tbody tr, [role='row']").count()
            headers = await page.locator("table thead th, [role='columnheader']").count()

            check.details["tables_found"] = tables
            check.details["rows_visible"] = rows
            check.details["columns"] = headers

            if rows > 0:
                check.details["has_data"] = True
            else:
                check.details["has_data"] = False
                check.details["warning"] = "Table exists but no rows visible"
        else:
            check.status = HealthCheckStatus.SKIPPED
            check.details["reason"] = "No tables found on page"

    async def _check_sort(self, check: HealthCheckResult, page):
        """Validate table sorting functionality."""
        sortable_headers = await page.locator("th[aria-sort], th.sortable, th[class*='sort']").count()

        if sortable_headers > 0:
            first_sortable = page.locator("th[aria-sort], th.sortable, th[class*='sort']").first

            # Click to sort
            await first_sortable.click()
            await page.wait_for_timeout(500)

            check.details["sortable_columns"] = sortable_headers
            check.details["sort_triggered"] = True
        else:
            check.status = HealthCheckStatus.SKIPPED
            check.details["reason"] = "No sortable columns found"

    async def _emit_event(self, run_id: str, event_type: str, data: Dict):
        """Emit event to events.jsonl for real-time UI updates."""
        event = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "type": event_type,
            "data": data
        }

        # Write to events.jsonl
        events_path = Path(f"data/{run_id}/events.jsonl")
        events_path.parent.mkdir(parents=True, exist_ok=True)

        with open(events_path, "a") as f:
            f.write(json.dumps(event) + "\n")

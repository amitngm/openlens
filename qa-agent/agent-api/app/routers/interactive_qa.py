"""Interactive QA Buddy API endpoints."""

import uuid
import json
import logging
import shutil
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Body, UploadFile, File, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import desc

from app.models.run_context import RunContext, AuthConfig, Question, AnswerRequest
from app.database import get_db
from app.models.run_state import RunState
from app.services.run_store import RunStore
from app.services.browser_manager import get_browser_manager
from app.services.session_checker import get_session_checker
from app.services.login_detector import get_login_detector
from app.services.login_executor import get_login_executor
from app.services.post_login_validator import get_post_login_validator
from app.services.context_detector import get_context_detector
from app.services.discovery_runner import get_discovery_runner
from app.services.discovery_summarizer import get_discovery_summarizer
from app.services.test_plan_builder import get_test_plan_builder
from app.services.test_executor import get_test_executor
from app.services.report_generator import get_report_generator
from app.services.image_analyzer import get_image_analyzer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/runs", tags=["Interactive QA"])

# Global run store instance
_run_store = RunStore()


# =============================================================================
# Request/Response Models
# =============================================================================

class StartRunRequest(BaseModel):
    """Request to start a new interactive QA run."""

    base_url: str = Field(..., description="Base application URL", examples=["https://app.example.com"])
    env: Optional[str] = Field("staging", description="Environment name", examples=["staging", "dev", "prod"])
    headless: Optional[bool] = Field(True, description="Run browser in headless mode")
    auth: Optional[AuthConfig] = Field(None, description="Authentication configuration")
    discovery_debug: Optional[bool] = Field(False, description="Enable discovery debug trace + screenshots")
    uploaded_images: Optional[list] = Field(None, description="Pre-uploaded image analysis results to guide discovery")
    uploaded_documents: Optional[list] = Field(None, description="Pre-uploaded document analysis results (PRD, requirements)")
    test_phase: Optional[str] = Field("phase1_get_operations", description="Test phase: phase1_get_operations or phase2_full_testing")
    close_browser_on_complete: Optional[bool] = Field(False, description="Close browser automatically when tests complete")

    # Discovery configuration overrides (optional)
    max_pages: Optional[int] = Field(None, description="Maximum pages to discover (default: 2000)")
    max_forms_per_page: Optional[int] = Field(None, description="Maximum forms to process per page (default: 50)")
    max_table_rows_to_click: Optional[int] = Field(None, description="Maximum table rows to click (default: 50)")
    max_discovery_time_minutes: Optional[int] = Field(None, description="Maximum discovery time in minutes (default: 60)")

    class Config:
        json_schema_extra = {
            "example": {
                "base_url": "https://app.example.com",
                "env": "staging",
                "headless": True,
                "auth": {
                    "type": "keycloak",
                    "username": "user@example.com"
                }
            }
        }


class StartRunResponse(BaseModel):
    """Response from starting a run."""
    
    run_id: str = Field(..., description="Unique run identifier")
    state: str = Field(..., description="Current run state")
    question: Optional[Question] = Field(None, description="Question if waiting for input")
    
    class Config:
        json_schema_extra = {
            "example": {
                "run_id": "abc123def456",
                "state": "WAIT_LOGIN_INPUT",
                "question": {
                    "id": "login_creds",
                    "type": "text",
                    "text": "Please provide login credentials (username,password or JSON)"
                }
            }
        }


class RunStatusResponse(BaseModel):
    """Response for run status query."""
    
    run_id: str = Field(..., description="Unique run identifier")
    state: str = Field(..., description="Current run state")
    question: Optional[Question] = Field(None, description="Question if waiting for input")
    progress: Optional[int] = Field(None, description="Progress percentage (0-100)")
    last_step: Optional[str] = Field(None, description="Last completed step name")
    current_url: Optional[str] = Field(None, description="Current page URL")
    
    class Config:
        json_schema_extra = {
            "example": {
                "run_id": "abc123def456",
                "state": "WAIT_LOGIN_INPUT",
                "question": {
                    "id": "login_creds",
                    "type": "text",
                    "text": "Please provide login credentials"
                },
                "progress": 15,
                "last_step": "OPEN_URL",
                "current_url": "https://app.example.com/login"
            }
        }


class AnswerResponse(BaseModel):
    """Response from answering a question."""
    
    run_id: str = Field(..., description="Run identifier")
    state: str = Field(..., description="Updated run state")
    question: Optional[Question] = Field(None, description="Next question if waiting for input")
    message: Optional[str] = Field(None, description="Status message")
    
    class Config:
        json_schema_extra = {
            "example": {
                "run_id": "abc123def456",
                "state": "LOGIN_ATTEMPT",
                "question": None,
                "message": "Credentials accepted, attempting login..."
            }
        }


# =============================================================================
# Helper Functions
# =============================================================================

async def _load_image_analysis_hints(
    uploaded_images: Optional[list],
    artifacts_path: str
) -> Optional[list]:
    """Load and aggregate GET operation hints from all uploaded images."""
    if not uploaded_images:
        return None

    all_hints = []

    for img_data in uploaded_images:
        file_id = img_data.get("file_id")
        if not file_id:
            continue

        analysis_file = Path(artifacts_path) / "uploads" / "images" / f"{file_id}_analysis.json"

        if analysis_file.exists():
            try:
                with open(analysis_file, 'r') as f:
                    analysis = json.load(f)

                # Extract GET operation hints
                if "get_operation_hints" in analysis:
                    all_hints.extend(analysis["get_operation_hints"])
            except Exception as e:
                logger.warning(f"Failed to load image analysis {file_id}: {e}")

    return all_hints if all_hints else None


async def _load_document_analysis(
    uploaded_documents: Optional[list],
    artifacts_path: str
) -> Optional[dict]:
    """Load and aggregate document analysis from all uploaded PRDs."""
    if not uploaded_documents:
        return None

    combined_analysis = {
        "features": [],
        "workflows": [],
        "acceptance_criteria": [],
        "test_scenarios": []
    }

    for doc_data in uploaded_documents:
        file_id = doc_data.get("file_id")
        if not file_id:
            continue

        # Try different possible filenames
        possible_files = [
            Path(artifacts_path) / "uploads" / "documents" / f"{file_id}_analysis.json",
            Path(artifacts_path).parent / "data" / "temp_uploads" / "uploads" / "documents" / f"{file_id}_analysis.json"
        ]

        for analysis_file in possible_files:
            if analysis_file.exists():
                try:
                    with open(analysis_file, 'r') as f:
                        analysis = json.load(f)

                    combined_analysis["features"].extend(analysis.get("features", []))
                    combined_analysis["workflows"].extend(analysis.get("workflows", []))
                    combined_analysis["acceptance_criteria"].extend(analysis.get("acceptance_criteria", []))
                    combined_analysis["test_scenarios"].extend(analysis.get("test_scenarios", []))
                    break
                except Exception as e:
                    logger.warning(f"Failed to load document analysis {file_id}: {e}")

    return combined_analysis if any(combined_analysis.values()) else None


async def _execute_free_text_instruction(run_id: str, instruction: str):
    """
    Execute a free-text test instruction in the background.

    This function interprets common test instructions like:
    - "Test the virtual machines table: click all rows, test pagination, verify counts"
    - "Search for X and verify results"
    - "Test all filters and combinations"

    And executes them directly using Playwright automation.
    """
    try:
        logger.info(f"[{run_id}] Starting free text instruction execution: {instruction[:100]}")

        # Get run context
        context = _run_store.get_run(run_id)
        if not context:
            logger.error(f"[{run_id}] Run not found")
            return

        # Get browser page
        browser_manager = get_browser_manager()
        page = await browser_manager.get_page(
            run_id,
            headless=context.headless,
            debug=getattr(context, "discovery_debug", False),
            artifacts_path=context.artifacts_path
        )

        # Log execution start
        events_file = Path(context.artifacts_path) / "events.jsonl"
        with open(events_file, "a") as f:
            event = {
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "type": "free_text_execution_started",
                "data": {
                    "instruction": instruction
                }
            }
            f.write(json.dumps(event) + "\n")

        # Execute the instruction based on keywords
        instruction_lower = instruction.lower()

        test_results = {
            "instruction": instruction,
            "tests_executed": [],
            "tests_passed": 0,
            "tests_failed": 0
        }

        # Detect what needs to be tested
        if "table" in instruction_lower or "rows" in instruction_lower:
            logger.info(f"[{run_id}] Detected table testing instruction")

            # Find the table mentioned in instruction
            table_keyword = None
            for word in instruction.split():
                if word.lower() not in ['test', 'the', 'table', 'click', 'all', 'rows']:
                    table_keyword = word
                    break

            # Test table rows
            if "click" in instruction_lower and "row" in instruction_lower:
                # Emit test started event
                with open(events_file, "a") as f:
                    event = {
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                        "type": "free_text_test_started",
                        "data": {"test": "table_rows"}
                    }
                    f.write(json.dumps(event) + "\n")

                result = await _test_table_rows(page, run_id, table_keyword)
                test_results["tests_executed"].append(result)
                if result["status"] == "passed":
                    test_results["tests_passed"] += 1
                else:
                    test_results["tests_failed"] += 1

                # Emit test completed event
                with open(events_file, "a") as f:
                    event = {
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                        "type": "free_text_test_completed",
                        "data": {"test": "table_rows", "status": result["status"], "details": result}
                    }
                    f.write(json.dumps(event) + "\n")

            # Test pagination
            if "paginat" in instruction_lower:
                with open(events_file, "a") as f:
                    event = {
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                        "type": "free_text_test_started",
                        "data": {"test": "pagination"}
                    }
                    f.write(json.dumps(event) + "\n")

                result = await _test_pagination(page, run_id)
                test_results["tests_executed"].append(result)
                if result["status"] == "passed":
                    test_results["tests_passed"] += 1
                else:
                    test_results["tests_failed"] += 1

                with open(events_file, "a") as f:
                    event = {
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                        "type": "free_text_test_completed",
                        "data": {"test": "pagination", "status": result["status"], "details": result}
                    }
                    f.write(json.dumps(event) + "\n")

            # Verify counts
            if "count" in instruction_lower or "verify" in instruction_lower:
                with open(events_file, "a") as f:
                    event = {
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                        "type": "free_text_test_started",
                        "data": {"test": "table_counts"}
                    }
                    f.write(json.dumps(event) + "\n")

                result = await _verify_table_counts(page, run_id)
                test_results["tests_executed"].append(result)
                if result["status"] == "passed":
                    test_results["tests_passed"] += 1
                else:
                    test_results["tests_failed"] += 1

                with open(events_file, "a") as f:
                    event = {
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                        "type": "free_text_test_completed",
                        "data": {"test": "table_counts", "status": result["status"], "details": result}
                    }
                    f.write(json.dumps(event) + "\n")

        # Search testing
        if "search" in instruction_lower:
            with open(events_file, "a") as f:
                event = {
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "type": "free_text_test_started",
                    "data": {"test": "search"}
                }
                f.write(json.dumps(event) + "\n")

            result = await _test_search(page, run_id, instruction)
            test_results["tests_executed"].append(result)
            if result["status"] == "passed":
                test_results["tests_passed"] += 1
            else:
                test_results["tests_failed"] += 1

            with open(events_file, "a") as f:
                event = {
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "type": "free_text_test_completed",
                    "data": {"test": "search", "status": result["status"], "details": result}
                }
                f.write(json.dumps(event) + "\n")

        # Filter testing
        if "filter" in instruction_lower:
            with open(events_file, "a") as f:
                event = {
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "type": "free_text_test_started",
                    "data": {"test": "filters"}
                }
                f.write(json.dumps(event) + "\n")

            result = await _test_filters(page, run_id)
            test_results["tests_executed"].append(result)
            if result["status"] == "passed":
                test_results["tests_passed"] += 1
            else:
                test_results["tests_failed"] += 1

            with open(events_file, "a") as f:
                event = {
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "type": "free_text_test_completed",
                    "data": {"test": "filters", "status": result["status"], "details": result}
                }
                f.write(json.dumps(event) + "\n")

        logger.info(f"[{run_id}] Test execution completed: {test_results['tests_passed']} passed, {test_results['tests_failed']} failed")

        # Log completion
        with open(events_file, "a") as f:
            event = {
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "type": "free_text_execution_completed",
                "data": {
                    "passed": test_results["tests_passed"],
                    "failed": test_results["tests_failed"],
                    "total_tests": len(test_results["tests_executed"])
                }
            }
            f.write(json.dumps(event) + "\n")

        # Save test results
        results_file = Path(context.artifacts_path) / "free_text_results.json"
        with open(results_file, "w") as f:
            json.dump(test_results, f, indent=2)

        # Transition back to WAIT_TEST_INTENT (ready for more commands)
        context = _run_store.transition_state(run_id, RunState.WAIT_TEST_INTENT)

        logger.info(f"[{run_id}] Free text instruction execution completed successfully")

    except Exception as e:
        logger.error(f"[{run_id}] Failed to execute free text instruction: {e}", exc_info=True)

        # Log error
        try:
            events_file = Path(context.artifacts_path) / "events.jsonl"
            with open(events_file, "a") as f:
                event = {
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "type": "free_text_execution_error",
                    "data": {
                        "error": str(e)
                    }
                }
                f.write(json.dumps(event) + "\n")
        except:
            pass

        # Transition back to WAIT_TEST_INTENT
        try:
            context = _run_store.transition_state(run_id, RunState.WAIT_TEST_INTENT)
        except:
            pass


async def _test_table_rows(page, run_id: str, table_keyword: Optional[str]) -> Dict[str, Any]:
    """Click all rows in a table and verify detail pages."""
    try:
        logger.info(f"[{run_id}] Testing table rows (keyword: {table_keyword})")

        # Find all table rows
        rows = await page.locator("table tbody tr").all()

        logger.info(f"[{run_id}] Found {len(rows)} table rows")

        rows_clicked = 0
        for i, row in enumerate(rows[:50]):  # Limit to first 50 rows
            try:
                # Get row text before clicking
                row_text = await row.text_content()

                # Click the row
                await row.click(timeout=3000)
                await page.wait_for_load_state("networkidle", timeout=5000)

                rows_clicked += 1

                logger.info(f"[{run_id}] Clicked row {i+1}/{len(rows)}: {row_text[:50]}")

                # Go back to table page
                await page.go_back()
                await page.wait_for_load_state("networkidle", timeout=5000)

            except Exception as e:
                logger.warning(f"[{run_id}] Failed to click row {i+1}: {e}")
                continue

        return {
            "test": "Click table rows",
            "status": "passed" if rows_clicked > 0 else "failed",
            "rows_found": len(rows),
            "rows_clicked": rows_clicked,
            "details": f"Successfully clicked {rows_clicked}/{len(rows)} rows"
        }

    except Exception as e:
        logger.error(f"[{run_id}] Table row testing failed: {e}", exc_info=True)
        return {
            "test": "Click table rows",
            "status": "failed",
            "error": str(e)
        }


async def _test_pagination(page, run_id: str) -> Dict[str, Any]:
    """Test pagination by clicking through all pages."""
    try:
        logger.info(f"[{run_id}] Testing pagination")

        # Find pagination controls
        next_button_selectors = [
            "button:has-text('Next')",
            "a:has-text('Next')",
            "button[aria-label*='Next']",
            "a[aria-label*='Next']",
            ".pagination button:last-child",
            ".pagination a:last-child"
        ]

        next_button = None
        for selector in next_button_selectors:
            try:
                next_button = page.locator(selector).first
                if await next_button.is_visible(timeout=1000):
                    break
            except:
                continue

        if not next_button:
            return {
                "test": "Test pagination",
                "status": "skipped",
                "details": "No pagination controls found"
            }

        pages_visited = 1
        total_items_seen = 0

        # Count items on first page
        items_on_page = await page.locator("table tbody tr").count()
        total_items_seen += items_on_page

        logger.info(f"[{run_id}] Page 1: {items_on_page} items")

        # Click through pages
        while pages_visited < 100:  # Safety limit
            try:
                # Check if next button is disabled
                is_disabled = await next_button.is_disabled(timeout=500)
                if is_disabled:
                    break

                # Click next
                await next_button.click()
                await page.wait_for_load_state("networkidle", timeout=5000)

                pages_visited += 1

                # Count items on new page
                items_on_page = await page.locator("table tbody tr").count()
                total_items_seen += items_on_page

                logger.info(f"[{run_id}] Page {pages_visited}: {items_on_page} items")

            except Exception as e:
                logger.info(f"[{run_id}] Reached last page at page {pages_visited}")
                break

        return {
            "test": "Test pagination",
            "status": "passed",
            "pages_visited": pages_visited,
            "total_items": total_items_seen,
            "details": f"Navigated through {pages_visited} pages, saw {total_items_seen} total items"
        }

    except Exception as e:
        logger.error(f"[{run_id}] Pagination testing failed: {e}", exc_info=True)
        return {
            "test": "Test pagination",
            "status": "failed",
            "error": str(e)
        }


async def _verify_table_counts(page, run_id: str) -> Dict[str, Any]:
    """Verify table row counts and totals."""
    try:
        logger.info(f"[{run_id}] Verifying table counts")

        # Count visible rows
        row_count = await page.locator("table tbody tr").count()

        # Try to find total count indicator (e.g., "Showing 1-10 of 245")
        count_text = None
        count_selectors = [
            "text=/showing.*of/i",
            "text=/total.*items/i",
            ".pagination-info",
            ".table-info"
        ]

        for selector in count_selectors:
            try:
                element = page.locator(selector).first
                if await element.is_visible(timeout=1000):
                    count_text = await element.text_content()
                    break
            except:
                continue

        return {
            "test": "Verify table counts",
            "status": "passed",
            "visible_rows": row_count,
            "count_indicator": count_text,
            "details": f"Found {row_count} visible rows. {count_text or 'No count indicator found'}"
        }

    except Exception as e:
        logger.error(f"[{run_id}] Count verification failed: {e}", exc_info=True)
        return {
            "test": "Verify table counts",
            "status": "failed",
            "error": str(e)
        }


async def _test_search(page, run_id: str, instruction: str) -> Dict[str, Any]:
    """Test search functionality."""
    try:
        logger.info(f"[{run_id}] Testing search")

        # Find search input
        search_selectors = [
            "input[type='search']",
            "input[placeholder*='Search' i]",
            "input[placeholder*='Find' i]",
            "input[aria-label*='Search' i]"
        ]

        search_input = None
        for selector in search_selectors:
            try:
                search_input = page.locator(selector).first
                if await search_input.is_visible(timeout=1000):
                    break
            except:
                continue

        if not search_input:
            return {
                "test": "Test search",
                "status": "skipped",
                "details": "No search input found"
            }

        # Perform search
        await search_input.fill("test")
        await search_input.press("Enter")
        await page.wait_for_load_state("networkidle", timeout=5000)

        # Count results
        results_count = await page.locator("table tbody tr").count()

        return {
            "test": "Test search",
            "status": "passed",
            "search_term": "test",
            "results_count": results_count,
            "details": f"Search returned {results_count} results"
        }

    except Exception as e:
        logger.error(f"[{run_id}] Search testing failed: {e}", exc_info=True)
        return {
            "test": "Test search",
            "status": "failed",
            "error": str(e)
        }


async def _test_filters(page, run_id: str) -> Dict[str, Any]:
    """Test filter controls."""
    try:
        logger.info(f"[{run_id}] Testing filters")

        # Find filter dropdowns/selects
        filters = await page.locator("select, [role='combobox']").all()

        logger.info(f"[{run_id}] Found {len(filters)} filter controls")

        filters_tested = 0
        for i, filter_elem in enumerate(filters[:10]):  # Limit to first 10 filters
            try:
                # Get filter label
                filter_label = await filter_elem.get_attribute("aria-label") or f"Filter {i+1}"

                # Get options
                if await filter_elem.evaluate("el => el.tagName") == "SELECT":
                    options = await filter_elem.locator("option").all()

                    for option in options[:5]:  # Test first 5 options
                        option_text = await option.text_content()
                        await filter_elem.select_option(label=option_text)
                        await page.wait_for_timeout(1000)

                        logger.info(f"[{run_id}] Tested {filter_label}: {option_text}")

                filters_tested += 1

            except Exception as e:
                logger.warning(f"[{run_id}] Failed to test filter {i+1}: {e}")
                continue

        return {
            "test": "Test filters",
            "status": "passed" if filters_tested > 0 else "skipped",
            "filters_found": len(filters),
            "filters_tested": filters_tested,
            "details": f"Tested {filters_tested} filter controls"
        }

    except Exception as e:
        logger.error(f"[{run_id}] Filter testing failed: {e}", exc_info=True)
        return {
            "test": "Test filters",
            "status": "failed",
            "error": str(e)
        }


# =============================================================================
# Endpoints
# =============================================================================

@router.get("/list", summary="List all discovery runs")
async def list_runs():
    """
    List all discovery runs with their metadata.

    Returns:
        List of runs with basic metadata
    """
    try:
        # Try relative path first (when running from agent-api/), then absolute path
        data_dir = Path("data")
        if not data_dir.exists():
            data_dir = Path("agent-api/data")
        if not data_dir.exists():
            return {"runs": []}

        runs = []
        for run_dir in sorted(data_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if not run_dir.is_dir():
                continue

            run_id = run_dir.name

            # Skip temp_uploads and other non-run directories
            if run_id in ['temp_uploads', '.DS_Store']:
                continue

            # Try to load discovery.json for metadata
            discovery_file = run_dir / "discovery.json"
            test_cases_file = run_dir / "test_cases.json"

            run_info = {
                "run_id": run_id,
                "started_at": None,
                "base_url": None,
                "pages_count": 0,
                "forms_count": 0,
                "test_cases_count": 0,
                "has_discovery": discovery_file.exists(),
                "has_test_cases": test_cases_file.exists()
            }

            if discovery_file.exists():
                try:
                    with open(discovery_file, "r") as f:
                        discovery_data = json.load(f)
                        run_info["started_at"] = discovery_data.get("started_at")
                        run_info["base_url"] = discovery_data.get("base_url")
                        run_info["pages_count"] = len(discovery_data.get("pages", []))

                        # Count forms
                        forms_count = 0
                        for page in discovery_data.get("pages", []):
                            forms_count += len(page.get("forms", []))
                        run_info["forms_count"] = forms_count
                except Exception as e:
                    logger.warning(f"Failed to load discovery for {run_id}: {e}")

            if test_cases_file.exists():
                try:
                    with open(test_cases_file, "r") as f:
                        test_cases_data = json.load(f)
                        run_info["test_cases_count"] = test_cases_data.get("total_test_cases", 0)
                except Exception as e:
                    logger.warning(f"Failed to load test cases for {run_id}: {e}")

            runs.append(run_info)

        return {"runs": runs}

    except Exception as e:
        logger.error(f"Failed to list runs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list runs: {str(e)}")


@router.delete("/{run_id}", summary="Delete a discovery run")
async def delete_run(run_id: str, db: AsyncSession = Depends(get_db)):
    """
    Delete a discovery run and all its associated data.

    This will permanently delete:
    - All discovery artifacts (pages, forms, screenshots)
    - Test cases
    - Validation reports
    - Coverage reports
    - All files in the run directory
    - Database records (Run, Page, TestCase, RunComparison)

    Args:
        run_id: The run ID to delete

    Returns:
        Success message with deleted run details
    """
    try:
        # Delete database records first
        try:
            from app.models.database import Run, Page, TestCase, RunComparison
            from sqlalchemy import delete
            
            try:
                # Delete related records first (foreign key constraints)
                # Delete RunComparisons (check both run1_id and run2_id)
                await db.execute(
                    delete(RunComparison).where(
                        (RunComparison.run_id_a == run_id) | (RunComparison.run_id_b == run_id)
                    )
                )
                
                # Delete TestCases
                await db.execute(
                    delete(TestCase).where(TestCase.run_id == run_id)
                )
                
                # Delete Pages
                await db.execute(
                    delete(Page).where(Page.run_id == run_id)
                )
                
                # Delete Run
                await db.execute(
                    delete(Run).where(Run.run_id == run_id)
                )
                
                await db.commit()
                logger.info(f"[{run_id}] Deleted database records for run")
            except Exception as db_error:
                await db.rollback()
                logger.warning(f"[{run_id}] Failed to delete database records: {db_error}")
        except Exception as db_error:
            logger.warning(f"[{run_id}] Database deletion failed (continuing with file deletion): {db_error}")
        
        # Find the run directory
        data_dir = Path("data")
        if not data_dir.exists():
            data_dir = Path("agent-api/data")
        if not data_dir.exists():
            raise HTTPException(status_code=404, detail="Data directory not found")

        run_dir = data_dir / run_id

        if not run_dir.exists():
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

        if not run_dir.is_dir():
            raise HTTPException(status_code=400, detail=f"Invalid run directory: {run_id}")

        # Get run info before deletion
        run_info = {
            "run_id": run_id,
            "deleted_at": datetime.utcnow().isoformat() + "Z"
        }

        # Try to load discovery.json for metadata
        discovery_file = run_dir / "discovery.json"
        if discovery_file.exists():
            try:
                with open(discovery_file, "r") as f:
                    discovery_data = json.load(f)
                    run_info["base_url"] = discovery_data.get("base_url")
                    run_info["started_at"] = discovery_data.get("started_at")
            except Exception:
                pass

        # Count files being deleted
        file_count = sum(1 for _ in run_dir.rglob("*") if _.is_file())
        run_info["files_deleted"] = file_count

        # Calculate directory size
        total_size = sum(f.stat().st_size for f in run_dir.rglob("*") if f.is_file())
        run_info["size_deleted_mb"] = round(total_size / (1024 * 1024), 2)

        # Delete the entire run directory
        shutil.rmtree(run_dir)

        logger.info(
            f"Deleted run {run_id}: {file_count} files, {run_info['size_deleted_mb']} MB"
        )

        return {
            "success": True,
            "message": f"Run {run_id} deleted successfully",
            "run_info": run_info
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete run {run_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete run: {str(e)}")


@router.post("/start", response_model=StartRunResponse, summary="Start a new interactive QA run")
async def start_run(request: StartRunRequest = Body(...)) -> StartRunResponse:
    """
    Start a new interactive QA Buddy run.
    
    Creates a new run context, opens the base URL, and performs SESSION_CHECK.
    The run will progress through states and may pause to ask questions.
    
    **Note**: Discovery and tests are not executed yet - only session checking.
    """
    run_id = str(uuid.uuid4())[:12]
    
    try:
        # Create run context
        context = _run_store.create_run(
            run_id=run_id,
            base_url=request.base_url,
            env=request.env or "staging",
            headless=request.headless if request.headless is not None else True,
            auth=request.auth,
            discovery_debug=bool(request.discovery_debug),
            uploaded_images=request.uploaded_images,
            uploaded_documents=request.uploaded_documents,
            test_phase=request.test_phase or "phase1_get_operations",
            max_pages=request.max_pages,
            max_forms_per_page=request.max_forms_per_page,
            max_table_rows_to_click=request.max_table_rows_to_click,
            max_discovery_time_minutes=request.max_discovery_time_minutes,
            close_browser_on_complete=bool(request.close_browser_on_complete) if request.close_browser_on_complete is not None else False
        )
        
        # Transition to OPEN_URL (opens URL in check_session)
        context = _run_store.transition_state(run_id, RunState.OPEN_URL)
        
        # Transition to SESSION_CHECK
        context = _run_store.transition_state(run_id, RunState.SESSION_CHECK)
        
        # Perform SESSION_CHECK
        browser_manager = get_browser_manager()
        session_checker = get_session_checker()
        
        # Get or create browser page
        page = await browser_manager.get_page(
            run_id,
            headless=context.headless,
            debug=getattr(context, "discovery_debug", False),
            artifacts_path=context.artifacts_path
        )
        
        # Perform session check (this opens the URL and checks session state)
        check_result = await session_checker.check_session(
            page=page,
            base_url=request.base_url,
            run_id=run_id,
            artifacts_path=context.artifacts_path
        )
        
        # Update context with current URL
        current_url = page.url
        context = _run_store.update_run(run_id, current_url=current_url)
        
        # Transition to next state based on check result
        next_state = check_result["next_state"]
        context = _run_store.transition_state(run_id, next_state)
        
        # If transitioning to LOGIN_DETECT, perform login detection
        if next_state == RunState.LOGIN_DETECT:
            login_detector = get_login_detector()
            keycloak_detected = check_result["status"] == "keycloak"
            detect_result = await login_detector.detect_login(
                run_id=run_id,
                context=context,
                keycloak_detected=keycloak_detected
            )
            
            # Update auth if needed
            if detect_result["auth_updated"]:
                context = _run_store.update_run(run_id, auth=context.auth)
            
            # Transition to next state from login detection
            next_state = detect_result["next_state"]
            context = _run_store.transition_state(run_id, next_state)
            
            # Update question if credentials needed
            if detect_result["question"]:
                context = _run_store.update_run(run_id, question=detect_result["question"])
            
            # Get updated context after login detection
            context = _run_store.get_run(run_id)
            next_state = detect_result["next_state"]
            
            # If transitioning to LOGIN_ATTEMPT, execute login
            if next_state == RunState.LOGIN_ATTEMPT:
                if not context.auth or not context.auth.username or not context.auth.password:
                    # Should not happen, but safety check
                    logger.error(f"[{run_id}] LOGIN_ATTEMPT without credentials")
                    question = Question(
                        id="login_creds",
                        type="text",
                        text="Credentials missing. Please provide login credentials."
                    )
                    context = _run_store.transition_state(run_id, RunState.WAIT_LOGIN_INPUT)
                    context = _run_store.update_run(run_id, question=question)
                else:
                    # Execute login attempt
                    login_executor = get_login_executor()
                    login_result = await login_executor.attempt_login(
                        page=page,
                        run_id=run_id,
                        base_url=request.base_url,
                        username=context.auth.username,
                        password=context.auth.password,
                        artifacts_path=context.artifacts_path
                    )
                    
                    # Update current URL
                    current_url = page.url
                    context = _run_store.update_run(run_id, current_url=current_url)
                    
                    # Transition to next state
                    next_state = login_result["next_state"]
                    context = _run_store.transition_state(run_id, next_state)
                    
                    # Update question if needed
                    if login_result["question"]:
                        context = _run_store.update_run(run_id, question=login_result["question"])
                    
                    # If transitioning to POST_LOGIN_VALIDATE, perform validation
                    if login_result["next_state"] == RunState.POST_LOGIN_VALIDATE:
                        post_login_validator = get_post_login_validator()
                        validation_result = await post_login_validator.validate_session(
                            page=page,
                            run_id=run_id,
                            base_url=request.base_url,
                            artifacts_path=context.artifacts_path
                        )
                        
                        # Update current URL
                        context = _run_store.update_run(run_id, current_url=validation_result["current_url"])
                        
                        # Transition to next state
                        next_state = validation_result["next_state"]
                        context = _run_store.transition_state(run_id, next_state)
                        
                        # Update question if bounced
                        if validation_result["question"]:
                            context = _run_store.update_run(run_id, question=validation_result["question"])
                        else:
                            # If transitioning to CONTEXT_DETECT, perform context detection
                            if validation_result["next_state"] == RunState.CONTEXT_DETECT:
                                context_detector = get_context_detector()
                                detect_result = await context_detector.detect_context(
                                    page=page,
                                    run_id=run_id,
                                    artifacts_path=context.artifacts_path
                                )
                                
                                # Update selected context if single option
                                if detect_result.get("selected_context"):
                                    context = _run_store.update_run(run_id, selected_context=detect_result["selected_context"])
                                
                                # Transition to next state
                                next_state = detect_result["next_state"]
                                context = _run_store.transition_state(run_id, next_state)
                                
                                # Update question if multiple options
                                if detect_result["question"]:
                                    context = _run_store.update_run(run_id, question=detect_result["question"])
                                else:
                                    # If transitioning to DISCOVERY_RUN, execute discovery
                                    if detect_result["next_state"] == RunState.DISCOVERY_RUN:
                                        # Load image/document analysis hints
                                        image_hints = await _load_image_analysis_hints(
                                            context.uploaded_images,
                                            context.artifacts_path
                                        )
                                        document_analysis = await _load_document_analysis(
                                            context.uploaded_documents,
                                            context.artifacts_path
                                        )

                                        # Prepare config overrides if provided
                                        config_overrides = {}
                                        if hasattr(context, 'max_pages') and context.max_pages:
                                            config_overrides['max_pages'] = context.max_pages
                                        if hasattr(context, 'max_forms_per_page') and context.max_forms_per_page:
                                            config_overrides['max_forms_per_page'] = context.max_forms_per_page
                                        if hasattr(context, 'max_table_rows_to_click') and context.max_table_rows_to_click:
                                            config_overrides['max_table_rows_to_click'] = context.max_table_rows_to_click
                                        if hasattr(context, 'max_discovery_time_minutes') and context.max_discovery_time_minutes:
                                            config_overrides['max_discovery_time_minutes'] = context.max_discovery_time_minutes

                                        discovery_runner = get_discovery_runner()
                                        discovery_result = await discovery_runner.run_discovery(
                                            page=page,
                                            run_id=run_id,
                                            base_url=context.base_url,
                                            artifacts_path=context.artifacts_path,
                                            debug=getattr(context, "discovery_debug", False),
                                            image_hints=image_hints,
                                            document_analysis=document_analysis,
                                            phase=context.test_phase,
                                            config_overrides=config_overrides if config_overrides else None
                                        )
                                        
                                        # Store discovery summary in context
                                        context = _run_store.update_run(
                                            run_id,
                                            discovery_summary=discovery_result.get("summary", {})
                                        )
                                        
                                        # Transition to DISCOVERY_SUMMARY
                                        context = _run_store.transition_state(run_id, RunState.DISCOVERY_SUMMARY)
                                        
                                        # Generate discovery summary and transition to WAIT_TEST_INTENT
                                        discovery_summarizer = get_discovery_summarizer()
                                        summary_result = await discovery_summarizer.generate_summary(
                                            page=page,
                                            run_id=run_id,
                                            artifacts_path=context.artifacts_path
                                        )
                                        
                                        # Store detailed summary in context
                                        context = _run_store.update_run(
                                            run_id,
                                            discovery_summary=summary_result["summary"]
                                        )
                                        
                                        # Transition to WAIT_TEST_INTENT
                                        context = _run_store.transition_state(run_id, summary_result["next_state"])
                                        
                                        # Update question
                                        if summary_result["question"]:
                                            context = _run_store.update_run(run_id, question=summary_result["question"])
            else:
                # Update question if ambiguous (from SESSION_CHECK)
                if check_result["question"]:
                    context = _run_store.update_run(run_id, question=check_result["question"])
        
        # Get updated context
        context = _run_store.get_run(run_id)
        
        return StartRunResponse(
            run_id=context.run_id,
            state=context.state.value,
            question=context.question
        )
    
    except Exception as e:
        logger.error(f"Failed to start run: {e}", exc_info=True)
        # Cleanup browser context on error
        try:
            browser_manager = get_browser_manager()
            await browser_manager.close_context(run_id)
        except:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to start run: {str(e)}")


@router.get("/{run_id}/report", summary="Get HTML report for a run")
async def get_report(run_id: str):
    """
    Get HTML report for a run.
    
    Returns the generated HTML report if available.
    """
    context = _run_store.get_run(run_id)
    if not context:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    
    report_path = Path(context.artifacts_path) / "report.html"
    
    if not report_path.exists():
        # Try to generate report
        report_generator = get_report_generator()
        try:
            result = report_generator.generate_html_report(
                run_id=run_id,
                artifacts_path=context.artifacts_path
            )
            report_path = Path(result["html_path"])
        except Exception as e:
            raise HTTPException(
                status_code=404,
                detail=f"Report not found and generation failed: {str(e)[:200]}"
            )
    
    # Read and return HTML
    with open(report_path, "r", encoding="utf-8") as f:
        html_content = f.read()
    
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=html_content)


@router.get("/{run_id}/discovery/features", summary="Get discovered features and test cases")
async def get_discovery_features(run_id: str):
    """
    Get discovered features and test cases organized by feature.

    Analyzes the discovery data to extract:
    - Features/modules discovered
    - Test scenarios per feature
    - CRUD operations available
    - Workflows identified
    """
    context = _run_store.get_run(run_id)
    if not context:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    discovery_file = Path(context.artifacts_path) / "discovery.json"

    if not discovery_file.exists():
        return {
            "run_id": run_id,
            "features": [],
            "total_test_cases": 0,
            "message": "Discovery not completed yet"
        }

    try:
        # Read discovery data
        with open(discovery_file, "r", encoding="utf-8") as f:
            discovery_data = json.load(f)

        # Extract features from pages
        features = {}
        pages = discovery_data.get("pages", [])

        for page in pages:
            # Extract feature from breadcrumb or page name
            page_sig = page.get("page_signature", {})
            breadcrumb = page_sig.get("breadcrumb", "")
            page_name = page_sig.get("page_name", page.get("title", "Unknown"))

            # Extract feature name (first part of breadcrumb or page name)
            feature_name = "General"
            if breadcrumb:
                parts = breadcrumb.split(">")
                if len(parts) >= 3:
                    feature_name = parts[2].strip()
                elif len(parts) >= 2:
                    feature_name = parts[1].strip()

            if feature_name == "Dashboard":
                feature_name = page_name or "General"

            # Initialize feature if not exists
            if feature_name not in features:
                features[feature_name] = {
                    "feature_name": feature_name,
                    "pages": [],
                    "test_cases": []
                }

            # Add page
            features[feature_name]["pages"].append({
                "url": page.get("url", ""),
                "nav_text": page.get("nav_text", ""),
                "title": page.get("title", "")
            })

            # Generate test cases based on page content
            test_cases = []

            # Navigation test
            test_cases.append({
                "test_id": f"TC_{len(test_cases) + 1}",
                "test_name": f"Navigate to {page_name}",
                "test_type": "navigation",
                "priority": "high",
                "steps": [
                    f"Navigate to {page.get('nav_text', page_name)}",
                    "Verify page loads successfully",
                    f"Verify page title contains '{page.get('title', '')}'"
                ]
            })

            # Action button tests
            actions = page.get("primary_actions", [])
            for action in actions:
                action_text = action.get("text", "")
                action_type = action.get("tag", "unknown")

                if action_type == "create":
                    test_cases.append({
                        "test_id": f"TC_{len(test_cases) + 1}",
                        "test_name": f"{action_text} {page_name}",
                        "test_type": "crud_create",
                        "priority": "high",
                        "steps": [
                            f"Click on '{action_text}' button",
                            "Fill in required fields",
                            "Submit form",
                            "Verify success message",
                            f"Verify new item appears in {page_name} list"
                        ]
                    })
                elif action_type == "edit":
                    test_cases.append({
                        "test_id": f"TC_{len(test_cases) + 1}",
                        "test_name": f"Edit {page_name}",
                        "test_type": "crud_update",
                        "priority": "medium",
                        "steps": [
                            f"Select an existing {page_name}",
                            f"Click on '{action_text}' button",
                            "Modify fields",
                            "Save changes",
                            "Verify updates are reflected"
                        ]
                    })
                elif action_type == "delete":
                    test_cases.append({
                        "test_id": f"TC_{len(test_cases) + 1}",
                        "test_name": f"Delete {page_name}",
                        "test_type": "crud_delete",
                        "priority": "medium",
                        "steps": [
                            f"Select an existing {page_name}",
                            f"Click on '{action_text}' button",
                            "Confirm deletion",
                            "Verify item is removed from list"
                        ]
                    })

            # Table tests
            tables = page.get("tables", [])
            for table in tables:
                columns = table.get("columns", [])
                if columns:
                    test_cases.append({
                        "test_id": f"TC_{len(test_cases) + 1}",
                        "test_name": f"Verify {page_name} table data",
                        "test_type": "data_validation",
                        "priority": "medium",
                        "steps": [
                            f"Navigate to {page_name}",
                            f"Verify table has columns: {', '.join(columns[:3])}",
                            "Verify table data loads",
                            "Verify pagination works (if present)"
                        ]
                    })

            # Form tests
            forms = page.get("forms", [])
            for form in forms:
                form_fields = form.get("fields", [])
                if form_fields:
                    test_cases.append({
                        "test_id": f"TC_{len(test_cases) + 1}",
                        "test_name": f"Submit {page_name} form",
                        "test_type": "form_submission",
                        "priority": "high",
                        "steps": [
                            f"Navigate to {page_name} form",
                            "Fill in all required fields",
                            "Submit form",
                            "Verify validation messages",
                            "Verify successful submission"
                        ]
                    })

            features[feature_name]["test_cases"].extend(test_cases)

        # Load test execution results if available to add status
        test_results_map = {}
        free_text_results_file = Path(context.artifacts_path) / "free_text_results.json"
        if free_text_results_file.exists():
            try:
                with open(free_text_results_file, "r", encoding="utf-8") as f:
                    free_text_results = json.load(f)
                    # Map test names to their status
                    for test_result in free_text_results.get("tests_executed", []):
                        test_name = test_result.get("test", "")
                        status = test_result.get("status", "pending")
                        if test_name:
                            test_results_map[test_name.lower()] = status
            except Exception as e:
                logger.warning(f"[{run_id}] Failed to load test results: {e}")

        # Add status to test cases based on execution results
        for feature in features.values():
            for test_case in feature["test_cases"]:
                test_name = test_case.get("test_name", "").lower()
                # Try to match test case name with execution results
                status = "pending"  # default status
                for result_name, result_status in test_results_map.items():
                    if result_name in test_name or test_name in result_name:
                        status = result_status
                        break
                test_case["status"] = status

        # Convert to list and calculate totals from features
        features_list = list(features.values())
        total_test_cases_from_features = sum(len(f["test_cases"]) for f in features_list)
        
        # Also check test_cases.json for the actual generated test cases count
        test_cases_file = Path(context.artifacts_path) / "test_cases.json"
        actual_total_test_cases = total_test_cases_from_features
        scenarios_count = 0
        
        if test_cases_file.exists():
            try:
                with open(test_cases_file, "r", encoding="utf-8") as f:
                    test_cases_data = json.load(f)
                    actual_total_test_cases = test_cases_data.get("total_test_cases", total_test_cases_from_features)
                    scenarios_count = len(test_cases_data.get("scenarios", []))
            except Exception as e:
                logger.warning(f"[{run_id}] Failed to load test_cases.json for accurate count: {e}")

        return {
            "run_id": run_id,
            "features": features_list,
            "total_features": len(features_list),
            "total_test_cases": actual_total_test_cases,  # Use actual count from test_cases.json
            "scenarios_count": scenarios_count,
            "message": f"Discovered {len(features_list)} features with {actual_total_test_cases} test cases"
        }

    except Exception as e:
        logger.error(f"[{run_id}] Error extracting features: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to extract features: {str(e)}")


@router.get("/{run_id}/events", summary="Get discovery events stream")
async def get_events(run_id: str, after: int = 0):
    """
    Get discovery events stream.
    
    Returns new events after the specified cursor position.
    Events are in JSON Lines format, one per line.
    
    Args:
        run_id: Run identifier
        after: Event cursor position (line number) to start from
    
    Returns:
        Dict with events array and next cursor
    """
    context = _run_store.get_run(run_id)
    if not context:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    
    events_file = Path(context.artifacts_path) / "events.jsonl"
    
    if not events_file.exists():
        return {
            "run_id": run_id,
            "events": [],
            "next_cursor": 0,
            "total_events": 0
        }
    
    try:
        # Read all events
        with open(events_file, "r", encoding="utf-8") as f:
            lines = f.readlines()
        
        total_events = len(lines)
        
        # Get events after cursor
        events = []
        for i in range(after, total_events):
            try:
                event = json.loads(lines[i].strip())
                events.append(event)
            except:
                continue
        
        return {
            "run_id": run_id,
            "events": events,
            "next_cursor": total_events,
            "total_events": total_events
        }
    except Exception as e:
        logger.error(f"[{run_id}] Error reading events: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read events: {str(e)}")


@router.get("/{run_id}/status", response_model=RunStatusResponse, summary="Get run status")
async def get_run_status(run_id: str) -> RunStatusResponse:
    """
    Get the current status of a run.
    
    Returns the current state, any pending question, progress, and other metadata.
    """
    context = _run_store.get_run(run_id)
    if not context:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
    
    # Calculate progress based on state
    progress = _calculate_progress(context.state)
    
    # Get last step from timestamps (most recent state before current)
    last_step = None
    if len(context.timestamps) > 1:
        # Get second-to-last state
        states = list(context.timestamps.keys())
        if len(states) >= 2:
            last_step = states[-2]
    
    return RunStatusResponse(
        run_id=context.run_id,
        state=context.state.value,
        question=context.question,
        progress=progress,
        last_step=last_step,
        current_url=context.current_url
    )


@router.post("/{run_id}/answer", response_model=AnswerResponse, summary="Answer a question")
async def answer_question(
    run_id: str,
    request: AnswerRequest = Body(...)
) -> AnswerResponse:
    """
    Answer a question for an interactive run.
    
    Handles different question types:
    - **text**: Accepts text input (e.g., credentials)
    - **select_one**: Accepts option ID selection
    - **confirm**: Accepts yes/no answer
    
    **Note**: State transitions and UI interactions are not implemented yet.
    This endpoint only updates the run context.
    """
    context = _run_store.get_run(run_id)
    if not context:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
    
    # Handle free_text commands (special case)
    if request.question_id == "free_text":
        # Store free_text command
        if not context.free_text_commands:
            context.free_text_commands = []
        context.free_text_commands.append(request.answer)
        context = _run_store.update_run(run_id, free_text_commands=context.free_text_commands)

        logger.info(f"[{run_id}] Free text command received: {request.answer[:100]}")

        # Process the command if in WAIT_TEST_INTENT state
        if context.state == RunState.WAIT_TEST_INTENT:
            logger.info(f"[{run_id}] Processing free text command in WAIT_TEST_INTENT state")

            # Transition to TEST_EXECUTE state
            context = _run_store.transition_state(run_id, RunState.TEST_EXECUTE)

            # Execute the test instruction in background
            import asyncio
            asyncio.create_task(_execute_free_text_instruction(run_id, request.answer))

            message = f"Executing test: {request.answer[:100]}..."
            logger.info(f"[{run_id}] Started background execution of free text instruction")
        else:
            # Just store for later if not in correct state
            message = f"Command received: {request.answer[:100]}"

        # Return current status
        context = _run_store.get_run(run_id)
        return AnswerResponse(
            run_id=context.run_id,
            state=context.state.value,
            question=context.question,
            message=message,
            current_url=context.current_url
        )
    
    # Validate question_id matches current question
    if context.question and context.question.id != request.question_id:
        raise HTTPException(
            status_code=400,
            detail=f"Question ID mismatch. Expected: {context.question.id}, got: {request.question_id}"
        )
    
    # Handle answer based on current state
    message = None
    new_state = context.state
    next_question = None
    
    try:
        if context.state == RunState.WAIT_LOGIN_INPUT:
            # Parse credentials
            if context.question and context.question.type == "text":
                # Try to parse answer as JSON or comma-separated
                import json
                try:
                    creds = json.loads(request.answer)
                    username = creds.get("username", "")
                    password = creds.get("password", "")
                except:
                    # Try comma-separated format
                    parts = request.answer.split(",", 1)
                    username = parts[0].strip() if len(parts) > 0 else ""
                    password = parts[1].strip() if len(parts) > 1 else ""
                
                # Update auth config
                if context.auth:
                    context.auth.username = username
                    context.auth.password = password
                else:
                    context.auth = AuthConfig(
                        type="keycloak",
                        username=username,
                        password=password
                    )
                
                context = _run_store.update_run(run_id, auth=context.auth)
                new_state = RunState.LOGIN_ATTEMPT
                context = _run_store.transition_state(run_id, new_state)
                
                # Execute login attempt
                browser_manager = get_browser_manager()
                login_executor = get_login_executor()
                
                try:
                    page = await browser_manager.get_page(
                        run_id,
                        headless=context.headless,
                        debug=getattr(context, "discovery_debug", False),
                        artifacts_path=context.artifacts_path
                    )
                    login_result = await login_executor.attempt_login(
                        page=page,
                        run_id=run_id,
                        base_url=context.base_url,
                        username=context.auth.username,
                        password=context.auth.password,
                        artifacts_path=context.artifacts_path
                    )
                    
                    # Update current URL
                    current_url = page.url
                    context = _run_store.update_run(run_id, current_url=current_url)
                    
                    # Transition to next state
                    new_state = login_result["next_state"]
                    context = _run_store.transition_state(run_id, new_state)
                    
                    # Update question if needed
                    if login_result["question"]:
                        context = _run_store.update_run(run_id, question=login_result["question"])
                        message = login_result.get("error_message") or "Login attempt completed"
                    else:
                        # Login successful - perform post-login validation
                        if login_result["next_state"] == RunState.POST_LOGIN_VALIDATE:
                            post_login_validator = get_post_login_validator()
                            validation_result = await post_login_validator.validate_session(
                                page=page,
                                run_id=run_id,
                                base_url=context.base_url,
                                artifacts_path=context.artifacts_path
                            )
                            
                            # Update current URL
                            context = _run_store.update_run(run_id, current_url=validation_result["current_url"])
                            
                            # Transition to next state
                            new_state = validation_result["next_state"]
                            context = _run_store.transition_state(run_id, new_state)
                            
                            # Update question if bounced
                            if validation_result["question"]:
                                context = _run_store.update_run(run_id, question=validation_result["question"])
                                message = "Session not established - bounced back to Keycloak"
                            else:
                                # Session validated - perform context detection
                                if validation_result["next_state"] == RunState.CONTEXT_DETECT:
                                    context_detector = get_context_detector()
                                    detect_result = await context_detector.detect_context(
                                        page=page,
                                        run_id=run_id,
                                        artifacts_path=context.artifacts_path
                                    )
                                    
                                    # Update selected context if single option
                                    if detect_result.get("selected_context"):
                                        context = _run_store.update_run(run_id, selected_context=detect_result["selected_context"])
                                    
                                    # Transition to next state
                                    new_state = detect_result["next_state"]
                                    context = _run_store.transition_state(run_id, new_state)
                                    
                                    # Update question if multiple options
                                    if detect_result["question"]:
                                        context = _run_store.update_run(run_id, question=detect_result["question"])
                                        message = "Multiple contexts detected - please select one"
                                    else:
                                        # Context selected - proceed to discovery
                                        if detect_result["next_state"] == RunState.DISCOVERY_RUN:
                                            # Load image/document analysis hints
                                            image_hints = await _load_image_analysis_hints(
                                                context.uploaded_images,
                                                context.artifacts_path
                                            )
                                            document_analysis = await _load_document_analysis(
                                                context.uploaded_documents,
                                                context.artifacts_path
                                            )

                                            discovery_runner = get_discovery_runner()
                                            discovery_result = await discovery_runner.run_discovery(
                                                page=page,
                                                run_id=run_id,
                                                base_url=context.base_url,
                                                artifacts_path=context.artifacts_path,
                                                debug=getattr(context, "discovery_debug", False),
                                                image_hints=image_hints,
                                                document_analysis=document_analysis,
                                                phase=context.test_phase
                                            )
                                            
                                            # Store discovery summary in context
                                            context = _run_store.update_run(
                                                run_id,
                                                discovery_summary=discovery_result.get("summary", {})
                                            )
                                            
                                            # Transition to DISCOVERY_SUMMARY
                                            context = _run_store.transition_state(run_id, RunState.DISCOVERY_SUMMARY)
                                            
                                            # Generate discovery summary and transition to WAIT_TEST_INTENT
                                            discovery_summarizer = get_discovery_summarizer()
                                            summary_result = await discovery_summarizer.generate_summary(
                                                page=page,
                                                run_id=run_id,
                                                artifacts_path=context.artifacts_path
                                            )
                                            
                                            # Store detailed summary in context
                                            context = _run_store.update_run(
                                                run_id,
                                                discovery_summary=summary_result["summary"]
                                            )
                                            
                                            # Transition to WAIT_TEST_INTENT
                                            context = _run_store.transition_state(run_id, summary_result["next_state"])
                                            
                                            # Update question
                                            if summary_result["question"]:
                                                context = _run_store.update_run(run_id, question=summary_result["question"])
                                            
                                            message = f"Discovery completed: {summary_result['summary']['pages_count']} pages, {summary_result['summary']['forms_count']} forms found"
                                        else:
                                            message = f"Login successful and context detected: {detect_result.get('selected_context', 'default')}"
                                else:
                                    message = "Login successful and session validated"
                        else:
                            message = "Login successful"
                except Exception as e:
                    logger.error(f"[{run_id}] Login execution failed: {e}", exc_info=True)
                    # Fallback to asking for credentials again
                    question = Question(
                        id="login_creds",
                        type="text",
                        text=f"Login execution failed: {str(e)[:200]}. Please try again."
                    )
                    new_state = RunState.WAIT_LOGIN_INPUT
                    context = _run_store.transition_state(run_id, new_state)
                    context = _run_store.update_run(run_id, question=question)
                    message = "Login execution failed"
        
        elif context.state == RunState.WAIT_CONTEXT_INPUT:
            # Store selected context
            context = _run_store.update_run(run_id, selected_context=request.answer)
            new_state = RunState.DISCOVERY_RUN
            context = _run_store.transition_state(run_id, new_state)
            
            # Execute discovery
            browser_manager = get_browser_manager()
            discovery_runner = get_discovery_runner()
            
            try:
                page = await browser_manager.get_page(
                    run_id,
                    headless=context.headless,
                    debug=getattr(context, "discovery_debug", False),
                    artifacts_path=context.artifacts_path
                )
                discovery_result = await discovery_runner.run_discovery(
                    page=page,
                    run_id=run_id,
                    base_url=context.base_url,
                    artifacts_path=context.artifacts_path
                )
                
                # Store discovery summary in context
                context = _run_store.update_run(
                    run_id,
                    discovery_summary=discovery_result.get("summary", {})
                )
                
                # Transition to DISCOVERY_SUMMARY
                context = _run_store.transition_state(run_id, RunState.DISCOVERY_SUMMARY)
                
                # Generate discovery summary and transition to WAIT_TEST_INTENT
                discovery_summarizer = get_discovery_summarizer()
                summary_result = await discovery_summarizer.generate_summary(
                    page=page,
                    run_id=run_id,
                    artifacts_path=context.artifacts_path
                )
                
                # Store detailed summary in context
                context = _run_store.update_run(
                    run_id,
                    discovery_summary=summary_result["summary"]
                )
                
                # Transition to WAIT_TEST_INTENT
                context = _run_store.transition_state(run_id, summary_result["next_state"])
                
                # Update question
                if summary_result["question"]:
                    context = _run_store.update_run(run_id, question=summary_result["question"])
                
                message = f"Context selected: {request.answer}. Discovery completed: {summary_result['summary']['pages_count']} pages, {summary_result['summary']['forms_count']} forms found"
            except Exception as e:
                logger.error(f"[{run_id}] Discovery execution failed: {e}", exc_info=True)
                message = f"Context selected: {request.answer}. Discovery failed: {str(e)[:200]}"
        
        elif context.state == RunState.WAIT_LOGIN_CONFIRM:
            # Handle yes/no answer
            answer_lower = request.answer.lower().strip()
            if answer_lower in ["yes", "y", "true", "1"]:
                # User says they are logged in - proceed to context detection
                new_state = RunState.CONTEXT_DETECT
                context = _run_store.transition_state(run_id, new_state)
                
                # Perform context detection
                browser_manager = get_browser_manager()
                context_detector = get_context_detector()
                
                try:
                    page = await browser_manager.get_page(
                        run_id,
                        headless=context.headless,
                        debug=getattr(context, "discovery_debug", False),
                        artifacts_path=context.artifacts_path
                    )
                    detect_result = await context_detector.detect_context(
                        page=page,
                        run_id=run_id,
                        artifacts_path=context.artifacts_path
                    )
                    
                    # Update selected context if single option
                    if detect_result.get("selected_context"):
                        context = _run_store.update_run(run_id, selected_context=detect_result["selected_context"])
                    
                    # Transition to next state
                    new_state = detect_result["next_state"]
                    context = _run_store.transition_state(run_id, new_state)
                    
                    # Update question if multiple options
                    if detect_result["question"]:
                        context = _run_store.update_run(run_id, question=detect_result["question"])
                        message = "Multiple contexts detected - please select one"
                    else:
                        # Context selected - proceed to discovery
                        if detect_result["next_state"] == RunState.DISCOVERY_RUN:
                            discovery_runner = get_discovery_runner()
                            discovery_result = await discovery_runner.run_discovery(
                                page=page,
                                run_id=run_id,
                                base_url=context.base_url,
                                artifacts_path=context.artifacts_path,
                                debug=getattr(context, "discovery_debug", False)
                            )
                            
                            # Store discovery summary in context
                            context = _run_store.update_run(
                                run_id,
                                discovery_summary=discovery_result.get("summary", {})
                            )
                            
                            # Transition to DISCOVERY_SUMMARY
                            context = _run_store.transition_state(run_id, RunState.DISCOVERY_SUMMARY)
                            
                            # Generate discovery summary and transition to WAIT_TEST_INTENT
                            discovery_summarizer = get_discovery_summarizer()
                            summary_result = await discovery_summarizer.generate_summary(
                                page=page,
                                run_id=run_id,
                                artifacts_path=context.artifacts_path
                            )
                            
                            # Store detailed summary in context
                            context = _run_store.update_run(
                                run_id,
                                discovery_summary=summary_result["summary"]
                            )
                            
                            # Transition to WAIT_TEST_INTENT
                            context = _run_store.transition_state(run_id, summary_result["next_state"])
                            
                            # Update question
                            if summary_result["question"]:
                                context = _run_store.update_run(run_id, question=summary_result["question"])
                            
                            message = f"Discovery completed: {summary_result['summary']['pages_count']} pages, {summary_result['summary']['forms_count']} forms found"
                        else:
                            message = f"Proceeding with existing session. Context: {detect_result.get('selected_context', 'default')}"
                except Exception as e:
                    logger.error(f"[{run_id}] Context detection failed: {e}", exc_info=True)
                    # Default to proceeding without context
                    new_state = RunState.DISCOVERY_RUN
                    context = _run_store.transition_state(run_id, new_state)
                    message = "Proceeding with existing session (context detection failed)"
        
        elif context.state == RunState.WAIT_TEST_INTENT:
            # User selected test intent - build test plan
            test_intent = request.answer.lower().strip()
            
            if test_intent not in ["smoke", "crud_sanity", "module_based", "exploratory_15m"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid test intent: {test_intent}. Expected: smoke, crud_sanity, module_based, or exploratory_15m"
                )
            
            # Transition to TEST_PLAN_BUILD
            new_state = RunState.TEST_PLAN_BUILD
            context = _run_store.transition_state(run_id, new_state)
            
            # Build test plan
            browser_manager = get_browser_manager()
            test_plan_builder = get_test_plan_builder()
            
            try:
                page = await browser_manager.get_page(
                    run_id,
                    headless=context.headless,
                    debug=getattr(context, "discovery_debug", False),
                    artifacts_path=context.artifacts_path
                )
                plan_result = await test_plan_builder.build_test_plan(
                    page=page,
                    run_id=run_id,
                    artifacts_path=context.artifacts_path,
                    test_intent=test_intent
                )
                
                # If module_based and multiple modules, ask for module selection
                if plan_result.get("question"):
                    context = _run_store.update_run(run_id, question=plan_result["question"])
                    # Store modules for later use
                    context = _run_store.update_run(run_id, selected_context=test_intent)  # Store intent temporarily
                    message = f"Test intent selected: {test_intent}. Please select a module."
                else:
                    # Test plan built - store it and transition to TEST_EXECUTE
                    context = _run_store.update_run(
                        run_id,
                        test_plan=plan_result["test_plan"]
                    )
                    
                    # Transition to TEST_EXECUTE
                    new_state = plan_result["next_state"]
                    context = _run_store.transition_state(run_id, new_state)
                    
                    # Execute tests
                    test_executor = get_test_executor()
                    execution_result = await test_executor.execute_tests(
                        page=page,
                        run_id=run_id,
                        artifacts_path=context.artifacts_path,
                        test_plan=plan_result["test_plan"]
                    )
                    
                    # If unsafe deletes detected, pause and ask
                    if execution_result.get("question"):
                        context = _run_store.update_run(run_id, question=execution_result["question"])
                        message = f"Test plan built: {plan_result['test_plan']['total_tests']} tests. Unsafe deletes detected - confirmation required."
                    else:
                        # Transition to next state
                        next_state = execution_result["next_state"]
                        context = _run_store.transition_state(run_id, next_state)
                        message = f"Test execution completed: {execution_result['report']['passed']} passed, {execution_result['report']['failed']} failed"
                        
                        # Close browser if requested and state is DONE
                        if next_state == RunState.DONE and context.close_browser_on_complete:
                            try:
                                browser_manager = get_browser_manager()
                                await browser_manager.close_context(run_id)
                                logger.info(f"[{run_id}] Browser closed after test completion")
                            except Exception as e:
                                logger.warning(f"[{run_id}] Failed to close browser: {e}")
            except Exception as e:
                logger.error(f"[{run_id}] Test plan build failed: {e}", exc_info=True)
                message = f"Test plan build failed: {str(e)[:200]}"
        
        elif context.state == RunState.WAIT_TEST_INTENT_MODULE:
            # User selected module for module_based testing
            selected_module = request.answer
            
            # Build test plan for selected module
            browser_manager = get_browser_manager()
            test_plan_builder = get_test_plan_builder()
            
            try:
                page = await browser_manager.get_page(
                    run_id,
                    headless=context.headless,
                    debug=getattr(context, "discovery_debug", False),
                    artifacts_path=context.artifacts_path
                )
                
                # Load discovery data
                discovery_dir = Path(context.artifacts_path)
                discovery_file = discovery_dir / "discovery.json"
                with open(discovery_file) as f:
                    discovery_data = json.load(f)
                base_url = discovery_data.get("base_url", context.base_url)
                
                # Generate tests for this specific module
                module_tests = test_plan_builder._generate_module_tests(discovery_data, base_url, selected_module)
                
                # Build test plan
                test_plan = {
                    "run_id": run_id,
                    "test_intent": "module_based",
                    "module": selected_module,
                    "generated_at": test_plan_builder._get_timestamp(),
                    "total_tests": len(module_tests),
                    "tests": module_tests
                }
                
                # Save test plan to JSON file
                plan_file = discovery_dir / "test_plan.json"
                with open(plan_file, "w") as f:
                    json.dump(test_plan, f, indent=2, default=str)
                
                # Store test plan in context
                context = _run_store.update_run(
                    run_id,
                    test_plan=test_plan
                )
                
                # Transition to TEST_EXECUTE
                new_state = RunState.TEST_EXECUTE
                context = _run_store.transition_state(run_id, new_state)
                
                # Execute tests
                test_executor = get_test_executor()
                execution_result = await test_executor.execute_tests(
                    page=page,
                    run_id=run_id,
                    artifacts_path=context.artifacts_path,
                    test_plan=test_plan
                )
                
                # If unsafe deletes detected, pause and ask
                if execution_result.get("question"):
                    context = _run_store.update_run(run_id, question=execution_result["question"])
                    message = f"Test plan built for module '{selected_module}': {len(module_tests)} tests. Unsafe deletes detected - confirmation required."
                else:
                    # Transition to next state
                    next_state = execution_result["next_state"]
                    context = _run_store.transition_state(run_id, next_state)
                    message = f"Test execution completed: {execution_result['report']['passed']} passed, {execution_result['report']['failed']} failed"
                    
                    # Close browser if requested and state is DONE
                    if next_state == RunState.DONE and context.close_browser_on_complete:
                        try:
                            browser_manager = get_browser_manager()
                            await browser_manager.close_context(run_id)
                            logger.info(f"[{run_id}] Browser closed after test completion")
                        except Exception as e:
                            logger.warning(f"[{run_id}] Failed to close browser: {e}")
            except Exception as e:
                logger.error(f"[{run_id}] Module test plan build failed: {e}", exc_info=True)
                message = f"Module test plan build failed: {str(e)[:200]}"
        
        elif context.state == RunState.WAIT_LOGIN_CONFIRM:
            # Handle yes/no answer
            answer_lower = request.answer.lower().strip()
            if answer_lower in ["yes", "y", "true", "1"]:
                # User says they need to login - perform LOGIN_DETECT
                new_state = RunState.LOGIN_DETECT
                context = _run_store.transition_state(run_id, new_state)
                
                # Perform login detection
                login_detector = get_login_detector()
                detect_result = await login_detector.detect_login(
                    run_id=run_id,
                    context=context,
                    keycloak_detected=True  # Assume Keycloak if user says they need login
                )
                
                # Update auth if needed
                if detect_result["auth_updated"]:
                    context = _run_store.update_run(run_id, auth=context.auth)
                
                # Transition to next state from login detection
                new_state = detect_result["next_state"]
                context = _run_store.transition_state(run_id, new_state)
                
                # Update question if credentials needed
                if detect_result["question"]:
                    context = _run_store.update_run(run_id, question=detect_result["question"])
                    message = "Please provide login credentials"
                else:
                    message = "Credentials available, ready for login attempt"
            else:
                raise HTTPException(status_code=400, detail="Invalid answer. Expected: yes/no")
        
        elif context.state == RunState.TEST_EXECUTE:
            # Handle confirmation for unsafe deletes
            answer_lower = request.answer.lower().strip()
            
            if answer_lower in ["yes", "y", "true", "1"]:
                # User confirmed - execute tests with unsafe deletes
                browser_manager = get_browser_manager()
                test_executor = get_test_executor()
                
                try:
                    page = await browser_manager.get_page(
                        run_id,
                        headless=context.headless,
                        debug=getattr(context, "discovery_debug", False),
                        artifacts_path=context.artifacts_path
                    )
                    test_plan = context.test_plan
                    
                    if not test_plan:
                        raise ValueError("Test plan not found")
                    
                    execution_result = await test_executor.execute_tests(
                        page=page,
                        run_id=run_id,
                        artifacts_path=context.artifacts_path,
                        test_plan=test_plan
                    )
                    
                    # Transition to next state
                    next_state = execution_result["next_state"]
                    context = _run_store.transition_state(run_id, next_state)
                    message = f"Test execution completed: {execution_result['report']['passed']} passed, {execution_result['report']['failed']} failed"
                except Exception as e:
                    logger.error(f"[{run_id}] Test execution failed: {e}", exc_info=True)
                    message = f"Test execution failed: {str(e)[:200]}"
            else:
                # User declined - skip unsafe deletes and proceed
                message = "Skipping unsafe DELETE operations. Proceeding with safe tests only."
        
        elif context.state == RunState.REPORT_GENERATE:
            # Generate HTML report
            report_generator = get_report_generator()
            
            try:
                result = report_generator.generate_html_report(
                    run_id=run_id,
                    artifacts_path=context.artifacts_path
                )
                
                # Transition to DONE
                if not result.get("skipped"):
                    context = _run_store.transition_state(run_id, RunState.DONE)
                    message = f"HTML report generated: {result['html_path']}"
                else:
                    context = _run_store.transition_state(run_id, RunState.DONE)
                    message = "HTML report already exists, skipping generation"
                
                # Close browser if requested
                if context.close_browser_on_complete:
                    try:
                        browser_manager = get_browser_manager()
                        await browser_manager.close_context(run_id)
                        logger.info(f"[{run_id}] Browser closed after test completion")
                    except Exception as e:
                        logger.warning(f"[{run_id}] Failed to close browser: {e}")
            except Exception as e:
                logger.error(f"[{run_id}] Report generation failed: {e}", exc_info=True)
                message = f"Report generation failed: {str(e)[:200]}"
        
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Run is not in a state that accepts answers. Current state: {context.state.value}"
            )
        
        # Get updated context
        context = _run_store.get_run(run_id)
        
        return AnswerResponse(
            run_id=context.run_id,
            state=context.state.value,
            question=context.question,
            message=message
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to process answer for run {run_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to process answer: {str(e)}")


# =============================================================================
# Helper Functions
# =============================================================================

def _calculate_progress(state: RunState) -> int:
    """Calculate progress percentage based on state."""
    state_order = [
        RunState.START,
        RunState.OPEN_URL,
        RunState.SESSION_CHECK,
        RunState.LOGIN_DETECT,
        RunState.WAIT_LOGIN_INPUT,
        RunState.WAIT_LOGIN_CONFIRM,
        RunState.LOGIN_ATTEMPT,
        RunState.POST_LOGIN_VALIDATE,
        RunState.CONTEXT_DETECT,
        RunState.WAIT_CONTEXT_INPUT,
        RunState.DISCOVERY_RUN,
        RunState.DISCOVERY_SUMMARY,
        RunState.WAIT_TEST_INTENT,
        RunState.TEST_PLAN_BUILD,
        RunState.TEST_EXECUTE,
        RunState.REPORT_GENERATE,
        RunState.DONE
    ]
    
    try:
        index = state_order.index(state)
        progress = int((index / (len(state_order) - 1)) * 100)
        return min(100, max(0, progress))
    except ValueError:
        # State not in order (e.g., FAILED)
        return 0 if state == RunState.FAILED else 100


# =============================================================================
# Media Upload Endpoints
# =============================================================================

@router.post("/upload/image/pre-run", summary="Upload image before starting a run")
async def upload_image_pre_run(
    file: UploadFile = File(..., description="Image file to upload")
):
    """
    Upload an image file BEFORE starting a run.

    This allows users to upload screenshots for analysis before the discovery run begins.
    Images will be stored temporarily and can be associated with a run later.
    """
    try:
        # Validate file type
        if not file.content_type or not file.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="File must be an image")

        # Create temporary uploads directory
        temp_uploads_dir = Path("agent-api/data/temp_uploads/images")
        temp_uploads_dir.mkdir(parents=True, exist_ok=True)

        # Save file with unique ID
        file_id = uuid.uuid4().hex
        file_path = temp_uploads_dir / f"{file_id}_{file.filename}"
        with open(file_path, "wb") as f:
            content = await file.read()
            if len(content) > 10 * 1024 * 1024:  # 10MB limit
                raise HTTPException(status_code=400, detail="Image file too large (max 10MB)")
            f.write(content)

        logger.info(f"[PRE-RUN] Image uploaded: {file.filename} -> {file_path}")

        # Analyze the image without run_id
        image_analyzer = get_image_analyzer()
        analysis_result = await image_analyzer.analyze_image(
            image_path=file_path,
            run_id="pre-run",
            artifacts_path=str(temp_uploads_dir.parent)
        )

        return JSONResponse({
            "file_id": file_id,
            "filename": file.filename,
            "file_path": str(file_path),
            "size": len(content),
            "content_type": file.content_type,
            "analysis": {
                "ui_elements_count": len(analysis_result.get("ui_elements", [])),
                "text_items_count": len(analysis_result.get("text_content", [])),
                "components_detected": [c.get("type") for c in analysis_result.get("components_detected", [])],
                "workflow_hints": len(analysis_result.get("workflow_hints", [])),
                "workflows": [w.get("workflow") for w in analysis_result.get("workflow_hints", [])]
            },
            "message": "Image uploaded and analyzed successfully. UI elements and patterns extracted."
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[PRE-RUN] Failed to upload image: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to upload image: {str(e)}")


@router.post("/{run_id}/upload/image", summary="Upload image for future discovery analysis")
async def upload_image(
    run_id: str,
    file: UploadFile = File(..., description="Image file to upload")
):
    """
    Upload an image file for future discovery analysis.
    
    Images will be analyzed to:
    - Extract UI elements and components
    - Identify workflows and user journeys
    - Generate test cases from visual patterns
    - Detect accessibility issues
    """
    try:
        context = _run_store.get_run(run_id)
        if not context:
            raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
        
        # Validate file type
        if not file.content_type or not file.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="File must be an image")
        
        # Create uploads directory
        uploads_dir = Path(context.artifacts_path) / "uploads" / "images"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        
        # Save file
        file_path = uploads_dir / f"{uuid.uuid4().hex}_{file.filename}"
        with open(file_path, "wb") as f:
            content = await file.read()
            if len(content) > 10 * 1024 * 1024:  # 10MB limit
                raise HTTPException(status_code=400, detail="Image file too large (max 10MB)")
            f.write(content)
        
        logger.info(f"[{run_id}] Image uploaded: {file.filename} -> {file_path}")
        
        # Analyze the image
        image_analyzer = get_image_analyzer()
        analysis_result = await image_analyzer.analyze_image(
            image_path=file_path,
            run_id=run_id,
            artifacts_path=context.artifacts_path
        )
        
        return JSONResponse({
            "run_id": run_id,
            "filename": file.filename,
            "file_path": str(file_path.relative_to(context.artifacts_path)),
            "size": len(content),
            "content_type": file.content_type,
            "analysis": {
                "ui_elements_count": len(analysis_result.get("ui_elements", [])),
                "text_items_count": len(analysis_result.get("text_content", [])),
                "components_detected": [c.get("type") for c in analysis_result.get("components_detected", [])],
                "workflow_hints": len(analysis_result.get("workflow_hints", [])),
                "analysis_file": f"uploads/images/{file_path.stem}_analysis.json"
            },
            "message": "Image uploaded and analyzed successfully. UI elements and patterns extracted."
        })
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{run_id}] Failed to upload image: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to upload image: {str(e)}")


@router.post("/upload/document/pre-run", summary="Upload PRD/spec document before starting run")
async def upload_document_pre_run(
    file: UploadFile = File(..., description="Document file (TXT, MD, PDF, DOCX)")
):
    """
    Upload and analyze PRD/requirements document for test planning.

    This extracts:
    - Features and functionality requirements
    - User workflows and journeys
    - Acceptance criteria
    - Test scenarios
    - UI components mentioned
    - API endpoints mentioned
    """
    try:
        # Validate file type
        allowed_extensions = ['.txt', '.md', '.pdf', '.docx']
        file_ext = Path(file.filename).suffix.lower()

        if file_ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type. Allowed: {', '.join(allowed_extensions)}"
            )

        # Save document
        temp_uploads_dir = Path("agent-api/data/temp_uploads/documents")
        temp_uploads_dir.mkdir(parents=True, exist_ok=True)

        file_id = uuid.uuid4().hex
        file_path = temp_uploads_dir / f"{file_id}_{file.filename}"

        with open(file_path, "wb") as f:
            content = await file.read()
            if len(content) > 50 * 1024 * 1024:  # 50MB limit
                raise HTTPException(status_code=400, detail="Document file too large (max 50MB)")
            f.write(content)

        logger.info(f"[PRE-RUN] Document uploaded: {file.filename} -> {file_path}")

        # Analyze document
        from app.services.document_analyzer import get_document_analyzer
        doc_analyzer = get_document_analyzer()

        analysis_result = await doc_analyzer.analyze_document(
            doc_path=file_path,
            run_id="pre-run",
            artifacts_path=str(temp_uploads_dir.parent)
        )

        return JSONResponse({
            "file_id": file_id,
            "filename": file.filename,
            "file_path": str(file_path),
            "size": len(content),
            "format": file_ext,
            "analysis": {
                "features_count": len(analysis_result.get("features", [])),
                "workflows_count": len(analysis_result.get("workflows", [])),
                "acceptance_criteria_count": len(analysis_result.get("acceptance_criteria", [])),
                "test_scenarios_count": len(analysis_result.get("test_scenarios", [])),
                "features": [f["name"] for f in analysis_result.get("features", [])[:5]],  # First 5
                "workflows": [w["name"] for w in analysis_result.get("workflows", [])[:3]],  # First 3
                "ui_components_mentioned": analysis_result.get("ui_components_mentioned", []),
                "api_endpoints_mentioned": analysis_result.get("api_endpoints_mentioned", [])[:5]  # First 5
            },
            "message": "Document analyzed successfully. Test plan will be generated based on requirements."
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[PRE-RUN] Failed to upload document: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to upload document: {str(e)}")


@router.post("/{run_id}/upload/video", summary="Upload video for future discovery analysis")
async def upload_video(
    run_id: str,
    file: UploadFile = File(..., description="Video file to upload")
):
    """
    Upload a video file for future discovery analysis.
    
    Videos will be analyzed to:
    - Extract user workflows and interactions
    - Identify UI state changes
    - Generate test scenarios from recorded actions
    - Compare UI behavior over time
    """
    try:
        context = _run_store.get_run(run_id)
        if not context:
            raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
        
        # Validate file type
        if not file.content_type or not file.content_type.startswith('video/'):
            raise HTTPException(status_code=400, detail="File must be a video")
        
        # Create uploads directory
        uploads_dir = Path(context.artifacts_path) / "uploads" / "videos"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        
        # Save file
        file_path = uploads_dir / f"{uuid.uuid4().hex}_{file.filename}"
        with open(file_path, "wb") as f:
            content = await file.read()
            if len(content) > 100 * 1024 * 1024:  # 100MB limit
                raise HTTPException(status_code=400, detail="Video file too large (max 100MB)")
            f.write(content)
        
        logger.info(f"[{run_id}] Video uploaded: {file.filename} -> {file_path}")
        
        return JSONResponse({
            "run_id": run_id,
            "filename": file.filename,
            "file_path": str(file_path.relative_to(context.artifacts_path)),
            "size": len(content),
            "content_type": file.content_type,
            "message": "Video uploaded successfully. Will be analyzed for future discovery features."
        })
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{run_id}] Failed to upload video: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to upload video: {str(e)}")


@router.post("/{run_id}/upload/images", summary="Upload multiple images")
async def upload_images(
    run_id: str,
    files: list[UploadFile] = File(..., description="Image files to upload")
):
    """Upload multiple image files at once."""
    try:
        context = _run_store.get_run(run_id)
        if not context:
            raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
        
        uploads_dir = Path(context.artifacts_path) / "uploads" / "images"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        
        uploaded_files = []
        for file in files:
            if not file.content_type or not file.content_type.startswith('image/'):
                continue
            
            file_path = uploads_dir / f"{uuid.uuid4().hex}_{file.filename}"
            with open(file_path, "wb") as f:
                content = await file.read()
                if len(content) > 10 * 1024 * 1024:
                    continue
                f.write(content)
            
            uploaded_files.append({
                "filename": file.filename,
                "file_path": str(file_path.relative_to(context.artifacts_path)),
                "size": len(content)
            })
        
        logger.info(f"[{run_id}] Uploaded {len(uploaded_files)} images")
        
        # Analyze all uploaded images
        image_analyzer = get_image_analyzer()
        analysis_results = []
        for file_info in uploaded_files:
            file_path = Path(context.artifacts_path) / file_info["file_path"]
            if file_path.exists():
                try:
                    analysis = await image_analyzer.analyze_image(
                        image_path=file_path,
                        run_id=run_id,
                        artifacts_path=context.artifacts_path
                    )
                    analysis_results.append({
                        "filename": file_info["filename"],
                        "ui_elements": len(analysis.get("ui_elements", [])),
                        "components": [c.get("type") for c in analysis.get("components_detected", [])],
                        "workflows": len(analysis.get("workflow_hints", []))
                    })
                except Exception as e:
                    logger.error(f"[{run_id}] Failed to analyze {file_info['filename']}: {e}")
        
        return JSONResponse({
            "run_id": run_id,
            "uploaded_count": len(uploaded_files),
            "files": uploaded_files,
            "analysis_results": analysis_results,
            "message": f"Successfully uploaded and analyzed {len(uploaded_files)} image(s). Extracted UI elements, components, and workflow patterns."
        })
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{run_id}] Failed to upload images: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to upload images: {str(e)}")


@router.post("/{run_id}/upload/videos", summary="Upload multiple videos")
async def upload_videos(
    run_id: str,
    files: list[UploadFile] = File(..., description="Video files to upload")
):
    """Upload multiple video files at once."""
    try:
        context = _run_store.get_run(run_id)
        if not context:
            raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
        
        uploads_dir = Path(context.artifacts_path) / "uploads" / "videos"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        
        uploaded_files = []
        for file in files:
            if not file.content_type or not file.content_type.startswith('video/'):
                continue
            
            file_path = uploads_dir / f"{uuid.uuid4().hex}_{file.filename}"
            with open(file_path, "wb") as f:
                content = await file.read()
                if len(content) > 100 * 1024 * 1024:
                    continue
                f.write(content)
            
            uploaded_files.append({
                "filename": file.filename,
                "file_path": str(file_path.relative_to(context.artifacts_path)),
                "size": len(content)
            })
        
        logger.info(f"[{run_id}] Uploaded {len(uploaded_files)} videos")
        
        return JSONResponse({
            "run_id": run_id,
            "uploaded_count": len(uploaded_files),
            "files": uploaded_files,
            "message": f"Successfully uploaded {len(uploaded_files)} video(s)"
        })
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{run_id}] Failed to upload videos: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to upload videos: {str(e)}")


# =============================================================================
# Database Storage & Comparison Endpoints
# =============================================================================

@router.post("/{run_id}/store", summary="Store run analysis in database")
async def store_run_analysis(
    run_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Store completed run analysis in database.
    
    This endpoint stores:
    - Run metadata
    - Discovery results (pages, forms, tables)
    - Generated test cases
    - Screenshots and artifacts paths
    """
    from app.services.db_storage import DatabaseStorageService
    from app.database.repositories import RunRepository
    
    try:
        context = _run_store.get_run(run_id)
        if not context:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

        # Check if already stored
        existing_run = await RunRepository.get_run(db, run_id)
        if existing_run:
            return {"message": "Run already stored in database", "run_id": run_id}

        # Store run metadata
        await DatabaseStorageService.store_run_metadata(
            db=db,
            run_id=run_id,
            base_url=context.base_url,
            env=context.env,
            artifacts_path=context.artifacts_path,
            config={
                "headless": context.headless,
                "discovery_debug": context.discovery_debug,
                "auth": context.auth.__dict__ if context.auth else None
            }
        )

        # Store discovery results
        discovery_file = Path(context.artifacts_path) / "discovery.json"
        if discovery_file.exists():
            await DatabaseStorageService.store_discovery_results(db, run_id, discovery_file)

        # Extract and store test cases
        features_response = await get_discovery_features(run_id)
        if "features" in features_response:
            all_test_cases = []
            for feature in features_response["features"]:
                for tc in feature.get("test_cases", []):
                    tc["feature_name"] = feature["feature_name"]
                    all_test_cases.append(tc)
            
            if all_test_cases:
                await DatabaseStorageService.store_test_cases(db, run_id, all_test_cases)

        # Mark as completed
        await DatabaseStorageService.complete_run(db, run_id, context.status.value)

        logger.info(f"[{run_id}] Stored complete analysis in database")

        return {
            "run_id": run_id,
            "message": "Run analysis stored successfully in database",
            "stored": {
                "metadata": True,
                "discovery": discovery_file.exists(),
                "test_cases": len(all_test_cases) if all_test_cases else 0
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{run_id}] Failed to store analysis: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to store analysis: {str(e)}")


@router.get("/compare/{run_id_a}/vs/{run_id_b}", summary="Compare two runs")
async def compare_runs(
    run_id_a: str,
    run_id_b: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Compare two discovery runs to identify differences.
    
    Returns:
    - Pages added/removed/changed
    - Forms added/removed
    - Test cases added/removed
    - Overall summary of changes
    """
    from app.services.db_storage import DatabaseStorageService
    from app.database.repositories import RunRepository, ComparisonRepository
    
    try:
        # Check if runs exist in database
        run_a = await RunRepository.get_run(db, run_id_a)
        run_b = await RunRepository.get_run(db, run_id_b)

        if not run_a:
            raise HTTPException(status_code=404, detail=f"Run {run_id_a} not found in database. Store it first using POST /{run_id_a}/store")
        if not run_b:
            raise HTTPException(status_code=404, detail=f"Run {run_id_b} not found in database. Store it first using POST /{run_id_b}/store")

        # Check if comparison already exists
        existing_comparison = await ComparisonRepository.get_comparison(db, run_id_a, run_id_b)
        if existing_comparison:
            return {
                "comparison": existing_comparison.comparison_data,
                "compared_at": existing_comparison.compared_at.isoformat(),
                "cached": True
            }

        # Perform comparison
        comparison_data = await DatabaseStorageService.compare_runs(db, run_id_a, run_id_b)

        return {
            "comparison": comparison_data,
            "compared_at": datetime.utcnow().isoformat(),
            "cached": False
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to compare runs {run_id_a} vs {run_id_b}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to compare runs: {str(e)}")


@router.get("/history", summary="Get run history for a base URL")
async def get_run_history(
    base_url: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """
    Get historical runs for a specific base URL.
    
    Useful for tracking changes over time and comparing with previous runs.
    """
    from app.services.db_storage import DatabaseStorageService
    
    try:
        runs = await DatabaseStorageService.get_historical_runs(db, base_url, limit)
        
        return {
            "base_url": base_url,
            "runs": runs,
            "total": len(runs),
            "message": f"Found {len(runs)} historical run(s) for {base_url}"
        }
    
    except Exception as e:
        logger.error(f"Failed to get history for {base_url}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get run history: {str(e)}")


@router.get("/{run_id}/test-results", summary="Get test execution results for a run")
async def get_test_results(run_id: str):
    """Get test execution results from report.json."""
    try:
        context = _run_store.get_run(run_id)
        if not context:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
        
        report_file = Path(context.artifacts_path) / "report.json"
        if not report_file.exists():
            raise HTTPException(status_code=404, detail="Test results not found. Execute tests first.")
        
        with open(report_file, "r") as f:
            report_data = json.load(f)
        
        return report_data
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{run_id}] Failed to get test results: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get test results: {str(e)}")


@router.get("/{run_id}/test-cases", summary="Get test cases for a run")
async def get_test_cases(run_id: str):
    """Get all generated test cases for a run."""
    try:
        # Try to get artifacts path from run context first
        context = _run_store.get_run(run_id)
        if context:
            test_cases_file = Path(context.artifacts_path) / "test_cases.json"
        else:
            # If run not in memory, try loading from file system directly
            data_dir = Path("data")
            if not data_dir.exists():
                data_dir = Path("agent-api/data")

            run_dir = data_dir / run_id
            if not run_dir.exists():
                raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

            test_cases_file = run_dir / "test_cases.json"

        if not test_cases_file.exists():
            # Return empty if not generated yet
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


class ExecuteTestCasesRequest(BaseModel):
    """Request to execute selected test cases."""
    test_case_ids: List[str] = Field(..., description="List of test case IDs to execute")
    execution_name: str = Field(..., description="Name for this test execution run")
    description: Optional[str] = Field(None, description="Description of the test execution")
    base_url: str = Field(..., description="Base application URL to test", examples=["https://app.example.com"])
    environment: str = Field(default="staging", description="Environment name")
    username: str = Field(..., description="Username for authentication")
    password: str = Field(..., description="Password for authentication")
    headless: Optional[bool] = Field(True, description="Run browser in headless mode")


@router.post("/{run_id}/execute-tests", summary="Execute selected test cases")
async def execute_test_cases(run_id: str, request: ExecuteTestCasesRequest = Body(...)):
    """
    Execute selected test cases by their IDs.
    
    This endpoint allows executing specific test cases that were generated during discovery.
    Creates a new test execution run and stores results in database.
    """
    logger.info(f"[{run_id}] ===== EXECUTE TESTS ENDPOINT CALLED =====")
    logger.info(f"[{run_id}] Test execution request received: {len(request.test_case_ids)} test cases")
    logger.info(f"[{run_id}] Request data: execution_name={request.execution_name}, base_url={request.base_url}, environment={request.environment}")
    execution_id = str(uuid.uuid4())[:12]
    
    try:
        context = _run_store.get_run(run_id)
        if not context:
            logger.warning(f"[{run_id}] Run not found in run store")
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
        
        # Load test cases
        test_cases_file = Path(context.artifacts_path) / "test_cases.json"
        if not test_cases_file.exists():
            raise HTTPException(status_code=404, detail="Test cases not found. Please run discovery first.")
        
        with open(test_cases_file, "r") as f:
            test_cases_data = json.load(f)
        
        # Find selected test cases
        all_test_cases = []
        for scenario in test_cases_data.get("scenarios", []):
            scenario_tests = scenario.get("test_cases", [])
            for test in scenario_tests:
                # Log test details for debugging
                test_id = test.get("id", "N/A")
                steps = test.get("steps", [])
                steps_count = len(steps)
                if steps_count > 0:
                    # Show first few steps with their action types
                    step_preview = []
                    for s in steps[:3]:
                        if isinstance(s, str):
                            # String step - extract action
                            step_lower = s.lower()
                            if "navigate" in step_lower:
                                step_preview.append(f"navigate: {s[:40]}")
                            elif "count" in step_lower:
                                step_preview.append(f"count: {s[:40]}")
                            elif "enter" in step_lower or "fill" in step_lower:
                                step_preview.append(f"fill: {s[:40]}")
                            elif "wait" in step_lower:
                                step_preview.append(f"wait: {s[:40]}")
                            elif "verify" in step_lower:
                                step_preview.append(f"verify: {s[:40]}")
                            elif "clear" in step_lower:
                                step_preview.append(f"clear: {s[:40]}")
                            else:
                                step_preview.append(f"other: {s[:40]}")
                        elif isinstance(s, dict):
                            # Dict step (TestStep format)
                            action = s.get('action', 'unknown')
                            selector = s.get('selector', '')[:20] if s.get('selector') else ''
                            step_preview.append(f"{action}: {selector}")
                        else:
                            step_preview.append(str(s)[:50])
                    logger.info(f"[{execution_id}] Test {test_id} has {steps_count} steps. First steps: {step_preview}")
                else:
                    logger.warning(f"[{execution_id}] Test {test_id} has NO steps in test_cases.json - will try to load from discovery")
            all_test_cases.extend(scenario_tests)
        
        logger.info(f"[{execution_id}] Loaded {len(all_test_cases)} total test cases from test_cases.json")
        
        # Filter by selected IDs
        selected_tests = []
        for test_id in request.test_case_ids:
            found = False
            
            # Try multiple matching strategies
            # 1. Try exact match first (full ID)
            for tc in all_test_cases:
                tc_id = tc.get("id") or tc.get("test_id") or ""
                if tc_id == test_id:
                    selected_tests.append(tc)
                    found = True
                    logger.info(f"[{run_id}] Matched test case by exact ID: {test_id}")
                    break
            
            if found:
                continue
            
            # 2. Try matching with different ID field names
            for tc in all_test_cases:
                tc_id = tc.get("id") or tc.get("test_id") or ""
                # Try case-insensitive match
                if tc_id.lower() == test_id.lower():
                    selected_tests.append(tc)
                    found = True
                    logger.info(f"[{run_id}] Matched test case by case-insensitive ID: {test_id}")
                    break
            
            if found:
                continue
            
            # 3. Try splitting (format: feature_name_test_id or scenario_X_Y)
            # Try splitting from the end to get the actual test ID
            parts = test_id.split("_")
            if len(parts) > 1:
                # Try last part as ID
                test_id_part = parts[-1]
                for tc in all_test_cases:
                    tc_id = tc.get("id") or tc.get("test_id") or ""
                    if tc_id == test_id_part or tc_id.endswith(test_id_part) or test_id_part in tc_id:
                        selected_tests.append(tc)
                        found = True
                        logger.info(f"[{run_id}] Matched test case by partial ID: {test_id} -> {test_id_part}")
                        break
            
            if found:
                continue
            
            # 4. Try matching by name if ID doesn't match
            test_name_lower = test_id.lower()
            for tc in all_test_cases:
                tc_name = (tc.get("name") or tc.get("test_name") or "").lower()
                if test_name_lower in tc_name or tc_name in test_name_lower:
                    selected_tests.append(tc)
                    found = True
                    logger.info(f"[{run_id}] Matched test case by name: {test_id}")
                    break
            
            if not found:
                logger.warning(f"[{run_id}] Could not match test case ID: {test_id}")
                # Log available test case IDs for debugging
                available_ids = [tc.get("id") or tc.get("test_id") or "N/A" for tc in all_test_cases[:5]]
                logger.warning(f"[{run_id}] Sample available test case IDs: {available_ids}")
        
        if not selected_tests:
            raise HTTPException(status_code=400, detail="No matching test cases found for the provided IDs")
        
        # Create execution artifacts directory
        execution_artifacts_path = Path(context.artifacts_path) / "executions" / execution_id
        execution_artifacts_path.mkdir(parents=True, exist_ok=True)
        
        # Load discovery data to get steps if test cases don't have them
        discovery_file = Path(context.artifacts_path) / "discovery.json"
        discovery_data = {}
        if discovery_file.exists():
            try:
                with open(discovery_file, "r") as f:
                    discovery_data = json.load(f)
                logger.info(f"[{execution_id}] Loaded discovery data with {len(discovery_data.get('pages', []))} pages")
            except Exception as e:
                logger.warning(f"[{execution_id}] Failed to load discovery.json: {e}")
        
        # Enhance test cases with steps from discovery if missing
        # IMPORTANT: Steps should already be in test_cases.json - only load from discovery if missing
        tests_with_steps = 0
        tests_without_steps = 0
        for test in selected_tests:
            if test.get("steps") and len(test.get("steps", [])) > 0:
                tests_with_steps += 1
                logger.info(f"[{execution_id}] Test {test.get('id')} already has {len(test.get('steps', []))} steps from test_cases.json - using them")
            else:
                tests_without_steps += 1
                logger.warning(f"[{execution_id}] Test case {test.get('id')} has no steps in test_cases.json, attempting to load from discovery data")
                
                # Try to find steps from discovery data based on test name or page
                test_name = test.get("name", "").lower()
                test_page_url = test.get("page_url") or test.get("url")
                
                # Look for matching page in discovery
                if discovery_data.get("pages"):
                    for page in discovery_data.get("pages", []):
                        page_url = page.get("url", "")
                        if test_page_url and (test_page_url in page_url or page_url in test_page_url):
                            # Found matching page - try to extract steps
                            # Steps might be in page discovery trace or actions
                            if page.get("discovery_steps"):
                                test["steps"] = page.get("discovery_steps")
                                logger.info(f"[{execution_id}] Loaded {len(test['steps'])} steps from discovery.steps for test {test.get('id')}")
                            elif page.get("actions"):
                                # Convert actions to steps
                                test["steps"] = [{"action": "navigate", "target": page_url}] + [
                                    {"action": action.get("type", "click"), "target": action.get("selector", "")}
                                    for action in page.get("actions", [])[:5]  # Limit to first 5 actions
                                ]
                                logger.info(f"[{execution_id}] Created {len(test['steps'])} steps from page actions for test {test.get('id')}")
                            elif page.get("forms"):
                                # If page has forms, create steps to interact with forms
                                forms = page.get("forms", [])[:1]  # Take first form
                                if forms:
                                    form = forms[0]
                                    form_steps = [{"action": "navigate", "target": page_url}]
                                    # Add form fill step if form has inputs
                                    if form.get("inputs"):
                                        form_steps.append({
                                            "action": "fill_form",
                                            "fields": [
                                                {"name": inp.get("name"), "value": f"test_{inp.get('type', 'text')}", "type": inp.get("type", "text")}
                                                for inp in form.get("inputs", [])[:3] if inp.get("name") and inp.get("type") != "hidden"
                                            ]
                                        })
                                    test["steps"] = form_steps
                                    logger.info(f"[{execution_id}] Created {len(test['steps'])} steps from page forms for test {test.get('id')}")
                            break
                
                # Log if still no steps found
                if not test.get("steps") or len(test.get("steps", [])) == 0:
                    logger.warning(f"[{execution_id}] Could not find steps in discovery data for test {test.get('id')}. Test will be skipped during execution.")
        
        # Log test plan details
        logger.info(f"[{execution_id}] ===== TEST PLAN SUMMARY =====")
        logger.info(f"[{execution_id}] Total tests selected: {len(selected_tests)}")
        logger.info(f"[{execution_id}] Tests with steps: {tests_with_steps}, Tests without steps: {tests_without_steps}")
        total_steps = 0
        for idx, test in enumerate(selected_tests):
            steps = test.get("steps", [])
            steps_count = len(steps)
            total_steps += steps_count
            if idx < 5:  # Log first 5 tests
                step_types = []
                for s in steps[:3]:
                    if isinstance(s, str):
                        # Extract action from string step
                        if "navigate" in s.lower():
                            step_types.append("navigate")
                        elif "count" in s.lower():
                            step_types.append("count")
                        elif "enter" in s.lower() or "fill" in s.lower():
                            step_types.append("enter")
                        elif "wait" in s.lower():
                            step_types.append("wait")
                        elif "verify" in s.lower():
                            step_types.append("verify")
                        elif "clear" in s.lower():
                            step_types.append("clear")
                        else:
                            step_types.append("other")
                    elif isinstance(s, dict):
                        step_types.append(s.get("action", "unknown"))
                    else:
                        step_types.append("unknown")
                logger.info(f"[{execution_id}] Test {idx+1}: {test.get('id')} - {test.get('name')} - {steps_count} steps (types: {step_types})")
        logger.info(f"[{execution_id}] Total steps to execute: {total_steps}")
        if total_steps == 0:
            logger.error(f"[{execution_id}] WARNING: No steps found in any test! Tests will be skipped.")
        
        test_plan = {
            "test_intent": "selected_tests",
            "total_tests": len(selected_tests),
            "tests": selected_tests
        }
        
        # Get browser page (create new context for test execution)
        browser_manager = get_browser_manager()
        # Use headless from request if provided, otherwise use context default
        execution_headless = request.headless if request.headless is not None else context.headless
        page = await browser_manager.get_page(
            execution_id,  # Use execution_id for test execution
            headless=execution_headless,
            debug=getattr(context, "discovery_debug", False),
            artifacts_path=str(execution_artifacts_path)
        )
        
        # Navigate to the base URL
        try:
            logger.info(f"[{execution_id}] Navigating to base URL: {request.base_url}")
            await page.goto(request.base_url, wait_until="networkidle", timeout=30000)
            await asyncio.sleep(2)  # Wait for page to fully load
        except Exception as e:
            logger.warning(f"[{execution_id}] Failed to navigate to base URL: {e}")
            # Continue anyway - login might handle navigation
        
        # Login with provided credentials
        if request.username and request.password:
            try:
                from app.services.login_executor import get_login_executor
                login_executor = get_login_executor()
                logger.info(f"[{execution_id}] Attempting login with username: {request.username}")
                
                # Use attempt_login method which requires base_url and artifacts_path
                login_result = await login_executor.attempt_login(
                    page=page,
                    run_id=execution_id,
                    base_url=request.base_url,
                    username=request.username,
                    password=request.password,
                    artifacts_path=str(execution_artifacts_path)
                )
                
                if login_result.get("status") != "success":
                    error_msg = login_result.get("error_message", "Login failed")
                    logger.warning(f"[{execution_id}] Login failed: {error_msg}")
                    # Continue execution anyway - some tests might work without login
                else:
                    logger.info(f"[{execution_id}] Login successful")
            except Exception as e:
                logger.error(f"[{execution_id}] Login attempt failed: {e}", exc_info=True)
                # Continue execution anyway
        
        # Record execution start time BEFORE creating database record
        execution_start_time = datetime.utcnow()
        
        # Create execution record in database first (with "running" status)
        execution_run_id = None
        try:
            from app.database import get_db
            from app.models.database import TestExecutionRun
            
            async for db in get_db():
                try:
                    exec_run = TestExecutionRun(
                        execution_id=execution_id,
                        discovery_run_id=run_id,
                        execution_name=request.execution_name,
                        description=request.description,
                        environment=request.environment,
                        auth_type=context.auth.type if context.auth else "basic",
                        username=request.username,
                        started_at=execution_start_time,
                        completed_at=None,
                        total_tests=len(selected_tests),
                        passed=0,
                        failed=0,
                        skipped=0,
                        duration_seconds=0,
                        status="running",
                        execution_results=None,
                        artifacts_path=str(execution_artifacts_path),
                        headless=execution_headless
                    )
                    db.add(exec_run)
                    await db.commit()
                    execution_run_id = execution_id
                    logger.info(f"[{execution_id}] Execution record created with 'running' status at {execution_start_time}")
                except Exception as db_error:
                    await db.rollback()
                    logger.warning(f"[{execution_id}] Failed to create initial execution record: {db_error}")
                break
        except Exception as db_error:
            logger.warning(f"[{execution_id}] Database initialization failed (continuing anyway): {db_error}")
        
        # Execute tests
        logger.info(f"[{execution_id}] ===== STARTING TEST EXECUTION =====")
        logger.info(f"[{execution_id}] Test plan contains {len(test_plan.get('tests', []))} tests")
        logger.info(f"[{execution_id}] Page URL before execution: {page.url}")
        
        test_executor = get_test_executor()
        test_execution_start_time = datetime.utcnow()
        
        try:
            execution_result = await test_executor.execute_tests(
                page=page,
                run_id=execution_id,
                artifacts_path=str(execution_artifacts_path),
                test_plan=test_plan
            )
            
            # Validate execution result
            if not execution_result or not execution_result.get("report"):
                logger.error(f"[{execution_id}] ERROR: Execution result is empty or missing report!")
                raise ValueError("Test execution returned empty result")
            
            report = execution_result.get("report", {})
            logger.info(f"[{execution_id}] Execution result: {report.get('passed', 0)} passed, {report.get('failed', 0)} failed, {len(report.get('tests', []))} test results")
            
        except Exception as exec_error:
            logger.error(f"[{execution_id}] Test execution failed with exception: {exec_error}", exc_info=True)
            # Create error result
            execution_result = {
                "report": {
                    "run_id": execution_id,
                    "status": "failed",
                    "started_at": test_execution_start_time.isoformat() + "Z",
                    "completed_at": datetime.utcnow().isoformat() + "Z",
                    "total_tests": len(test_plan.get("tests", [])),
                    "passed": 0,
                    "failed": 1,
                    "skipped": 0,
                    "tests": [],
                    "error": str(exec_error)[:500]
                },
                "next_state": "DONE",
                "question": None,
                "unsafe_deletes": None
            }
        
        test_execution_end_time = datetime.utcnow()
        execution_duration = (test_execution_end_time - test_execution_start_time).total_seconds()
        total_duration = (test_execution_end_time - execution_start_time).total_seconds()
        logger.info(f"[{execution_id}] Test execution duration: {execution_duration:.2f} seconds")
        logger.info(f"[{execution_id}] Total execution duration (including setup): {total_duration:.2f} seconds")
        
        # Generate Allure-style HTML report
        allure_report_path = None
        try:
            from app.services.report_generator import get_report_generator
            report_generator = get_report_generator()
            allure_report_path = report_generator.generate_allure_report(
                execution_id=execution_id,
                execution_name=request.execution_name,
                execution_result=execution_result,
                artifacts_path=str(execution_artifacts_path),
                base_url=request.base_url,
                environment=request.environment
            )
            logger.info(f"[{execution_id}] Allure-style report generated: {allure_report_path}")
        except Exception as e:
            logger.error(f"[{execution_id}] Failed to generate Allure report: {e}", exc_info=True)
            # Don't fail the whole execution if report generation fails
        
        # Update execution in database (update existing record or create new one)
        try:
            from app.database import get_db
            from app.models.database import TestExecutionRun, TestExecutionResult
            from sqlalchemy import select
            
            async for db in get_db():
                try:
                    # Check if execution record already exists
                    result = await db.execute(
                        select(TestExecutionRun).where(TestExecutionRun.execution_id == execution_id)
                    )
                    exec_run = result.scalar_one_or_none()
                    
                    if exec_run:
                        # Update existing record with accurate counts from report
                        report = execution_result.get("report", {})
                        
                        # Calculate accurate counts from test results
                        passed_count = report.get("passed", 0)
                        failed_count = report.get("failed", 0)
                        skipped_count = report.get("skipped", 0)
                        total_tests_count = report.get("total_tests", len(report.get("tests", [])))
                        
                        # Ensure counts match actual test results
                        if total_tests_count > 0:
                            # Recalculate from actual test results if needed
                            tests = report.get("tests", [])
                            if tests:
                                passed_count = len([t for t in tests if t.get("status") == "passed"])
                                failed_count = len([t for t in tests if t.get("status") == "failed"])
                                skipped_count = len([t for t in tests if t.get("status") == "skipped"])
                                total_tests_count = len(tests)
                        
                        exec_run.completed_at = test_execution_end_time
                        exec_run.passed = passed_count
                        exec_run.failed = failed_count
                        exec_run.skipped = skipped_count
                        exec_run.total_tests = total_tests_count
                        exec_run.duration_seconds = total_duration  # Use total duration including setup
                        exec_run.status = "completed" if failed_count == 0 else "failed"
                        exec_run.execution_results = report
                        
                        await db.commit()
                        logger.info(f"[{execution_id}] Updated execution record in database: status={exec_run.status}, duration={total_duration:.2f}s, total={total_tests_count}, passed={passed_count}, failed={failed_count}, skipped={skipped_count}")
                    else:
                        # Create new record if it doesn't exist
                        exec_run = TestExecutionRun(
                            execution_id=execution_id,
                            discovery_run_id=run_id,
                            execution_name=request.execution_name,
                            description=request.description,
                            environment=request.environment,
                            auth_type=context.auth.type if context.auth else "basic",
                            username=request.username,  # In production, encrypt this
                            started_at=execution_start_time,
                            completed_at=test_execution_end_time,
                            total_tests=len(selected_tests),
                            passed=execution_result.get("report", {}).get("passed", 0),
                            failed=execution_result.get("report", {}).get("failed", 0),
                            skipped=execution_result.get("report", {}).get("skipped", 0),
                            duration_seconds=total_duration,
                            status="completed" if execution_result.get("report", {}).get("failed", 0) == 0 else "failed",
                            execution_results=execution_result.get("report"),
                            artifacts_path=str(execution_artifacts_path),
                            headless=execution_headless
                        )
                        db.add(exec_run)
                    
                    # Store individual test results
                    for test_result in execution_result.get("report", {}).get("tests", []):
                        exec_result = TestExecutionResult(
                            execution_id=execution_id,
                            test_id=test_result.get("test_id", ""),
                            test_name=test_result.get("name", ""),
                            test_type=test_result.get("test_type", test_result.get("type", "")),
                            status=test_result.get("status", "failed"),
                            duration_ms=test_result.get("duration_ms", 0),
                            executed_at=start_time,
                            steps=test_result.get("steps", []),
                            error_message=test_result.get("error"),
                            screenshot_path=test_result.get("evidence", [{}])[0].get("path") if test_result.get("evidence") and len(test_result.get("evidence", [])) > 0 else None,
                            evidence=test_result.get("evidence")
                        )
                        db.add(exec_result)
                    
                    await db.commit()
                    logger.info(f"[{execution_id}] Test execution stored in database")
                except Exception as db_error:
                    await db.rollback()
                    logger.error(f"[{execution_id}] Failed to store execution in database: {db_error}", exc_info=True)
                break
        except Exception as db_error:
            logger.warning(f"[{execution_id}] Database storage failed (continuing anyway): {db_error}")
        
        # Close browser context
        try:
            await browser_manager.close_context(execution_id)
        except:
            pass
        
        return {
            "execution_id": execution_id,
            "run_id": run_id,
            "status": "completed",
            "execution_result": execution_result,
            "tests_executed": len(selected_tests),
            "passed": execution_result.get("report", {}).get("passed", 0),
            "failed": execution_result.get("report", {}).get("failed", 0),
            "skipped": execution_result.get("report", {}).get("skipped", 0)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{run_id}] Failed to execute test cases: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to execute test cases: {str(e)}")


@router.get("/executions/list", summary="List all test execution runs")
async def list_test_executions(db: AsyncSession = Depends(get_db)):
    """List all test execution runs from database."""
    try:
        from app.models.database import TestExecutionRun
        from sqlalchemy import select, desc
        
        result = await db.execute(
            select(TestExecutionRun).order_by(desc(TestExecutionRun.started_at)).limit(100)
        )
        executions = result.scalars().all()
        
        executions_list = []
        for exec_run in executions:
            executions_list.append({
                "execution_id": exec_run.execution_id,
                "discovery_run_id": exec_run.discovery_run_id,
                "execution_name": exec_run.execution_name,
                "description": exec_run.description,
                "environment": exec_run.environment,
                "started_at": exec_run.started_at.isoformat() if exec_run.started_at else None,
                "completed_at": exec_run.completed_at.isoformat() if exec_run.completed_at else None,
                "total_tests": exec_run.total_tests,
                "passed": exec_run.passed,
                "failed": exec_run.failed,
                "skipped": exec_run.skipped,
                "duration_seconds": exec_run.duration_seconds,
                "status": exec_run.status
            })
        
        return {"executions": executions_list}
        
    except Exception as e:
        logger.error(f"Failed to list test executions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list test executions: {str(e)}")


@router.delete("/executions/{execution_id}", summary="Delete a test execution run")
async def delete_test_execution(execution_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a test execution run and all its results."""
    try:
        from app.models.database import TestExecutionRun, TestExecutionResult
        from sqlalchemy import select, delete
        
        # Get execution run
        result = await db.execute(
            select(TestExecutionRun).where(TestExecutionRun.execution_id == execution_id)
        )
        exec_run = result.scalar_one_or_none()
        
        if not exec_run:
            raise HTTPException(status_code=404, detail=f"Execution {execution_id} not found")
        
        # Delete test results first (foreign key constraint)
        await db.execute(
            delete(TestExecutionResult).where(TestExecutionResult.execution_id == execution_id)
        )
        
        # Delete execution run
        await db.execute(
            delete(TestExecutionRun).where(TestExecutionRun.execution_id == execution_id)
        )
        
        await db.commit()
        
        # Optionally delete artifacts directory
        try:
            if exec_run.artifacts_path:
                artifacts_path = Path(exec_run.artifacts_path)
                if artifacts_path.exists():
                    import shutil
                    shutil.rmtree(artifacts_path)
                    logger.info(f"Deleted artifacts directory: {artifacts_path}")
        except Exception as e:
            logger.warning(f"Failed to delete artifacts directory: {e}")
        
        return {"message": f"Execution {execution_id} deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to delete test execution: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete test execution: {str(e)}")


@router.get("/executions/{execution_id}/status", summary="Get test execution status")
async def get_execution_status(execution_id: str, db: AsyncSession = Depends(get_db)):
    """Get current status of a test execution (for progress tracking)."""
    try:
        from app.models.database import TestExecutionRun
        from sqlalchemy import select
        
        result = await db.execute(
            select(TestExecutionRun).where(TestExecutionRun.execution_id == execution_id)
        )
        exec_run = result.scalar_one_or_none()
        
        if not exec_run:
            raise HTTPException(status_code=404, detail=f"Execution {execution_id} not found")
        
        # Get the discovery run context to access artifacts path
        discovery_run_id = exec_run.discovery_run_id
        context = _run_store.get_run(discovery_run_id)
        if not context:
            # Fallback: try to get from execution artifacts path
            artifacts_path = exec_run.artifacts_path
        else:
            artifacts_path = context.artifacts_path
        
        # Load recent events for step-by-step progress
        events_file = Path(artifacts_path) / "executions" / execution_id / "events.jsonl"
        recent_events = []
        current_step = None
        current_test = None
        
        if events_file.exists():
            try:
                with open(events_file, "r") as f:
                    lines = f.readlines()
                    # Get last 20 events
                    for line in lines[-20:]:
                        try:
                            event = json.loads(line.strip())
                            event_type = event.get("type", "")
                            if event_type in ["step_started", "step_completed", "test_started", "test_completed"]:
                                recent_events.append(event)
                                if event_type == "step_started":
                                    current_step = event.get("data", {})
                                elif event_type == "test_started":
                                    current_test = event.get("data", {})
                        except:
                            continue
            except Exception as e:
                logger.debug(f"Failed to read events: {e}")
        
        # Calculate detailed progress
        total_steps = 0
        completed_steps = 0
        failed_steps = 0
        
        # Try to get step counts from report.json if available
        report_file = Path(artifacts_path) / "executions" / execution_id / "report.json"
        if report_file.exists():
            try:
                with open(report_file, "r") as f:
                    report_data = json.load(f)
                    tests = report_data.get("tests", [])
                    for test in tests:
                        steps = test.get("steps", [])
                        total_steps += len(steps)
                        for step in steps:
                            if step.get("status") == "passed":
                                completed_steps += 1
                            elif step.get("status") == "failed":
                                failed_steps += 1
                                completed_steps += 1  # Count as completed even if failed
            except:
                pass
        
        return {
            "execution_id": execution_id,
            "status": exec_run.status,
            "started_at": exec_run.started_at.isoformat() if exec_run.started_at else None,
            "completed_at": exec_run.completed_at.isoformat() if exec_run.completed_at else None,
            "total_tests": exec_run.total_tests,
            "passed": exec_run.passed,
            "failed": exec_run.failed,
            "skipped": exec_run.skipped,
            "duration_seconds": exec_run.duration_seconds,
            "progress": (exec_run.passed + exec_run.failed + exec_run.skipped) / exec_run.total_tests * 100 if exec_run.total_tests > 0 else 0,
            "current_test": current_test,
            "current_step": current_step,
            "recent_events": recent_events[-10:],  # Last 10 events
            "steps_progress": {
                "total_steps": total_steps,
                "completed_steps": completed_steps,
                "failed_steps": failed_steps,
                "progress_percent": (completed_steps / total_steps * 100) if total_steps > 0 else 0
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get execution status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get execution status: {str(e)}")


@router.get("/executions/{execution_id}", summary="Get test execution details")
async def get_test_execution(execution_id: str, db: AsyncSession = Depends(get_db)):
    """Get detailed test execution results."""
    try:
        from app.models.database import TestExecutionRun, TestExecutionResult
        from sqlalchemy import select
        
        # Get execution run
        result = await db.execute(
            select(TestExecutionRun).where(TestExecutionRun.execution_id == execution_id)
        )
        exec_run = result.scalar_one_or_none()
        
        if not exec_run:
            raise HTTPException(status_code=404, detail=f"Execution {execution_id} not found")
        
        # Get test results
        results_query = await db.execute(
            select(TestExecutionResult).where(TestExecutionResult.execution_id == execution_id)
        )
        test_results = results_query.scalars().all()
        
        # Check for report.json and execution artifacts
        execution_details = {}
        if exec_run.artifacts_path:
            artifacts_dir = Path(exec_run.artifacts_path)
            report_json = artifacts_dir / "report.json"
            if report_json.exists():
                try:
                    with open(report_json, "r") as f:
                        execution_details["report_json"] = json.load(f)
                except Exception as e:
                    logger.warning(f"[{execution_id}] Failed to load report.json: {e}")
        
        # Check for Allure report - try multiple possible locations
        allure_report_url = None
        if exec_run.artifacts_path:
            artifacts_dir = Path(exec_run.artifacts_path)
            # Try different possible report file names
            possible_reports = [
                artifacts_dir / "allure-report.html",
                artifacts_dir / "report.html",
                artifacts_dir / "allure_report.html"
            ]
            for report_path in possible_reports:
                if report_path.exists():
                    allure_report_url = f"/runs/executions/{execution_id}/allure-report"
                    logger.info(f"[{execution_id}] Found report at: {report_path}")
                    break
        
        return {
            "execution": {
                "execution_id": exec_run.execution_id,
                "discovery_run_id": exec_run.discovery_run_id,
                "execution_name": exec_run.execution_name,
                "description": exec_run.description,
                "environment": exec_run.environment,
                "started_at": exec_run.started_at.isoformat() if exec_run.started_at else None,
                "completed_at": exec_run.completed_at.isoformat() if exec_run.completed_at else None,
                "total_tests": exec_run.total_tests,
                "passed": exec_run.passed,
                "failed": exec_run.failed,
                "skipped": exec_run.skipped,
                "duration_seconds": exec_run.duration_seconds,
                "status": exec_run.status,
                "execution_results": exec_run.execution_results,
                "allure_report_url": allure_report_url,
                "execution_details": execution_details
            },
            "test_results": [
                {
                    "test_id": tr.test_id,
                    "test_name": tr.test_name,
                    "test_type": tr.test_type,
                    "status": tr.status,
                    "duration_ms": tr.duration_ms,
                    "executed_at": tr.executed_at.isoformat() if tr.executed_at else None,
                    "steps": tr.steps,
                    "error_message": tr.error_message,
                    "screenshot_path": tr.screenshot_path,
                    "evidence": tr.evidence
                }
                for tr in test_results
            ]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get test execution: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get test execution: {str(e)}")


@router.get("/executions/{execution_id}/allure-report", summary="Get Allure-style HTML report")
async def get_allure_report(execution_id: str, db: AsyncSession = Depends(get_db)):
    """Get Allure-style HTML report for test execution."""
    try:
        from app.models.database import TestExecutionRun
        from sqlalchemy import select
        from fastapi.responses import HTMLResponse
        
        result = await db.execute(
            select(TestExecutionRun).where(TestExecutionRun.execution_id == execution_id)
        )
        exec_run = result.scalar_one_or_none()
        
        if not exec_run:
            raise HTTPException(status_code=404, detail=f"Execution {execution_id} not found")
        
        if not exec_run.artifacts_path:
            raise HTTPException(status_code=404, detail="Artifacts path not found")
        
        artifacts_dir = Path(exec_run.artifacts_path)
        
        # Try multiple possible report file names
        possible_reports = [
            artifacts_dir / "allure-report.html",
            artifacts_dir / "report.html",
            artifacts_dir / "allure_report.html",
            artifacts_dir / "allure" / "index.html"
        ]
        
        report_path = None
        for report_file in possible_reports:
            if report_file.exists():
                report_path = report_file
                logger.info(f"[{execution_id}] Found report at: {report_path}")
                break
        
        if not report_path:
            # Try to generate report from report.json if it exists
            report_json = artifacts_dir / "report.json"
            if report_json.exists():
                try:
                    from app.services.report_generator import get_report_generator
                    report_generator = get_report_generator()
                    with open(report_json, "r") as f:
                        report_data = json.load(f)
                    
                    # Generate report on the fly
                    allure_report_path = report_generator.generate_allure_report(
                        execution_id=execution_id,
                        execution_name=exec_run.execution_name or "Test Execution",
                        execution_result={"report": report_data},
                        artifacts_path=str(artifacts_dir),
                        base_url="",  # Not available in execution result
                        environment=exec_run.environment or "staging"
                    )
                    report_path = Path(allure_report_path)
                    logger.info(f"[{execution_id}] Generated report on-the-fly: {report_path}")
                except Exception as gen_error:
                    logger.error(f"[{execution_id}] Failed to generate report on-the-fly: {gen_error}", exc_info=True)
            
            if not report_path or not report_path.exists():
                raise HTTPException(
                    status_code=404, 
                    detail=f"Allure report not found. Execution status: {exec_run.status}. Report may still be generating or execution may have failed."
                )
        
        with open(report_path, "r", encoding="utf-8") as f:
            html_content = f.read()
        
        return HTMLResponse(content=html_content)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get Allure report: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get Allure report: {str(e)}")


@router.get("/executions/{execution_id}/artifacts/{file_path:path}", summary="Get execution artifact file (screenshots, network logs, etc.)")
async def get_execution_artifact(execution_id: str, file_path: str, db: AsyncSession = Depends(get_db)):
    """Serve static files (screenshots, network logs) from execution artifacts."""
    try:
        from app.models.database import TestExecutionRun
        from sqlalchemy import select
        from fastapi.responses import FileResponse
        
        result = await db.execute(
            select(TestExecutionRun).where(TestExecutionRun.execution_id == execution_id)
        )
        exec_run = result.scalar_one_or_none()
        
        if not exec_run or not exec_run.artifacts_path:
            raise HTTPException(status_code=404, detail=f"Execution {execution_id} not found")
        
        artifacts_dir = Path(exec_run.artifacts_path)
        requested_file = artifacts_dir / file_path
        
        # Security: Ensure the file is within the artifacts directory
        try:
            requested_file.resolve().relative_to(artifacts_dir.resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied: File outside artifacts directory")
        
        if not requested_file.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
        
        # Determine content type
        content_type = "application/octet-stream"
        if file_path.endswith(('.png', '.jpg', '.jpeg')):
            content_type = "image/png" if file_path.endswith('.png') else "image/jpeg"
        elif file_path.endswith('.json'):
            content_type = "application/json"
        elif file_path.endswith('.html'):
            content_type = "text/html"
        
        return FileResponse(
            path=str(requested_file),
            media_type=content_type,
            filename=requested_file.name
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get artifact: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get artifact: {str(e)}")


@router.get("/stats", summary="Get database statistics")
async def get_database_stats(db: AsyncSession = Depends(get_db)):
    """Get overall statistics from the database."""
    from sqlalchemy import select, func
    from app.models.database import Run, Page, TestCase
    
    try:
        # Count runs
        runs_count = await db.scalar(select(func.count()).select_from(Run))
        
        # Count pages
        pages_count = await db.scalar(select(func.count()).select_from(Page))
        
        # Count test cases
        test_cases_count = await db.scalar(select(func.count()).select_from(TestCase))
        
        # Get recent runs
        result = await db.execute(
            select(Run).order_by(desc(Run.started_at)).limit(5)
        )
        recent_runs = result.scalars().all()
        
        return {
            "statistics": {
                "total_runs": runs_count or 0,
                "total_pages": pages_count or 0,
                "total_test_cases": test_cases_count or 0
            },
            "recent_runs": [
                {
                    "run_id": run.run_id,
                    "base_url": run.base_url,
                    "status": run.status,
                    "started_at": run.started_at.isoformat(),
                    "pages": run.pages_discovered
                }
                for run in recent_runs
            ]
        }
    
    except Exception as e:
        logger.error(f"Failed to get database stats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get statistics: {str(e)}")


# =============================================================================
# File Upload Endpoints
# =============================================================================

@router.post("/{run_id}/upload/documents", summary="Upload PRD/requirement documents")
async def upload_documents(
    run_id: str,
    files: list[UploadFile] = File(...)
):
    """Upload PRD, requirement documents, or specifications."""
    try:
        run_context = _run_store.get_run(run_id)
        if not run_context:
            raise HTTPException(status_code=404, detail="Run not found")

        artifacts_path = Path(run_context.artifacts_path)
        uploads_dir = artifacts_path / "uploads" / "documents"
        uploads_dir.mkdir(parents=True, exist_ok=True)

        uploaded_files = []
        for file in files:
            # Validate file type
            allowed_extensions = ['.pdf', '.docx', '.doc', '.txt', '.md']
            file_ext = Path(file.filename).suffix.lower()
            if file_ext not in allowed_extensions:
                logger.warning(f"[{run_id}] Skipping unsupported file type: {file.filename}")
                continue

            # Save file
            file_path = uploads_dir / file.filename
            content = await file.read()
            with open(file_path, "wb") as f:
                f.write(content)

            uploaded_files.append({
                "filename": file.filename,
                "size": len(content),
                "path": str(file_path.relative_to(artifacts_path))
            })

            logger.info(f"[{run_id}] Uploaded document: {file.filename} ({len(content)} bytes)")

        # Update run context
        if not run_context.uploaded_documents:
            run_context.uploaded_documents = []
        run_context.uploaded_documents.extend(uploaded_files)
        _run_store.save_run(run_id, run_context)

        return {
            "run_id": run_id,
            "uploaded_files": uploaded_files,
            "uploaded_count": len(uploaded_files),
            "message": f"Successfully uploaded {len(uploaded_files)} document(s)"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{run_id}] Failed to upload documents: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to upload documents: {str(e)}")


@router.post("/{run_id}/upload/images", summary="Upload mockups/screenshots")
async def upload_requirement_images(
    run_id: str,
    files: list[UploadFile] = File(...)
):
    """Upload mockups, screenshots, or UI design images."""
    try:
        run_context = _run_store.get_run(run_id)
        if not run_context:
            raise HTTPException(status_code=404, detail="Run not found")

        artifacts_path = Path(run_context.artifacts_path)
        uploads_dir = artifacts_path / "uploads" / "images"
        uploads_dir.mkdir(parents=True, exist_ok=True)

        uploaded_files = []
        for file in files:
            # Validate file type
            allowed_extensions = ['.png', '.jpg', '.jpeg']
            file_ext = Path(file.filename).suffix.lower()
            if file_ext not in allowed_extensions:
                logger.warning(f"[{run_id}] Skipping unsupported file type: {file.filename}")
                continue

            # Save file
            file_path = uploads_dir / file.filename
            content = await file.read()
            with open(file_path, "wb") as f:
                f.write(content)

            uploaded_files.append({
                "filename": file.filename,
                "size": len(content),
                "path": str(file_path.relative_to(artifacts_path))
            })

            logger.info(f"[{run_id}] Uploaded image: {file.filename} ({len(content)} bytes)")

        # Update run context
        if not run_context.uploaded_images:
            run_context.uploaded_images = []
        run_context.uploaded_images.extend(uploaded_files)
        _run_store.save_run(run_id, run_context)

        return {
            "run_id": run_id,
            "uploaded_files": uploaded_files,
            "uploaded_count": len(uploaded_files),
            "message": f"Successfully uploaded {len(uploaded_files)} image(s)"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{run_id}] Failed to upload images: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to upload images: {str(e)}")


class MetadataRequest(BaseModel):
    """Metadata for uploaded requirements."""
    design_links: Optional[list[str]] = Field(default=None, description="Figma/design links")
    expected_behavior: Optional[str] = Field(default=None, description="Expected behavior notes")


@router.post("/{run_id}/metadata", summary="Update run metadata")
async def update_metadata(
    run_id: str,
    metadata: MetadataRequest
):
    """Update run metadata with design links and expected behavior."""
    try:
        run_context = _run_store.get_run(run_id)
        if not run_context:
            raise HTTPException(status_code=404, detail="Run not found")

        artifacts_path = Path(run_context.artifacts_path)
        metadata_file = artifacts_path / "requirement_metadata.json"

        metadata_data = {
            "design_links": metadata.design_links or [],
            "expected_behavior": metadata.expected_behavior or "",
            "updated_at": datetime.utcnow().isoformat() + "Z"
        }

        with open(metadata_file, "w") as f:
            json.dump(metadata_data, f, indent=2)

        logger.info(f"[{run_id}] Updated requirement metadata")

        return {
            "run_id": run_id,
            "metadata": metadata_data,
            "message": "Metadata updated successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{run_id}] Failed to update metadata: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update metadata: {str(e)}")

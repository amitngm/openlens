"""
Auto-Generate Test Cases During Discovery.

This service automatically generates test cases as pages are discovered,
providing real-time visibility into what will be tested.
"""

import json
import logging
from typing import Dict, List, Any
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)


class TestCaseGenerator:
    """Generate test cases automatically from discovered pages."""

    def generate_test_cases_for_page(
        self,
        page_info: Dict[str, Any],
        run_id: str
    ) -> List[Dict[str, Any]]:
        """
        Generate test cases for a single discovered page.

        Args:
            page_info: Discovered page metadata
            run_id: Run identifier

        Returns:
            List of test cases for this page
        """
        test_cases = []
        page_url = page_info.get("url", "")
        page_name = page_info.get("page_signature", {}).get("page_name", page_url)

        # Determine page type and features
        has_tables = len(page_info.get("tables", [])) > 0
        has_forms = len(page_info.get("forms", [])) > 0
        has_search = self._detect_search(page_info)
        has_filters = self._detect_filters(page_info)
        has_pagination = self._detect_pagination(page_info)
        has_create_action = self._has_action(page_info, "create")
        has_edit_action = self._has_action(page_info, "edit")
        has_delete_action = self._has_action(page_info, "delete")

        # Generate test cases based on detected features

        # Navigation test case (always)
        test_cases.append({
            "id": f"TC_NAV_{self._sanitize_id(page_name)}",
            "name": f"Navigate to {page_name}",
            "description": f"Verify user can navigate to {page_name} page",
            "type": "navigation",
            "priority": "high",
            "status": "pending",
            "page_url": page_url,
            "page_name": page_name,
            "steps": [
                f"Navigate to {page_url}",
                "Verify page loads successfully",
                f"Verify page title contains '{page_name}'"
            ],
            "expected_result": "Page loads without errors"
        })

        # Table listing test cases
        if has_tables:
            test_cases.append({
                "id": f"TC_LIST_{self._sanitize_id(page_name)}",
                "name": f"View {page_name} Listing",
                "description": f"Verify {page_name} table displays data correctly",
                "type": "listing",
                "priority": "high",
                "status": "pending",
                "page_url": page_url,
                "page_name": page_name,
                "steps": [
                    f"Navigate to {page_name}",
                    "Verify table is visible",
                    "Verify table headers are displayed",
                    "Verify at least one row is visible (if data exists)"
                ],
                "expected_result": "Table displays with proper headers and data"
            })

        # Pagination test cases
        if has_pagination:
            test_cases.append({
                "id": f"TC_PAGE_{self._sanitize_id(page_name)}",
                "name": f"Test {page_name} Pagination",
                "description": f"Verify pagination works correctly on {page_name}",
                "type": "pagination",
                "priority": "medium",
                "status": "pending",
                "page_url": page_url,
                "page_name": page_name,
                "steps": [
                    f"Navigate to {page_name}",
                    "Click 'Next' button",
                    "Verify page 2 loads",
                    "Verify different data is shown",
                    "Click 'Previous' button",
                    "Verify page 1 is restored"
                ],
                "expected_result": "Pagination navigates between pages correctly"
            })

        # Search test cases
        if has_search:
            test_cases.append({
                "id": f"TC_SEARCH_{self._sanitize_id(page_name)}",
                "name": f"Search in {page_name}",
                "description": f"Verify search functionality on {page_name}",
                "type": "search",
                "priority": "high",
                "status": "pending",
                "page_url": page_url,
                "page_name": page_name,
                "steps": [
                    f"Navigate to {page_name}",
                    "Enter search term in search box",
                    "Verify results are filtered",
                    "Clear search",
                    "Verify all results return"
                ],
                "expected_result": "Search filters results correctly"
            })

        # Filter test cases
        if has_filters:
            test_cases.append({
                "id": f"TC_FILTER_{self._sanitize_id(page_name)}",
                "name": f"Apply Filters on {page_name}",
                "description": f"Verify filter controls work on {page_name}",
                "type": "filters",
                "priority": "medium",
                "status": "pending",
                "page_url": page_url,
                "page_name": page_name,
                "steps": [
                    f"Navigate to {page_name}",
                    "Select a filter option",
                    "Verify results are filtered",
                    "Reset filters",
                    "Verify all results return"
                ],
                "expected_result": "Filters apply and reset correctly"
            })

        # Sort test cases
        if has_tables:
            test_cases.append({
                "id": f"TC_SORT_{self._sanitize_id(page_name)}",
                "name": f"Sort {page_name} Table",
                "description": f"Verify table sorting works on {page_name}",
                "type": "sort",
                "priority": "low",
                "status": "pending",
                "page_url": page_url,
                "page_name": page_name,
                "steps": [
                    f"Navigate to {page_name}",
                    "Click on a sortable column header",
                    "Verify data is sorted ascending",
                    "Click again",
                    "Verify data is sorted descending"
                ],
                "expected_result": "Table sorts data correctly"
            })

        # Create action test cases
        if has_create_action:
            test_cases.append({
                "id": f"TC_CREATE_{self._sanitize_id(page_name)}",
                "name": f"Create New Item in {page_name}",
                "description": f"Verify create functionality on {page_name}",
                "type": "crud_create",
                "priority": "high",
                "status": "pending",
                "page_url": page_url,
                "page_name": page_name,
                "steps": [
                    f"Navigate to {page_name}",
                    "Click Create button",
                    "Verify create form opens",
                    "Fill in required fields",
                    "Submit form",
                    "Verify success message",
                    "Verify new item appears in listing"
                ],
                "expected_result": "New item is created successfully"
            })

        # Edit action test cases
        if has_edit_action:
            test_cases.append({
                "id": f"TC_EDIT_{self._sanitize_id(page_name)}",
                "name": f"Edit Item in {page_name}",
                "description": f"Verify edit functionality on {page_name}",
                "type": "crud_update",
                "priority": "high",
                "status": "pending",
                "page_url": page_url,
                "page_name": page_name,
                "steps": [
                    f"Navigate to {page_name}",
                    "Click Edit on an existing item",
                    "Verify edit form opens",
                    "Modify a field",
                    "Submit form",
                    "Verify success message",
                    "Verify changes are reflected"
                ],
                "expected_result": "Item is updated successfully"
            })

        # Delete action test cases
        if has_delete_action:
            test_cases.append({
                "id": f"TC_DELETE_{self._sanitize_id(page_name)}",
                "name": f"Delete Item from {page_name}",
                "description": f"Verify delete functionality on {page_name}",
                "type": "crud_delete",
                "priority": "medium",
                "status": "pending",
                "page_url": page_url,
                "page_name": page_name,
                "steps": [
                    f"Navigate to {page_name}",
                    "Click Delete on an item",
                    "Verify confirmation dialog appears",
                    "Confirm deletion",
                    "Verify success message",
                    "Verify item is removed from listing"
                ],
                "expected_result": "Item is deleted successfully"
            })

        # Form validation test cases
        if has_forms:
            test_cases.append({
                "id": f"TC_FORM_VAL_{self._sanitize_id(page_name)}",
                "name": f"Validate Form on {page_name}",
                "description": f"Verify form validation works on {page_name}",
                "type": "form_validation",
                "priority": "medium",
                "status": "pending",
                "page_url": page_url,
                "page_name": page_name,
                "steps": [
                    f"Navigate to {page_name}",
                    "Submit form without filling required fields",
                    "Verify validation error messages appear",
                    "Fill in fields with invalid data",
                    "Verify specific field validation errors",
                    "Fill in all fields correctly",
                    "Verify form submits successfully"
                ],
                "expected_result": "Form validation prevents invalid submissions"
            })

        return test_cases

    def group_test_cases_by_scenario(
        self,
        all_test_cases: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Group test cases into scenarios/features.

        Args:
            all_test_cases: List of all test cases

        Returns:
            List of scenarios with grouped test cases
        """
        scenarios = {}

        for tc in all_test_cases:
            page_name = tc.get("page_name", "Unknown")
            test_type = tc.get("type", "general")

            # Determine scenario name
            if test_type in ["crud_create", "crud_update", "crud_delete"]:
                scenario_name = f"{page_name} - CRUD Operations"
            elif test_type in ["listing", "pagination", "search", "filters", "sort"]:
                scenario_name = f"{page_name} - Data Operations"
            elif test_type == "navigation":
                scenario_name = f"{page_name} - Navigation"
            elif test_type == "form_validation":
                scenario_name = f"{page_name} - Form Validation"
            else:
                scenario_name = f"{page_name} - General Tests"

            if scenario_name not in scenarios:
                scenarios[scenario_name] = {
                    "scenario_name": scenario_name,
                    "page_name": page_name,
                    "page_url": tc.get("page_url", ""),
                    "test_cases": [],
                    "total": 0,
                    "pending": 0,
                    "passed": 0,
                    "failed": 0
                }

            scenarios[scenario_name]["test_cases"].append(tc)
            scenarios[scenario_name]["total"] += 1

            status = tc.get("status", "pending")
            if status == "pending":
                scenarios[scenario_name]["pending"] += 1
            elif status == "passed":
                scenarios[scenario_name]["passed"] += 1
            elif status == "failed":
                scenarios[scenario_name]["failed"] += 1

        return list(scenarios.values())

    def save_test_cases(
        self,
        run_id: str,
        artifacts_path: str,
        test_cases: List[Dict[str, Any]]
    ):
        """Save test cases to file."""
        test_cases_file = Path(artifacts_path) / "test_cases.json"

        scenarios = self.group_test_cases_by_scenario(test_cases)

        data = {
            "run_id": run_id,
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "total_test_cases": len(test_cases),
            "scenarios": scenarios,
            "all_test_cases": test_cases
        }

        with open(test_cases_file, "w") as f:
            json.dump(data, f, indent=2)

        logger.info(f"[{run_id}] Saved {len(test_cases)} test cases to {test_cases_file}")

    def emit_test_case_event(
        self,
        run_id: str,
        artifacts_path: str,
        test_case: Dict[str, Any]
    ):
        """Emit event for newly generated test case."""
        events_file = Path(artifacts_path) / "events.jsonl"

        event = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "type": "test_case_generated",
            "data": {
                "test_case_id": test_case.get("id"),
                "test_case_name": test_case.get("name"),
                "test_type": test_case.get("type"),
                "priority": test_case.get("priority"),
                "page_name": test_case.get("page_name"),
                "page_url": test_case.get("page_url")
            }
        }

        with open(events_file, "a") as f:
            f.write(json.dumps(event) + "\n")

    # Helper methods

    def _detect_search(self, page_info: Dict) -> bool:
        """Detect if page has search functionality."""
        # Check for search-related text in actions or forms
        actions = page_info.get("primary_actions", [])
        for action in actions:
            if "search" in action.get("text", "").lower():
                return True
        return False

    def _detect_filters(self, page_info: Dict) -> bool:
        """Detect if page has filter controls."""
        actions = page_info.get("primary_actions", [])
        for action in actions:
            if "filter" in action.get("text", "").lower():
                return True
        return False

    def _detect_pagination(self, page_info: Dict) -> bool:
        """Detect if page has pagination."""
        # Assume tables with data might have pagination
        tables = page_info.get("tables", [])
        return len(tables) > 0

    def _has_action(self, page_info: Dict, action_tag: str) -> bool:
        """Check if page has specific action."""
        actions = page_info.get("primary_actions", [])
        for action in actions:
            if action.get("tag", "").lower() == action_tag.lower():
                return True
        return False

    def _sanitize_id(self, name: str) -> str:
        """Sanitize name for use in test case ID."""
        return name.replace(" ", "_").replace("/", "_").replace("(", "").replace(")", "")[:50]

    def _get_timestamp(self) -> str:
        """Get current UTC timestamp."""
        return datetime.utcnow().isoformat() + "Z"


# Singleton instance
_test_case_generator = None


def get_test_case_generator() -> TestCaseGenerator:
    """Get the test case generator singleton instance."""
    global _test_case_generator
    if _test_case_generator is None:
        _test_case_generator = TestCaseGenerator()
    return _test_case_generator

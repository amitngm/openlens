"""Enhanced Test Case Generator - Schema-driven comprehensive test generation."""

from typing import Dict, List, Optional, Any
import logging
import re
from pathlib import Path

from app.services.validation_schema import (
    ValidationRule,
    FeatureValidationSchema,
    ValidationSchemaRegistry
)
from app.models.test_case_models import (
    TestCase,
    TestStep,
    create_navigation_step,
    create_fill_step,
    create_click_step,
    create_assertion_step,
    create_wait_step
)

logger = logging.getLogger(__name__)


class SmartSelectorDetector:
    """Detects actual selectors on page for validation rules."""

    def find_best_selector(
        self,
        page_info: Dict[str, Any],
        strategy: str,
        selector_hint: str,
        feature_type: str
    ) -> Optional[str]:
        """Find best matching selector on page based on hint and feature type."""

        # Strategy 1: Use selector hint directly if it looks valid
        if selector_hint and self._is_valid_selector(selector_hint):
            logger.debug(f"Using selector hint directly: {selector_hint}")
            return selector_hint

        # Strategy 2: Search in discovered elements based on feature type
        discovered_selector = self._find_in_discovered_elements(
            page_info, feature_type, selector_hint
        )
        if discovered_selector:
            logger.debug(f"Found selector in discovered elements: {discovered_selector}")
            return discovered_selector

        # Strategy 3: Fall back to generic selectors
        fallback = self._get_fallback_selector(feature_type)
        if fallback:
            logger.debug(f"Using fallback selector: {fallback}")
            return fallback

        logger.warning(f"Could not find selector for feature: {feature_type}, hint: {selector_hint}")
        return selector_hint  # Return hint as last resort

    def _is_valid_selector(self, selector: str) -> bool:
        """Check if selector looks valid."""
        if not selector or selector.strip() == "":
            return False
        # Basic validation - has CSS selector patterns
        return bool(re.search(r'[.\[#]|^[a-z]+', selector))

    def _find_in_discovered_elements(
        self,
        page_info: Dict[str, Any],
        feature_type: str,
        selector_hint: str
    ) -> Optional[str]:
        """Search in page_info for elements matching feature type."""

        page_sig = page_info.get("page_signature", {})

        if feature_type == "search":
            # Check primary actions for search
            for action in page_sig.get("primary_actions", []):
                action_text = action.get("text", "").lower()
                if "search" in action_text or "find" in action_text:
                    return "input[type='search']"

            # Check for search-related forms
            for form in page_sig.get("forms", []):
                for field in form.get("fields", []):
                    if "search" in field.get("name", "").lower():
                        return f"input[name='{field.get('name')}']"

            return "input[type='search'], input[placeholder*='search' i]"

        elif feature_type == "pagination":
            # Look for pagination controls
            for action in page_sig.get("primary_actions", []):
                action_text = action.get("text", "").lower()
                if action_text in ["next", "previous", "prev"]:
                    return f"button:has-text('{action.get('text')}')"

            return ".pagination, [role='navigation']"

        elif feature_type == "filter":
            # Check for filter selects or comboboxes
            for form in page_sig.get("forms", []):
                for field in form.get("fields", []):
                    field_name = field.get("name", "").lower()
                    if "filter" in field_name or "status" in field_name or "type" in field_name:
                        return f"select[name='{field.get('name')}']"

            return "select[name*='filter'], select[name*='status']"

        elif feature_type == "listing":
            # Look for tables or list views
            if page_sig.get("has_tables", False):
                return "table, [role='table']"

            return "table, .table, .list-view, [role='table']"

        return None

    def _get_fallback_selector(self, feature_type: str) -> Optional[str]:
        """Get generic fallback selector for feature type."""
        fallback_map = {
            "search": "input[type='search'], input[placeholder*='search' i]",
            "pagination": ".pagination, [role='navigation']",
            "filter": "select[name*='filter'], .filter-controls",
            "listing": "table, [role='table'], .list-view"
        }
        return fallback_map.get(feature_type)


class TestDataGenerator:
    """Generates appropriate test data for validation rules."""

    def generate_for_rule(self, rule: ValidationRule) -> Dict[str, Any]:
        """Generate test data based on validation rule."""

        # Use provided test data if available
        if rule.test_data:
            return rule.test_data

        # Generate based on assertion type
        data_map = {
            "count_decreased": {"query": "test"},
            "count_restored": {"query": "test"},
            "text_contains": {"query": "nonexistent"},
            "no_error": {"query": "@#$%"},
            "visible": {},
            "disabled": {},
        }

        return data_map.get(rule.assertion_type, {})


class EnhancedTestCaseGenerator:
    """Generate comprehensive, executable test cases using validation schemas."""

    def __init__(self):
        self.schema_registry = ValidationSchemaRegistry()
        self.selector_detector = SmartSelectorDetector()
        self.data_generator = TestDataGenerator()
        logger.info("EnhancedTestCaseGenerator initialized with validation schemas")

    def generate_test_cases_for_page(
        self,
        page_info: Dict[str, Any],
        run_id: str,
        coverage_mode: str = "comprehensive"  # "comprehensive", "essential", "minimal"
    ) -> List[TestCase]:
        """Generate comprehensive test cases with full coverage for a page.

        Args:
            page_info: Page information from discovery
            run_id: Discovery run ID
            coverage_mode: Coverage level - comprehensive (all), essential (critical+high), minimal (critical only)

        Returns:
            List of executable test cases
        """
        logger.info(f"[{run_id}] Generating test cases for page: {page_info.get('url', 'unknown')}")

        test_cases = []
        detected_features = self._detect_all_features(page_info)

        logger.info(f"[{run_id}] Detected features: {list(detected_features.keys())}")

        for feature_type, feature_info in detected_features.items():
            # Get validation schema for this feature
            schema = self.schema_registry.get_schema(feature_type)
            if not schema:
                logger.warning(f"No schema found for feature: {feature_type}")
                continue

            logger.info(f"[{run_id}] Generating tests for {feature_type} using {len(schema.validation_rules)} rules")

            # Generate test case for each validation rule
            for rule in schema.validation_rules:
                # Skip based on coverage mode
                if not self._should_generate_for_coverage_mode(rule, coverage_mode):
                    logger.debug(f"Skipping rule {rule.id} due to coverage mode: {coverage_mode}")
                    continue

                test_case = self._generate_test_case_from_rule(
                    rule=rule,
                    feature_info=feature_info,
                    page_info=page_info,
                    schema=schema,
                    run_id=run_id
                )

                if test_case:
                    test_cases.append(test_case)
                    logger.debug(f"Generated test case: {test_case.id}")

        logger.info(
            f"[{run_id}] Generated {len(test_cases)} test cases for page {page_info.get('url', '')}"
        )

        return test_cases

    def _detect_all_features(self, page_info: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        """Detect all features present on the page."""
        detected = {}

        page_sig = page_info.get("page_signature", {})

        # Detect search
        if self._has_search(page_sig, page_info):
            detected["search"] = {"detected": True, "confidence": "high"}

        # Detect pagination
        if self._has_pagination(page_sig, page_info):
            detected["pagination"] = {"detected": True, "confidence": "high"}

        # Detect filters
        if self._has_filters(page_sig, page_info):
            detected["filter"] = {"detected": True, "confidence": "high"}

        # Detect listing/table
        if self._has_listing(page_sig, page_info):
            detected["listing"] = {"detected": True, "confidence": "high"}

        return detected

    def _has_search(self, page_sig: Dict, page_info: Dict) -> bool:
        """Check if page has search functionality."""
        # Check primary actions
        for action in page_sig.get("primary_actions", []):
            if "search" in action.get("text", "").lower():
                return True

        # Check forms for search fields
        for form in page_sig.get("forms", []):
            for field in form.get("fields", []):
                if "search" in field.get("name", "").lower():
                    return True

        # Assume pages with tables have search (common pattern)
        if page_info.get("tables") and len(page_info.get("tables", [])) > 0:
            return True

        return False

    def _has_pagination(self, page_sig: Dict, page_info: Dict) -> bool:
        """Check if page has pagination."""
        # Check primary actions for next/previous
        for action in page_sig.get("primary_actions", []):
            action_text = action.get("text", "").lower()
            if action_text in ["next", "previous", "prev", ">", "«", "»"]:
                return True

        # Assume pages with large tables (>10 rows) have pagination
        tables = page_info.get("tables", [])
        if tables:
            for table in tables:
                if table.get("row_count", 0) >= 10:
                    return True

        return False

    def _has_filters(self, page_sig: Dict, page_info: Dict) -> bool:
        """Check if page has filters."""
        # Check for filter-related forms
        for form in page_sig.get("forms", []):
            for field in form.get("fields", []):
                field_name = field.get("name", "").lower()
                if "filter" in field_name or "status" in field_name or "type" in field_name:
                    return True

        # Assume pages with tables have filters (common pattern)
        if page_info.get("tables") and len(page_info.get("tables", [])) > 0:
            return True

        return False

    def _has_listing(self, page_sig: Dict, page_info: Dict) -> bool:
        """Check if page has listing/table."""
        # Check page_signature first
        has_tables_sig = page_sig.get("has_tables")
        if has_tables_sig is True:
            return True

        # Fall back to checking actual tables in page_info
        tables = page_info.get("tables", [])
        if tables and len(tables) > 0:
            return True

        return False

    def _should_generate_for_coverage_mode(
        self,
        rule: ValidationRule,
        coverage_mode: str
    ) -> bool:
        """Determine if rule should be generated based on coverage mode."""
        if coverage_mode == "comprehensive":
            return True
        elif coverage_mode == "essential":
            return rule.severity in ["critical", "high"]
        elif coverage_mode == "minimal":
            return rule.severity == "critical"
        return True

    def _generate_test_case_from_rule(
        self,
        rule: ValidationRule,
        feature_info: Dict,
        page_info: Dict,
        schema: FeatureValidationSchema,
        run_id: str
    ) -> Optional[TestCase]:
        """Generate specific test case from validation rule."""

        # Detect actual selector on the page
        actual_selector = self.selector_detector.find_best_selector(
            page_info=page_info,
            strategy=rule.selector_strategy,
            selector_hint=rule.selector,
            feature_type=schema.feature_type
        )

        if not actual_selector and rule.severity == "critical":
            logger.warning(f"Could not find selector for critical rule: {rule.id}")
            # Still generate the test case with the hint selector
            actual_selector = rule.selector

        # Generate executable test steps
        steps = self._generate_test_steps(rule, actual_selector, page_info)

        if not steps:
            logger.warning(f"Could not generate steps for rule: {rule.id}")
            return None

        # Generate specific test data
        test_data = self.data_generator.generate_for_rule(rule)

        # Create rich test case
        page_name = page_info.get("page_signature", {}).get("page_name", "Unknown")
        page_url = page_info.get("url", "")

        test_case = TestCase(
            id=f"TC_{schema.feature_type.upper()}_{rule.id}_{self._sanitize_id(page_name)}",
            name=f"{rule.name} on {page_name}",
            description=f"{rule.expected_behavior}. Category: {rule.category}",
            feature_type=schema.feature_type,
            test_category=rule.category,
            severity=rule.severity,
            priority=self._map_severity_to_priority(rule.severity),
            steps=steps,
            preconditions=rule.preconditions,
            postconditions=rule.postconditions,
            test_data=test_data,
            validation_rule_id=rule.id,
            expected_result=rule.expected_behavior,
            assertion_type=rule.assertion_type,
            assertion_value=rule.assertion_value,
            page_url=page_url,
            page_name=page_name,
            tags=rule.tags + [schema.feature_type, rule.category, rule.severity],
            covers_requirements=[rule.id]
        )

        return test_case

    def _generate_test_steps(
        self,
        rule: ValidationRule,
        selector: str,
        page_info: Dict
    ) -> List[TestStep]:
        """Generate executable test steps for validation rule."""

        steps = []
        step_num = 1
        page_url = page_info.get("url", "")

        # Step 1: Navigate to page
        steps.append(create_navigation_step(step_num, page_url))
        step_num += 1

        # Generate steps based on assertion type and feature
        if rule.assertion_type == "visible":
            # Just check visibility
            steps.append(create_assertion_step(
                step_num,
                "visible",
                selector=selector,
                expected={"visible": True}
            ))
            step_num += 1

        elif rule.assertion_type == "count_decreased":
            # Count initial, perform action, verify count decreased
            steps.append(create_test_step(
                step_num,
                action="count_elements",
                selector="tbody tr, .list-item, [role='row']",
                description="Count initial results",
                data={"store_as": "initial_count"}
            ))
            step_num += 1

            # Perform the action (e.g., search or filter)
            test_data = rule.test_data or {}
            if "query" in test_data:
                steps.append(create_fill_step(
                    step_num,
                    selector=selector,
                    value=test_data["query"]
                ))
                step_num += 1

                steps.append(create_wait_step(step_num, 1500))
                step_num += 1

            # Assert count decreased
            steps.append(create_assertion_step(
                step_num,
                "count_less_than",
                selector="tbody tr, .list-item, [role='row']",
                expected={"compare_to": "initial_count"}
            ))
            step_num += 1

        elif rule.assertion_type == "count_restored":
            # Assumes search/filter already applied, verify clearing restores
            steps.append(create_test_step(
                step_num,
                action="count_elements",
                selector="tbody tr, .list-item, [role='row']",
                description="Count filtered results",
                data={"store_as": "filtered_count"}
            ))
            step_num += 1

            # Click clear button
            steps.append(create_click_step(step_num, selector))
            step_num += 1

            steps.append(create_wait_step(step_num, 1500))
            step_num += 1

            # Assert count increased (restored)
            steps.append(create_assertion_step(
                step_num,
                "count_greater_than",
                selector="tbody tr, .list-item, [role='row']",
                expected={"compare_to": "filtered_count"}
            ))
            step_num += 1

        elif rule.assertion_type == "text_contains":
            # Perform action then check for text
            test_data = rule.test_data or {}
            if "query" in test_data:
                steps.append(create_fill_step(
                    step_num,
                    selector=selector,
                    value=test_data["query"]
                ))
                step_num += 1

                steps.append(create_wait_step(step_num, 1500))
                step_num += 1

            # Assert text visible
            steps.append(create_assertion_step(
                step_num,
                "text_contains",
                selector=".empty-state, .no-results, tbody",
                expected={"text": rule.assertion_value}
            ))
            step_num += 1

        elif rule.assertion_type == "no_error":
            # Perform action and verify no errors
            test_data = rule.test_data or {}
            if "query" in test_data:
                steps.append(create_fill_step(
                    step_num,
                    selector=selector,
                    value=test_data["query"]
                ))
                step_num += 1

                steps.append(create_wait_step(step_num, 1500))
                step_num += 1

            # Assert no error messages
            steps.append(create_assertion_step(
                step_num,
                "not_visible",
                selector=".error, .error-message, [role='alert']",
                expected={"visible": False}
            ))
            step_num += 1

        elif rule.assertion_type == "disabled":
            # Check if element is disabled
            steps.append(create_assertion_step(
                step_num,
                "disabled",
                selector=selector,
                expected={"disabled": True}
            ))
            step_num += 1

        elif rule.assertion_type == "content_changed":
            # Store current content, perform action, verify changed
            steps.append(create_test_step(
                step_num,
                action="store_content",
                selector="tbody, .content",
                description="Store current content",
                data={"store_as": "previous_content"}
            ))
            step_num += 1

            steps.append(create_click_step(step_num, selector))
            step_num += 1

            steps.append(create_wait_step(step_num, 1500))
            step_num += 1

            steps.append(create_assertion_step(
                step_num,
                "content_different",
                selector="tbody, .content",
                expected={"compare_to": "previous_content"}
            ))
            step_num += 1

        else:
            # Generic: perform action and basic verification
            test_data = rule.test_data or {}
            if "query" in test_data:
                steps.append(create_fill_step(
                    step_num,
                    selector=selector,
                    value=test_data["query"]
                ))
                step_num += 1

            steps.append(create_wait_step(step_num, 1000))
            step_num += 1

        # Add postcondition steps if specified
        for postcondition in rule.postconditions:
            if postcondition == "clear_search":
                steps.append(create_test_step(
                    step_num,
                    action="clear",
                    selector=selector,
                    description="Clear search input"
                ))
                step_num += 1

        return steps

    def _sanitize_id(self, text: str) -> str:
        """Sanitize text for use in test case ID."""
        # Remove special characters, replace spaces with underscores
        sanitized = re.sub(r'[^a-zA-Z0-9_\s]', '', text)
        sanitized = re.sub(r'\s+', '_', sanitized)
        return sanitized[:50]  # Limit length

    def _map_severity_to_priority(self, severity: str) -> str:
        """Map severity to priority."""
        severity_map = {
            "critical": "critical",
            "high": "high",
            "medium": "medium",
            "low": "low"
        }
        return severity_map.get(severity, "medium")

    def get_generation_statistics(self, test_cases: List[TestCase]) -> Dict[str, Any]:
        """Get statistics about generated test cases."""
        stats = {
            "total_tests": len(test_cases),
            "by_feature": {},
            "by_category": {},
            "by_severity": {},
            "by_page": {}
        }

        for tc in test_cases:
            # By feature
            stats["by_feature"][tc.feature_type] = stats["by_feature"].get(tc.feature_type, 0) + 1

            # By category
            stats["by_category"][tc.test_category] = stats["by_category"].get(tc.test_category, 0) + 1

            # By severity
            stats["by_severity"][tc.severity] = stats["by_severity"].get(tc.severity, 0) + 1

            # By page
            stats["by_page"][tc.page_name] = stats["by_page"].get(tc.page_name, 0) + 1

        return stats


# =============================================================================
# HELPER FUNCTION FOR CREATING TEST STEP
# =============================================================================

def create_test_step(
    step_number: int,
    action: str,
    selector: Optional[str] = None,
    selector_strategy: str = "css",
    description: str = "",
    data: Optional[Dict[str, Any]] = None,
    expected: Optional[Dict[str, Any]] = None,
    timeout_ms: int = 5000
) -> TestStep:
    """Create a test step (wrapper for convenience)."""
    return TestStep(
        step_number=step_number,
        action=action,
        selector=selector,
        selector_strategy=selector_strategy,
        data=data or {},
        expected=expected,
        timeout_ms=timeout_ms,
        description=description
    )


__all__ = [
    "EnhancedTestCaseGenerator",
    "SmartSelectorDetector",
    "TestDataGenerator"
]

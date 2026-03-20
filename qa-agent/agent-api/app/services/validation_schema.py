"""Validation Schema Framework - Comprehensive validation rules for test case generation."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
import logging

logger = logging.getLogger(__name__)


@dataclass
class ValidationRule:
    """Single validation rule for a specific test scenario."""
    id: str
    name: str
    category: str  # "positive", "negative", "edge", "boundary"
    severity: str  # "critical", "high", "medium", "low"
    selector_strategy: str  # "css", "xpath", "text", "aria"
    selector: str
    test_data: Optional[Dict[str, Any]]
    expected_behavior: str
    assertion_type: str  # "visible", "count_decreased", "text_contains", "no_error", etc.
    assertion_value: Any
    preconditions: List[str] = field(default_factory=list)
    postconditions: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)


@dataclass
class FeatureValidationSchema:
    """Complete validation schema for a feature type."""
    feature_type: str
    display_name: str
    description: str
    detection_strategy: Dict[str, Any]
    validation_rules: List[ValidationRule]
    coverage_requirements: Dict[str, int]  # Minimum validations needed


class ValidationSchemaRegistry:
    """Central registry of all validation schemas."""

    def __init__(self):
        self._schemas: Dict[str, FeatureValidationSchema] = {}
        self._load_default_schemas()

    def _load_default_schemas(self):
        """Load all default validation schemas."""
        self.register_schema(SEARCH_VALIDATION_SCHEMA)
        self.register_schema(PAGINATION_VALIDATION_SCHEMA)
        self.register_schema(FILTER_VALIDATION_SCHEMA)
        self.register_schema(LISTING_VALIDATION_SCHEMA)
        self.register_schema(FORM_VALIDATION_SCHEMA)
        self.register_schema(MODAL_VALIDATION_SCHEMA)
        self.register_schema(NAVIGATION_VALIDATION_SCHEMA)
        self.register_schema(TABS_VALIDATION_SCHEMA)
        self.register_schema(BUTTON_ACTIONS_SCHEMA)
        logger.info(f"Loaded {len(self._schemas)} default validation schemas")

    def register_schema(self, schema: FeatureValidationSchema):
        """Register a validation schema."""
        self._schemas[schema.feature_type] = schema
        logger.info(f"Registered schema: {schema.feature_type} with {len(schema.validation_rules)} rules")

    def get_schema(self, feature_type: str) -> Optional[FeatureValidationSchema]:
        """Get validation schema by feature type."""
        return self._schemas.get(feature_type)

    def get_all_schemas(self) -> Dict[str, FeatureValidationSchema]:
        """Get all registered schemas."""
        return self._schemas.copy()

    def get_all_validation_rules(self) -> List[ValidationRule]:
        """Get all validation rules from all schemas."""
        all_rules = []
        for schema in self._schemas.values():
            all_rules.extend(schema.validation_rules)
        return all_rules


# =============================================================================
# SEARCH VALIDATION SCHEMA - Comprehensive search testing
# =============================================================================

SEARCH_VALIDATION_SCHEMA = FeatureValidationSchema(
    feature_type="search",
    display_name="Search Functionality",
    description="Comprehensive search validation covering positive, negative, edge, and boundary cases",
    detection_strategy={
        "selectors": ["input[type='search']", "input[placeholder*='search' i]", "[role='searchbox']"],
        "keywords": ["search", "find", "filter"]
    },
    validation_rules=[
        # POSITIVE TESTS - Expected successful behavior
        ValidationRule(
            id="search_input_visible",
            name="Search input is visible and accessible",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="input[type='search'], input[placeholder*='search' i], [role='searchbox']",
            test_data=None,
            expected_behavior="Search input field is visible and can receive focus",
            assertion_type="visible",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["search", "ui", "accessibility"]
        ),
        ValidationRule(
            id="search_filters_results",
            name="Search filters results correctly",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="input[type='search'], input[placeholder*='search' i]",
            test_data={"query": "test"},
            expected_behavior="Search reduces visible results and shows only matching items",
            assertion_type="count_decreased",
            assertion_value=None,
            preconditions=["navigate_to_page", "count_initial_results"],
            postconditions=["clear_search"],
            tags=["search", "filtering", "core-functionality"]
        ),
        ValidationRule(
            id="search_clear_button_works",
            name="Clear search button resets results",
            category="positive",
            severity="high",
            selector_strategy="css",
            selector="button[aria-label*='clear' i], .clear-search, button.clear",
            test_data={"query": "test"},
            expected_behavior="Clear button removes search text and restores all results",
            assertion_type="count_restored",
            assertion_value=None,
            preconditions=["navigate_to_page", "perform_search"],
            postconditions=[],
            tags=["search", "clear", "ux"]
        ),

        # NEGATIVE TESTS - Error handling and edge cases
        ValidationRule(
            id="search_no_results_message",
            name="No results message displayed for non-matching search",
            category="negative",
            severity="high",
            selector_strategy="css",
            selector="input[type='search'], input[placeholder*='search' i]",
            test_data={"query": "xyznonexistentquery12345"},
            expected_behavior="Shows appropriate 'No results found' or empty state message",
            assertion_type="text_contains",
            assertion_value="no results",
            preconditions=["navigate_to_page"],
            postconditions=["clear_search"],
            tags=["search", "empty-state", "ux"]
        ),

        # EDGE CASES - Unusual but valid inputs
        ValidationRule(
            id="search_empty_query",
            name="Empty search query shows all results",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector="input[type='search'], input[placeholder*='search' i]",
            test_data={"query": ""},
            expected_behavior="Empty search shows all results without errors",
            assertion_type="count_equals_initial",
            assertion_value=None,
            preconditions=["navigate_to_page", "count_initial_results"],
            postconditions=[],
            tags=["search", "edge-case"]
        ),
        ValidationRule(
            id="search_special_characters",
            name="Search handles special characters gracefully",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector="input[type='search'], input[placeholder*='search' i]",
            test_data={"query": "@#$%^&*()"},
            expected_behavior="Special characters don't cause errors or break UI",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=["clear_search"],
            tags=["search", "edge-case", "security"]
        ),
        ValidationRule(
            id="search_unicode_emoji",
            name="Search handles unicode and emoji",
            category="edge",
            severity="low",
            selector_strategy="css",
            selector="input[type='search'], input[placeholder*='search' i]",
            test_data={"query": "🔍 test 中文"},
            expected_behavior="Unicode characters and emoji handled without errors",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=["clear_search"],
            tags=["search", "edge-case", "i18n"]
        ),
        ValidationRule(
            id="search_whitespace_only",
            name="Search with whitespace-only input",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector="input[type='search'], input[placeholder*='search' i]",
            test_data={"query": "     "},
            expected_behavior="Whitespace-only search treated as empty or trimmed",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=["clear_search"],
            tags=["search", "edge-case", "validation"]
        ),

        # BOUNDARY TESTS - Limits and extremes
        ValidationRule(
            id="search_max_length",
            name="Search with very long query string",
            category="boundary",
            severity="medium",
            selector_strategy="css",
            selector="input[type='search'], input[placeholder*='search' i]",
            test_data={"query": "a" * 1000},
            expected_behavior="Long search query handled without performance degradation or errors",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=["clear_search"],
            tags=["search", "boundary", "performance"]
        ),
        ValidationRule(
            id="search_case_sensitivity",
            name="Search case sensitivity behavior",
            category="boundary",
            severity="low",
            selector_strategy="css",
            selector="input[type='search'], input[placeholder*='search' i]",
            test_data={"queries": ["TEST", "test", "TeSt"]},
            expected_behavior="Search behavior consistent across case variations",
            assertion_type="results_consistent",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=["clear_search"],
            tags=["search", "boundary", "behavior"]
        )
    ],
    coverage_requirements={
        "min_positive_tests": 2,
        "min_negative_tests": 1,
        "min_edge_tests": 2,
        "min_boundary_tests": 1
    }
)


# =============================================================================
# PAGINATION VALIDATION SCHEMA - Comprehensive pagination testing
# =============================================================================

PAGINATION_VALIDATION_SCHEMA = FeatureValidationSchema(
    feature_type="pagination",
    display_name="Pagination Controls",
    description="Comprehensive pagination validation covering navigation, boundaries, and interactions",
    detection_strategy={
        "selectors": [".pagination", "[role='navigation']", "button:has-text('Next')", "button:has-text('Previous')"],
        "keywords": ["pagination", "next", "previous", "page"]
    },
    validation_rules=[
        # POSITIVE TESTS
        ValidationRule(
            id="pagination_controls_visible",
            name="Pagination controls are visible",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector=".pagination, [role='navigation'], nav",
            test_data=None,
            expected_behavior="Pagination controls visible when multiple pages exist",
            assertion_type="visible",
            assertion_value=True,
            preconditions=["navigate_to_page", "ensure_multiple_pages"],
            postconditions=[],
            tags=["pagination", "ui"]
        ),
        ValidationRule(
            id="pagination_next_button_works",
            name="Next button navigates to next page",
            category="positive",
            severity="critical",
            selector_strategy="text",
            selector="button:has-text('Next'), a:has-text('Next'), [aria-label*='next' i]",
            test_data=None,
            expected_behavior="Clicking Next shows different set of results",
            assertion_type="content_changed",
            assertion_value=None,
            preconditions=["navigate_to_page", "ensure_not_last_page"],
            postconditions=["navigate_to_first_page"],
            tags=["pagination", "navigation", "core-functionality"]
        ),
        ValidationRule(
            id="pagination_previous_button_works",
            name="Previous button navigates to previous page",
            category="positive",
            severity="critical",
            selector_strategy="text",
            selector="button:has-text('Previous'), a:has-text('Previous'), [aria-label*='previous' i]",
            test_data=None,
            expected_behavior="Clicking Previous shows previous set of results",
            assertion_type="content_changed",
            assertion_value=None,
            preconditions=["navigate_to_page", "navigate_to_page_2"],
            postconditions=["navigate_to_first_page"],
            tags=["pagination", "navigation", "core-functionality"]
        ),
        ValidationRule(
            id="pagination_page_numbers_clickable",
            name="Page number buttons are clickable",
            category="positive",
            severity="high",
            selector_strategy="css",
            selector=".pagination button[data-page], .pagination a[data-page], .page-number",
            test_data={"target_page": 2},
            expected_behavior="Clicking page number navigates to that page",
            assertion_type="page_changed",
            assertion_value=2,
            preconditions=["navigate_to_page"],
            postconditions=["navigate_to_first_page"],
            tags=["pagination", "navigation"]
        ),
        ValidationRule(
            id="pagination_items_per_page_selector",
            name="Items per page selector changes page size",
            category="positive",
            severity="high",
            selector_strategy="css",
            selector="select[name*='pageSize' i], select[name*='perPage' i], .page-size-selector",
            test_data={"page_sizes": [10, 25, 50, 100]},
            expected_behavior="Changing items per page updates result count",
            assertion_type="count_changed",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=["reset_page_size"],
            tags=["pagination", "page-size"]
        ),

        # NEGATIVE TESTS
        ValidationRule(
            id="pagination_hidden_on_single_page",
            name="Pagination hidden when only one page",
            category="negative",
            severity="medium",
            selector_strategy="css",
            selector=".pagination, [role='navigation']",
            test_data={"filter_to_single_page": True},
            expected_behavior="Pagination controls hidden or disabled with single page of results",
            assertion_type="hidden_or_disabled",
            assertion_value=None,
            preconditions=["navigate_to_page", "apply_filter_for_single_page"],
            postconditions=["clear_filters"],
            tags=["pagination", "empty-state"]
        ),

        # EDGE CASES
        ValidationRule(
            id="pagination_first_page_no_previous",
            name="Previous button disabled on first page",
            category="edge",
            severity="high",
            selector_strategy="text",
            selector="button:has-text('Previous'), a:has-text('Previous'), [aria-label*='previous' i]",
            test_data=None,
            expected_behavior="Previous button disabled or hidden on first page",
            assertion_type="disabled",
            assertion_value=True,
            preconditions=["navigate_to_page", "ensure_on_first_page"],
            postconditions=[],
            tags=["pagination", "edge-case", "first-page"]
        ),
        ValidationRule(
            id="pagination_last_page_no_next",
            name="Next button disabled on last page",
            category="edge",
            severity="high",
            selector_strategy="text",
            selector="button:has-text('Next'), a:has-text('Next'), [aria-label*='next' i]",
            test_data=None,
            expected_behavior="Next button disabled or hidden on last page",
            assertion_type="disabled",
            assertion_value=True,
            preconditions=["navigate_to_page", "navigate_to_last_page"],
            postconditions=["navigate_to_first_page"],
            tags=["pagination", "edge-case", "last-page"]
        ),
        ValidationRule(
            id="pagination_url_state_persistence",
            name="Pagination state persists in URL",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector="button:has-text('Next'), a:has-text('Next')",
            test_data=None,
            expected_behavior="URL updates with page parameter and page reloads to correct page",
            assertion_type="url_contains",
            assertion_value="page=",
            preconditions=["navigate_to_page"],
            postconditions=["navigate_to_first_page"],
            tags=["pagination", "url-state", "deep-linking"]
        ),
        ValidationRule(
            id="pagination_with_search",
            name="Pagination works with active search",
            category="edge",
            severity="high",
            selector_strategy="css",
            selector="button:has-text('Next'), a:has-text('Next')",
            test_data={"query": "test"},
            expected_behavior="Pagination maintains search filter across pages",
            assertion_type="search_maintained",
            assertion_value=None,
            preconditions=["navigate_to_page", "perform_search"],
            postconditions=["clear_search"],
            tags=["pagination", "interaction", "search"]
        ),
        ValidationRule(
            id="pagination_with_filters",
            name="Pagination works with active filters",
            category="edge",
            severity="high",
            selector_strategy="css",
            selector="button:has-text('Next'), a:has-text('Next')",
            test_data={"filter": "active"},
            expected_behavior="Pagination maintains filters across pages",
            assertion_type="filter_maintained",
            assertion_value=None,
            preconditions=["navigate_to_page", "apply_filter"],
            postconditions=["clear_filters"],
            tags=["pagination", "interaction", "filters"]
        ),

        # BOUNDARY TESTS
        ValidationRule(
            id="pagination_exactly_page_size",
            name="Pagination with exactly page size items",
            category="boundary",
            severity="medium",
            selector_strategy="css",
            selector=".pagination",
            test_data={"expected_items": "page_size"},
            expected_behavior="Correct pagination behavior when items exactly equal page size",
            assertion_type="pagination_correct",
            assertion_value=None,
            preconditions=["navigate_to_page", "filter_to_exact_page_size"],
            postconditions=["clear_filters"],
            tags=["pagination", "boundary"]
        ),
        ValidationRule(
            id="pagination_one_past_page_size",
            name="Pagination with page_size + 1 items",
            category="boundary",
            severity="medium",
            selector_strategy="css",
            selector=".pagination",
            test_data={"expected_items": "page_size_plus_one"},
            expected_behavior="Shows two pages when items = page_size + 1",
            assertion_type="page_count",
            assertion_value=2,
            preconditions=["navigate_to_page", "filter_to_page_size_plus_one"],
            postconditions=["clear_filters"],
            tags=["pagination", "boundary"]
        ),
        ValidationRule(
            id="pagination_jump_to_page",
            name="Jump to specific page number works",
            category="boundary",
            selector_strategy="css",
            severity="medium",
            selector="input[name*='page' i], .page-jump-input",
            test_data={"page_number": 5},
            expected_behavior="Direct page number input navigates correctly",
            assertion_type="current_page",
            assertion_value=5,
            preconditions=["navigate_to_page", "ensure_min_pages"],
            postconditions=["navigate_to_first_page"],
            tags=["pagination", "navigation", "boundary"]
        ),
        ValidationRule(
            id="pagination_current_page_indicator",
            name="Current page is visually indicated",
            category="positive",
            severity="medium",
            selector_strategy="css",
            selector=".pagination .active, .pagination [aria-current='page']",
            test_data=None,
            expected_behavior="Current page has visual indicator (active class or aria-current)",
            assertion_type="has_active_indicator",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["pagination", "accessibility", "ux"]
        )
    ],
    coverage_requirements={
        "min_positive_tests": 4,
        "min_negative_tests": 1,
        "min_edge_tests": 3,
        "min_boundary_tests": 2
    }
)


# =============================================================================
# FILTER VALIDATION SCHEMA - Comprehensive filtering testing
# =============================================================================

FILTER_VALIDATION_SCHEMA = FeatureValidationSchema(
    feature_type="filter",
    display_name="Filter Controls",
    description="Comprehensive filter validation covering single, multiple, combinations, and persistence",
    detection_strategy={
        "selectors": ["select[name*='filter']", ".filter-controls", "[role='combobox']", "input[type='checkbox'][name*='filter']"],
        "keywords": ["filter", "status", "type", "category"]
    },
    validation_rules=[
        # POSITIVE TESTS
        ValidationRule(
            id="filter_controls_visible",
            name="Filter controls are visible",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="select[name*='filter'], .filter-controls, [role='combobox']",
            test_data=None,
            expected_behavior="Filter controls visible and accessible",
            assertion_type="visible",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["filter", "ui"]
        ),
        ValidationRule(
            id="filter_single_selection",
            name="Single filter selection works",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="select[name*='filter'], select[name*='status']",
            test_data={"filter_value": "active"},
            expected_behavior="Selecting single filter reduces results to matching items",
            assertion_type="count_decreased",
            assertion_value=None,
            preconditions=["navigate_to_page", "count_initial_results"],
            postconditions=["clear_filters"],
            tags=["filter", "core-functionality"]
        ),
        ValidationRule(
            id="filter_clear_button",
            name="Clear filters button resets all filters",
            category="positive",
            severity="high",
            selector_strategy="css",
            selector="button:has-text('Clear'), button:has-text('Reset'), .clear-filters",
            test_data=None,
            expected_behavior="Clear button removes all filters and restores all results",
            assertion_type="count_restored",
            assertion_value=None,
            preconditions=["navigate_to_page", "apply_multiple_filters"],
            postconditions=[],
            tags=["filter", "clear", "ux"]
        ),
        ValidationRule(
            id="filter_multiple_and_logic",
            name="Multiple filters use AND logic",
            category="positive",
            severity="high",
            selector_strategy="css",
            selector="select[name*='filter']",
            test_data={"filters": [{"name": "status", "value": "active"}, {"name": "type", "value": "premium"}]},
            expected_behavior="Multiple filters narrow results (AND logic, not OR)",
            assertion_type="count_less_than_single_filter",
            assertion_value=None,
            preconditions=["navigate_to_page", "count_with_single_filter"],
            postconditions=["clear_filters"],
            tags=["filter", "logic", "combination"]
        ),

        # NEGATIVE TESTS
        ValidationRule(
            id="filter_no_results_message",
            name="No results message when filters match nothing",
            category="negative",
            severity="high",
            selector_strategy="css",
            selector="select[name*='filter']",
            test_data={"filter_value": "nonexistent_status"},
            expected_behavior="Shows 'No results' message when no items match filters",
            assertion_type="text_contains",
            assertion_value="no results",
            preconditions=["navigate_to_page"],
            postconditions=["clear_filters"],
            tags=["filter", "empty-state"]
        ),

        # EDGE CASES
        ValidationRule(
            id="filter_persistence_on_reload",
            name="Filter state persists on page reload",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector="select[name*='filter']",
            test_data={"filter_value": "active"},
            expected_behavior="Applied filters maintained after page reload",
            assertion_type="filter_still_applied",
            assertion_value=None,
            preconditions=["navigate_to_page", "apply_filter"],
            postconditions=["clear_filters"],
            tags=["filter", "persistence", "state"]
        ),
        ValidationRule(
            id="filter_with_search",
            name="Filters work with active search",
            category="edge",
            severity="high",
            selector_strategy="css",
            selector="select[name*='filter']",
            test_data={"query": "test", "filter_value": "active"},
            expected_behavior="Filters and search work together (combined filtering)",
            assertion_type="count_decreased_from_both",
            assertion_value=None,
            preconditions=["navigate_to_page", "perform_search"],
            postconditions=["clear_search", "clear_filters"],
            tags=["filter", "interaction", "search"]
        ),
        ValidationRule(
            id="filter_disabled_options",
            name="Disabled filter options not selectable",
            category="edge",
            severity="low",
            selector_strategy="css",
            selector="select[name*='filter'] option[disabled]",
            test_data=None,
            expected_behavior="Disabled filter options cannot be selected",
            assertion_type="not_selectable",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["filter", "edge-case", "disabled-state"]
        ),
        ValidationRule(
            id="filter_count_badges",
            name="Filter shows result count badges",
            category="edge",
            severity="low",
            selector_strategy="css",
            selector=".filter-badge, .filter-count, select option .count",
            test_data=None,
            expected_behavior="Filter options show count of matching items",
            assertion_type="has_count_indicator",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["filter", "ux", "counts"]
        ),

        # BOUNDARY TESTS
        ValidationRule(
            id="filter_all_filters_applied",
            name="All available filters applied simultaneously",
            category="boundary",
            severity="medium",
            selector_strategy="css",
            selector="select[name*='filter']",
            test_data={"apply_all": True},
            expected_behavior="Applying all filters works without errors",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=["clear_filters"],
            tags=["filter", "boundary", "stress"]
        ),
        ValidationRule(
            id="filter_rapid_changes",
            name="Rapid filter changes handled correctly",
            category="boundary",
            severity="low",
            selector_strategy="css",
            selector="select[name*='filter']",
            test_data={"rapid_changes": 10},
            expected_behavior="Rapid filter changes don't cause race conditions or errors",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=["clear_filters"],
            tags=["filter", "boundary", "performance"]
        ),
        ValidationRule(
            id="filter_clear_specific_vs_all",
            name="Clear specific filter vs clear all filters",
            category="boundary",
            severity="medium",
            selector_strategy="css",
            selector="button.clear-filter, button.clear-all-filters",
            test_data={"filters": [{"name": "status", "value": "active"}, {"name": "type", "value": "premium"}]},
            expected_behavior="Can clear individual filters or all at once",
            assertion_type="selective_clear_works",
            assertion_value=None,
            preconditions=["navigate_to_page", "apply_multiple_filters"],
            postconditions=["clear_filters"],
            tags=["filter", "boundary", "ux"]
        )
    ],
    coverage_requirements={
        "min_positive_tests": 3,
        "min_negative_tests": 1,
        "min_edge_tests": 3,
        "min_boundary_tests": 2
    }
)


# =============================================================================
# LISTING/TABLE VALIDATION SCHEMA - Comprehensive table testing
# =============================================================================

LISTING_VALIDATION_SCHEMA = FeatureValidationSchema(
    feature_type="listing",
    display_name="Listing/Table Display",
    description="Comprehensive listing validation covering display, states, formatting, and interactions",
    detection_strategy={
        "selectors": ["table", ".table", "[role='table']", ".list-view", ".data-grid"],
        "keywords": ["table", "list", "grid", "rows"]
    },
    validation_rules=[
        # POSITIVE TESTS
        ValidationRule(
            id="listing_table_visible",
            name="Table/listing is visible",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="table, .table, [role='table'], .list-view",
            test_data=None,
            expected_behavior="Table or list view is visible with data",
            assertion_type="visible",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["listing", "ui"]
        ),
        ValidationRule(
            id="listing_headers_present",
            name="Table headers are present and labeled",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="thead th, .table-header, [role='columnheader']",
            test_data=None,
            expected_behavior="Table has headers with meaningful labels",
            assertion_type="headers_exist",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["listing", "headers", "accessibility"]
        ),
        ValidationRule(
            id="listing_data_rows_present",
            name="Data rows are present",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="tbody tr, .table-row, [role='row']",
            test_data=None,
            expected_behavior="Table contains data rows",
            assertion_type="row_count_greater_than",
            assertion_value=0,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["listing", "data"]
        ),
        ValidationRule(
            id="listing_row_selection",
            name="Table row selection works",
            category="positive",
            severity="high",
            selector_strategy="css",
            selector="tbody tr, [role='row']",
            test_data={"row_index": 0},
            expected_behavior="Clicking row selects it or navigates to detail",
            assertion_type="row_selected_or_navigated",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["listing", "interaction", "selection"]
        ),

        # NEGATIVE TESTS
        ValidationRule(
            id="listing_empty_state_message",
            name="Empty state message when no data",
            category="negative",
            severity="high",
            selector_strategy="css",
            selector=".empty-state, .no-data, tbody tr",
            test_data={"filter_to_empty": True},
            expected_behavior="Shows appropriate empty state message when no data",
            assertion_type="empty_state_visible",
            assertion_value=True,
            preconditions=["navigate_to_page", "apply_filter_for_no_results"],
            postconditions=["clear_filters"],
            tags=["listing", "empty-state"]
        ),
        ValidationRule(
            id="listing_error_state",
            name="Error state displayed on load failure",
            category="negative",
            severity="high",
            selector_strategy="css",
            selector=".error-state, .error-message, [role='alert']",
            test_data={"simulate_error": True},
            expected_behavior="Shows error message when data load fails",
            assertion_type="error_visible",
            assertion_value=True,
            preconditions=["navigate_to_page_with_error"],
            postconditions=[],
            tags=["listing", "error-handling"]
        ),

        # EDGE CASES
        ValidationRule(
            id="listing_loading_state",
            name="Loading state shown during data fetch",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector=".loading, .spinner, [role='progressbar']",
            test_data=None,
            expected_behavior="Loading indicator shown while fetching data",
            assertion_type="loading_indicator_shown",
            assertion_value=True,
            preconditions=["navigate_to_page_slow_load"],
            postconditions=[],
            tags=["listing", "loading", "ux"]
        ),
        ValidationRule(
            id="listing_column_formatting",
            name="Column data formatting is correct",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector="tbody td, [role='cell']",
            test_data=None,
            expected_behavior="Data formatted correctly (dates, numbers, currency, status badges)",
            assertion_type="formatting_correct",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["listing", "formatting", "data-display"]
        ),
        ValidationRule(
            id="listing_long_text_truncation",
            name="Long text is truncated with ellipsis",
            category="edge",
            severity="low",
            selector_strategy="css",
            selector="tbody td, [role='cell']",
            test_data=None,
            expected_behavior="Long text truncated with ellipsis or tooltip",
            assertion_type="text_truncated",
            assertion_value=True,
            preconditions=["navigate_to_page", "find_long_text_cell"],
            postconditions=[],
            tags=["listing", "truncation", "ux"]
        ),

        # BOUNDARY TESTS
        ValidationRule(
            id="listing_single_item",
            name="Listing with single item displays correctly",
            category="boundary",
            severity="medium",
            selector_strategy="css",
            selector="tbody tr, [role='row']",
            test_data={"filter_to_single_item": True},
            expected_behavior="Single item displayed correctly without layout issues",
            assertion_type="row_count",
            assertion_value=1,
            preconditions=["navigate_to_page", "filter_to_single_item"],
            postconditions=["clear_filters"],
            tags=["listing", "boundary"]
        ),
        ValidationRule(
            id="listing_large_dataset",
            name="Listing handles large datasets efficiently",
            category="boundary",
            severity="high",
            selector_strategy="css",
            selector="tbody tr, [role='row']",
            test_data={"expected_min_items": 100},
            expected_behavior="Large dataset loads without performance degradation",
            assertion_type="no_performance_issues",
            assertion_value=None,
            preconditions=["navigate_to_page_with_large_dataset"],
            postconditions=[],
            tags=["listing", "boundary", "performance"]
        ),
        ValidationRule(
            id="listing_column_alignment",
            name="Column alignment is correct",
            category="boundary",
            severity="low",
            selector_strategy="css",
            selector="thead th, tbody td",
            test_data=None,
            expected_behavior="Text columns left-aligned, numbers right-aligned, dates formatted",
            assertion_type="alignment_correct",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["listing", "formatting", "alignment"]
        )
    ],
    coverage_requirements={
        "min_positive_tests": 3,
        "min_negative_tests": 2,
        "min_edge_tests": 2,
        "min_boundary_tests": 2
    }
)


# =============================================================================
# FORM VALIDATION SCHEMA - Generic form field validation testing
# =============================================================================

FORM_VALIDATION_SCHEMA = FeatureValidationSchema(
    feature_type="form",
    display_name="Form Validation",
    description="Comprehensive form field validation covering required fields, input types, and submission flows",
    detection_strategy={
        "selectors": ["form", "[role='form']", "form input", "form textarea", "form select"],
        "keywords": ["form", "submit", "input", "field", "required"]
    },
    validation_rules=[
        # POSITIVE TESTS
        ValidationRule(
            id="form_visible_and_accessible",
            name="Form is visible and accessible",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="form, [role='form']",
            test_data=None,
            expected_behavior="Form renders correctly with all fields visible",
            assertion_type="visible",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["form", "ui", "accessibility"]
        ),
        ValidationRule(
            id="form_submit_valid_data",
            name="Form submits successfully with valid data",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="form button[type='submit'], form button:has-text('Submit'), form button:has-text('Save')",
            test_data={"fill_required_fields": True},
            expected_behavior="Form submits without errors and shows success feedback",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page", "fill_required_fields"],
            postconditions=["reset_form"],
            tags=["form", "submit", "core-functionality"]
        ),
        ValidationRule(
            id="form_labels_present",
            name="All form fields have labels or placeholders",
            category="positive",
            severity="high",
            selector_strategy="css",
            selector="form label, form input[placeholder], form textarea[placeholder]",
            test_data=None,
            expected_behavior="Every input field is labeled for accessibility",
            assertion_type="visible",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["form", "accessibility", "labels"]
        ),

        # NEGATIVE TESTS
        ValidationRule(
            id="form_required_field_validation",
            name="Required fields show error when empty on submit",
            category="negative",
            severity="critical",
            selector_strategy="css",
            selector="form button[type='submit'], form button:has-text('Submit')",
            test_data={"leave_required_fields_empty": True},
            expected_behavior="Validation errors shown for empty required fields",
            assertion_type="text_contains",
            assertion_value="required",
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["form", "validation", "required"]
        ),
        ValidationRule(
            id="form_invalid_email_validation",
            name="Invalid email format shows validation error",
            category="negative",
            severity="high",
            selector_strategy="css",
            selector="input[type='email'], input[name*='email' i]",
            test_data={"email": "not-a-valid-email"},
            expected_behavior="Invalid email shows format error message",
            assertion_type="has_validation_error",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["form", "validation", "email"]
        ),

        # EDGE CASES
        ValidationRule(
            id="form_special_chars_in_text_fields",
            name="Text fields handle special characters",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector="form input[type='text'], form textarea",
            test_data={"text": "<script>alert('xss')</script>"},
            expected_behavior="Special characters handled safely without XSS",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=["reset_form"],
            tags=["form", "security", "xss"]
        ),
        ValidationRule(
            id="form_tab_key_navigation",
            name="Tab key navigates between form fields",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector="form input:first-of-type",
            test_data=None,
            expected_behavior="Tab key moves focus through fields in logical order",
            assertion_type="focus_moves",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["form", "keyboard", "accessibility"]
        ),

        # BOUNDARY TESTS
        ValidationRule(
            id="form_max_length_field",
            name="Fields respect maxlength attribute",
            category="boundary",
            severity="medium",
            selector_strategy="css",
            selector="form input[maxlength], form textarea[maxlength]",
            test_data={"text": "a" * 1000},
            expected_behavior="Input truncated at maxlength, no errors",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=["reset_form"],
            tags=["form", "boundary", "maxlength"]
        ),
    ],
    coverage_requirements={
        "min_positive_tests": 2,
        "min_negative_tests": 2,
        "min_edge_tests": 1,
        "min_boundary_tests": 1
    }
)


# =============================================================================
# MODAL/DIALOG VALIDATION SCHEMA - Modal and dialog interaction testing
# =============================================================================

MODAL_VALIDATION_SCHEMA = FeatureValidationSchema(
    feature_type="modal",
    display_name="Modal/Dialog Interactions",
    description="Comprehensive modal and dialog validation covering open/close, content, and accessibility",
    detection_strategy={
        "selectors": ["[role='dialog']", ".modal", ".dialog", "[aria-modal='true']", ".drawer"],
        "keywords": ["modal", "dialog", "popup", "overlay", "drawer"]
    },
    validation_rules=[
        # POSITIVE TESTS
        ValidationRule(
            id="modal_opens_on_trigger",
            name="Modal opens when trigger is clicked",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="[data-toggle='modal'], button[aria-haspopup='dialog'], .open-modal",
            test_data=None,
            expected_behavior="Modal appears after clicking trigger button",
            assertion_type="visible",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=["close_modal"],
            tags=["modal", "trigger", "core-functionality"]
        ),
        ValidationRule(
            id="modal_closes_on_x_button",
            name="Modal closes when close button clicked",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="[role='dialog'] button[aria-label*='close' i], .modal .close, .modal-close",
            test_data=None,
            expected_behavior="Modal dismisses when close (X) button clicked",
            assertion_type="not_visible",
            assertion_value=True,
            preconditions=["navigate_to_page", "open_modal"],
            postconditions=[],
            tags=["modal", "close", "core-functionality"]
        ),
        ValidationRule(
            id="modal_closes_on_escape",
            name="Modal closes when Escape key pressed",
            category="positive",
            severity="high",
            selector_strategy="css",
            selector="[role='dialog'], .modal",
            test_data={"key": "Escape"},
            expected_behavior="Modal dismisses when Escape key is pressed",
            assertion_type="not_visible",
            assertion_value=True,
            preconditions=["navigate_to_page", "open_modal"],
            postconditions=[],
            tags=["modal", "keyboard", "accessibility"]
        ),

        # NEGATIVE TESTS
        ValidationRule(
            id="modal_backdrop_prevents_interaction",
            name="Modal backdrop blocks background interaction",
            category="negative",
            severity="high",
            selector_strategy="css",
            selector=".modal-backdrop, [data-modal-backdrop]",
            test_data=None,
            expected_behavior="Background content is not interactive while modal is open",
            assertion_type="visible",
            assertion_value=True,
            preconditions=["navigate_to_page", "open_modal"],
            postconditions=["close_modal"],
            tags=["modal", "backdrop", "ux"]
        ),

        # EDGE CASES
        ValidationRule(
            id="modal_focus_trap",
            name="Focus is trapped inside modal",
            category="edge",
            severity="high",
            selector_strategy="css",
            selector="[role='dialog']",
            test_data=None,
            expected_behavior="Tab key cycles through modal elements only",
            assertion_type="focus_trapped",
            assertion_value=None,
            preconditions=["navigate_to_page", "open_modal"],
            postconditions=["close_modal"],
            tags=["modal", "focus", "accessibility"]
        ),
        ValidationRule(
            id="modal_scroll_when_content_long",
            name="Modal scrolls for long content",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector="[role='dialog'] .modal-body, .modal .modal-content",
            test_data=None,
            expected_behavior="Modal content scrollable when exceeding viewport",
            assertion_type="scrollable",
            assertion_value=True,
            preconditions=["navigate_to_page", "open_modal_with_long_content"],
            postconditions=["close_modal"],
            tags=["modal", "scroll", "ux"]
        ),

        # BOUNDARY TESTS
        ValidationRule(
            id="modal_stack_multiple",
            name="Multiple modals stack correctly",
            category="boundary",
            severity="medium",
            selector_strategy="css",
            selector="[role='dialog']",
            test_data=None,
            expected_behavior="Nested modals stack and dismiss in correct order",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["modal", "stacking", "edge-case"]
        ),
    ],
    coverage_requirements={
        "min_positive_tests": 2,
        "min_negative_tests": 1,
        "min_edge_tests": 1,
        "min_boundary_tests": 1
    }
)


# =============================================================================
# NAVIGATION VALIDATION SCHEMA - App navigation and routing testing
# =============================================================================

NAVIGATION_VALIDATION_SCHEMA = FeatureValidationSchema(
    feature_type="navigation",
    display_name="Navigation & Routing",
    description="Comprehensive navigation validation covering menus, routing, breadcrumbs, and state preservation",
    detection_strategy={
        "selectors": ["nav", "aside", "[role='navigation']", ".sidebar", ".navbar", ".menu"],
        "keywords": ["navigation", "menu", "sidebar", "navbar", "breadcrumb", "routing"]
    },
    validation_rules=[
        # POSITIVE TESTS
        ValidationRule(
            id="navigation_menu_visible",
            name="Navigation menu is visible",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="nav, aside, [role='navigation'], .sidebar, .navbar",
            test_data=None,
            expected_behavior="Navigation menu renders and is accessible",
            assertion_type="visible",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["navigation", "ui"]
        ),
        ValidationRule(
            id="navigation_links_work",
            name="Navigation links navigate to correct pages",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="nav a, .sidebar a, .navbar a, [role='navigation'] a",
            test_data=None,
            expected_behavior="Clicking nav links changes page/view without errors",
            assertion_type="url_changed",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["navigation", "routing", "core-functionality"]
        ),
        ValidationRule(
            id="navigation_active_state",
            name="Current page highlighted in navigation",
            category="positive",
            severity="high",
            selector_strategy="css",
            selector="nav a.active, .sidebar a.active, [aria-current='page']",
            test_data=None,
            expected_behavior="Current page/section is visually highlighted in nav",
            assertion_type="visible",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["navigation", "active-state", "ux"]
        ),

        # NEGATIVE TESTS
        ValidationRule(
            id="navigation_404_handling",
            name="Invalid route shows proper 404 or redirect",
            category="negative",
            severity="high",
            selector_strategy="css",
            selector="body",
            test_data={"url": "/nonexistent-route-xyz"},
            expected_behavior="Invalid URL shows 404 page or redirects gracefully",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_invalid_url"],
            postconditions=["navigate_to_home"],
            tags=["navigation", "404", "error-handling"]
        ),

        # EDGE CASES
        ValidationRule(
            id="navigation_breadcrumb_correct",
            name="Breadcrumbs reflect current location",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector=".breadcrumb, [aria-label='breadcrumb'], nav[aria-label='breadcrumb']",
            test_data=None,
            expected_behavior="Breadcrumb trail shows correct hierarchy of pages",
            assertion_type="text_contains",
            assertion_value=None,
            preconditions=["navigate_to_nested_page"],
            postconditions=[],
            tags=["navigation", "breadcrumb", "ux"]
        ),
        ValidationRule(
            id="navigation_back_button_works",
            name="Browser back button navigates correctly",
            category="edge",
            severity="high",
            selector_strategy="css",
            selector="body",
            test_data=None,
            expected_behavior="Browser back button returns to previous page with state intact",
            assertion_type="url_changed",
            assertion_value=None,
            preconditions=["navigate_to_page", "navigate_to_sub_page"],
            postconditions=[],
            tags=["navigation", "history", "browser"]
        ),
        ValidationRule(
            id="navigation_keyboard_accessible",
            name="Navigation is keyboard accessible",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector="nav a, .sidebar a",
            test_data=None,
            expected_behavior="All nav items reachable via keyboard Tab/Enter",
            assertion_type="focusable",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["navigation", "keyboard", "accessibility"]
        ),

        # BOUNDARY TESTS
        ValidationRule(
            id="navigation_deep_nested_menu",
            name="Deep nested menu items accessible",
            category="boundary",
            severity="medium",
            selector_strategy="css",
            selector=".submenu, .sub-menu, [role='menu'] [role='menu']",
            test_data=None,
            expected_behavior="Multi-level menus expand and navigate correctly",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["navigation", "nested", "submenu"]
        ),
    ],
    coverage_requirements={
        "min_positive_tests": 2,
        "min_negative_tests": 1,
        "min_edge_tests": 2,
        "min_boundary_tests": 1
    }
)


# =============================================================================
# TABS VALIDATION SCHEMA - Tab panel testing
# =============================================================================

TABS_VALIDATION_SCHEMA = FeatureValidationSchema(
    feature_type="tabs",
    display_name="Tab Panels",
    description="Comprehensive tab validation covering switching, content loading, and state management",
    detection_strategy={
        "selectors": ["[role='tablist']", "[role='tab']", ".tabs", ".tab-panel", ".nav-tabs"],
        "keywords": ["tabs", "tab", "panel", "tablist"]
    },
    validation_rules=[
        # POSITIVE TESTS
        ValidationRule(
            id="tabs_visible",
            name="Tab list is visible",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="[role='tablist'], .tabs, .nav-tabs",
            test_data=None,
            expected_behavior="Tab list renders with all tabs visible",
            assertion_type="visible",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["tabs", "ui"]
        ),
        ValidationRule(
            id="tabs_switch_content",
            name="Clicking tab shows correct panel content",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="[role='tab'], .tab-button, .nav-tabs .nav-link",
            test_data=None,
            expected_behavior="Clicking a tab displays corresponding panel content",
            assertion_type="content_changed",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["tabs", "switching", "core-functionality"]
        ),
        ValidationRule(
            id="tabs_active_state_shown",
            name="Active tab is visually distinguished",
            category="positive",
            severity="high",
            selector_strategy="css",
            selector="[role='tab'][aria-selected='true'], .tab-button.active, .nav-link.active",
            test_data=None,
            expected_behavior="Active tab visually distinguished from inactive tabs",
            assertion_type="visible",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["tabs", "active-state", "ux"]
        ),

        # NEGATIVE TESTS
        ValidationRule(
            id="tabs_disabled_tab_not_clickable",
            name="Disabled tabs are not interactive",
            category="negative",
            severity="medium",
            selector_strategy="css",
            selector="[role='tab'][aria-disabled='true'], .tab-button:disabled",
            test_data=None,
            expected_behavior="Disabled tabs cannot be clicked or focused",
            assertion_type="not_clickable",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["tabs", "disabled", "accessibility"]
        ),

        # EDGE CASES
        ValidationRule(
            id="tabs_keyboard_navigation",
            name="Arrow keys navigate between tabs",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector="[role='tab']",
            test_data={"key": "ArrowRight"},
            expected_behavior="Arrow keys cycle through tabs according to ARIA pattern",
            assertion_type="focus_moved",
            assertion_value=None,
            preconditions=["navigate_to_page", "focus_first_tab"],
            postconditions=[],
            tags=["tabs", "keyboard", "accessibility"]
        ),
        ValidationRule(
            id="tabs_url_reflects_active_tab",
            name="URL or state reflects active tab",
            category="edge",
            severity="low",
            selector_strategy="css",
            selector="[role='tab']",
            test_data=None,
            expected_behavior="Tab state persisted in URL hash or query param for deep linking",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["tabs", "url", "deep-link"]
        ),

        # BOUNDARY TESTS
        ValidationRule(
            id="tabs_many_tabs_overflow",
            name="Many tabs handled with scroll or overflow menu",
            category="boundary",
            severity="low",
            selector_strategy="css",
            selector="[role='tablist']",
            test_data=None,
            expected_behavior="Overflow tabs accessible via scroll or dropdown",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page_with_many_tabs"],
            postconditions=[],
            tags=["tabs", "overflow", "ux"]
        ),
    ],
    coverage_requirements={
        "min_positive_tests": 2,
        "min_negative_tests": 1,
        "min_edge_tests": 1,
        "min_boundary_tests": 1
    }
)


# =============================================================================
# BUTTON ACTIONS VALIDATION SCHEMA - Button state and interaction testing
# =============================================================================

BUTTON_ACTIONS_SCHEMA = FeatureValidationSchema(
    feature_type="button_actions",
    display_name="Button Actions",
    description="Comprehensive button validation covering states, interactions, and accessibility",
    detection_strategy={
        "selectors": ["button", "[role='button']", "input[type='button']", "input[type='submit']"],
        "keywords": ["button", "action", "submit", "cancel", "save", "create", "edit"]
    },
    validation_rules=[
        # POSITIVE TESTS
        ValidationRule(
            id="button_clickable",
            name="Primary action buttons are clickable",
            category="positive",
            severity="critical",
            selector_strategy="css",
            selector="button:not([disabled]), [role='button']:not([aria-disabled='true'])",
            test_data=None,
            expected_behavior="Buttons respond to click events and trigger actions",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["button", "click", "core-functionality"]
        ),
        ValidationRule(
            id="button_visual_feedback",
            name="Buttons show hover/focus visual feedback",
            category="positive",
            severity="medium",
            selector_strategy="css",
            selector="button:not([disabled])",
            test_data=None,
            expected_behavior="Buttons show hover state and focus ring for accessibility",
            assertion_type="has_hover_style",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["button", "ux", "accessibility"]
        ),

        # NEGATIVE TESTS
        ValidationRule(
            id="button_disabled_not_clickable",
            name="Disabled buttons cannot be clicked",
            category="negative",
            severity="high",
            selector_strategy="css",
            selector="button[disabled], [aria-disabled='true']",
            test_data=None,
            expected_behavior="Disabled buttons do not trigger actions",
            assertion_type="not_clickable",
            assertion_value=True,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["button", "disabled", "state"]
        ),

        # EDGE CASES
        ValidationRule(
            id="button_loading_state",
            name="Buttons show loading state during async operations",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector="button.loading, button[aria-busy='true'], button .spinner",
            test_data=None,
            expected_behavior="Buttons show loading indicator during async operations and prevent double-click",
            assertion_type="visible",
            assertion_value=True,
            preconditions=["navigate_to_page", "trigger_async_action"],
            postconditions=[],
            tags=["button", "loading", "async"]
        ),
        ValidationRule(
            id="button_keyboard_activation",
            name="Buttons activated by Enter/Space key",
            category="edge",
            severity="medium",
            selector_strategy="css",
            selector="button, [role='button']",
            test_data={"key": "Enter"},
            expected_behavior="Enter and Space keys activate focused buttons",
            assertion_type="no_error",
            assertion_value=None,
            preconditions=["navigate_to_page", "focus_button"],
            postconditions=[],
            tags=["button", "keyboard", "accessibility"]
        ),

        # BOUNDARY TESTS
        ValidationRule(
            id="button_double_click_prevention",
            name="Double-clicking submit button prevented",
            category="boundary",
            severity="high",
            selector_strategy="css",
            selector="button[type='submit'], form button",
            test_data={"clicks": 2, "rapid": True},
            expected_behavior="Rapid double-click does not submit form twice",
            assertion_type="single_submission",
            assertion_value=None,
            preconditions=["navigate_to_page"],
            postconditions=[],
            tags=["button", "double-click", "prevention"]
        ),
    ],
    coverage_requirements={
        "min_positive_tests": 1,
        "min_negative_tests": 1,
        "min_edge_tests": 1,
        "min_boundary_tests": 1
    }
)


# =============================================================================
# MODULE EXPORTS
# =============================================================================

__all__ = [
    "ValidationRule",
    "FeatureValidationSchema",
    "ValidationSchemaRegistry",
    "SEARCH_VALIDATION_SCHEMA",
    "PAGINATION_VALIDATION_SCHEMA",
    "FILTER_VALIDATION_SCHEMA",
    "LISTING_VALIDATION_SCHEMA",
    "FORM_VALIDATION_SCHEMA",
    "MODAL_VALIDATION_SCHEMA",
    "NAVIGATION_VALIDATION_SCHEMA",
    "TABS_VALIDATION_SCHEMA",
    "BUTTON_ACTIONS_SCHEMA",
]

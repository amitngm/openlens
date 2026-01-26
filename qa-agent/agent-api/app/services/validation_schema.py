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
# MODULE EXPORTS
# =============================================================================

__all__ = [
    "ValidationRule",
    "FeatureValidationSchema",
    "ValidationSchemaRegistry",
    "SEARCH_VALIDATION_SCHEMA",
    "PAGINATION_VALIDATION_SCHEMA",
    "FILTER_VALIDATION_SCHEMA",
    "LISTING_VALIDATION_SCHEMA"
]

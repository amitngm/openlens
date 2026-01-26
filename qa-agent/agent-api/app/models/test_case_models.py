"""Rich Test Case Models - Executable test case data structures."""

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


@dataclass
class TestStep:
    """Single executable test step with specific action and assertions."""
    step_number: int
    action: str  # "navigate", "click", "fill", "assert", "wait", "clear", "select"
    selector: Optional[str] = None
    selector_strategy: str = "css"  # "css", "xpath", "text", "aria"
    data: Optional[Dict[str, Any]] = None
    expected: Optional[Dict[str, Any]] = None
    timeout_ms: int = 5000
    retry_count: int = 0
    screenshot_on_failure: bool = True
    description: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary format."""
        return {
            "step_number": self.step_number,
            "action": self.action,
            "selector": self.selector,
            "selector_strategy": self.selector_strategy,
            "data": self.data,
            "expected": self.expected,
            "timeout_ms": self.timeout_ms,
            "retry_count": self.retry_count,
            "screenshot_on_failure": self.screenshot_on_failure,
            "description": self.description
        }

    def to_human_readable(self) -> str:
        """Convert to human-readable step description."""
        if self.action == "navigate":
            return f"Navigate to {self.data.get('url', 'page')}"
        elif self.action == "click":
            return f"Click {self.selector}"
        elif self.action == "fill":
            return f"Enter '{self.data.get('value', '')}' in {self.selector}"
        elif self.action == "select":
            return f"Select '{self.data.get('value', '')}' from {self.selector}"
        elif self.action == "assert":
            return f"Verify {self.expected}"
        elif self.action == "wait":
            return f"Wait {self.data.get('duration_ms', self.timeout_ms)}ms"
        elif self.action == "clear":
            return f"Clear {self.selector}"
        else:
            return f"{self.action} {self.selector or ''}"


@dataclass
class TestCase:
    """Enhanced test case with full execution details and metadata."""
    id: str
    name: str
    description: str
    feature_type: str  # "search", "pagination", "filter", "listing"
    test_category: str  # "positive", "negative", "edge", "boundary"
    severity: str  # "critical", "high", "medium", "low"
    priority: str  # "critical", "high", "medium", "low"

    # Execution details
    steps: List[TestStep] = field(default_factory=list)
    preconditions: List[str] = field(default_factory=list)
    postconditions: List[str] = field(default_factory=list)
    test_data: Dict[str, Any] = field(default_factory=dict)

    # Validation details
    validation_rule_id: str = ""
    expected_result: str = ""
    assertion_type: str = ""
    assertion_value: Any = None

    # Metadata
    page_url: str = ""
    page_name: str = ""
    status: str = "pending"  # "pending", "running", "passed", "failed", "skipped"
    tags: List[str] = field(default_factory=list)

    # Coverage tracking
    covers_requirements: List[str] = field(default_factory=list)

    # Execution results (populated after test runs)
    execution_time_ms: Optional[int] = None
    error_message: Optional[str] = None
    screenshot_path: Optional[str] = None
    executed_at: Optional[str] = None

    def to_executable_dict(self) -> Dict[str, Any]:
        """Convert to format executable by test_executor."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "feature_type": self.feature_type,
            "test_category": self.test_category,
            "severity": self.severity,
            "priority": self.priority,
            "steps": [step.to_dict() for step in self.steps],
            "preconditions": self.preconditions,
            "postconditions": self.postconditions,
            "test_data": self.test_data,
            "validation_rule_id": self.validation_rule_id,
            "expected_result": self.expected_result,
            "assertion_type": self.assertion_type,
            "assertion_value": self.assertion_value,
            "page_url": self.page_url,
            "page_name": self.page_name,
            "status": self.status,
            "tags": self.tags,
            "covers_requirements": self.covers_requirements
        }

    def to_human_readable_steps(self) -> List[str]:
        """Convert steps to human-readable format (backwards compatible with old format)."""
        return [step.to_human_readable() for step in self.steps]

    def to_legacy_format(self) -> Dict[str, Any]:
        """Convert to legacy test case format for backwards compatibility."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "page_name": self.page_name,
            "page_url": self.page_url,
            "feature_type": self.feature_type,
            "priority": self.priority,
            "steps": self.to_human_readable_steps(),
            "expected_result": self.expected_result,
            "tags": self.tags
        }

    def add_execution_result(
        self,
        status: str,
        execution_time_ms: int,
        error_message: Optional[str] = None,
        screenshot_path: Optional[str] = None
    ):
        """Add execution results to test case."""
        self.status = status
        self.execution_time_ms = execution_time_ms
        self.error_message = error_message
        self.screenshot_path = screenshot_path
        self.executed_at = datetime.utcnow().isoformat()

    def get_coverage_summary(self) -> str:
        """Get coverage summary for this test case."""
        return f"{self.feature_type}/{self.test_category}/{self.severity}"


@dataclass
class TestSuite:
    """Collection of test cases with metadata."""
    id: str
    name: str
    description: str
    test_cases: List[TestCase] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    run_id: Optional[str] = None

    # Statistics
    total_tests: int = 0
    passed_tests: int = 0
    failed_tests: int = 0
    skipped_tests: int = 0
    total_execution_time_ms: int = 0

    def add_test_case(self, test_case: TestCase):
        """Add a test case to the suite."""
        self.test_cases.append(test_case)
        self.total_tests = len(self.test_cases)

    def update_statistics(self):
        """Update statistics based on test results."""
        self.passed_tests = len([tc for tc in self.test_cases if tc.status == "passed"])
        self.failed_tests = len([tc for tc in self.test_cases if tc.status == "failed"])
        self.skipped_tests = len([tc for tc in self.test_cases if tc.status == "skipped"])
        self.total_execution_time_ms = sum(
            tc.execution_time_ms for tc in self.test_cases if tc.execution_time_ms
        )

    def get_coverage_by_feature(self) -> Dict[str, int]:
        """Get test count by feature type."""
        coverage = {}
        for tc in self.test_cases:
            feature = tc.feature_type
            coverage[feature] = coverage.get(feature, 0) + 1
        return coverage

    def get_coverage_by_category(self) -> Dict[str, int]:
        """Get test count by test category."""
        coverage = {}
        for tc in self.test_cases:
            category = tc.test_category
            coverage[category] = coverage.get(category, 0) + 1
        return coverage

    def get_coverage_by_severity(self) -> Dict[str, int]:
        """Get test count by severity."""
        coverage = {}
        for tc in self.test_cases:
            severity = tc.severity
            coverage[severity] = coverage.get(severity, 0) + 1
        return coverage

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary format."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "test_cases": [tc.to_executable_dict() for tc in self.test_cases],
            "created_at": self.created_at,
            "run_id": self.run_id,
            "statistics": {
                "total_tests": self.total_tests,
                "passed_tests": self.passed_tests,
                "failed_tests": self.failed_tests,
                "skipped_tests": self.skipped_tests,
                "total_execution_time_ms": self.total_execution_time_ms
            },
            "coverage": {
                "by_feature": self.get_coverage_by_feature(),
                "by_category": self.get_coverage_by_category(),
                "by_severity": self.get_coverage_by_severity()
            }
        }


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def create_test_step(
    step_number: int,
    action: str,
    description: str = "",
    selector: Optional[str] = None,
    selector_strategy: str = "css",
    data: Optional[Dict[str, Any]] = None,
    expected: Optional[Dict[str, Any]] = None,
    timeout_ms: int = 5000
) -> TestStep:
    """Helper function to create a test step."""
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


def create_navigation_step(step_number: int, url: str) -> TestStep:
    """Helper to create a navigation step."""
    return create_test_step(
        step_number=step_number,
        action="navigate",
        description=f"Navigate to {url}",
        data={"url": url},
        expected={"status": 200}
    )


def create_fill_step(
    step_number: int,
    selector: str,
    value: str,
    selector_strategy: str = "css"
) -> TestStep:
    """Helper to create a fill/input step."""
    return create_test_step(
        step_number=step_number,
        action="fill",
        description=f"Enter '{value}' in {selector}",
        selector=selector,
        selector_strategy=selector_strategy,
        data={"value": value}
    )


def create_click_step(
    step_number: int,
    selector: str,
    selector_strategy: str = "css"
) -> TestStep:
    """Helper to create a click step."""
    return create_test_step(
        step_number=step_number,
        action="click",
        description=f"Click {selector}",
        selector=selector,
        selector_strategy=selector_strategy
    )


def create_assertion_step(
    step_number: int,
    assertion_type: str,
    selector: Optional[str] = None,
    expected: Optional[Dict[str, Any]] = None,
    selector_strategy: str = "css"
) -> TestStep:
    """Helper to create an assertion step."""
    return create_test_step(
        step_number=step_number,
        action="assert",
        description=f"Verify {assertion_type}",
        selector=selector,
        selector_strategy=selector_strategy,
        expected=expected or {"assertion_type": assertion_type}
    )


def create_wait_step(step_number: int, duration_ms: int = 1500) -> TestStep:
    """Helper to create a wait step."""
    return create_test_step(
        step_number=step_number,
        action="wait",
        description=f"Wait {duration_ms}ms",
        data={"duration_ms": duration_ms}
    )


__all__ = [
    "TestStep",
    "TestCase",
    "TestSuite",
    "create_test_step",
    "create_navigation_step",
    "create_fill_step",
    "create_click_step",
    "create_assertion_step",
    "create_wait_step"
]

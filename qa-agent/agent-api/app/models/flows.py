"""Models for flow definitions."""

from enum import Enum
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


class StepType(str, Enum):
    """Types of flow steps."""
    UI = "ui"
    API = "api"
    K8S = "k8s"
    WAIT = "wait"
    ASSERT = "assert"


class UIAction(str, Enum):
    """UI automation actions."""
    NAVIGATE = "navigate"
    CLICK = "click"
    FILL = "fill"
    SELECT = "select"
    CHECK = "check"
    UNCHECK = "uncheck"
    HOVER = "hover"
    WAIT = "wait"
    WAIT_FOR_SELECTOR = "wait_for_selector"
    WAIT_FOR_TEXT = "wait_for_text"
    SCREENSHOT = "screenshot"
    ASSERT_TEXT = "assert_text"
    ASSERT_VISIBLE = "assert_visible"
    ASSERT_VALUE = "assert_value"
    PRESS = "press"
    SCROLL = "scroll"


class HTTPMethod(str, Enum):
    """HTTP methods for API calls."""
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"
    DELETE = "DELETE"


class AssertionType(str, Enum):
    """Types of assertions."""
    EQUALS = "equals"
    NOT_EQUALS = "not_equals"
    CONTAINS = "contains"
    NOT_CONTAINS = "not_contains"
    MATCHES = "matches"
    GREATER_THAN = "greater_than"
    LESS_THAN = "less_than"
    EXISTS = "exists"
    NOT_EXISTS = "not_exists"
    STATUS_CODE = "status_code"
    JSON_PATH = "json_path"


class Assertion(BaseModel):
    """A single assertion to validate."""
    type: AssertionType = Field(..., description="Assertion type")
    target: str = Field(..., description="Target to assert (selector, path, etc)")
    expected: Any = Field(None, description="Expected value")
    message: Optional[str] = Field(None, description="Custom failure message")


class UIStep(BaseModel):
    """UI automation step."""
    action: UIAction = Field(..., description="UI action to perform")
    selector: Optional[str] = Field(None, description="CSS/XPath selector")
    value: Optional[str] = Field(None, description="Value for fill/select")
    url: Optional[str] = Field(None, description="URL for navigate")
    timeout_ms: int = Field(default=30000, description="Action timeout")
    screenshot: bool = Field(default=False, description="Capture screenshot after")
    assertions: List[Assertion] = Field(
        default_factory=list,
        description="Assertions to run"
    )
    
    # Wait options
    wait_for: Optional[str] = Field(None, description="Wait for selector/condition")
    wait_timeout_ms: int = Field(default=10000, description="Wait timeout")


class APIStep(BaseModel):
    """API call step."""
    method: HTTPMethod = Field(..., description="HTTP method")
    url: str = Field(..., description="URL (supports variables)")
    headers: Dict[str, str] = Field(
        default_factory=dict,
        description="Request headers"
    )
    body: Optional[Union[Dict[str, Any], str]] = Field(
        None,
        description="Request body"
    )
    query_params: Dict[str, str] = Field(
        default_factory=dict,
        description="Query parameters"
    )
    
    # Auth
    bearer_token: Optional[str] = Field(
        None,
        description="Bearer token (use $API_TOKEN for env var)"
    )
    
    # Response handling
    timeout_ms: int = Field(default=30000, description="Request timeout")
    retries: int = Field(default=0, description="Number of retries")
    retry_delay_ms: int = Field(default=1000, description="Delay between retries")
    
    # Assertions
    expected_status: int = Field(default=200, description="Expected status code")
    assertions: List[Assertion] = Field(
        default_factory=list,
        description="Response assertions"
    )
    
    # Response extraction
    extract: Dict[str, str] = Field(
        default_factory=dict,
        description="Extract values to variables (name: jsonpath)"
    )
    
    # Logging
    log_response: bool = Field(
        default=True,
        description="Log response (secrets redacted)"
    )


class K8sStep(BaseModel):
    """Kubernetes check step."""
    check_type: str = Field(
        ...,
        description="Check type: pod_ready, service_available, logs_grep, endpoint_ready"
    )
    resource_type: str = Field(
        default="pod",
        description="Resource type: pod, service, endpoint"
    )
    resource_name: Optional[str] = Field(
        None,
        description="Resource name (supports patterns)"
    )
    label_selector: Optional[str] = Field(
        None,
        description="Label selector for resource lookup"
    )
    namespace: Optional[str] = Field(
        None,
        description="Namespace (defaults to agent namespace)"
    )
    
    # For logs grep
    log_pattern: Optional[str] = Field(None, description="Pattern to grep in logs")
    container: Optional[str] = Field(None, description="Container name for logs")
    
    # Timeout
    timeout_ms: int = Field(default=60000, description="Check timeout")
    
    # Assertions
    assertions: List[Assertion] = Field(
        default_factory=list,
        description="Check assertions"
    )


class FlowStep(BaseModel):
    """A single step in a flow."""
    name: str = Field(..., description="Step name")
    description: Optional[str] = Field(None, description="Step description")
    type: StepType = Field(..., description="Step type")
    
    # Step configuration (one of these based on type)
    ui: Optional[UIStep] = Field(None, description="UI step config")
    api: Optional[APIStep] = Field(None, description="API step config")
    k8s: Optional[K8sStep] = Field(None, description="K8s step config")
    
    # Control flow
    continue_on_failure: bool = Field(
        default=False,
        description="Continue flow if step fails"
    )
    skip_condition: Optional[str] = Field(
        None,
        description="Expression to skip step"
    )
    retry_count: int = Field(default=0, description="Retry count on failure")
    
    # Wait
    wait_before_ms: int = Field(default=0, description="Wait before step")
    wait_after_ms: int = Field(default=0, description="Wait after step")


class FlowDefinition(BaseModel):
    """Complete flow definition."""
    name: str = Field(..., description="Flow name")
    description: Optional[str] = Field(None, description="Flow description")
    version: str = Field(default="1.0.0", description="Flow version")
    
    # Metadata
    tags: List[str] = Field(default_factory=list, description="Flow tags")
    author: Optional[str] = Field(None, description="Flow author")
    
    # Environment constraints
    allowed_environments: List[str] = Field(
        default_factory=lambda: ["dev", "staging"],
        description="Allowed environments"
    )
    
    # Variables
    required_variables: List[str] = Field(
        default_factory=list,
        description="Required input variables"
    )
    default_variables: Dict[str, Any] = Field(
        default_factory=dict,
        description="Default variable values"
    )
    
    # Steps
    setup: List[FlowStep] = Field(
        default_factory=list,
        description="Setup steps (run before main)"
    )
    steps: List[FlowStep] = Field(..., description="Main test steps")
    teardown: List[FlowStep] = Field(
        default_factory=list,
        description="Teardown steps (always run)"
    )
    
    # Execution options
    timeout_ms: int = Field(
        default=600000,
        description="Total flow timeout (10 min default)"
    )
    parallel: bool = Field(
        default=False,
        description="Allow parallel step execution"
    )
    
    # Artifacts
    capture_screenshots: bool = Field(
        default=True,
        description="Capture screenshots on failure"
    )
    capture_video: bool = Field(
        default=False,
        description="Capture video of UI steps"
    )
    capture_har: bool = Field(
        default=True,
        description="Capture HAR network log"
    )

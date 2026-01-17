"""Models for test run management."""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class RunState(str, Enum):
    """Possible states of a test run."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


class StepResult(BaseModel):
    """Result of a single test step."""
    step_name: str = Field(..., description="Name of the step")
    step_type: str = Field(..., description="Type: ui, api, or k8s")
    status: str = Field(..., description="pass, fail, skip, error")
    start_time: datetime = Field(..., description="Step start time")
    end_time: Optional[datetime] = Field(None, description="Step end time")
    duration_ms: Optional[int] = Field(None, description="Duration in milliseconds")
    message: Optional[str] = Field(None, description="Status message or error")
    assertions: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Assertion results"
    )
    artifacts: List[str] = Field(
        default_factory=list,
        description="Artifact file paths"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional step metadata"
    )


class RunRequest(BaseModel):
    """Request to start a new test run."""
    flow_name: str = Field(
        ...,
        description="Name of the flow to execute",
        min_length=1,
        max_length=100
    )
    env: str = Field(
        ...,
        description="Target environment (dev, staging, prod)",
        min_length=1,
        max_length=50
    )
    tenant: Optional[str] = Field(
        None,
        description="Target tenant/organization",
        max_length=100
    )
    project: Optional[str] = Field(
        None,
        description="Target project within tenant",
        max_length=100
    )
    variables: Dict[str, Any] = Field(
        default_factory=dict,
        description="Variables to pass to the flow"
    )
    tags: List[str] = Field(
        default_factory=list,
        description="Tags for categorization"
    )
    force_allow_prod: bool = Field(
        default=False,
        description="Force allow production execution (dangerous)"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "flow_name": "public-ip-allocation",
                "env": "staging",
                "tenant": "test-tenant-001",
                "project": "qa-automation",
                "variables": {
                    "testTenant": True,
                    "ipCount": 1,
                    "region": "us-east-1"
                },
                "tags": ["smoke", "ip-allocation"]
            }
        }


class RunResponse(BaseModel):
    """Response after creating a test run."""
    run_id: str = Field(..., description="Unique run identifier")
    flow_name: str = Field(..., description="Flow being executed")
    env: str = Field(..., description="Target environment")
    status: RunState = Field(..., description="Current run status")
    created_at: datetime = Field(..., description="Run creation time")
    message: str = Field(..., description="Status message")


class RunSummary(BaseModel):
    """Summary of a test run."""
    run_id: str = Field(..., description="Unique run identifier")
    flow_name: str = Field(..., description="Flow executed")
    env: str = Field(..., description="Target environment")
    tenant: Optional[str] = Field(None, description="Target tenant")
    project: Optional[str] = Field(None, description="Target project")
    status: RunState = Field(..., description="Current status")
    
    # Timing
    created_at: datetime = Field(..., description="Run creation time")
    started_at: Optional[datetime] = Field(None, description="Actual start time")
    completed_at: Optional[datetime] = Field(None, description="Completion time")
    duration_ms: Optional[int] = Field(None, description="Total duration in ms")
    
    # Results
    total_steps: int = Field(default=0, description="Total number of steps")
    passed_steps: int = Field(default=0, description="Passed steps count")
    failed_steps: int = Field(default=0, description="Failed steps count")
    skipped_steps: int = Field(default=0, description="Skipped steps count")
    
    # Step details
    steps: List[StepResult] = Field(
        default_factory=list,
        description="Individual step results"
    )
    
    # Artifacts
    artifacts: List[str] = Field(
        default_factory=list,
        description="Artifact file paths"
    )
    
    # Error info
    error: Optional[str] = Field(None, description="Error message if failed")
    
    # Metadata
    tags: List[str] = Field(default_factory=list, description="Run tags")
    variables: Dict[str, Any] = Field(
        default_factory=dict,
        description="Variables used (redacted)"
    )
    
    @property
    def success_rate(self) -> float:
        """Calculate success rate percentage."""
        if self.total_steps == 0:
            return 0.0
        return (self.passed_steps / self.total_steps) * 100


class RunStatus(BaseModel):
    """Current status of a run."""
    run_id: str
    status: RunState
    progress: int = Field(
        default=0,
        description="Progress percentage",
        ge=0,
        le=100
    )
    current_step: Optional[str] = Field(None, description="Currently executing step")
    message: Optional[str] = Field(None, description="Status message")


class RunListResponse(BaseModel):
    """List of runs."""
    runs: List[RunSummary]
    total: int
    page: int
    page_size: int

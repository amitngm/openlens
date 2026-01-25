"""
Health Check Models for Phase 1 Validation.

Defines schema for comprehensive health checks including:
- Pagination testing
- Search functionality
- Filter controls
- Table listing validation
- Sort functionality
"""

from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from enum import Enum


class HealthCheckType(str, Enum):
    """Types of health checks available."""
    PAGINATION = "pagination"
    SEARCH = "search"
    FILTERS = "filters"
    TABLE_LISTING = "table_listing"
    SORT = "sort"
    EXPORT = "export"


class HealthCheckStatus(str, Enum):
    """Status of a health check."""
    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


class HealthCheckResult(BaseModel):
    """Result of a single health check."""
    check_type: HealthCheckType
    status: HealthCheckStatus
    page_url: str
    page_title: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_ms: Optional[int] = None
    details: Dict[str, Any] = {}
    error: Optional[str] = None
    screenshot: Optional[str] = None


class PageHealthCheck(BaseModel):
    """Health check results for a single page."""
    page_url: str
    page_title: str
    page_type: str  # "listing", "detail", "form", "dashboard"
    checks: List[HealthCheckResult] = []
    overall_status: HealthCheckStatus = HealthCheckStatus.PENDING


class HealthCheckReport(BaseModel):
    """Complete health check report for a discovery run."""
    run_id: str
    started_at: str
    completed_at: Optional[str] = None
    total_pages: int
    pages_validated: int = 0
    total_checks: int = 0
    checks_passed: int = 0
    checks_failed: int = 0
    checks_skipped: int = 0
    pages: List[PageHealthCheck] = []

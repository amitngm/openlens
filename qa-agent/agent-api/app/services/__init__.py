"""Services for QA Agent."""

from app.services.run_store import RunStore
from app.services.browser_manager import BrowserManager, get_browser_manager
from app.services.session_checker import SessionChecker, get_session_checker
from app.services.login_detector import LoginDetector, get_login_detector
from app.services.login_executor import LoginExecutor, get_login_executor
from app.services.post_login_validator import PostLoginValidator, get_post_login_validator
from app.services.context_detector import ContextDetector, get_context_detector
from app.services.discovery_runner import DiscoveryRunner, get_discovery_runner
from app.services.discovery_summarizer import DiscoverySummarizer, get_discovery_summarizer
from app.services.test_plan_builder import TestPlanBuilder, get_test_plan_builder
from app.services.test_executor import TestExecutor, get_test_executor
from app.services.report_generator import ReportGenerator, get_report_generator
from app.services.image_analyzer import ImageAnalyzer, get_image_analyzer

__all__ = [
    "RunStore",
    "BrowserManager",
    "get_browser_manager",
    "SessionChecker",
    "get_session_checker",
    "LoginDetector",
    "get_login_detector",
    "LoginExecutor",
    "get_login_executor",
    "PostLoginValidator",
    "get_post_login_validator",
    "ContextDetector",
    "get_context_detector",
    "DiscoveryRunner",
    "get_discovery_runner",
    "DiscoverySummarizer",
    "get_discovery_summarizer",
    "TestPlanBuilder",
    "get_test_plan_builder",
    "TestExecutor",
    "get_test_executor",
    "ReportGenerator",
    "get_report_generator",
    "ImageAnalyzer",
    "get_image_analyzer"
]

"""Discovery summarizer service for generating discovery summaries."""

import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional

from app.models.run_state import RunState
from app.models.run_context import Question, QuestionOption

logger = logging.getLogger(__name__)


class DiscoverySummarizer:
    """Service for generating discovery summaries."""
    
    async def generate_summary(
        self,
        page,
        run_id: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """
        Generate discovery summary from discovery.json.
        
        Args:
            page: Playwright Page object (for screenshot)
            run_id: Run identifier
            artifacts_path: Path to artifacts directory
        
        Returns:
            Dict with:
                - summary: Dict with counts
                - next_state: RunState
                - question: Question for WAIT_TEST_INTENT
                - screenshot_path: str
        """
        try:
            discovery_dir = Path(artifacts_path)
            discovery_file = discovery_dir / "discovery.json"
            
            if not discovery_file.exists():
                logger.warning(f"[{run_id}] discovery.json not found, using empty summary")
                discovery_data = {}
            else:
                with open(discovery_file) as f:
                    discovery_data = json.load(f)
            
            # Generate summary counts
            pages = discovery_data.get("pages", [])
            forms_found = discovery_data.get("forms_found", [])
            api_endpoints = discovery_data.get("api_endpoints", [])
            network_stats = discovery_data.get("network_stats", {})
            
            # Count actions (forms with POST/PUT/DELETE)
            actions_count = len(forms_found)
            potential_crud_actions = 0
            
            for form in forms_found:
                method = form.get("method", "GET").upper()
                if method in ["POST", "PUT", "PATCH", "DELETE"]:
                    potential_crud_actions += 1
            
            # Also check API endpoints for CRUD
            for api in api_endpoints:
                method = api.get("method", "GET").upper()
                if method in ["POST", "PUT", "PATCH", "DELETE"]:
                    potential_crud_actions += 1
            
            # Network errors
            errors_4xx = network_stats.get("errors_4xx", 0)
            errors_5xx = network_stats.get("errors_5xx", 0)
            network_errors_count = errors_4xx + errors_5xx
            
            # Slow requests
            slow_requests = network_stats.get("slow_requests", [])
            slow_requests_count = len(slow_requests)
            
            # Build summary
            summary = {
                "pages_count": len(pages),
                "actions_count": actions_count,
                "forms_count": len(forms_found),
                "potential_crud_actions_count": potential_crud_actions,
                "network_errors_count": network_errors_count,
                "slow_requests_count": slow_requests_count
            }
            
            # Save summary to JSON file
            summary_file = discovery_dir / "discovery_summary.json"
            with open(summary_file, "w") as f:
                json.dump(summary, f, indent=2)
            
            logger.info(f"[{run_id}] Discovery summary generated: {summary}")
            
            # Capture screenshot
            screenshot_path = str(discovery_dir / "discovery_summary.png")
            try:
                await page.screenshot(path=screenshot_path)
            except:
                screenshot_path = None
            
            # Create question with counts in text
            question_text = (
                f"Discovery complete. Found {summary['pages_count']} pages, "
                f"{summary['forms_count']} forms, {summary['potential_crud_actions_count']} CRUD actions. "
                f"What should I test now?"
            )
            
            question = Question(
                id="test_intent",
                type="select_one",
                text=question_text,
                options=[
                    QuestionOption(id="smoke", label="smoke"),
                    QuestionOption(id="crud_sanity", label="crud_sanity"),
                    QuestionOption(id="module_based", label="module_based"),
                    QuestionOption(id="exploratory_15m", label="exploratory_15m")
                ],
                screenshot_path=screenshot_path if screenshot_path and Path(screenshot_path).exists() else None
            )
            
            return {
                "summary": summary,
                "next_state": RunState.DONE,  # Go directly to DONE, no interactive prompts
                "question": None,  # No question needed
                "screenshot_path": screenshot_path
            }
        
        except Exception as e:
            logger.error(f"[{run_id}] Summary generation failed: {e}", exc_info=True)
            # Default summary on error
            summary = {
                "pages_count": 0,
                "actions_count": 0,
                "forms_count": 0,
                "potential_crud_actions_count": 0,
                "network_errors_count": 0,
                "slow_requests_count": 0
            }
            
            # Save default summary
            discovery_dir = Path(artifacts_path)
            discovery_dir.mkdir(parents=True, exist_ok=True)
            summary_file = discovery_dir / "discovery_summary.json"
            with open(summary_file, "w") as f:
                json.dump(summary, f, indent=2)
            
            # Create question
            question = Question(
                id="test_intent",
                type="select_one",
                text="Discovery complete. What should I test now?",
                options=[
                    QuestionOption(id="smoke", label="smoke"),
                    QuestionOption(id="crud_sanity", label="crud_sanity"),
                    QuestionOption(id="module_based", label="module_based"),
                    QuestionOption(id="exploratory_15m", label="exploratory_15m")
                ]
            )
            
            return {
                "summary": summary,
                "next_state": RunState.DONE,  # Go directly to DONE on error too
                "question": None,  # No question needed
                "screenshot_path": None
            }


# Global discovery summarizer instance
_discovery_summarizer = DiscoverySummarizer()


def get_discovery_summarizer() -> DiscoverySummarizer:
    """Get global discovery summarizer instance."""
    return _discovery_summarizer

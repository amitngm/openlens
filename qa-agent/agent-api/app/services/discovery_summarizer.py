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
            
            # Aggregate ui_features across all discovered pages
            aggregated_features: Dict[str, Any] = {}
            for page_entry in pages:
                page_ui_feats = page_entry.get("ui_features", {})
                for feat_key, feat_val in page_ui_feats.items():
                    if feat_val.get("detected"):
                        if feat_key not in aggregated_features:
                            aggregated_features[feat_key] = {"detected": True, "page_count": 0}
                        aggregated_features[feat_key]["page_count"] += 1

            # Build summary
            summary = {
                "pages_count": len(pages),
                "actions_count": actions_count,
                "forms_count": len(forms_found),
                "potential_crud_actions_count": potential_crud_actions,
                "network_errors_count": network_errors_count,
                "slow_requests_count": slow_requests_count,
                "detected_features": aggregated_features,
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
            
            # Build a human-readable list of what was found
            found_parts = [f"{summary['pages_count']} pages"]
            if summary['forms_count'] > 0:
                found_parts.append(f"{summary['forms_count']} forms")
            if summary['potential_crud_actions_count'] > 0:
                found_parts.append(f"{summary['potential_crud_actions_count']} create/edit actions")
            found_summary = ", ".join(found_parts)

            question_text = (
                f"I explored your app and found: {found_summary}. "
                f"What would you like me to test?"
            )

            question = Question(
                id="test_intent",
                type="select_one",
                text=question_text,
                options=[
                    QuestionOption(
                        id="everything",
                        label="🚀 Test everything",
                        description="DOM-wide coverage: listings, navigation, create/update flows, and delete where discovered (destructive steps may ask for confirmation)"
                    ),
                    QuestionOption(
                        id="write_focus",
                        label="📝 Forms & creation only",
                        description="Focus on Create/Edit/Submit flows — fill forms, verify success & errors; includes delete when the UI exposes it"
                    ),
                    QuestionOption(
                        id="read_only",
                        label="👁️ Read only",
                        description="Navigation, search, filters, listings — no writes"
                    ),
                    QuestionOption(
                        id="quick_smoke",
                        label="⚡ Quick smoke",
                        description="Just verify key pages load and respond correctly"
                    ),
                ],
                screenshot_path=screenshot_path if screenshot_path and Path(screenshot_path).exists() else None
            )

            return {
                "summary": summary,
                "next_state": RunState.WAIT_TEST_INTENT,
                "question": question,
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
                "slow_requests_count": 0,
                "detected_features": {},
            }
            
            # Save default summary
            discovery_dir = Path(artifacts_path)
            discovery_dir.mkdir(parents=True, exist_ok=True)
            summary_file = discovery_dir / "discovery_summary.json"
            with open(summary_file, "w") as f:
                json.dump(summary, f, indent=2)
            
            question = Question(
                id="test_intent",
                type="select_one",
                text="Discovery complete. What would you like me to test?",
                options=[
                    QuestionOption(id="everything", label="🚀 Test everything", description="Full DOM-driven coverage including create/update/delete where found"),
                    QuestionOption(id="write_focus", label="📝 Forms & creation only", description="Create/Edit/Submit; delete when buttons are discovered"),
                    QuestionOption(id="read_only", label="👁️ Read only", description="Navigation, search, filters — no writes"),
                    QuestionOption(id="quick_smoke", label="⚡ Quick smoke", description="Verify key pages load correctly"),
                ]
            )

            return {
                "summary": summary,
                "next_state": RunState.WAIT_TEST_INTENT,
                "question": question,
                "screenshot_path": None
            }


# Global discovery summarizer instance
_discovery_summarizer = DiscoverySummarizer()


def get_discovery_summarizer() -> DiscoverySummarizer:
    """Get global discovery summarizer instance."""
    return _discovery_summarizer

"""AI-powered test case generation service."""

import json
import logging
from typing import Dict, List, Any, Optional

from app.services.ai.llm_provider import LLMProvider

logger = logging.getLogger(__name__)

# JSON schema for test case generation
TEST_CASE_SCHEMA = {
    "type": "object",
    "properties": {
        "test_cases": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "type": {"type": "string"},
                    "priority": {"type": "string"},
                    "steps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "action": {"type": "string"},
                                "target": {"type": "string"},
                                "value": {"type": "string"},
                                "description": {"type": "string"}
                            }
                        }
                    },
                    "expected_result": {"type": "string"}
                },
                "required": ["id", "name", "steps"]
            }
        }
    },
    "required": ["test_cases"]
}


class TestCaseAIGenerator:
    """AI-powered test case generation from discovery data."""
    
    def __init__(self, llm_provider: LLMProvider):
        """
        Initialize AI test case generator.
        
        Args:
            llm_provider: LLM provider instance
        """
        self.provider = llm_provider
    
    async def generate_from_discovery(
        self, 
        discovery_data: Dict[str, Any],
        page_info: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Generate test cases using AI from discovery data.
        
        Args:
            discovery_data: Full discovery data
            page_info: Specific page information
            
        Returns:
            List of generated test cases
        """
        try:
            prompt = self._build_test_generation_prompt(discovery_data, page_info)
            
            response = await self.provider.generate_structured(
                prompt=prompt,
                schema=TEST_CASE_SCHEMA,
                system_prompt=self._get_system_prompt()
            )
            
            test_cases = response.get("test_cases", [])
            logger.info(f"AI generated {len(test_cases)} test cases")
            return test_cases
        
        except Exception as e:
            logger.error(f"AI test case generation failed: {e}", exc_info=True)
            # Return empty list on error - fallback to rule-based
            return []
    
    def _build_test_generation_prompt(
        self, 
        discovery_data: Dict[str, Any],
        page_info: Dict[str, Any]
    ) -> str:
        """Build prompt for test case generation."""
        page_url = page_info.get("url", "")
        page_name = page_info.get("page_signature", {}).get("page_name", "Unknown Page")
        
        # Extract key features
        has_tables = len(page_info.get("tables", [])) > 0
        has_forms = len(page_info.get("forms", [])) > 0
        has_search = self._detect_search(page_info)
        has_filters = self._detect_filters(page_info)
        has_pagination = self._detect_pagination(page_info)
        
        prompt = f"""Generate comprehensive test cases for the following web page:

Page Information:
- URL: {page_url}
- Name: {page_name}
- Has Tables: {has_tables}
- Has Forms: {has_forms}
- Has Search: {has_search}
- Has Filters: {has_filters}
- Has Pagination: {has_pagination}

Page Signature:
{json.dumps(page_info.get("page_signature", {}), indent=2)}

Generate test cases that cover:
1. Navigation and page load
2. All interactive features (search, filters, pagination)
3. Form submissions (if forms exist)
4. Data validation
5. Error handling
6. Edge cases

For each test case, provide:
- Unique ID (e.g., TC_AI_001)
- Descriptive name
- Clear description
- Step-by-step actions
- Expected results

Focus on practical, executable test cases that can be automated.
"""
        return prompt
    
    def _get_system_prompt(self) -> str:
        """Get system prompt for test case generation."""
        return """You are an expert QA automation engineer. Generate comprehensive, 
executable test cases for web applications. Focus on:
- Clear, actionable test steps
- Proper selectors and actions
- Realistic test data
- Edge cases and error scenarios
- Maintainability and reusability

Always provide test cases in the requested JSON format."""
    
    def _detect_search(self, page_info: Dict[str, Any]) -> bool:
        """Detect if page has search functionality."""
        page_sig = page_info.get("page_signature", {})
        for action in page_sig.get("primary_actions", []):
            if "search" in action.get("text", "").lower():
                return True
        return False
    
    def _detect_filters(self, page_info: Dict[str, Any]) -> bool:
        """Detect if page has filter functionality."""
        page_sig = page_info.get("page_signature", {})
        forms = page_sig.get("forms", [])
        for form in forms:
            for field in form.get("fields", []):
                if "filter" in field.get("name", "").lower():
                    return True
        return False
    
    def _detect_pagination(self, page_info: Dict[str, Any]) -> bool:
        """Detect if page has pagination."""
        page_sig = page_info.get("page_signature", {})
        for action in page_sig.get("primary_actions", []):
            action_text = action.get("text", "").lower()
            if action_text in ["next", "previous", "prev", "page"]:
                return True
        return False

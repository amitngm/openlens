"""Context detection service for detecting tenant/project/cell selectors."""

import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Set
import re

from app.models.run_state import RunState
from app.models.run_context import Question, QuestionOption

logger = logging.getLogger(__name__)


class ContextDetector:
    """Service for detecting context selectors (tenant/project/cell)."""
    
    # Keywords to look for in element attributes/text
    CONTEXT_KEYWORDS = [
        "tenant", "project", "cell", "workspace", "org", "organization",
        "environment", "env", "region", "zone", "namespace"
    ]
    
    # Selector patterns for context elements
    SELECTOR_PATTERNS = [
        "select[name*='tenant']",
        "select[name*='project']",
        "select[name*='cell']",
        "select[name*='workspace']",
        "select[name*='org']",
        "select[id*='tenant']",
        "select[id*='project']",
        "select[id*='cell']",
        "select[id*='workspace']",
        "select[id*='org']",
        "[data-tenant]",
        "[data-project]",
        "[data-cell]",
        "[data-workspace]",
        "[data-org]",
        ".tenant-selector",
        ".project-selector",
        ".cell-selector",
        ".workspace-selector",
        ".org-selector"
    ]
    
    async def detect_context(
        self,
        page,
        run_id: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """
        Detect tenant/project/cell selector and extract options.
        
        Args:
            page: Playwright Page object
            run_id: Run identifier
            artifacts_path: Path to artifacts directory
        
        Returns:
            Dict with:
                - has_context: bool
                - options: List[str] (distinct option labels)
                - next_state: RunState
                - question: Optional[Question] (if multiple options)
                - screenshot_path: str
        """
        try:
            # Capture screenshot
            artifacts_dir = Path(artifacts_path)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            screenshot_path = str(artifacts_dir / "context_detect.png")
            await page.screenshot(path=screenshot_path)
            logger.info(f"[{run_id}] Screenshot saved: {screenshot_path}")
            
            # Step 1: Find context-related elements
            context_elements = await self._find_context_elements(page)
            logger.info(f"[{run_id}] Found {len(context_elements)} context-related elements")
            
            # Step 2: Extract options from dropdowns/selects
            options = await self._extract_options(page, context_elements)
            logger.info(f"[{run_id}] Extracted {len(options)} distinct options: {options[:5]}...")
            
            # Limit to 25 options
            if len(options) > 25:
                options = options[:25]
                logger.warning(f"[{run_id}] Limited options to 25 (had {len(options)})")
            
            # Step 3: Determine next state
            if len(options) > 1:
                # Multiple options - ask user to select
                logger.info(f"[{run_id}] Multiple contexts detected ({len(options)} options) - asking user")
                question_options = [
                    QuestionOption(id=opt.lower().replace(" ", "_"), label=opt)
                    for opt in options
                ]
                
                question = Question(
                    id="context_select",
                    type="select_one",
                    text="Multiple contexts detected. Which tenant/project/cell should I test?",
                    options=question_options,
                    screenshot_path=screenshot_path
                )
                
                return {
                    "has_context": True,
                    "options": options,
                    "next_state": RunState.WAIT_CONTEXT_INPUT,
                    "question": question,
                    "screenshot_path": screenshot_path
                }
            else:
                # Single or no options - proceed with default
                selected_context = options[0] if options else None
                logger.info(f"[{run_id}] Single or no context detected - proceeding with: {selected_context}")
                
                return {
                    "has_context": len(options) > 0,
                    "options": options,
                    "next_state": RunState.DISCOVERY_RUN,
                    "question": None,
                    "selected_context": selected_context,
                    "screenshot_path": screenshot_path
                }
        
        except Exception as e:
            logger.error(f"[{run_id}] Context detection failed: {e}", exc_info=True)
            # On error, default to proceeding without context
            artifacts_dir = Path(artifacts_path)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            screenshot_path = str(artifacts_dir / "context_detect_error.png")
            try:
                await page.screenshot(path=screenshot_path)
            except:
                pass
            
            return {
                "has_context": False,
                "options": [],
                "next_state": RunState.DISCOVERY_RUN,
                "question": None,
                "selected_context": None,
                "screenshot_path": screenshot_path
            }
    
    async def _find_context_elements(self, page) -> List[str]:
        """Find elements that might be context selectors."""
        elements = []
        
        # Try selector patterns
        for selector in self.SELECTOR_PATTERNS:
            try:
                count = await page.locator(selector).count()
                if count > 0:
                    elements.append(selector)
                    logger.debug(f"Found context element: {selector}")
            except:
                continue
        
        # Also search for elements with keywords in attributes/text
        for keyword in self.CONTEXT_KEYWORDS:
            try:
                # Search by attribute
                attr_selectors = [
                    f"[name*='{keyword}']",
                    f"[id*='{keyword}']",
                    f"[class*='{keyword}']",
                    f"[data-{keyword}]"
                ]
                for attr_sel in attr_selectors:
                    count = await page.locator(attr_sel).count()
                    if count > 0 and attr_sel not in elements:
                        elements.append(attr_sel)
            except:
                continue
        
        return elements
    
    async def _extract_options(self, page, context_elements: List[str]) -> List[str]:
        """Extract option labels from context elements."""
        options: Set[str] = set()
        
        for selector in context_elements:
            try:
                # Try as select element
                count = await page.locator(selector).count()
                if count > 0:
                    element = page.locator(selector).first
                    
                    # Check if it's a select element
                    tag_name = await element.evaluate("el => el.tagName.toLowerCase()")
                    
                    if tag_name == "select":
                        # Extract option labels
                        option_elements = element.locator("option")
                        option_count = await option_elements.count()
                        
                        for i in range(min(option_count, 30)):  # Limit per element
                            try:
                                option = option_elements.nth(i)
                                label = await option.inner_text()
                                value = await option.get_attribute("value")
                                
                                # Use label if available, otherwise value
                                text = label.strip() if label and label.strip() else (value or "").strip()
                                
                                if text and text not in ["", "Select...", "Choose...", "--"]:
                                    options.add(text)
                            except:
                                continue
                    
                    elif tag_name in ["div", "ul", "nav", "menu"]:
                        # Try to find child options/items
                        child_selectors = [
                            "option",
                            "li",
                            "a",
                            "[role='option']",
                            "[role='menuitem']",
                            ".option",
                            ".item"
                        ]
                        
                        for child_sel in child_selectors:
                            try:
                                children = element.locator(child_sel)
                                child_count = await children.count()
                                
                                for i in range(min(child_count, 30)):
                                    try:
                                        child = children.nth(i)
                                        text = await child.inner_text()
                                        if text and text.strip():
                                            text_clean = text.strip()
                                            # Filter out common non-option text
                                            if text_clean not in ["", "Select...", "Choose...", "--", "Menu"]:
                                                options.add(text_clean)
                                    except:
                                        continue
                            except:
                                continue
                    
                    # Also check if element itself has text
                    try:
                        text = await element.inner_text()
                        if text and text.strip():
                            text_clean = text.strip()
                            # Only add if it looks like an option (short text)
                            if len(text_clean) < 50 and text_clean not in ["", "Select...", "Choose..."]:
                                options.add(text_clean)
                    except:
                        pass
            
            except Exception as e:
                logger.debug(f"Error extracting options from {selector}: {e}")
                continue
        
        # Convert to sorted list and filter
        options_list = sorted(list(options))
        
        # Filter out very short or very long options (likely not valid)
        filtered = [
            opt for opt in options_list
            if 2 <= len(opt) <= 100 and not opt.lower().startswith("http")
        ]
        
        return filtered


# Global context detector instance
_context_detector = ContextDetector()


def get_context_detector() -> ContextDetector:
    """Get global context detector instance."""
    return _context_detector

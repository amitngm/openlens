"""Discovery runner service for crawling navigation and capturing page information with live event streaming."""

import json
import logging
import asyncio
import hashlib
from pathlib import Path
from typing import Dict, Any, List, Set, Optional
from datetime import datetime
from urllib.parse import urlparse, urljoin

from app.models.run_state import RunState

logger = logging.getLogger(__name__)


class DiscoveryConfig:
    """Configuration for discovery behavior."""
    def __init__(
        self,
        max_pages: int = 2000,  # Increased from 500 to 2000 for thorough discovery
        max_forms_per_page: int = 50,  # Increased from 20 to 50
        max_table_rows_to_click: int = 50,  # Increased from 10 to 50
        max_pagination_pages: Optional[int] = None,  # None = unlimited
        max_contexts_to_explore: Optional[int] = None,  # None = explore ALL
        max_discovery_time_minutes: int = 60,  # Increased from 30 to 60 minutes
        max_recursion_depth: int = 10,  # Increased from 5 to 10
        enable_form_submission: bool = True,
        enable_table_row_clicking: bool = True,
        enable_context_switching: bool = True,
        enable_api_sanity_tests: bool = True,
        ask_before_destructive_forms: bool = True
    ):
        self.max_pages = max_pages
        self.max_forms_per_page = max_forms_per_page
        self.max_table_rows_to_click = max_table_rows_to_click
        self.max_pagination_pages = max_pagination_pages
        self.max_contexts_to_explore = max_contexts_to_explore
        self.max_discovery_time_minutes = max_discovery_time_minutes
        self.max_recursion_depth = max_recursion_depth
        self.enable_form_submission = enable_form_submission
        self.enable_table_row_clicking = enable_table_row_clicking
        self.enable_context_switching = enable_context_switching
        self.enable_api_sanity_tests = enable_api_sanity_tests
        self.ask_before_destructive_forms = ask_before_destructive_forms


class DiscoveryRunner:
    """Service for running discovery on a logged-in session with live event streaming."""

    # Sidebar/navigation container selectors
    SIDEBAR_SELECTORS = [
        "nav",
        "aside",
        "[role='navigation']",
        ".sidebar",
        ".nav-sidebar",
        ".menu-container",
        ".navigation"
    ]
    
    # Menu item selectors (both links and buttons)
    MENU_ITEM_SELECTORS = [
        "nav a",
        "nav button",
        "aside a",
        "aside button",
        "[role='navigation'] a",
        "[role='navigation'] button",
        ".sidebar a",
        ".sidebar button",
        ".menu-item",
        ".nav-item",
        ".nav-link",
        "[role='menuitem']"
    ]
    
    # Submenu indicators
    SUBMENU_INDICATORS = [
        "[aria-expanded]",
        ".submenu",
        ".sub-menu",
        ".dropdown-menu",
        "[role='menu']"
    ]
    
    # Top dropdown/context selector triggers
    DROPDOWN_TRIGGER_SELECTORS = [
        "[role='combobox']",
        "[aria-haspopup='true']",
        "[aria-haspopup='listbox']",
        "button[aria-expanded]",
        ".dropdown-toggle",
        ".select-trigger",
        "select"
    ]
    
    # Destructive action keywords (to avoid clicking)
    DESTRUCTIVE_KEYWORDS = [
        "delete", "remove", "purge", "destroy", "clear",
        "trash", "archive", "deactivate", "disable"
    ]
    
    def __init__(self, config: Optional[DiscoveryConfig] = None):
        """Initialize discovery runner."""
        self.config = config or DiscoveryConfig()
        self.event_writers: Dict[str, Any] = {}  # run_id -> file handle
        self.trace_writers: Dict[str, Any] = {}  # run_id -> file handle
        self.trace_step_no: Dict[str, int] = {}  # run_id -> step counter
        self.modal_forms: Dict[str, List[Dict]] = {}  # run_id -> list of forms from modals
    
    def _get_event_writer(self, run_id: str, artifacts_path: str):
        """Get or create event writer for a run."""
        if run_id not in self.event_writers:
            events_file = Path(artifacts_path) / "events.jsonl"
            self.event_writers[run_id] = open(events_file, "a", encoding="utf-8")
        return self.event_writers[run_id]
    
    def _emit_event(self, run_id: str, artifacts_path: str, event_type: str, data: Dict[str, Any]):
        """Emit a discovery event to the events.jsonl file."""
        try:
            event = {
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "type": event_type,
                "data": data
            }
            writer = self._get_event_writer(run_id, artifacts_path)
            writer.write(json.dumps(event, default=str) + "\n")
            writer.flush()
        except Exception as e:
            logger.warning(f"[{run_id}] Failed to emit event: {e}")

    def _get_trace_writer(self, run_id: str, artifacts_path: str):
        """Get or create discovery trace writer for a run."""
        if run_id not in self.trace_writers:
            trace_file = Path(artifacts_path) / "discovery_trace.jsonl"
            self.trace_writers[run_id] = open(trace_file, "a", encoding="utf-8")
            self.trace_step_no[run_id] = 0
        return self.trace_writers[run_id]

    async def _take_trace_screenshot(self, page, discovery_dir: Path, prefix: str, step_no: int) -> Optional[str]:
        """Take a screenshot for trace debugging. Returns relative path within discovery_dir."""
        try:
            screenshots_dir = discovery_dir / "trace_screens"
            screenshots_dir.mkdir(parents=True, exist_ok=True)
            path = screenshots_dir / f"{step_no:04d}_{prefix}.png"
            await page.screenshot(path=str(path))
            return str(path.relative_to(discovery_dir))
        except Exception:
            return None

    async def _trace_step(
        self,
        *,
        run_id: str,
        artifacts_path: str,
        discovery_dir: Path,
        debug: bool,
        action: str,
        element_text: str = "",
        element_role_or_tag: str = "",
        selector_hint: str = "",
        before_url: str = "",
        after_url: str = "",
        before_heading: str = "",
        after_heading: str = "",
        nav_item_count_before: Optional[int] = None,
        nav_item_count_after: Optional[int] = None,
        screenshot_before_path: Optional[str] = None,
        screenshot_after_path: Optional[str] = None,
        result: str = "no_change",
        error: Optional[str] = None,
    ) -> int:
        """Write a debug trace step to discovery_trace.jsonl. Returns step number."""
        if not debug:
            return 0
        writer = self._get_trace_writer(run_id, artifacts_path)
        self.trace_step_no[run_id] = self.trace_step_no.get(run_id, 0) + 1
        step_no = self.trace_step_no[run_id]
        rec = {
            "ts": datetime.utcnow().isoformat() + "Z",
            "step_no": step_no,
            "action": action,
            "element_text": element_text[:200],
            "element_role_or_tag": element_role_or_tag[:100],
            "selector_hint": selector_hint[:200],
            "before_url": before_url,
            "after_url": after_url,
            "before_heading": before_heading[:200],
            "after_heading": after_heading[:200],
            "nav_item_count_before": nav_item_count_before,
            "nav_item_count_after": nav_item_count_after,
            "screenshot_before_path": screenshot_before_path,
            "screenshot_after_path": screenshot_after_path,
            "result": result,
        }
        if error:
            rec["error"] = error[:300]
        writer.write(json.dumps(rec, default=str) + "\n")
        writer.flush()
        return step_no

    def _normalize_url(self, url: str) -> str:
        """Normalize URL for consistent comparison - improved to handle more cases."""
        from urllib.parse import urlparse, parse_qs, urlencode

        try:
            parsed = urlparse(url)

            # Remove fragment
            normalized = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"

            # Normalize trailing slash (keep root /, remove others)
            if normalized.endswith('/') and len(parsed.path) > 1:
                normalized = normalized[:-1]

            # Sort query parameters for consistent comparison
            # Also remove common tracking/analytics params that don't affect page content
            tracking_params = ['utm_source', 'utm_medium', 'utm_campaign', '_ga', '_gid', 'ref', 'source']
            if parsed.query:
                params = parse_qs(parsed.query, keep_blank_values=True)
                # Remove tracking params
                for key in tracking_params:
                    params.pop(key, None)
                if params:
                    sorted_query = urlencode(sorted(params.items()), doseq=True)
                    normalized += f"?{sorted_query}"

            return normalized.lower()
        except Exception as e:
            # If normalization fails, return original URL
            logger.warning(f"URL normalization failed for {url}: {e}")
            return url.lower()

    def _create_fingerprint(self, nav_path: str, url: str, heading: str) -> str:
        """Create a fingerprint for visited pages to avoid loops."""
        # Normalize URL by replacing numeric IDs with placeholder
        # This helps detect similar pages like /user/123 and /user/456
        import re
        normalized_url = re.sub(r'/\d+(/|$)', '/{id}/', url)
        normalized_url = re.sub(r'[?&]id=\d+', '?id={id}', normalized_url)
        normalized_url = re.sub(r'[?&]uuid=[a-f0-9-]+', '?uuid={uuid}', normalized_url)

        # Exclude nav_path from fingerprint to prevent same page being "discovered" via different paths
        combined = f"{normalized_url}|{heading}"
        return hashlib.md5(combined.encode()).hexdigest()

    async def _dom_sig(self, page) -> str:
        """DOM signature for page change detection (works even for SPA URLs)."""
        try:
            payload = await page.evaluate(
                "() => {"
                "  const h = (document.querySelector('h1')?.innerText || document.querySelector('h2')?.innerText || '').trim();"
                "  const bc = (document.querySelector('.breadcrumb')?.innerText || document.querySelector('[aria-label*=breadcrumb i]')?.innerText || '').trim();"
                "  const main = (document.querySelector('main')?.innerText || document.body?.innerText || '').trim();"
                "  return (h + '|' + bc + '|' + main.slice(0, 1500));"
                "}"
            )
            return hashlib.md5(payload.encode("utf-8", errors="ignore")).hexdigest()
        except Exception:
            return ""

    async def _heading_sig(self, page) -> str:
        """Best-effort heading/breadcrumb signature for page change detection."""
        try:
            sig = await self._get_page_signature(page)
            return sig.get("page_name") or sig.get("heading") or sig.get("breadcrumb") or ""
        except Exception:
            return ""

    async def _instrumented_action(
        self,
        *,
        run_id: str,
        artifacts_path: str,
        discovery_dir: Path,
        debug: bool,
        page,
        action: str,
        do: "callable",
        element_text: str = "",
        element_role_or_tag: str = "",
        selector_hint: str = "",
        nav_item_count_before: Optional[int] = None,
        nav_item_count_after: Optional[int] = None,
        forms_found: Optional[List[Dict]] = None,
    ) -> Dict[str, Any]:
        """
        Wrap any discovery action (click/hover/expand/navigate/scan) with trace:
        - screenshots before/after
        - before/after url + heading + dom_sig
        - result classification
        """
        before_url = page.url
        before_heading = await self._heading_sig(page)
        before_dom = await self._dom_sig(page)

        step_no = self.trace_step_no.get(run_id, 0) + 1
        ss_before = await self._take_trace_screenshot(page, discovery_dir, f"before_{action}", step_no) if debug else None
        error = None
        try:
            await do()
        except Exception as e:
            error = str(e)

        # wait a bit for SPA updates
        try:
            await page.wait_for_load_state("networkidle", timeout=5000)
        except Exception:
            pass
        await asyncio.sleep(0.6)

        after_url = page.url
        after_heading = await self._heading_sig(page)
        after_dom = await self._dom_sig(page)
        ss_after = await self._take_trace_screenshot(page, discovery_dir, f"after_{action}", step_no) if debug else None

        if error:
            result = "error"
        elif after_url != before_url or after_heading != before_heading or after_dom != before_dom:
            # distinguish submenu vs page change
            if nav_item_count_after is not None and nav_item_count_before is not None and nav_item_count_after > nav_item_count_before:
                result = "submenu_revealed"
            else:
                result = "page_changed"
        else:
            result = "no_change"

        await self._trace_step(
            run_id=run_id,
            artifacts_path=artifacts_path,
            discovery_dir=discovery_dir,
            debug=debug,
            action=action,
            element_text=element_text,
            element_role_or_tag=element_role_or_tag,
            selector_hint=selector_hint,
            before_url=before_url,
            after_url=after_url,
            before_heading=before_heading,
            after_heading=after_heading,
            nav_item_count_before=nav_item_count_before,
            nav_item_count_after=nav_item_count_after,
            screenshot_before_path=ss_before,
            screenshot_after_path=ss_after,
            result=result,
            error=error,
        )

        # Check for modal/dialog/drawer after click
        modal_data = None
        if action in ["click", "expand"] and not error:
            modal_forms_list = []
            modal_data = await self._detect_and_explore_modal(
                page=page,
                run_id=run_id,
                artifacts_path=artifacts_path,
                discovery_dir=discovery_dir,
                debug=debug,
                forms_found=modal_forms_list
            )
            if modal_data and modal_data.get("found"):
                result = "modal_opened"
                # Store modal forms for this run (will be merged into discovery result)
                if run_id not in self.modal_forms:
                    self.modal_forms[run_id] = []
                self.modal_forms[run_id].extend(modal_forms_list)
                # Also add to forms_found if provided
                if forms_found is not None:
                    forms_found.extend(modal_forms_list)
                
                # Emit event for modal discovery
                self._emit_event(run_id, artifacts_path, "modal_discovered", {
                    "title": modal_data.get("title", ""),
                    "forms_count": len(modal_data.get("forms", [])),
                    "tables_count": len(modal_data.get("tables", [])),
                    "actions_count": len(modal_data.get("actions", [])),
                    "tabs": modal_data.get("tabs", []),
                    "closed": modal_data.get("closed", False)
                })
        
        return {
            "error": error,
            "before_url": before_url,
            "after_url": after_url,
            "before_heading": before_heading,
            "after_heading": after_heading,
            "before_dom": before_dom,
            "after_dom": after_dom,
            "result": result,
            "modal_data": modal_data,
        }
    
    async def _detect_and_explore_modal(
        self,
        page,
        run_id: str,
        artifacts_path: str,
        discovery_dir: Path,
        debug: bool,
        forms_found: List[Dict]
    ) -> Optional[Dict[str, Any]]:
        """
        Detect if a modal/dialog/drawer opened after a click, explore inside it,
        extract forms/tables, then close it.
        
        Returns:
            Dict with modal info and extracted data, or None if no modal found
        """
        try:
            # Modal/dialog/drawer selectors
            modal_selectors = [
                "[role='dialog']",
                "[role='alertdialog']",
                ".modal",
                ".modal-dialog",
                ".modal-content",
                ".drawer",
                ".drawer-content",
                ".dialog",
                ".dialog-content",
                "[class*='modal']",
                "[class*='dialog']",
                "[class*='drawer']",
                "[aria-modal='true']"
            ]
            
            modal_element = None
            for selector in modal_selectors:
                try:
                    modal = page.locator(selector).first
                    if await modal.count() > 0:
                        # Check if modal is visible
                        is_visible = await modal.is_visible()
                        if is_visible:
                            modal_element = modal
                            break
                except:
                    continue
            
            if not modal_element:
                return None
            
            logger.info(f"[{run_id}] Modal/dialog detected, exploring...")
            
            # Get modal title/heading
            modal_title = ""
            try:
                title_selectors = [
                    ".modal-title",
                    ".dialog-title",
                    ".drawer-title",
                    "h1", "h2", "h3",
                    "[role='heading']"
                ]
                for sel in title_selectors:
                    title_elem = modal_element.locator(sel).first
                    if await title_elem.count() > 0:
                        modal_title = (await title_elem.inner_text()).strip()
                        if modal_title:
                            break
            except:
                pass
            
            # Initialize modal_forms early so tab forms can be added
            modal_forms = []
            
            # Explore tabs inside modal - comprehensive discovery
            tabs_found = []
            tab_forms = []  # Forms found in each tab
            try:
                # Multiple selectors for tabs (including tab panels, tab lists, etc.)
                tab_selectors = [
                    "[role='tab']",
                    "[role='tablist'] [role='tab']",  # Tabs within tablist
                    ".tab",
                    ".tab-item",
                    ".tab-button",
                    "[class*='tab']",
                    "[class*='Tab']",
                    "button[class*='tab']",
                    "a[class*='tab']",
                    "[data-tab]",
                    "[aria-controls]",  # Elements that control tab panels
                ]
                
                all_tabs = []
                for sel in tab_selectors:
                    try:
                        tabs = modal_element.locator(sel)
                        count = await tabs.count()
                        for i in range(count):
                            try:
                                tab = tabs.nth(i)
                                if not await tab.is_visible():
                                    continue
                                tab_text = (await tab.inner_text()).strip()
                                tab_id = await tab.evaluate("el => el.id || ''")
                                aria_controls = await tab.get_attribute("aria-controls") or ""
                                
                                # Create unique identifier
                                tab_key = f"{tab_text}:{tab_id}:{aria_controls}"
                                if tab_key not in [t.get("key") for t in all_tabs]:
                                    all_tabs.append({
                                        "element": tab,
                                        "text": tab_text,
                                        "key": tab_key,
                                        "aria_controls": aria_controls
                                    })
                            except:
                                continue
                    except:
                        continue
                
                logger.info(f"[{run_id}] Found {len(all_tabs)} tabs in modal")
                
                # Click each tab and extract content
                for idx, tab_info in enumerate(all_tabs):
                    try:
                        tab = tab_info["element"]
                        tab_text = tab_info["text"]
                        
                        if not tab_text:
                            continue
                        
                        tabs_found.append(tab_text)
                        
                        # Click tab to reveal content
                        try:
                            await tab.click(timeout=3000)
                            await asyncio.sleep(0.8)  # Wait for tab content to load
                            
                            # Wait for tab panel to be visible/active
                            if tab_info["aria_controls"]:
                                try:
                                    panel = modal_element.locator(f"#{tab_info['aria_controls']}, [id='{tab_info['aria_controls']}']").first
                                    if await panel.count() > 0:
                                        await panel.wait_for(state="visible", timeout=2000)
                                except:
                                    pass
                            
                            # Extract forms from this tab's content
                            try:
                                # Find the active tab panel
                                tab_panel_selectors = [
                                    f"#{tab_info['aria_controls']}" if tab_info["aria_controls"] else None,
                                    "[role='tabpanel'][aria-hidden='false']",
                                    "[role='tabpanel']:not([aria-hidden='true'])",
                                    ".tab-panel.active",
                                    ".tab-content.active",
                                    "[class*='tab-panel']:not([class*='hidden'])",
                                    "[class*='tab-content']:not([class*='hidden'])",
                                ]
                                
                                tab_panel = None
                                for panel_sel in tab_panel_selectors:
                                    if not panel_sel:
                                        continue
                                    try:
                                        panel = modal_element.locator(panel_sel).first
                                        if await panel.count() > 0 and await panel.is_visible():
                                            tab_panel = panel
                                            break
                                    except:
                                        continue
                                
                                # If no specific panel found, use modal element itself
                                if not tab_panel:
                                    tab_panel = modal_element
                                
                                # Extract forms from tab panel
                                forms_in_tab = tab_panel.locator("form")
                                form_count = await forms_in_tab.count()
                                
                                for form_idx in range(min(form_count, 10)):
                                    try:
                                        form = forms_in_tab.nth(form_idx)
                                        action = await form.get_attribute("action") or ""
                                        method = await form.get_attribute("method") or "GET"
                                        fields = await self._get_form_fields(form)
                                        
                                        if fields or action:
                                            tab_form = {
                                                "action": action,
                                                "method": method.upper(),
                                                "fields": fields,
                                                "fields_count": len(fields),
                                                "source": "modal_tab",
                                                "modal_title": modal_title,
                                                "tab_name": tab_text
                                            }
                                            tab_forms.append(tab_form)
                                            forms_found.extend([{
                                                "action": action,
                                                "method": method.upper(),
                                                "fields": fields,
                                                "fields_count": len(fields),
                                                "page_url": page.url,
                                                "source": "modal_tab",
                                                "tab_name": tab_text
                                            }])
                                    except:
                                        continue
                                
                                # Extract tables from tab panel
                                tables_in_tab = tab_panel.locator("table")
                                table_count = await tables_in_tab.count()
                                
                                for table_idx in range(min(table_count, 5)):
                                    try:
                                        table = tables_in_tab.nth(table_idx)
                                        headers = []
                                        header_elements = table.locator("th, [role='columnheader']")
                                        h_count = await header_elements.count()
                                        for h_idx in range(min(h_count, 20)):
                                            try:
                                                header = header_elements.nth(h_idx)
                                                h_text = await header.inner_text()
                                                if h_text.strip():
                                                    headers.append(h_text.strip())
                                            except:
                                                continue
                                        
                                        if headers:
                                            modal_tables.append({
                                                "columns": headers,
                                                "column_count": len(headers),
                                                "source": "modal_tab",
                                                "tab_name": tab_text
                                            })
                                    except:
                                        continue
                                
                            except Exception as tab_content_error:
                                logger.debug(f"[{run_id}] Error extracting content from tab '{tab_text}': {tab_content_error}")
                        
                        except Exception as click_error:
                            logger.debug(f"[{run_id}] Failed to click tab '{tab_text}': {click_error}")
                            continue
                    
                    except Exception as tab_error:
                        logger.debug(f"[{run_id}] Error processing tab {idx}: {tab_error}")
                        continue
                
                # Add tab forms to modal_forms
                modal_forms.extend(tab_forms)
                
            except Exception as tabs_error:
                logger.debug(f"[{run_id}] Error exploring tabs in modal: {tabs_error}")
                pass
            
            # Extract forms from modal (non-tab forms)
            try:
                form_elements = modal_element.locator("form")
                form_count = await form_elements.count()
                for i in range(min(form_count, 10)):
                    try:
                        form = form_elements.nth(i)
                        action = await form.get_attribute("action") or ""
                        method = await form.get_attribute("method") or "GET"
                        fields = await self._get_form_fields(form)
                        
                        if fields or action:
                            modal_forms.append({
                                "action": action,
                                "method": method.upper(),
                                "fields": fields,
                                "fields_count": len(fields),
                                "source": "modal",
                                "modal_title": modal_title
                            })
                            forms_found.extend([{
                                "action": action,
                                "method": method.upper(),
                                "fields": fields,
                                "fields_count": len(fields),
                                "page_url": page.url,
                                "source": "modal"
                            }])
                    except:
                        continue
            except:
                pass
            
            # Extract tables from modal
            modal_tables = []
            try:
                table_elements = modal_element.locator("table")
                table_count = await table_elements.count()
                for i in range(min(table_count, 10)):
                    try:
                        table = table_elements.nth(i)
                        headers = []
                        header_elements = table.locator("th, [role='columnheader']")
                        count = await header_elements.count()
                        for j in range(min(count, 20)):
                            try:
                                header = header_elements.nth(j)
                                text = await header.inner_text()
                                if text.strip():
                                    headers.append(text.strip())
                            except:
                                continue
                        if headers:
                            modal_tables.append({
                                "columns": headers,
                                "column_count": len(headers),
                                "source": "modal"
                            })
                    except:
                        continue
            except:
                pass
            
            # Extract buttons/actions from modal
            modal_actions = []
            try:
                action_keywords = ["create", "add", "new", "edit", "update", "save", "submit", "cancel", "close"]
                buttons = modal_element.locator("button, [role='button'], a.button")
                count = await buttons.count()
                for i in range(min(count, 20)):
                    try:
                        btn = buttons.nth(i)
                        text = await btn.inner_text()
                        if text.strip():
                            text_lower = text.lower()
                            is_action = any(keyword in text_lower for keyword in action_keywords)
                            if is_action:
                                is_dangerous = self._is_destructive(text)
                                modal_actions.append({
                                    "text": text.strip(),
                                    "type": "dangerous" if is_dangerous else "safe",
                                    "tag": "delete" if "delete" in text_lower else ("create" if "create" in text_lower or "add" in text_lower else "other")
                                })
                    except:
                        continue
            except:
                pass
            
            # Close modal (try multiple close methods)
            closed = False
            try:
                # Try close button
                close_selectors = [
                    "button[aria-label*='close']",
                    "button[aria-label*='Close']",
                    ".close",
                    ".modal-close",
                    ".dialog-close",
                    "[data-dismiss='modal']",
                    "button:has-text('Close')",
                    "button:has-text('Cancel')"
                ]
                
                for sel in close_selectors:
                    try:
                        close_btn = modal_element.locator(sel).first
                        if await close_btn.count() > 0 and await close_btn.is_visible():
                            await close_btn.click(timeout=2000)
                            await asyncio.sleep(0.5)
                            closed = True
                            break
                    except:
                        continue
                
                # Try ESC key if close button didn't work
                if not closed:
                    try:
                        await page.keyboard.press("Escape")
                        await asyncio.sleep(0.5)
                        # Check if modal is still visible
                        if await modal_element.is_visible():
                            closed = False
                        else:
                            closed = True
                    except:
                        pass
                
                # Try clicking outside modal (backdrop)
                if not closed:
                    try:
                        backdrop = page.locator(".modal-backdrop, .backdrop, [class*='backdrop']").first
                        if await backdrop.count() > 0:
                            await backdrop.click(timeout=2000)
                            await asyncio.sleep(0.5)
                            closed = True
                    except:
                        pass
                
            except Exception as e:
                logger.debug(f"[{run_id}] Error closing modal: {e}")
            
            return {
                "found": True,
                "title": modal_title,
                "tabs": tabs_found,
                "forms": modal_forms,
                "tables": modal_tables,
                "actions": modal_actions,
                "closed": closed
            }
        
        except Exception as e:
            logger.debug(f"[{run_id}] Error detecting/exploring modal: {e}")
            return None
    
    def _is_destructive(self, text: str) -> bool:
        """Check if an action is destructive."""
        text_lower = text.lower()
        return any(keyword in text_lower for keyword in self.DESTRUCTIVE_KEYWORDS)
    
    async def run_discovery(
        self,
        page,
        run_id: str,
        base_url: str,
        artifacts_path: str,
        debug: bool = False,
        image_hints: Optional[List[Dict[str, Any]]] = None,
        document_analysis: Optional[Dict[str, Any]] = None,
        phase: str = "phase1_get_operations",
        config_overrides: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Run intelligent discovery guided by uploaded images and documents.

        Args:
            page: Playwright Page object (already logged in)
            run_id: Run identifier
            base_url: Base application URL
            artifacts_path: Path to artifacts directory
            debug: Enable debug tracing
            image_hints: Analysis from uploaded images (search, filters, pagination, tables)
            document_analysis: Extracted features, workflows, acceptance criteria from PRD
            phase: "phase1_get_operations" or "phase2_full_testing"
            config_overrides: Optional dict to override discovery config (max_pages, max_forms_per_page, etc.)

        Returns:
            Dict with discovery results
        """
        try:
            logger.info(f"[{run_id}] Starting enhanced discovery from: {base_url}")

            # Apply config overrides if provided
            original_config = {}
            if config_overrides:
                logger.info(f"[{run_id}] Applying config overrides: {config_overrides}")
                for key, value in config_overrides.items():
                    if hasattr(self.config, key) and value is not None:
                        original_config[key] = getattr(self.config, key)
                        setattr(self.config, key, value)
                        logger.info(f"[{run_id}] Override {key}: {original_config[key]} → {value}")

            discovery_dir = Path(artifacts_path)
            discovery_dir.mkdir(parents=True, exist_ok=True)

            # Initialize events.jsonl
            events_file = discovery_dir / "events.jsonl"
            if events_file.exists():
                events_file.unlink()  # Start fresh

            # Initialize discovery_trace.jsonl (debug)
            if debug:
                trace_file = discovery_dir / "discovery_trace.jsonl"
                if trace_file.exists():
                    trace_file.unlink()
                self.trace_step_no[run_id] = 0

            self._emit_event(run_id, artifacts_path, "discovery_started", {
                "base_url": base_url,
                "run_id": run_id,
                "config": {
                    "max_pages": self.config.max_pages,
                    "max_forms_per_page": self.config.max_forms_per_page,
                    "max_table_rows_to_click": self.config.max_table_rows_to_click,
                    "max_discovery_time_minutes": self.config.max_discovery_time_minutes
                }
            })
            
            # Initialize discovery result
            result = {
                "run_id": run_id,
                "base_url": base_url,
                "status": "running",
                "started_at": datetime.utcnow().isoformat() + "Z",
                "completed_at": None,
                "pages": [],
                "navigation_items": [],
                "forms_found": [],
                "api_endpoints": [],
                "dropdowns_found": [],
                "network_stats": {
                    "total_requests": 0,
                    "errors_4xx": 0,
                    "errors_5xx": 0,
                    "slow_requests": []
                },
                "summary": {
                    "total_pages": 0,
                    "pages_visited": 0,
                    "forms_count": 0,
                    "api_endpoints_count": 0
                },
                "error": None
            }
            
            # Set up network monitoring
            api_requests = []
            network_errors = []
            slow_requests = []
            
            def capture_request(req):
                """Capture API requests and network stats."""
                url = req.url
                if any(x in url for x in ['/api/', '/v1/', '/v2/', '/graphql', '/rest/', '/auth/']):
                    api_requests.append({
                        "url": url,
                        "method": req.method,
                        "type": req.resource_type
                    })
            
            def capture_response(resp):
                """Capture network errors and slow requests."""
                status = resp.status
                url = resp.url
                timing = resp.request.timing
                
                if 400 <= status < 500:
                    network_errors.append({
                        "url": url,
                        "status": status,
                        "type": "4xx"
                    })
                elif status >= 500:
                    network_errors.append({
                        "url": url,
                        "status": status,
                        "type": "5xx"
                    })
                
                if timing:
                    total_time = timing.get("responseEnd", 0) - timing.get("requestStart", 0)
                    if total_time > 3000:
                        slow_requests.append({
                            "url": url,
                            "duration_ms": int(total_time),
                            "status": status
                        })
            
            page.on("request", capture_request)
            page.on("response", capture_response)

            current_url = page.url
            base_domain = urlparse(base_url).netloc

            # Intelligent Discovery: Build priority test queue from image/document analysis
            get_operation_results = None
            if image_hints or document_analysis:
                logger.info(f"[{run_id}] Building priority test queue from uploaded analysis...")
                test_queue = self._build_priority_test_queue(image_hints, document_analysis)

                if test_queue:
                    logger.info(f"[{run_id}] Found {len(test_queue)} prioritized test areas")
                    self._emit_event(run_id, artifacts_path, "test_queue_built", {
                        "test_count": len(test_queue),
                        "priorities": [t["priority"] for t in test_queue]
                    })

                    if phase == "phase1_get_operations":
                        logger.info(f"[{run_id}] Executing Phase 1: GET operations only")
                        self._emit_event(run_id, artifacts_path, "phase1_started", {
                            "phase": "GET operations (search, filter, pagination)"
                        })

                        get_operation_results = await self._execute_get_operations(
                            page, test_queue, run_id, artifacts_path
                        )

                        result["get_operation_results"] = get_operation_results

                        self._emit_event(run_id, artifacts_path, "phase1_completed", {
                            "tests_executed": len(get_operation_results["tests_executed"]),
                            "tests_passed": get_operation_results["tests_passed"],
                            "tests_failed": get_operation_results["tests_failed"]
                        })

                        logger.info(f"[{run_id}] Phase 1 completed: {get_operation_results['tests_passed']} passed, "
                                  f"{get_operation_results['tests_failed']} failed")

            # Step 1: Discover top dropdowns (tenant/project/cell selectors)
            logger.info(f"[{run_id}] Discovering top dropdowns/context selectors")
            before_url = page.url
            before_heading = (await self._get_page_signature(page)).get("page_name") or (await self._get_page_signature(page)).get("heading","") or (await self._get_page_signature(page)).get("breadcrumb","")
            step_no = self.trace_step_no.get(run_id, 0) + 1
            ss_before = await self._take_trace_screenshot(page, discovery_dir, "before_dropdown_scan", step_no) if debug else None
            dropdowns_found = await self._discover_top_dropdowns(
                page, run_id, artifacts_path, base_domain, discovery_dir, debug
            )
            after_url = page.url
            after_heading = (await self._get_page_signature(page)).get("page_name") or (await self._get_page_signature(page)).get("heading","") or (await self._get_page_signature(page)).get("breadcrumb","")
            ss_after = await self._take_trace_screenshot(page, discovery_dir, "after_dropdown_scan", step_no) if debug else None
            await self._trace_step(
                run_id=run_id,
                artifacts_path=artifacts_path,
                discovery_dir=discovery_dir,
                debug=debug,
                action="scan",
                element_text="top_dropdowns",
                element_role_or_tag="scan",
                selector_hint="DROPDOWN_TRIGGER_SELECTORS",
                before_url=before_url,
                after_url=after_url,
                before_heading=before_heading,
                after_heading=after_heading,
                screenshot_before_path=ss_before,
                screenshot_after_path=ss_after,
                result="no_change" if not dropdowns_found else "submenu_revealed",
            )
            result["dropdowns_found"] = dropdowns_found
            self._emit_event(run_id, artifacts_path, "dropdowns_discovered", {
                "count": len(dropdowns_found),
                "dropdowns": dropdowns_found
            })

            # Step 1.5: PHASE 4 - Context switching (if enabled)
            context_discoveries = {}
            if self.config.enable_context_switching and dropdowns_found:
                logger.info(f"[{run_id}] Starting context switching...")
                try:
                    context_discoveries = await self._switch_contexts_and_discover(
                        page, dropdowns_found, run_id, artifacts_path, base_url, base_domain, discovery_dir, debug
                    )
                    result["context_discoveries"] = context_discoveries
                    self._emit_event(run_id, artifacts_path, "context_switching_completed", {
                        "contexts_explored": len(context_discoveries)
                    })
                except Exception as e:
                    logger.warning(f"[{run_id}] Error in context switching: {e}")

            # Step 2: Discover sidebar navigation with submenu exploration
            logger.info(f"[{run_id}] Discovering sidebar navigation")
            before_url = page.url
            before_heading = (await self._get_page_signature(page)).get("page_name") or (await self._get_page_signature(page)).get("heading","") or (await self._get_page_signature(page)).get("breadcrumb","")
            step_no = self.trace_step_no.get(run_id, 0) + 1
            ss_before = await self._take_trace_screenshot(page, discovery_dir, "before_nav_scan", step_no) if debug else None
            nav_items = await self._discover_sidebar_navigation(
                page, run_id, artifacts_path, base_domain, discovery_dir, debug
            )
            after_url = page.url
            after_heading = (await self._get_page_signature(page)).get("page_name") or (await self._get_page_signature(page)).get("heading","") or (await self._get_page_signature(page)).get("breadcrumb","")
            ss_after = await self._take_trace_screenshot(page, discovery_dir, "after_nav_scan", step_no) if debug else None
            await self._trace_step(
                run_id=run_id,
                artifacts_path=artifacts_path,
                discovery_dir=discovery_dir,
                debug=debug,
                action="scan",
                element_text="left_navigation",
                element_role_or_tag="scan",
                selector_hint="SIDEBAR_SELECTORS/MENU_ITEM_SELECTORS",
                before_url=before_url,
                after_url=after_url,
                before_heading=before_heading,
                after_heading=after_heading,
                nav_item_count_before=None,
                nav_item_count_after=len(nav_items),
                screenshot_before_path=ss_before,
                screenshot_after_path=ss_after,
                result="submenu_revealed" if nav_items else "no_change",
            )
            result["navigation_items"] = nav_items
            # Extract resources from navigation
            resources = [item for item in nav_items if item.get("is_resource") or "resource" in item.get("text", "").lower()]
            
            self._emit_event(run_id, artifacts_path, "navigation_discovered", {
                "count": len(nav_items),
                "items": nav_items[:10],  # First 10 for event
                "resources_count": len(resources),
                "resources": [{"name": r.get("text", ""), "nav_path": r.get("nav_path", "")} for r in resources[:10]]
            })
            
            # Step 3: Visit pages and perform deep discovery
            visited_pages = []
            forms_found = []
            visited_urls: Set[str] = set()
            visited_fingerprints: Set[str] = set()
            max_pages = self.config.max_pages
            max_discovery_time = self.config.max_discovery_time_minutes * 60  # Convert to seconds
            discovery_start_time = asyncio.get_event_loop().time()
            pages_without_new_discovery = 0
            max_pages_without_discovery = 20
            
            # Visit base URL first
            try:
                await page.goto(base_url, timeout=30000, wait_until="networkidle")
                await asyncio.sleep(2)
                
                page_info = await self._analyze_page_enhanced(
                    page, base_url, "Home", run_id, discovery_dir, len(visited_pages), artifacts_path
                )
                visited_pages.append(page_info)
                visited_urls.add(base_url)
                
                # Create fingerprint
                heading = page_info.get("page_signature", {}).get("heading", "")
                fingerprint = self._create_fingerprint("", base_url, heading)
                visited_fingerprints.add(fingerprint)
                
                if page_info.get("forms"):
                    forms_found.extend(page_info["forms"])
                
                # Get page name from signature (prefer page_name, then heading, then title)
                signature = page_info.get("page_signature", {})
                page_name = signature.get("page_name") or signature.get("heading", "") or page_info.get("title", "")
                # Clean up title if it's generic (contains |)
                if "|" in page_name and not signature.get("page_name"):
                    # Try to extract meaningful part or use URL
                    page_name = signature.get("page_name") or ""
                
                self._emit_event(run_id, artifacts_path, "page_discovered", {
                    "url": base_url,
                    "title": page_info.get("title", ""),
                    "page_name": page_name,
                    "nav_path": "Home",
                    "forms_count": len(page_info.get("forms", [])),
                    "actions_count": len(page_info.get("primary_actions", [])),
                    "resources": []
                })

                # Generate test cases for this page
                try:
                    from app.services.test_case_generator import get_test_case_generator
                    test_gen = get_test_case_generator()
                    page_test_cases = test_gen.generate_test_cases_for_page(page_info, run_id)

                    # Emit events for each test case
                    for tc in page_test_cases:
                        test_gen.emit_test_case_event(run_id, artifacts_path, tc)

                    # Save test cases incrementally so UI can display them in real-time
                    test_gen.append_test_cases(run_id, artifacts_path, page_test_cases)
                except Exception as tc_error:
                    logger.warning(f"[{run_id}] Failed to generate test cases: {tc_error}")

                # Test all interactions on home page before moving on
                await self._test_page_interactions_complete(
                    page, base_url, page_info, run_id, artifacts_path, visited_urls, visited_fingerprints, visited_pages, forms_found, base_domain, discovery_dir, max_pages, "", debug
                )
            except Exception as e:
                logger.warning(f"[{run_id}] Failed to visit base URL: {e}")
            
            # Visit navigation items
            for idx, nav in enumerate(nav_items):
                # Intelligent stopping conditions
                elapsed_time = asyncio.get_event_loop().time() - discovery_start_time
                
                # Emit periodic progress event every 30 seconds to show discovery is still running
                if idx % 10 == 0 or elapsed_time % 30 < 1:  # Every 10 pages or every 30 seconds
                    self._emit_event(run_id, artifacts_path, "discovery_progress", {
                        "status": "in_progress",
                        "pages_discovered": len(visited_pages),
                        "forms_found": len(forms_found),
                        "current_nav_index": idx,
                        "total_nav_items": len(nav_items),
                        "elapsed_minutes": round(elapsed_time / 60, 1),
                        "max_time_minutes": self.config.max_discovery_time_minutes
                    })

                if len(visited_pages) >= max_pages:
                    logger.info(f"[{run_id}] Reached max pages limit ({max_pages})")
                    break

                if elapsed_time > max_discovery_time:
                    logger.info(f"[{run_id}] Reached max discovery time ({max_discovery_time/60:.1f} minutes)")
                    break

                if pages_without_new_discovery >= max_pages_without_discovery:
                    logger.info(f"[{run_id}] No new pages discovered in last {max_pages_without_discovery} attempts, stopping")
                    break
                
                try:
                    url = nav.get("full_url") or nav.get("url")
                    if not url:
                        continue
                    
                    # Normalize URL for comparison
                    normalized_url = self._normalize_url(url)
                    
                    if urlparse(url).netloc != base_domain:
                        continue
                    
                    # Check normalized URL to avoid duplicates
                    if normalized_url in visited_urls:
                        pages_without_new_discovery += 1
                        continue
                    
                    # Normalize URL before checking and storing
                    normalized_url = self._normalize_url(url)
                    if normalized_url in visited_urls:
                        pages_without_new_discovery += 1
                        continue
                    
                    logger.info(f"[{run_id}] Visiting page {len(visited_pages)+1}/{max_pages}: {url}")
                    
                    # Emit progress event
                    self._emit_event(run_id, artifacts_path, "page_visit_started", {
                        "url": url,
                        "page_number": len(visited_pages) + 1,
                        "total_pages_limit": max_pages,
                        "nav_path": nav.get("nav_path", "")
                    })
                    
                    await self._instrumented_action(
                        run_id=run_id,
                        artifacts_path=artifacts_path,
                        discovery_dir=discovery_dir,
                        debug=debug,
                        page=page,
                        action="navigate",
                        element_text=nav.get("text", "nav_item"),
                        element_role_or_tag="navigate",
                        selector_hint=nav.get("nav_path", ""),
                        do=lambda: page.goto(url, timeout=30000, wait_until="networkidle"),
                    )
                    await asyncio.sleep(0.5)
                    
                    # Get final URL after navigation (handles redirects)
                    final_url = page.url
                    normalized_final = self._normalize_url(final_url)
                    
                    # Check again after redirect
                    if normalized_final in visited_urls:
                        pages_without_new_discovery += 1
                        logger.info(f"[{run_id}] Page redirected to already visited URL: {final_url}")
                        continue
                    
                    # Mark as visited with normalized URL
                    visited_urls.add(normalized_url)
                    visited_urls.add(normalized_final)
                    
                    page_info = await self._analyze_page_enhanced(
                        page, final_url, nav.get("text", "Unknown"), run_id, discovery_dir, len(visited_pages), artifacts_path
                    )
                    visited_pages.append(page_info)

                    # Reset counter since we discovered a new page
                    pages_without_new_discovery = 0
                    
                    # Create fingerprint
                    heading = page_info.get("page_signature", {}).get("heading", "")
                    nav_path = nav.get("nav_path", "")
                    fingerprint = self._create_fingerprint(nav_path, url, heading)
                    visited_fingerprints.add(fingerprint)
                    
                    if page_info.get("forms"):
                        forms_found.extend(page_info["forms"])

                    # Check timeout before long-running operations
                    elapsed_time = asyncio.get_event_loop().time() - discovery_start_time
                    if elapsed_time > max_discovery_time:
                        logger.info(f"[{run_id}] Reached max discovery time ({max_discovery_time/60:.1f} minutes) before page interactions")
                        break
                    
                    # CRITICAL: Test ALL page interactions BEFORE moving to next page
                    # This ensures we fully validate each page (search, filters, sort, pagination) in one go
                    try:
                        logger.info(f"[{run_id}] Testing all interactions on page: {final_url}")
                        # Emit progress event to show we're still working
                        self._emit_event(run_id, artifacts_path, "discovery_progress", {
                            "status": "in_progress",
                            "pages_discovered": len(visited_pages),
                            "forms_found": len(forms_found),
                            "current_page": final_url,
                            "elapsed_minutes": round(elapsed_time / 60, 1),
                            "max_time_minutes": self.config.max_discovery_time_minutes
                        })
                        await self._test_page_interactions_complete(
                            page, final_url, page_info, run_id, artifacts_path, visited_urls, visited_fingerprints, visited_pages, forms_found, base_domain, discovery_dir, max_pages, nav_path, debug
                        )
                    except Exception as e:
                        logger.warning(f"[{run_id}] Error testing page interactions: {e}")

                    # PHASE 6: Recursive discovery - process forms, tables, and pagination
                    # Note: This is now done inside _test_page_interactions_complete to ensure we stay on the page
                    # But keep this as fallback for pages without standard interactions
                    if self.config.enable_form_submission and page_info.get("forms"):
                        try:
                            logger.info(f"[{run_id}] Processing {len(page_info['forms'])} forms on page")
                            form_pages = await self._process_page_forms(
                                page, page_info, run_id, artifacts_path, visited_urls, depth=1
                            )
                            # Add discovered pages from forms to the navigation queue
                            for form_page in form_pages:
                                normalized_form_url = self._normalize_url(form_page.get("url", ""))
                                if normalized_form_url and normalized_form_url not in visited_urls:
                                    logger.info(f"[{run_id}] Form led to new page: {form_page['url']}")
                        except Exception as e:
                            logger.debug(f"[{run_id}] Error processing forms: {e}")

                    # Process tables - click rows to discover detail pages
                    if self.config.enable_table_row_clicking and page_info.get("tables"):
                        try:
                            logger.info(f"[{run_id}] Processing {len(page_info['tables'])} tables on page")
                            table_elements = page.locator("table")
                            table_count = await table_elements.count()

                            for i in range(min(table_count, 10)):
                                try:
                                    table = table_elements.nth(i)
                                    table_pages = await self._click_table_rows_and_discover(
                                        page, table, run_id, artifacts_path, visited_urls, depth=1
                                    )
                                    for table_page in table_pages:
                                        normalized_table_url = self._normalize_url(table_page.get("url", ""))
                                        if normalized_table_url and normalized_table_url not in visited_urls:
                                            logger.info(f"[{run_id}] Table row led to new page: {table_page['url']}")
                                except Exception as e:
                                    logger.debug(f"[{run_id}] Error processing table {i}: {e}")
                        except Exception as e:
                            logger.debug(f"[{run_id}] Error processing tables: {e}")

                    # Handle pagination
                    try:
                        logger.debug(f"[{run_id}] Checking for pagination...")
                        pagination_pages = await self._handle_pagination(
                            page, run_id, artifacts_path, visited_urls, depth=1
                        )
                        if pagination_pages:
                            logger.info(f"[{run_id}] Pagination discovered {len(pagination_pages)} pages")
                    except Exception as e:
                        logger.debug(f"[{run_id}] Error handling pagination: {e}")

                    # Get page name from signature (prefer page_name, then heading, then title)
                    signature = page_info.get("page_signature", {})
                    page_name = signature.get("page_name") or signature.get("heading", "") or page_info.get("title", "")
                    # Clean up title if it's generic (contains |)
                    if "|" in page_name and not signature.get("page_name"):
                        # Try to extract meaningful part or use URL
                        page_name = signature.get("page_name") or ""
                    
                    # Extract resources from navigation items
                    resources = []
                    for nav_item in nav_items:
                        if nav_item.get("is_resource") or "resource" in nav_item.get("text", "").lower():
                            resources.append({
                                "name": nav_item.get("text", ""),
                                "url": nav_item.get("full_url", ""),
                                "nav_path": nav_item.get("nav_path", "")
                            })
                    
                    # Emit richer event so UI can show page details live
                    self._emit_event(run_id, artifacts_path, "page_discovered", {
                        "url": final_url,
                        "title": page_info.get("title", ""),
                        "page_name": page_name,
                        "nav_path": nav_path,
                        "forms_count": len(page_info.get("forms", [])),
                        "actions_count": len(page_info.get("primary_actions", [])),
                        "resources": resources[:10],  # First 10 resources
                        "primary_actions": page_info.get("primary_actions", [])[:10],
                        "forms": page_info.get("forms", [])[:3],  # first 3 forms with fields
                        "tables": page_info.get("tables", [])[:3],
                    })

                    # Generate test cases for this page
                    try:
                        from app.services.test_case_generator import get_test_case_generator
                        test_gen = get_test_case_generator()
                        page_test_cases = test_gen.generate_test_cases_for_page(page_info, run_id)

                        # Emit events for each test case
                        for tc in page_test_cases:
                            test_gen.emit_test_case_event(run_id, artifacts_path, tc)

                        # Save test cases incrementally so UI can display them in real-time
                        test_gen.append_test_cases(run_id, artifacts_path, page_test_cases)
                    except Exception as tc_error:
                        logger.warning(f"[{run_id}] Failed to generate test cases: {tc_error}")

                    # NOTE: We no longer call _deep_discover_page_enhanced here because:
                    # 1. _test_page_interactions_complete already tests all interactions
                    # 2. _deep_discover_page_enhanced would navigate away and might not return
                    # 3. We want to complete testing on current page before moving to next
                    # Deep discovery of cards/tabs is now handled within _test_page_interactions_complete
                except Exception as e:
                    logger.warning(f"[{run_id}] Failed to visit {url}: {e}")
                    continue
            
            # Step 4: Process results and create app map
            result["pages"] = visited_pages
            # Merge modal forms into forms_found
            if run_id in self.modal_forms:
                forms_found.extend(self.modal_forms[run_id])
                logger.info(f"[{run_id}] Added {len(self.modal_forms[run_id])} forms from modals")
            result["forms_found"] = forms_found
            result["api_endpoints"] = api_requests[:100]
            
            result["network_stats"] = {
                "total_requests": len(api_requests),
                "errors_4xx": len([e for e in network_errors if e["type"] == "4xx"]),
                "errors_5xx": len([e for e in network_errors if e["type"] == "5xx"]),
                "slow_requests": slow_requests[:20]
            }

            # PHASE 5: API Sanity Testing
            sanity_results = []
            if self.config.enable_api_sanity_tests and api_requests:
                try:
                    logger.info(f"[{run_id}] Starting API sanity testing...")
                    sanity_results = await self._perform_sanity_get_operations(
                        page, api_requests, run_id, artifacts_path
                    )
                    result["api_sanity_results"] = sanity_results
                    logger.info(f"[{run_id}] API sanity testing completed: {len(sanity_results)} endpoints tested")
                except Exception as e:
                    logger.warning(f"[{run_id}] Error in API sanity testing: {e}")

            result["summary"] = {
                "total_pages": len(visited_pages),
                "pages_visited": len(visited_pages),
                "forms_count": len(forms_found),
                "api_endpoints_count": len(api_requests),
                "dropdowns_count": len(dropdowns_found),
                "contexts_explored": len(context_discoveries) if context_discoveries else 0,
                "api_endpoints_tested": len(sanity_results) if sanity_results else 0,
                "api_sanity_passed": len([r for r in sanity_results if r.get("sanity_status") == "pass"]) if sanity_results else 0,
                "api_sanity_failed": len([r for r in sanity_results if r.get("sanity_status") in ["client_error", "server_error", "error"]]) if sanity_results else 0
            }
            
            result["status"] = "completed"
            result["completed_at"] = datetime.utcnow().isoformat() + "Z"
            
            # Save discovery.json
            discovery_file = discovery_dir / "discovery.json"
            with open(discovery_file, "w") as f:
                json.dump(result, f, indent=2, default=str)
            
            # Create discovery_appmap.json
            appmap = self._create_appmap(visited_pages, dropdowns_found, forms_found)
            appmap_file = discovery_dir / "discovery_appmap.json"
            with open(appmap_file, "w") as f:
                json.dump(appmap, f, indent=2, default=str)
            
            # Collect and save all generated test cases
            try:
                from app.services.test_case_generator import get_test_case_generator
                test_gen = get_test_case_generator()

                # Collect all test cases from all pages
                all_test_cases = []
                for page in visited_pages:
                    page_test_cases = test_gen.generate_test_cases_for_page(page, run_id)
                    all_test_cases.extend(page_test_cases)

                # Save consolidated test cases
                test_gen.save_test_cases(run_id, artifacts_path, all_test_cases)

                logger.info(f"[{run_id}] Generated and saved {len(all_test_cases)} test cases")

                # Emit test cases summary event
                scenarios = test_gen.group_test_cases_by_scenario(all_test_cases)
                self._emit_event(run_id, artifacts_path, "test_cases_generated", {
                    "total_test_cases": len(all_test_cases),
                    "scenarios_count": len(scenarios),
                    "scenarios": scenarios
                })

            except Exception as tc_error:
                logger.error(f"[{run_id}] Failed to save test cases: {tc_error}", exc_info=True)

            self._emit_event(run_id, artifacts_path, "discovery_completed", {
                "pages_count": len(visited_pages),
                "forms_count": len(forms_found),
                "api_endpoints_count": len(api_requests),
                "dropdowns_count": len(dropdowns_found),
                "contexts_explored": len(context_discoveries) if context_discoveries else 0,
                "api_endpoints_tested": len(sanity_results) if sanity_results else 0,
                "summary": result["summary"]
            })

            # Phase 1: Execute health checks on all discovered pages
            logger.info(f"[{run_id}] Starting Phase 1 health checks on {len(visited_pages)} pages...")

            try:
                from app.services.health_check_executor import HealthCheckExecutor

                health_checker = HealthCheckExecutor(max_concurrent=3)
                health_report = await health_checker.execute_health_checks(
                    run_id=run_id,
                    pages=visited_pages,
                    browser_context=page.context,
                    debug=debug
                )

                # Save health check report
                health_report_path = discovery_dir / "health_check_report.json"
                with open(health_report_path, "w") as f:
                    f.write(json.dumps(health_report.model_dump(), indent=2, default=str))

                logger.info(f"[{run_id}] Health checks completed: {health_report.checks_passed} passed, "
                           f"{health_report.checks_failed} failed, {health_report.checks_skipped} skipped")

            except Exception as health_error:
                logger.error(f"[{run_id}] Health check execution failed: {health_error}", exc_info=True)
                # Continue even if health checks fail

            # Close event writer
            if run_id in self.event_writers:
                self.event_writers[run_id].close()
                del self.event_writers[run_id]

            # Close trace writer
            if run_id in self.trace_writers:
                self.trace_writers[run_id].close()
                del self.trace_writers[run_id]
                self.trace_step_no.pop(run_id, None)
            
            # Clean up modal forms storage
            self.modal_forms.pop(run_id, None)
            
            logger.info(f"[{run_id}] Discovery completed: {len(visited_pages)} pages, {len(forms_found)} forms, {len(api_requests)} APIs")
            
            return result
        
        except Exception as e:
            logger.error(f"[{run_id}] Discovery failed: {e}", exc_info=True)
            self._emit_event(run_id, artifacts_path, "discovery_failed", {
                "error": str(e)[:500]
            })
            
            # Close event writer on error
            if run_id in self.event_writers:
                self.event_writers[run_id].close()
                del self.event_writers[run_id]

            # Close trace writer on error
            if run_id in self.trace_writers:
                self.trace_writers[run_id].close()
                del self.trace_writers[run_id]
                self.trace_step_no.pop(run_id, None)
            
            # Clean up modal forms storage on error
            self.modal_forms.pop(run_id, None)
            
            result = {
                "run_id": run_id,
                "base_url": base_url,
                "status": "failed",
                "started_at": datetime.utcnow().isoformat() + "Z",
                "completed_at": datetime.utcnow().isoformat() + "Z",
                "error": str(e)[:500],
                "pages": [],
                "navigation_items": [],
                "forms_found": [],
                "api_endpoints": [],
                "network_stats": {},
                "summary": {}
            }
            
            discovery_dir = Path(artifacts_path)
            discovery_dir.mkdir(parents=True, exist_ok=True)
            discovery_file = discovery_dir / "discovery.json"
            with open(discovery_file, "w") as f:
                json.dump(result, f, indent=2, default=str)

            return result

        finally:
            # Restore original config if overrides were applied
            if config_overrides and original_config:
                for key, value in original_config.items():
                    setattr(self.config, key, value)
                logger.info(f"[{run_id}] Restored original config")

    def _build_priority_test_queue(
        self,
        image_hints: Optional[List[Dict[str, Any]]],
        document_analysis: Optional[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Build prioritized test queue from image/document analysis.

        Returns sorted list of test areas with priority.
        """
        test_queue = []

        if image_hints:
            # Priority 1: Search components from images
            for hint in image_hints:
                if hint.get("operation") == "search":
                    test_queue.append({
                        "priority": 1,
                        "type": "search",
                        "component": hint["component"],
                        "test_cases": hint["test_cases"],
                        "source": "image_analysis"
                    })

            # Priority 2: Filter components
            for hint in image_hints:
                if hint.get("operation") == "filter":
                    test_queue.append({
                        "priority": 2,
                        "type": "filter",
                        "component": hint["component"],
                        "test_cases": hint["test_cases"],
                        "source": "image_analysis"
                    })

            # Priority 3: Pagination
            for hint in image_hints:
                if hint.get("operation") == "pagination":
                    test_queue.append({
                        "priority": 3,
                        "type": "pagination",
                        "component": hint["component"],
                        "test_cases": hint["test_cases"],
                        "source": "image_analysis"
                    })

            # Priority 4: Data tables
            for hint in image_hints:
                if hint.get("operation") == "data_validation":
                    test_queue.append({
                        "priority": 4,
                        "type": "table_validation",
                        "component": hint["component"],
                        "test_cases": hint["test_cases"],
                        "source": "image_analysis"
                    })

        if document_analysis:
            # Add features from PRD
            for feature in document_analysis.get("features", []):
                test_queue.append({
                    "priority": 5,
                    "type": "feature_test",
                    "feature_name": feature["name"],
                    "test_focus": feature["test_focus"],
                    "source": "prd_document"
                })

            # Add workflows
            for workflow in document_analysis.get("workflows", []):
                test_queue.append({
                    "priority": 6,
                    "type": "workflow_test",
                    "workflow_name": workflow["name"],
                    "steps": workflow["steps"],
                    "source": "prd_document"
                })

        # Sort by priority
        return sorted(test_queue, key=lambda x: x["priority"])

    async def _execute_get_operations(
        self,
        page,
        test_queue: List[Dict[str, Any]],
        run_id: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """
        Execute Phase 1: GET operations only (search, filter, pagination).

        No POST/PUT/DELETE operations in this phase.
        """
        results = {
            "phase": "phase1_get_operations",
            "tests_executed": [],
            "tests_passed": 0,
            "tests_failed": 0
        }

        for test_item in test_queue:
            test_type = test_item["type"]

            try:
                if test_type == "search":
                    # Execute search tests
                    search_results = await self._test_search_component(
                        page,
                        test_item["component"],
                        test_item["test_cases"],
                        run_id,
                        artifacts_path
                    )
                    results["tests_executed"].append(search_results)

                elif test_type == "filter":
                    # Execute filter tests
                    filter_results = await self._test_filter_component(
                        page,
                        test_item["component"],
                        test_item["test_cases"],
                        run_id,
                        artifacts_path
                    )
                    results["tests_executed"].append(filter_results)

                elif test_type == "pagination":
                    # Execute pagination tests
                    pagination_results = await self._test_pagination_component(
                        page,
                        test_item["component"],
                        test_item["test_cases"],
                        run_id,
                        artifacts_path
                    )
                    results["tests_executed"].append(pagination_results)

                elif test_type == "table_validation":
                    # Execute table validation
                    table_results = await self._test_table_component(
                        page,
                        test_item["component"],
                        test_item["test_cases"],
                        run_id,
                        artifacts_path
                    )
                    results["tests_executed"].append(table_results)

            except Exception as e:
                logger.warning(f"[{run_id}] Error testing {test_type}: {e}")
                results["tests_executed"].append({
                    "component": test_type,
                    "status": "error",
                    "error": str(e)
                })

        # Calculate pass/fail
        for test in results["tests_executed"]:
            if test.get("status") == "passed":
                results["tests_passed"] += 1
            else:
                results["tests_failed"] += 1

        return results

    async def _test_search_component(
        self,
        page,
        component: Dict[str, Any],
        test_cases: List[str],
        run_id: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """Test search component with various inputs."""
        test_result = {
            "component": "search",
            "component_text": component.get("text", ""),
            "tests": []
        }

        try:
            # Find search input - try multiple selectors
            search_selectors = [
                "input[type='search']",
                "input[placeholder*='search' i]",
                "input[placeholder*='find' i]",
                "input[aria-label*='search' i]",
                "[role='searchbox']",
                ".search-input",
                "#search",
                "input[name*='search' i]"
            ]

            search_input = None
            for selector in search_selectors:
                try:
                    element = page.locator(selector).first
                    if await element.count() > 0 and await element.is_visible():
                        search_input = element
                        break
                except:
                    continue

            if not search_input:
                test_result["status"] = "skipped"
                test_result["reason"] = "Search input not found"
                return test_result

            for test_case in test_cases:
                if "valid term" in test_case.lower():
                    # Test 1: Search with valid term
                    await search_input.fill("test")
                    await search_input.press("Enter")
                    await page.wait_for_load_state("networkidle", timeout=5000)

                    # Verify results appeared
                    results_count = await self._count_search_results(page)

                    test_result["tests"].append({
                        "test_case": test_case,
                        "status": "passed" if results_count >= 0 else "failed",
                        "details": f"Found {results_count} results"
                    })

                    self._emit_event(run_id, artifacts_path, "search_tested", {
                        "search_term": "test",
                        "results_count": results_count
                    })

                elif "empty" in test_case.lower():
                    # Test 2: Search with empty
                    await search_input.fill("")
                    await search_input.press("Enter")
                    await page.wait_for_timeout(1000)

                    test_result["tests"].append({
                        "test_case": test_case,
                        "status": "passed",
                        "details": "Empty search handled"
                    })

                elif "clear" in test_case.lower():
                    # Test 3: Clear search
                    await search_input.fill("test")
                    await page.wait_for_timeout(500)
                    await search_input.fill("")
                    await page.wait_for_timeout(500)

                    test_result["tests"].append({
                        "test_case": test_case,
                        "status": "passed",
                        "details": "Search cleared successfully"
                    })

            test_result["status"] = "passed" if all(t["status"] == "passed" for t in test_result["tests"]) else "failed"

        except Exception as e:
            logger.error(f"[{run_id}] Error in search test: {e}")
            test_result["status"] = "error"
            test_result["error"] = str(e)

        return test_result

    async def _count_search_results(self, page) -> int:
        """Count search results on page."""
        try:
            # Try common result count patterns
            count_selectors = [
                ".results-count",
                ".search-results-count",
                "[class*='result'][class*='count']",
                "text=/\\d+ results?/i",
                "text=/found \\d+/i"
            ]

            for selector in count_selectors:
                try:
                    element = page.locator(selector).first
                    if await element.count() > 0:
                        text = await element.inner_text()
                        # Extract number from text
                        import re
                        numbers = re.findall(r'\d+', text)
                        if numbers:
                            return int(numbers[0])
                except:
                    continue

            # Count result items
            result_selectors = [
                ".search-result",
                ".result-item",
                "[class*='search'][class*='result']",
                "[data-testid*='result']"
            ]

            for selector in result_selectors:
                try:
                    count = await page.locator(selector).count()
                    if count > 0:
                        return count
                except:
                    continue

            return 0

        except:
            return 0

    async def _test_filter_component(
        self,
        page,
        component: Dict[str, Any],
        test_cases: List[str],
        run_id: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """Test filter component with all options."""
        test_result = {
            "component": "filter",
            "filter_label": component.get("label", ""),
            "tests": []
        }

        try:
            filter_type = component.get("filter_type", "unknown")

            # Find filter element
            filter_selectors = [
                f"select[aria-label*='{component.get('label', '')}' i]",
                f"button[aria-label*='{component.get('label', '')}' i]",
                ".filter-dropdown",
                "[class*='filter']",
                "[role='combobox']"
            ]

            filter_element = None
            for selector in filter_selectors:
                try:
                    element = page.locator(selector).first
                    if await element.count() > 0 and await element.is_visible():
                        filter_element = element
                        break
                except:
                    continue

            if not filter_element:
                test_result["status"] = "skipped"
                test_result["reason"] = "Filter element not found"
                return test_result

            if filter_type == "dropdown":
                # Test dropdown filter
                await filter_element.click()
                await page.wait_for_timeout(500)

                # Get all options
                options = await page.locator("option, [role='option']").all_text_contents()

                for option in options[:5]:  # Test first 5 options
                    if option.strip():
                        try:
                            await page.select_option(str(filter_element), label=option)
                        except:
                            # Try clicking option instead
                            await page.locator(f"[role='option']:has-text('{option}')").first.click()

                        await page.wait_for_load_state("networkidle", timeout=5000)

                        results_count = await self._count_filtered_results(page)

                        test_result["tests"].append({
                            "test_case": f"Filter by {option}",
                            "status": "passed",
                            "details": f"{results_count} results after filtering"
                        })

                        self._emit_event(run_id, artifacts_path, "filter_tested", {
                            "filter": component["label"],
                            "option": option,
                            "results_count": results_count
                        })

            test_result["status"] = "passed" if len(test_result["tests"]) > 0 else "skipped"

        except Exception as e:
            logger.error(f"[{run_id}] Error in filter test: {e}")
            test_result["status"] = "error"
            test_result["error"] = str(e)

        return test_result

    async def _count_filtered_results(self, page) -> int:
        """Count filtered results on page."""
        try:
            # Similar to search results counting
            result_selectors = [
                ".result-item",
                ".list-item",
                "tbody tr",
                "[class*='row']",
                "[data-testid*='item']"
            ]

            for selector in result_selectors:
                try:
                    count = await page.locator(selector).count()
                    if count > 0:
                        return count
                except:
                    continue

            return 0
        except:
            return 0

    async def _test_pagination_component(
        self,
        page,
        component: Dict[str, Any],
        test_cases: List[str],
        run_id: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """Test pagination by clicking through pages."""
        test_result = {
            "component": "pagination",
            "tests": []
        }

        try:
            # Find next button
            next_selectors = [
                "button:has-text('Next')",
                "a:has-text('Next')",
                "[aria-label*='next' i]",
                ".pagination-next",
                "[class*='next']"
            ]

            page_number = 1
            total_items_seen = 0
            max_pages = 100  # Increased from 10 to 100 for thorough pagination testing

            while page_number <= max_pages:
                # Count items on current page
                items_on_page = await self._count_items_on_page(page)
                total_items_seen += items_on_page

                test_result["tests"].append({
                    "test_case": f"Page {page_number}",
                    "status": "passed",
                    "details": f"{items_on_page} items on page"
                })

                self._emit_event(run_id, artifacts_path, "pagination_tested", {
                    "page_number": page_number,
                    "items_on_page": items_on_page
                })

                # Try to click next
                next_button = None
                for selector in next_selectors:
                    try:
                        btn = page.locator(selector).first
                        if await btn.count() > 0 and await btn.is_visible():
                            next_button = btn
                            break
                    except:
                        continue

                if not next_button:
                    break

                try:
                    if await next_button.is_disabled():
                        break

                    await next_button.click()
                    await page.wait_for_load_state("networkidle", timeout=5000)
                    page_number += 1

                except Exception:
                    break  # No more pages

            test_result["total_pages"] = page_number
            test_result["total_items"] = total_items_seen
            test_result["status"] = "passed"

        except Exception as e:
            logger.error(f"[{run_id}] Error in pagination test: {e}")
            test_result["status"] = "error"
            test_result["error"] = str(e)

        return test_result

    async def _count_items_on_page(self, page) -> int:
        """Count items on current page."""
        try:
            item_selectors = [
                "tbody tr",
                ".list-item",
                ".grid-item",
                ".card",
                "[class*='item']"
            ]

            for selector in item_selectors:
                try:
                    count = await page.locator(selector).count()
                    if count > 0:
                        return count
                except:
                    continue

            return 0
        except:
            return 0

    async def _test_table_component(
        self,
        page,
        component: Dict[str, Any],
        test_cases: List[str],
        run_id: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """Validate data table structure and content."""
        test_result = {
            "component": "data_table",
            "tests": []
        }

        try:
            # Verify headers
            expected_headers = component.get("headers", [])
            actual_headers = await page.locator("table thead th, [role='columnheader']").all_text_contents()

            header_match = len(set(expected_headers) & set(actual_headers)) > 0

            test_result["tests"].append({
                "test_case": "Verify column headers",
                "status": "passed" if header_match else "failed",
                "expected": expected_headers,
                "actual": actual_headers[:10]  # First 10 headers
            })

            # Count rows
            row_count = await page.locator("table tbody tr, [role='row']").count()

            test_result["tests"].append({
                "test_case": "Count table rows",
                "status": "passed",
                "details": f"{row_count} rows in table"
            })

            self._emit_event(run_id, artifacts_path, "table_validated", {
                "headers": actual_headers[:10],
                "row_count": row_count
            })

            test_result["status"] = "passed" if all(t["status"] == "passed" for t in test_result["tests"]) else "failed"

        except Exception as e:
            logger.error(f"[{run_id}] Error in table validation: {e}")
            test_result["status"] = "error"
            test_result["error"] = str(e)

        return test_result

    async def _discover_top_dropdowns(
        self,
        page,
        run_id: str,
        artifacts_path: str,
        base_domain: str,
        discovery_dir: Path,
        debug: bool,
    ) -> List[Dict[str, Any]]:
        """Discover top dropdowns (tenant/project/cell selectors) without switching contexts."""
        dropdowns = []
        
        try:
            for selector in self.DROPDOWN_TRIGGER_SELECTORS:
                try:
                    elements = page.locator(selector)
                    count = await elements.count()
                    
                    for i in range(min(count, 10)):
                        try:
                            element = elements.nth(i)
                            
                            # Get label/placeholder
                            label_text = ""
                            try:
                                # Try to find associated label
                                label = element.locator("xpath=ancestor::label | preceding-sibling::label | following-sibling::label").first
                                if await label.count() > 0:
                                    label_text = await label.inner_text()
                            except:
                                pass
                            
                            if not label_text:
                                # Try placeholder or aria-label
                                label_text = await element.get_attribute("placeholder") or ""
                                if not label_text:
                                    label_text = await element.get_attribute("aria-label") or ""
                            
                            # Check if it's a context selector (tenant/project/cell)
                            text_lower = label_text.lower()
                            is_context = any(keyword in text_lower for keyword in ["tenant", "project", "cell", "organization", "org"])
                            
                            if is_context or selector == "select":
                                # Try to enumerate options
                                options = []
                                
                                if selector == "select":
                                    # Native select
                                    option_elements = element.locator("option")
                                    opt_count = await option_elements.count()
                                    for j in range(min(opt_count, 20)):
                                        try:
                                            opt = option_elements.nth(j)
                                            opt_text = await opt.inner_text()
                                            opt_value = await opt.get_attribute("value") or opt_text
                                            if opt_text.strip():
                                                options.append({
                                                    "text": opt_text.strip(),
                                                    "value": opt_value
                                                })
                                        except:
                                            continue
                                else:
                                    # Custom dropdown - try to click and enumerate
                                    try:
                                        # Instrumented click (debug-only; does not change traversal logic)
                                        await self._instrumented_action(
                                            run_id=run_id,
                                            artifacts_path=artifacts_path,
                                            discovery_dir=discovery_dir,
                                            debug=debug,
                                            page=page,
                                            action="click",
                                            element_text=label_text or "dropdown",
                                            element_role_or_tag=selector,
                                            selector_hint=selector,
                                            do=lambda: element.click(timeout=2000),
                                        )
                                        await asyncio.sleep(0.5)
                                        
                                        # Look for dropdown menu
                                        menu_selectors = [
                                            "[role='listbox']",
                                            "[role='menu']",
                                            ".dropdown-menu",
                                            ".select-menu",
                                            "[aria-expanded='true'] + *"
                                        ]
                                        
                                        for menu_sel in menu_selectors:
                                            try:
                                                menu = page.locator(menu_sel).first
                                                if await menu.count() > 0:
                                                    opt_elements = menu.locator("[role='option'], .option, li, a")
                                                    opt_count = await opt_elements.count()
                                                    
                                                    for j in range(min(opt_count, 20)):
                                                        try:
                                                            opt = opt_elements.nth(j)
                                                            opt_text = await opt.inner_text()
                                                            if opt_text.strip():
                                                                options.append({
                                                                    "text": opt_text.strip(),
                                                                    "value": opt_text.strip()
                                                                })
                                                        except:
                                                            continue
                                                    
                                                    if options:
                                                        break
                                            except:
                                                continue
                                        
                                        # Close dropdown (click outside or ESC)
                                        try:
                                            await page.keyboard.press("Escape")
                                        except:
                                            pass
                                    except:
                                        pass
                                
                                if options:
                                    dropdowns.append({
                                        "type": "context_selector" if is_context else "dropdown",
                                        "label": label_text or f"Dropdown {i+1}",
                                        "selector": selector,
                                        "options": options,
                                        "options_count": len(options)
                                    })
                        except Exception as e:
                            logger.debug(f"[{run_id}] Error processing dropdown {i}: {e}")
                            continue
                except:
                    continue
        except Exception as e:
            logger.warning(f"[{run_id}] Error discovering dropdowns: {e}")
        
        return dropdowns

    async def _switch_contexts_and_discover(
        self,
        page,
        dropdowns: List[Dict[str, Any]],
        run_id: str,
        artifacts_path: str,
        base_url: str,
        base_domain: str,
        discovery_dir: Path,
        debug: bool
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Switch through all contexts and run discovery for each."""
        context_discoveries = {}

        # Filter for context selectors only
        context_selectors = [d for d in dropdowns if d.get("type") == "context_selector"]

        if not context_selectors:
            logger.info(f"[{run_id}] No context selectors found, skipping context switching")
            return context_discoveries

        for dropdown in context_selectors:
            options = dropdown.get("options", [])
            label = dropdown.get("label", "Context")

            # Use config to determine how many contexts to explore
            max_contexts = self.config.max_contexts_to_explore
            contexts_to_explore = len(options) if max_contexts is None else min(len(options), max_contexts)

            logger.info(f"[{run_id}] Found {len(options)} contexts in '{label}', will explore {contexts_to_explore}")

            for idx, option in enumerate(options[:contexts_to_explore]):
                try:
                    context_name = option.get("text", f"Context{idx+1}")

                    self._emit_event(run_id, artifacts_path, "context_switching", {
                        "context_name": context_name,
                        "context_index": idx + 1,
                        "total_contexts": contexts_to_explore,
                        "selector_label": label
                    })

                    logger.info(f"[{run_id}] Switching to context: {context_name} ({idx+1}/{contexts_to_explore})")

                    # Navigate back to base URL
                    await page.goto(base_url, wait_until="networkidle", timeout=30000)
                    await asyncio.sleep(1.0)

                    # Find and click the dropdown
                    selector = dropdown.get("selector")
                    dropdown_element = page.locator(selector).first

                    if await dropdown_element.count() == 0:
                        logger.warning(f"[{run_id}] Dropdown not found for context switching")
                        continue

                    # For native select
                    if selector == "select":
                        await dropdown_element.select_option(value=option.get("value"))
                        await asyncio.sleep(1.0)
                    else:
                        # For custom dropdown
                        await dropdown_element.click()
                        await asyncio.sleep(0.5)

                        # Find and click the option
                        menu_selectors = [
                            "[role='listbox']",
                            "[role='menu']",
                            ".dropdown-menu",
                            ".select-menu"
                        ]

                        clicked = False
                        for menu_sel in menu_selectors:
                            try:
                                menu = page.locator(menu_sel).first
                                if await menu.count() > 0:
                                    opt_elements = menu.locator("[role='option'], .option, li, a")
                                    opt_count = await opt_elements.count()

                                    for j in range(opt_count):
                                        try:
                                            opt = opt_elements.nth(j)
                                            opt_text = await opt.inner_text()

                                            if opt_text.strip() == context_name:
                                                await opt.click()
                                                await asyncio.sleep(1.5)  # Wait for context switch
                                                clicked = True
                                                break
                                        except:
                                            continue

                                    if clicked:
                                        break
                            except:
                                continue

                        if not clicked:
                            logger.warning(f"[{run_id}] Failed to click context option: {context_name}")
                            continue

                    # Wait for page reload after context switch
                    try:
                        await page.wait_for_load_state("networkidle", timeout=10000)
                    except:
                        pass

                    self._emit_event(run_id, artifacts_path, "context_switched", {
                        "context_name": context_name,
                        "new_url": page.url
                    })

                    logger.info(f"[{run_id}] Successfully switched to context: {context_name}")

                    # Run mini-discovery for this context (just navigation, not full recursive)
                    # This discovers the unique pages/navigation in this context
                    try:
                        # Discover navigation for this context
                        nav_items = await self._discover_sidebar_navigation(
                            page, run_id, artifacts_path, base_domain, discovery_dir, debug
                        )

                        context_discoveries[context_name] = {
                            "navigation_items": nav_items,
                            "context_index": idx + 1
                        }

                        logger.info(f"[{run_id}] Context '{context_name}' has {len(nav_items)} navigation items")

                    except Exception as e:
                        logger.warning(f"[{run_id}] Error discovering in context '{context_name}': {e}")

                except Exception as e:
                    logger.warning(f"[{run_id}] Error switching to context {option.get('text')}: {e}")
                    continue

        return context_discoveries

    async def _perform_sanity_get_operations(
        self,
        page,
        api_endpoints: List[Dict[str, Any]],
        run_id: str,
        artifacts_path: str
    ) -> List[Dict[str, Any]]:
        """Perform GET operations on discovered API endpoints for sanity validation."""
        sanity_results = []

        # Filter for GET endpoints only
        get_endpoints = [ep for ep in api_endpoints if ep.get("method", "").upper() == "GET"]

        logger.info(f"[{run_id}] Testing {len(get_endpoints)} GET API endpoints")

        for endpoint in get_endpoints[:50]:  # Limit to first 50 endpoints
            try:
                url = endpoint.get("url", "")
                if not url:
                    continue

                self._emit_event(run_id, artifacts_path, "api_endpoint_testing", {
                    "url": url,
                    "method": "GET"
                })

                # Make the API request using page.evaluate to use the browser's session
                start_time = asyncio.get_event_loop().time()

                try:
                    response_data = await page.evaluate(f"""
                        async () => {{
                            try {{
                                const response = await fetch('{url}');
                                return {{
                                    status: response.status,
                                    statusText: response.statusText,
                                    ok: response.ok,
                                    headers: Object.fromEntries(response.headers.entries()),
                                    contentType: response.headers.get('content-type')
                                }};
                            }} catch (error) {{
                                return {{
                                    status: 0,
                                    statusText: error.message,
                                    ok: false,
                                    error: error.message
                                }};
                            }}
                        }}
                    """)

                    elapsed = (asyncio.get_event_loop().time() - start_time) * 1000  # Convert to ms

                    result = {
                        "url": url,
                        "method": "GET",
                        "status": response_data.get("status"),
                        "status_text": response_data.get("statusText"),
                        "ok": response_data.get("ok", False),
                        "response_time_ms": round(elapsed, 2),
                        "content_type": response_data.get("contentType", "")
                    }

                    # Determine if this is a pass or fail
                    status = response_data.get("status", 0)
                    if status >= 200 and status < 400:
                        result["sanity_status"] = "pass"
                    elif status >= 400 and status < 500:
                        result["sanity_status"] = "client_error"
                    elif status >= 500:
                        result["sanity_status"] = "server_error"
                    else:
                        result["sanity_status"] = "unknown"

                    sanity_results.append(result)

                    self._emit_event(run_id, artifacts_path, "api_endpoint_tested", {
                        "url": url,
                        "status": status,
                        "response_time_ms": result["response_time_ms"],
                        "sanity_status": result["sanity_status"]
                    })

                except Exception as e:
                    logger.debug(f"[{run_id}] Error testing endpoint {url}: {e}")
                    sanity_results.append({
                        "url": url,
                        "method": "GET",
                        "status": 0,
                        "sanity_status": "error",
                        "error": str(e)
                    })

            except Exception as e:
                logger.debug(f"[{run_id}] Error processing endpoint: {e}")
                continue

        # Log summary
        pass_count = len([r for r in sanity_results if r.get("sanity_status") == "pass"])
        fail_count = len([r for r in sanity_results if r.get("sanity_status") in ["client_error", "server_error", "error"]])

        logger.info(f"[{run_id}] API Sanity: {pass_count} passed, {fail_count} failed out of {len(sanity_results)} tested")

        return sanity_results

    async def _discover_sidebar_navigation(
        self,
        page,
        run_id: str,
        artifacts_path: str,
        base_domain: str,
        discovery_dir: Path,
        debug: bool,
    ) -> List[Dict[str, Any]]:
        """Discover sidebar navigation by clicking menu items and collapsible sections to reveal submenus."""
        nav_items = []
        discovered_urls: Set[str] = set()
        discovered_texts: Set[str] = set()  # Track by text to avoid duplicates

        logger.info(f"[{run_id}] === SIDEBAR NAVIGATION DISCOVERY START ===")
        logger.info(f"[{run_id}] Testing {len(self.SIDEBAR_SELECTORS)} standard sidebar selectors...")

        try:
            # Find sidebar/nav containers
            sidebar_found = False
            for sidebar_sel in self.SIDEBAR_SELECTORS:
                try:
                    sidebars = page.locator(sidebar_sel)
                    count = await sidebars.count()
                    logger.info(f"[{run_id}] Found {count} sidebar(s) with selector: {sidebar_sel}")

                    for sidebar_idx in range(min(count, 3)):  # Max 3 sidebars
                        sidebar = sidebars.nth(sidebar_idx)
                        sidebar_found = True
                        
                        # First, find and expand all collapsible sections (RESOURCES, ADMIN, etc.)
                        await self._expand_collapsible_sections(
                            sidebar, page, run_id, artifacts_path, discovery_dir, debug
                        )
                        
                        # Find menu items in this sidebar (after expanding)
                        for menu_sel in self.MENU_ITEM_SELECTORS:
                            try:
                                items = sidebar.locator(menu_sel)
                                item_count = await items.count()
                                
                                for i in range(min(item_count, 100)):  # Increased limit
                                    try:
                                        item = items.nth(i)
                                        
                                        # Get text and href
                                        text = await item.inner_text()
                                        href = await item.get_attribute("href")
                                        
                                        # Skip if no text or destructive
                                        if not text.strip() or self._is_destructive(text):
                                            continue
                                        
                                        # Check if it's a button or has expandable indicator
                                        tag_name = await item.evaluate("el => el.tagName.toLowerCase()")
                                        is_button = tag_name == "button" or await item.get_attribute("role") == "button"
                                        
                                        # Check for expandable indicators (arrows, aria-expanded)
                                        has_arrow = await self._has_expandable_indicator(item)
                                        aria_expanded = await item.get_attribute("aria-expanded")
                                        is_collapsed = aria_expanded == "false" or (has_arrow and aria_expanded is None)
                                        
                                        # Click to expand if collapsed
                                        if is_collapsed:
                                            await self._instrumented_action(
                                                run_id=run_id,
                                                artifacts_path=artifacts_path,
                                                discovery_dir=discovery_dir,
                                                debug=debug,
                                                page=page,
                                                action="expand",
                                                element_text=text.strip(),
                                                element_role_or_tag=tag_name,
                                                selector_hint=menu_sel,
                                                do=lambda: item.click(timeout=2000),
                                            )
                                            await asyncio.sleep(0.8)  # Wait for expansion
                                        
                                        # Also click if it's a button or has no href (might reveal submenu)
                                        if (is_button or not href) and not is_collapsed:
                                            await self._instrumented_action(
                                                run_id=run_id,
                                                artifacts_path=artifacts_path,
                                                discovery_dir=discovery_dir,
                                                debug=debug,
                                                page=page,
                                                action="click",
                                                element_text=text.strip(),
                                                element_role_or_tag=tag_name,
                                                selector_hint=menu_sel,
                                                do=lambda: item.click(timeout=2000),
                                            )
                                            await asyncio.sleep(0.5)
                                        
                                        # Check for submenu items after clicking
                                        submenu_items = []
                                        await self._find_submenu_items(
                                            item,
                                            page,
                                            base_domain,
                                            discovered_urls,
                                            submenu_items,
                                            run_id,
                                            artifacts_path,
                                            discovery_dir,
                                            debug,
                                        )
                                        
                                        # Add main item if it has href OR is clickable (button/interactive element)
                                        text_key = text.strip().lower()
                                        if text_key and text_key not in discovered_texts:
                                            discovered_texts.add(text_key)

                                            if href:
                                                full_url = urljoin(page.url, href)
                                                parsed = urlparse(full_url)

                                                if (parsed.netloc == base_domain or parsed.netloc == "") and href not in discovered_urls:
                                                    nav_path = text.strip()
                                                    nav_items.append({
                                                        "text": text.strip()[:100],
                                                        "href": href,
                                                        "full_url": full_url,
                                                        "nav_path": nav_path,
                                                        "submenu_items": submenu_items,
                                                        "is_resource": "RESOURCE" in text.upper() or "RESOURCES" in text.upper() or any(word in text.lower() for word in ["virtual", "machine", "network", "storage", "image", "instance"])
                                                    })
                                                    discovered_urls.add(href)
                                            elif is_button or await item.get_attribute("role") in ["button", "menuitem", "tab"]:
                                                # Add clickable items without href (buttons, menu items)
                                                nav_items.append({
                                                    "text": text.strip()[:100],
                                                    "href": None,
                                                    "full_url": page.url,  # Current URL since no href
                                                    "nav_path": text.strip(),
                                                    "element": menu_sel,  # Store selector for clicking
                                                    "submenu_items": submenu_items,
                                                    "is_resource": any(word in text.lower() for word in ["virtual", "machine", "network", "storage", "image", "instance", "compute", "volume"])
                                                })

                                        # Add submenu items
                                        for sub_item in submenu_items:
                                            nav_path = f"{text.strip()} > {sub_item['text']}"
                                            submenu_text_key = sub_item['text'].lower()
                                            if submenu_text_key not in discovered_texts:
                                                discovered_texts.add(submenu_text_key)
                                                nav_items.append({
                                                    "text": sub_item["text"],
                                                    "href": sub_item["href"],
                                                    "full_url": sub_item["full_url"],
                                                    "nav_path": nav_path,
                                                    "submenu_items": [],
                                                    "is_resource": True
                                                })
                                    except Exception as e:
                                        logger.debug(f"[{run_id}] Error processing nav item {i}: {e}")
                                        continue
                            except:
                                continue
                except Exception as e:
                    logger.debug(f"[{run_id}] Error with sidebar selector {sidebar_sel}: {e}")
                    continue
        except Exception as e:
            logger.warning(f"[{run_id}] Error discovering sidebar navigation: {e}")

        # FALLBACK: If no nav items found from structured sidebar, do aggressive link collection
        if len(nav_items) == 0:
            logger.warning(f"[{run_id}] No navigation items found via sidebar selectors. Falling back to aggressive link collection...")
            try:
                # STRATEGY 1: Try to find sidebar by visual characteristics (dark background, fixed position, left side)
                # Look for divs/sections that might be sidebars
                potential_sidebars = page.locator("div:visible, section:visible, aside:visible")
                sidebar_count = await potential_sidebars.count()
                logger.info(f"[{run_id}] Fallback: Scanning {sidebar_count} potential sidebar containers...")

                sidebar_elements_found = []
                for i in range(min(sidebar_count, 50)):  # Check first 50 containers
                    try:
                        container = potential_sidebars.nth(i)

                        # Check if this looks like a sidebar (narrow width, full height, left position)
                        bounding_box = await container.bounding_box()
                        if not bounding_box:
                            continue

                        width = bounding_box['width']
                        height = bounding_box['height']
                        x = bounding_box['x']

                        # Get viewport height for relative sizing
                        viewport = await page.viewport_size()
                        viewport_height = viewport['height']

                        # Sidebar characteristics: wider range (50-400px), at least half viewport height, on left side (x < 150)
                        if (50 < width < 400 and
                            x < 150 and
                            height > viewport_height * 0.5):
                            logger.info(f"[{run_id}] Fallback: Found potential sidebar at x={x}, width={width}, height={height}")

                            # Get all clickable elements in this sidebar (including hidden/collapsed items)
                            sidebar_links = container.locator("a, button, [role='button'], [role='menuitem'], [role='tab'], div[onclick]")
                            sidebar_link_count = await sidebar_links.count()

                            # Verify it has enough links to be a real navigation sidebar
                            if sidebar_link_count >= 3:
                                logger.info(f"[{run_id}] CONFIRMED sidebar: {sidebar_link_count} nav elements")
                            else:
                                logger.debug(f"[{run_id}] Skipping container: only {sidebar_link_count} clickable elements (need >= 3)")
                                continue

                            for j in range(min(sidebar_link_count, 100)):
                                try:
                                    link = sidebar_links.nth(j)
                                    text = await link.inner_text()
                                    text = text.strip()

                                    if not text or len(text) > 50:  # Skip empty or very long text
                                        continue

                                    if self._is_destructive(text):
                                        continue

                                    text_key = text.lower()
                                    if text_key in discovered_texts:
                                        continue

                                    discovered_texts.add(text_key)

                                    href = await link.get_attribute("href")
                                    if href:
                                        full_url = urljoin(page.url, href)
                                        parsed = urlparse(full_url)

                                        if parsed.netloc == base_domain or parsed.netloc == "":
                                            is_resource = any(word in text.lower() for word in ["virtual", "machine", "network", "storage", "image", "instance", "compute", "volume", "server", "database", "container"])

                                            sidebar_elements_found.append({
                                                "text": text[:100],
                                                "href": href,
                                                "full_url": full_url,
                                                "nav_path": text,
                                                "submenu_items": [],
                                                "is_resource": is_resource
                                            })
                                            logger.debug(f"[{run_id}] Fallback: Sidebar link '{text}' -> {href}")
                                    else:
                                        # Button without href
                                        tag_name = await link.evaluate("el => el.tagName.toLowerCase()")
                                        role = await link.get_attribute("role")

                                        if tag_name == "button" or role in ["button", "menuitem", "tab"]:
                                            is_resource = any(word in text.lower() for word in ["virtual", "machine", "network", "storage", "image", "instance", "compute", "volume"])

                                            sidebar_elements_found.append({
                                                "text": text[:100],
                                                "href": None,
                                                "full_url": page.url,
                                                "nav_path": text,
                                                "submenu_items": [],
                                                "is_resource": is_resource,
                                                "clickable_element": True
                                            })
                                            logger.debug(f"[{run_id}] Fallback: Sidebar button '{text}'")

                                except Exception as e:
                                    logger.debug(f"[{run_id}] Error collecting sidebar link {j}: {e}")
                                    continue

                    except Exception as e:
                        continue

                if len(sidebar_elements_found) > 0:
                    nav_items.extend(sidebar_elements_found)
                    logger.info(f"[{run_id}] Strategy A (Visual): {len(sidebar_elements_found)} items found")

                # STRATEGY B: Text-content search if visual detection found nothing/little
                if len(nav_items) < 5:  # Less than 5 items suggests we missed the real sidebar
                    logger.warning(f"[{run_id}] Visual detection found only {len(nav_items)} items. Trying text-content search...")

                    text_based_items = await self._find_navigation_by_text_content(
                        page, run_id, base_domain, discovered_texts
                    )

                    nav_items.extend(text_based_items)
                    logger.info(f"[{run_id}] After text search: {len(nav_items)} total items")

                # STRATEGY C: If still nothing, collect ALL clickable links and buttons on the page
                if len(nav_items) == 0:
                    logger.warning(f"[{run_id}] Strategies A & B found 0 items. Activating Strategy C (Aggressive)...")
                    all_links = page.locator("a[href], button:visible, [role='button']:visible, [role='menuitem']:visible")
                    link_count = await all_links.count()
                    logger.info(f"[{run_id}] Strategy C: Found {link_count} clickable elements on page")

                    for i in range(min(link_count, 200)):  # Limit to 200 to avoid explosion
                        try:
                            link = all_links.nth(i)
                            text = await link.inner_text()
                            text = text.strip()

                            if not text or len(text) > 100:
                                continue

                            if self._is_destructive(text):
                                continue

                            # Skip common false positives
                            skip_patterns = [
                                "search", "logout", "login", "sign in", "sign out",
                                "help", "support", "documentation", "close", "cancel",
                                "×", "menu", "toggle", "expand", "collapse",
                                "more", "less", "show", "hide"
                            ]
                            if any(pattern in text.lower() for pattern in skip_patterns):
                                continue

                            text_key = text.lower()
                            if text_key in discovered_texts:
                                continue

                            discovered_texts.add(text_key)

                            href = await link.get_attribute("href")
                            if href:
                                full_url = urljoin(page.url, href)
                                parsed = urlparse(full_url)

                                # Only add same-domain links
                                if parsed.netloc == base_domain or parsed.netloc == "":
                                    # Detect if it's a resource based on comprehensive keywords
                                    navigation_keywords = [
                                        # Resources
                                        "virtual", "machine", "instance", "compute", "server",
                                        "network", "storage", "volume", "image", "snapshot",
                                        "database", "container", "cluster", "node", "pod",
                                        # Common navigation
                                        "dashboard", "overview", "monitor", "admin", "settings",
                                        "users", "groups", "roles", "permissions", "access",
                                        # Actions/views
                                        "list", "view", "manage", "create", "edit"
                                    ]
                                    is_resource = any(word in text.lower() for word in navigation_keywords)

                                    nav_items.append({
                                        "text": text[:100],
                                        "href": href,
                                        "full_url": full_url,
                                        "nav_path": text,
                                        "submenu_items": [],
                                        "is_resource": is_resource
                                    })
                                    logger.debug(f"[{run_id}] Fallback: Added link '{text}' -> {href}")
                            else:
                                # Button without href
                                tag_name = await link.evaluate("el => el.tagName.toLowerCase()")
                                role = await link.get_attribute("role")

                                if tag_name == "button" or role in ["button", "menuitem", "tab"]:
                                    # Use same comprehensive keywords for buttons
                                    navigation_keywords = [
                                        "virtual", "machine", "instance", "compute", "server",
                                        "network", "storage", "volume", "image", "snapshot",
                                        "database", "container", "cluster", "node", "pod",
                                        "dashboard", "overview", "monitor", "admin", "settings",
                                        "users", "groups", "roles", "permissions", "access",
                                        "list", "view", "manage", "create", "edit"
                                    ]
                                    is_resource = any(word in text.lower() for word in navigation_keywords)

                                    nav_items.append({
                                        "text": text[:100],
                                        "href": None,
                                        "full_url": page.url,
                                        "nav_path": text,
                                        "submenu_items": [],
                                        "is_resource": is_resource,
                                        "clickable_element": True
                                    })
                                    logger.debug(f"[{run_id}] Fallback: Added clickable button '{text}'")

                        except Exception as e:
                            logger.debug(f"[{run_id}] Error collecting fallback link {i}: {e}")
                            continue

                    logger.info(f"[{run_id}] Strategy C (Aggressive): Collected {len(nav_items)} navigation items")

            except Exception as e:
                logger.error(f"[{run_id}] Error in fallback link collection: {e}")

        logger.info(f"[{run_id}] === TOTAL NAVIGATION ITEMS: {len(nav_items)} ===")
        return nav_items

    async def _find_navigation_by_text_content(
        self,
        page,
        run_id: str,
        base_domain: str,
        discovered_texts: Set[str]
    ) -> List[Dict[str, Any]]:
        """
        Strategy B: Find navigation elements by searching for resource-related text.

        Uses JavaScript to scan entire page for elements containing navigation keywords.
        """
        nav_items = []

        # Keywords that suggest navigation/resource items
        navigation_keywords = [
            "virtual", "machine", "instance", "compute",
            "network", "storage", "volume", "image",
            "database", "container", "server", "cluster",
            "dashboard", "overview", "monitor", "settings"
        ]

        logger.info(f"[{run_id}] Strategy B: Searching by text content...")

        # Use JavaScript to find ALL elements containing these keywords
        js_code = """
        (keywords) => {
            const results = [];

            // Get all clickable elements
            const elements = document.querySelectorAll('a, button, [role="button"], [role="menuitem"], [role="tab"], div[onclick]');

            for (const el of elements) {
                const text = el.innerText || el.textContent || '';
                const textLower = text.toLowerCase().trim();

                // Check if element text contains any navigation keyword
                for (const keyword of keywords) {
                    if (textLower.includes(keyword) && textLower.length < 100) {
                        results.push({
                            text: text.trim(),
                            href: el.href || null,
                            tagName: el.tagName.toLowerCase(),
                            role: el.getAttribute('role'),
                            visible: el.offsetParent !== null
                        });
                        break;  // Don't add same element multiple times
                    }
                }
            }

            return results;
        }
        """

        try:
            # Execute JavaScript to find elements
            found_elements = await page.evaluate(js_code, navigation_keywords)

            logger.info(f"[{run_id}] Strategy B: Found {len(found_elements)} elements with navigation keywords")

            for elem_data in found_elements:
                text = elem_data['text']
                text_key = text.lower()

                # Skip duplicates
                if text_key in discovered_texts:
                    continue

                discovered_texts.add(text_key)

                href = elem_data.get('href')
                if href:
                    # It's a link
                    full_url = urljoin(page.url, href)
                    parsed = urlparse(full_url)

                    if parsed.netloc == base_domain or parsed.netloc == "":
                        nav_items.append({
                            "text": text[:100],
                            "href": href,
                            "full_url": full_url,
                            "nav_path": text,
                            "submenu_items": [],
                            "is_resource": True,  # Found via resource keywords
                            "source": "text_content_search"
                        })
                        logger.debug(f"[{run_id}] Strategy B: Added '{text}' -> {href}")
                else:
                    # It's a button/clickable element
                    nav_items.append({
                        "text": text[:100],
                        "href": None,
                        "full_url": page.url,
                        "nav_path": text,
                        "submenu_items": [],
                        "is_resource": True,
                        "clickable_element": True,
                        "source": "text_content_search"
                    })
                    logger.debug(f"[{run_id}] Strategy B: Added button '{text}'")

        except Exception as e:
            logger.error(f"[{run_id}] Strategy B failed: {e}")

        logger.info(f"[{run_id}] Strategy B: Collected {len(nav_items)} navigation items")
        return nav_items

    async def _expand_collapsible_sections(self, sidebar, page, run_id: str, artifacts_path: str, discovery_dir: Path, debug: bool):
        """Find and expand all collapsible sections (RESOURCES, ADMIN, etc.) in sidebar."""
        try:
            # Find collapsible section headers (items with arrows, aria-expanded, etc.)
            collapsible_selectors = [
                "[aria-expanded='false']",
                "[aria-expanded='true']",  # Also check expanded ones to ensure we see all
                "button[aria-expanded]",
                ".collapsible",
                ".expandable",
                "[data-toggle='collapse']"
            ]
            
            for selector in collapsible_selectors:
                try:
                    collapsibles = sidebar.locator(selector)
                    count = await collapsibles.count()
                    
                    for i in range(min(count, 20)):  # Max 20 collapsible sections
                        try:
                            collapsible = collapsibles.nth(i)
                            text = await collapsible.inner_text()
                            
                            # Skip if destructive
                            if self._is_destructive(text):
                                continue
                            
                            # Check if collapsed
                            aria_expanded = await collapsible.get_attribute("aria-expanded")
                            if aria_expanded == "false" or (aria_expanded is None and await self._has_expandable_indicator(collapsible)):
                                logger.info(f"[{run_id}] Expanding collapsible section: {text.strip()[:50]}")
                                await self._instrumented_action(
                                    run_id=run_id,
                                    artifacts_path=artifacts_path,
                                    discovery_dir=discovery_dir,
                                    debug=debug,
                                    page=page,
                                    action="expand",
                                    element_text=text.strip(),
                                    element_role_or_tag="expand",
                                    selector_hint=selector,
                                    do=lambda: collapsible.click(timeout=2000),
                                )
                        except:
                            continue
                except:
                    continue
        except Exception as e:
            logger.warning(f"[{run_id}] Error expanding collapsible sections: {e}")
    
    async def _has_expandable_indicator(self, element) -> bool:
        """Check if element has expandable indicator (arrow, chevron, etc.)."""
        try:
            # Check for arrow/chevron icons
            arrow_selectors = [
                "svg[class*='arrow']",
                "svg[class*='chevron']",
                "i[class*='arrow']",
                "i[class*='chevron']",
                ".arrow",
                ".chevron",
                "[class*='expand']",
                "[class*='collapse']"
            ]
            
            for sel in arrow_selectors:
                try:
                    arrow = element.locator(sel).first
                    if await arrow.count() > 0:
                        return True
                except:
                    continue
            
            # Check aria attributes
            aria_haspopup = await element.get_attribute("aria-haspopup")
            if aria_haspopup:
                return True
            
            return False
        except:
            return False
    
    async def _find_submenu_items(
        self,
        parent_item,
        page,
        base_domain: str,
        discovered_urls: Set[str],
        submenu_items: List[Dict],
        run_id: str,
        artifacts_path: str,
        discovery_dir: Path,
        debug: bool,
    ):
        """Find submenu items under a parent item."""
        try:
            # Look for submenu in various locations
            submenu_selectors = [
                "xpath=following-sibling::*",
                "xpath=following-sibling::ul",
                "xpath=following-sibling::div",
                "xpath=ancestor::*//ul[contains(@class, 'submenu')]",
                "xpath=ancestor::*//div[contains(@class, 'submenu')]",
                "[role='menu']",
                ".submenu",
                ".sub-menu",
                ".dropdown-menu",
                "[aria-expanded='true'] + *"
            ]
            
            for submenu_sel in submenu_selectors:
                try:
                    # Try to find submenu relative to parent
                    submenu = parent_item.locator(submenu_sel).first
                    if await submenu.count() == 0:
                        # Try finding in parent's parent
                        parent = parent_item.locator("xpath=parent::*").first
                        if await parent.count() > 0:
                            submenu = parent.locator(submenu_sel).first
                    
                    if await submenu.count() > 0:
                        # Find links in submenu
                        sub_links = submenu.locator("a, button")
                        sub_link_count = await sub_links.count()
                        
                        for j in range(min(sub_link_count, 30)):  # Increased limit
                            try:
                                sub_link = sub_links.nth(j)
                                sub_text = await sub_link.inner_text()
                                sub_href = await sub_link.get_attribute("href")
                                
                                if sub_text.strip() and not self._is_destructive(sub_text):
                                    if sub_href:
                                        full_url = urljoin(page.url, sub_href)
                                        parsed = urlparse(full_url)
                                        
                                        if (parsed.netloc == base_domain or parsed.netloc == "") and sub_href not in discovered_urls:
                                            submenu_items.append({
                                                "text": sub_text.strip()[:100],
                                                "href": sub_href,
                                                "full_url": full_url
                                            })
                                            discovered_urls.add(sub_href)
                                    else:
                                        # Button without href - might be expandable
                                        has_arrow = await self._has_expandable_indicator(sub_link)
                                        if has_arrow:
                                            await self._instrumented_action(
                                                run_id=run_id,
                                                artifacts_path=artifacts_path,
                                                discovery_dir=discovery_dir,
                                                debug=debug,
                                                page=page,
                                                action="expand",
                                                element_text=sub_text.strip(),
                                                element_role_or_tag="submenu_button",
                                                selector_hint="submenu",
                                                do=lambda: sub_link.click(timeout=2000),
                                            )
                                            await asyncio.sleep(0.5)
                                            # Recursively find nested submenus
                                            await self._find_submenu_items(
                                                sub_link,
                                                page,
                                                base_domain,
                                                discovered_urls,
                                                submenu_items,
                                                run_id,
                                                artifacts_path,
                                                discovery_dir,
                                                debug,
                                            )
                            except:
                                continue
                        
                        if submenu_items:
                            break
                except:
                    continue
        except Exception as e:
            logger.debug(f"[{run_id}] Error finding submenu items: {e}")
    
    async def _deep_discover_page_enhanced(
        self,
        page,
        current_url: str,
        visited_urls: Set[str],
        visited_fingerprints: Set[str],
        visited_pages: List[Dict],
        forms_found: List[Dict],
        base_domain: str,
        run_id: str,
        discovery_dir: Path,
        max_pages: int,
        artifacts_path: str,
        nav_path: str,
        debug: bool = False
    ):
        """Enhanced deep discovery with fingerprinting."""
        try:
            if len(visited_pages) >= max_pages:
                return
            
            # Click on cards/tiles
            card_selectors = [".card", ".tile", "[role='article']", ".grid-item", ".list-item"]
            for selector in card_selectors:
                if len(visited_pages) >= max_pages:
                    break
                try:
                    cards = page.locator(selector)
                    count = await cards.count()
                    for i in range(min(count, 10)):
                        if len(visited_pages) >= max_pages:
                            break
                        try:
                            card = cards.nth(i)
                            link = card.locator("a").first
                            if await link.count() > 0:
                                href = await link.get_attribute("href")
                                if href:
                                    full_url = urljoin(page.url, href)
                                    parsed = urlparse(full_url)

                                    # Normalize URL before checking
                                    normalized_url = self._normalize_url(full_url)

                                    if (parsed.netloc == base_domain or parsed.netloc == "") and normalized_url not in visited_urls:
                                        # Mark as visited BEFORE clicking (optimistic locking)
                                        visited_urls.add(normalized_url)

                                        try:
                                            await link.click(timeout=5000)
                                            await asyncio.sleep(2)
                                            await page.wait_for_load_state("networkidle", timeout=10000)

                                            new_url = page.url
                                            normalized_new = self._normalize_url(new_url)

                                            # Mark final URL too (handles redirects)
                                            visited_urls.add(normalized_new)

                                            # Only analyze if fingerprint is new
                                            page_info = await self._analyze_page_enhanced(
                                                page, new_url, f"Card {i+1}", run_id, discovery_dir, len(visited_pages), artifacts_path
                                            )
                                            heading = page_info.get("page_signature", {}).get("heading", "")
                                            fingerprint = self._create_fingerprint(nav_path, new_url, heading)

                                            if fingerprint not in visited_fingerprints:
                                                visited_pages.append(page_info)
                                                visited_fingerprints.add(fingerprint)
                                            
                                            # Check for forms and do deep discovery
                                            if page_info.get("forms"):
                                                forms_found.extend(page_info["forms"])
                                            
                                            await self._deep_discover_page_enhanced(
                                                page, new_url, visited_urls, visited_fingerprints, visited_pages, forms_found,
                                                base_domain, run_id, discovery_dir, max_pages, artifacts_path, nav_path, debug
                                            )
                                        except Exception as e:
                                            # Rollback on error
                                            visited_urls.discard(normalized_url)
                                            logger.warning(f"[{run_id}] Failed to visit card {i+1}: {e}")
                                            continue
                                        
                                        await page.go_back(timeout=10000)
                                        await asyncio.sleep(1)
                        except:
                            continue
                except:
                    continue
            
            # Explore tabs
            tab_selectors = ["[role='tab']", ".tab", ".tab-item"]
            for selector in tab_selectors:
                if len(visited_pages) >= max_pages:
                    break
                try:
                    tabs = page.locator(selector)
                    count = await tabs.count()
                    for i in range(min(count, 5)):
                        try:
                            tab = tabs.nth(i)
                            current_url_before_click = page.url
                            await tab.click(timeout=2000)
                            await asyncio.sleep(1)

                            new_url = page.url
                            normalized_new = self._normalize_url(new_url)

                            if normalized_new not in visited_urls and (urlparse(new_url).netloc == base_domain or urlparse(new_url).netloc == ""):
                                # Mark as visited
                                visited_urls.add(normalized_new)

                                page_info = await self._analyze_page_enhanced(
                                    page, new_url, f"Tab {i+1}", run_id, discovery_dir, len(visited_pages), artifacts_path
                                )
                                heading = page_info.get("page_signature", {}).get("heading", "")
                                fingerprint = self._create_fingerprint(nav_path, new_url, heading)

                                if fingerprint not in visited_fingerprints:
                                    visited_pages.append(page_info)
                                    visited_fingerprints.add(fingerprint)
                                    
                                    if page_info.get("forms"):
                                        forms_found.extend(page_info["forms"])
                        except:
                            continue
                except:
                    continue
            
            # Discover and click on all interactive elements (div, a, li, ul, etc.)
            await self._discover_all_clickable_elements(
                page=page,
                visited_urls=visited_urls,
                visited_fingerprints=visited_fingerprints,
                visited_pages=visited_pages,
                forms_found=forms_found,
                base_domain=base_domain,
                run_id=run_id,
                discovery_dir=discovery_dir,
                max_pages=max_pages,
                artifacts_path=artifacts_path,
                nav_path=nav_path,
                debug=debug
            )
            
        except Exception as e:
            logger.warning(f"[{run_id}] Error in enhanced deep discovery: {e}")
    
    async def _discover_all_clickable_elements(
        self,
        page,
        visited_urls: Set[str],
        visited_fingerprints: Set[str],
        visited_pages: List[Dict],
        forms_found: List[Dict],
        base_domain: str,
        run_id: str,
        discovery_dir: Path,
        max_pages: int,
        artifacts_path: str,
        nav_path: str,
        debug: bool = False
    ):
        """
        Discover and click on all interactive elements: div, a, li, ul, button, etc.
        This helps find pages that aren't in navigation menus.
        """
        try:
            if len(visited_pages) >= max_pages:
                return
            
            # Get all potentially clickable elements
            # Prioritize "+" buttons and icons that often open modals
            clickable_selectors = [
                "button:has-text('+')",  # Plus buttons
                "button[aria-label*='add']",  # Add buttons
                "button[aria-label*='create']",  # Create buttons
                "[class*='add']:has-text('+')",  # Elements with add class and +
                "[class*='create']:has-text('+')",  # Elements with create class and +
                "button:has([class*='plus'])",  # Buttons with plus icon
                "button:has([class*='add'])",  # Buttons with add icon
                "a[href]",  # Links with href
                "a:not([href=''])",  # Links without empty href
                "button",
                "[role='button']",
                "[role='link']",
                "[role='menuitem']",
                "[role='tab']",
                "[role='option']",
                "div[onclick]",  # Divs with onclick
                "div[class*='click']",  # Divs with 'click' in class
                "div[class*='button']",  # Divs with 'button' in class
                "div[class*='link']",  # Divs with 'link' in class
                "div[class*='card']",  # Card divs
                "div[class*='tile']",  # Tile divs
                "li[onclick]",  # List items with onclick
                "li[class*='click']",
                "li[class*='button']",
                "li[class*='link']",
                "ul[onclick]",  # ULs with onclick (rare but possible)
                "[data-testid*='button']",
                "[data-testid*='link']",
                "[data-testid*='click']",
                "[aria-label]",  # Elements with aria-label (often clickable)
            ]
            
            clicked_elements = set()  # Track clicked elements to avoid duplicates
            max_elements_per_page = 50  # Limit to avoid infinite loops
            
            for selector in clickable_selectors:
                if len(visited_pages) >= max_pages:
                    break
                
                try:
                    elements = page.locator(selector)
                    count = await elements.count()
                    
                    for i in range(min(count, max_elements_per_page)):
                        if len(visited_pages) >= max_pages:
                            break
                        
                        try:
                            element = elements.nth(i)
                            
                            # Skip if not visible
                            if not await element.is_visible():
                                continue
                            
                            # Get element identifier (text + tag + position)
                            try:
                                text = (await element.inner_text()).strip()[:100]
                                tag_name = await element.evaluate("el => el.tagName.toLowerCase()")
                                element_id = await element.evaluate("el => el.id || ''")
                                href = await element.get_attribute("href") or ""
                                
                                # Create unique identifier
                                element_key = f"{tag_name}:{text}:{element_id}:{href}"
                                if element_key in clicked_elements:
                                    continue
                                
                                # Skip if destructive
                                if self._is_destructive(text):
                                    continue
                                
                                # Skip if empty text and no href
                                if not text and not href:
                                    continue
                                
                                # Skip common non-interactive elements
                                skip_classes = ["icon", "badge", "label", "tooltip", "spinner", "loader"]
                                class_attr = await element.get_attribute("class") or ""
                                if any(skip in class_attr.lower() for skip in skip_classes):
                                    continue
                                
                                clicked_elements.add(element_key)
                                
                                # Get current state before click
                                before_url = page.url
                                before_heading = (await self._get_page_signature(page)).get("heading", "")
                                
                                # Click the element
                                try:
                                    await self._instrumented_action(
                                        run_id=run_id,
                                        artifacts_path=artifacts_path,
                                        discovery_dir=discovery_dir,
                                        debug=debug,
                                        page=page,
                                        action="click",
                                        element_text=text or tag_name,
                                        element_role_or_tag=tag_name,
                                        selector_hint=selector,
                                        do=lambda: element.click(timeout=3000),
                                        forms_found=forms_found
                                    )
                                    
                                    # Wait for navigation/SPA update
                                    await asyncio.sleep(1)
                                    try:
                                        await page.wait_for_load_state("networkidle", timeout=5000)
                                    except:
                                        pass
                                    
                                    # Check if page changed
                                    after_url = page.url
                                    after_heading = (await self._get_page_signature(page)).get("heading", "")
                                    
                                    # Check if URL changed or heading changed (new page)
                                    url_changed = after_url != before_url
                                    heading_changed = after_heading != before_heading
                                    
                                    if url_changed or heading_changed:
                                        # Check if this is a new page
                                        parsed = urlparse(after_url)
                                        normalized_after = self._normalize_url(after_url)

                                        if (parsed.netloc == base_domain or parsed.netloc == "") and normalized_after not in visited_urls:
                                            # Mark as visited
                                            visited_urls.add(normalized_after)

                                            page_info = await self._analyze_page_enhanced(
                                                page, after_url, text or f"{tag_name} {i+1}", run_id, discovery_dir, len(visited_pages), artifacts_path
                                            )
                                            heading = page_info.get("page_signature", {}).get("heading", "")
                                            fingerprint = self._create_fingerprint(nav_path, after_url, heading)

                                            if fingerprint not in visited_fingerprints:
                                                visited_pages.append(page_info)
                                                visited_fingerprints.add(fingerprint)
                                                
                                                if page_info.get("forms"):
                                                    forms_found.extend(page_info["forms"])
                                                
                                                logger.info(f"[{run_id}] Discovered new page via {tag_name} click: {after_url}")
                                                
                                                # Recursively discover from new page
                                                await self._deep_discover_page_enhanced(
                                                    page, after_url, visited_urls, visited_fingerprints, visited_pages, forms_found,
                                                    base_domain, run_id, discovery_dir, max_pages, artifacts_path, nav_path, debug
                                                )
                                                
                                                # Go back if URL changed
                                                if url_changed:
                                                    try:
                                                        await page.go_back(timeout=10000)
                                                        await asyncio.sleep(1)
                                                    except:
                                                        pass
                                    
                                    # If only heading changed (SPA navigation), continue exploring
                                    elif heading_changed and not url_changed:
                                        # This might be a new view in SPA, analyze it
                                        page_info = await self._analyze_page_enhanced(
                                            page, after_url, text or f"{tag_name} {i+1}", run_id, discovery_dir, len(visited_pages), artifacts_path
                                        )
                                        heading = page_info.get("page_signature", {}).get("heading", "")
                                        fingerprint = self._create_fingerprint(nav_path, after_url, heading)
                                        
                                        if fingerprint not in visited_fingerprints:
                                            visited_pages.append(page_info)
                                            visited_fingerprints.add(fingerprint)
                                            
                                            if page_info.get("forms"):
                                                forms_found.extend(page_info["forms"])
                                            
                                            logger.info(f"[{run_id}] Discovered new SPA view via {tag_name} click: {heading}")
                                
                                except Exception as click_error:
                                    # Click failed, continue to next element
                                    logger.debug(f"[{run_id}] Failed to click element {i}: {click_error}")
                                    continue
                            
                            except Exception as e:
                                logger.debug(f"[{run_id}] Error processing element {i}: {e}")
                                continue
                        
                        except Exception as e:
                            logger.debug(f"[{run_id}] Error in element loop {i}: {e}")
                            continue
                
                except Exception as e:
                    logger.debug(f"[{run_id}] Error with selector {selector}: {e}")
                    continue
        
        except Exception as e:
            logger.warning(f"[{run_id}] Error discovering clickable elements: {e}")
    
    async def _analyze_page_enhanced(
        self,
        page,
        url: str,
        nav_text: str,
        run_id: str,
        discovery_dir: Path,
        page_index: int,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """Enhanced page analysis with detailed form/field inspection."""
        try:
            title = await page.title()
            
            # Get page signature (heading/breadcrumb)
            page_signature = await self._get_page_signature(page)
            
            # Get primary actions
            primary_actions = await self._get_primary_actions(page)
            
            # Get forms with detailed field info
            forms = await self._get_forms_detailed(page, url)
            
            # Get tables
            tables = await self._get_tables(page)
            
            page_info = {
                "url": url,
                "nav_text": nav_text,
                "title": title,
                "page_signature": page_signature,
                "primary_actions": primary_actions,
                "forms": forms,
                "tables": tables
            }
            
            # Screenshot
            if page_index < 10:
                try:
                    safe_name = "".join(c if c.isalnum() else "_" for c in nav_text[:20])
                    screenshot_path = discovery_dir / f"page_{page_index:02d}_{safe_name}.png"
                    await page.screenshot(path=str(screenshot_path))
                    page_info["screenshot"] = str(screenshot_path.relative_to(discovery_dir))
                except:
                    pass
            
            return page_info
        
        except Exception as e:
            logger.error(f"[{run_id}] Error analyzing page {url}: {e}")
            return {
                "url": url,
                "nav_text": nav_text,
                "title": "",
                "page_signature": {},
                "primary_actions": [],
                "forms": [],
                "tables": [],
                "error": str(e)[:200]
            }
    
    async def _get_page_signature(self, page) -> Dict[str, Any]:
        """Extract page signature (heading, breadcrumb, page_name)."""
        signature = {}
        
        try:
            # Get main heading (h1)
            h1 = page.locator("h1").first
            if await h1.count() > 0:
                heading_text = (await h1.inner_text()).strip()
                if heading_text:
                    signature["heading"] = heading_text
            
            # Try h2 if h1 not found
            if "heading" not in signature:
                h2 = page.locator("h2").first
                if await h2.count() > 0:
                    heading_text = (await h2.inner_text()).strip()
                    if heading_text:
                        signature["heading"] = heading_text
            
            # Get breadcrumb
            breadcrumb_selectors = [
                ".breadcrumb",
                "[role='navigation'][aria-label*='breadcrumb']",
                "nav[aria-label*='breadcrumb']",
                "[aria-label*='Breadcrumb']",
                ".breadcrumbs"
            ]
            
            breadcrumb_items = []
            for sel in breadcrumb_selectors:
                try:
                    bc = page.locator(sel).first
                    if await bc.count() > 0:
                        items = bc.locator("a, span, li")
                        count = await items.count()
                        for i in range(min(count, 10)):
                            try:
                                text = await items.nth(i).inner_text()
                                if text.strip():
                                    breadcrumb_items.append(text.strip())
                            except:
                                continue
                        if breadcrumb_items:
                            signature["breadcrumb"] = " > ".join(breadcrumb_items)
                            break
                except:
                    continue
            
            # Extract page name from various sources
            page_name = None
            
            # 1. Use heading if available and meaningful (not generic)
            if "heading" in signature:
                heading = signature["heading"]
                # Skip generic titles like "Cell | Airtel"
                if heading and "|" not in heading and len(heading) < 50:
                    page_name = heading
            
            # 2. Use last breadcrumb item (usually the page name)
            if not page_name and breadcrumb_items:
                last_item = breadcrumb_items[-1]
                if last_item and last_item.lower() not in ["dashboard", "home", "overview"]:
                    page_name = last_item
            
            # 3. Try to find page title in common locations
            if not page_name:
                title_selectors = [
                    ".page-title",
                    ".page-header h1",
                    ".page-header h2",
                    "[class*='title']",
                    "[class*='header'] h1",
                    "[class*='header'] h2"
                ]
                
                for sel in title_selectors:
                    try:
                        title_elem = page.locator(sel).first
                        if await title_elem.count() > 0:
                            title_text = (await title_elem.inner_text()).strip()
                            if title_text and "|" not in title_text and len(title_text) < 50:
                                page_name = title_text
                                break
                    except:
                        continue
            
            # 4. Extract from URL path (last meaningful segment)
            if not page_name:
                try:
                    url = page.url
                    from urllib.parse import urlparse
                    parsed = urlparse(url)
                    path_parts = [p for p in parsed.path.split("/") if p]
                    if path_parts:
                        last_part = path_parts[-1]
                        # Convert kebab-case/snake_case to Title Case
                        page_name = last_part.replace("-", " ").replace("_", " ").title()
                except:
                    pass
            
            if page_name:
                signature["page_name"] = page_name
        
        except Exception as e:
            logger.debug(f"Error extracting page signature: {e}")
        
        return signature
    
    async def _get_primary_actions(self, page) -> List[Dict[str, Any]]:
        """Get primary action buttons (Create/Add/Edit/Delete)."""
        actions = []
        
        try:
            # Find action buttons
            action_selectors = [
                "button",
                "a.button",
                "[role='button']",
                ".btn",
                ".action-button"
            ]
            
            action_keywords = ["create", "add", "new", "edit", "update", "delete", "remove", "save", "submit"]
            
            for sel in action_selectors:
                try:
                    buttons = page.locator(sel)
                    count = await buttons.count()
                    
                    for i in range(min(count, 20)):
                        try:
                            btn = buttons.nth(i)
                            text = await btn.inner_text()
                            
                            if not text.strip():
                                continue
                            
                            text_lower = text.lower()
                            is_action = any(keyword in text_lower for keyword in action_keywords)
                            
                            if is_action:
                                is_dangerous = self._is_destructive(text)
                                
                                actions.append({
                                    "text": text.strip(),
                                    "type": "dangerous" if is_dangerous else "safe",
                                    "tag": "delete" if "delete" in text_lower else ("create" if "create" in text_lower or "add" in text_lower else "other")
                                })
                        except:
                            continue
                except:
                    continue
        except:
            pass
        
        return actions[:10]  # Limit to 10 actions

    async def _get_page_heading(self, page) -> str:
        """Extract the main heading from a page."""
        try:
            # Try h1 first
            h1 = page.locator("h1").first
            if await h1.count() > 0:
                text = await h1.inner_text()
                if text and text.strip():
                    return text.strip()

            # Try h2 if h1 not found
            h2 = page.locator("h2").first
            if await h2.count() > 0:
                text = await h2.inner_text()
                if text and text.strip():
                    return text.strip()

            # Try title attribute
            title = await page.title()
            if title:
                return title

        except Exception as e:
            logger.debug(f"Error getting page heading: {e}")

        return ""

    async def _get_forms_detailed(self, page, url: str) -> List[Dict[str, Any]]:
        """Get forms with detailed field information and links."""
        forms = []

        try:
            form_elements = page.locator("form")
            form_count = await form_elements.count()

            for i in range(min(form_count, 10)):
                try:
                    form = form_elements.nth(i)
                    action = await form.get_attribute("action") or ""
                    method = await form.get_attribute("method") or "GET"

                    # Get all form fields
                    fields = await self._get_form_fields(form)

                    # Extract links within the form
                    form_links = await self._extract_form_links(form)

                    if fields or action or form_links:
                        forms.append({
                            "action": action,
                            "method": method.upper(),
                            "fields": fields,
                            "fields_count": len(fields),
                            "form_links": form_links,
                            "form_links_count": len(form_links),
                            "page_url": url,
                            "form_element": form  # Store reference for submission
                        })
                except:
                    continue
        except Exception as e:
            logger.debug(f"Error finding forms: {e}")

        return forms
    
    async def _get_form_fields(self, form) -> List[Dict[str, Any]]:
        """Get detailed information about form fields."""
        fields = []
        
        try:
            # Get all input types
            input_types = ["input", "select", "textarea", "[role='textbox']", "[role='combobox']"]
            
            for input_type in input_types:
                try:
                    elements = form.locator(input_type)
                    count = await elements.count()
                    
                    for i in range(min(count, 30)):
                        try:
                            elem = elements.nth(i)
                            
                            # Get field type
                            tag = await elem.evaluate("el => el.tagName.toLowerCase()")
                            field_type = await elem.get_attribute("type") or tag
                            
                            # Skip hidden/submit/button
                            if field_type in ["hidden", "submit", "button"]:
                                continue
                            
                            # Get label
                            label_text = ""
                            try:
                                # Try associated label
                                label_id = await elem.get_attribute("id")
                                if label_id:
                                    label = form.locator(f"label[for='{label_id}']").first
                                    if await label.count() > 0:
                                        label_text = await label.inner_text()
                                
                                if not label_text:
                                    # Try placeholder
                                    label_text = await elem.get_attribute("placeholder") or ""
                                
                                if not label_text:
                                    # Try aria-label
                                    label_text = await elem.get_attribute("aria-label") or ""
                                
                                if not label_text:
                                    # Try preceding label
                                    label = elem.locator("xpath=preceding::label[1]").first
                                    if await label.count() > 0:
                                        label_text = await label.inner_text()
                            except:
                                pass
                            
                            # Get other attributes
                            name = await elem.get_attribute("name") or ""
                            field_id = await elem.get_attribute("id") or ""
                            required = await elem.get_attribute("required") is not None
                            placeholder = await elem.get_attribute("placeholder") or ""
                            
                            field_info = {
                                "type": field_type,
                                "label": label_text.strip() if label_text else "",
                                "name": name,
                                "id": field_id,
                                "required": required,
                                "placeholder": placeholder
                            }
                            
                            # Special handling for different field types
                            if tag == "select":
                                # Get options
                                options = []
                                option_elements = elem.locator("option")
                                opt_count = await option_elements.count()
                                for j in range(min(opt_count, 10)):  # First 10 options
                                    try:
                                        opt = option_elements.nth(j)
                                        opt_text = await opt.inner_text()
                                        opt_value = await opt.get_attribute("value") or opt_text
                                        options.append({
                                            "text": opt_text.strip(),
                                            "value": opt_value
                                        })
                                    except:
                                        continue
                                field_info["options"] = options
                                field_info["searchable"] = await elem.get_attribute("multiple") is not None
                            
                            elif field_type in ["checkbox", "radio"]:
                                # Get default state
                                checked = await elem.is_checked()
                                field_info["default_state"] = "checked" if checked else "unchecked"
                            
                            elif field_type in ["date", "time", "datetime-local"]:
                                # Date/time hints
                                min_val = await elem.get_attribute("min") or ""
                                max_val = await elem.get_attribute("max") or ""
                                if min_val or max_val:
                                    field_info["date_range"] = {
                                        "min": min_val,
                                        "max": max_val
                                    }
                            
                            # Get validation hints
                            validation = await elem.get_attribute("pattern") or ""
                            if validation:
                                field_info["validation_pattern"] = validation
                            
                            fields.append(field_info)
                        except:
                            continue
                except:
                    continue
        except:
            pass
        
        return fields

    async def _generate_test_data_for_field(self, field_info: Dict[str, Any]) -> Optional[str]:
        """Generate appropriate test data for a form field based on its type and label."""
        field_type = field_info.get("type", "text")
        label = (field_info.get("label") or "").lower()
        name = (field_info.get("name") or "").lower()
        placeholder = (field_info.get("placeholder") or "").lower()

        # Combine hints for better data generation
        hints = f"{label} {name} {placeholder}"

        # Email fields
        if field_type == "email" or any(k in hints for k in ["email", "e-mail"]):
            return "test@example.com"

        # Password fields
        if field_type == "password" or "password" in hints:
            return "Test@1234"

        # Name fields
        if any(k in hints for k in ["first name", "firstname", "fname"]):
            return "Test"
        if any(k in hints for k in ["last name", "lastname", "lname"]):
            return "User"
        if any(k in hints for k in ["full name", "name", "username"]):
            return "Test User"

        # Phone fields
        if any(k in hints for k in ["phone", "tel", "mobile"]):
            return "+1234567890"

        # Address fields
        if "address" in hints:
            return "123 Test Street"
        if "city" in hints:
            return "Test City"
        if any(k in hints for k in ["state", "province"]):
            return "TX"
        if any(k in hints for k in ["zip", "postal"]):
            return "12345"
        if "country" in hints:
            return "US"

        # Number fields
        if field_type == "number":
            if any(k in hints for k in ["age", "year"]):
                return "25"
            elif any(k in hints for k in ["quantity", "qty", "amount"]):
                return "1"
            elif any(k in hints for k in ["price", "cost"]):
                return "10"
            else:
                return "100"

        # Date fields
        if field_type in ["date", "datetime-local"]:
            return "2025-01-15"

        # Time fields
        if field_type == "time":
            return "10:00"

        # URL fields
        if field_type == "url" or "url" in hints or "website" in hints:
            return "https://example.com"

        # Text area or long text
        if field_type == "textarea" or "description" in hints or "comment" in hints:
            return "This is a test description"

        # Default text
        if field_type in ["text", "search"]:
            return "Test Input"

        return None

    async def _extract_form_links(self, form) -> List[Dict[str, str]]:
        """Extract all links within a form."""
        links = []
        try:
            link_elements = form.locator("a[href]")
            count = await link_elements.count()

            for i in range(min(count, 10)):  # Limit to 10 links per form
                try:
                    link = link_elements.nth(i)
                    href = await link.get_attribute("href")
                    text = await link.inner_text()

                    if href and not href.startswith("#") and not href.startswith("javascript:"):
                        links.append({
                            "text": text.strip(),
                            "href": href
                        })
                except:
                    continue
        except Exception as e:
            logger.debug(f"Error extracting form links: {e}")

        return links

    async def _is_destructive_form(self, form, page) -> bool:
        """Check if a form appears to be destructive based on keywords."""
        try:
            # Check form action
            action = await form.get_attribute("action") or ""
            if any(keyword in action.lower() for keyword in self.DESTRUCTIVE_KEYWORDS):
                return True

            # Check submit buttons
            submit_buttons = form.locator("button[type='submit'], input[type='submit'], button:not([type='button'])")
            count = await submit_buttons.count()

            for i in range(count):
                try:
                    button = submit_buttons.nth(i)
                    button_text = await button.inner_text()
                    button_value = await button.get_attribute("value") or ""

                    combined_text = f"{button_text} {button_value}".lower()
                    if any(keyword in combined_text for keyword in self.DESTRUCTIVE_KEYWORDS):
                        return True
                except:
                    continue
        except:
            pass

        return False

    async def _submit_form_and_discover(
        self,
        page,
        form,
        form_info: Dict[str, Any],
        run_id: str,
        artifacts_path: str,
        visited_urls: Set[str],
        depth: int = 0
    ) -> Optional[Dict[str, Any]]:
        """Submit a form with test data and discover any resulting pages."""
        try:
            current_url = page.url

            # Check if form is destructive
            is_destructive = await self._is_destructive_form(form, page)

            if is_destructive:
                # Emit event asking for permission
                self._emit_event(run_id, artifacts_path, "form_needs_permission", {
                    "form_action": form_info.get("action", ""),
                    "page_url": current_url,
                    "reason": "Form appears to contain destructive operations"
                })
                # For now, skip destructive forms (user permission handling will be added in Phase 7)
                logger.info(f"[{run_id}] Skipping potentially destructive form at {current_url}")
                return None

            # Fill form fields with test data
            fields_filled = 0
            for field in form_info.get("fields", []):
                try:
                    field_type = field.get("type", "text")
                    field_id = field.get("id")
                    field_name = field.get("name")

                    # Generate test data
                    test_data = await self._generate_test_data_for_field(field)

                    if not test_data:
                        continue

                    # Locate the field
                    if field_id:
                        field_locator = form.locator(f"#{field_id}").first
                    elif field_name:
                        field_locator = form.locator(f"[name='{field_name}']").first
                    else:
                        continue

                    if await field_locator.count() == 0:
                        continue

                    # Fill based on type
                    if field_type == "select":
                        # Select first non-empty option
                        options = field.get("options", [])
                        if options and len(options) > 1:  # Skip if only empty option
                            first_option = options[1] if len(options) > 1 else options[0]
                            await field_locator.select_option(value=first_option.get("value"))
                            fields_filled += 1

                    elif field_type == "checkbox":
                        # Check the first checkbox
                        if not await field_locator.is_checked():
                            await field_locator.check()
                            fields_filled += 1

                    elif field_type == "radio":
                        # Select the radio button
                        await field_locator.check()
                        fields_filled += 1

                    else:
                        # Regular text input
                        await field_locator.fill(test_data)
                        fields_filled += 1

                except Exception as e:
                    logger.debug(f"[{run_id}] Error filling field: {e}")
                    continue

            if fields_filled == 0:
                logger.debug(f"[{run_id}] No fields filled, skipping form submission")
                return None

            # Find and click submit button
            submit_button = form.locator("button[type='submit'], input[type='submit'], button:not([type='button'])").first

            if await submit_button.count() == 0:
                logger.debug(f"[{run_id}] No submit button found")
                return None

            # Emit event before submission
            self._emit_event(run_id, artifacts_path, "form_submitting", {
                "form_action": form_info.get("action", ""),
                "page_url": current_url,
                "fields_filled": fields_filled
            })

            # Submit form
            await submit_button.click()

            # Wait for navigation or response
            try:
                await page.wait_for_load_state("networkidle", timeout=5000)
            except:
                pass
            await asyncio.sleep(0.8)  # Additional wait for dynamic content

            new_url = page.url

            # Check if navigation occurred
            if new_url != current_url:
                # Emit successful submission event
                self._emit_event(run_id, artifacts_path, "form_submitted", {
                    "form_action": form_info.get("action", ""),
                    "previous_url": current_url,
                    "new_url": new_url,
                    "fields_filled": fields_filled,
                    "navigation_occurred": True
                })

                # Discover the new page if not visited
                if new_url not in visited_urls:
                    logger.info(f"[{run_id}] Form submission led to new page: {new_url}")
                    visited_urls.add(new_url)
                    return {
                        "url": new_url,
                        "depth": depth + 1,
                        "source": "form_submission",
                        "parent_url": current_url
                    }
            else:
                # Check for modal or SPA update
                heading = await self._get_page_heading(page)

                self._emit_event(run_id, artifacts_path, "form_submitted", {
                    "form_action": form_info.get("action", ""),
                    "page_url": current_url,
                    "fields_filled": fields_filled,
                    "navigation_occurred": False,
                    "spa_update": True
                })

                logger.info(f"[{run_id}] Form submission completed (SPA update or modal)")

        except Exception as e:
            logger.warning(f"[{run_id}] Error submitting form: {e}")
            self._emit_event(run_id, artifacts_path, "form_submission_failed", {
                "form_action": form_info.get("action", ""),
                "page_url": page.url,
                "error": str(e)
            })

        return None

    async def _follow_form_links(
        self,
        page,
        form,
        form_links: List[Dict[str, str]],
        run_id: str,
        artifacts_path: str,
        visited_urls: Set[str],
        depth: int = 0
    ) -> List[Dict[str, Any]]:
        """Follow links within a form and discover destination pages."""
        discovered_pages = []

        for link in form_links:
            try:
                href = link["href"]
                link_text = link["text"]

                # Resolve relative URLs
                base_url = page.url
                absolute_url = urljoin(base_url, href)

                # Skip if already visited
                if absolute_url in visited_urls:
                    continue

                # Skip external links
                base_domain = urlparse(base_url).netloc
                link_domain = urlparse(absolute_url).netloc
                if link_domain != base_domain:
                    continue

                self._emit_event(run_id, artifacts_path, "form_link_following", {
                    "link_text": link_text,
                    "link_href": absolute_url,
                    "parent_url": base_url
                })

                # Navigate to the link
                await page.goto(absolute_url, wait_until="networkidle", timeout=10000)
                await asyncio.sleep(0.6)

                visited_urls.add(absolute_url)

                self._emit_event(run_id, artifacts_path, "form_link_followed", {
                    "link_text": link_text,
                    "link_href": absolute_url,
                    "status": "success"
                })

                discovered_pages.append({
                    "url": absolute_url,
                    "depth": depth + 1,
                    "source": "form_link",
                    "parent_url": base_url
                })

                # Navigate back
                await page.go_back(wait_until="networkidle", timeout=5000)
                await asyncio.sleep(0.4)

            except Exception as e:
                logger.debug(f"[{run_id}] Error following form link {link.get('text')}: {e}")
                continue

        return discovered_pages

    async def _process_page_forms(
        self,
        page,
        page_info: Dict[str, Any],
        run_id: str,
        artifacts_path: str,
        visited_urls: Set[str],
        depth: int = 0
    ) -> List[Dict[str, Any]]:
        """Process all forms on a page: follow links and submit forms."""
        discovered_pages = []

        forms = page_info.get("forms", [])
        if not forms:
            return discovered_pages

        for form_info in forms:
            try:
                # Get the form element reference
                form_element = form_info.get("form_element")
                if not form_element:
                    continue

                # Step 1: Follow links within the form
                form_links = form_info.get("form_links", [])
                if form_links:
                    logger.info(f"[{run_id}] Found {len(form_links)} links in form, following them...")
                    link_pages = await self._follow_form_links(
                        page, form_element, form_links, run_id, artifacts_path, visited_urls, depth
                    )
                    discovered_pages.extend(link_pages)

                # Step 2: Submit the form if it has fields
                if form_info.get("fields"):
                    logger.info(f"[{run_id}] Submitting form with {len(form_info['fields'])} fields...")
                    new_page = await self._submit_form_and_discover(
                        page, form_element, form_info, run_id, artifacts_path, visited_urls, depth
                    )
                    if new_page:
                        discovered_pages.append(new_page)

            except Exception as e:
                logger.debug(f"[{run_id}] Error processing form: {e}")
                continue

        return discovered_pages

    async def _get_tables(self, page) -> List[Dict[str, Any]]:
        """Get table information with column headers."""
        tables = []
        
        try:
            table_elements = page.locator("table")
            table_count = await table_elements.count()
            
            for i in range(min(table_count, 10)):
                try:
                    table = table_elements.nth(i)
                    
                    # Get headers
                    headers = []
                    header_selectors = ["thead th", "th", "[role='columnheader']"]
                    
                    for sel in header_selectors:
                        try:
                            header_elements = table.locator(sel)
                            count = await header_elements.count()
                            
                            if count > 0:
                                for j in range(min(count, 20)):
                                    try:
                                        header = header_elements.nth(j)
                                        text = await header.inner_text()
                                        if text.strip():
                                            headers.append(text.strip())
                                    except:
                                        continue
                                
                                if headers:
                                    break
                        except:
                            continue
                    
                    if headers:
                        tables.append({
                            "columns": headers,
                            "column_count": len(headers)
                        })
                except:
                    continue
        except:
            pass
        
        return tables

    async def _click_table_rows_and_discover(
        self,
        page,
        table_locator,
        run_id: str,
        artifacts_path: str,
        visited_urls: Set[str],
        depth: int = 0,
        max_rows: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Click table rows to discover detail pages."""
        discovered_pages = []

        try:
            # Find all rows in the table body
            row_selectors = ["tbody tr", "tr"]
            rows = None

            for selector in row_selectors:
                try:
                    rows = table_locator.locator(selector)
                    row_count = await rows.count()
                    if row_count > 0:
                        break
                except:
                    continue

            if not rows:
                return discovered_pages

            row_count = await rows.count()
            max_rows = max_rows or self.config.max_table_rows_to_click
            rows_to_check = min(row_count, max_rows)

            logger.info(f"[{run_id}] Found {row_count} rows, will check first {rows_to_check}")

            for i in range(rows_to_check):
                try:
                    row = rows.nth(i)
                    current_url = page.url

                    # Strategy 1: Check if row has onclick handler
                    has_onclick = await row.evaluate("el => el.hasAttribute('onclick') || el.style.cursor === 'pointer'")

                    # Strategy 2: Look for links within the row
                    links = row.locator("a[href]")
                    link_count = await links.count()

                    # Strategy 3: Look for action buttons (View, Edit, Details)
                    action_buttons = row.locator("button, a").locator("text=/view|edit|details|open/i")
                    button_count = await action_buttons.count()

                    clicked = False

                    # Try clicking action button first
                    if button_count > 0:
                        try:
                            button = action_buttons.first
                            button_text = await button.inner_text()

                            self._emit_event(run_id, artifacts_path, "table_row_action_clicking", {
                                "row_index": i,
                                "action_text": button_text,
                                "parent_url": current_url
                            })

                            await button.click()
                            await asyncio.sleep(0.8)
                            clicked = True
                        except:
                            pass

                    # Try clicking first link in row
                    elif link_count > 0:
                        try:
                            link = links.first
                            href = await link.get_attribute("href")
                            link_text = await link.inner_text()

                            # Resolve relative URL
                            absolute_url = urljoin(current_url, href)

                            # Skip if already visited or external
                            base_domain = urlparse(current_url).netloc
                            link_domain = urlparse(absolute_url).netloc
                            if absolute_url in visited_urls or link_domain != base_domain:
                                continue

                            self._emit_event(run_id, artifacts_path, "table_row_link_clicking", {
                                "row_index": i,
                                "link_text": link_text,
                                "link_href": absolute_url,
                                "parent_url": current_url
                            })

                            await link.click()
                            await asyncio.sleep(0.8)
                            clicked = True
                        except:
                            pass

                    # Try clicking the row itself if it has onclick
                    elif has_onclick:
                        try:
                            self._emit_event(run_id, artifacts_path, "table_row_clicking", {
                                "row_index": i,
                                "parent_url": current_url
                            })

                            await row.click()
                            await asyncio.sleep(0.8)
                            clicked = True
                        except:
                            pass

                    if clicked:
                        # Check if navigation occurred
                        new_url = page.url

                        if new_url != current_url and new_url not in visited_urls:
                            # New page discovered
                            visited_urls.add(new_url)

                            self._emit_event(run_id, artifacts_path, "table_row_clicked", {
                                "row_index": i,
                                "previous_url": current_url,
                                "new_url": new_url,
                                "navigation_occurred": True
                            })

                            logger.info(f"[{run_id}] Table row click led to new page: {new_url}")

                            discovered_pages.append({
                                "url": new_url,
                                "depth": depth + 1,
                                "source": "table_row_click",
                                "parent_url": current_url
                            })

                            # Navigate back to continue with other rows
                            await page.go_back(wait_until="networkidle", timeout=5000)
                            await asyncio.sleep(0.5)

                        else:
                            # Check for modal
                            self._emit_event(run_id, artifacts_path, "table_row_clicked", {
                                "row_index": i,
                                "page_url": current_url,
                                "navigation_occurred": False,
                                "modal_or_spa_update": True
                            })

                            # TODO: Handle modal discovery here
                            # For now, just close any modals and continue
                            try:
                                close_button = page.locator("button").locator("text=/close|×|✕/i").first
                                if await close_button.count() > 0:
                                    await close_button.click()
                                    await asyncio.sleep(0.3)
                            except:
                                pass

                except Exception as e:
                    logger.debug(f"[{run_id}] Error clicking table row {i}: {e}")
                    continue

        except Exception as e:
            logger.warning(f"[{run_id}] Error in table row clicking: {e}")

        return discovered_pages

    async def _handle_pagination(
        self,
        page,
        run_id: str,
        artifacts_path: str,
        visited_urls: Set[str],
        depth: int = 0,
        max_pages: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Handle pagination to discover all pages of data."""
        discovered_pages = []
        pagination_count = 0
        max_pagination_time = 300  # 5 minutes safety timeout

        # Use config value if max_pages not provided
        if max_pages is None:
            max_pages = self.config.max_pagination_pages

        start_time = asyncio.get_event_loop().time()

        try:
            while True:
                # Safety checks
                if max_pages and pagination_count >= max_pages:
                    logger.info(f"[{run_id}] Reached pagination limit: {max_pages}")
                    break

                elapsed = asyncio.get_event_loop().time() - start_time
                if elapsed > max_pagination_time:
                    logger.warning(f"[{run_id}] Pagination timeout after {elapsed:.1f}s")
                    break

                # Find pagination controls
                next_button_selectors = [
                    "button:has-text('Next')",
                    "a:has-text('Next')",
                    "button:has-text('→')",
                    "a:has-text('→')",
                    "[aria-label*='Next']",
                    ".pagination button:last-child",
                    ".pagination a:last-child",
                    "button:has-text('Load More')",
                    "a:has-text('Load More')"
                ]

                next_button = None
                for selector in next_button_selectors:
                    try:
                        btn = page.locator(selector).first
                        if await btn.count() > 0:
                            # Check if it's enabled/clickable
                            is_disabled = await btn.evaluate("el => el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled')")
                            if not is_disabled:
                                next_button = btn
                                break
                    except:
                        continue

                if not next_button:
                    logger.debug(f"[{run_id}] No more pagination controls found")
                    break

                # Click next button
                current_url = page.url

                self._emit_event(run_id, artifacts_path, "pagination_clicking", {
                    "page_number": pagination_count + 2,
                    "current_url": current_url
                })

                try:
                    await next_button.click()
                    await asyncio.sleep(1.0)  # Wait for content to load

                    # Check if URL or content changed
                    new_url = page.url

                    if new_url != current_url and new_url not in visited_urls:
                        visited_urls.add(new_url)

                        self._emit_event(run_id, artifacts_path, "pagination_clicked", {
                            "page_number": pagination_count + 2,
                            "previous_url": current_url,
                            "new_url": new_url
                        })

                        discovered_pages.append({
                            "url": new_url,
                            "depth": depth,
                            "source": "pagination",
                            "parent_url": current_url,
                            "page_number": pagination_count + 2
                        })

                    else:
                        # SPA-style pagination (same URL, different content)
                        self._emit_event(run_id, artifacts_path, "pagination_clicked", {
                            "page_number": pagination_count + 2,
                            "current_url": current_url,
                            "spa_update": True
                        })

                    pagination_count += 1

                except Exception as e:
                    logger.debug(f"[{run_id}] Error clicking pagination: {e}")
                    break

        except Exception as e:
            logger.warning(f"[{run_id}] Error in pagination handling: {e}")

        if pagination_count > 0:
            logger.info(f"[{run_id}] Paginated through {pagination_count} pages")

        return discovered_pages

    async def _test_page_interactions_complete(
        self,
        page,
        page_url: str,
        page_info: Dict[str, Any],
        run_id: str,
        artifacts_path: str,
        visited_urls: Set[str],
        visited_fingerprints: Set[str],
        visited_pages: List[Dict],
        forms_found: List[Dict],
        base_domain: str,
        discovery_dir: Path,
        max_pages: int,
        nav_path: str,
        debug: bool = False
    ):
        """
        Test ALL interactions on a page in one go before moving to next page.
        This ensures complete validation: search, filters, sort, pagination, table rows.
        Generic - works with any URL/app structure.
        """
        original_url = page.url
        normalized_original = self._normalize_url(original_url)
        
        try:
            # Emit progress event
            self._emit_event(run_id, artifacts_path, "page_testing_started", {
                "url": page_url,
                "page_name": page_info.get("page_signature", {}).get("page_name", ""),
                "actions_to_test": ["search", "filters", "sort", "pagination", "table_rows"]
            })
            
            # 1. Test Search (if present)
            try:
                search_selectors = [
                    "input[type='search']",
                    "input[placeholder*='search' i]",
                    "input[placeholder*='find' i]",
                    "input[aria-label*='search' i]",
                    ".search-input",
                    "[role='searchbox']"
                ]
                
                for selector in search_selectors:
                    try:
                        search_input = page.locator(selector).first
                        if await search_input.is_visible(timeout=1000):
                            self._emit_event(run_id, artifacts_path, "page_action_testing", {
                                "url": page_url,
                                "action": "search",
                                "status": "testing"
                            })
                            
                            # Type test query
                            await search_input.fill("test", timeout=2000)
                            await asyncio.sleep(1)
                            await page.wait_for_load_state("networkidle", timeout=5000)
                            
                            # Clear search
                            await search_input.fill("", timeout=2000)
                            await asyncio.sleep(1)
                            await page.wait_for_load_state("networkidle", timeout=5000)
                            
                            # Ensure we're still on the same page
                            current_url = self._normalize_url(page.url)
                            if current_url != normalized_original:
                                await page.goto(page_url, timeout=30000, wait_until="networkidle")
                                await asyncio.sleep(1)
                            
                            self._emit_event(run_id, artifacts_path, "page_action_testing", {
                                "url": page_url,
                                "action": "search",
                                "status": "completed"
                            })
                            break
                    except:
                        continue
            except Exception as e:
                logger.debug(f"[{run_id}] Search testing error: {e}")
            
            # 2. Test Filters (if present)
            try:
                filter_selectors = [
                    "select[aria-label*='filter' i]",
                    "button[aria-label*='filter' i]",
                    ".filter-select",
                    "[role='combobox'][aria-label*='filter' i]"
                ]
                
                for selector in filter_selectors:
                    try:
                        filter_elem = page.locator(selector).first
                        if await filter_elem.is_visible(timeout=1000):
                            self._emit_event(run_id, artifacts_path, "page_action_testing", {
                                "url": page_url,
                                "action": "filters",
                                "status": "testing"
                            })
                            
                            # Try to interact with filter
                            if await filter_elem.evaluate("el => el.tagName.toLowerCase()") == "select":
                                options = await filter_elem.locator("option").count()
                                if options > 1:
                                    await filter_elem.select_option(index=1, timeout=2000)
                                    await asyncio.sleep(1)
                                    await page.wait_for_load_state("networkidle", timeout=5000)
                                    
                                    # Reset filter
                                    await filter_elem.select_option(index=0, timeout=2000)
                                    await asyncio.sleep(1)
                                    await page.wait_for_load_state("networkidle", timeout=5000)
                            else:
                                await filter_elem.click(timeout=2000)
                                await asyncio.sleep(1)
                                # Try to select first option if dropdown opens
                                first_option = page.locator("[role='option']").first
                                if await first_option.is_visible(timeout=1000):
                                    await first_option.click(timeout=2000)
                                    await asyncio.sleep(1)
                            
                            # Ensure we're still on the same page
                            current_url = self._normalize_url(page.url)
                            if current_url != normalized_original:
                                await page.goto(page_url, timeout=30000, wait_until="networkidle")
                                await asyncio.sleep(1)
                            
                            self._emit_event(run_id, artifacts_path, "page_action_testing", {
                                "url": page_url,
                                "action": "filters",
                                "status": "completed"
                            })
                            break
                    except:
                        continue
            except Exception as e:
                logger.debug(f"[{run_id}] Filter testing error: {e}")
            
            # 3. Test Sort (if present)
            try:
                sort_selectors = [
                    "button[aria-label*='sort' i]",
                    "th[aria-sort]",
                    ".sort-button",
                    "[role='columnheader'][aria-sort]"
                ]
                
                for selector in sort_selectors:
                    try:
                        sort_elem = page.locator(selector).first
                        if await sort_elem.is_visible(timeout=1000):
                            self._emit_event(run_id, artifacts_path, "page_action_testing", {
                                "url": page_url,
                                "action": "sort",
                                "status": "testing"
                            })
                            
                            await sort_elem.click(timeout=2000)
                            await asyncio.sleep(1)
                            await page.wait_for_load_state("networkidle", timeout=5000)
                            
                            # Click again to reverse sort
                            await sort_elem.click(timeout=2000)
                            await asyncio.sleep(1)
                            await page.wait_for_load_state("networkidle", timeout=5000)
                            
                            # Ensure we're still on the same page
                            current_url = self._normalize_url(page.url)
                            if current_url != normalized_original:
                                await page.goto(page_url, timeout=30000, wait_until="networkidle")
                                await asyncio.sleep(1)
                            
                            self._emit_event(run_id, artifacts_path, "page_action_testing", {
                                "url": page_url,
                                "action": "sort",
                                "status": "completed"
                            })
                            break
                    except:
                        continue
            except Exception as e:
                logger.debug(f"[{run_id}] Sort testing error: {e}")
            
            # 4. Test Pagination (if present) - but limit to 2-3 pages to avoid long waits
            try:
                pagination_next = page.locator("button:has-text('Next'), a:has-text('Next'), button[aria-label*='Next' i]").first
                if await pagination_next.is_visible(timeout=1000):
                    self._emit_event(run_id, artifacts_path, "page_action_testing", {
                        "url": page_url,
                        "action": "pagination",
                        "status": "testing"
                    })
                    
                    # Click next (max 2 times to avoid long waits)
                    for i in range(2):
                        try:
                            is_disabled = await pagination_next.is_disabled(timeout=500)
                            if is_disabled:
                                break
                            
                            await pagination_next.click(timeout=2000)
                            await asyncio.sleep(1)
                            await page.wait_for_load_state("networkidle", timeout=5000)
                        except:
                            break
                    
                    # Go back to first page
                    pagination_prev = page.locator("button:has-text('Previous'), a:has-text('Previous'), button[aria-label*='Previous' i]").first
                    if await pagination_prev.is_visible(timeout=1000):
                        for i in range(2):
                            try:
                                is_disabled = await pagination_prev.is_disabled(timeout=500)
                                if is_disabled:
                                    break
                                await pagination_prev.click(timeout=2000)
                                await asyncio.sleep(1)
                                await page.wait_for_load_state("networkidle", timeout=5000)
                            except:
                                break
                    
                    # Ensure we're back on original page
                    current_url = self._normalize_url(page.url)
                    if current_url != normalized_original:
                        await page.goto(page_url, timeout=30000, wait_until="networkidle")
                        await asyncio.sleep(1)
                    
                    self._emit_event(run_id, artifacts_path, "page_action_testing", {
                        "url": page_url,
                        "action": "pagination",
                        "status": "completed"
                    })
            except Exception as e:
                logger.debug(f"[{run_id}] Pagination testing error: {e}")
            
            # 5. Test Table Row Clicks (if present) - but limit to first 3 rows
            try:
                tables = page_info.get("tables", [])
                if tables:
                    self._emit_event(run_id, artifacts_path, "page_action_testing", {
                        "url": page_url,
                        "action": "table_rows",
                        "status": "testing"
                    })
                    
                    table_rows = page.locator("table tbody tr").first
                    if await table_rows.count() > 0:
                        # Click first 3 rows to discover detail pages
                        for i in range(min(3, await table_rows.count())):
                            try:
                                row = table_rows.nth(i)
                                row_url_before = self._normalize_url(page.url)
                                
                                await row.click(timeout=3000)
                                await asyncio.sleep(1)
                                await page.wait_for_load_state("networkidle", timeout=5000)
                                
                                row_url_after = self._normalize_url(page.url)
                                
                                # If we navigated to a new page, analyze it
                                if row_url_after != row_url_before and row_url_after != normalized_original:
                                    if row_url_after not in visited_urls:
                                        page_info_new = await self._analyze_page_enhanced(
                                            page, row_url_after, f"Row {i+1} Detail", run_id, discovery_dir, len(visited_pages), artifacts_path
                                        )
                                        heading = page_info_new.get("page_signature", {}).get("heading", "")
                                        fingerprint = self._create_fingerprint(nav_path, row_url_after, heading)
                                        
                                        if fingerprint not in visited_fingerprints:
                                            visited_pages.append(page_info_new)
                                            visited_fingerprints.add(fingerprint)
                                            visited_urls.add(row_url_after)
                                            
                                            if page_info_new.get("forms"):
                                                forms_found.extend(page_info_new["forms"])
                                
                                # Go back to original page
                                await page.goto(page_url, timeout=30000, wait_until="networkidle")
                                await asyncio.sleep(1)
                            except Exception as e:
                                logger.debug(f"[{run_id}] Error clicking table row {i}: {e}")
                                # Try to go back to original page
                                try:
                                    await page.goto(page_url, timeout=30000, wait_until="networkidle")
                                except:
                                    pass
                                continue
                    
                    self._emit_event(run_id, artifacts_path, "page_action_testing", {
                        "url": page_url,
                        "action": "table_rows",
                        "status": "completed"
                    })
            except Exception as e:
                logger.debug(f"[{run_id}] Table row testing error: {e}")
            
            # Ensure we're back on the original page before returning
            current_url = self._normalize_url(page.url)
            if current_url != normalized_original:
                await page.goto(page_url, timeout=30000, wait_until="networkidle")
                await asyncio.sleep(1)
            
            # Emit completion event
            self._emit_event(run_id, artifacts_path, "page_testing_completed", {
                "url": page_url,
                "page_name": page_info.get("page_signature", {}).get("page_name", ""),
                "status": "completed"
            })
            
        except Exception as e:
            logger.warning(f"[{run_id}] Error in complete page testing: {e}")
            # Try to restore original page
            try:
                current_url = self._normalize_url(page.url)
                if current_url != normalized_original:
                    await page.goto(page_url, timeout=30000, wait_until="networkidle")
            except:
                pass

    def _create_appmap(self, pages: List[Dict], dropdowns: List[Dict], forms: List[Dict]) -> Dict[str, Any]:
        """Create structured app map from discovery results."""
        appmap = {
            "version": "1.0",
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "pages": [],
            "navigation_tree": {},
            "context_selectors": [],
            "forms_summary": {
                "total": len(forms),
                "by_page": {}
            }
        }
        
        # Process pages
        for page in pages:
            signature = page.get("page_signature", {})
            # Prefer page_name from signature, then heading, then title
            page_name = signature.get("page_name") or signature.get("heading", "") or page.get("title", "")
            # Clean up if it's generic (contains |)
            if "|" in page_name and not signature.get("page_name"):
                page_name = signature.get("page_name") or ""
            
            page_entry = {
                "url": page.get("url", ""),
                "title": page.get("title", ""),
                "page_name": page_name,
                "nav_path": page.get("nav_text", ""),
                "signature": signature,
                "actions": page.get("primary_actions", []),
                "forms_count": len(page.get("forms", [])),
                "tables_count": len(page.get("tables", []))
            }
            appmap["pages"].append(page_entry)
            
            # Track forms by page
            page_url = page.get("url", "")
            if page_url:
                appmap["forms_summary"]["by_page"][page_url] = len(page.get("forms", []))
        
        # Process context selectors
        for dropdown in dropdowns:
            if dropdown.get("type") == "context_selector":
                appmap["context_selectors"].append({
                    "label": dropdown.get("label", ""),
                    "options_count": dropdown.get("options_count", 0),
                    "options": dropdown.get("options", [])[:5]  # First 5 options
                })
        
        return appmap


# Global discovery runner instance
_discovery_runner = DiscoveryRunner()


def get_discovery_runner() -> DiscoveryRunner:
    """Get global discovery runner instance."""
    return _discovery_runner

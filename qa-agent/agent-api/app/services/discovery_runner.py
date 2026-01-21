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
    
    def __init__(self):
        """Initialize discovery runner."""
        self.event_writers: Dict[str, Any] = {}  # run_id -> file handle
    
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
    
    def _create_fingerprint(self, nav_path: str, url: str, heading: str) -> str:
        """Create a fingerprint for visited pages to avoid loops."""
        combined = f"{nav_path}|{url}|{heading}"
        return hashlib.md5(combined.encode()).hexdigest()
    
    def _is_destructive(self, text: str) -> bool:
        """Check if an action is destructive."""
        text_lower = text.lower()
        return any(keyword in text_lower for keyword in self.DESTRUCTIVE_KEYWORDS)
    
    async def run_discovery(
        self,
        page,
        run_id: str,
        base_url: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """
        Run discovery on the current logged-in session with live event streaming.
        
        Args:
            page: Playwright Page object (already logged in)
            run_id: Run identifier
            base_url: Base application URL
            artifacts_path: Path to artifacts directory
        
        Returns:
            Dict with discovery results
        """
        try:
            logger.info(f"[{run_id}] Starting enhanced discovery from: {base_url}")
            
            discovery_dir = Path(artifacts_path)
            discovery_dir.mkdir(parents=True, exist_ok=True)
            
            # Initialize events.jsonl
            events_file = discovery_dir / "events.jsonl"
            if events_file.exists():
                events_file.unlink()  # Start fresh
            self._emit_event(run_id, artifacts_path, "discovery_started", {
                "base_url": base_url,
                "run_id": run_id
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
            
            # Step 1: Discover top dropdowns (tenant/project/cell selectors)
            logger.info(f"[{run_id}] Discovering top dropdowns/context selectors")
            dropdowns_found = await self._discover_top_dropdowns(
                page, run_id, artifacts_path, base_domain
            )
            result["dropdowns_found"] = dropdowns_found
            self._emit_event(run_id, artifacts_path, "dropdowns_discovered", {
                "count": len(dropdowns_found),
                "dropdowns": dropdowns_found
            })
            
            # Step 2: Discover sidebar navigation with submenu exploration
            logger.info(f"[{run_id}] Discovering sidebar navigation")
            nav_items = await self._discover_sidebar_navigation(
                page, run_id, artifacts_path, base_domain
            )
            result["navigation_items"] = nav_items
            self._emit_event(run_id, artifacts_path, "navigation_discovered", {
                "count": len(nav_items),
                "items": nav_items[:10]  # First 10 for event
            })
            
            # Step 3: Visit pages and perform deep discovery
            visited_pages = []
            forms_found = []
            visited_urls: Set[str] = set()
            visited_fingerprints: Set[str] = set()
            max_pages = 50
            
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
                
                self._emit_event(run_id, artifacts_path, "page_discovered", {
                    "url": base_url,
                    "title": page_info.get("title", ""),
                    "forms_count": len(page_info.get("forms", [])),
                    "actions_count": len(page_info.get("primary_actions", []))
                })
                
                # Deep discover from home page
                await self._deep_discover_page_enhanced(
                    page, base_url, visited_urls, visited_fingerprints, visited_pages, forms_found,
                    base_domain, run_id, discovery_dir, max_pages, artifacts_path, ""
                )
            except Exception as e:
                logger.warning(f"[{run_id}] Failed to visit base URL: {e}")
            
            # Visit navigation items
            for idx, nav in enumerate(nav_items):
                if len(visited_pages) >= max_pages:
                    logger.info(f"[{run_id}] Reached max pages limit ({max_pages})")
                    break
                
                try:
                    url = nav.get("full_url") or nav.get("url")
                    if not url:
                        continue
                    
                    if urlparse(url).netloc != base_domain:
                        continue
                    
                    if url in visited_urls:
                        continue
                    
                    logger.info(f"[{run_id}] Visiting page {len(visited_pages)+1}/{max_pages}: {url}")
                    await page.goto(url, timeout=30000, wait_until="networkidle")
                    await asyncio.sleep(2)
                    
                    page_info = await self._analyze_page_enhanced(
                        page, url, nav.get("text", "Unknown"), run_id, discovery_dir, len(visited_pages), artifacts_path
                    )
                    visited_pages.append(page_info)
                    visited_urls.add(url)
                    
                    # Create fingerprint
                    heading = page_info.get("page_signature", {}).get("heading", "")
                    nav_path = nav.get("nav_path", "")
                    fingerprint = self._create_fingerprint(nav_path, url, heading)
                    visited_fingerprints.add(fingerprint)
                    
                    if page_info.get("forms"):
                        forms_found.extend(page_info["forms"])
                    
                    self._emit_event(run_id, artifacts_path, "page_discovered", {
                        "url": url,
                        "title": page_info.get("title", ""),
                        "nav_path": nav_path,
                        "forms_count": len(page_info.get("forms", [])),
                        "actions_count": len(page_info.get("primary_actions", []))
                    })
                    
                    # Deep discover from this page
                    await self._deep_discover_page_enhanced(
                        page, url, visited_urls, visited_fingerprints, visited_pages, forms_found,
                        base_domain, run_id, discovery_dir, max_pages, artifacts_path, nav_path
                    )
                except Exception as e:
                    logger.warning(f"[{run_id}] Failed to visit {url}: {e}")
                    continue
            
            # Step 4: Process results and create app map
            result["pages"] = visited_pages
            result["forms_found"] = forms_found
            result["api_endpoints"] = api_requests[:100]
            
            result["network_stats"] = {
                "total_requests": len(api_requests),
                "errors_4xx": len([e for e in network_errors if e["type"] == "4xx"]),
                "errors_5xx": len([e for e in network_errors if e["type"] == "5xx"]),
                "slow_requests": slow_requests[:20]
            }
            
            result["summary"] = {
                "total_pages": len(visited_pages),
                "pages_visited": len(visited_pages),
                "forms_count": len(forms_found),
                "api_endpoints_count": len(api_requests),
                "dropdowns_count": len(dropdowns_found)
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
            
            self._emit_event(run_id, artifacts_path, "discovery_completed", {
                "pages_count": len(visited_pages),
                "forms_count": len(forms_found),
                "api_endpoints_count": len(api_requests),
                "dropdowns_count": len(dropdowns_found)
            })
            
            # Close event writer
            if run_id in self.event_writers:
                self.event_writers[run_id].close()
                del self.event_writers[run_id]
            
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
    
    async def _discover_top_dropdowns(
        self, page, run_id: str, artifacts_path: str, base_domain: str
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
                                        await element.click(timeout=2000)
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
    
    async def _discover_sidebar_navigation(
        self, page, run_id: str, artifacts_path: str, base_domain: str
    ) -> List[Dict[str, Any]]:
        """Discover sidebar navigation by clicking menu items to reveal submenus."""
        nav_items = []
        discovered_urls: Set[str] = set()
        
        try:
            # Find sidebar/nav containers
            for sidebar_sel in self.SIDEBAR_SELECTORS:
                try:
                    sidebars = page.locator(sidebar_sel)
                    count = await sidebars.count()
                    
                    for sidebar_idx in range(min(count, 3)):  # Max 3 sidebars
                        sidebar = sidebars.nth(sidebar_idx)
                        
                        # Find menu items in this sidebar
                        for menu_sel in self.MENU_ITEM_SELECTORS:
                            try:
                                items = sidebar.locator(menu_sel)
                                item_count = await items.count()
                                
                                for i in range(min(item_count, 50)):
                                    try:
                                        item = items.nth(i)
                                        
                                        # Get text and href
                                        text = await item.inner_text()
                                        href = await item.get_attribute("href")
                                        
                                        # Skip if no text or destructive
                                        if not text.strip() or self._is_destructive(text):
                                            continue
                                        
                                        # Check if it's a button (might expand submenu)
                                        tag_name = await item.evaluate("el => el.tagName.toLowerCase()")
                                        is_button = tag_name == "button" or await item.get_attribute("role") == "button"
                                        
                                        # Click to reveal submenu
                                        if is_button or not href:
                                            try:
                                                await item.click(timeout=2000)
                                                await asyncio.sleep(0.5)
                                                await page.wait_for_load_state("networkidle", timeout=5000)
                                            except:
                                                pass
                                        
                                        # Check for submenu items
                                        submenu_items = []
                                        for submenu_sel in self.SUBMENU_INDICATORS:
                                            try:
                                                # Look for submenu near this item
                                                submenu = item.locator(f"xpath=following-sibling::* | ancestor::*//{submenu_sel}")
                                                sub_count = await submenu.count()
                                                
                                                if sub_count > 0:
                                                    # Find links in submenu
                                                    sub_links = submenu.locator("a, button")
                                                    sub_link_count = await sub_links.count()
                                                    
                                                    for j in range(min(sub_link_count, 20)):
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
                                                        except:
                                                            continue
                                                    
                                                    if submenu_items:
                                                        break
                                            except:
                                                continue
                                        
                                        # Add main item if it has href
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
                                                    "submenu_items": submenu_items
                                                })
                                                discovered_urls.add(href)
                                        
                                        # Add submenu items
                                        for sub_item in submenu_items:
                                            nav_path = f"{text.strip()} > {sub_item['text']}"
                                            nav_items.append({
                                                "text": sub_item["text"],
                                                "href": sub_item["href"],
                                                "full_url": sub_item["full_url"],
                                                "nav_path": nav_path,
                                                "submenu_items": []
                                            })
                                    except Exception as e:
                                        logger.debug(f"[{run_id}] Error processing nav item {i}: {e}")
                                        continue
                            except:
                                continue
                except:
                    continue
        except Exception as e:
            logger.warning(f"[{run_id}] Error discovering sidebar navigation: {e}")
        
        return nav_items
    
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
        nav_path: str
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
                                    if (parsed.netloc == base_domain or parsed.netloc == "") and full_url not in visited_urls:
                                        await link.click(timeout=5000)
                                        await asyncio.sleep(2)
                                        await page.wait_for_load_state("networkidle", timeout=10000)
                                        
                                        new_url = page.url
                                        if new_url not in visited_urls:
                                            page_info = await self._analyze_page_enhanced(
                                                page, new_url, f"Card {i+1}", run_id, discovery_dir, len(visited_pages), artifacts_path
                                            )
                                            heading = page_info.get("page_signature", {}).get("heading", "")
                                            fingerprint = self._create_fingerprint(nav_path, new_url, heading)
                                            
                                            if fingerprint not in visited_fingerprints:
                                                visited_pages.append(page_info)
                                                visited_urls.add(new_url)
                                                visited_fingerprints.add(fingerprint)
                                                
                                                if page_info.get("forms"):
                                                    forms_found.extend(page_info["forms"])
                                                
                                                await self._deep_discover_page_enhanced(
                                                    page, new_url, visited_urls, visited_fingerprints, visited_pages, forms_found,
                                                    base_domain, run_id, discovery_dir, max_pages, artifacts_path, nav_path
                                                )
                                        
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
                            await tab.click(timeout=2000)
                            await asyncio.sleep(1)
                            
                            new_url = page.url
                            if new_url not in visited_urls and (urlparse(new_url).netloc == base_domain or urlparse(new_url).netloc == ""):
                                page_info = await self._analyze_page_enhanced(
                                    page, new_url, f"Tab {i+1}", run_id, discovery_dir, len(visited_pages), artifacts_path
                                )
                                heading = page_info.get("page_signature", {}).get("heading", "")
                                fingerprint = self._create_fingerprint(nav_path, new_url, heading)
                                
                                if fingerprint not in visited_fingerprints:
                                    visited_pages.append(page_info)
                                    visited_urls.add(new_url)
                                    visited_fingerprints.add(fingerprint)
                                    
                                    if page_info.get("forms"):
                                        forms_found.extend(page_info["forms"])
                        except:
                            continue
                except:
                    continue
            
        except Exception as e:
            logger.warning(f"[{run_id}] Error in enhanced deep discovery: {e}")
    
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
        """Extract page signature (heading, breadcrumb)."""
        signature = {}
        
        try:
            # Get main heading (h1)
            h1 = page.locator("h1").first
            if await h1.count() > 0:
                signature["heading"] = (await h1.inner_text()).strip()
            
            # Get breadcrumb
            breadcrumb_selectors = [
                ".breadcrumb",
                "[role='navigation'][aria-label*='breadcrumb']",
                "nav[aria-label*='breadcrumb']"
            ]
            
            for sel in breadcrumb_selectors:
                try:
                    bc = page.locator(sel).first
                    if await bc.count() > 0:
                        items = bc.locator("a, span")
                        bc_items = []
                        count = await items.count()
                        for i in range(min(count, 10)):
                            try:
                                text = await items.nth(i).inner_text()
                                if text.strip():
                                    bc_items.append(text.strip())
                            except:
                                continue
                        if bc_items:
                            signature["breadcrumb"] = " > ".join(bc_items)
                            break
                except:
                    continue
        except:
            pass
        
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
    
    async def _get_forms_detailed(self, page, url: str) -> List[Dict[str, Any]]:
        """Get forms with detailed field information."""
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
                    
                    if fields or action:
                        forms.append({
                            "action": action,
                            "method": method.upper(),
                            "fields": fields,
                            "fields_count": len(fields),
                            "page_url": url
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
            page_entry = {
                "url": page.get("url", ""),
                "title": page.get("title", ""),
                "nav_path": page.get("nav_text", ""),
                "signature": page.get("page_signature", {}),
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

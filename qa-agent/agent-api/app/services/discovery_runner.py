"""Discovery runner service for crawling navigation and capturing page information."""

import json
import logging
import asyncio
from pathlib import Path
from typing import Dict, Any, List, Set
from datetime import datetime
from urllib.parse import urlparse, urljoin

from app.models.run_state import RunState

logger = logging.getLogger(__name__)


class DiscoveryRunner:
    """Service for running discovery on a logged-in session."""
    
    # Navigation selectors
    NAV_SELECTORS = [
        "nav a",
        ".sidebar a",
        ".menu a",
        ".nav-link",
        "[role='navigation'] a",
        "aside a",
        ".menu-item a",
        ".nav-item a"
    ]
    
    # Interactive element selectors for deep discovery
    INTERACTIVE_SELECTORS = [
        # Buttons that might navigate
        "button[href]",
        "a.button",
        ".btn",
        "button.nav-button",
        "[role='button'][aria-label*='menu']",
        "[role='button'][aria-label*='Menu']",
        # Cards/tiles
        ".card",
        ".tile",
        "[role='article']",
        ".grid-item",
        ".list-item",
        # Dropdowns/menus
        "[role='menu'] a",
        "[role='menuitem']",
        ".dropdown-item",
        ".menu-item",
        ".dropdown-menu a",
        # Tabs
        "[role='tab']",
        ".tab",
        ".tab-item",
        # Accordions
        "[role='button'][aria-expanded]",
        ".accordion-header",
        ".collapse-toggle"
    ]
    
    # Dropdown/select selectors
    DROPDOWN_SELECTORS = [
        "select",
        "[role='combobox']",
        "[role='listbox']",
        ".dropdown",
        ".select-wrapper",
        "[data-toggle='dropdown']"
    ]
    
    async def run_discovery(
        self,
        page,
        run_id: str,
        base_url: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """
        Run discovery on the current logged-in session.
        
        Args:
            page: Playwright Page object (already logged in)
            run_id: Run identifier
            base_url: Base application URL
            artifacts_path: Path to artifacts directory
        
        Returns:
            Dict with discovery results
        """
        try:
            logger.info(f"[{run_id}] Starting discovery from: {base_url}")
            
            discovery_dir = Path(artifacts_path)
            discovery_dir.mkdir(parents=True, exist_ok=True)
            
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
                # Filter for API-like endpoints
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
                
                # Check for errors
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
                
                # Check for slow requests (>3 seconds)
                if timing:
                    total_time = timing.get("responseEnd", 0) - timing.get("requestStart", 0)
                    if total_time > 3000:  # 3 seconds
                        slow_requests.append({
                            "url": url,
                            "duration_ms": int(total_time),
                            "status": status
                        })
            
            # Attach network listeners
            page.on("request", capture_request)
            page.on("response", capture_response)
            
            # Get current URL (should be on app after login)
            current_url = page.url
            base_domain = urlparse(base_url).netloc
            
            # Step 1: Find navigation links
            logger.info(f"[{run_id}] Finding navigation links")
            nav_items = []
            discovered_urls: Set[str] = set()
            
            for selector in self.NAV_SELECTORS:
                try:
                    links = page.locator(selector)
                    count = await links.count()
                    
                    for i in range(min(count, 50)):  # Limit to 50 nav items
                        try:
                            link = links.nth(i)
                            href = await link.get_attribute("href")
                            text = await link.inner_text()
                            
                            if href and text.strip() and href not in discovered_urls:
                                # Resolve relative URLs
                                full_url = urljoin(current_url, href)
                                parsed = urlparse(full_url)
                                
                                # Only include URLs from same domain
                                if parsed.netloc == base_domain or parsed.netloc == "":
                                    nav_items.append({
                                        "text": text.strip()[:100],
                                        "href": href,
                                        "full_url": full_url
                                    })
                                    discovered_urls.add(href)
                        except Exception as e:
                            logger.debug(f"[{run_id}] Error processing nav link {i}: {e}")
                            continue
                except Exception as e:
                    logger.debug(f"[{run_id}] Error with selector {selector}: {e}")
                    continue
            
            result["navigation_items"] = nav_items
            logger.info(f"[{run_id}] Found {len(nav_items)} navigation items")
            
            # Step 2: Deep discovery - visit pages and interact with elements
            visited_pages = []
            forms_found = []
            visited_urls: Set[str] = set()
            max_pages = 50  # Increased limit for thorough discovery
            
            # Visit base URL first
            try:
                await page.goto(base_url, timeout=30000, wait_until="networkidle")
                await asyncio.sleep(2)  # Give time for dynamic content
                page_info = await self._analyze_page(page, base_url, "Home", run_id, discovery_dir)
                visited_pages.append(page_info)
                visited_urls.add(base_url)
                if page_info.get("forms"):
                    forms_found.extend(page_info["forms"])
                
                # Deep discover from home page
                await self._deep_discover_page(
                    page, base_url, visited_urls, visited_pages, forms_found,
                    base_domain, run_id, discovery_dir, max_pages
                )
            except Exception as e:
                logger.warning(f"[{run_id}] Failed to visit base URL: {e}")
            
            # Visit navigation items
            for idx, nav in enumerate(nav_items):
                if len(visited_pages) >= max_pages:
                    logger.info(f"[{run_id}] Reached max pages limit ({max_pages})")
                    break
                    
                try:
                    url = nav["full_url"]
                    if urlparse(url).netloc != base_domain:
                        continue
                    
                    if url in visited_urls:
                        continue
                    
                    logger.info(f"[{run_id}] Visiting page {len(visited_pages)+1}/{max_pages}: {url}")
                    await page.goto(url, timeout=30000, wait_until="networkidle")
                    await asyncio.sleep(2)
                    
                    page_info = await self._analyze_page(
                        page, url, nav["text"], run_id, discovery_dir, len(visited_pages)
                    )
                    visited_pages.append(page_info)
                    visited_urls.add(url)
                    
                    if page_info.get("forms"):
                        forms_found.extend(page_info["forms"])
                    
                    # Deep discover from this page
                    await self._deep_discover_page(
                        page, url, visited_urls, visited_pages, forms_found,
                        base_domain, run_id, discovery_dir, max_pages
                    )
                    
                except Exception as e:
                    logger.warning(f"[{run_id}] Failed to visit {url}: {e}")
                    continue
            
            # Step 3: Process results
            result["pages"] = visited_pages
            result["forms_found"] = forms_found
            result["api_endpoints"] = api_requests[:100]  # Limit to 100 API endpoints
            
            # Network stats
            result["network_stats"] = {
                "total_requests": len(api_requests),
                "errors_4xx": len([e for e in network_errors if e["type"] == "4xx"]),
                "errors_5xx": len([e for e in network_errors if e["type"] == "5xx"]),
                "slow_requests": slow_requests[:20]  # Limit to 20 slow requests
            }
            
            # Summary
            result["summary"] = {
                "total_pages": len(visited_pages),
                "pages_visited": len(visited_pages),
                "forms_count": len(forms_found),
                "api_endpoints_count": len(api_requests)
            }
            
            result["status"] = "completed"
            result["completed_at"] = datetime.utcnow().isoformat() + "Z"
            
            # Save discovery.json
            discovery_file = discovery_dir / "discovery.json"
            with open(discovery_file, "w") as f:
                json.dump(result, f, indent=2, default=str)
            
            logger.info(f"[{run_id}] Discovery completed: {len(visited_pages)} pages, {len(forms_found)} forms, {len(api_requests)} APIs")
            
            return result
        
        except Exception as e:
            logger.error(f"[{run_id}] Discovery failed: {e}", exc_info=True)
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
            
            # Save failed discovery
            discovery_dir = Path(artifacts_path)
            discovery_dir.mkdir(parents=True, exist_ok=True)
            discovery_file = discovery_dir / "discovery.json"
            with open(discovery_file, "w") as f:
                json.dump(result, f, indent=2, default=str)
            
            return result
    
    async def _deep_discover_page(
        self,
        page,
        current_url: str,
        visited_urls: Set[str],
        visited_pages: List[Dict],
        forms_found: List[Dict],
        base_domain: str,
        run_id: str,
        discovery_dir: Path,
        max_pages: int
    ):
        """Deep discovery: click on interactive elements, dropdowns, cards to find more pages."""
        try:
            if len(visited_pages) >= max_pages:
                return
            
            logger.info(f"[{run_id}] Deep discovering from: {current_url}")
            
            # 1. Find and click on cards/tiles
            await self._click_cards_and_tiles(
                page, visited_urls, visited_pages, forms_found,
                base_domain, run_id, discovery_dir, max_pages
            )
            
            # 2. Open and explore dropdowns
            await self._explore_dropdowns(
                page, visited_urls, visited_pages, forms_found,
                base_domain, run_id, discovery_dir, max_pages
            )
            
            # 3. Click on menu items and buttons
            await self._click_menu_items(
                page, visited_urls, visited_pages, forms_found,
                base_domain, run_id, discovery_dir, max_pages
            )
            
            # 4. Explore tabs
            await self._explore_tabs(
                page, visited_urls, visited_pages, forms_found,
                base_domain, run_id, discovery_dir, max_pages
            )
            
            # 5. Find additional links on the page
            await self._find_additional_links(
                page, current_url, visited_urls, visited_pages, forms_found,
                base_domain, run_id, discovery_dir, max_pages
            )
            
        except Exception as e:
            logger.warning(f"[{run_id}] Error in deep discovery: {e}")
    
    async def _click_cards_and_tiles(
        self, page, visited_urls, visited_pages, forms_found,
        base_domain, run_id, discovery_dir, max_pages
    ):
        """Click on cards and tiles to discover linked pages."""
        try:
            card_selectors = [".card", ".tile", "[role='article']", ".grid-item", ".list-item"]
            
            for selector in card_selectors:
                if len(visited_pages) >= max_pages:
                    break
                    
                try:
                    cards = page.locator(selector)
                    count = await cards.count()
                    
                    for i in range(min(count, 10)):  # Limit to 10 cards per page
                        if len(visited_pages) >= max_pages:
                            break
                            
                        try:
                            card = cards.nth(i)
                            
                            # Check if card has a link
                            link = card.locator("a").first
                            if await link.count() > 0:
                                href = await link.get_attribute("href")
                                if href:
                                    full_url = urljoin(page.url, href)
                                    parsed = urlparse(full_url)
                                    
                                    if (parsed.netloc == base_domain or parsed.netloc == "") and full_url not in visited_urls:
                                        logger.info(f"[{run_id}] Clicking card link: {full_url}")
                                        await link.click(timeout=5000)
                                        await asyncio.sleep(2)
                                        await page.wait_for_load_state("networkidle", timeout=10000)
                                        
                                        new_url = page.url
                                        if new_url not in visited_urls:
                                            page_info = await self._analyze_page(
                                                page, new_url, f"Card {i+1}", run_id, discovery_dir, len(visited_pages)
                                            )
                                            visited_pages.append(page_info)
                                            visited_urls.add(new_url)
                                            
                                            if page_info.get("forms"):
                                                forms_found.extend(page_info["forms"])
                                            
                                            # Recursively discover from this new page
                                            await self._deep_discover_page(
                                                page, new_url, visited_urls, visited_pages, forms_found,
                                                base_domain, run_id, discovery_dir, max_pages
                                            )
                                        
                                        # Go back
                                        await page.go_back(timeout=10000)
                                        await asyncio.sleep(1)
                        except Exception as e:
                            logger.debug(f"[{run_id}] Error clicking card {i}: {e}")
                            continue
                except:
                    continue
        except Exception as e:
            logger.debug(f"[{run_id}] Error in _click_cards_and_tiles: {e}")
    
    async def _explore_dropdowns(
        self, page, visited_urls, visited_pages, forms_found,
        base_domain, run_id, discovery_dir, max_pages
    ):
        """Open dropdowns and explore their options."""
        try:
            for selector in self.DROPDOWN_SELECTORS:
                if len(visited_pages) >= max_pages:
                    break
                    
                try:
                    dropdowns = page.locator(selector)
                    count = await dropdowns.count()
                    
                    for i in range(min(count, 5)):  # Limit to 5 dropdowns per page
                        try:
                            dropdown = dropdowns.nth(i)
                            
                            # Try to click to open
                            try:
                                await dropdown.click(timeout=2000)
                                await asyncio.sleep(0.5)
                            except:
                                pass
                            
                            # Find options/items in dropdown
                            option_selectors = [
                                "option",
                                "[role='option']",
                                ".dropdown-item",
                                ".menu-item",
                                "li a"
                            ]
                            
                            for opt_sel in option_selectors:
                                options = dropdown.locator(opt_sel)
                                opt_count = await options.count()
                                
                                for j in range(min(opt_count, 5)):  # Limit to 5 options per dropdown
                                    if len(visited_pages) >= max_pages:
                                        break
                                        
                                    try:
                                        option = options.nth(j)
                                        href = await option.get_attribute("href")
                                        
                                        if not href:
                                            # Try clicking the option itself
                                            try:
                                                await option.click(timeout=2000)
                                                await asyncio.sleep(2)
                                                await page.wait_for_load_state("networkidle", timeout=10000)
                                                
                                                new_url = page.url
                                                if new_url not in visited_urls and (urlparse(new_url).netloc == base_domain or urlparse(new_url).netloc == ""):
                                                    page_info = await self._analyze_page(
                                                        page, new_url, f"Dropdown Option {j+1}", run_id, discovery_dir, len(visited_pages)
                                                    )
                                                    visited_pages.append(page_info)
                                                    visited_urls.add(new_url)
                                                    
                                                    if page_info.get("forms"):
                                                        forms_found.extend(page_info["forms"])
                                                    
                                                    # Go back
                                                    await page.go_back(timeout=10000)
                                                    await asyncio.sleep(1)
                                            except:
                                                pass
                                        else:
                                            full_url = urljoin(page.url, href)
                                            parsed = urlparse(full_url)
                                            
                                            if (parsed.netloc == base_domain or parsed.netloc == "") and full_url not in visited_urls:
                                                logger.info(f"[{run_id}] Clicking dropdown option: {full_url}")
                                                await option.click(timeout=2000)
                                                await asyncio.sleep(2)
                                                await page.wait_for_load_state("networkidle", timeout=10000)
                                                
                                                new_url = page.url
                                                if new_url not in visited_urls:
                                                    page_info = await self._analyze_page(
                                                        page, new_url, f"Dropdown Option {j+1}", run_id, discovery_dir, len(visited_pages)
                                                    )
                                                    visited_pages.append(page_info)
                                                    visited_urls.add(new_url)
                                                    
                                                    if page_info.get("forms"):
                                                        forms_found.extend(page_info["forms"])
                                                    
                                                    await self._deep_discover_page(
                                                        page, new_url, visited_urls, visited_pages, forms_found,
                                                        base_domain, run_id, discovery_dir, max_pages
                                                    )
                                                
                                                # Go back
                                                await page.go_back(timeout=10000)
                                                await asyncio.sleep(1)
                                    except:
                                        continue
                        except:
                            continue
                except:
                    continue
        except Exception as e:
            logger.debug(f"[{run_id}] Error in _explore_dropdowns: {e}")
    
    async def _click_menu_items(
        self, page, visited_urls, visited_pages, forms_found,
        base_domain, run_id, discovery_dir, max_pages
    ):
        """Click on menu items and navigation buttons."""
        try:
            menu_selectors = [
                "[role='menu'] a",
                "[role='menuitem']",
                ".menu-item a",
                ".dropdown-menu a",
                "nav button",
                ".nav-button"
            ]
            
            for selector in menu_selectors:
                if len(visited_pages) >= max_pages:
                    break
                    
                try:
                    items = page.locator(selector)
                    count = await items.count()
                    
                    for i in range(min(count, 10)):  # Limit to 10 menu items
                        if len(visited_pages) >= max_pages:
                            break
                            
                        try:
                            item = items.nth(i)
                            
                            # Get href if it's a link
                            href = await item.get_attribute("href")
                            
                            if href:
                                full_url = urljoin(page.url, href)
                                parsed = urlparse(full_url)
                                
                                if (parsed.netloc == base_domain or parsed.netloc == "") and full_url not in visited_urls:
                                    logger.info(f"[{run_id}] Clicking menu item: {full_url}")
                                    await item.click(timeout=5000)
                                    await asyncio.sleep(2)
                                    await page.wait_for_load_state("networkidle", timeout=10000)
                                    
                                    new_url = page.url
                                    if new_url not in visited_urls:
                                        page_info = await self._analyze_page(
                                            page, new_url, f"Menu Item {i+1}", run_id, discovery_dir, len(visited_pages)
                                        )
                                        visited_pages.append(page_info)
                                        visited_urls.add(new_url)
                                        
                                        if page_info.get("forms"):
                                            forms_found.extend(page_info["forms"])
                                        
                                        await self._deep_discover_page(
                                            page, new_url, visited_urls, visited_pages, forms_found,
                                            base_domain, run_id, discovery_dir, max_pages
                                        )
                                    
                                    # Go back
                                    await page.go_back(timeout=10000)
                                    await asyncio.sleep(1)
                        except:
                            continue
                except:
                    continue
        except Exception as e:
            logger.debug(f"[{run_id}] Error in _click_menu_items: {e}")
    
    async def _explore_tabs(
        self, page, visited_urls, visited_pages, forms_found,
        base_domain, run_id, discovery_dir, max_pages
    ):
        """Click on tabs to discover tabbed content."""
        try:
            tab_selectors = ["[role='tab']", ".tab", ".tab-item"]
            
            for selector in tab_selectors:
                if len(visited_pages) >= max_pages:
                    break
                    
                try:
                    tabs = page.locator(selector)
                    count = await tabs.count()
                    
                    for i in range(min(count, 5)):  # Limit to 5 tabs
                        try:
                            tab = tabs.nth(i)
                            await tab.click(timeout=2000)
                            await asyncio.sleep(1)
                            
                            # Check if URL changed (some tabs change URL)
                            new_url = page.url
                            if new_url not in visited_urls and (urlparse(new_url).netloc == base_domain or urlparse(new_url).netloc == ""):
                                page_info = await self._analyze_page(
                                    page, new_url, f"Tab {i+1}", run_id, discovery_dir, len(visited_pages)
                                )
                                visited_pages.append(page_info)
                                visited_urls.add(new_url)
                                
                                if page_info.get("forms"):
                                    forms_found.extend(page_info["forms"])
                        except:
                            continue
                except:
                    continue
        except Exception as e:
            logger.debug(f"[{run_id}] Error in _explore_tabs: {e}")
    
    async def _find_additional_links(
        self, page, current_url, visited_urls, visited_pages, forms_found,
        base_domain, run_id, discovery_dir, max_pages
    ):
        """Find additional links on the page that weren't in navigation."""
        try:
            # Find all links on the page
            all_links = page.locator("a[href]")
            count = await all_links.count()
            
            for i in range(min(count, 20)):  # Limit to 20 additional links per page
                if len(visited_pages) >= max_pages:
                    break
                    
                try:
                    link = all_links.nth(i)
                    href = await link.get_attribute("href")
                    
                    if href:
                        full_url = urljoin(current_url, href)
                        parsed = urlparse(full_url)
                        
                        # Only follow same-domain links we haven't visited
                        if (parsed.netloc == base_domain or parsed.netloc == "") and full_url not in visited_urls:
                            # Skip common non-page links
                            if any(skip in full_url.lower() for skip in ['#', 'javascript:', 'mailto:', 'tel:', '.pdf', '.jpg', '.png']):
                                continue
                            
                            logger.info(f"[{run_id}] Following additional link: {full_url}")
                            await link.click(timeout=5000)
                            await asyncio.sleep(2)
                            await page.wait_for_load_state("networkidle", timeout=10000)
                            
                            new_url = page.url
                            if new_url not in visited_urls:
                                page_info = await self._analyze_page(
                                    page, new_url, f"Link {i+1}", run_id, discovery_dir, len(visited_pages)
                                )
                                visited_pages.append(page_info)
                                visited_urls.add(new_url)
                                
                                if page_info.get("forms"):
                                    forms_found.extend(page_info["forms"])
                                
                                await self._deep_discover_page(
                                    page, new_url, visited_urls, visited_pages, forms_found,
                                    base_domain, run_id, discovery_dir, max_pages
                                )
                            
                            # Go back
                            await page.go_back(timeout=10000)
                            await asyncio.sleep(1)
                except:
                    continue
        except Exception as e:
            logger.debug(f"[{run_id}] Error in _find_additional_links: {e}")
    
    async def _analyze_page(
        self,
        page,
        url: str,
        nav_text: str,
        run_id: str,
        discovery_dir: Path,
        page_index: int = 0
    ) -> Dict[str, Any]:
        """Analyze a single page for forms, actions, and metadata."""
        try:
            title = await page.title()
            
            page_info = {
                "url": url,
                "nav_text": nav_text,
                "title": title,
                "forms": []
            }
            
            # Find forms
            try:
                form_elements = page.locator("form")
                form_count = await form_elements.count()
                
                for i in range(min(form_count, 10)):  # Limit to 10 forms per page
                    try:
                        form = form_elements.nth(i)
                        action = await form.get_attribute("action") or ""
                        method = await form.get_attribute("method") or "GET"
                        
                        # Find inputs
                        inputs = []
                        input_elements = form.locator("input, select, textarea")
                        input_count = await input_elements.count()
                        
                        for j in range(min(input_count, 20)):  # Limit to 20 inputs per form
                            try:
                                inp = input_elements.nth(j)
                                inp_type = await inp.get_attribute("type") or "text"
                                inp_name = await inp.get_attribute("name") or ""
                                inp_id = await inp.get_attribute("id") or ""
                                
                                if inp_type not in ["hidden", "submit", "button"]:
                                    inputs.append({
                                        "type": inp_type,
                                        "name": inp_name,
                                        "id": inp_id
                                    })
                            except:
                                continue
                        
                        if inputs or action:
                            page_info["forms"].append({
                                "action": action,
                                "method": method.upper(),
                                "inputs": inputs,
                                "page_url": url
                            })
                    except:
                        continue
            except Exception as e:
                logger.debug(f"[{run_id}] Error finding forms: {e}")
            
            # Screenshot (optional, for key pages)
            if page_index < 5:  # Screenshot first 5 pages
                try:
                    safe_name = "".join(c if c.isalnum() else "_" for c in nav_text[:20])
                    screenshot_path = discovery_dir / f"page_{page_index:02d}_{safe_name}.png"
                    await page.screenshot(path=str(screenshot_path))
                except:
                    pass
            
            return page_info
        
        except Exception as e:
            logger.error(f"[{run_id}] Error analyzing page {url}: {e}")
            return {
                "url": url,
                "nav_text": nav_text,
                "title": "",
                "forms": [],
                "error": str(e)[:200]
            }


# Global discovery runner instance
_discovery_runner = DiscoveryRunner()


def get_discovery_runner() -> DiscoveryRunner:
    """Get global discovery runner instance."""
    return _discovery_runner

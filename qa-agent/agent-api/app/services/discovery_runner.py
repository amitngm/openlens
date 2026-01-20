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
            
            # Step 2: Visit pages and collect information
            visited_pages = []
            forms_found = []
            
            # Visit base URL first
            try:
                await page.goto(base_url, timeout=30000, wait_until="networkidle")
                await asyncio.sleep(1)
                page_info = await self._analyze_page(page, base_url, "Home", run_id, discovery_dir)
                visited_pages.append(page_info)
                if page_info.get("forms"):
                    forms_found.extend(page_info["forms"])
            except Exception as e:
                logger.warning(f"[{run_id}] Failed to visit base URL: {e}")
            
            # Visit navigation items (limit to 20 pages)
            for idx, nav in enumerate(nav_items[:20]):
                try:
                    url = nav["full_url"]
                    if urlparse(url).netloc != base_domain:
                        continue
                    
                    logger.info(f"[{run_id}] Visiting page {idx+1}/{min(len(nav_items), 20)}: {url}")
                    await page.goto(url, timeout=30000, wait_until="networkidle")
                    await asyncio.sleep(1)
                    
                    page_info = await self._analyze_page(
                        page, url, nav["text"], run_id, discovery_dir, idx + 1
                    )
                    visited_pages.append(page_info)
                    
                    if page_info.get("forms"):
                        forms_found.extend(page_info["forms"])
                    
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

"""
Intelligent QA - Works like a human tester.

1. Look at a page and understand what's there
2. Identify testable elements naturally
3. Suggest meaningful tests
4. Execute and report results
"""

import logging
import asyncio
import re
import uuid
import time
from datetime import datetime
from typing import Optional, Dict, Any, List
from urllib.parse import urljoin, urlparse
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


class AnalyzeRequest(BaseModel):
    url: str
    username: Optional[str] = None
    password: Optional[str] = None


class TestRequest(BaseModel):
    url: str
    test_type: str  # 'page_load', 'links', 'forms', 'api', 'login', 'accessibility'
    username: Optional[str] = None
    password: Optional[str] = None


class PageUnderstanding:
    """Understand a page like a human would."""
    
    def __init__(self, html: str, url: str, status_code: int, response_time: float):
        self.html = html
        self.url = url
        self.status_code = status_code
        self.response_time = response_time
        self.base_url = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
        
    def get_title(self) -> str:
        """What is this page called?"""
        match = re.search(r'<title[^>]*>([^<]+)</title>', self.html, re.IGNORECASE)
        return match.group(1).strip() if match else "Untitled Page"
    
    def get_meta_description(self) -> str:
        """What does this page claim to be about?"""
        match = re.search(r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)["\']', self.html, re.IGNORECASE)
        if not match:
            match = re.search(r'<meta\s+content=["\']([^"\']+)["\']\s+name=["\']description["\']', self.html, re.IGNORECASE)
        return match.group(1).strip() if match else ""
    
    def find_forms(self) -> List[Dict[str, Any]]:
        """Find all forms on the page."""
        forms = []
        form_matches = re.finditer(r'<form([^>]*)>(.*?)</form>', self.html, re.IGNORECASE | re.DOTALL)
        
        for i, match in enumerate(form_matches):
            attrs = match.group(1)
            content = match.group(2)
            
            # Determine form purpose
            purpose = "Unknown"
            fields = []
            
            # Find all inputs
            inputs = re.findall(r'<input([^>]*)>', content, re.IGNORECASE)
            for inp in inputs:
                input_type = re.search(r'type=["\']([^"\']+)["\']', inp, re.IGNORECASE)
                input_name = re.search(r'name=["\']([^"\']+)["\']', inp, re.IGNORECASE)
                input_placeholder = re.search(r'placeholder=["\']([^"\']+)["\']', inp, re.IGNORECASE)
                
                t = input_type.group(1) if input_type else "text"
                n = input_name.group(1) if input_name else ""
                p = input_placeholder.group(1) if input_placeholder else ""
                
                if t not in ['hidden', 'submit', 'button']:
                    fields.append({
                        "type": t,
                        "name": n,
                        "placeholder": p,
                        "label": p or n
                    })
            
            # Determine purpose based on fields
            field_names = " ".join([f["name"].lower() + " " + f["placeholder"].lower() for f in fields])
            
            if "password" in field_names and ("user" in field_names or "email" in field_names or "login" in field_names):
                purpose = "Login Form"
            elif "password" in field_names and "confirm" in field_names:
                purpose = "Registration Form"
            elif "search" in field_names or "query" in field_names:
                purpose = "Search Form"
            elif "email" in field_names and len(fields) <= 2:
                purpose = "Newsletter/Email Signup"
            elif "contact" in field_names or "message" in field_names:
                purpose = "Contact Form"
            else:
                purpose = f"Form with {len(fields)} fields"
            
            action = re.search(r'action=["\']([^"\']+)["\']', attrs, re.IGNORECASE)
            method = re.search(r'method=["\']([^"\']+)["\']', attrs, re.IGNORECASE)
            
            forms.append({
                "index": i + 1,
                "purpose": purpose,
                "action": action.group(1) if action else "",
                "method": (method.group(1) if method else "GET").upper(),
                "fields": fields,
                "field_count": len(fields)
            })
        
        return forms
    
    def find_navigation(self) -> Dict[str, Any]:
        """Find main navigation structure."""
        nav = {
            "has_nav": False,
            "menu_items": [],
            "total_links": 0
        }
        
        # Find nav elements
        nav_match = re.search(r'<nav[^>]*>(.*?)</nav>', self.html, re.IGNORECASE | re.DOTALL)
        if nav_match:
            nav["has_nav"] = True
            nav_content = nav_match.group(1)
            links = re.findall(r'<a[^>]*href=["\']([^"\']+)["\'][^>]*>([^<]*)</a>', nav_content, re.IGNORECASE)
            nav["menu_items"] = [{"href": l[0], "text": l[1].strip()} for l in links[:15]]
        
        # Count total links
        all_links = re.findall(r'<a[^>]*href=["\']([^"\']+)["\']', self.html, re.IGNORECASE)
        nav["total_links"] = len(all_links)
        
        return nav
    
    def find_buttons(self) -> List[Dict[str, str]]:
        """Find all buttons."""
        buttons = []
        
        # <button> elements
        btn_matches = re.findall(r'<button[^>]*>([^<]+)</button>', self.html, re.IGNORECASE)
        for text in btn_matches:
            buttons.append({"text": text.strip(), "type": "button"})
        
        # input[type=submit]
        submit_matches = re.findall(r'<input[^>]*type=["\']submit["\'][^>]*value=["\']([^"\']+)["\']', self.html, re.IGNORECASE)
        for text in submit_matches:
            buttons.append({"text": text.strip(), "type": "submit"})
        
        return buttons[:20]  # Limit to 20
    
    def find_images(self) -> Dict[str, Any]:
        """Find images and check for alt text (accessibility)."""
        images = re.findall(r'<img([^>]*)>', self.html, re.IGNORECASE)
        
        with_alt = 0
        without_alt = 0
        
        for img in images:
            if re.search(r'alt=["\'][^"\']+["\']', img, re.IGNORECASE):
                with_alt += 1
            else:
                without_alt += 1
        
        return {
            "total": len(images),
            "with_alt_text": with_alt,
            "without_alt_text": without_alt,
            "accessibility_score": f"{int(with_alt / len(images) * 100)}%" if images else "N/A"
        }
    
    def find_headings(self) -> List[Dict[str, str]]:
        """Find heading structure."""
        headings = []
        for level in range(1, 7):
            matches = re.findall(rf'<h{level}[^>]*>([^<]+)</h{level}>', self.html, re.IGNORECASE)
            for text in matches:
                headings.append({"level": f"h{level}", "text": text.strip()[:100]})
        return headings[:20]
    
    def detect_technologies(self) -> List[str]:
        """Detect what technologies the page uses."""
        techs = []
        
        if "react" in self.html.lower() or "data-reactroot" in self.html or "__NEXT_DATA__" in self.html:
            techs.append("React/Next.js")
        if "vue" in self.html.lower() or "v-bind" in self.html or "v-if" in self.html:
            techs.append("Vue.js")
        if "ng-" in self.html or "angular" in self.html.lower():
            techs.append("Angular")
        if "jquery" in self.html.lower():
            techs.append("jQuery")
        if "bootstrap" in self.html.lower():
            techs.append("Bootstrap")
        if "tailwind" in self.html.lower():
            techs.append("Tailwind CSS")
        if "<script" in self.html:
            techs.append("JavaScript")
        if "@media" in self.html or "responsive" in self.html.lower():
            techs.append("Responsive Design")
        
        return techs if techs else ["Standard HTML/CSS"]
    
    def suggest_tests(self) -> List[Dict[str, Any]]:
        """Based on what I see, what should we test?"""
        tests = []
        
        # Always suggest page load test
        tests.append({
            "id": "page_load",
            "name": "Page Load Test",
            "description": "Verify the page loads successfully",
            "priority": "high",
            "can_run": True
        })
        
        # Forms
        forms = self.find_forms()
        for form in forms:
            if "Login" in form["purpose"]:
                tests.append({
                    "id": "login",
                    "name": "Login Functionality",
                    "description": f"Test the {form['purpose'].lower()}",
                    "priority": "high",
                    "can_run": True,
                    "requires_credentials": True
                })
            elif "Search" in form["purpose"]:
                tests.append({
                    "id": "search",
                    "name": "Search Functionality",
                    "description": "Test search with various queries",
                    "priority": "medium",
                    "can_run": True
                })
            else:
                tests.append({
                    "id": f"form_{form['index']}",
                    "name": f"Test {form['purpose']}",
                    "description": f"Validate form with {form['field_count']} fields",
                    "priority": "medium",
                    "can_run": True
                })
        
        # Navigation
        nav = self.find_navigation()
        if nav["total_links"] > 5:
            tests.append({
                "id": "links",
                "name": "Link Validation",
                "description": f"Check all {nav['total_links']} links are working",
                "priority": "medium",
                "can_run": True
            })
        
        # Images/Accessibility
        images = self.find_images()
        if images["total"] > 0:
            tests.append({
                "id": "accessibility",
                "name": "Accessibility Check",
                "description": f"Verify {images['total']} images have alt text",
                "priority": "low",
                "can_run": True
            })
        
        return tests
    
    def get_full_understanding(self) -> Dict[str, Any]:
        """Return complete page understanding."""
        return {
            "url": self.url,
            "loaded": self.status_code < 400,
            "status_code": self.status_code,
            "response_time_ms": int(self.response_time * 1000),
            
            # What is this page?
            "page_identity": {
                "title": self.get_title(),
                "description": self.get_meta_description(),
                "technologies": self.detect_technologies()
            },
            
            # What elements are on the page?
            "elements": {
                "forms": self.find_forms(),
                "buttons": self.find_buttons(),
                "navigation": self.find_navigation(),
                "images": self.find_images(),
                "headings": self.find_headings()
            },
            
            # What should we test?
            "suggested_tests": self.suggest_tests()
        }


@router.post("/analyze")
async def analyze_page(body: AnalyzeRequest):
    """
    Look at a page and understand it like a human would.
    
    Returns:
    - What the page is (title, description, tech stack)
    - What elements are on it (forms, buttons, links)
    - What tests make sense for this page
    """
    import httpx
    
    start_time = time.time()
    
    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            verify=False
        ) as client:
            response = await client.get(body.url)
            response_time = time.time() - start_time
            
            understanding = PageUnderstanding(
                html=response.text,
                url=body.url,
                status_code=response.status_code,
                response_time=response_time
            )
            
            result = understanding.get_full_understanding()
            result["analyzed_at"] = datetime.utcnow().isoformat() + "Z"
            
            return result
            
    except httpx.ConnectError:
        return {
            "url": body.url,
            "loaded": False,
            "error": f"Cannot connect to {body.url}. Is the server running?",
            "suggestion": "Check if the URL is correct and the server is accessible."
        }
    except httpx.TimeoutException:
        return {
            "url": body.url,
            "loaded": False,
            "error": f"Request timed out after 30 seconds",
            "suggestion": "The server might be slow or unresponsive."
        }
    except Exception as e:
        logger.error(f"Error analyzing page: {e}", exc_info=True)
        return {
            "url": body.url,
            "loaded": False,
            "error": str(e)
        }


@router.post("/test")
async def run_test(body: TestRequest):
    """
    Run a specific test on the page.
    """
    import httpx
    
    test_id = str(uuid.uuid4())[:8]
    results = {
        "test_id": test_id,
        "url": body.url,
        "test_type": body.test_type,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "passed": False,
        "checks": []
    }
    
    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            verify=False
        ) as client:
            
            if body.test_type == "page_load":
                start = time.time()
                response = await client.get(body.url)
                elapsed = time.time() - start
                
                # Check 1: Page loads
                results["checks"].append({
                    "name": "Page loads successfully",
                    "passed": response.status_code < 400,
                    "detail": f"Status: {response.status_code}"
                })
                
                # Check 2: Response time
                results["checks"].append({
                    "name": "Response time acceptable",
                    "passed": elapsed < 5.0,
                    "detail": f"{int(elapsed * 1000)}ms"
                })
                
                # Check 3: Has content
                results["checks"].append({
                    "name": "Page has content",
                    "passed": len(response.text) > 100,
                    "detail": f"{len(response.text)} bytes"
                })
                
                # Check 4: Has title
                has_title = bool(re.search(r'<title[^>]*>[^<]+</title>', response.text, re.IGNORECASE))
                results["checks"].append({
                    "name": "Page has a title",
                    "passed": has_title,
                    "detail": "Title tag found" if has_title else "No title tag"
                })
                
            elif body.test_type == "links":
                response = await client.get(body.url)
                links = re.findall(r'href=["\']([^"\']+)["\']', response.text, re.IGNORECASE)
                
                # Filter to same-domain links
                base = f"{urlparse(body.url).scheme}://{urlparse(body.url).netloc}"
                internal_links = [l for l in links if l.startswith('/') or l.startswith(base)]
                internal_links = list(set(internal_links))[:20]  # Check up to 20 unique links
                
                broken = 0
                working = 0
                
                for link in internal_links:
                    full_url = urljoin(body.url, link)
                    try:
                        r = await client.head(full_url, timeout=10.0)
                        if r.status_code < 400:
                            working += 1
                        else:
                            broken += 1
                            results["checks"].append({
                                "name": f"Link: {link[:50]}",
                                "passed": False,
                                "detail": f"Status {r.status_code}"
                            })
                    except:
                        broken += 1
                
                results["checks"].append({
                    "name": f"Internal links working",
                    "passed": broken == 0,
                    "detail": f"{working} OK, {broken} broken"
                })
                
            elif body.test_type == "login" and body.username and body.password:
                # Try to find and submit login form
                response = await client.get(body.url)
                html = response.text
                
                # Find login form action
                form_match = re.search(r'<form[^>]*action=["\']([^"\']*)["\'][^>]*>.*?password', html, re.IGNORECASE | re.DOTALL)
                
                if not form_match:
                    results["checks"].append({
                        "name": "Find login form",
                        "passed": False,
                        "detail": "No login form detected"
                    })
                else:
                    results["checks"].append({
                        "name": "Find login form",
                        "passed": True,
                        "detail": "Login form found"
                    })
                    
                    # Try common login endpoints
                    login_endpoints = [
                        f"{body.url}/api/auth/login",
                        f"{body.url}/api/login", 
                        f"{body.url}/login",
                        f"{body.url}/api/v1/login",
                    ]
                    
                    login_success = False
                    for endpoint in login_endpoints:
                        try:
                            r = await client.post(
                                endpoint,
                                json={"username": body.username, "password": body.password},
                                headers={"Content-Type": "application/json"}
                            )
                            if r.status_code in [200, 201, 302]:
                                login_success = True
                                results["checks"].append({
                                    "name": "Login succeeds",
                                    "passed": True,
                                    "detail": f"Logged in via {endpoint}"
                                })
                                break
                        except:
                            continue
                    
                    if not login_success:
                        results["checks"].append({
                            "name": "Login succeeds",
                            "passed": False,
                            "detail": "Could not login with provided credentials"
                        })
                        
            elif body.test_type == "accessibility":
                response = await client.get(body.url)
                html = response.text
                
                # Check images have alt
                images = re.findall(r'<img([^>]*)>', html, re.IGNORECASE)
                images_with_alt = sum(1 for img in images if re.search(r'alt=["\'][^"\']+["\']', img, re.IGNORECASE))
                
                results["checks"].append({
                    "name": "Images have alt text",
                    "passed": images_with_alt == len(images) or len(images) == 0,
                    "detail": f"{images_with_alt}/{len(images)} images have alt text"
                })
                
                # Check form labels
                inputs = re.findall(r'<input[^>]*type=["\'](?!hidden|submit|button)[^"\']*["\'][^>]*id=["\']([^"\']+)["\']', html, re.IGNORECASE)
                labels = re.findall(r'<label[^>]*for=["\']([^"\']+)["\']', html, re.IGNORECASE)
                
                labeled = sum(1 for inp in inputs if inp in labels)
                results["checks"].append({
                    "name": "Form inputs have labels",
                    "passed": labeled == len(inputs) or len(inputs) == 0,
                    "detail": f"{labeled}/{len(inputs)} inputs have labels"
                })
                
                # Check heading hierarchy
                h1_count = len(re.findall(r'<h1', html, re.IGNORECASE))
                results["checks"].append({
                    "name": "Single H1 heading",
                    "passed": h1_count == 1,
                    "detail": f"Found {h1_count} H1 tags"
                })
                
                # Check contrast (basic - looks for very light text)
                light_text = len(re.findall(r'color:\s*#[fF]{3,6}|color:\s*white|color:\s*rgb\s*\(\s*25[0-5]', html))
                results["checks"].append({
                    "name": "No extremely light text colors",
                    "passed": light_text < 5,
                    "detail": f"Found {light_text} potentially low-contrast elements"
                })
            
            else:
                results["checks"].append({
                    "name": "Test type",
                    "passed": False,
                    "detail": f"Unknown test type: {body.test_type}"
                })
        
        # Calculate overall pass/fail
        results["passed"] = all(c["passed"] for c in results["checks"]) if results["checks"] else False
        results["summary"] = f"{sum(1 for c in results['checks'] if c['passed'])}/{len(results['checks'])} checks passed"
        results["completed_at"] = datetime.utcnow().isoformat() + "Z"
        
    except Exception as e:
        logger.error(f"Test error: {e}", exc_info=True)
        results["error"] = str(e)
        results["passed"] = False
    
    return results


@router.post("/quick-test")
async def quick_test(body: AnalyzeRequest):
    """
    One-click full test suite.
    Analyzes the page AND runs all recommended tests.
    """
    import httpx
    
    results = {
        "url": body.url,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "analysis": None,
        "tests": [],
        "overall_health": "unknown"
    }
    
    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            verify=False
        ) as client:
            # First, analyze the page
            start_time = time.time()
            response = await client.get(body.url)
            response_time = time.time() - start_time
            
            understanding = PageUnderstanding(
                html=response.text,
                url=body.url,
                status_code=response.status_code,
                response_time=response_time
            )
            
            results["analysis"] = understanding.get_full_understanding()
            
            # Run page load test
            page_load_result = await run_test(TestRequest(url=body.url, test_type="page_load"))
            results["tests"].append(page_load_result)
            
            # Run link check if there are links
            if results["analysis"]["elements"]["navigation"]["total_links"] > 0:
                link_result = await run_test(TestRequest(url=body.url, test_type="links"))
                results["tests"].append(link_result)
            
            # Run accessibility check
            accessibility_result = await run_test(TestRequest(url=body.url, test_type="accessibility"))
            results["tests"].append(accessibility_result)
            
            # Calculate overall health
            passed_tests = sum(1 for t in results["tests"] if t.get("passed"))
            total_tests = len(results["tests"])
            
            if total_tests == 0:
                results["overall_health"] = "unknown"
            elif passed_tests == total_tests:
                results["overall_health"] = "healthy"
            elif passed_tests > total_tests / 2:
                results["overall_health"] = "warning"
            else:
                results["overall_health"] = "critical"
            
            results["summary"] = f"{passed_tests}/{total_tests} test suites passed"
            
    except Exception as e:
        logger.error(f"Quick test error: {e}", exc_info=True)
        results["error"] = str(e)
        results["overall_health"] = "error"
    
    results["completed_at"] = datetime.utcnow().isoformat() + "Z"
    return results

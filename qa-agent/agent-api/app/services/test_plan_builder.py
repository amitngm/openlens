"""Test plan builder service for generating test plans based on user intent."""

import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Set
from urllib.parse import urlparse

from app.models.run_state import RunState
from app.models.run_context import Question, QuestionOption

logger = logging.getLogger(__name__)


class TestPlanBuilder:
    """Service for building test plans based on discovery results and user intent."""
    
    async def build_test_plan(
        self,
        page,
        run_id: str,
        artifacts_path: str,
        test_intent: str
    ) -> Dict[str, Any]:
        """
        Build test plan based on user's selected intent.
        
        Args:
            page: Playwright Page object
            run_id: Run identifier
            artifacts_path: Path to artifacts directory
            test_intent: Selected intent (smoke, crud_sanity, module_based, exploratory_15m)
        
        Returns:
            Dict with:
                - test_plan: Dict with test plan
                - next_state: RunState
                - question: Optional[Question] (if module_based)
                - modules: Optional[List[str]] (if module_based)
        """
        try:
            discovery_dir = Path(artifacts_path)
            discovery_file = discovery_dir / "discovery.json"
            
            if not discovery_file.exists():
                raise FileNotFoundError("discovery.json not found")
            
            with open(discovery_file) as f:
                discovery_data = json.load(f)
            
            base_url = discovery_data.get("base_url", "")
            pages = discovery_data.get("pages", [])
            forms_found = discovery_data.get("forms_found", [])
            api_endpoints = discovery_data.get("api_endpoints", [])
            
            test_plan = {
                "run_id": run_id,
                "test_intent": test_intent,
                "generated_at": None,
                "total_tests": 0,
                "tests": []
            }
            
            if test_intent == "smoke":
                # Generate minimal happy-path tests for top modules/pages
                logger.info(f"[{run_id}] Building smoke test plan")
                tests = self._generate_smoke_tests(discovery_data, base_url)
                test_plan["tests"] = tests
                test_plan["total_tests"] = len(tests)
                test_plan["generated_at"] = self._get_timestamp()
                
            elif test_intent == "crud_sanity":
                # Generate create/update/delete/validation tests for CRUD actions (SAFE only)
                logger.info(f"[{run_id}] Building CRUD sanity test plan")
                tests = self._generate_crud_sanity_tests(discovery_data, base_url)
                test_plan["tests"] = tests
                test_plan["total_tests"] = len(tests)
                test_plan["generated_at"] = self._get_timestamp()
                
            elif test_intent == "module_based":
                # Infer modules and ask user to select
                logger.info(f"[{run_id}] Inferring modules for module-based testing")
                modules = self._infer_modules(discovery_data)
                
                if len(modules) > 1:
                    # Multiple modules - ask user to select
                    question_options = [
                        QuestionOption(id=mod.lower().replace(" ", "_"), label=mod)
                        for mod in modules
                    ]
                    
                    question = Question(
                        id="test_intent_module",
                        type="select_one",
                        text=f"Found {len(modules)} modules. Which module should I test?",
                        options=question_options,
                        screenshot_path=None
                    )
                    
                    return {
                        "test_plan": None,
                        "next_state": RunState.WAIT_TEST_INTENT_MODULE,
                        "question": question,
                        "modules": modules
                    }
                else:
                    # Single module - proceed with it
                    module = modules[0] if modules else "default"
                    tests = self._generate_module_tests(discovery_data, base_url, module)
                    test_plan["tests"] = tests
                    test_plan["total_tests"] = len(tests)
                    test_plan["generated_at"] = self._get_timestamp()
                    test_plan["module"] = module
                
            elif test_intent == "exploratory_15m":
                # Generate guided exploration with safe actions only (no deletes)
                logger.info(f"[{run_id}] Building exploratory test plan")
                tests = self._generate_exploratory_tests(discovery_data, base_url)
                test_plan["tests"] = tests
                test_plan["total_tests"] = len(tests)
                test_plan["generated_at"] = self._get_timestamp()
                test_plan["mode"] = "exploratory_safe"
            else:
                raise ValueError(f"Unknown test intent: {test_intent}")
            
            # Save test plan to JSON file
            plan_file = discovery_dir / "test_plan.json"
            with open(plan_file, "w") as f:
                json.dump(test_plan, f, indent=2, default=str)
            
            logger.info(f"[{run_id}] Test plan generated: {test_plan['total_tests']} tests")
            
            return {
                "test_plan": test_plan,
                "next_state": RunState.TEST_EXECUTE,
                "question": None,
                "modules": None
            }
        
        except Exception as e:
            logger.error(f"[{run_id}] Test plan build failed: {e}", exc_info=True)
            raise
    
    def _generate_smoke_tests(self, discovery: Dict, base_url: str) -> List[Dict]:
        """Generate minimal happy-path tests for top modules/pages."""
        tests = []
        test_id = 1
        
        # Test 1: Homepage/Dashboard load
        pages = discovery.get("pages", [])
        if pages:
            home_page = pages[0]
            tests.append({
                "id": f"SMOKE-{test_id:03d}",
                "name": f"Load {home_page.get('title', 'Homepage')}",
                "description": "Verify homepage loads without errors",
                "template": "page_load",
                "priority": "critical",
                "type": "ui",
                "steps": [
                    {"action": "navigate", "target": home_page.get("url", base_url)},
                    {"action": "wait", "timeout": 5000},
                    {"action": "verify", "condition": "no_errors", "selector": "body"}
                ],
                "expected_result": "Page should load without console errors",
                "tags": ["smoke", "page_load"]
            })
            test_id += 1
        
        # Test 2-6: Top 5 pages load
        for page in pages[1:6]:
            tests.append({
                "id": f"SMOKE-{test_id:03d}",
                "name": f"Load {page.get('title', 'Page')[:40]}",
                "description": f"Verify {page.get('nav_text', 'page')} loads",
                "template": "page_load",
                "priority": "high",
                "type": "ui",
                "steps": [
                    {"action": "navigate", "target": page.get("url", base_url)},
                    {"action": "wait", "timeout": 5000},
                    {"action": "verify", "condition": "no_errors"}
                ],
                "expected_result": "Page should load without errors",
                "tags": ["smoke", "page_load"],
                "page_url": page.get("url")
            })
            test_id += 1
        
        # Test: API health checks (top 3 GET endpoints)
        api_endpoints = discovery.get("api_endpoints", [])
        get_apis = [api for api in api_endpoints if api.get("method") == "GET"][:3]
        
        for api in get_apis:
            tests.append({
                "id": f"SMOKE-{test_id:03d}",
                "name": f"API Health: {urlparse(api.get('url', '')).path[:40]}",
                "description": "Verify API endpoint responds",
                "template": "api_health",
                "priority": "medium",
                "type": "api",
                "steps": [
                    {"action": "request", "method": "GET", "url": api.get("url")},
                    {"action": "assert_status", "expected": [200, 201, 204]}
                ],
                "expected_result": "API should return 2xx status",
                "tags": ["smoke", "api"],
                "api_url": api.get("url")
            })
            test_id += 1
        
        return tests
    
    def _generate_crud_sanity_tests(self, discovery: Dict, base_url: str) -> List[Dict]:
        """Generate create/update/delete/validation tests for CRUD actions (SAFE only)."""
        tests = []
        test_id = 1
        
        forms = discovery.get("forms_found", [])
        api_endpoints = discovery.get("api_endpoints", [])
        
        # CREATE tests (safe - only POST forms/APIs)
        for form in forms:
            if form.get("method") in ["POST"]:
                fields = form.get("inputs", [])
                field_names = [f["name"] for f in fields if f.get("name") and f.get("type") != "hidden"]
                
                if field_names:
                    tests.append({
                        "id": f"CRUD-CREATE-{test_id:03d}",
                        "name": f"Create via form: {form.get('action', 'form')[:40]}",
                        "description": "Submit form with valid data to create resource",
                        "template": "create_resource",
                        "priority": "high",
                        "type": "ui",
                        "steps": [
                            {"action": "navigate", "target": form.get("page_url", base_url)},
                            {"action": "fill_form", "fields": [
                                {"name": f["name"], "value": f"<test_{f['type']}_value>", "type": f["type"]}
                                for f in fields if f.get("name") and f.get("type") not in ["hidden", "submit"]
                            ]},
                            {"action": "submit", "selector": "button[type=submit], form"},
                            {"action": "verify", "condition": "success_or_redirect"}
                        ],
                        "expected_result": "Resource should be created successfully",
                        "tags": ["crud", "create", "safe"],
                        "form_action": form.get("action", ""),
                        "page_url": form.get("page_url", base_url)
                    })
                    test_id += 1
        
        # CREATE via API (POST only)
        for api in api_endpoints:
            if api.get("method") == "POST":
                url = api.get("url", "")
                path_parts = urlparse(url).path.split("/")
                resource = next((p for p in reversed(path_parts) if p and not p.isdigit()), "resource")
                
                tests.append({
                    "id": f"CRUD-CREATE-API-{test_id:03d}",
                    "name": f"Create {resource} via API",
                    "description": f"POST request to create resource",
                    "template": "create_resource",
                    "priority": "high",
                    "type": "api",
                    "steps": [
                        {"action": "request", "method": "POST", "url": url},
                        {"action": "set_headers", "headers": {"Content-Type": "application/json"}},
                        {"action": "set_body", "body": {"<field>": "<test_value>"}},
                        {"action": "send"},
                        {"action": "assert_status", "expected": [200, 201]}
                    ],
                    "expected_result": "API should return 200/201",
                    "tags": ["crud", "create", "api", "safe"],
                    "api_url": url
                })
                test_id += 1
        
        # UPDATE tests (PUT/PATCH - safe, no deletes)
        for api in api_endpoints:
            method = api.get("method", "").upper()
            if method in ["PUT", "PATCH"]:
                url = api.get("url", "")
                tests.append({
                    "id": f"CRUD-UPDATE-{test_id:03d}",
                    "name": f"Update via {method} API",
                    "description": f"{method} request to update resource",
                    "template": "update_resource",
                    "priority": "high",
                    "type": "api",
                    "steps": [
                        {"action": "setup", "description": "Ensure resource exists"},
                        {"action": "request", "method": method, "url": url},
                        {"action": "set_body", "body": {"<field>": "<updated_value>"}},
                        {"action": "send"},
                        {"action": "assert_status", "expected": [200, 204]}
                    ],
                    "expected_result": "Resource should be updated",
                    "tags": ["crud", "update", "safe"],
                    "api_url": url
                })
                test_id += 1
        
        # VALIDATION tests (required fields)
        for form in forms:
            if form.get("method") in ["POST", "PUT"]:
                fields = form.get("inputs", [])
                required_fields = [f for f in fields if f.get("type") not in ["hidden", "submit", "button"]]
                
                if required_fields:
                    tests.append({
                        "id": f"CRUD-VALIDATION-{test_id:03d}",
                        "name": f"Validation: {form.get('action', 'form')[:40]}",
                        "description": "Submit empty form to verify validation",
                        "template": "validation",
                        "priority": "medium",
                        "type": "ui",
                        "steps": [
                            {"action": "navigate", "target": form.get("page_url", base_url)},
                            {"action": "submit", "selector": "button[type=submit], form"},
                            {"action": "verify", "condition": "validation_errors_visible"}
                        ],
                        "expected_result": "Validation errors should be displayed",
                        "tags": ["crud", "validation", "safe"],
                        "form_action": form.get("action", ""),
                        "page_url": form.get("page_url", base_url)
                    })
                    test_id += 1
        
        return tests
    
    def _infer_modules(self, discovery: Dict) -> List[str]:
        """Infer modules from discovered pages/URLs."""
        modules: Set[str] = set()
        
        pages = discovery.get("pages", [])
        api_endpoints = discovery.get("api_endpoints", [])
        
        # Extract from URLs
        for page in pages:
            url = page.get("url", "")
            path_parts = urlparse(url).path.strip("/").split("/")
            if len(path_parts) > 0:
                # First path segment often indicates module
                module = path_parts[0].title()
                if module and len(module) > 2:
                    modules.add(module)
        
        for api in api_endpoints:
            url = api.get("url", "")
            path_parts = urlparse(url).path.strip("/").split("/")
            if len(path_parts) > 0:
                module = path_parts[0].title()
                if module and len(module) > 2:
                    modules.add(module)
        
        # Extract from page titles/nav text
        for page in pages:
            title = page.get("title", "")
            nav_text = page.get("nav_text", "")
            
            # Common module keywords
            module_keywords = ["dashboard", "users", "settings", "admin", "reports", 
                             "analytics", "billing", "inventory", "orders", "products"]
            
            text_lower = (title + " " + nav_text).lower()
            for keyword in module_keywords:
                if keyword in text_lower:
                    modules.add(keyword.title())
        
        # If no modules found, use defaults
        if not modules:
            modules = {"Dashboard", "Settings", "Users"}
        
        return sorted(list(modules))[:10]  # Limit to 10 modules
    
    def _generate_module_tests(self, discovery: Dict, base_url: str, module: str) -> List[Dict]:
        """Generate tests for a specific module."""
        tests = []
        test_id = 1
        
        module_lower = module.lower()
        pages = discovery.get("pages", [])
        forms = discovery.get("forms_found", [])
        
        # Find pages/forms related to this module
        module_pages = [
            p for p in pages
            if module_lower in p.get("url", "").lower() or 
               module_lower in p.get("title", "").lower() or
               module_lower in p.get("nav_text", "").lower()
        ]
        
        module_forms = [
            f for f in forms
            if module_lower in f.get("page_url", "").lower() or
               module_lower in f.get("action", "").lower()
        ]
        
        # Generate page load tests
        for page in module_pages[:5]:
            tests.append({
                "id": f"MODULE-{test_id:03d}",
                "name": f"{module}: Load {page.get('title', 'Page')[:30]}",
                "description": f"Verify {module} page loads",
                "template": "page_load",
                "priority": "high",
                "type": "ui",
                "steps": [
                    {"action": "navigate", "target": page.get("url", base_url)},
                    {"action": "wait", "timeout": 5000},
                    {"action": "verify", "condition": "no_errors"}
                ],
                "expected_result": "Page should load without errors",
                "tags": ["module", module_lower, "page_load"]
            })
            test_id += 1
        
        # Generate form tests
        for form in module_forms[:3]:
            if form.get("method") in ["POST", "PUT"]:
                tests.append({
                    "id": f"MODULE-{test_id:03d}",
                    "name": f"{module}: Form action on {form.get('action', 'form')[:30]}",
                    "description": f"Test form submission in {module}",
                    "template": "form_submit",
                    "priority": "medium",
                    "type": "ui",
                    "steps": [
                        {"action": "navigate", "target": form.get("page_url", base_url)},
                        {"action": "fill_form", "fields": [
                            {"name": f["name"], "value": "<test_value>", "type": f["type"]}
                            for f in form.get("inputs", []) if f.get("name") and f.get("type") != "hidden"
                        ]},
                        {"action": "submit", "selector": "button[type=submit]"},
                        {"action": "verify", "condition": "success_or_redirect"}
                    ],
                    "expected_result": "Form should submit successfully",
                    "tags": ["module", module_lower, "form"],
                    "form_action": form.get("action", "")
                })
                test_id += 1
        
        return tests
    
    def _generate_exploratory_tests(self, discovery: Dict, base_url: str) -> List[Dict]:
        """Generate guided exploration with safe actions only (no deletes)."""
        tests = []
        test_id = 1
        
        pages = discovery.get("pages", [])
        forms = discovery.get("forms_found", [])
        api_endpoints = discovery.get("api_endpoints", [])
        
        # Explore pages (safe navigation)
        for page in pages[:10]:
            tests.append({
                "id": f"EXPLORE-{test_id:03d}",
                "name": f"Explore: {page.get('title', 'Page')[:40]}",
                "description": f"Navigate and explore {page.get('nav_text', 'page')}",
                "template": "explore_page",
                "priority": "medium",
                "type": "ui",
                "steps": [
                    {"action": "navigate", "target": page.get("url", base_url)},
                    {"action": "wait", "timeout": 3000},
                    {"action": "explore", "actions": [
                        "click_links",
                        "fill_forms_safe",
                        "verify_no_errors"
                    ]},
                    {"action": "screenshot", "name": f"explore_{test_id:03d}.png"}
                ],
                "expected_result": "Page should be explorable without errors",
                "tags": ["exploratory", "safe"],
                "page_url": page.get("url")
            })
            test_id += 1
        
        # Safe form submissions (POST only, no DELETE)
        for form in forms:
            if form.get("method") in ["POST", "PUT", "PATCH"]:
                tests.append({
                    "id": f"EXPLORE-FORM-{test_id:03d}",
                    "name": f"Explore form: {form.get('action', 'form')[:40]}",
                    "description": "Safely explore form submission",
                    "template": "explore_form",
                    "priority": "low",
                    "type": "ui",
                    "steps": [
                        {"action": "navigate", "target": form.get("page_url", base_url)},
                        {"action": "fill_form_safe", "fields": [
                            {"name": f["name"], "value": "<safe_test_value>", "type": f["type"]}
                            for f in form.get("inputs", []) if f.get("name") and f.get("type") not in ["hidden", "submit"]
                        ]},
                        {"action": "verify", "condition": "form_ready"},
                        {"action": "screenshot", "name": f"explore_form_{test_id:03d}.png"}
                    ],
                    "expected_result": "Form should be fillable (not submitted)",
                    "tags": ["exploratory", "safe", "form"],
                    "form_action": form.get("action", ""),
                    "page_url": form.get("page_url", base_url)
                })
                test_id += 1
        
        # Safe API exploration (GET, POST only)
        safe_apis = [api for api in api_endpoints if api.get("method") in ["GET", "POST"]][:5]
        for api in safe_apis:
            tests.append({
                "id": f"EXPLORE-API-{test_id:03d}",
                "name": f"Explore API: {urlparse(api.get('url', '')).path[:40]}",
                "description": "Safely explore API endpoint",
                "template": "explore_api",
                "priority": "low",
                "type": "api",
                "steps": [
                    {"action": "request", "method": api.get("method"), "url": api.get("url")},
                    {"action": "send"},
                    {"action": "verify", "condition": "response_received"}
                ],
                "expected_result": "API should respond (status may vary)",
                "tags": ["exploratory", "safe", "api"],
                "api_url": api.get("url")
            })
            test_id += 1
        
        return tests
    
    def _get_timestamp(self) -> str:
        """Get current timestamp in ISO format."""
        from datetime import datetime
        return datetime.utcnow().isoformat() + "Z"


# Global test plan builder instance
_test_plan_builder = TestPlanBuilder()


def get_test_plan_builder() -> TestPlanBuilder:
    """Get global test plan builder instance."""
    return _test_plan_builder

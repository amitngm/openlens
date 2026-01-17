"""
Testcase Generator - Reads discovery.json and produces smoke tests.

Templates:
- Create resource
- Delete resource
- Required field validation
- Permission check

Output: /data/{discovery_id}/smoke_tests.json
"""

import os
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse, urljoin

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# Data directory
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))


class GenerateTestsRequest(BaseModel):
    discovery_id: str
    include_templates: Optional[List[str]] = None  # None = all templates


class TestCase(BaseModel):
    id: str
    name: str
    description: str
    template: str
    priority: str  # critical, high, medium, low
    type: str  # api, ui, e2e
    steps: List[Dict[str, Any]]
    expected_result: str
    tags: List[str] = []


class GenerateTestsResponse(BaseModel):
    discovery_id: str
    total_tests: int
    tests_by_template: Dict[str, int]
    tests_by_priority: Dict[str, int]
    output_file: str
    preview: List[Dict[str, Any]]


# =============================================================================
# Test Templates
# =============================================================================

def generate_create_resource_tests(discovery: Dict, base_url: str) -> List[Dict]:
    """Generate CREATE resource tests from discovered forms and APIs."""
    tests = []
    test_id = 1
    
    # From Forms
    for form in discovery.get("forms_found", []):
        if form.get("method") == "POST":
            fields = form.get("inputs", [])
            field_names = [f["name"] for f in fields if f.get("name")]
            
            # Basic create test
            tests.append({
                "id": f"CREATE-FORM-{test_id:03d}",
                "name": f"Create resource via form on {form.get('page_url', 'unknown')[:50]}",
                "description": f"Submit form with valid data to create a new resource",
                "template": "create_resource",
                "priority": "high",
                "type": "ui",
                "steps": [
                    {"action": "navigate", "target": form.get("page_url", base_url)},
                    {"action": "fill_form", "fields": [
                        {"name": f["name"], "value": f"<test_{f['type']}_value>", "type": f["type"]}
                        for f in fields if f.get("name") and f["type"] not in ["hidden"]
                    ]},
                    {"action": "submit", "selector": "button[type=submit]"},
                    {"action": "verify", "condition": "success_message_or_redirect"}
                ],
                "expected_result": "Resource should be created successfully",
                "tags": ["create", "form", "smoke"],
                "form_action": form.get("action", ""),
                "source": "form_discovery"
            })
            test_id += 1
    
    # From API endpoints (POST methods)
    for api in discovery.get("api_endpoints", []):
        if api.get("method") == "POST":
            url = api.get("url", "")
            # Extract resource name from URL
            path_parts = urlparse(url).path.split("/")
            resource = next((p for p in reversed(path_parts) if p and not p.isdigit()), "resource")
            
            tests.append({
                "id": f"CREATE-API-{test_id:03d}",
                "name": f"Create {resource} via API",
                "description": f"POST request to {url} with valid payload",
                "template": "create_resource",
                "priority": "high",
                "type": "api",
                "steps": [
                    {"action": "request", "method": "POST", "url": url},
                    {"action": "set_headers", "headers": {"Content-Type": "application/json"}},
                    {"action": "set_body", "body": {"<field>": "<value>"}},
                    {"action": "send"},
                    {"action": "assert_status", "expected": [200, 201]}
                ],
                "expected_result": "API should return 200/201 with created resource",
                "tags": ["create", "api", "smoke"],
                "api_url": url,
                "source": "api_discovery"
            })
            test_id += 1
    
    return tests


def generate_delete_resource_tests(discovery: Dict, base_url: str) -> List[Dict]:
    """Generate DELETE resource tests from discovered APIs."""
    tests = []
    test_id = 1
    
    # From API endpoints (DELETE methods or URLs with IDs)
    for api in discovery.get("api_endpoints", []):
        method = api.get("method", "GET")
        url = api.get("url", "")
        
        if method == "DELETE":
            path_parts = urlparse(url).path.split("/")
            resource = next((p for p in reversed(path_parts) if p and not p.isdigit()), "resource")
            
            tests.append({
                "id": f"DELETE-API-{test_id:03d}",
                "name": f"Delete {resource} via API",
                "description": f"DELETE request to remove existing resource",
                "template": "delete_resource",
                "priority": "high",
                "type": "api",
                "steps": [
                    {"action": "setup", "description": "Create a resource first"},
                    {"action": "request", "method": "DELETE", "url": url},
                    {"action": "send"},
                    {"action": "assert_status", "expected": [200, 204]},
                    {"action": "verify_deleted", "method": "GET", "url": url, "expected_status": 404}
                ],
                "expected_result": "Resource should be deleted, GET should return 404",
                "tags": ["delete", "api", "smoke"],
                "api_url": url,
                "source": "api_discovery"
            })
            test_id += 1
    
    # Infer delete tests from pages with delete buttons
    for page in discovery.get("pages", []):
        buttons = page.get("buttons", [])
        delete_buttons = [b for b in buttons if any(
            word in b.get("text", "").lower() 
            for word in ["delete", "remove", "trash", "destroy"]
        )]
        
        for btn in delete_buttons:
            tests.append({
                "id": f"DELETE-UI-{test_id:03d}",
                "name": f"Delete resource from {page.get('title', 'page')[:30]}",
                "description": f"Click '{btn.get('text', 'Delete')}' button and confirm deletion",
                "template": "delete_resource",
                "priority": "medium",
                "type": "ui",
                "steps": [
                    {"action": "navigate", "target": page.get("url", base_url)},
                    {"action": "select_item", "description": "Select an existing item"},
                    {"action": "click", "selector": f"button:has-text('{btn.get('text', 'Delete')}')"},
                    {"action": "confirm_dialog", "if_present": True},
                    {"action": "verify", "condition": "item_removed_from_list"}
                ],
                "expected_result": "Item should be removed from the list",
                "tags": ["delete", "ui", "smoke"],
                "page_url": page.get("url"),
                "source": "ui_discovery"
            })
            test_id += 1
    
    return tests


def generate_validation_tests(discovery: Dict, base_url: str) -> List[Dict]:
    """Generate required field validation tests from discovered forms."""
    tests = []
    test_id = 1
    
    for form in discovery.get("forms_found", []):
        fields = form.get("inputs", [])
        required_fields = [f for f in fields if f.get("type") not in ["hidden", "submit", "button"]]
        
        if not required_fields:
            continue
        
        # Test: Submit empty form
        tests.append({
            "id": f"VALIDATE-EMPTY-{test_id:03d}",
            "name": f"Validate empty form submission",
            "description": f"Submit form without filling any fields",
            "template": "required_field_validation",
            "priority": "high",
            "type": "ui",
            "steps": [
                {"action": "navigate", "target": form.get("page_url", base_url)},
                {"action": "submit", "selector": "button[type=submit]"},
                {"action": "verify", "condition": "validation_error_displayed"}
            ],
            "expected_result": "Form should show validation errors for required fields",
            "tags": ["validation", "negative", "smoke"],
            "page_url": form.get("page_url"),
            "source": "form_discovery"
        })
        test_id += 1
        
        # Test each required field individually
        for field in required_fields[:5]:  # Limit to 5 fields
            field_name = field.get("name") or field.get("placeholder") or "field"
            
            tests.append({
                "id": f"VALIDATE-FIELD-{test_id:03d}",
                "name": f"Validate required field: {field_name[:30]}",
                "description": f"Submit form with '{field_name}' empty",
                "template": "required_field_validation",
                "priority": "medium",
                "type": "ui",
                "steps": [
                    {"action": "navigate", "target": form.get("page_url", base_url)},
                    {"action": "fill_form", "fields": [
                        {"name": f["name"], "value": f"test_{f['type']}", "type": f["type"]}
                        for f in required_fields if f["name"] != field.get("name")
                    ]},
                    {"action": "clear_field", "name": field.get("name")},
                    {"action": "submit", "selector": "button[type=submit]"},
                    {"action": "verify", "condition": f"validation_error_for_{field_name}"}
                ],
                "expected_result": f"Validation error should appear for '{field_name}'",
                "tags": ["validation", "negative", "smoke"],
                "field_name": field_name,
                "source": "form_discovery"
            })
            test_id += 1
        
        # Test invalid email format (if email field exists)
        email_fields = [f for f in fields if f.get("type") == "email" or "email" in f.get("name", "").lower()]
        for email_field in email_fields[:1]:
            tests.append({
                "id": f"VALIDATE-EMAIL-{test_id:03d}",
                "name": f"Validate email format: {email_field.get('name', 'email')[:20]}",
                "description": f"Enter invalid email format",
                "template": "required_field_validation",
                "priority": "medium",
                "type": "ui",
                "steps": [
                    {"action": "navigate", "target": form.get("page_url", base_url)},
                    {"action": "fill_field", "name": email_field.get("name"), "value": "invalid-email"},
                    {"action": "submit", "selector": "button[type=submit]"},
                    {"action": "verify", "condition": "email_format_error"}
                ],
                "expected_result": "Validation error for invalid email format",
                "tags": ["validation", "email", "negative", "smoke"],
                "source": "form_discovery"
            })
            test_id += 1
    
    return tests


def generate_permission_tests(discovery: Dict, base_url: str) -> List[Dict]:
    """Generate permission check tests."""
    tests = []
    test_id = 1
    
    # Test: Access pages without authentication
    for page in discovery.get("pages", []):
        page_url = page.get("url", "")
        if not page_url:
            continue
            
        tests.append({
            "id": f"PERM-UNAUTH-{test_id:03d}",
            "name": f"Access {page.get('title', 'page')[:30]} without auth",
            "description": f"Try to access protected page without logging in",
            "template": "permission_check",
            "priority": "critical",
            "type": "e2e",
            "steps": [
                {"action": "clear_session", "description": "Clear all cookies and storage"},
                {"action": "navigate", "target": page_url},
                {"action": "verify", "condition": "redirected_to_login_or_403"}
            ],
            "expected_result": "Should redirect to login or show 403 Forbidden",
            "tags": ["security", "permission", "smoke"],
            "page_url": page_url,
            "source": "page_discovery"
        })
        test_id += 1
    
    # Test: API endpoints without authentication
    for api in discovery.get("api_endpoints", []):
        url = api.get("url", "")
        method = api.get("method", "GET")
        
        tests.append({
            "id": f"PERM-API-{test_id:03d}",
            "name": f"API {method} {urlparse(url).path[:30]} without auth",
            "description": f"Call API endpoint without authentication token",
            "template": "permission_check",
            "priority": "critical",
            "type": "api",
            "steps": [
                {"action": "request", "method": method, "url": url},
                {"action": "remove_auth_headers"},
                {"action": "send"},
                {"action": "assert_status", "expected": [401, 403]}
            ],
            "expected_result": "Should return 401 Unauthorized or 403 Forbidden",
            "tags": ["security", "permission", "api", "smoke"],
            "api_url": url,
            "source": "api_discovery"
        })
        test_id += 1
    
    # Test: Access with expired/invalid token
    tests.append({
        "id": f"PERM-INVALID-{test_id:03d}",
        "name": "Access with invalid authentication token",
        "description": "Try to access protected resource with invalid/expired token",
        "template": "permission_check",
        "priority": "critical",
        "type": "api",
        "steps": [
            {"action": "set_headers", "headers": {"Authorization": "Bearer invalid_token_12345"}},
            {"action": "request", "method": "GET", "url": f"{base_url}/api/protected"},
            {"action": "send"},
            {"action": "assert_status", "expected": [401, 403]}
        ],
        "expected_result": "Should return 401 Unauthorized",
        "tags": ["security", "permission", "token", "smoke"],
        "source": "template"
    })
    
    return tests


# =============================================================================
# Main Generator
# =============================================================================

TEMPLATE_GENERATORS = {
    "create_resource": generate_create_resource_tests,
    "delete_resource": generate_delete_resource_tests,
    "required_field_validation": generate_validation_tests,
    "permission_check": generate_permission_tests,
}


@router.post("/generate-tests", response_model=GenerateTestsResponse)
async def generate_tests(request: GenerateTestsRequest):
    """
    Generate smoke tests from discovery results.
    
    Reads /data/{discovery_id}/discovery.json and produces:
    - smoke_tests.json with testcases derived from templates:
      - create_resource
      - delete_resource
      - required_field_validation
      - permission_check
    
    Output: /data/{discovery_id}/smoke_tests.json
    """
    discovery_id = request.discovery_id
    
    # Load discovery.json
    discovery_file = DATA_DIR / discovery_id / "discovery.json"
    if not discovery_file.exists():
        raise HTTPException(
            status_code=404, 
            detail=f"Discovery {discovery_id} not found. Run /discover first."
        )
    
    with open(discovery_file) as f:
        discovery = json.load(f)
    
    if discovery.get("status") != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Discovery {discovery_id} is not completed. Status: {discovery.get('status')}"
        )
    
    base_url = discovery.get("ui_url", "")
    
    # Determine which templates to use
    templates_to_use = request.include_templates or list(TEMPLATE_GENERATORS.keys())
    
    # Generate tests
    all_tests = []
    tests_by_template = {}
    
    for template_name in templates_to_use:
        if template_name not in TEMPLATE_GENERATORS:
            logger.warning(f"Unknown template: {template_name}")
            continue
        
        generator = TEMPLATE_GENERATORS[template_name]
        tests = generator(discovery, base_url)
        all_tests.extend(tests)
        tests_by_template[template_name] = len(tests)
        
        logger.info(f"Generated {len(tests)} tests from template: {template_name}")
    
    # Calculate priority distribution
    tests_by_priority = {
        "critical": sum(1 for t in all_tests if t.get("priority") == "critical"),
        "high": sum(1 for t in all_tests if t.get("priority") == "high"),
        "medium": sum(1 for t in all_tests if t.get("priority") == "medium"),
        "low": sum(1 for t in all_tests if t.get("priority") == "low"),
    }
    
    # Create output structure
    smoke_tests = {
        "discovery_id": discovery_id,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "source_url": base_url,
        "total_tests": len(all_tests),
        "tests_by_template": tests_by_template,
        "tests_by_priority": tests_by_priority,
        "tests": all_tests
    }
    
    # Save to file
    output_file = DATA_DIR / discovery_id / "smoke_tests.json"
    with open(output_file, "w") as f:
        json.dump(smoke_tests, f, indent=2)
    
    logger.info(f"Generated {len(all_tests)} smoke tests for discovery {discovery_id}")
    
    return GenerateTestsResponse(
        discovery_id=discovery_id,
        total_tests=len(all_tests),
        tests_by_template=tests_by_template,
        tests_by_priority=tests_by_priority,
        output_file=str(output_file),
        preview=all_tests[:10]  # First 10 tests as preview
    )


@router.get("/tests/{discovery_id}")
async def get_tests(discovery_id: str):
    """
    Get generated smoke tests for a discovery.
    """
    tests_file = DATA_DIR / discovery_id / "smoke_tests.json"
    if not tests_file.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Smoke tests not found for {discovery_id}. Run /generate-tests first."
        )
    
    with open(tests_file) as f:
        return json.load(f)


@router.get("/tests/{discovery_id}/by-template/{template}")
async def get_tests_by_template(discovery_id: str, template: str):
    """
    Get tests filtered by template type.
    """
    tests_file = DATA_DIR / discovery_id / "smoke_tests.json"
    if not tests_file.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Smoke tests not found for {discovery_id}."
        )
    
    with open(tests_file) as f:
        data = json.load(f)
    
    filtered_tests = [t for t in data.get("tests", []) if t.get("template") == template]
    
    return {
        "discovery_id": discovery_id,
        "template": template,
        "count": len(filtered_tests),
        "tests": filtered_tests
    }


@router.get("/tests/{discovery_id}/by-priority/{priority}")
async def get_tests_by_priority(discovery_id: str, priority: str):
    """
    Get tests filtered by priority (critical, high, medium, low).
    """
    tests_file = DATA_DIR / discovery_id / "smoke_tests.json"
    if not tests_file.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Smoke tests not found for {discovery_id}."
        )
    
    with open(tests_file) as f:
        data = json.load(f)
    
    filtered_tests = [t for t in data.get("tests", []) if t.get("priority") == priority]
    
    return {
        "discovery_id": discovery_id,
        "priority": priority,
        "count": len(filtered_tests),
        "tests": filtered_tests
    }


@router.get("/templates")
async def list_templates():
    """
    List available test templates.
    """
    return {
        "templates": [
            {
                "name": "create_resource",
                "description": "Tests for creating new resources via forms and APIs",
                "generates": ["form submission", "POST API calls"]
            },
            {
                "name": "delete_resource",
                "description": "Tests for deleting resources",
                "generates": ["DELETE API calls", "UI delete buttons"]
            },
            {
                "name": "required_field_validation",
                "description": "Tests for form field validation",
                "generates": ["empty form", "missing required fields", "invalid formats"]
            },
            {
                "name": "permission_check",
                "description": "Tests for authentication and authorization",
                "generates": ["unauthenticated access", "invalid token", "API auth"]
            }
        ]
    }

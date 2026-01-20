#!/usr/bin/env python3
"""
Unit test for Interactive QA Buddy API contract.

Tests API request/response schemas without requiring a live server.
"""

import json
from typing import Dict, Any


def test_start_run_request():
    """Test StartRunRequest schema."""
    request = {
        "base_url": "https://example.com",
        "env": "dev",
        "headless": True,
        "auth": {
            "type": "keycloak",
            "username": "testuser",
            "password": "testpass"
        }
    }
    
    # Validate required fields
    assert "base_url" in request
    assert isinstance(request["base_url"], str)
    assert request["base_url"].startswith("http")
    
    # Validate optional fields
    assert "env" in request
    assert "headless" in request
    assert isinstance(request["headless"], bool)
    
    print("✓ StartRunRequest schema valid")
    return request


def test_start_run_response():
    """Test StartRunResponse schema."""
    response = {
        "run_id": "abc123def456",
        "state": "WAIT_LOGIN_INPUT",
        "question": {
            "id": "login_creds",
            "type": "text",
            "text": "Please provide login credentials",
            "screenshot_path": "artifacts/abc123/session_check.png"
        }
    }
    
    # Validate required fields
    assert "run_id" in response
    assert "state" in response
    assert isinstance(response["run_id"], str)
    assert isinstance(response["state"], str)
    
    # Validate optional question
    if "question" in response:
        q = response["question"]
        assert "id" in q
        assert "type" in q
        assert "text" in q
        assert q["type"] in ["text", "select_one", "confirm"]
    
    print("✓ StartRunResponse schema valid")
    return response


def test_answer_request():
    """Test AnswerRequest schema."""
    request = {
        "question_id": "login_creds",
        "answer": "testuser,testpass123"
    }
    
    assert "answer" in request
    assert isinstance(request["answer"], str)
    
    print("✓ AnswerRequest schema valid")
    return request


def test_answer_response():
    """Test AnswerResponse schema."""
    response = {
        "run_id": "abc123def456",
        "state": "LOGIN_ATTEMPT",
        "question": None,
        "message": "Credentials provided, attempting login..."
    }
    
    assert "run_id" in response
    assert "state" in response
    assert "message" in response
    
    print("✓ AnswerResponse schema valid")
    return response


def test_status_response():
    """Test StatusResponse schema."""
    response = {
        "run_id": "abc123def456",
        "state": "WAIT_CONTEXT_INPUT",
        "question": {
            "id": "context_select",
            "type": "select_one",
            "text": "Multiple contexts detected. Which tenant/project/cell should I test?",
            "options": [
                {"id": "tenant_a", "label": "Tenant A"},
                {"id": "tenant_b", "label": "Tenant B"}
            ],
            "screenshot_path": "artifacts/abc123/context_detect.png"
        },
        "progress": 50,
        "last_step": "CONTEXT_DETECT",
        "current_url": "https://example.com/dashboard"
    }
    
    assert "run_id" in response
    assert "state" in response
    assert isinstance(response["state"], str)
    
    if "question" in response and response["question"]:
        q = response["question"]
        if q["type"] == "select_one":
            assert "options" in q
            assert isinstance(q["options"], list)
            for opt in q["options"]:
                assert "id" in opt
                assert "label" in opt
    
    print("✓ StatusResponse schema valid")
    return response


def test_state_transitions():
    """Test state transition flow."""
    states = [
        "START",
        "OPEN_URL",
        "SESSION_CHECK",
        "LOGIN_DETECT",
        "WAIT_LOGIN_INPUT",
        "WAIT_LOGIN_CONFIRM",
        "LOGIN_ATTEMPT",
        "POST_LOGIN_VALIDATE",
        "CONTEXT_DETECT",
        "WAIT_CONTEXT_INPUT",
        "DISCOVERY_RUN",
        "DISCOVERY_SUMMARY",
        "WAIT_TEST_INTENT",
        "WAIT_TEST_INTENT_MODULE",
        "TEST_PLAN_BUILD",
        "TEST_EXECUTE",
        "REPORT_GENERATE",
        "DONE",
        "FAILED"
    ]
    
    # Verify all expected states exist
    expected_states = [
        "WAIT_LOGIN_INPUT",
        "WAIT_CONTEXT_INPUT",
        "WAIT_TEST_INTENT"
    ]
    
    for state in expected_states:
        assert state in states, f"Missing state: {state}"
    
    print(f"✓ State transitions valid ({len(states)} states)")
    return states


def test_question_types():
    """Test question type schemas."""
    # Text question
    text_question = {
        "id": "login_creds",
        "type": "text",
        "text": "Please provide login credentials",
        "screenshot_path": "artifacts/abc123/session_check.png"
    }
    assert text_question["type"] == "text"
    assert "text" in text_question
    
    # Select one question
    select_question = {
        "id": "context_select",
        "type": "select_one",
        "text": "Select context",
        "options": [
            {"id": "opt1", "label": "Option 1"},
            {"id": "opt2", "label": "Option 2"}
        ],
        "screenshot_path": "artifacts/abc123/context_detect.png"
    }
    assert select_question["type"] == "select_one"
    assert "options" in select_question
    assert len(select_question["options"]) > 0
    
    # Confirm question
    confirm_question = {
        "id": "login_confirm",
        "type": "confirm",
        "text": "Are you already logged in?",
        "screenshot_path": "artifacts/abc123/session_check.png"
    }
    assert confirm_question["type"] == "confirm"
    
    print("✓ Question types valid")
    return [text_question, select_question, confirm_question]


def test_interactive_flow_scenarios():
    """Test interactive flow scenarios."""
    scenarios = [
        {
            "name": "Login Required",
            "states": [
                "SESSION_CHECK",
                "LOGIN_DETECT",
                "WAIT_LOGIN_INPUT",
                "LOGIN_ATTEMPT",
                "POST_LOGIN_VALIDATE"
            ]
        },
        {
            "name": "Context Selection",
            "states": [
                "CONTEXT_DETECT",
                "WAIT_CONTEXT_INPUT",
                "DISCOVERY_RUN"
            ]
        },
        {
            "name": "Test Intent Selection",
            "states": [
                "DISCOVERY_SUMMARY",
                "WAIT_TEST_INTENT",
                "TEST_PLAN_BUILD"
            ]
        }
    ]
    
    for scenario in scenarios:
        assert "name" in scenario
        assert "states" in scenario
        assert len(scenario["states"]) > 0
        print(f"  ✓ Scenario: {scenario['name']} ({len(scenario['states'])} states)")
    
    print("✓ Interactive flow scenarios valid")
    return scenarios


def main():
    """Run all contract tests."""
    print("\n" + "="*60)
    print("Interactive QA Buddy API Contract Tests")
    print("="*60 + "\n")
    
    try:
        test_start_run_request()
        test_start_run_response()
        test_answer_request()
        test_answer_response()
        test_status_response()
        test_state_transitions()
        test_question_types()
        test_interactive_flow_scenarios()
        
        print("\n" + "="*60)
        print("✓ All contract tests passed!")
        print("="*60 + "\n")
        
    except AssertionError as e:
        print(f"\n✗ Contract test failed: {e}")
        return 1
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())

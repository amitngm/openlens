#!/usr/bin/env python3
"""
Developer test script for Interactive QA Buddy flow.

Demonstrates:
- Starting a run
- Handling WAIT_LOGIN_INPUT
- Handling WAIT_CONTEXT_INPUT
- Handling WAIT_TEST_INTENT
- State transitions

Usage:
    python test_interactive_flow.py [--url <url>] [--mock]
"""

import asyncio
import json
import sys
import argparse
from typing import Optional, Dict, Any
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False


class InteractiveQATester:
    """Test client for Interactive QA Buddy API."""
    
    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url
        self.client = httpx.AsyncClient(timeout=60.0) if HTTPX_AVAILABLE else None
        self.run_id: Optional[str] = None
    
    async def close(self):
        """Close HTTP client."""
        if self.client:
            await self.client.aclose()
    
    async def start_run(self, url: str, env: str = "dev", headless: bool = True) -> Dict[str, Any]:
        """Start a new run."""
        if not self.client:
            raise RuntimeError("httpx not available. Install with: pip install httpx")
        
        print(f"\n{'='*60}")
        print(f"Starting run for URL: {url}")
        print(f"{'='*60}\n")
        
        response = await self.client.post(
            f"{self.base_url}/api/runs/start",
            json={
                "base_url": url,
                "env": env,
                "headless": headless
            }
        )
        
        if response.status_code != 200:
            print(f"Error starting run: {response.status_code}")
            print(response.text)
            return {}
        
        data = response.json()
        self.run_id = data.get("run_id")
        print(f"✓ Run started: {self.run_id}")
        print(f"  State: {data.get('state')}")
        
        if data.get("question"):
            print(f"  Question: {data['question']['text']}")
            print(f"  Question type: {data['question']['type']}")
        
        return data
    
    async def get_status(self) -> Dict[str, Any]:
        """Get current run status."""
        if not self.client:
            raise RuntimeError("httpx not available. Install with: pip install httpx")
        
        if not self.run_id:
            return {}
        
        response = await self.client.get(
            f"{self.base_url}/api/runs/{self.run_id}/status"
        )
        
        if response.status_code != 200:
            print(f"Error getting status: {response.status_code}")
            return {}
        
        return response.json()
    
    async def answer_question(self, answer: str, question_id: Optional[str] = None) -> Dict[str, Any]:
        """Answer a question."""
        if not self.client:
            raise RuntimeError("httpx not available. Install with: pip install httpx")
        
        if not self.run_id:
            print("Error: No run ID")
            return {}
        
        print(f"\n{'='*60}")
        print(f"Answering question: {answer}")
        print(f"{'='*60}\n")
        
        response = await self.client.post(
            f"{self.base_url}/api/runs/{self.run_id}/answer",
            json={
                "question_id": question_id,
                "answer": answer
            }
        )
        
        if response.status_code != 200:
            print(f"Error answering question: {response.status_code}")
            print(response.text)
            return {}
        
        data = response.json()
        print(f"✓ Answer submitted")
        print(f"  New state: {data.get('state')}")
        print(f"  Message: {data.get('message', '')}")
        
        if data.get("question"):
            q = data["question"]
            print(f"  New question: {q.get('text')}")
            print(f"  Question type: {q.get('type')}")
            if q.get("options"):
                print(f"  Options: {[opt.get('label') for opt in q.get('options', [])]}")
        
        return data
    
    async def print_status(self):
        """Print current status."""
        status = await self.get_status()
        if not status:
            return
        
        print(f"\n{'='*60}")
        print(f"Current Status")
        print(f"{'='*60}")
        print(f"Run ID: {status.get('run_id')}")
        print(f"State: {status.get('state')}")
        print(f"Progress: {status.get('progress', 0)}%")
        
        if status.get("question"):
            q = status["question"]
            print(f"\nPending Question:")
            print(f"  ID: {q.get('id')}")
            print(f"  Type: {q.get('type')}")
            print(f"  Text: {q.get('text')}")
            if q.get("options"):
                print(f"  Options:")
                for opt in q.get("options", []):
                    print(f"    - {opt.get('id')}: {opt.get('label')}")
        
        if status.get("current_url"):
            print(f"\nCurrent URL: {status.get('current_url')}")
        
        print(f"{'='*60}\n")
    
    async def test_flow(self, url: str, mock: bool = False):
        """Test the interactive flow."""
        if not self.client:
            print("Error: httpx not available. Use --mock for demonstration without API calls.")
            return
        
        try:
            # Step 1: Start run
            start_data = await self.start_run(url)
            if not start_data:
                print("Failed to start run")
                return
            
            await asyncio.sleep(1)  # Give it a moment
            
            # Step 2: Check status and handle questions
            max_iterations = 20
            iteration = 0
            
            while iteration < max_iterations:
                await self.print_status()
                status = await self.get_status()
                
                if not status:
                    break
                
                state = status.get("state")
                question = status.get("question")
                
                # Check if we're done
                if state in ["DONE", "FAILED"]:
                    print(f"\n✓ Flow completed. Final state: {state}")
                    break
                
                # Handle questions
                if question:
                    q_type = question.get("type")
                    q_id = question.get("id")
                    q_text = question.get("text", "")
                    
                    answer = None
                    
                    if q_type == "text" and "login" in q_text.lower():
                        # WAIT_LOGIN_INPUT
                        print("→ Detected WAIT_LOGIN_INPUT")
                        answer = "testuser,testpass123"
                        print(f"  Providing credentials: {answer}")
                    
                    elif q_type == "select_one" and "context" in q_text.lower():
                        # WAIT_CONTEXT_INPUT
                        print("→ Detected WAIT_CONTEXT_INPUT")
                        options = question.get("options", [])
                        if options:
                            answer = options[0].get("id")  # Select first option
                            print(f"  Selecting context: {answer}")
                    
                    elif q_type == "select_one" and "test" in q_text.lower():
                        # WAIT_TEST_INTENT
                        print("→ Detected WAIT_TEST_INTENT")
                        options = question.get("options", [])
                        if options:
                            # Select "smoke" if available, otherwise first option
                            smoke_opt = next((opt for opt in options if opt.get("id") == "smoke"), None)
                            answer = smoke_opt.get("id") if smoke_opt else options[0].get("id")
                            print(f"  Selecting test intent: {answer}")
                    
                    elif q_type == "confirm":
                        # WAIT_LOGIN_CONFIRM or other confirmations
                        print(f"→ Detected confirmation question: {q_text}")
                        answer = "yes"
                        print(f"  Answering: {answer}")
                    
                    if answer:
                        await self.answer_question(answer, q_id)
                        await asyncio.sleep(2)  # Wait for processing
                    else:
                        print(f"  No handler for question type: {q_type}")
                        print(f"  Question: {q_text}")
                        break
                else:
                    # No question, wait a bit and check again
                    print("  No pending question, waiting...")
                    await asyncio.sleep(2)
                
                iteration += 1
            
            if iteration >= max_iterations:
                print(f"\n⚠ Reached max iterations ({max_iterations})")
            
            # Final status
            await self.print_status()
            
        except Exception as e:
            print(f"\n✗ Error during test flow: {e}")
            import traceback
            traceback.print_exc()
    
    async def test_mock_flow(self):
        """Test flow with mocked responses."""
        print("\n" + "="*60)
        print("Testing with mocked state transitions")
        print("="*60 + "\n")
        
        # Simulate state transitions
        states = [
            ("START", None),
            ("OPEN_URL", None),
            ("SESSION_CHECK", None),
            ("WAIT_LOGIN_INPUT", {
                "type": "text",
                "text": "Please provide login credentials. Format: 'username,password'",
                "id": "login_creds"
            }),
            ("LOGIN_ATTEMPT", None),
            ("POST_LOGIN_VALIDATE", None),
            ("CONTEXT_DETECT", None),
            ("WAIT_CONTEXT_INPUT", {
                "type": "select_one",
                "text": "Multiple contexts detected. Which tenant/project/cell should I test?",
                "id": "context_select",
                "options": [
                    {"id": "tenant_a", "label": "Tenant A"},
                    {"id": "tenant_b", "label": "Tenant B"}
                ]
            }),
            ("DISCOVERY_RUN", None),
            ("DISCOVERY_SUMMARY", None),
            ("WAIT_TEST_INTENT", {
                "type": "select_one",
                "text": "Discovery complete. Found 15 pages, 8 forms, 5 CRUD actions. What should I test now?",
                "id": "test_intent",
                "options": [
                    {"id": "smoke", "label": "smoke"},
                    {"id": "crud_sanity", "label": "crud_sanity"},
                    {"id": "module_based", "label": "module_based"},
                    {"id": "exploratory_15m", "label": "exploratory_15m"}
                ]
            }),
            ("TEST_PLAN_BUILD", None),
            ("TEST_EXECUTE", None),
            ("REPORT_GENERATE", None),
            ("DONE", None)
        ]
        
        print("State Transition Flow:\n")
        for idx, (state, question) in enumerate(states):
            print(f"{idx+1:2d}. {state}")
            if question:
                print(f"     └─ Question: {question['text'][:60]}...")
                if question.get("options"):
                    print(f"        Options: {[opt['label'] for opt in question['options']]}")
        
        print("\n✓ Mock flow demonstration complete")
        print("\nKey Interactive States:")
        print("  - WAIT_LOGIN_INPUT: User provides credentials")
        print("  - WAIT_CONTEXT_INPUT: User selects tenant/project/cell")
        print("  - WAIT_TEST_INTENT: User selects test type")


async def main():
    """Main test function."""
    parser = argparse.ArgumentParser(description="Test Interactive QA Buddy flow")
    parser.add_argument("--url", default="https://example.com", help="URL to test")
    parser.add_argument("--api-url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--mock", action="store_true", help="Run mock flow instead of real API")
    parser.add_argument("--headless", action="store_true", default=True, help="Run browser in headless mode")
    
    args = parser.parse_args()
    
    tester = InteractiveQATester(base_url=args.api_url)
    
    try:
        if args.mock:
            await tester.test_mock_flow()
        else:
            print(f"Testing against API: {args.api_url}")
            print(f"Target URL: {args.url}")
            print("\nNote: This will make real API calls. Ensure the API server is running.")
            print("Use --mock to see a demonstration without API calls.\n")
            
            await tester.test_flow(args.url, mock=False)
    finally:
        await tester.close()


if __name__ == "__main__":
    asyncio.run(main())

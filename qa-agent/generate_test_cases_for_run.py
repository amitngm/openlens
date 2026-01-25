#!/usr/bin/env python3
"""
Generate test cases for an existing discovery run.

Usage:
    python generate_test_cases_for_run.py <run_id>

Example:
    python generate_test_cases_for_run.py 044ec3a4-51e
"""

import sys
import json
from pathlib import Path

# Add app to path
sys.path.insert(0, str(Path(__file__).parent / "agent-api"))

from app.services.test_case_generator import get_test_case_generator


def main():
    if len(sys.argv) != 2:
        print("Usage: python generate_test_cases_for_run.py <run_id>")
        sys.exit(1)

    run_id = sys.argv[1]
    artifacts_path = f"agent-api/data/{run_id}"

    # Check if artifacts path exists
    if not Path(artifacts_path).exists():
        print(f"Error: Run {run_id} not found at {artifacts_path}")
        sys.exit(1)

    # Load discovery.json
    discovery_file = Path(artifacts_path) / "discovery.json"
    if not discovery_file.exists():
        print(f"Error: discovery.json not found for run {run_id}")
        sys.exit(1)

    with open(discovery_file, "r") as f:
        discovery_data = json.load(f)

    pages = discovery_data.get("pages", [])

    if not pages:
        print(f"No pages found in discovery for run {run_id}")
        sys.exit(1)

    print(f"Found {len(pages)} pages in discovery")
    print(f"Generating test cases...")

    # Generate test cases
    test_gen = get_test_case_generator()
    all_test_cases = []

    for idx, page in enumerate(pages, 1):
        page_name = page.get("page_signature", {}).get("page_name", page.get("url", ""))
        print(f"  [{idx}/{len(pages)}] Generating test cases for: {page_name}")

        page_test_cases = test_gen.generate_test_cases_for_page(page, run_id)
        all_test_cases.extend(page_test_cases)

        print(f"             Generated {len(page_test_cases)} test cases")

    # Save test cases
    print(f"\nTotal test cases generated: {len(all_test_cases)}")
    print(f"Saving to {artifacts_path}/test_cases.json...")

    test_gen.save_test_cases(run_id, artifacts_path, all_test_cases)

    # Display summary
    scenarios = test_gen.group_test_cases_by_scenario(all_test_cases)
    print(f"\n✅ Successfully generated {len(all_test_cases)} test cases")
    print(f"📋 Organized into {len(scenarios)} scenarios:\n")

    for scenario in scenarios:
        print(f"  - {scenario['scenario_name']}: {scenario['total']} test cases")

    print(f"\n📄 Test cases saved to: {artifacts_path}/test_cases.json")
    print(f"\n🔗 View in UI:")
    print(f"   http://localhost:8000 (go to Test Cases tab)")
    print(f"\n🔗 Fetch via API:")
    print(f"   curl http://localhost:8000/runs/{run_id}/test-cases")


if __name__ == "__main__":
    main()

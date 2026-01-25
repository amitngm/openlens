#!/usr/bin/env python3
"""
Clean up duplicate test cases from existing test_cases.json files.
"""

import json
from pathlib import Path
import sys

def cleanup_duplicates(run_id):
    """Remove duplicate test cases from a run's test_cases.json file."""

    test_cases_file = Path(f"agent-api/data/{run_id}/test_cases.json")

    if not test_cases_file.exists():
        print(f"❌ Test cases file not found: {test_cases_file}")
        return False

    # Load existing data
    with open(test_cases_file, "r") as f:
        data = json.load(f)

    all_test_cases = data.get("all_test_cases", [])
    original_count = len(all_test_cases)

    print(f"📊 Original test cases: {original_count}")

    # Remove duplicates (keep first occurrence)
    seen_ids = set()
    unique_test_cases = []
    duplicates_found = []

    for tc in all_test_cases:
        tc_id = tc.get("id")
        if tc_id not in seen_ids:
            seen_ids.add(tc_id)
            unique_test_cases.append(tc)
        else:
            duplicates_found.append(tc_id)

    new_count = len(unique_test_cases)
    duplicates_count = original_count - new_count

    print(f"✅ Unique test cases: {new_count}")
    print(f"🗑️  Duplicates removed: {duplicates_count}")

    if duplicates_count > 0:
        print(f"\n📋 Duplicate IDs removed:")
        for dup_id in set(duplicates_found):
            count = duplicates_found.count(dup_id)
            print(f"  - {dup_id} (appeared {count + 1} times)")

    # Group test cases by scenario
    scenarios = {}
    for tc in unique_test_cases:
        page_name = tc.get("page_name", "Unknown")
        test_type = tc.get("type", "general")

        # Determine scenario name (same logic as test_case_generator.py)
        if test_type in ["crud_create", "crud_update", "crud_delete"]:
            scenario_name = f"{page_name} - CRUD Operations"
        elif test_type in ["listing", "pagination", "search", "filters", "sort"]:
            scenario_name = f"{page_name} - Data Operations"
        elif test_type == "navigation":
            scenario_name = f"{page_name} - Navigation"
        elif test_type == "form_validation":
            scenario_name = f"{page_name} - Form Validation"
        else:
            scenario_name = f"{page_name} - General Tests"

        if scenario_name not in scenarios:
            scenarios[scenario_name] = {
                "scenario_name": scenario_name,
                "page_name": page_name,
                "page_url": tc.get("page_url", ""),
                "test_cases": [],
                "total": 0,
                "pending": 0,
                "passed": 0,
                "failed": 0
            }

        scenarios[scenario_name]["test_cases"].append(tc)
        scenarios[scenario_name]["total"] += 1

        status = tc.get("status", "pending")
        if status == "pending":
            scenarios[scenario_name]["pending"] += 1
        elif status == "passed":
            scenarios[scenario_name]["passed"] += 1
        elif status == "failed":
            scenarios[scenario_name]["failed"] += 1

    # Update data
    data["all_test_cases"] = unique_test_cases
    data["total_test_cases"] = new_count
    data["scenarios"] = list(scenarios.values())

    # Save cleaned data
    with open(test_cases_file, "w") as f:
        json.dump(data, f, indent=2)

    print(f"\n💾 Saved cleaned test cases to: {test_cases_file}")
    return True

def cleanup_all_runs():
    """Clean up duplicates from all runs."""
    data_dir = Path("agent-api/data")

    if not data_dir.exists():
        print(f"❌ Data directory not found: {data_dir}")
        return

    # Find all run directories
    run_dirs = [d for d in data_dir.iterdir() if d.is_dir() and not d.name.startswith('.')]

    print(f"🔍 Found {len(run_dirs)} run directories\n")

    cleaned_count = 0
    for run_dir in run_dirs:
        run_id = run_dir.name
        test_cases_file = run_dir / "test_cases.json"

        if test_cases_file.exists():
            print(f"\n{'='*60}")
            print(f"📁 Cleaning run: {run_id}")
            print(f"{'='*60}")
            if cleanup_duplicates(run_id):
                cleaned_count += 1

    print(f"\n{'='*60}")
    print(f"✅ Cleaned {cleaned_count} runs")
    print(f"{'='*60}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        run_id = sys.argv[1]
        print(f"🧹 Cleaning up duplicates for run: {run_id}\n")
        cleanup_duplicates(run_id)
    else:
        print(f"🧹 Cleaning up duplicates for ALL runs\n")
        cleanup_all_runs()

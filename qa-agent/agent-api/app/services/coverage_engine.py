"""Test Coverage Engine - Calculate and track test coverage metrics."""

from typing import Dict, List, Optional, Any
import logging
from collections import defaultdict

from app.models.test_case_models import TestCase
from app.services.validation_schema import (
    ValidationSchemaRegistry,
    FeatureValidationSchema,
    ValidationRule
)

logger = logging.getLogger(__name__)


class TestCoverageEngine:
    """Calculate comprehensive test coverage metrics and identify gaps."""

    def __init__(self, schema_registry: Optional[ValidationSchemaRegistry] = None):
        self.schema_registry = schema_registry or ValidationSchemaRegistry()
        logger.info("TestCoverageEngine initialized")

    def calculate_coverage(
        self,
        detected_features: Dict[str, Any],
        generated_tests: List[TestCase]
    ) -> Dict[str, Any]:
        """Calculate comprehensive coverage metrics.

        Args:
            detected_features: Features detected on pages (from enhanced generator)
            generated_tests: List of generated test cases

        Returns:
            Comprehensive coverage report with percentages, gaps, and recommendations
        """
        logger.info(
            f"Calculating coverage for {len(detected_features)} features and {len(generated_tests)} tests"
        )

        coverage_report = {
            "overall_coverage_percentage": 0.0,
            "feature_coverage": {},
            "category_coverage": {
                "positive": {"expected": 0, "actual": 0, "percentage": 0.0},
                "negative": {"expected": 0, "actual": 0, "percentage": 0.0},
                "edge": {"expected": 0, "actual": 0, "percentage": 0.0},
                "boundary": {"expected": 0, "actual": 0, "percentage": 0.0}
            },
            "severity_coverage": {
                "critical": {"expected": 0, "actual": 0, "percentage": 0.0},
                "high": {"expected": 0, "actual": 0, "percentage": 0.0},
                "medium": {"expected": 0, "actual": 0, "percentage": 0.0},
                "low": {"expected": 0, "actual": 0, "percentage": 0.0}
            },
            "requirements_met": True,
            "coverage_gaps": [],
            "recommendations": [],
            "summary": {
                "total_expected_tests": 0,
                "total_actual_tests": len(generated_tests),
                "features_detected": len(detected_features),
                "features_with_tests": 0
            }
        }

        total_expected = 0
        total_actual = 0

        # Calculate per-feature coverage
        for feature_type, feature_info in detected_features.items():
            schema = self.schema_registry.get_schema(feature_type)
            if not schema:
                logger.warning(f"No schema found for feature: {feature_type}")
                continue

            expected_rules = schema.validation_rules
            actual_tests = [t for t in generated_tests if t.feature_type == feature_type]

            # Check if coverage requirements are met
            requirements_met = self._check_requirements_met(actual_tests, schema.coverage_requirements)

            if not requirements_met:
                coverage_report["requirements_met"] = False

            # Calculate category breakdown for this feature
            category_breakdown = self._get_category_breakdown(actual_tests, expected_rules)

            # Find missing rules
            missing_rules = self._find_missing_rules(expected_rules, actual_tests)

            feature_coverage = {
                "expected_total": len(expected_rules),
                "actual_total": len(actual_tests),
                "coverage_percentage": (len(actual_tests) / len(expected_rules) * 100) if expected_rules else 0,
                "requirements_met": requirements_met,
                "missing_rules": missing_rules,
                "by_category": category_breakdown["by_category"],
                "by_severity": category_breakdown["by_severity"]
            }

            coverage_report["feature_coverage"][feature_type] = feature_coverage
            total_expected += len(expected_rules)
            total_actual += len(actual_tests)

            if len(actual_tests) > 0:
                coverage_report["summary"]["features_with_tests"] += 1

            # Update global category coverage
            for category in ["positive", "negative", "edge", "boundary"]:
                expected_count = len([r for r in expected_rules if r.category == category])
                actual_count = len([t for t in actual_tests if t.test_category == category])
                coverage_report["category_coverage"][category]["expected"] += expected_count
                coverage_report["category_coverage"][category]["actual"] += actual_count

            # Update global severity coverage
            for severity in ["critical", "high", "medium", "low"]:
                expected_count = len([r for r in expected_rules if r.severity == severity])
                actual_count = len([t for t in actual_tests if t.severity == severity])
                coverage_report["severity_coverage"][severity]["expected"] += expected_count
                coverage_report["severity_coverage"][severity]["actual"] += actual_count

        # Calculate overall coverage percentage
        coverage_report["overall_coverage_percentage"] = (
            (total_actual / total_expected * 100) if total_expected > 0 else 0
        )

        coverage_report["summary"]["total_expected_tests"] = total_expected
        coverage_report["summary"]["total_actual_tests"] = total_actual

        # Calculate category percentages
        for category in coverage_report["category_coverage"]:
            expected = coverage_report["category_coverage"][category]["expected"]
            actual = coverage_report["category_coverage"][category]["actual"]
            coverage_report["category_coverage"][category]["percentage"] = (
                (actual / expected * 100) if expected > 0 else 0
            )

        # Calculate severity percentages
        for severity in coverage_report["severity_coverage"]:
            expected = coverage_report["severity_coverage"][severity]["expected"]
            actual = coverage_report["severity_coverage"][severity]["actual"]
            coverage_report["severity_coverage"][severity]["percentage"] = (
                (actual / expected * 100) if expected > 0 else 0
            )

        # Identify coverage gaps
        coverage_report["coverage_gaps"] = self._identify_coverage_gaps(coverage_report)

        # Generate recommendations
        coverage_report["recommendations"] = self._generate_recommendations(coverage_report)

        logger.info(
            f"Coverage calculation complete: {coverage_report['overall_coverage_percentage']:.1f}% overall, "
            f"Requirements met: {coverage_report['requirements_met']}"
        )

        return coverage_report

    def _check_requirements_met(
        self,
        tests: List[TestCase],
        requirements: Dict[str, int]
    ) -> bool:
        """Check if minimum coverage requirements are met."""

        category_counts = {
            "positive": len([t for t in tests if t.test_category == "positive"]),
            "negative": len([t for t in tests if t.test_category == "negative"]),
            "edge": len([t for t in tests if t.test_category == "edge"]),
            "boundary": len([t for t in tests if t.test_category == "boundary"])
        }

        for requirement_key, min_required in requirements.items():
            # Parse requirement key (e.g., "min_positive_tests" -> "positive")
            category_name = requirement_key.replace("min_", "").replace("_tests", "")

            actual_count = category_counts.get(category_name, 0)

            if actual_count < min_required:
                logger.warning(
                    f"Requirement not met: {requirement_key} requires {min_required}, "
                    f"but only {actual_count} tests generated"
                )
                return False

        return True

    def _get_category_breakdown(
        self,
        actual_tests: List[TestCase],
        expected_rules: List[ValidationRule]
    ) -> Dict[str, Dict[str, int]]:
        """Get breakdown by category and severity."""

        breakdown = {
            "by_category": {
                "positive": {"expected": 0, "actual": 0},
                "negative": {"expected": 0, "actual": 0},
                "edge": {"expected": 0, "actual": 0},
                "boundary": {"expected": 0, "actual": 0}
            },
            "by_severity": {
                "critical": {"expected": 0, "actual": 0},
                "high": {"expected": 0, "actual": 0},
                "medium": {"expected": 0, "actual": 0},
                "low": {"expected": 0, "actual": 0}
            }
        }

        # Count expected
        for rule in expected_rules:
            breakdown["by_category"][rule.category]["expected"] += 1
            breakdown["by_severity"][rule.severity]["expected"] += 1

        # Count actual
        for test in actual_tests:
            breakdown["by_category"][test.test_category]["actual"] += 1
            breakdown["by_severity"][test.severity]["actual"] += 1

        return breakdown

    def _find_missing_rules(
        self,
        expected_rules: List[ValidationRule],
        actual_tests: List[TestCase]
    ) -> List[str]:
        """Find validation rules that don't have corresponding test cases."""

        # Get all validation rule IDs that were covered
        covered_rule_ids = {t.validation_rule_id for t in actual_tests}

        # Find uncovered rules
        missing_rules = []
        for rule in expected_rules:
            if rule.id not in covered_rule_ids:
                missing_rules.append(rule.id)

        return missing_rules

    def _has_test_for_rule(self, rule: ValidationRule, tests: List[TestCase]) -> bool:
        """Check if any test covers this validation rule."""
        return any(t.validation_rule_id == rule.id for t in tests)

    def _identify_coverage_gaps(self, coverage_report: Dict) -> List[Dict[str, Any]]:
        """Identify specific coverage gaps with actionable details."""

        gaps = []

        # Check per-feature coverage
        for feature_type, feature_cov in coverage_report["feature_coverage"].items():
            coverage_pct = feature_cov["coverage_percentage"]

            if coverage_pct < 80:
                gap = {
                    "type": "feature",
                    "feature": feature_type,
                    "coverage_percentage": coverage_pct,
                    "expected_total": feature_cov["expected_total"],
                    "actual_total": feature_cov["actual_total"],
                    "missing_count": feature_cov["expected_total"] - feature_cov["actual_total"],
                    "missing_rules": feature_cov["missing_rules"],
                    "severity": "high" if coverage_pct < 50 else "medium",
                    "recommendation": (
                        f"Add {feature_cov['expected_total'] - feature_cov['actual_total']} more test cases "
                        f"for {feature_type} to reach 80% coverage"
                    )
                }
                gaps.append(gap)

        # Check category coverage
        for category, category_cov in coverage_report["category_coverage"].items():
            coverage_pct = category_cov["percentage"]
            expected = category_cov["expected"]
            actual = category_cov["actual"]

            if expected > 0 and coverage_pct < 70:
                gap = {
                    "type": "category",
                    "category": category,
                    "coverage_percentage": coverage_pct,
                    "expected_total": expected,
                    "actual_total": actual,
                    "missing_count": expected - actual,
                    "severity": "medium",
                    "recommendation": (
                        f"Add {expected - actual} more {category} test cases "
                        f"to improve {category} testing coverage"
                    )
                }
                gaps.append(gap)

        # Check severity coverage - prioritize critical
        critical_cov = coverage_report["severity_coverage"]["critical"]
        if critical_cov["expected"] > 0 and critical_cov["percentage"] < 100:
            gap = {
                "type": "severity",
                "severity": "critical",
                "coverage_percentage": critical_cov["percentage"],
                "expected_total": critical_cov["expected"],
                "actual_total": critical_cov["actual"],
                "missing_count": critical_cov["expected"] - critical_cov["actual"],
                "severity": "critical",
                "recommendation": (
                    f"CRITICAL: Add {critical_cov['expected'] - critical_cov['actual']} more critical test cases "
                    f"to reach 100% critical coverage"
                )
            }
            gaps.append(gap)

        return gaps

    def _generate_recommendations(self, coverage_report: Dict) -> List[str]:
        """Generate actionable recommendations based on coverage."""

        recommendations = []

        overall_pct = coverage_report["overall_coverage_percentage"]

        # Overall coverage recommendations
        if overall_pct < 50:
            recommendations.append(
                f"Overall coverage is low ({overall_pct:.1f}%). Focus on implementing critical and high severity tests first."
            )
        elif overall_pct < 80:
            recommendations.append(
                f"Overall coverage is moderate ({overall_pct:.1f}%). Add more edge case and boundary tests to reach 80%+."
            )
        else:
            recommendations.append(
                f"Overall coverage is good ({overall_pct:.1f}%). Consider adding more negative and boundary tests for robustness."
            )

        # Requirements met check
        if not coverage_report["requirements_met"]:
            recommendations.append(
                "CRITICAL: Minimum coverage requirements NOT met. Review feature_coverage to see which requirements are missing."
            )

        # Category-specific recommendations
        for category, cov in coverage_report["category_coverage"].items():
            if cov["expected"] > 0:
                pct = cov["percentage"]
                if pct < 50:
                    recommendations.append(
                        f"Low {category} test coverage ({pct:.1f}%). Add {cov['expected'] - cov['actual']} more {category} tests."
                    )

        # Severity-specific recommendations
        critical_cov = coverage_report["severity_coverage"]["critical"]
        if critical_cov["expected"] > 0 and critical_cov["percentage"] < 100:
            recommendations.append(
                f"CRITICAL: Only {critical_cov['percentage']:.1f}% of critical tests generated. "
                f"Add {critical_cov['expected'] - critical_cov['actual']} critical tests immediately."
            )

        # Feature-specific recommendations (top 3 gaps)
        feature_gaps = []
        for feature_type, feature_cov in coverage_report["feature_coverage"].items():
            if feature_cov["coverage_percentage"] < 80:
                feature_gaps.append((
                    feature_type,
                    feature_cov["coverage_percentage"],
                    feature_cov["expected_total"] - feature_cov["actual_total"]
                ))

        # Sort by coverage percentage (lowest first)
        feature_gaps.sort(key=lambda x: x[1])

        for feature_type, pct, missing_count in feature_gaps[:3]:
            recommendations.append(
                f"Feature '{feature_type}': {pct:.1f}% coverage. Add {missing_count} more test cases."
            )

        if not recommendations:
            recommendations.append("Coverage targets met! Consider adding more boundary and performance tests.")

        return recommendations

    def generate_coverage_summary_text(self, coverage_report: Dict) -> str:
        """Generate human-readable coverage summary."""

        summary_lines = [
            "=" * 70,
            "TEST COVERAGE REPORT",
            "=" * 70,
            "",
            f"Overall Coverage: {coverage_report['overall_coverage_percentage']:.1f}%",
            f"Requirements Met: {'✅ YES' if coverage_report['requirements_met'] else '❌ NO'}",
            f"Total Tests Generated: {coverage_report['summary']['total_actual_tests']}",
            f"Total Tests Expected: {coverage_report['summary']['total_expected_tests']}",
            "",
            "FEATURE COVERAGE:",
            "-" * 70
        ]

        for feature_type, feature_cov in coverage_report["feature_coverage"].items():
            pct = feature_cov["coverage_percentage"]
            status_icon = "✅" if pct >= 80 else "⚠️" if pct >= 50 else "❌"
            summary_lines.append(
                f"{status_icon} {feature_type.upper():15s}: {pct:5.1f}% "
                f"({feature_cov['actual_total']}/{feature_cov['expected_total']} tests)"
            )

        summary_lines.extend([
            "",
            "CATEGORY COVERAGE:",
            "-" * 70
        ])

        for category, cov in coverage_report["category_coverage"].items():
            pct = cov["percentage"]
            if cov["expected"] > 0:
                status_icon = "✅" if pct >= 70 else "⚠️" if pct >= 40 else "❌"
                summary_lines.append(
                    f"{status_icon} {category.capitalize():15s}: {pct:5.1f}% "
                    f"({cov['actual']}/{cov['expected']} tests)"
                )

        summary_lines.extend([
            "",
            "SEVERITY COVERAGE:",
            "-" * 70
        ])

        for severity, cov in coverage_report["severity_coverage"].items():
            pct = cov["percentage"]
            if cov["expected"] > 0:
                status_icon = "✅" if pct >= 80 else "⚠️" if pct >= 50 else "❌"
                summary_lines.append(
                    f"{status_icon} {severity.capitalize():15s}: {pct:5.1f}% "
                    f"({cov['actual']}/{cov['expected']} tests)"
                )

        if coverage_report["coverage_gaps"]:
            summary_lines.extend([
                "",
                "COVERAGE GAPS:",
                "-" * 70
            ])
            for gap in coverage_report["coverage_gaps"][:5]:  # Top 5 gaps
                summary_lines.append(f"• {gap['recommendation']}")

        if coverage_report["recommendations"]:
            summary_lines.extend([
                "",
                "RECOMMENDATIONS:",
                "-" * 70
            ])
            for rec in coverage_report["recommendations"][:5]:  # Top 5 recommendations
                summary_lines.append(f"• {rec}")

        summary_lines.append("=" * 70)

        return "\n".join(summary_lines)

    def export_coverage_report(
        self,
        coverage_report: Dict,
        output_path: Path
    ) -> Path:
        """Export coverage report to JSON file."""
        import json

        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, "w") as f:
            json.dump(coverage_report, f, indent=2)

        logger.info(f"Coverage report exported to: {output_path}")
        return output_path


class CoverageAnalyzer:
    """Analyze test coverage and provide insights."""

    def __init__(self):
        pass

    def analyze_test_quality(self, test_cases: List[TestCase]) -> Dict[str, Any]:
        """Analyze quality of generated test cases."""

        quality_report = {
            "total_tests": len(test_cases),
            "quality_score": 0.0,
            "metrics": {
                "has_specific_selectors": 0,
                "has_test_data": 0,
                "has_preconditions": 0,
                "has_postconditions": 0,
                "has_assertions": 0,
                "executable_steps": 0
            },
            "issues": []
        }

        for tc in test_cases:
            # Check for specific selectors
            has_selectors = any(step.selector for step in tc.steps)
            if has_selectors:
                quality_report["metrics"]["has_specific_selectors"] += 1

            # Check for test data
            if tc.test_data:
                quality_report["metrics"]["has_test_data"] += 1

            # Check for preconditions
            if tc.preconditions:
                quality_report["metrics"]["has_preconditions"] += 1

            # Check for postconditions
            if tc.postconditions:
                quality_report["metrics"]["has_postconditions"] += 1

            # Check for assertions
            has_assertions = any(
                step.action == "assert" or step.expected for step in tc.steps
            )
            if has_assertions:
                quality_report["metrics"]["has_assertions"] += 1

            # Check for executable steps
            has_executable = all(
                step.action in ["navigate", "click", "fill", "assert", "wait", "select", "clear"]
                for step in tc.steps
            )
            if has_executable:
                quality_report["metrics"]["executable_steps"] += 1

            # Identify issues
            if not has_selectors:
                quality_report["issues"].append(f"{tc.id}: Missing specific selectors")
            if not tc.test_data and tc.feature_type in ["search", "filter"]:
                quality_report["issues"].append(f"{tc.id}: Missing test data for {tc.feature_type}")
            if not has_assertions:
                quality_report["issues"].append(f"{tc.id}: Missing assertions")

        # Calculate quality score (0-100)
        total_tests = len(test_cases)
        if total_tests > 0:
            metrics = quality_report["metrics"]
            quality_score = (
                (metrics["has_specific_selectors"] / total_tests * 25) +
                (metrics["has_test_data"] / total_tests * 20) +
                (metrics["has_assertions"] / total_tests * 30) +
                (metrics["executable_steps"] / total_tests * 25)
            )
            quality_report["quality_score"] = quality_score
        else:
            quality_report["quality_score"] = 0.0

        return quality_report


__all__ = [
    "TestCoverageEngine",
    "CoverageAnalyzer"
]

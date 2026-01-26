# Custom Validation Plugins

This directory is for custom validation plugins that extend QA Buddy's test generation capabilities.

## How to Add Custom Validations

### Step 1: Create a Plugin File

Create a new Python file in this directory (e.g., `my_custom_feature.py`).

### Step 2: Define Your Validation Plugin

```python
from app.services.validation_plugins import ValidationPlugin
from app.services.validation_schema import FeatureValidationSchema, ValidationRule

class MyCustomFeaturePlugin(ValidationPlugin):
    """Custom validation for my specific feature."""

    def get_feature_type(self) -> str:
        """Return unique identifier for this feature."""
        return "my_custom_feature"

    def get_validation_schema(self) -> FeatureValidationSchema:
        """Define comprehensive validation rules for this feature."""
        return FeatureValidationSchema(
            feature_type="my_custom_feature",
            display_name="My Custom Feature",
            description="Validation for my custom feature",

            # How to detect this feature on a page
            detection_strategy={
                "selectors": [".my-feature", "[data-feature='custom']"],
                "keywords": ["custom", "feature"]
            },

            # Validation rules to generate test cases
            validation_rules=[
                ValidationRule(
                    id="custom_feature_visible",
                    name="Custom feature is visible",
                    category="positive",  # positive, negative, edge, boundary
                    severity="critical",  # critical, high, medium, low
                    selector_strategy="css",  # css, xpath, text, aria
                    selector=".my-feature",
                    test_data=None,
                    expected_behavior="Feature displays correctly",
                    assertion_type="visible",
                    assertion_value=True,
                    preconditions=["navigate_to_page"],
                    postconditions=[],
                    tags=["custom", "ui"]
                ),

                ValidationRule(
                    id="custom_feature_interaction",
                    name="Custom feature button works",
                    category="positive",
                    severity="high",
                    selector_strategy="css",
                    selector=".my-feature button",
                    test_data={"action": "click"},
                    expected_behavior="Button triggers expected action",
                    assertion_type="content_changed",
                    assertion_value=None,
                    preconditions=["navigate_to_page"],
                    postconditions=["reset_state"],
                    tags=["custom", "interaction"]
                ),

                # Add more validation rules...
            ],

            # Minimum coverage requirements
            coverage_requirements={
                "min_positive_tests": 2,
                "min_negative_tests": 1,
                "min_edge_tests": 1,
                "min_boundary_tests": 0
            }
        )

    def detect_feature(self, page_info: Dict[str, Any]) -> Optional[Dict]:
        """Detect if this feature exists on the page."""
        page_sig = page_info.get("page_signature", {})

        # Check primary actions
        for action in page_sig.get("primary_actions", []):
            if "custom" in action.get("text", "").lower():
                return {"detected": True, "confidence": "high"}

        # Check page name
        if "custom" in page_sig.get("page_name", "").lower():
            return {"detected": True, "confidence": "medium"}

        return None  # Feature not detected
```

### Step 3: Plugin is Auto-Loaded

Your plugin will be automatically loaded when the discovery runner starts. No need to register it manually!

## Validation Rule Guidelines

### Categories

- **positive**: Expected successful behavior (happy path)
- **negative**: Error handling and edge cases
- **edge**: Unusual but valid inputs/states
- **boundary**: Limits and extremes

### Severity Levels

- **critical**: Core functionality, must work
- **high**: Important features, significant impact if broken
- **medium**: Useful features, moderate impact
- **low**: Nice-to-have, minimal impact

### Assertion Types

- `visible`: Element is visible
- `count_decreased`: Result count decreased (for filters/search)
- `count_restored`: Count increased back (for clear buttons)
- `text_contains`: Element contains specific text
- `no_error`: No error messages visible
- `disabled`: Element is disabled
- `content_changed`: Content changed after action
- `url_contains`: URL contains specific parameter
- Custom assertion types can be added

### Selector Strategies

- `css`: CSS selector (most common)
- `xpath`: XPath selector
- `text`: Find by text content
- `aria`: Find by ARIA label

## Example: Dashboard Widget Plugin

See `ExampleCustomDashboardPlugin` in `app/services/validation_plugins.py` for a complete working example.

## Testing Your Plugin

1. Place your plugin file in this directory
2. Start a discovery run
3. Check `test_coverage_report.json` to see if your feature was detected
4. Review `test_cases_enhanced.json` to see generated test cases

## Coverage Reports

After discovery, check these files:

- `test_coverage_report.json` - Detailed coverage metrics
- `coverage_summary.txt` - Human-readable coverage summary
- `test_quality_report.json` - Quality analysis of generated tests
- `test_cases_enhanced.json` - All test cases in executable format

## Benefits of Plugin System

✅ Add new validation types without modifying core code
✅ Share validation plugins across teams
✅ Version control your custom validation rules
✅ Automatic coverage tracking for custom features
✅ Consistent test case format across all features

"""Validation Plugin System - Extensible validation framework."""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any
from pathlib import Path
import logging
import importlib.util
import sys

from app.services.validation_schema import (
    FeatureValidationSchema,
    ValidationRule,
    ValidationSchemaRegistry
)

logger = logging.getLogger(__name__)


class ValidationPlugin(ABC):
    """Abstract base class for validation plugins.

    Implement this class to create custom validation schemas for new features.
    Place your plugin file in the plugins/ directory and it will be auto-loaded.

    Example:
        class MyCustomFeaturePlugin(ValidationPlugin):
            def get_feature_type(self) -> str:
                return "custom_dashboard_widget"

            def get_validation_schema(self) -> FeatureValidationSchema:
                return FeatureValidationSchema(
                    feature_type="custom_dashboard_widget",
                    display_name="Dashboard Widget",
                    description="Custom widget validation",
                    detection_strategy={
                        "selectors": [".widget", ".dashboard-widget"],
                        "keywords": ["widget", "dashboard"]
                    },
                    validation_rules=[
                        ValidationRule(
                            id="widget_visible",
                            name="Widget is visible",
                            category="positive",
                            severity="high",
                            selector_strategy="css",
                            selector=".widget",
                            test_data=None,
                            expected_behavior="Widget displays correctly",
                            assertion_type="visible",
                            assertion_value=True,
                            preconditions=[],
                            postconditions=[]
                        )
                    ],
                    coverage_requirements={"min_positive_tests": 1}
                )

            def detect_feature(self, page_info: Dict[str, Any]) -> Optional[Dict]:
                page_sig = page_info.get("page_signature", {})
                # Check if widget exists
                for action in page_sig.get("primary_actions", []):
                    if "widget" in action.get("text", "").lower():
                        return {"detected": True, "confidence": "high"}
                return None
    """

    @abstractmethod
    def get_feature_type(self) -> str:
        """Return the feature type identifier (e.g., 'custom_feature')."""
        pass

    @abstractmethod
    def get_validation_schema(self) -> FeatureValidationSchema:
        """Return the complete validation schema for this feature."""
        pass

    @abstractmethod
    def detect_feature(self, page_info: Dict[str, Any]) -> Optional[Dict]:
        """Detect if this feature exists on the page.

        Args:
            page_info: Page information from discovery

        Returns:
            Dict with {"detected": True, "confidence": "high"} if detected, None otherwise
        """
        pass


class ValidationPluginManager:
    """Manage loading and registration of validation plugins."""

    def __init__(self, schema_registry: Optional[ValidationSchemaRegistry] = None):
        self.schema_registry = schema_registry or ValidationSchemaRegistry()
        self.plugins: Dict[str, ValidationPlugin] = {}
        logger.info("ValidationPluginManager initialized")

    def register_plugin(self, plugin: ValidationPlugin):
        """Register a validation plugin.

        Args:
            plugin: ValidationPlugin instance to register
        """
        feature_type = plugin.get_feature_type()

        if feature_type in self.plugins:
            logger.warning(f"Plugin for {feature_type} already registered. Overwriting.")

        self.plugins[feature_type] = plugin

        # Register schema with registry
        schema = plugin.get_validation_schema()
        self.schema_registry.register_schema(schema)

        logger.info(f"Registered plugin: {feature_type} with {len(schema.validation_rules)} rules")

    def load_plugins_from_directory(self, plugin_dir: Path):
        """Load all validation plugins from a directory.

        Args:
            plugin_dir: Directory containing plugin Python files

        Each plugin file should contain a class that inherits from ValidationPlugin
        and has the suffix 'Plugin' in its name (e.g., MyCustomFeaturePlugin).
        """
        if not plugin_dir.exists():
            logger.info(f"Plugin directory does not exist: {plugin_dir}")
            return

        if not plugin_dir.is_dir():
            logger.warning(f"Plugin path is not a directory: {plugin_dir}")
            return

        plugin_files = list(plugin_dir.glob("*.py"))
        logger.info(f"Found {len(plugin_files)} potential plugin files in {plugin_dir}")

        loaded_count = 0

        for plugin_file in plugin_files:
            if plugin_file.name.startswith("_"):
                continue  # Skip private files

            try:
                # Load module dynamically
                module_name = f"custom_plugins.{plugin_file.stem}"
                spec = importlib.util.spec_from_file_location(module_name, plugin_file)

                if spec is None or spec.loader is None:
                    logger.warning(f"Could not load spec for {plugin_file}")
                    continue

                module = importlib.util.module_from_spec(spec)
                sys.modules[module_name] = module
                spec.loader.exec_module(module)

                # Find ValidationPlugin subclasses
                for attr_name in dir(module):
                    attr = getattr(module, attr_name)

                    # Check if it's a class and subclass of ValidationPlugin
                    if (
                        isinstance(attr, type) and
                        issubclass(attr, ValidationPlugin) and
                        attr is not ValidationPlugin
                    ):
                        # Instantiate and register
                        plugin_instance = attr()
                        self.register_plugin(plugin_instance)
                        loaded_count += 1
                        logger.info(f"Loaded plugin from {plugin_file.name}: {attr_name}")

            except Exception as e:
                logger.error(f"Failed to load plugin from {plugin_file}: {e}", exc_info=True)

        logger.info(f"Successfully loaded {loaded_count} plugins from {plugin_dir}")

    def get_all_schemas(self) -> Dict[str, FeatureValidationSchema]:
        """Get all validation schemas (default + custom)."""
        return self.schema_registry.get_all_schemas()

    def detect_features_on_page(self, page_info: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        """Use all plugins to detect features on a page.

        Args:
            page_info: Page information from discovery

        Returns:
            Dict mapping feature_type to detection results
        """
        detected = {}

        for feature_type, plugin in self.plugins.items():
            try:
                detection_result = plugin.detect_feature(page_info)
                if detection_result and detection_result.get("detected"):
                    detected[feature_type] = detection_result
                    logger.debug(f"Plugin {feature_type} detected feature with confidence {detection_result.get('confidence')}")
            except Exception as e:
                logger.error(f"Plugin {feature_type} failed to detect: {e}")

        return detected


# =============================================================================
# EXAMPLE CUSTOM PLUGIN (for documentation)
# =============================================================================

class ExampleCustomDashboardPlugin(ValidationPlugin):
    """Example custom plugin for dashboard widget validation.

    This is an example showing how to create custom validation plugins.
    To use: Create a file in plugins/ directory with your custom plugin class.
    """

    def get_feature_type(self) -> str:
        return "dashboard_widget"

    def get_validation_schema(self) -> FeatureValidationSchema:
        return FeatureValidationSchema(
            feature_type="dashboard_widget",
            display_name="Dashboard Widget",
            description="Custom dashboard widget validation",
            detection_strategy={
                "selectors": [".widget", ".dashboard-widget", "[data-widget]"],
                "keywords": ["widget", "dashboard", "card"]
            },
            validation_rules=[
                ValidationRule(
                    id="widget_visible",
                    name="Widget is visible on dashboard",
                    category="positive",
                    severity="high",
                    selector_strategy="css",
                    selector=".widget, .dashboard-widget",
                    test_data=None,
                    expected_behavior="Widget displays correctly on dashboard",
                    assertion_type="visible",
                    assertion_value=True,
                    preconditions=["navigate_to_dashboard"],
                    postconditions=[],
                    tags=["widget", "dashboard", "ui"]
                ),
                ValidationRule(
                    id="widget_refresh_button",
                    name="Widget refresh button works",
                    category="positive",
                    severity="medium",
                    selector_strategy="css",
                    selector=".widget .refresh-button, .widget button[aria-label*='refresh' i]",
                    test_data=None,
                    expected_behavior="Refresh button updates widget data",
                    assertion_type="content_changed",
                    assertion_value=None,
                    preconditions=["navigate_to_dashboard"],
                    postconditions=[],
                    tags=["widget", "refresh", "interaction"]
                ),
                ValidationRule(
                    id="widget_loading_state",
                    name="Widget shows loading state",
                    category="edge",
                    severity="low",
                    selector_strategy="css",
                    selector=".widget .loading, .widget .spinner",
                    test_data=None,
                    expected_behavior="Widget shows loading indicator while fetching data",
                    assertion_type="loading_visible",
                    assertion_value=True,
                    preconditions=["navigate_to_dashboard"],
                    postconditions=[],
                    tags=["widget", "loading", "ux"]
                )
            ],
            coverage_requirements={
                "min_positive_tests": 2,
                "min_negative_tests": 0,
                "min_edge_tests": 1,
                "min_boundary_tests": 0
            }
        )

    def detect_feature(self, page_info: Dict[str, Any]) -> Optional[Dict]:
        """Detect if dashboard widget feature exists on page."""
        page_sig = page_info.get("page_signature", {})

        # Check for widget-related elements
        for action in page_sig.get("primary_actions", []):
            action_text = action.get("text", "").lower()
            if "widget" in action_text or "dashboard" in action_text:
                return {"detected": True, "confidence": "medium"}

        # Check page name
        page_name = page_sig.get("page_name", "").lower()
        if "dashboard" in page_name:
            return {"detected": True, "confidence": "high"}

        return None


# =============================================================================
# PLUGIN DISCOVERY HELPERS
# =============================================================================

def discover_and_load_plugins(
    plugin_dir: Optional[Path] = None,
    schema_registry: Optional[ValidationSchemaRegistry] = None
) -> ValidationPluginManager:
    """Discover and load all validation plugins.

    Args:
        plugin_dir: Directory to search for plugins (defaults to ./plugins)
        schema_registry: Existing schema registry to use

    Returns:
        ValidationPluginManager with all plugins loaded
    """
    if plugin_dir is None:
        # Default to plugins/ directory relative to project root
        plugin_dir = Path(__file__).parent.parent.parent / "plugins"

    manager = ValidationPluginManager(schema_registry=schema_registry)

    if plugin_dir.exists():
        manager.load_plugins_from_directory(plugin_dir)
    else:
        logger.info(f"Plugin directory does not exist yet: {plugin_dir}")
        logger.info("Create the directory and add custom plugin files to extend validation coverage")

    return manager


__all__ = [
    "ValidationPlugin",
    "ValidationPluginManager",
    "ExampleCustomDashboardPlugin",
    "discover_and_load_plugins"
]

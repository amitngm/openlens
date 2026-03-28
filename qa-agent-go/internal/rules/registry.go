package rules

import (
	"crypto/md5"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/qabuddy/agent/internal/discovery"
	"github.com/qabuddy/agent/internal/models"
)

// ValidationRule defines a single test rule template
type ValidationRule struct {
	ID          string
	Name        string
	Description string
	Category    string // positive, negative, edge, boundary
	Severity    models.Severity
	Steps       []models.TestStep
	Expected    string
}

// FeatureSchema defines rules for a feature type
type FeatureSchema struct {
	FeatureType models.FeatureType
	Rules       []ValidationRule
}

// Registry holds all feature schemas
type Registry struct {
	schemas map[models.FeatureType]FeatureSchema
}

// NewRegistry initializes the registry with all built-in schemas
func NewRegistry() *Registry {
	r := &Registry{schemas: make(map[models.FeatureType]FeatureSchema)}
	for _, schema := range allSchemas() {
		r.schemas[schema.FeatureType] = schema
	}
	return r
}

// Get retrieves a schema by feature type
func (r *Registry) Get(ft models.FeatureType) (FeatureSchema, bool) {
	s, ok := r.schemas[ft]
	return s, ok
}

// All returns all schemas
func (r *Registry) All() []FeatureSchema {
	schemas := make([]FeatureSchema, 0, len(r.schemas))
	for _, s := range r.schemas {
		schemas = append(schemas, s)
	}
	return schemas
}

// GenerateTestCases instantiates rules for a detected feature with real selectors
func (r *Registry) GenerateTestCases(feature discovery.DetectedFeature, pageURL string) []models.TestCase {
	schema, ok := r.schemas[feature.Type]
	if !ok {
		return nil
	}

	var cases []models.TestCase
	for _, rule := range schema.Rules {
		tc := models.TestCase{
			ID:               uuid.New().String(),
			Name:             rule.Name,
			Description:      rule.Description,
			FeatureType:      feature.Type,
			Category:         rule.Category,
			Severity:         rule.Severity,
			Priority:         severityPriority(rule.Severity),
			PageURL:          pageURL,
			ExpectedResult:   rule.Expected,
			ValidationRuleID: rule.ID,
			GeneratedBy:      "rules",
			Status:           models.TestStatusPending,
		}

		// Instantiate steps with real selector
		steps := make([]models.TestStep, len(rule.Steps))
		for i, s := range rule.Steps {
			step := s
			if strings.Contains(step.Selector, "{{selector}}") {
				step.Selector = strings.ReplaceAll(step.Selector, "{{selector}}", feature.Selector)
			}
			steps[i] = step
		}
		tc.Steps = steps

		// Generate fingerprint
		tc.Fingerprint = fingerprint(pageURL, feature.Type, rule.ID)

		cases = append(cases, tc)
	}
	return cases
}

func fingerprint(pageURL string, ft models.FeatureType, ruleID string) string {
	// Use domain + path pattern (not full URL) for cross-run matching
	u := pageURL
	if idx := strings.Index(u, "?"); idx > 0 {
		u = u[:idx]
	}
	// Remove numeric IDs from path
	parts := strings.Split(u, "/")
	normalized := make([]string, 0, len(parts))
	for _, p := range parts {
		isID := true
		for _, c := range p {
			if (c < '0' || c > '9') && c != '-' {
				isID = false
				break
			}
		}
		if !isID || p == "" {
			normalized = append(normalized, p)
		} else {
			normalized = append(normalized, ":id")
		}
	}
	key := strings.Join(normalized, "/") + "|" + string(ft) + "|" + ruleID
	return fmt.Sprintf("%x", md5.Sum([]byte(key)))
}

func severityPriority(s models.Severity) int {
	switch s {
	case models.SeverityCritical:
		return 1
	case models.SeverityHigh:
		return 2
	case models.SeverityMedium:
		return 3
	default:
		return 4
	}
}

// allSchemas returns all built-in feature schemas
func allSchemas() []FeatureSchema {
	return []FeatureSchema{
		searchSchema(),
		paginationSchema(),
		filterSchema(),
		listingSchema(),
		formSchema(),
		modalSchema(),
		navigationSchema(),
		tabsSchema(),
		buttonActionsSchema(),
		fileUploadSchema(),
		datePickerSchema(),
		multiSelectSchema(),
		dataTableSchema(),
		richTextSchema(),
		infiniteScrollSchema(),
		accordionSchema(),
		stepperSchema(),
		dragDropSchema(),
		chartSchema(),
		notificationSchema(),
	}
}

func searchSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureSearch,
		Rules: []ValidationRule{
			{
				ID: "search_visible", Name: "Search input is visible", Category: "positive", Severity: models.SeverityCritical,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}", Description: "Navigate to page"},
					{Action: models.ActionAssert, Selector: "{{selector}}", AssertType: models.AssertVisible, Description: "Search input visible"},
				},
				Expected: "Search input is visible and accessible",
			},
			{
				ID: "search_triggers_results", Name: "Search filters results", Category: "positive", Severity: models.SeverityCritical,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}", Description: "Navigate to page"},
					{Action: models.ActionFill, Selector: "{{selector}}", Value: "test", Description: "Type search term"},
					{Action: models.ActionKeyPress, Value: "Enter", Description: "Submit search"},
					{Action: models.ActionWait, TimeoutMs: 2000, Description: "Wait for results"},
					{Action: models.ActionAssert, Selector: "body", AssertType: models.AssertText, Expected: "result", Description: "Results appear"},
				},
				Expected: "Typing and submitting a search term filters the content",
			},
			{
				ID: "search_empty", Name: "Empty search shows appropriate message", Category: "edge", Severity: models.SeverityMedium,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}", Description: "Navigate to page"},
					{Action: models.ActionFill, Selector: "{{selector}}", Value: "xyzzy_no_results_12345", Description: "Type non-existent term"},
					{Action: models.ActionKeyPress, Value: "Enter", Description: "Submit search"},
					{Action: models.ActionWait, TimeoutMs: 2000},
				},
				Expected: "No results message or empty state is shown",
			},
			{
				ID: "search_clear", Name: "Search can be cleared", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}", Description: "Navigate to page"},
					{Action: models.ActionFill, Selector: "{{selector}}", Value: "test"},
					{Action: models.ActionKeyPress, Value: "Enter"},
					{Action: models.ActionWait, TimeoutMs: 1000},
					{Action: models.ActionFill, Selector: "{{selector}}", Value: ""},
					{Action: models.ActionKeyPress, Value: "Enter"},
				},
				Expected: "Clearing the search restores the original list",
			},
			{
				ID: "search_special_chars", Name: "Search handles special characters", Category: "edge", Severity: models.SeverityMedium,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionFill, Selector: "{{selector}}", Value: "<script>alert(1)</script>"},
					{Action: models.ActionKeyPress, Value: "Enter"},
					{Action: models.ActionWait, TimeoutMs: 1000},
					{Action: models.ActionAssert, Selector: "body", AssertType: models.AssertText, Expected: "", Description: "No XSS executed"},
				},
				Expected: "Special characters are handled safely without breaking the UI",
			},
		},
	}
}

func paginationSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeaturePagination,
		Rules: []ValidationRule{
			{
				ID: "pagination_next", Name: "Next page navigates forward", Category: "positive", Severity: models.SeverityCritical,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: `button[aria-label="Next"], button[aria-label="next page"], .pagination-next, [data-testid="next-page"]`, Description: "Click Next"},
					{Action: models.ActionWait, TimeoutMs: 2000},
					{Action: models.ActionAssert, Selector: "body", AssertType: models.AssertVisible, Description: "Page content updated"},
				},
				Expected: "Clicking Next loads the next page of results",
			},
			{
				ID: "pagination_prev", Name: "Previous page navigates backward", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: `button[aria-label="Next"], .pagination-next`},
					{Action: models.ActionWait, TimeoutMs: 1500},
					{Action: models.ActionClick, Selector: `button[aria-label="Previous"], .pagination-prev`},
					{Action: models.ActionWait, TimeoutMs: 1500},
				},
				Expected: "Previous button returns to prior page",
			},
			{
				ID: "pagination_first_page", Name: "First page prev button disabled", Category: "boundary", Severity: models.SeverityMedium,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionAssert, Selector: `button[aria-label="Previous"]`, AssertType: models.AssertDisabled, Optional: true, Description: "Previous disabled on first page"},
				},
				Expected: "Previous button is disabled or hidden on the first page",
			},
		},
	}
}

func filterSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureFilter,
		Rules: []ValidationRule{
			{
				ID: "filter_applies", Name: "Filter applies to results", Category: "positive", Severity: models.SeverityCritical,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: "{{selector}}", Description: "Open filter"},
					{Action: models.ActionWait, TimeoutMs: 1000},
				},
				Expected: "Filter controls are accessible and apply to results",
			},
			{
				ID: "filter_clear", Name: "Filter can be cleared", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: `button[aria-label*="clear" i], button[aria-label*="reset" i], .clear-filter`, Optional: true},
					{Action: models.ActionWait, TimeoutMs: 1000},
				},
				Expected: "Filters can be cleared to restore original results",
			},
		},
	}
}

func listingSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureListing,
		Rules: []ValidationRule{
			{
				ID: "listing_visible", Name: "List items are visible", Category: "positive", Severity: models.SeverityCritical,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionAssert, Selector: "{{selector}}", AssertType: models.AssertVisible},
				},
				Expected: "List/table content is visible on page load",
			},
			{
				ID: "listing_count", Name: "List shows item count", Category: "positive", Severity: models.SeverityMedium,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionAssert, Selector: "{{selector}}", AssertType: models.AssertCount, Expected: "1"},
				},
				Expected: "At least one item is present in the list",
			},
		},
	}
}

func formSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureForm,
		Rules: []ValidationRule{
			{
				ID: "form_visible", Name: "Form is visible and accessible", Category: "positive", Severity: models.SeverityCritical,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionAssert, Selector: "form, [role='form']", AssertType: models.AssertVisible},
				},
				Expected: "Form is rendered and visible",
			},
			{
				ID: "form_required_validation", Name: "Required fields show validation on empty submit", Category: "negative", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: `form button[type="submit"], form input[type="submit"], form button:not([type="button"])`, Description: "Submit empty form"},
					{Action: models.ActionWait, TimeoutMs: 1000},
				},
				Expected: "Validation errors appear for required fields when form is submitted empty",
			},
			{
				ID: "form_valid_submit", Name: "Form submits successfully with valid data", Category: "positive", Severity: models.SeverityCritical,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionScreenshot, Description: "Capture form state before fill"},
				},
				Expected: "Form can be filled and submitted without errors",
			},
			{
				ID: "form_cancel", Name: "Form cancel/reset works", Category: "positive", Severity: models.SeverityMedium,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: `button[type="reset"], button:not([type="submit"])`, Optional: true, Description: "Click cancel or reset"},
					{Action: models.ActionWait, TimeoutMs: 500},
				},
				Expected: "Cancel or Reset clears form data or navigates away",
			},
		},
	}
}

func modalSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureModal,
		Rules: []ValidationRule{
			{
				ID: "modal_opens", Name: "Modal opens on trigger click", Category: "positive", Severity: models.SeverityCritical,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: "{{selector}}", Description: "Click modal trigger"},
					{Action: models.ActionWait, TimeoutMs: 500},
					{Action: models.ActionAssert, Selector: `[role="dialog"]`, AssertType: models.AssertVisible},
				},
				Expected: "Modal dialog opens when trigger is clicked",
			},
			{
				ID: "modal_close_x", Name: "Modal closes via X button", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: "{{selector}}"},
					{Action: models.ActionWait, TimeoutMs: 500},
					{Action: models.ActionClick, Selector: `[role="dialog"] button[aria-label*="close" i], [role="dialog"] button[aria-label*="Close" i], [role="dialog"] .close`, Description: "Click close button"},
					{Action: models.ActionWait, TimeoutMs: 500},
					{Action: models.ActionAssert, Selector: `[role="dialog"]`, AssertType: models.AssertHidden, Optional: true},
				},
				Expected: "Modal closes when X button is clicked",
			},
			{
				ID: "modal_close_escape", Name: "Modal closes on Escape key", Category: "positive", Severity: models.SeverityMedium,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: "{{selector}}"},
					{Action: models.ActionWait, TimeoutMs: 500},
					{Action: models.ActionKeyPress, Value: "Escape"},
					{Action: models.ActionWait, TimeoutMs: 500},
				},
				Expected: "Modal closes when Escape key is pressed",
			},
		},
	}
}

func navigationSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureNavigation,
		Rules: []ValidationRule{
			{
				ID: "nav_links_visible", Name: "Navigation links are visible", Category: "positive", Severity: models.SeverityCritical,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionAssert, Selector: "nav a, [role='navigation'] a", AssertType: models.AssertVisible},
				},
				Expected: "Navigation links are visible and accessible",
			},
			{
				ID: "nav_link_works", Name: "Navigation links navigate correctly", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: "nav a:first-child, [role='navigation'] a:first-child", Description: "Click first nav link"},
					{Action: models.ActionWait, TimeoutMs: 2000},
				},
				Expected: "Clicking navigation link loads the target page",
			},
		},
	}
}

func tabsSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureTabs,
		Rules: []ValidationRule{
			{
				ID: "tabs_switch", Name: "Tab click switches content", Category: "positive", Severity: models.SeverityCritical,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: `[role="tab"]:nth-child(2)`, Description: "Click second tab"},
					{Action: models.ActionWait, TimeoutMs: 500},
					{Action: models.ActionAssert, Selector: `[role="tab"]:nth-child(2)`, AssertType: models.AssertAttribute, Expected: `aria-selected="true"`},
				},
				Expected: "Clicking a tab selects it and shows the tab content",
			},
			{
				ID: "tabs_keyboard", Name: "Tabs support keyboard navigation", Category: "positive", Severity: models.SeverityMedium,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: `[role="tab"]:first-child`},
					{Action: models.ActionKeyPress, Value: "ArrowRight", Description: "Navigate with arrow key"},
					{Action: models.ActionWait, TimeoutMs: 300},
				},
				Expected: "Arrow keys navigate between tabs",
			},
		},
	}
}

func buttonActionsSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureButtonAction,
		Rules: []ValidationRule{
			{
				ID: "button_primary_clickable", Name: "Primary action button is clickable", Category: "positive", Severity: models.SeverityCritical,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionAssert, Selector: "{{selector}}", AssertType: models.AssertEnabled},
					{Action: models.ActionClick, Selector: "{{selector}}"},
					{Action: models.ActionWait, TimeoutMs: 1000},
				},
				Expected: "Primary button is enabled and responds to click",
			},
		},
	}
}

func fileUploadSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureFileUpload,
		Rules: []ValidationRule{
			{
				ID: "file_upload_visible", Name: "File upload control is visible", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionAssert, Selector: `input[type="file"], .dropzone`, AssertType: models.AssertVisible},
				},
				Expected: "File upload input is visible and accessible",
			},
		},
	}
}

func datePickerSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureDatePicker,
		Rules: []ValidationRule{
			{
				ID: "datepicker_opens", Name: "Date picker opens on click", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: "{{selector}}", Description: "Click date input"},
					{Action: models.ActionWait, TimeoutMs: 500},
				},
				Expected: "Date picker calendar opens when input is clicked",
			},
		},
	}
}

func multiSelectSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureMultiSelect,
		Rules: []ValidationRule{
			{
				ID: "multiselect_select_option", Name: "Multiple options can be selected", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: "{{selector}}", Description: "Open multi-select"},
					{Action: models.ActionWait, TimeoutMs: 500},
				},
				Expected: "Multiple options can be selected in the multi-select control",
			},
		},
	}
}

func dataTableSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureDataTable,
		Rules: []ValidationRule{
			{
				ID: "datatable_visible", Name: "Data table is visible with headers", Category: "positive", Severity: models.SeverityCritical,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionAssert, Selector: "{{selector}}", AssertType: models.AssertVisible},
				},
				Expected: "Data table renders with column headers",
			},
			{
				ID: "datatable_sort", Name: "Column header click sorts table", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: "th:first-child, [role='columnheader']:first-child", Description: "Click first column header"},
					{Action: models.ActionWait, TimeoutMs: 1000},
				},
				Expected: "Clicking a sortable column header sorts the table data",
			},
		},
	}
}

func richTextSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureRichText,
		Rules: []ValidationRule{
			{
				ID: "richtext_editable", Name: "Rich text editor accepts input", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: "{{selector}}", Description: "Focus editor"},
					{Action: models.ActionFill, Selector: "{{selector}}", Value: "Test content for rich text editor"},
					{Action: models.ActionAssert, Selector: "{{selector}}", AssertType: models.AssertText, Expected: "Test content"},
				},
				Expected: "Rich text editor accepts and displays typed content",
			},
		},
	}
}

func infiniteScrollSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureInfScroll,
		Rules: []ValidationRule{
			{
				ID: "infscroll_loads_more", Name: "Scrolling loads more content", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionScroll, Value: "bottom", Description: "Scroll to bottom"},
					{Action: models.ActionWait, TimeoutMs: 2000, Description: "Wait for new content"},
				},
				Expected: "Scrolling to the bottom triggers loading of additional items",
			},
		},
	}
}

func accordionSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureAccordion,
		Rules: []ValidationRule{
			{
				ID: "accordion_expand", Name: "Accordion item expands on click", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: "{{selector}} button, details summary", Description: "Click accordion header"},
					{Action: models.ActionWait, TimeoutMs: 500},
				},
				Expected: "Accordion section expands to reveal content",
			},
			{
				ID: "accordion_collapse", Name: "Accordion item collapses on re-click", Category: "positive", Severity: models.SeverityMedium,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: "{{selector}} button, details summary"},
					{Action: models.ActionWait, TimeoutMs: 300},
					{Action: models.ActionClick, Selector: "{{selector}} button, details summary", Description: "Click again to collapse"},
					{Action: models.ActionWait, TimeoutMs: 300},
				},
				Expected: "Clicking an expanded accordion item collapses it",
			},
		},
	}
}

func stepperSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureStepper,
		Rules: []ValidationRule{
			{
				ID: "stepper_next", Name: "Stepper Next button advances step", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: `button[aria-label*="next" i], button:contains("Next"), .stepper-next`, Description: "Click Next step"},
					{Action: models.ActionWait, TimeoutMs: 500},
				},
				Expected: "Clicking Next advances to the next step",
			},
			{
				ID: "stepper_prev", Name: "Stepper Back button goes to previous step", Category: "positive", Severity: models.SeverityMedium,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: `button[aria-label*="next" i], .stepper-next`},
					{Action: models.ActionWait, TimeoutMs: 300},
					{Action: models.ActionClick, Selector: `button[aria-label*="back" i], button[aria-label*="prev" i], .stepper-back`},
					{Action: models.ActionWait, TimeoutMs: 300},
				},
				Expected: "Back button returns to the previous step",
			},
		},
	}
}

func dragDropSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureDragDrop,
		Rules: []ValidationRule{
			{
				ID: "dragdrop_draggable", Name: "Draggable items are marked draggable", Category: "positive", Severity: models.SeverityMedium,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionAssert, Selector: `[draggable="true"]`, AssertType: models.AssertVisible},
				},
				Expected: "Draggable items are present and accessible",
			},
		},
	}
}

func chartSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureChart,
		Rules: []ValidationRule{
			{
				ID: "chart_renders", Name: "Chart renders on page load", Category: "positive", Severity: models.SeverityHigh,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionWait, TimeoutMs: 2000, Description: "Wait for chart to load"},
					{Action: models.ActionAssert, Selector: "{{selector}}", AssertType: models.AssertVisible},
				},
				Expected: "Chart is rendered and visible after page load",
			},
		},
	}
}

func notificationSchema() FeatureSchema {
	return FeatureSchema{
		FeatureType: models.FeatureNotification,
		Rules: []ValidationRule{
			{
				ID: "notification_dismissible", Name: "Notification can be dismissed", Category: "positive", Severity: models.SeverityMedium,
				Steps: []models.TestStep{
					{Action: models.ActionNavigate, Value: "{{page_url}}"},
					{Action: models.ActionClick, Selector: `[role="alert"] button, .toast button, .notification .close`, Optional: true, Description: "Click dismiss"},
					{Action: models.ActionWait, TimeoutMs: 500},
				},
				Expected: "Notification can be manually dismissed",
			},
		},
	}
}

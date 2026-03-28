package models

import "time"

// FeatureType represents a type of UI feature
type FeatureType string

const (
	FeatureSearch       FeatureType = "search"
	FeaturePagination   FeatureType = "pagination"
	FeatureFilter       FeatureType = "filter"
	FeatureListing      FeatureType = "listing"
	FeatureForm         FeatureType = "form"
	FeatureModal        FeatureType = "modal"
	FeatureNavigation   FeatureType = "navigation"
	FeatureTabs         FeatureType = "tabs"
	FeatureButtonAction FeatureType = "button_actions"
	FeatureFileUpload   FeatureType = "file_upload"
	FeatureDatePicker   FeatureType = "date_picker"
	FeatureMultiSelect  FeatureType = "multi_select"
	FeatureDataTable    FeatureType = "data_table"
	FeatureRichText     FeatureType = "rich_text"
	FeatureInfScroll    FeatureType = "infinite_scroll"
	FeatureAccordion    FeatureType = "accordion"
	FeatureStepper      FeatureType = "stepper"
	FeatureDragDrop     FeatureType = "drag_drop"
	FeatureChart        FeatureType = "chart"
	FeatureNotification FeatureType = "notification"
)

// Severity of a test case
type Severity string

const (
	SeverityCritical Severity = "critical"
	SeverityHigh     Severity = "high"
	SeverityMedium   Severity = "medium"
	SeverityLow      Severity = "low"
)

// TestStatus represents execution status
type TestStatus string

const (
	TestStatusPending TestStatus = "pending"
	TestStatusRunning TestStatus = "running"
	TestStatusPassed  TestStatus = "passed"
	TestStatusFailed  TestStatus = "failed"
	TestStatusSkipped TestStatus = "skipped"
)

// StepAction is the action type for a test step
type StepAction string

const (
	ActionNavigate   StepAction = "navigate"
	ActionClick      StepAction = "click"
	ActionFill       StepAction = "fill"
	ActionSelect     StepAction = "select"
	ActionAssert     StepAction = "assert"
	ActionWait       StepAction = "wait"
	ActionScroll     StepAction = "scroll"
	ActionHover      StepAction = "hover"
	ActionKeyPress   StepAction = "key_press"
	ActionUpload     StepAction = "upload"
	ActionScreenshot StepAction = "screenshot"
)

// SelectorStrategy describes how to find an element
type SelectorStrategy string

const (
	StrategyCSS    SelectorStrategy = "css"
	StrategyXPath  SelectorStrategy = "xpath"
	StrategyText   SelectorStrategy = "text"
	StrategyAria   SelectorStrategy = "aria"
	StrategyRole   SelectorStrategy = "role"
	StrategyTestID SelectorStrategy = "testid"
)

// AssertType describes what to assert
type AssertType string

const (
	AssertVisible   AssertType = "visible"
	AssertHidden    AssertType = "hidden"
	AssertText      AssertType = "text"
	AssertValue     AssertType = "value"
	AssertEnabled   AssertType = "enabled"
	AssertDisabled  AssertType = "disabled"
	AssertURL       AssertType = "url"
	AssertCount     AssertType = "count"
	AssertAttribute AssertType = "attribute"
)

// TestStep is a single step in a test case
type TestStep struct {
	Action           StepAction       `json:"action"`
	Selector         string           `json:"selector,omitempty"`
	SelectorStrategy SelectorStrategy `json:"selector_strategy,omitempty"`
	Value            string           `json:"value,omitempty"`
	Expected         string           `json:"expected,omitempty"`
	AssertType       AssertType       `json:"assert_type,omitempty"`
	TimeoutMs        int              `json:"timeout_ms,omitempty"`
	RetryCount       int              `json:"retry_count,omitempty"`
	Optional         bool             `json:"optional,omitempty"`
	Description      string           `json:"description,omitempty"`
}

// TestCase is a single executable test
type TestCase struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	FeatureType FeatureType `json:"feature_type"`
	Category    string      `json:"category"`
	Severity    Severity    `json:"severity"`
	Priority    int         `json:"priority"`
	Tags        []string    `json:"tags,omitempty"`
	PageURL     string      `json:"page_url"`

	Steps          []TestStep        `json:"steps"`
	Preconditions  []string          `json:"preconditions,omitempty"`
	Postconditions []string          `json:"postconditions,omitempty"`
	TestData       map[string]string `json:"test_data,omitempty"`
	ExpectedResult string            `json:"expected_result"`

	ValidationRuleID string `json:"validation_rule_id,omitempty"`

	// Quality and benchmarking
	QualityScore int    `json:"quality_score"`
	Fingerprint  string `json:"fingerprint,omitempty"`

	// Source tracking
	GeneratedBy  string  `json:"generated_by"` // rules, ai, hybrid
	AIConfidence float64 `json:"ai_confidence,omitempty"`

	// Execution results
	Status          TestStatus `json:"status"`
	ErrorMessage    string     `json:"error_message,omitempty"`
	ScreenshotPath  string     `json:"screenshot_path,omitempty"`
	ExecutionTimeMs int64      `json:"execution_time_ms,omitempty"`
	ExecutedAt      *time.Time `json:"executed_at,omitempty"`
}

// TestPlan is a collection of test cases for a run
type TestPlan struct {
	RunID     string     `json:"run_id"`
	Intent    string     `json:"intent"`
	TestCases []TestCase `json:"test_cases"`
	CreatedAt time.Time  `json:"created_at"`
}

// TestSuite holds aggregate execution results
type TestSuite struct {
	RunID       string     `json:"run_id"`
	Total       int        `json:"total"`
	Passed      int        `json:"passed"`
	Failed      int        `json:"failed"`
	Skipped     int        `json:"skipped"`
	DurationMs  int64      `json:"duration_ms"`
	TestCases   []TestCase `json:"test_cases"`
	CompletedAt time.Time  `json:"completed_at"`
}

// CoverageReport holds coverage data by feature
type CoverageReport struct {
	OverallPercent    float64                    `json:"overall_percent"`
	ByFeature         map[FeatureType]float64    `json:"by_feature"`
	Recommendations   []string                   `json:"recommendations"`
}

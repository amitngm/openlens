package models

import "time"

// RunState represents the current state of a QA run
type RunState string

const (
	StateStart             RunState = "START"
	StateOpenURL           RunState = "OPEN_URL"
	StateSessionCheck      RunState = "SESSION_CHECK"
	StateLoginDetect       RunState = "LOGIN_DETECT"
	StateWaitLoginInput    RunState = "WAIT_LOGIN_INPUT"
	StateLoginAttempt      RunState = "LOGIN_ATTEMPT"
	StatePostLoginValidate RunState = "POST_LOGIN_VALIDATE"
	StateContextDetect     RunState = "CONTEXT_DETECT"
	StateDiscoveryRun      RunState = "DISCOVERY_RUN"
	StateDiscoverySummary  RunState = "DISCOVERY_SUMMARY"
	StateWaitTestIntent    RunState = "WAIT_TEST_INTENT"
	StateTestPlanBuild     RunState = "TEST_PLAN_BUILD"
	StateTestExecute       RunState = "TEST_EXECUTE"
	StateReportGenerate    RunState = "REPORT_GENERATE"
	StateDone              RunState = "DONE"
	StateFailed            RunState = "FAILED"
	StateCancelled         RunState = "CANCELLED"
	StateStuckDetected     RunState = "STUCK_DETECTED"
	StateWaitBuddyGuidance RunState = "WAIT_BUDDY_GUIDANCE"
)

// AppType hints for tailored test generation
type AppType string

const (
	AppTypeAuto       AppType = "auto"
	AppTypeWebApp     AppType = "web_app"
	AppTypeECommerce  AppType = "e_commerce"
	AppTypeAdminPanel AppType = "admin_panel"
	AppTypeSaaS       AppType = "saas_dashboard"
	AppTypeCMS        AppType = "cms"
	AppTypeCRM        AppType = "crm"
	AppTypeDevTools   AppType = "dev_tools"
)

// DiscoveryScopeMode controls what gets discovered
type DiscoveryScopeMode string

const (
	ScopeFull       DiscoveryScopeMode = "full"
	ScopeModule     DiscoveryScopeMode = "module"
	ScopeScenario   DiscoveryScopeMode = "scenario"
	ScopeURLPattern DiscoveryScopeMode = "url_pattern"
)

// DiscoveryScope defines the discovery target
type DiscoveryScope struct {
	Mode     DiscoveryScopeMode `json:"mode"`
	Targets  []string           `json:"targets,omitempty"`
	MaxPages int                `json:"max_pages,omitempty"`
	Depth    int                `json:"depth,omitempty"`
}

// AuthConfig holds authentication credentials
type AuthConfig struct {
	Username string `json:"username"`
	Password string `json:"password"`
	AuthType string `json:"auth_type,omitempty"` // basic, keycloak, oauth
}

// AIMode controls how AI is used
type AIMode string

const (
	AIModeRules  AIMode = "rules"
	AIModeAI     AIMode = "ai"
	AIModeHybrid AIMode = "hybrid"
)

// AIConfig holds AI provider configuration
type AIConfig struct {
	Enabled   bool   `json:"enabled"`
	Mode      AIMode `json:"mode"`
	Provider  string `json:"provider"` // ollama, openai, none
	ModelName string `json:"model_name,omitempty"`
	APIKey    string `json:"api_key,omitempty"`
	MaxSteps  int    `json:"max_steps,omitempty"`
}

// EnabledOps controls which CRUD operations are allowed
type EnabledOps struct {
	Read   bool `json:"read"`
	Create bool `json:"create"`
	Update bool `json:"update"`
	Delete bool `json:"delete"`
}

// RunContext is the main run state object
type RunContext struct {
	RunID     string   `json:"run_id"`
	BaseURL   string   `json:"base_url"`
	CurrentURL string  `json:"current_url,omitempty"`
	State     RunState `json:"state"`
	PrevState RunState `json:"prev_state,omitempty"` // saved before STUCK
	AppType   AppType  `json:"app_type"`

	Auth           *AuthConfig    `json:"auth,omitempty"`
	AI             AIConfig       `json:"ai"`
	DiscoveryScope DiscoveryScope `json:"discovery_scope"`
	EnabledOps     EnabledOps     `json:"enabled_ops"`

	Headless      bool `json:"headless"`
	AutoMode      bool `json:"auto_mode"`      // skip all WAIT_* states
	AutoSelectCtx bool `json:"auto_select_ctx"` // auto-select first context

	// Interactive prompt data
	Question        string   `json:"question,omitempty"`
	QuestionType    string   `json:"question_type,omitempty"` // login, intent, context, buddy, stuck
	QuestionHints   []string `json:"question_hints,omitempty"`
	StuckScreenshot string   `json:"stuck_screenshot,omitempty"` // base64 PNG
	StuckReason     string   `json:"stuck_reason,omitempty"`

	// Progress tracking
	Progress    int    `json:"progress"`
	LastStep    string `json:"last_step,omitempty"`
	BuddyMsg    string `json:"buddy_message,omitempty"`
	ErrorMessage string `json:"error_message,omitempty"`

	// Discovery results
	DiscoveredPages   int      `json:"discovered_pages"`
	DiscoveredModules []string `json:"discovered_modules,omitempty"`

	// Test results
	TestCaseCount   int     `json:"test_case_count"`
	PassCount       int     `json:"pass_count"`
	FailCount       int     `json:"fail_count"`
	SkipCount       int     `json:"skip_count"`
	CoveragePercent float64 `json:"coverage_percent"`
	ReportPath      string  `json:"report_path,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// StartRunRequest is the API request to start a QA run
type StartRunRequest struct {
	BaseURL        string          `json:"base_url" binding:"required"`
	Auth           *AuthConfig     `json:"auth,omitempty"`
	AppType        AppType         `json:"app_type,omitempty"`
	Headless       bool            `json:"headless"`
	AutoMode       bool            `json:"auto_mode"`
	AI             *AIConfig       `json:"ai,omitempty"`
	DiscoveryScope *DiscoveryScope `json:"discovery_scope,omitempty"`
	EnabledOps     *EnabledOps     `json:"enabled_ops,omitempty"`
}

// AnswerRequest is used to submit answers to interactive questions
type AnswerRequest struct {
	Answer string            `json:"answer"`
	Data   map[string]string `json:"data,omitempty"`
}

// BuddyMessage is sent to Ask Buddy chat
type BuddyMessage struct {
	Message string `json:"message" binding:"required"`
}

// BuddyResponse is the response from Ask Buddy
type BuddyResponse struct {
	Message string   `json:"message"`
	Actions []string `json:"actions,omitempty"`
	State   RunState `json:"state,omitempty"`
}

// BenchmarkUpdateRequest approves or discards a test case
type BenchmarkUpdateRequest struct {
	TestCaseID string `json:"test_case_id" binding:"required"`
	Status     string `json:"status" binding:"required"` // approved, discarded
	Reason     string `json:"reason,omitempty"`
}

// RunListItem is a summary used in list views
type RunListItem struct {
	RunID     string    `json:"run_id"`
	BaseURL   string    `json:"base_url"`
	State     RunState  `json:"state"`
	Progress  int       `json:"progress"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

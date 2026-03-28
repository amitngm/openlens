package engine

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
	"github.com/qabuddy/agent/internal/ai"
	"github.com/qabuddy/agent/internal/browser"
	"github.com/qabuddy/agent/internal/config"
	"github.com/qabuddy/agent/internal/database"
	"github.com/qabuddy/agent/internal/discovery"
	"github.com/qabuddy/agent/internal/models"
	"github.com/qabuddy/agent/internal/report"
	"github.com/qabuddy/agent/internal/rules"
	"github.com/qabuddy/agent/internal/store"
	qa_testing "github.com/qabuddy/agent/internal/testing"
	"github.com/rs/zerolog/log"
)

// Runner orchestrates a complete QA run
type Runner struct {
	runStore *store.RunStore
	browsers *browser.Manager
	sm       *StateMachine
	answers  *AnswerChan
	registry *rules.Registry
	scorer   *qa_testing.QualityScorer
	aiProv   ai.Provider
	db       *database.DB
	cfg      *config.Config
	reportGen *report.Generator
	cancelFns map[string]context.CancelFunc
}

// NewRunner creates a new Runner
func NewRunner(
	s *store.RunStore,
	bm *browser.Manager,
	answers *AnswerChan,
	registry *rules.Registry,
	aiProv ai.Provider,
	db *database.DB,
	cfg *config.Config,
) *Runner {
	return &Runner{
		runStore:  s,
		browsers:  bm,
		sm:        NewStateMachine(s, db),
		answers:   answers,
		registry:  registry,
		scorer:    qa_testing.NewQualityScorer(),
		aiProv:    aiProv,
		db:        db,
		cfg:       cfg,
		reportGen: report.NewGenerator(cfg.ArtifactsDir),
		cancelFns: make(map[string]context.CancelFunc),
	}
}

// Start launches a run in a background goroutine
func (r *Runner) Start(runID string) {
	ctx, cancel := context.WithCancel(context.Background())
	r.cancelFns[runID] = cancel
	go func() {
		defer cancel()
		if err := r.run(ctx, runID); err != nil {
			log.Error().Err(err).Str("run_id", runID).Msg("run failed")
			if rc, ok := r.runStore.Get(runID); ok {
				rc.ErrorMessage = err.Error()
				r.runStore.Update(rc)
			}
			r.sm.Transition(runID, models.StateFailed, "Run failed: "+err.Error())
		}
	}()
}

// Cancel stops a running run
func (r *Runner) Cancel(runID string) {
	if cancel, ok := r.cancelFns[runID]; ok {
		cancel()
		delete(r.cancelFns, runID)
	}
	r.sm.Transition(runID, models.StateCancelled, "Run cancelled by user")
	r.browsers.CloseContext(runID)
}

// SendAnswer delivers a user answer to a waiting run
func (r *Runner) SendAnswer(runID string, answer models.AnswerRequest) error {
	return r.answers.Send(runID, answer)
}

// run is the main orchestration goroutine
func (r *Runner) run(ctx context.Context, runID string) error {
	rc, ok := r.runStore.Get(runID)
	if !ok {
		return fmt.Errorf("run %s not found", runID)
	}

	// Create browser context
	bCtx, err := r.browsers.CreateContext(runID, rc.Headless)
	if err != nil {
		return fmt.Errorf("create browser: %w", err)
	}
	defer r.browsers.CloseContext(runID)

	page := bCtx.Page
	stuckDet := NewStuckDetector(nil, r.cfg.StuckTimeoutSec)

	// Create buddy for this run
	buddy := ai.NewBuddy(r.aiProv, page, runID, r.runStore, r.db, r.cfg)
	stuckDet.buddy = buddy

	r.answers.Register(runID)
	defer r.answers.Close(runID)

	// --- OPEN_URL ---
	r.sm.Transition(runID, models.StateOpenURL, "Opening "+rc.BaseURL+"...")
	r.publishLog(runID, "Navigating to "+rc.BaseURL)

	if _, err := page.Goto(rc.BaseURL, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(30000),
	}); err != nil {
		// Check if stuck
		if err2 := r.handleStuck(ctx, runID, page, stuckDet, buddy, "Could not load "+rc.BaseURL+": "+err.Error()); err2 != nil {
			return err
		}
	}

	// Auto-dismiss any immediate blockers
	buddy.AutoDismissBlocker(ctx)
	time.Sleep(500 * time.Millisecond)

	// Update current URL
	if rc, ok = r.runStore.Get(runID); ok {
		rc.CurrentURL = page.URL()
		r.runStore.Update(rc)
	}

	// --- SESSION_CHECK ---
	r.sm.Transition(runID, models.StateSessionCheck, "Checking if already logged in...")
	loggedIn := r.checkAlreadyLoggedIn(page)

	if !loggedIn {
		// --- LOGIN_DETECT ---
		r.sm.Transition(runID, models.StateLoginDetect, "Checking for login form...")
		hasLogin := r.detectLoginForm(page)

		if hasLogin {
			// Get credentials
			var username, password string
			if rc.Auth != nil && rc.Auth.Username != "" {
				username, password = rc.Auth.Username, rc.Auth.Password
			} else {
				// Always ask for credentials when login is detected — even in auto mode
				r.sm.Transition(runID, models.StateWaitLoginInput, "I found a login form. Please provide credentials or type 'skip' to continue without login.")
				r.sm.SetQuestion(runID, "I found a login form. Please enter credentials or skip.", "login",
					[]string{"Skip login", "Test without login"})

				answer, err := r.answers.Wait(runID, 15*time.Minute)
				if err != nil {
					r.sm.Transition(runID, models.StateDiscoveryRun, "Proceeding without login...")
					goto discovery
				}
				if answer.Data != nil {
					username = answer.Data["username"]
					password = answer.Data["password"]
				} else if answer.Answer == "skip" || strings.Contains(strings.ToLower(answer.Answer), "skip") {
					goto discovery
				} else if strings.Contains(answer.Answer, ":") {
					// "username:password" shorthand
					parts := strings.SplitN(answer.Answer, ":", 2)
					username, password = strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
				}
			}

			if username != "" {
				// --- LOGIN_ATTEMPT ---
				r.sm.Transition(runID, models.StateLoginAttempt, "Attempting login...")
				if err := r.attemptLogin(ctx, page, username, password); err != nil {
					log.Warn().Err(err).Msg("login failed")
					r.sm.Transition(runID, models.StateWaitLoginInput, "Login failed. Please check credentials.")
					// Try once more or skip
				}
				buddy.AutoDismissBlocker(ctx)
				time.Sleep(1 * time.Second)

				// --- POST_LOGIN_VALIDATE ---
				r.sm.Transition(runID, models.StatePostLoginValidate, "Validating login success...")
				if !r.validateLoginSuccess(page) {
					log.Warn().Msg("login validation failed")
				}
			}
		}
	}

discovery:
	// --- CONTEXT_DETECT ---
	r.sm.Transition(runID, models.StateContextDetect, "Detecting application context...")
	buddy.AutoDismissBlocker(ctx)

	// --- DISCOVERY_RUN ---
	r.sm.Transition(runID, models.StateDiscoveryRun, "Discovering all pages and features...")

	rc, _ = r.runStore.Get(runID)
	collector := &ruleCollector{registry: r.registry, scorer: r.scorer}
	crawler, err := discovery.NewCrawler(page, runID, rc.BaseURL, rc.DiscoveryScope, r.runStore, r.cfg, collector)
	if err != nil {
		return fmt.Errorf("create crawler: %w", err)
	}

	discoveryResult, err := crawler.Crawl(ctx)
	if err != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	r.runStore.SetDiscovery(runID, discoveryResult)

	// Update run with discovery stats
	if rc, ok = r.runStore.Get(runID); ok {
		rc.DiscoveredPages = len(discoveryResult.Pages)
		rc.DiscoveredModules = discoveryResult.Modules
		r.runStore.Update(rc)
	}

	// --- DISCOVERY_SUMMARY ---
	r.sm.Transition(runID, models.StateDiscoverySummary, fmt.Sprintf("Found %d pages, %d modules, %d test cases",
		len(discoveryResult.Pages), len(discoveryResult.Modules), len(discoveryResult.TestCases)))

	// --- WAIT_TEST_INTENT ---
	intent := qa_testing.IntentExploratory
	customText := ""

	if !rc.AutoMode {
		r.sm.Transition(runID, models.StateWaitTestIntent, "What kind of tests should I run?")
		r.sm.SetQuestion(runID, "Discovery complete! What testing strategy should I use?", "intent",
			[]string{"Smoke tests", "All forms", "CRUD operations", "Full exploratory", "Custom"})

		answer, err := r.answers.Wait(runID, 15*time.Minute)
		if err == nil {
			intent = qa_testing.ParseIntent(answer.Answer)
			customText = answer.Answer
		}
	}

	// --- TEST_PLAN_BUILD ---
	r.sm.Transition(runID, models.StateTestPlanBuild, "Building test plan...")

	// Load benchmarks
	benchmarks := r.loadBenchmarks()

	planBuilder := qa_testing.NewPlanBuilder(r.scorer)
	plan, err := planBuilder.Build(runID, discoveryResult, intent, customText, benchmarks, false, r.cfg.MaxTestsPerRun)
	if err != nil {
		return fmt.Errorf("build test plan: %w", err)
	}
	r.runStore.SetTestPlan(runID, plan)

	if rc, ok = r.runStore.Get(runID); ok {
		rc.TestCaseCount = len(plan.TestCases)
		r.runStore.Update(rc)
	}

	// --- TEST_EXECUTE ---
	r.sm.Transition(runID, models.StateTestExecute, fmt.Sprintf("Executing %d test cases...", len(plan.TestCases)))

	executor := qa_testing.NewExecutor(page, runID, r.runStore, r.cfg.ArtifactsDir, r.cfg)
	suite, err := executor.Execute(ctx, plan)
	if err != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	r.runStore.SetTestSuite(runID, suite)

	if rc, ok = r.runStore.Get(runID); ok {
		rc.PassCount = suite.Passed
		rc.FailCount = suite.Failed
		rc.SkipCount = suite.Skipped
		rc.CoveragePercent = calculateCoverage(suite)
		r.runStore.Update(rc)
	}

	// Save benchmarks
	r.saveBenchmarks(runID, suite)

	// --- REPORT_GENERATE ---
	r.sm.Transition(runID, models.StateReportGenerate, "Generating report...")

	rc, _ = r.runStore.Get(runID)
	disc, _ := r.runStore.GetDiscovery(runID)
	reportPath, err := r.reportGen.Generate(rc, suite, disc)
	if err != nil {
		log.Warn().Err(err).Msg("report generation failed")
	} else {
		if rc, ok = r.runStore.Get(runID); ok {
			rc.ReportPath = reportPath
			r.runStore.Update(rc)
		}
	}

	// --- DONE ---
	r.sm.Transition(runID, models.StateDone, fmt.Sprintf("Done! %d/%d tests passed (%.0f%% coverage)",
		suite.Passed, suite.Total, rc.CoveragePercent))

	r.runStore.Publish(models.NewEvent(runID, models.EventDone, map[string]interface{}{
		"passed":   suite.Passed,
		"failed":   suite.Failed,
		"total":    suite.Total,
		"coverage": rc.CoveragePercent,
	}))

	return nil
}

func (r *Runner) checkAlreadyLoggedIn(page playwright.Page) bool {
	script := `() => {
		// Look for logout button or user avatar — signs of being logged in
		return !!(document.querySelector('[href*="logout"]') ||
			document.querySelector('[href*="signout"]') ||
			document.querySelector('[aria-label*="logout" i]') ||
			document.querySelector('[data-testid*="user-menu"]') ||
			document.querySelector('.user-avatar') ||
			document.querySelector('.user-menu'));
	}`
	res, _ := page.Evaluate(script)
	b, _ := res.(bool)
	return b
}

func (r *Runner) detectLoginForm(page playwright.Page) bool {
	script := `() => {
		return !!(document.querySelector('input[type="password"]') ||
			document.querySelector('input[name="password"]') ||
			document.querySelector('form[action*="login"]') ||
			document.querySelector('form[action*="signin"]') ||
			document.querySelector('[data-testid*="login"]'));
	}`
	res, _ := page.Evaluate(script)
	b, _ := res.(bool)
	return b
}

func (r *Runner) attemptLogin(ctx context.Context, page playwright.Page, username, password string) error {
	// Find and fill username
	userSelectors := []string{
		`input[type="email"]`, `input[name="email"]`,
		`input[name="username"]`, `input[id="username"]`,
		`input[placeholder*="email" i]`, `input[placeholder*="username" i]`,
		`input[type="text"]:first-of-type`,
	}
	for _, sel := range userSelectors {
		loc := page.Locator(sel).First()
		if visible, _ := loc.IsVisible(); visible {
			loc.Fill(username)
			break
		}
	}

	// Find and fill password
	passSelectors := []string{
		`input[type="password"]`,
		`input[name="password"]`,
		`input[id="password"]`,
	}
	for _, sel := range passSelectors {
		loc := page.Locator(sel).First()
		if visible, _ := loc.IsVisible(); visible {
			loc.Fill(password)
			break
		}
	}

	// Natural delay before submit
	time.Sleep(300 * time.Millisecond)

	// Submit the form
	submitSelectors := []string{
		`button[type="submit"]`, `input[type="submit"]`,
		`button:has-text("Login")`, `button:has-text("Sign in")`,
		`button:has-text("Sign In")`, `button:has-text("Log in")`,
	}
	for _, sel := range submitSelectors {
		loc := page.Locator(sel).First()
		if visible, _ := loc.IsVisible(); visible {
			loc.Click()
			break
		}
	}

	// Wait for navigation
	page.WaitForLoadState(playwright.PageWaitForLoadStateOptions{
		State:   playwright.LoadStateDomcontentloaded,
		Timeout: playwright.Float(10000),
	})

	return nil
}

func (r *Runner) validateLoginSuccess(page playwright.Page) bool {
	currentURL := page.URL()
	// If redirected away from login page, assume success
	if !strings.Contains(strings.ToLower(currentURL), "login") &&
		!strings.Contains(strings.ToLower(currentURL), "signin") {
		return true
	}
	// Check for error message
	script := `() => {
		const errEl = document.querySelector('.error, .alert-danger, [role="alert"]');
		return errEl ? errEl.textContent.trim() : null;
	}`
	res, _ := page.Evaluate(script)
	if msg, ok := res.(string); ok && msg != "" {
		log.Warn().Str("error", msg).Msg("login error message detected")
		return false
	}
	return true
}

func (r *Runner) handleStuck(ctx context.Context, runID string, page playwright.Page, stuckDet *StuckDetector, buddy *ai.Buddy, reason string) error {
	screenshot := takeScreenshotBase64(page)
	hints := stuckDet.generateHints(page)

	r.sm.SetStuck(runID, reason, screenshot, hints)
	r.sm.Transition(runID, models.StateWaitBuddyGuidance, "I'm stuck! "+reason)

	// Wait for user guidance via buddy
	answer, err := r.answers.Wait(runID, 10*time.Minute)
	if err != nil {
		return fmt.Errorf("stuck recovery timeout: %w", err)
	}

	// Execute the user's guidance
	if err := buddy.HandleStuck(ctx, reason, answer.Answer); err != nil {
		return err
	}

	// Restore previous state
	if rc, ok := r.runStore.Get(runID); ok {
		prevState := rc.PrevState
		if prevState == "" {
			prevState = models.StateOpenURL
		}
		r.sm.Transition(runID, prevState, "Resuming after stuck recovery...")
	}
	return nil
}

func (r *Runner) loadBenchmarks() map[string]models.BenchmarkStatus {
	if r.db == nil {
		return nil
	}
	records, err := r.db.ListBenchmarks("")
	if err != nil {
		return nil
	}
	result := make(map[string]models.BenchmarkStatus, len(records))
	for _, b := range records {
		result[b.Fingerprint] = b.Status
	}
	return result
}

func (r *Runner) saveBenchmarks(runID string, suite *models.TestSuite) {
	if r.db == nil {
		return
	}
	for _, tc := range suite.TestCases {
		if tc.Fingerprint == "" {
			continue
		}
		existing, _ := r.db.GetBenchmark(tc.Fingerprint)
		if existing != nil {
			existing.RunCount++
			if tc.Status == models.TestStatusPassed {
				existing.PassCount++
			} else if tc.Status == models.TestStatusFailed {
				existing.FailCount++
			}
			r.db.SaveBenchmark(existing)
		} else {
			b := &models.TestBenchmark{
				Fingerprint:    tc.Fingerprint,
				Name:           tc.Name,
				FeatureType:    string(tc.FeatureType),
				PageURLPattern: tc.PageURL,
				Status:         models.BenchmarkPending,
				RunCount:       1,
			}
			if tc.Status == models.TestStatusPassed {
				b.PassCount = 1
			} else if tc.Status == models.TestStatusFailed {
				b.FailCount = 1
			}
			r.db.SaveBenchmark(b)
		}
	}
}

func (r *Runner) publishLog(runID, msg string) {
	r.runStore.Publish(models.NewEvent(runID, models.EventLog, models.LogData{Level: "info", Message: msg}))
}

func calculateCoverage(suite *models.TestSuite) float64 {
	if suite.Total == 0 {
		return 0
	}
	return float64(suite.Passed) / float64(suite.Total) * 100
}

// ruleCollector implements discovery.TestCaseCollector using the rules registry
type ruleCollector struct {
	registry *rules.Registry
	scorer   *qa_testing.QualityScorer
}

func (c *ruleCollector) CollectFromPage(pageURL string, features []discovery.DetectedFeature, forms []store.PageForm, tables []store.PageTable) []models.TestCase {
	var allCases []models.TestCase
	for _, feature := range features {
		cases := c.registry.GenerateTestCases(feature, pageURL)
		for i := range cases {
			cases[i].QualityScore = c.scorer.Score(cases[i])
			cases[i].Fingerprint = c.scorer.Fingerprint(cases[i])
		}
		allCases = append(allCases, cases...)
	}
	return allCases
}

package engine

import (
	"context"
	"fmt"
	"strings"
	"sync"
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

// LoginInfo describes what login-related elements were found on the current page.
type LoginInfo struct {
	HasForm   bool   // password input (or login form) present on current page
	HasButton bool   // a login link/button found — needs to be clicked first
	ButtonSel string // CSS selector to click
	LoginURL  string // href of the login link, if available
	PageDesc  string // human-readable summary of what was found
}

// Runner orchestrates a complete QA run
type Runner struct {
	runStore  *store.RunStore
	browsers  *browser.Manager
	sm        *StateMachine
	answers   *AnswerChan
	registry  *rules.Registry
	scorer    *qa_testing.QualityScorer
	aiProv    ai.Provider // global fallback provider
	db        *database.DB
	cfg       *config.Config
	reportGen *report.Generator
	cancelFns map[string]context.CancelFunc
	buddies   sync.Map // map[runID string] -> *ai.Buddy
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
	// NOTE: Do NOT defer CloseContext here — browser stays alive after DONE
	// so user can review results. Closed by Cancel(), close-browser endpoint,
	// or the 30-min idle timer started after DONE.

	page := bCtx.Page
	stuckDet := NewStuckDetector(nil, r.cfg.StuckTimeoutSec)

	// Create buddy for this run using per-run AI provider
	prov := r.providerForRun(rc)
	buddy := ai.NewBuddy(prov, page, runID, r.runStore, r.db, r.cfg)
	r.buddies.Store(runID, buddy)
	defer r.buddies.Delete(runID)
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
		r.sm.Transition(runID, models.StateLoginDetect, "Checking for login elements...")
		loginInfo := r.detectLoginInfo(page)

		// If login button/link found but no form yet — click to navigate to login page
		if loginInfo.HasButton && !loginInfo.HasForm {
			r.publishLog(runID, "Login button found: "+loginInfo.PageDesc+". Clicking to navigate...")
			if err := r.clickLoginButton(page, loginInfo); err != nil {
				log.Warn().Err(err).Msg("failed to click login button")
			} else {
				time.Sleep(600 * time.Millisecond)
				loginInfo = r.detectLoginInfo(page) // re-probe after navigation
			}
		}

		if loginInfo.HasForm {
			// ── Obtain credentials ──
			var username, password string
			if rc.Auth != nil && rc.Auth.Username != "" {
				username, password = rc.Auth.Username, rc.Auth.Password
			} else {
				r.sm.Transition(runID, models.StateWaitLoginInput,
					"I found a login form ("+loginInfo.PageDesc+"). Please provide credentials or type 'skip'.")
				r.sm.SetQuestion(runID,
					"Found a login form. Enter credentials or type 'skip' to continue without login.",
					"login",
					[]string{"admin:password123", "user@example.com:secret", "skip - no login needed"})

				answer, err := r.answers.Wait(runID, 15*time.Minute)
				if err != nil {
					r.sm.Transition(runID, models.StateDiscoveryRun, "Timed out waiting — proceeding without login...")
					goto discovery
				}
				lower := strings.ToLower(strings.TrimSpace(answer.Answer))
				if lower == "skip" || strings.Contains(lower, "no login") || lower == "" {
					goto discovery
				}
				username, password = parseCredentials(answer)
				if username == "" {
					// Couldn't parse — ask user via buddy guidance
					r.publishLog(runID, "Couldn't parse credentials from: '"+answer.Answer+"'. Type 'skip' to continue without login.")
					goto discovery
				}
			}

			if username != "" {
				// ── LOGIN_ATTEMPT #1 ──
				r.sm.Transition(runID, models.StateLoginAttempt, "Attempting login as '"+username+"'...")
				_ = r.attemptLogin(ctx, page, username, password)
				buddy.AutoDismissBlocker(ctx)
				time.Sleep(1 * time.Second)

				// ── POST_LOGIN_VALIDATE ──
				r.sm.Transition(runID, models.StatePostLoginValidate, "Validating login...")
				if !r.validateLoginSuccess(page) {
					log.Warn().Msg("login attempt 1 failed, retrying...")
					// ── LOGIN_ATTEMPT #2 ──
					r.sm.Transition(runID, models.StateLoginAttempt, "Login failed — retrying once more...")
					_ = r.attemptLogin(ctx, page, username, password)
					buddy.AutoDismissBlocker(ctx)
					time.Sleep(1 * time.Second)

					r.sm.Transition(runID, models.StatePostLoginValidate, "Validating login (retry)...")
					if !r.validateLoginSuccess(page) {
						// ── Both attempts failed → ask user to log in manually ──
						desc := r.observePage(page)
						r.sm.Transition(runID, models.StateWaitManualLogin,
							"Automated login failed twice. "+desc+"\nPlease log in manually in the browser, then type 'done'.")
						r.sm.SetQuestion(runID,
							"Automated login failed. Please log in manually in the browser window, then type 'done'.",
							"manual_login",
							[]string{"done", "skip - continue without login"})
						answer, _ := r.answers.Wait(runID, 30*time.Minute)
						if strings.Contains(strings.ToLower(answer.Answer), "skip") {
							goto discovery
						}
						// User typed 'done' or anything else → assume they logged in
					}
				}
			}

		} else {
			// ── Neither form nor button found — describe page and ask user ──
			desc := r.observePage(page)
			screenshot := takeScreenshotBase64(page)
			log.Info().Str("page_desc", desc).Msg("no login elements detected")

			r.sm.SetStuck(runID,
				"No login form or button detected. I see: "+desc+
					"\n\nType 'skip' to proceed without login, 'manual' if you need to log in manually, "+
					"or give me instructions (e.g. 'click the Login link in the top right').",
				screenshot,
				[]string{"skip - no login needed", "manual - I'll log in myself", "click Sign In button", "navigate to /login"})

			answer, err := r.answers.Wait(runID, 15*time.Minute)
			if err == nil {
				lower := strings.ToLower(strings.TrimSpace(answer.Answer))
				switch {
				case lower == "skip" || strings.Contains(lower, "no login"):
					r.sm.Transition(runID, models.StateDiscoveryRun, "Proceeding without login...")
					goto discovery
				case lower == "manual" || lower == "done":
					// User has logged in manually — continue
					r.sm.Transition(runID, models.StateContextDetect, "Manual login confirmed, continuing...")
				default:
					// Execute user instruction via buddy
					_ = buddy.HandleStuck(ctx, "no login elements found", answer.Answer)
					time.Sleep(500 * time.Millisecond)
					// Re-check login state after instruction
					loginInfo2 := r.detectLoginInfo(page)
					if loginInfo2.HasForm {
						// Now there's a form — re-enter login flow
						r.sm.Transition(runID, models.StateLoginDetect, "Login form now detected after instruction")
					}
				}
			} else {
				// Timeout — proceed without login
				r.sm.Transition(runID, models.StateDiscoveryRun, "Timed out — proceeding without login...")
				goto discovery
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

	// --- CRUD_EXPLORE ---
	// For every resource list page found during discovery, autonomously navigate to it,
	// probe the real DOM, and perform Create → Edit → Delete using context-aware values.
	r.sm.Transition(runID, models.StateCRUDExplore, "Exploring CRUD operations on each resource module...")
	crudExplorer := NewCRUDExplorer(page, prov, runID, r.runStore, r.cfg)
	crudResults := crudExplorer.ExploreAll(ctx, discoveryResult.Pages)
	for _, res := range crudResults {
		parts := []string{res.ResourceName + ":"}
		if res.CreateAttempted {
			if res.CreateSuccess {
				parts = append(parts, "Create ✓")
			} else {
				parts = append(parts, "Create ✗")
			}
		}
		if res.EditAttempted {
			if res.EditSuccess {
				parts = append(parts, "Edit ✓")
			} else {
				parts = append(parts, "Edit ✗")
			}
		}
		if res.DeleteAttempted {
			if res.DeleteSuccess {
				parts = append(parts, "Delete ✓")
			} else {
				parts = append(parts, "Delete ✗")
			}
		}
		r.publishLog(runID, strings.Join(parts, " "))
	}
	if len(crudResults) == 0 {
		r.publishLog(runID, "No resource CRUD pages detected — skipping CRUD exploration")
	}

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

	// Keep browser alive so user can review. Auto-close after 30 minutes.
	go func() {
		timer := time.NewTimer(30 * time.Minute)
		defer timer.Stop()
		select {
		case <-timer.C:
			r.browsers.CloseContext(runID)
			log.Info().Str("run_id", runID).Msg("browser auto-closed after 30-min idle")
		case <-ctx.Done():
			// ctx cancelled by Cancel() — browser already closed there
		}
	}()

	return nil
}

// CloseBrowser explicitly closes the browser for a run (called by API endpoint or idle timer).
func (r *Runner) CloseBrowser(runID string) {
	r.browsers.CloseContext(runID)
}

// GetBuddy returns the live Buddy for a run (nil if not running).
func (r *Runner) GetBuddy(runID string) (*ai.Buddy, bool) {
	val, ok := r.buddies.Load(runID)
	if !ok {
		return nil, false
	}
	return val.(*ai.Buddy), true
}

// providerForRun returns the AI provider for a specific run.
// Uses the run's AI config if set, otherwise falls back to the global provider.
func (r *Runner) providerForRun(rc *models.RunContext) ai.Provider {
	if !rc.AI.Enabled {
		return &ai.NoneProvider{}
	}
	if rc.AI.Provider == "" {
		return r.aiProv
	}
	baseURL := rc.AI.BaseURL
	if baseURL == "" {
		baseURL = r.cfg.OllamaBaseURL
	}
	p, err := ai.NewProvider(ai.Config{
		Provider:   rc.AI.Provider,
		ModelName:  rc.AI.ModelName,
		APIKey:     rc.AI.APIKey,
		BaseURL:    baseURL,
		TimeoutSec: 30,
	})
	if err != nil {
		log.Warn().Err(err).Str("provider", rc.AI.Provider).Msg("could not create run provider, falling back")
		return r.aiProv
	}
	return p
}

// detectLoginInfo probes the current page for any login-related elements.
// Priority: password form > login link by href > login button by text.
func (r *Runner) detectLoginInfo(page playwright.Page) LoginInfo {
	script := `() => {
		// 1. Check for password input (form already on page)
		const pwEl = document.querySelector('input[type="password"], input[name="password"]');
		if (pwEl) return { hasForm: true, hasButton: false, buttonSel: '', loginURL: '', pageDesc: 'login form with password field' };

		// Check for form action pointing to login
		const formEl = document.querySelector('form[action*="login" i], form[action*="signin" i]');
		if (formEl) return { hasForm: true, hasButton: false, buttonSel: '', loginURL: '', pageDesc: 'login form (action=' + formEl.getAttribute('action') + ')' };

		// Check data-testid
		const tdEl = document.querySelector('[data-testid*="login"], [data-testid*="signin"]');
		if (tdEl && tdEl.tagName === 'INPUT') return { hasForm: true, hasButton: false, buttonSel: '', loginURL: '', pageDesc: 'login input via data-testid' };

		// 2. Login links by href
		const linkSels = ['a[href*="login" i]', 'a[href*="signin" i]', 'a[href*="/auth"]', 'a[href*="/account/login"]'];
		for (const sel of linkSels) {
			const el = document.querySelector(sel);
			if (el) {
				const href = el.getAttribute('href') || '';
				return { hasForm: false, hasButton: true, buttonSel: sel, loginURL: href, pageDesc: 'login link "' + el.textContent.trim() + '" → ' + href };
			}
		}

		// 3. Buttons/links with login-related text
		const loginWords = ['login', 'log in', 'sign in', 'signin', 'get started', 'continue'];
		const els = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"]'));
		for (const el of els) {
			const text = (el.textContent || el.value || '').trim().toLowerCase();
			if (loginWords.some(w => text === w || text.endsWith(w))) {
				const href = el.getAttribute('href') || '';
				const id = el.id ? '#' + el.id : null;
				const sel = id || el.tagName.toLowerCase() + (href ? '[href="' + href + '"]' : ':first-of-type');
				return { hasForm: false, hasButton: true, buttonSel: sel, loginURL: href, pageDesc: 'login button "' + el.textContent.trim() + '"' };
			}
		}

		return { hasForm: false, hasButton: false, buttonSel: '', loginURL: '', pageDesc: 'no login elements found' };
	}`

	res, err := page.Evaluate(script)
	if err != nil {
		return LoginInfo{PageDesc: "error probing page"}
	}
	m, ok := res.(map[string]interface{})
	if !ok {
		return LoginInfo{PageDesc: "no login elements found"}
	}
	hasForm, _ := m["hasForm"].(bool)
	hasButton, _ := m["hasButton"].(bool)
	buttonSel, _ := m["buttonSel"].(string)
	loginURL, _ := m["loginURL"].(string)
	pageDesc, _ := m["pageDesc"].(string)
	return LoginInfo{
		HasForm:   hasForm,
		HasButton: hasButton,
		ButtonSel: buttonSel,
		LoginURL:  loginURL,
		PageDesc:  pageDesc,
	}
}

// clickLoginButton clicks the detected login button/link and waits for page load.
func (r *Runner) clickLoginButton(page playwright.Page, info LoginInfo) error {
	// Try primary selector from JS probe
	if info.ButtonSel != "" {
		loc := page.Locator(info.ButtonSel).First()
		if visible, _ := loc.IsVisible(); visible {
			if err := loc.Click(); err == nil {
				page.WaitForLoadState(playwright.PageWaitForLoadStateOptions{
					State:   playwright.LoadStateDomcontentloaded,
					Timeout: playwright.Float(10000),
				})
				return nil
			}
		}
	}
	// Fallback: Playwright text selectors (works for SPA buttons)
	for _, textSel := range []string{"text=Login", "text=Log in", "text=Sign in", "text=Sign In", "text=Log In"} {
		loc := page.Locator(textSel).First()
		if visible, _ := loc.IsVisible(); visible {
			if err := loc.Click(); err == nil {
				page.WaitForLoadState(playwright.PageWaitForLoadStateOptions{
					State:   playwright.LoadStateDomcontentloaded,
					Timeout: playwright.Float(10000),
				})
				return nil
			}
		}
	}
	// Fallback: direct navigation if href is available
	if info.LoginURL != "" {
		_, err := page.Goto(info.LoginURL, playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(15000),
		})
		return err
	}
	return fmt.Errorf("could not interact with login button")
}

// observePage returns a human-readable description of what is currently visible.
func (r *Runner) observePage(page playwright.Page) string {
	script := `() => {
		const title = document.title || '';
		const h1 = (document.querySelector('h1') || {}).textContent || '';
		const h2 = (document.querySelector('h2') || {}).textContent || '';
		const url = location.href;
		const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
			.slice(0, 5).map(b => b.textContent.trim()).filter(Boolean);
		const inputs = Array.from(document.querySelectorAll('input'))
			.slice(0, 5).map(i => i.type || 'text');
		const alert = (document.querySelector('[role="alert"], .error, .alert') || {}).textContent || '';
		return {
			url, title,
			heading: (h1 || h2).trim(),
			buttons: btns,
			inputs,
			alert: alert.trim().slice(0, 100),
		};
	}`
	res, err := page.Evaluate(script)
	if err != nil {
		return "URL: " + page.URL()
	}
	m, ok := res.(map[string]interface{})
	if !ok {
		return "URL: " + page.URL()
	}
	url, _ := m["url"].(string)
	title, _ := m["title"].(string)
	heading, _ := m["heading"].(string)
	alert, _ := m["alert"].(string)

	parts := []string{"URL: " + url}
	if title != "" {
		parts = append(parts, "Title: "+title)
	}
	if heading != "" && heading != title {
		parts = append(parts, "Heading: "+heading)
	}
	if btns, ok := m["buttons"].([]interface{}); ok && len(btns) > 0 {
		labels := make([]string, 0, len(btns))
		for _, b := range btns {
			if s, ok := b.(string); ok {
				labels = append(labels, s)
			}
		}
		if len(labels) > 0 {
			parts = append(parts, "Buttons: "+strings.Join(labels, ", "))
		}
	}
	if alert != "" {
		parts = append(parts, "Alert: "+alert)
	}
	return strings.Join(parts, " | ")
}

// parseCredentials extracts username+password from an AnswerRequest.
// Supports: structured Data map, key:value text, delimited shorthand.
func parseCredentials(answer models.AnswerRequest) (username, password string) {
	// Structured data from UI form (highest priority)
	if answer.Data != nil {
		u, p := strings.TrimSpace(answer.Data["username"]), strings.TrimSpace(answer.Data["password"])
		if u != "" {
			return u, p
		}
	}
	raw := strings.TrimSpace(answer.Answer)
	lower := strings.ToLower(raw)

	// Key-value pattern: "username: foo password: bar", "email: a pass: b"
	userKeys := []string{"username:", "user:", "login:", "email:"}
	passKeys := []string{"password:", "pass:", "pwd:", "passwd:"}
	kv := map[string]string{}
	for _, k := range userKeys {
		if idx := strings.Index(lower, k); idx != -1 {
			rest := strings.Fields(raw[idx+len(k):])
			if len(rest) > 0 {
				kv["user"] = rest[0]
			}
		}
	}
	for _, k := range passKeys {
		if idx := strings.Index(lower, k); idx != -1 {
			rest := strings.Fields(raw[idx+len(k):])
			if len(rest) > 0 {
				kv["pass"] = rest[0]
			}
		}
	}
	if kv["user"] != "" && kv["pass"] != "" {
		return kv["user"], kv["pass"]
	}

	// Delimiter pattern: "user / pass", "user | pass", "user:pass"
	for _, sep := range []string{" / ", " | ", ":"} {
		if idx := strings.Index(raw, sep); idx != -1 {
			parts := strings.SplitN(raw, sep, 2)
			if len(parts) == 2 {
				u, p := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
				if u != "" && p != "" {
					return u, p
				}
			}
		}
	}
	return "", ""
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

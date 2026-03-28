package testing

import (
	"context"
	"encoding/base64"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
	"github.com/qabuddy/agent/internal/config"
	"github.com/qabuddy/agent/internal/models"
	"github.com/qabuddy/agent/internal/store"
	"github.com/rs/zerolog/log"
)

// Executor runs test cases using Playwright
type Executor struct {
	page    playwright.Page
	runID   string
	runStore *store.RunStore
	artDir  string
	cfg     *config.Config
}

// NewExecutor creates a new test Executor
func NewExecutor(page playwright.Page, runID string, s *store.RunStore, artDir string, cfg *config.Config) *Executor {
	return &Executor{
		page:    page,
		runID:   runID,
		runStore: s,
		artDir:  artDir,
		cfg:     cfg,
	}
}

// Execute runs all test cases in the plan and returns a TestSuite
func (e *Executor) Execute(ctx context.Context, plan *models.TestPlan) (*models.TestSuite, error) {
	suite := &models.TestSuite{
		RunID:     e.runID,
		Total:     len(plan.TestCases),
		TestCases: make([]models.TestCase, len(plan.TestCases)),
	}
	copy(suite.TestCases, plan.TestCases)

	startTime := time.Now()

	for i := range suite.TestCases {
		if ctx.Err() != nil {
			break
		}

		tc := &suite.TestCases[i]
		tc.Status = models.TestStatusRunning

		// Publish running event
		e.runStore.Publish(models.NewEvent(e.runID, models.EventTestResult, models.TestResultData{
			TestCaseID: tc.ID,
			Name:       tc.Name,
			Status:     models.TestStatusRunning,
			Severity:   tc.Severity,
		}))

		// Execute the test case
		tcStart := time.Now()
		err := e.runTestCase(ctx, tc)
		tc.ExecutionTimeMs = time.Since(tcStart).Milliseconds()
		now := time.Now()
		tc.ExecutedAt = &now

		if err != nil {
			tc.Status = models.TestStatusFailed
			tc.ErrorMessage = err.Error()
			// Take failure screenshot
			if screenshot, sErr := e.takeScreenshot(tc.ID); sErr == nil {
				tc.ScreenshotPath = screenshot
			}
			suite.Failed++
		} else {
			tc.Status = models.TestStatusPassed
			suite.Passed++
		}

		// Publish result event
		resultData := models.TestResultData{
			TestCaseID:   tc.ID,
			Name:         tc.Name,
			Status:       tc.Status,
			Severity:     tc.Severity,
			DurationMs:   tc.ExecutionTimeMs,
			ErrorMessage: tc.ErrorMessage,
		}
		if tc.ScreenshotPath != "" {
			if data, err := os.ReadFile(tc.ScreenshotPath); err == nil {
				resultData.Screenshot = base64.StdEncoding.EncodeToString(data)
			}
		}
		e.runStore.Publish(models.NewEvent(e.runID, models.EventTestResult, resultData))

		log.Info().
			Str("run_id", e.runID).
			Str("test", tc.Name).
			Str("status", string(tc.Status)).
			Int64("duration_ms", tc.ExecutionTimeMs).
			Msg("test executed")

		// Natural pacing between tests
		delay := time.Duration(e.cfg.NaturalDelayMinMs+rand.Intn(e.cfg.NaturalDelayMaxMs-e.cfg.NaturalDelayMinMs)) * time.Millisecond
		time.Sleep(delay)
	}

	suite.DurationMs = time.Since(startTime).Milliseconds()
	suite.Skipped = suite.Total - suite.Passed - suite.Failed
	suite.CompletedAt = time.Now()
	return suite, nil
}

// runTestCase executes all steps of a single test case
func (e *Executor) runTestCase(ctx context.Context, tc *models.TestCase) error {
	for _, step := range tc.Steps {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		timeout := step.TimeoutMs
		if timeout <= 0 {
			timeout = 10000
		}

		var err error
		switch step.Action {
		case models.ActionNavigate:
			err = e.stepNavigate(step, timeout)
		case models.ActionClick:
			err = e.stepClick(step, timeout)
		case models.ActionFill:
			err = e.stepFill(step, timeout)
		case models.ActionSelect:
			err = e.stepSelect(step, timeout)
		case models.ActionAssert:
			err = e.stepAssert(step, timeout)
		case models.ActionWait:
			err = e.stepWait(step)
		case models.ActionScroll:
			err = e.stepScroll(step)
		case models.ActionHover:
			err = e.stepHover(step, timeout)
		case models.ActionKeyPress:
			err = e.stepKeyPress(step)
		case models.ActionScreenshot:
			_, err = e.takeScreenshot(tc.ID + "_step")
		}

		if err != nil && !step.Optional {
			return fmt.Errorf("step '%s' (%s): %w", step.Description, step.Action, err)
		}

		// Natural delay between steps
		delay := time.Duration(50+rand.Intn(200)) * time.Millisecond
		time.Sleep(delay)
	}
	return nil
}

func (e *Executor) stepNavigate(step models.TestStep, timeoutMs int) error {
	target := step.Value
	if target == "" || target == "{{page_url}}" {
		return nil // skip navigation if no target
	}
	_, err := e.page.Goto(target, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(float64(timeoutMs)),
	})
	return err
}

func (e *Executor) stepClick(step models.TestStep, timeoutMs int) error {
	selectors := e.resolveSelectors(step.Selector)
	var lastErr error
	for _, sel := range selectors {
		loc := e.page.Locator(sel)
		if err := loc.Click(playwright.LocatorClickOptions{
			Timeout: playwright.Float(float64(timeoutMs)),
		}); err == nil {
			return nil
		} else {
			lastErr = err
		}
	}
	return lastErr
}

func (e *Executor) stepFill(step models.TestStep, timeoutMs int) error {
	selectors := e.resolveSelectors(step.Selector)
	var lastErr error
	for _, sel := range selectors {
		loc := e.page.Locator(sel).First()
		if err := loc.Fill(step.Value, playwright.LocatorFillOptions{
			Timeout: playwright.Float(float64(timeoutMs)),
		}); err == nil {
			return nil
		} else {
			lastErr = err
		}
	}
	return lastErr
}

func (e *Executor) stepSelect(step models.TestStep, timeoutMs int) error {
	loc := e.page.Locator(step.Selector)
	_, err := loc.SelectOption(playwright.SelectOptionValues{
		Labels: &[]string{step.Value},
	}, playwright.LocatorSelectOptionOptions{
		Timeout: playwright.Float(float64(timeoutMs)),
	})
	return err
}

func (e *Executor) stepAssert(step models.TestStep, timeoutMs int) error {
	loc := e.page.Locator(step.Selector)
	switch step.AssertType {
	case models.AssertVisible:
		return loc.First().WaitFor(playwright.LocatorWaitForOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(float64(timeoutMs)),
		})
	case models.AssertHidden:
		return loc.First().WaitFor(playwright.LocatorWaitForOptions{
			State:   playwright.WaitForSelectorStateHidden,
			Timeout: playwright.Float(float64(timeoutMs)),
		})
	case models.AssertText:
		text, err := loc.First().InnerText()
		if err != nil {
			return err
		}
		if step.Expected != "" && !strings.Contains(strings.ToLower(text), strings.ToLower(step.Expected)) {
			return fmt.Errorf("expected text '%s' not found in '%s'", step.Expected, text)
		}
		return nil
	case models.AssertURL:
		currentURL := e.page.URL()
		if !strings.Contains(currentURL, step.Expected) {
			return fmt.Errorf("expected URL to contain '%s', got '%s'", step.Expected, currentURL)
		}
		return nil
	case models.AssertCount:
		count, err := loc.Count()
		if err != nil {
			return err
		}
		if step.Expected != "" {
			expectedCount := 0
			fmt.Sscanf(step.Expected, "%d", &expectedCount)
			if count < expectedCount {
				return fmt.Errorf("expected at least %d elements, found %d", expectedCount, count)
			}
		}
		return nil
	case models.AssertEnabled:
		enabled, err := loc.First().IsEnabled()
		if err != nil {
			return err
		}
		if !enabled {
			return fmt.Errorf("element is disabled but expected enabled")
		}
		return nil
	case models.AssertDisabled:
		disabled, err := loc.First().IsDisabled()
		if err != nil {
			return err
		}
		if !disabled {
			return fmt.Errorf("element is enabled but expected disabled")
		}
		return nil
	default:
		// Default: just check visible
		return loc.First().WaitFor(playwright.LocatorWaitForOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(float64(timeoutMs)),
		})
	}
}

func (e *Executor) stepWait(step models.TestStep) error {
	ms := step.TimeoutMs
	if ms <= 0 {
		ms = 1000
	}
	if step.Selector != "" {
		return e.page.Locator(step.Selector).First().WaitFor(playwright.LocatorWaitForOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(float64(ms)),
		})
	}
	time.Sleep(time.Duration(ms) * time.Millisecond)
	return nil
}

func (e *Executor) stepScroll(step models.TestStep) error {
	script := `window.scrollBy(0, 500)`
	if step.Value == "bottom" {
		script = `window.scrollTo(0, document.body.scrollHeight)`
	} else if step.Value == "top" {
		script = `window.scrollTo(0, 0)`
	}
	_, err := e.page.Evaluate(script)
	return err
}

func (e *Executor) stepHover(step models.TestStep, timeoutMs int) error {
	return e.page.Locator(step.Selector).First().Hover(playwright.LocatorHoverOptions{
		Timeout: playwright.Float(float64(timeoutMs)),
	})
}

func (e *Executor) stepKeyPress(step models.TestStep) error {
	return e.page.Keyboard().Press(step.Value)
}

// resolveSelectors returns a prioritized list of selectors to try
func (e *Executor) resolveSelectors(selector string) []string {
	if selector == "" {
		return nil
	}
	// Try comma-separated selectors as alternatives
	parts := strings.Split(selector, ", ")
	if len(parts) > 1 {
		return parts
	}
	// Return original + common alternatives
	selectors := []string{selector}

	// If it's a button with text, also try getByRole
	if strings.Contains(selector, "button") {
		selectors = append(selectors, selector)
	}
	return selectors
}

// takeScreenshot captures the page and saves to artifacts dir
func (e *Executor) takeScreenshot(name string) (string, error) {
	runDir := filepath.Join(e.artDir, e.runID)
	if err := os.MkdirAll(runDir, 0755); err != nil {
		return "", err
	}
	path := filepath.Join(runDir, fmt.Sprintf("screenshot_%s_%d.png", name, time.Now().UnixMilli()))
	_, err := e.page.Screenshot(playwright.PageScreenshotOptions{
		Path:     playwright.String(path),
		FullPage: playwright.Bool(false),
		Type:     playwright.ScreenshotTypePng,
	})
	return path, err
}

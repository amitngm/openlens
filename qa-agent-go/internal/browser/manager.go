package browser

import (
	"fmt"
	"sync"

	"github.com/playwright-community/playwright-go"
	"github.com/rs/zerolog/log"
)

// RunBrowserContext holds Playwright objects for a single run
type RunBrowserContext struct {
	Browser playwright.Browser
	Context playwright.BrowserContext
	Page    playwright.Page
	RunID   string
}

// Manager manages Playwright browser instances per run
type Manager struct {
	mu       sync.Mutex
	pw       *playwright.Playwright
	contexts map[string]*RunBrowserContext
}

// NewManager initializes Playwright and returns a Manager
func NewManager() (*Manager, error) {
	pw, err := playwright.Run()
	if err != nil {
		return nil, fmt.Errorf("start playwright: %w", err)
	}
	log.Info().Msg("playwright started")
	return &Manager{
		pw:       pw,
		contexts: make(map[string]*RunBrowserContext),
	}, nil
}

// CreateContext creates a new browser context for a run
func (m *Manager) CreateContext(runID string, headless bool) (*RunBrowserContext, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.contexts[runID]; exists {
		return nil, fmt.Errorf("context for run %s already exists", runID)
	}

	// Try Chrome channel first (better compatibility on macOS), fallback to chromium
	launchOpts := playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(headless),
		Args: []string{
			"--no-sandbox",
			"--disable-dev-shm-usage",
			"--disable-blink-features=AutomationControlled",
		},
	}

	var browser playwright.Browser
	var err error

	// Attempt to use installed Chrome
	chromeOpts := launchOpts
	chromeOpts.Channel = playwright.String("chrome")
	browser, err = m.pw.Chromium.Launch(chromeOpts)
	if err != nil {
		log.Warn().Err(err).Msg("Chrome not found, falling back to chromium")
		browser, err = m.pw.Chromium.Launch(launchOpts)
		if err != nil {
			return nil, fmt.Errorf("launch browser: %w", err)
		}
	}

	// Create a browser context with viewport and user agent
	ctx, err := browser.NewContext(playwright.BrowserNewContextOptions{
		Viewport: &playwright.Size{Width: 1280, Height: 800},
		UserAgent: playwright.String(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
				"AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		),
		JavaScriptEnabled: playwright.Bool(true),
		// Accept insecure certs for internal apps
		IgnoreHttpsErrors: playwright.Bool(true),
	})
	if err != nil {
		browser.Close()
		return nil, fmt.Errorf("create context: %w", err)
	}

	page, err := ctx.NewPage()
	if err != nil {
		ctx.Close()
		browser.Close()
		return nil, fmt.Errorf("create page: %w", err)
	}

	// Block heavy resources during crawling to speed up discovery
	if headless {
		page.Route("**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,eot}", func(route playwright.Route) {
			route.Abort()
		})
	}

	rc := &RunBrowserContext{
		Browser: browser,
		Context: ctx,
		Page:    page,
		RunID:   runID,
	}
	m.contexts[runID] = rc
	log.Info().Str("run_id", runID).Bool("headless", headless).Msg("browser context created")
	return rc, nil
}

// GetContext retrieves the browser context for a run
func (m *Manager) GetContext(runID string) (*RunBrowserContext, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rc, ok := m.contexts[runID]
	if !ok {
		return nil, fmt.Errorf("no browser context for run %s", runID)
	}
	return rc, nil
}

// GetPage returns the Playwright page for a run
func (m *Manager) GetPage(runID string) (playwright.Page, error) {
	rc, err := m.GetContext(runID)
	if err != nil {
		return nil, err
	}
	return rc.Page, nil
}

// TakeScreenshot captures the current page as PNG bytes
func (m *Manager) TakeScreenshot(runID string) ([]byte, error) {
	page, err := m.GetPage(runID)
	if err != nil {
		return nil, err
	}
	return page.Screenshot(playwright.PageScreenshotOptions{
		FullPage: playwright.Bool(false),
		Type:     playwright.ScreenshotTypePng,
	})
}

// CloseContext closes the browser context for a run and cleans up
func (m *Manager) CloseContext(runID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rc, ok := m.contexts[runID]
	if !ok {
		return
	}
	rc.Page.Close()
	rc.Context.Close()
	rc.Browser.Close()
	delete(m.contexts, runID)
	log.Info().Str("run_id", runID).Msg("browser context closed")
}

// CloseAll closes all active contexts and stops Playwright
func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for runID, rc := range m.contexts {
		rc.Page.Close()
		rc.Context.Close()
		rc.Browser.Close()
		delete(m.contexts, runID)
	}
	if m.pw != nil {
		m.pw.Stop()
	}
	log.Info().Msg("all browser contexts closed")
}

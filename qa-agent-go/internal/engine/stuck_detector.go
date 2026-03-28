package engine

import (
	"context"
	"encoding/base64"
	"strings"
	"sync"
	"time"

	"github.com/playwright-community/playwright-go"
	"github.com/qabuddy/agent/internal/ai"
	"github.com/rs/zerolog/log"
)

// StuckInfo describes a detected stuck state
type StuckInfo struct {
	URL        string
	Reason     string
	Screenshot string   // base64 PNG
	AutoHints  []string // suggested actions from visible page content
}

// StuckDetector monitors for stuck states and handles recovery
type StuckDetector struct {
	buddy       *ai.Buddy
	timeoutSec  int
	lastURL     map[string]string
	lastChange  map[string]time.Time
	urlVisits   map[string]map[string]int // runID -> url -> count
	mu          sync.Mutex
}

// NewStuckDetector creates a new StuckDetector
func NewStuckDetector(buddy *ai.Buddy, timeoutSec int) *StuckDetector {
	return &StuckDetector{
		buddy:      buddy,
		timeoutSec: timeoutSec,
		lastURL:    make(map[string]string),
		lastChange: make(map[string]time.Time),
		urlVisits:  make(map[string]map[string]int),
	}
}

// RecordURLChange records a URL visit for stuck detection
func (d *StuckDetector) RecordURLChange(runID, url string) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.urlVisits[runID] == nil {
		d.urlVisits[runID] = make(map[string]int)
	}

	if d.lastURL[runID] != url {
		d.lastURL[runID] = url
		d.lastChange[runID] = time.Now()
		d.urlVisits[runID][url]++
	}
}

// IsRedirectLoop detects if a URL has been visited more than 3 times
func (d *StuckDetector) IsRedirectLoop(runID, url string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if visits, ok := d.urlVisits[runID]; ok {
		return visits[url] > 3
	}
	return false
}

// Check checks if a run is stuck and returns StuckInfo if so
func (d *StuckDetector) Check(runID string, page playwright.Page) (bool, *StuckInfo, error) {
	currentURL := page.URL()
	d.RecordURLChange(runID, currentURL)

	// Check redirect loop
	if d.IsRedirectLoop(runID, currentURL) {
		screenshot := takeScreenshotBase64(page)
		hints := d.generateHints(page)
		return true, &StuckInfo{
			URL:        currentURL,
			Reason:     "Redirect loop detected — visited this page more than 3 times",
			Screenshot: screenshot,
			AutoHints:  hints,
		}, nil
	}

	// Check if URL has been stuck for too long
	d.mu.Lock()
	lastChange, hasLastChange := d.lastChange[runID]
	d.mu.Unlock()

	if hasLastChange && time.Since(lastChange) > time.Duration(d.timeoutSec)*time.Second {
		// Try auto-dismiss first
		if d.buddy != nil {
			dismissed, _ := d.buddy.AutoDismissBlocker(context.Background())
			if dismissed {
				log.Info().Str("run_id", runID).Msg("auto-dismissed blocker")
				d.mu.Lock()
				d.lastChange[runID] = time.Now()
				d.mu.Unlock()
				return false, nil, nil
			}
		}

		screenshot := takeScreenshotBase64(page)
		hints := d.generateHints(page)

		return true, &StuckInfo{
			URL:        currentURL,
			Reason:     "Page has not changed for " + time.Since(lastChange).Round(time.Second).String(),
			Screenshot: screenshot,
			AutoHints:  hints,
		}, nil
	}

	// Check for obvious error pages
	if stuck, info := d.checkErrorPage(page); stuck {
		return true, info, nil
	}

	return false, nil, nil
}

// checkErrorPage checks for common error indicators
func (d *StuckDetector) checkErrorPage(page playwright.Page) (bool, *StuckInfo) {
	script := `() => {
		const title = document.title.toLowerCase();
		const body = document.body.innerText.substring(0, 500).toLowerCase();
		const url = window.location.href;

		// Check for error conditions
		if (title.includes('404') || title.includes('not found') || title.includes('error')) {
			return { stuck: true, reason: 'Error page detected: ' + document.title };
		}
		if (body.includes('404 not found') || body.includes('page not found')) {
			return { stuck: true, reason: '404 - Page not found' };
		}
		if (body.includes('500') && body.includes('server error')) {
			return { stuck: true, reason: 'Server error detected' };
		}
		if (body.includes('session expired') || body.includes('your session has expired')) {
			return { stuck: true, reason: 'Session expired' };
		}
		if (body.includes('access denied') || body.includes('permission denied')) {
			return { stuck: true, reason: 'Access denied' };
		}
		return { stuck: false };
	}`

	res, err := page.Evaluate(script)
	if err != nil {
		return false, nil
	}

	m, _ := res.(map[string]interface{})
	if stuck, _ := m["stuck"].(bool); stuck {
		reason, _ := m["reason"].(string)
		screenshot := takeScreenshotBase64(page)
		hints := d.generateHints(page)
		return true, &StuckInfo{
			URL:        page.URL(),
			Reason:     reason,
			Screenshot: screenshot,
			AutoHints:  hints,
		}
	}
	return false, nil
}

// generateHints creates action suggestions based on visible page content
func (d *StuckDetector) generateHints(page playwright.Page) []string {
	script := `() => {
		const buttons = Array.from(document.querySelectorAll('button:not([disabled]), a[role="button"]'))
			.slice(0, 5)
			.map(el => el.textContent.trim())
			.filter(t => t.length > 0 && t.length < 30);
		const hasClose = !!(document.querySelector('[aria-label*="close" i], button.close, .modal-close'));
		const hasAccept = !!(document.querySelector('button') &&
			document.body.innerText.toLowerCase().includes('accept'));
		return { buttons, hasClose, hasAccept };
	}`

	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})

	var hints []string
	if hasAccept, _ := m["hasAccept"].(bool); hasAccept {
		hints = append(hints, "Click Accept")
	}
	if hasClose, _ := m["hasClose"].(bool); hasClose {
		hints = append(hints, "Close popup")
	}
	hints = append(hints, "Press Enter", "Scroll down", "Go to previous page")

	if btns, ok := m["buttons"].([]interface{}); ok {
		for _, btn := range btns {
			if text, ok := btn.(string); ok && text != "" {
				hint := "Click '" + text + "'"
				if !containsHint(hints, hint) {
					hints = append(hints, hint)
				}
			}
		}
	}

	return hints
}

func takeScreenshotBase64(page playwright.Page) string {
	data, err := page.Screenshot(playwright.PageScreenshotOptions{
		FullPage: playwright.Bool(false),
		Type:     playwright.ScreenshotTypePng,
	})
	if err != nil {
		return ""
	}
	return base64.StdEncoding.EncodeToString(data)
}

func containsHint(hints []string, hint string) bool {
	for _, h := range hints {
		if strings.EqualFold(h, hint) {
			return true
		}
	}
	return false
}

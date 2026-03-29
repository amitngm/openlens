package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
	"github.com/qabuddy/agent/internal/config"
	"github.com/qabuddy/agent/internal/database"
	"github.com/qabuddy/agent/internal/models"
	"github.com/qabuddy/agent/internal/store"
	"github.com/rs/zerolog/log"
)

// BuddyAction is what the AI decides to do next
type BuddyAction struct {
	Type   string `json:"type"`   // click, fill, navigate, press_key, scroll, wait, done, ask
	Target string `json:"target"` // CSS selector or URL
	Value  string `json:"value"`  // for fill or key_press
	Reason string `json:"reason"` // explanation of action
}

// Buddy is the Ask Buddy conversational AI agent
type Buddy struct {
	provider Provider
	page     playwright.Page
	runID    string
	runStore *store.RunStore
	db       *database.DB
	cfg      *config.Config
}

// NewBuddy creates a new Buddy instance
func NewBuddy(provider Provider, page playwright.Page, runID string, s *store.RunStore, db *database.DB, cfg *config.Config) *Buddy {
	return &Buddy{
		provider: provider,
		page:     page,
		runID:    runID,
		runStore: s,
		db:       db,
		cfg:      cfg,
	}
}

// HandleMessage processes a message from the user and performs actions
func (b *Buddy) HandleMessage(ctx context.Context, message string) (string, error) {
	b.publishBuddyMsg("Got it! Let me " + message + "...")

	// Check for command shortcuts
	if response, handled := b.handleCommand(ctx, message); handled {
		return response, nil
	}

	// Build page snapshot for AI
	snapshot, err := b.ObservePage()
	if err != nil {
		snapshot = "Unable to observe page."
	}

	// Ask AI for next action
	if !b.provider.IsAvailable(ctx) {
		// Rule-based fallback
		return b.ruleBasedHandle(ctx, message)
	}

	systemPrompt := `You are a QA automation assistant controlling a web browser.
Given a user instruction and the current page state, decide what single action to take next.
Respond ONLY with valid JSON in this format:
{"type": "click|fill|navigate|press_key|scroll|done|ask", "target": "selector or URL", "value": "value for fill/key", "reason": "why this action"}

Safety rules:
- Never click delete, remove, logout, or destructive buttons unless explicitly asked
- For "click", use a CSS selector or visible button text
- For "navigate", use a full URL or relative path
- If goal is achieved, use type "done"
- If you need clarification, use type "ask" and put the question in "reason"`

	userPrompt := fmt.Sprintf("User instruction: %s\n\nCurrent page:\n%s\n\nWhat is the next single action?", message, snapshot)

	response, err := b.provider.Complete(ctx, systemPrompt, userPrompt)
	if err != nil {
		log.Warn().Err(err).Msg("AI failed, using rule-based fallback")
		return b.ruleBasedHandle(ctx, message)
	}

	// Parse action from response
	action, err := parseAction(response)
	if err != nil {
		return b.ruleBasedHandle(ctx, message)
	}

	if action.Type == "ask" {
		return action.Reason, nil
	}
	if action.Type == "done" {
		return "Done! " + action.Reason, nil
	}

	// Execute the action
	if err := b.ExecuteAction(ctx, *action); err != nil {
		return fmt.Sprintf("I tried to %s but encountered an issue: %v. Want me to try a different approach?", action.Type, err), nil
	}

	b.publishBuddyMsg(fmt.Sprintf("✓ %s: %s", action.Type, action.Reason))
	return fmt.Sprintf("Done! I %s (%s). What's next?", action.Type, action.Reason), nil
}

// HandleStuck processes user instruction when agent is stuck
func (b *Buddy) HandleStuck(ctx context.Context, stuckReason, userInstruction string) error {
	b.publishBuddyMsg("Got it, let me try to get unstuck...")

	// Try to parse and execute the instruction
	action := b.parseNaturalInstruction(userInstruction)
	if action == nil {
		// Ask AI to interpret
		snapshot, _ := b.ObservePage()
		systemPrompt := `You are helping a QA agent that is stuck on an unexpected screen.
Parse the user's instruction and return a JSON action to execute.
Format: {"type": "click|fill|navigate|press_key|scroll", "target": "selector or text or URL", "value": "optional", "reason": "explanation"}`

		userPrompt := fmt.Sprintf("Stuck reason: %s\nUser says: %s\nPage: %s\nWhat action to take?",
			stuckReason, userInstruction, snapshot)

		if response, err := b.provider.Complete(ctx, systemPrompt, userPrompt); err == nil {
			action, _ = parseAction(response)
		}
	}

	if action == nil {
		return fmt.Errorf("could not parse instruction: %s", userInstruction)
	}

	if err := b.ExecuteAction(ctx, *action); err != nil {
		return fmt.Errorf("action failed: %w", err)
	}

	// Learn this pattern for future runs
	go b.learnBlockerPattern(stuckReason, b.page.URL(), *action)

	b.publishBuddyMsg("✓ Unstuck! Resuming...")
	return nil
}

// AutoDismissBlocker tries to automatically dismiss known blocker screens
func (b *Buddy) AutoDismissBlocker(ctx context.Context) (bool, error) {
	// Check page text for known blocker patterns
	script := `() => document.body.innerText.toLowerCase()`
	res, err := b.page.Evaluate(script)
	if err != nil {
		return false, nil
	}
	pageText, _ := res.(string)

	// Try built-in patterns
	for _, blocker := range models.DefaultKnownBlockers {
		for _, pattern := range blocker.Patterns {
			if strings.Contains(pageText, pattern) {
				if dismissed := b.tryDismissWithText(ctx, pattern); dismissed {
					log.Info().Str("pattern", pattern).Msg("auto-dismissed blocker")
					b.publishBuddyMsg(fmt.Sprintf("Auto-dismissed: '%s' screen", blocker.Name))
					return true, nil
				}
			}
		}
	}

	// Try learned patterns from DB
	if b.db != nil {
		patterns, _ := b.db.ListBlockerPatterns()
		for _, p := range patterns {
			if matchesURLPattern(b.page.URL(), p.URLPattern) && strings.Contains(pageText, strings.ToLower(p.ScreenSignature)) {
				if err := b.ExecuteAction(ctx, BuddyAction{
					Type:   p.Action,
					Target: p.ActionTarget,
					Value:  p.ActionValue,
				}); err == nil {
					b.db.UpdateBlockerApplied(p.ID)
					return true, nil
				}
			}
		}
	}

	return false, nil
}

// ObservePage returns a deep, rich description of the current page for AI context.
// It reads all real DOM content: headings, buttons, forms, tables, dropdowns, links.
func (b *Buddy) ObservePage() (string, error) {
	script := `() => {
		const url = window.location.href;
		const title = document.title;
		const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
			.slice(0,4).map(h => h.textContent.trim()).filter(Boolean);

		// All visible buttons and links
		const buttons = Array.from(document.querySelectorAll('button:not([disabled]), a[role="button"], [role="button"]'))
			.filter(el => el.offsetParent !== null)
			.slice(0, 15).map(el => el.textContent.trim()).filter(Boolean);

		// All visible links in nav and main
		const navLinks = Array.from(document.querySelectorAll('nav a, [role="navigation"] a, aside a, .sidebar a'))
			.filter(el => el.offsetParent !== null)
			.slice(0, 12).map(el => ({ text: el.textContent.trim(), href: el.getAttribute('href') || '' }))
			.filter(l => l.text);

		// All visible content links
		const contentLinks = Array.from(document.querySelectorAll('main a, [role="main"] a, .content a'))
			.filter(el => el.offsetParent !== null)
			.slice(0, 10).map(el => el.textContent.trim()).filter(Boolean);

		// All form fields with real labels and values
		const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([disabled]), textarea, select'))
			.filter(el => el.offsetParent !== null)
			.slice(0, 12).map(el => {
				const label = el.id
					? (document.querySelector('label[for="' + el.id + '"]')?.textContent?.trim() || '')
					: '';
				const placeholder = el.placeholder || '';
				const name = el.name || el.id || '';
				const type = el.tagName === 'SELECT' ? 'select' : (el.type || 'text');
				let options = [];
				if (el.tagName === 'SELECT') {
					options = Array.from(el.options).slice(0, 8).map(o => o.text.trim()).filter(Boolean);
				}
				return { label, placeholder, name, type, options };
			});

		// All visible tables: headers + row count + sample data
		const tables = Array.from(document.querySelectorAll('table'))
			.filter(el => el.offsetParent !== null)
			.slice(0, 3).map(table => {
				const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim()).filter(Boolean);
				const rows = table.querySelectorAll('tbody tr').length;
				const sample = Array.from(table.querySelectorAll('tbody tr:first-child td'))
					.slice(0,5).map(td => td.textContent.trim()).filter(Boolean);
				return { headers, rows, sample };
			});

		// Row action buttons in tables (edit, delete, view)
		const rowActions = Array.from(document.querySelectorAll('td button, td a, [role="row"] button'))
			.filter(el => el.offsetParent !== null)
			.slice(0, 8).map(el => el.textContent.trim() || el.getAttribute('aria-label') || '').filter(Boolean);

		// Visible alerts / messages
		const alerts = Array.from(document.querySelectorAll('[role="alert"], .error, .alert, .notification, .toast, .message'))
			.filter(el => el.offsetParent !== null)
			.slice(0, 5).map(el => el.textContent.trim()).filter(Boolean);

		// Main visible text content
		const bodyText = (document.querySelector('main, [role="main"], #content, .content') || document.body)
			?.innerText?.replace(/\s+/g, ' ')?.trim()?.slice(0, 500) || '';

		return { url, title, headings, buttons, navLinks, contentLinks, inputs, tables, rowActions, alerts, bodyText };
	}`

	res, err := b.page.Evaluate(script)
	if err != nil {
		return "URL: " + b.page.URL(), err
	}
	m, _ := res.(map[string]interface{})

	parts := []string{
		"=== PAGE SNAPSHOT ===",
		"URL: " + strVal(m["url"]),
		"Title: " + strVal(m["title"]),
	}

	if hdgs := joinList(m["headings"]); hdgs != "" {
		parts = append(parts, "Headings: "+hdgs)
	}
	if btns := joinList(m["buttons"]); btns != "" {
		parts = append(parts, "Buttons: "+btns)
	}
	if rowAct := joinList(m["rowActions"]); rowAct != "" {
		parts = append(parts, "Row actions (in table): "+rowAct)
	}

	// Nav links
	if navLinks, ok := m["navLinks"].([]interface{}); ok && len(navLinks) > 0 {
		labels := []string{}
		for _, l := range navLinks {
			if lm, ok := l.(map[string]interface{}); ok {
				if txt := strVal(lm["text"]); txt != "" {
					labels = append(labels, txt)
				}
			}
		}
		if len(labels) > 0 {
			parts = append(parts, "Nav links: "+strings.Join(labels, ", "))
		}
	}
	if cLinks := joinList(m["contentLinks"]); cLinks != "" {
		parts = append(parts, "Content links: "+cLinks)
	}

	// Form fields with real labels
	if inputs, ok := m["inputs"].([]interface{}); ok && len(inputs) > 0 {
		fieldDescs := []string{}
		for _, inp := range inputs {
			if im, ok := inp.(map[string]interface{}); ok {
				label := strVal(im["label"])
				ph := strVal(im["placeholder"])
				typ := strVal(im["type"])
				name := strVal(im["name"])
				desc := label
				if desc == "" {
					desc = ph
				}
				if desc == "" {
					desc = name
				}
				if desc == "" {
					desc = typ
				}
				if typ == "select" {
					opts := joinList(im["options"])
					if opts != "" {
						desc += " [options: " + opts + "]"
					}
				}
				if desc != "" {
					fieldDescs = append(fieldDescs, "("+typ+") "+desc)
				}
			}
		}
		if len(fieldDescs) > 0 {
			parts = append(parts, "Form fields: "+strings.Join(fieldDescs, " | "))
		}
	}

	// Tables
	if tables, ok := m["tables"].([]interface{}); ok && len(tables) > 0 {
		for i, tbl := range tables {
			if tm, ok := tbl.(map[string]interface{}); ok {
				hdrs := joinList(tm["headers"])
				rows := strVal(tm["rows"])
				sample := joinList(tm["sample"])
				desc := fmt.Sprintf("Table %d: %s rows", i+1, rows)
				if hdrs != "" {
					desc += " | columns: " + hdrs
				}
				if sample != "" {
					desc += " | first row: " + sample
				}
				parts = append(parts, desc)
			}
		}
	}

	if alerts := joinList(m["alerts"]); alerts != "" {
		parts = append(parts, "⚠️ Alerts: "+alerts)
	}
	if bodyText := strVal(m["bodyText"]); bodyText != "" {
		parts = append(parts, "Page text: "+bodyText)
	}

	return strings.Join(parts, "\n"), nil
}

// ExecuteAction executes a BuddyAction on the page
func (b *Buddy) ExecuteAction(ctx context.Context, action BuddyAction) error {
	// Safety check: skip dangerous actions
	if isSafetyViolation(action) {
		return fmt.Errorf("action blocked for safety: %s %s", action.Type, action.Target)
	}

	// Natural delay
	delay := time.Duration(b.cfg.NaturalDelayMinMs+rand.Intn(b.cfg.NaturalDelayMaxMs-b.cfg.NaturalDelayMinMs)) * time.Millisecond
	time.Sleep(delay)

	switch action.Type {
	case "click":
		return b.clickBestMatch(action.Target)
	case "fill":
		return b.page.Locator(action.Target).First().Fill(action.Value)
	case "navigate":
		_, err := b.page.Goto(action.Target, playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(15000),
		})
		return err
	case "press_key":
		key := action.Value
		if key == "" {
			key = action.Target
		}
		return b.page.Keyboard().Press(key)
	case "scroll":
		script := `window.scrollBy(0, 300)`
		if strings.Contains(strings.ToLower(action.Value), "bottom") {
			script = `window.scrollTo(0, document.body.scrollHeight)`
		}
		_, err := b.page.Evaluate(script)
		return err
	case "wait":
		time.Sleep(2 * time.Second)
		return nil
	}
	return nil
}

// TakeScreenshotBase64 returns a base64-encoded screenshot
func (b *Buddy) TakeScreenshotBase64() string {
	data, err := b.page.Screenshot(playwright.PageScreenshotOptions{
		FullPage: playwright.Bool(false),
		Type:     playwright.ScreenshotTypePng,
	})
	if err != nil {
		return ""
	}
	return base64.StdEncoding.EncodeToString(data)
}

// GetHints returns context-aware hint chips for the UI
func (b *Buddy) GetHints(state models.RunState) []string {
	hintMap := map[models.RunState][]string{
		models.StateWaitLoginInput:    {"admin:password", "user@example.com:secret", "skip - no login needed"},
		models.StateWaitManualLogin:   {"done", "skip - continue without login"},
		models.StateDiscoveryRun:      {"Focus on forms only", "Stop discovery now", "Skip current page"},
		models.StateWaitTestIntent:    {"Run smoke tests", "Test all forms", "Check navigation", "Full exploratory", "Custom scenario"},
		models.StateWaitBuddyGuidance: {"Click Accept Cookies", "Close popup", "Press Enter", "Skip this screen", "Go to next page", "Scroll down"},
		models.StateDone:              {"Show coverage gaps", "Export test cases", "Rerun failed tests", "Generate new report"},
	}
	if hints, ok := hintMap[state]; ok {
		return hints
	}
	return []string{"What can you test?", "Run full QA", "Check forms", "Find broken links"}
}

// --- Private helpers ---

func (b *Buddy) handleCommand(ctx context.Context, message string) (string, bool) {
	lower := strings.ToLower(strings.TrimSpace(message))
	switch {
	case lower == "/smoke" || strings.Contains(lower, "smoke test"):
		b.publishBuddyMsg("Running smoke tests — testing critical paths only...")
		return "I'll run smoke tests on the critical paths.", true
	case lower == "/forms" || strings.Contains(lower, "test all forms"):
		b.publishBuddyMsg("Finding and testing all forms on the app...")
		return "I'll find and test all forms. Starting with the visible ones.", true
	case lower == "/links" || strings.Contains(lower, "find broken links"):
		b.publishBuddyMsg("Checking all navigation links for broken URLs...")
		return "Checking all navigation links. I'll report any 404s or errors.", true
	case lower == "/coverage":
		return "Coverage is calculated based on features found vs. tests passed. Check the Coverage tab for details.", true
	}
	return "", false
}

func (b *Buddy) ruleBasedHandle(ctx context.Context, message string) (string, error) {
	lower := strings.ToLower(message)

	// Try to click a button matching the instruction
	if strings.Contains(lower, "click") {
		// Extract what to click
		target := extractTarget(message, "click")
		if err := b.clickBestMatch(target); err == nil {
			return fmt.Sprintf("Clicked '%s'!", target), nil
		}
	}

	if strings.Contains(lower, "press enter") || message == "Enter" {
		b.page.Keyboard().Press("Enter")
		return "Pressed Enter!", nil
	}

	if strings.Contains(lower, "scroll down") {
		b.page.Evaluate(`window.scrollBy(0, 500)`)
		return "Scrolled down!", nil
	}

	if strings.Contains(lower, "go to") || strings.Contains(lower, "navigate to") {
		target := extractTarget(message, "go to")
		if target == "" {
			target = extractTarget(message, "navigate to")
		}
		if target != "" {
			b.page.Goto(target, playwright.PageGotoOptions{
				WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			})
			return fmt.Sprintf("Navigated to %s!", target), nil
		}
	}

	return "I'll try my best. What specific action would you like me to take?", nil
}

func (b *Buddy) tryDismissWithText(ctx context.Context, text string) bool {
	selectors := []string{
		fmt.Sprintf(`button:has-text("%s")`, text),
		fmt.Sprintf(`[aria-label*="%s" i]`, text),
		fmt.Sprintf(`[data-testid*="accept"]`),
		`button.accept-all`, `.cookie-accept`, `#accept-cookies`,
	}
	for _, sel := range selectors {
		loc := b.page.Locator(sel).First()
		if visible, _ := loc.IsVisible(); visible {
			loc.Click()
			time.Sleep(500 * time.Millisecond)
			return true
		}
	}
	return false
}

func (b *Buddy) clickBestMatch(target string) error {
	if target == "" {
		return fmt.Errorf("no target specified")
	}
	selectors := []string{
		target, // try as CSS selector first
		fmt.Sprintf(`button:has-text("%s")`, target),
		fmt.Sprintf(`a:has-text("%s")`, target),
		fmt.Sprintf(`[aria-label*="%s" i]`, target),
		fmt.Sprintf(`[data-testid*="%s"]`, strings.ToLower(strings.ReplaceAll(target, " ", "-"))),
	}
	for _, sel := range selectors {
		loc := b.page.Locator(sel).First()
		if visible, _ := loc.IsVisible(); visible {
			return loc.Click()
		}
	}
	return fmt.Errorf("could not find element matching: %s", target)
}

func (b *Buddy) parseNaturalInstruction(instruction string) *BuddyAction {
	lower := strings.ToLower(instruction)
	if strings.HasPrefix(lower, "click ") {
		target := strings.TrimPrefix(instruction, "click ")
		target = strings.TrimPrefix(target, "Click ")
		return &BuddyAction{Type: "click", Target: target, Reason: "user instruction"}
	}
	if strings.Contains(lower, "press enter") {
		return &BuddyAction{Type: "press_key", Target: "Enter", Reason: "user instruction"}
	}
	if strings.Contains(lower, "scroll down") {
		return &BuddyAction{Type: "scroll", Value: "down", Reason: "user instruction"}
	}
	if strings.HasPrefix(lower, "go to ") || strings.HasPrefix(lower, "navigate to ") {
		target := strings.TrimPrefix(lower, "go to ")
		target = strings.TrimPrefix(target, "navigate to ")
		return &BuddyAction{Type: "navigate", Target: target, Reason: "user instruction"}
	}
	return nil
}

func (b *Buddy) learnBlockerPattern(screenSignature, pageURL string, action BuddyAction) {
	if b.db == nil {
		return
	}
	pattern := &models.BlockerPattern{
		URLPattern:       extractURLPattern(pageURL),
		ScreenSignature:  screenSignature,
		Action:           action.Type,
		ActionTarget:     action.Target,
		ActionValue:      action.Value,
		LearnedFromRunID: b.runID,
	}
	b.db.SaveBlockerPattern(pattern)
}

func (b *Buddy) publishBuddyMsg(msg string) {
	b.runStore.Publish(models.NewEvent(b.runID, models.EventBuddyMessage, models.BuddyMessageData{
		Message: msg,
		IsUser:  false,
	}))
}

func parseAction(response string) (*BuddyAction, error) {
	// Extract JSON from response (AI might wrap it in markdown)
	start := strings.Index(response, "{")
	end := strings.LastIndex(response, "}")
	if start < 0 || end < 0 || end <= start {
		return nil, fmt.Errorf("no JSON found in response")
	}
	jsonStr := response[start : end+1]

	var action BuddyAction
	if err := json.Unmarshal([]byte(jsonStr), &action); err != nil {
		return nil, err
	}
	return &action, nil
}

func isSafetyViolation(action BuddyAction) bool {
	dangerous := []string{"delete", "remove", "logout", "sign-out", "destroy", "drop", "truncate"}
	target := strings.ToLower(action.Target + " " + action.Value)
	for _, d := range dangerous {
		if strings.Contains(target, d) {
			return true
		}
	}
	return false
}

func extractTarget(message, prefix string) string {
	lower := strings.ToLower(message)
	idx := strings.Index(lower, prefix)
	if idx < 0 {
		return ""
	}
	return strings.TrimSpace(message[idx+len(prefix):])
}

func extractURLPattern(pageURL string) string {
	// Replace numeric IDs with *
	parts := strings.Split(pageURL, "/")
	for i, p := range parts {
		isNumeric := true
		for _, c := range p {
			if c < '0' || c > '9' {
				isNumeric = false
				break
			}
		}
		if isNumeric && p != "" {
			parts[i] = "*"
		}
	}
	return strings.Join(parts, "/")
}

func matchesURLPattern(url, pattern string) bool {
	if pattern == "" {
		return false
	}
	return strings.Contains(url, strings.ReplaceAll(pattern, "*", ""))
}

func strVal(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func joinList(v interface{}) string {
	if arr, ok := v.([]interface{}); ok {
		var items []string
		for _, item := range arr {
			if s, ok := item.(string); ok && s != "" {
				items = append(items, s)
			}
		}
		return strings.Join(items, ", ")
	}
	return ""
}

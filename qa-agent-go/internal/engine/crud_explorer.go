package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
	"github.com/qabuddy/agent/internal/ai"
	"github.com/qabuddy/agent/internal/config"
	"github.com/qabuddy/agent/internal/models"
	"github.com/qabuddy/agent/internal/store"
	"github.com/rs/zerolog/log"
)

// FieldProbe holds info about a single discovered form field.
type FieldProbe struct {
	Selector string
	Label    string
	Type     string // text, email, number, select, textarea, checkbox, radio, password
	Options  []struct{ Value, Text string }
	Required bool
}

// PageInfo holds discovered selectors and structure for a resource list page.
type PageInfo struct {
	Headers   []string
	RowCount  int
	AddSel    string
	EditSel   string
	DeleteSel string
	SearchSel string
}

// CRUDModuleResult summarises what was attempted/achieved for one resource module.
type CRUDModuleResult struct {
	ResourceName    string
	URL             string
	TableHeaders    []string
	CreateAttempted bool
	CreateSuccess   bool
	EditAttempted   bool
	EditSuccess     bool
	DeleteAttempted bool
	DeleteSuccess   bool
	Notes           []string
}

// CRUDExplorer navigates to each resource page and performs Create → Edit → Delete.
type CRUDExplorer struct {
	page     playwright.Page
	provider ai.Provider
	runID    string
	runStore *store.RunStore
	cfg      *config.Config
}

// NewCRUDExplorer creates a new CRUDExplorer.
func NewCRUDExplorer(
	page playwright.Page,
	provider ai.Provider,
	runID string,
	s *store.RunStore,
	cfg *config.Config,
) *CRUDExplorer {
	return &CRUDExplorer{
		page:     page,
		provider: provider,
		runID:    runID,
		runStore: s,
		cfg:      cfg,
	}
}

// ExploreAll iterates every discovered page that has FeatureResourceCRUD and
// runs a full Create → Edit → Delete cycle on each.
func (e *CRUDExplorer) ExploreAll(ctx context.Context, pages []store.DiscoveredPage) []CRUDModuleResult {
	var results []CRUDModuleResult
	seen := map[string]bool{}

	for _, p := range pages {
		if seen[p.URL] {
			continue
		}
		hasCRUD := false
		for _, ft := range p.Features {
			if ft == models.FeatureResourceCRUD {
				hasCRUD = true
				break
			}
		}
		if !hasCRUD {
			continue
		}
		seen[p.URL] = true

		resourceName := extractResourceName(p.URL, p.Title)
		e.log("Exploring CRUD for: " + resourceName + " (" + p.URL + ")")

		result := e.ExploreModule(ctx, p.URL, resourceName)
		results = append(results, *result)
	}
	return results
}

// ExploreModule runs Create → Edit → Delete on a single resource page.
func (e *CRUDExplorer) ExploreModule(ctx context.Context, resourceURL, resourceName string) *CRUDModuleResult {
	result := &CRUDModuleResult{
		ResourceName: resourceName,
		URL:          resourceURL,
	}

	// Navigate to resource page
	if _, err := e.page.Goto(resourceURL, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(15000),
	}); err != nil {
		result.Notes = append(result.Notes, "navigate failed: "+err.Error())
		return result
	}
	time.Sleep(600 * time.Millisecond)

	info := e.detectPageInfo()
	result.TableHeaders = info.Headers

	e.log(fmt.Sprintf("%s: headers=%v addSel=%q editSel=%q deleteSel=%q",
		resourceName, info.Headers, info.AddSel, info.EditSel, info.DeleteSel))

	// ── CREATE ──
	if info.AddSel != "" {
		result.CreateAttempted = true
		ok := e.attemptCreate(ctx, info, resourceName)
		result.CreateSuccess = ok
		note := "Create"
		if ok {
			note += " ✓"
		} else {
			note += " ✗"
		}
		result.Notes = append(result.Notes, note)
	}

	// Navigate back to list
	e.navBack(resourceURL)

	// Re-detect page info after potential navigation
	info = e.detectPageInfo()

	// ── EDIT ──
	if info.EditSel != "" {
		result.EditAttempted = true
		ok := e.attemptEdit(ctx, info, resourceName)
		result.EditSuccess = ok
		note := "Edit"
		if ok {
			note += " ✓"
		} else {
			note += " ✗"
		}
		result.Notes = append(result.Notes, note)
	}

	// Navigate back
	e.navBack(resourceURL)
	info = e.detectPageInfo()

	// ── DELETE ──
	if info.DeleteSel != "" {
		result.DeleteAttempted = true
		ok := e.attemptDelete(info)
		result.DeleteSuccess = ok
		note := "Delete"
		if ok {
			note += " ✓"
		} else {
			note += " ✗"
		}
		result.Notes = append(result.Notes, note)
	}

	return result
}

// detectPageInfo probes the current page for table structure and CRUD button selectors.
func (e *CRUDExplorer) detectPageInfo() PageInfo {
	script := `() => {
		// Table headers
		const headers = Array.from(document.querySelectorAll('table th, [role="grid"] [role="columnheader"]'))
			.map(th => th.textContent.trim()).filter(Boolean);

		// Row count
		const rowCount = document.querySelectorAll('table tbody tr, [role="grid"] [role="row"]').length;

		// Add/Create button — scan all visible buttons/links
		const addWords = ['add', 'create', 'new', 'invite', 'register', '+'];
		let addSel = '';
		for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
			if (el.offsetParent === null) continue;
			const txt = (el.textContent || '').trim().toLowerCase();
			if (addWords.some(w => txt === w || txt.startsWith(w + ' ') || txt.endsWith(' ' + w) || txt === '+' + w)) {
				addSel = el.id ? '#' + el.id
					: (el.getAttribute('data-testid') ? '[data-testid="' + el.getAttribute('data-testid') + '"]'
					: (el.className.trim() ? el.tagName.toLowerCase() + '.' + el.className.trim().split(/\s+/)[0]
					: el.tagName.toLowerCase()));
				break;
			}
		}

		// Edit button in rows
		const editWords = ['edit', 'modify', 'update', 'rename', 'change'];
		let editSel = '';
		for (const el of document.querySelectorAll('td button, td a, [role="row"] button, [role="row"] a, [class*="action"] button, [class*="action"] a')) {
			if (el.offsetParent === null) continue;
			const txt = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
			if (editWords.some(w => txt.includes(w))) {
				editSel = el.id ? '#' + el.id
					: (el.getAttribute('data-testid') ? '[data-testid="' + el.getAttribute('data-testid') + '"]'
					: (el.className.trim() ? el.tagName.toLowerCase() + '.' + el.className.trim().split(/\s+/)[0]
					: el.tagName.toLowerCase()));
				break;
			}
		}

		// Delete button in rows
		const deleteWords = ['delete', 'remove', 'trash', 'archive'];
		let deleteSel = '';
		for (const el of document.querySelectorAll('td button, td a, [role="row"] button, [role="row"] a, [class*="action"] button, [class*="action"] a')) {
			if (el.offsetParent === null) continue;
			const txt = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
			if (deleteWords.some(w => txt.includes(w))) {
				deleteSel = el.id ? '#' + el.id
					: (el.getAttribute('data-testid') ? '[data-testid="' + el.getAttribute('data-testid') + '"]'
					: (el.className.trim() ? el.tagName.toLowerCase() + '.' + el.className.trim().split(/\s+/)[0]
					: el.tagName.toLowerCase()));
				break;
			}
		}

		// Search input
		const searchEl = document.querySelector('input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i]');
		const searchSel = searchEl ? (searchEl.id ? '#' + searchEl.id : 'input[type="search"]') : '';

		return { headers, rowCount, addSel, editSel, deleteSel, searchSel };
	}`

	res, err := e.page.Evaluate(script)
	if err != nil {
		log.Warn().Err(err).Msg("detectPageInfo failed")
		return PageInfo{}
	}
	m, ok := res.(map[string]interface{})
	if !ok {
		return PageInfo{}
	}

	info := PageInfo{
		AddSel:    strVal(m["addSel"]),
		EditSel:   strVal(m["editSel"]),
		DeleteSel: strVal(m["deleteSel"]),
		SearchSel: strVal(m["searchSel"]),
	}
	if rc, ok := m["rowCount"].(float64); ok {
		info.RowCount = int(rc)
	}
	if hdrs, ok := m["headers"].([]interface{}); ok {
		for _, h := range hdrs {
			if s, ok := h.(string); ok && s != "" {
				info.Headers = append(info.Headers, s)
			}
		}
	}
	return info
}

// probeOpenForm reads all visible form fields in the active dialog or form.
func (e *CRUDExplorer) probeOpenForm() []FieldProbe {
	script := `() => {
		const container =
			document.querySelector('[role="dialog"]:not([aria-hidden="true"])') ||
			document.querySelector('.modal.show .modal-content') ||
			document.querySelector('.modal-content') ||
			document.querySelector('form') ||
			document.body;
		return Array.from(container.querySelectorAll(
			'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([disabled]),' +
			'textarea:not([disabled]), select:not([disabled])'
		)).filter(el => el.offsetParent !== null).slice(0, 15).map(el => {
			const labelEl = el.id ? document.querySelector('label[for="' + el.id + '"]') : null;
			const label = (labelEl?.textContent?.trim()) ||
				el.getAttribute('aria-label') || el.placeholder || el.name || el.id || '';
			const type = el.tagName === 'SELECT' ? 'select' : (el.type || 'text');
			const options = el.tagName === 'SELECT'
				? Array.from(el.options).map(o => ({ value: o.value, text: o.text.trim() }))
				: [];
			const sel = el.id ? '#' + el.id
				: (el.name ? '[name="' + el.name + '"]'
				: el.tagName.toLowerCase());
			return { selector: sel, label, type, options, required: el.required };
		});
	}`

	res, err := e.page.Evaluate(script)
	if err != nil {
		return nil
	}
	items, ok := res.([]interface{})
	if !ok {
		return nil
	}
	var fields []FieldProbe
	for _, item := range items {
		fm, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		fp := FieldProbe{
			Selector: strVal(fm["selector"]),
			Label:    strVal(fm["label"]),
			Type:     strVal(fm["type"]),
			Required: boolVal(fm["required"]),
		}
		if opts, ok := fm["options"].([]interface{}); ok {
			for _, opt := range opts {
				om, ok := opt.(map[string]interface{})
				if !ok {
					continue
				}
				fp.Options = append(fp.Options, struct{ Value, Text string }{
					Value: strVal(om["value"]),
					Text:  strVal(om["text"]),
				})
			}
		}
		fields = append(fields, fp)
	}
	return fields
}

// generateValues returns fill values for each field using AI when available,
// falling back to label-based heuristics.
func (e *CRUDExplorer) generateValues(ctx context.Context, fields []FieldProbe, resourceName string) []struct{ Selector, Value string } {
	result := make([]struct{ Selector, Value string }, 0, len(fields))

	// Try AI path
	if e.provider != nil && e.provider.IsAvailable(ctx) {
		type fieldDesc struct {
			Selector string `json:"selector"`
			Label    string `json:"label"`
			Type     string `json:"type"`
		}
		descs := make([]fieldDesc, 0, len(fields))
		for _, f := range fields {
			descs = append(descs, fieldDesc{Selector: f.Selector, Label: f.Label, Type: f.Type})
		}
		descJSON, _ := json.Marshal(descs)

		systemPrompt := `You are filling a web form for automated QA testing. Given form fields, provide realistic test data.
Respond ONLY with a JSON array: [{"selector": "...", "value": "..."}]
Rules: use realistic data, skip checkboxes/radios (omit them), for selects use the option value (not text), never use empty values for required fields.`
		userPrompt := fmt.Sprintf("Form is for managing '%s'. Fields:\n%s\n\nProvide fill values:", resourceName, string(descJSON))

		if response, err := e.provider.Complete(ctx, systemPrompt, userPrompt); err == nil {
			// Parse AI response
			var aiValues []struct {
				Selector string `json:"selector"`
				Value    string `json:"value"`
			}
			// Extract JSON from response (AI may add preamble)
			start := strings.Index(response, "[")
			end := strings.LastIndex(response, "]")
			if start >= 0 && end > start {
				if err := json.Unmarshal([]byte(response[start:end+1]), &aiValues); err == nil {
					// Build a selector→value map for fallback override
					aiMap := map[string]string{}
					for _, v := range aiValues {
						aiMap[v.Selector] = v.Value
					}
					for _, f := range fields {
						if f.Type == "checkbox" || f.Type == "radio" {
							continue
						}
						val := aiMap[f.Selector]
						if val == "" {
							val = generateValue(f.Label, f.Type, resourceName, f.Options)
						}
						result = append(result, struct{ Selector, Value string }{f.Selector, val})
					}
					return result
				}
			}
		}
	}

	// Heuristic fallback
	for _, f := range fields {
		if f.Type == "checkbox" || f.Type == "radio" {
			continue
		}
		val := generateValue(f.Label, f.Type, resourceName, f.Options)
		result = append(result, struct{ Selector, Value string }{f.Selector, val})
	}
	return result
}

// generateValue returns a context-aware test value for a single field.
func generateValue(label, fieldType, resourceName string, options []struct{ Value, Text string }) string {
	l := strings.ToLower(strings.TrimSpace(label))

	switch {
	case strings.Contains(l, "email"):
		return "qa_test@example.com"
	case strings.Contains(l, "first") && strings.Contains(l, "name"):
		return "QA"
	case strings.Contains(l, "last") && strings.Contains(l, "name"):
		return "Tester"
	case strings.Contains(l, "name") || strings.Contains(l, "title"):
		return "QA Test " + resourceName
	case strings.Contains(l, "phone") || strings.Contains(l, "tel") || strings.Contains(l, "mobile"):
		return "+15550100"
	case strings.Contains(l, "url") || strings.Contains(l, "website") || strings.Contains(l, "link"):
		return "https://example.com"
	case strings.Contains(l, "address"):
		return "123 Test Street"
	case strings.Contains(l, "city"):
		return "Test City"
	case strings.Contains(l, "zip") || strings.Contains(l, "postal"):
		return "12345"
	case strings.Contains(l, "country"):
		return "US"
	case strings.Contains(l, "state") || strings.Contains(l, "province") || strings.Contains(l, "region"):
		return "CA"
	case strings.Contains(l, "description") || strings.Contains(l, "bio") || strings.Contains(l, "about") || strings.Contains(l, "note") || strings.Contains(l, "comment"):
		return "QA test entry created by automated testing"
	case strings.Contains(l, "price") || strings.Contains(l, "amount") || strings.Contains(l, "cost") || strings.Contains(l, "salary"):
		return "10.00"
	case strings.Contains(l, "age") || strings.Contains(l, "qty") || strings.Contains(l, "quantity") || strings.Contains(l, "count"):
		return "1"
	case strings.Contains(l, "date"):
		return time.Now().Format("2006-01-02")
	case strings.Contains(l, "pass"):
		return "Test@1234!"
	case strings.Contains(l, "username") || strings.Contains(l, "user name") || strings.Contains(l, "login"):
		return "qa_tester"
	case fieldType == "number":
		return "1"
	case fieldType == "email":
		return "qa_test@example.com"
	case fieldType == "tel":
		return "+15550100"
	case fieldType == "date":
		return time.Now().Format("2006-01-02")
	case fieldType == "select":
		// Pick first non-empty option
		for _, opt := range options {
			if opt.Value != "" && opt.Value != "0" && opt.Value != "-1" {
				return opt.Value
			}
		}
		if len(options) > 1 {
			return options[1].Value
		}
		return ""
	default:
		return "QA Test Value"
	}
}

// attemptCreate clicks Add, probes the form, fills it, and submits.
func (e *CRUDExplorer) attemptCreate(ctx context.Context, info PageInfo, resourceName string) bool {
	addFallbacks := []string{"Add", "Create", "New", "+ Add", "Add New", "Invite", "Register"}
	if !e.clickButton(info.AddSel, addFallbacks) {
		e.log("Create: could not click Add button")
		return false
	}
	time.Sleep(700 * time.Millisecond)

	fields := e.probeOpenForm()
	if len(fields) == 0 {
		// Form may have opened on a new page — try probing again
		time.Sleep(500 * time.Millisecond)
		fields = e.probeOpenForm()
	}
	if len(fields) == 0 {
		e.log("Create: no form fields found after clicking Add")
		return false
	}

	values := e.generateValues(ctx, fields, resourceName)
	e.log(fmt.Sprintf("Create: filling %d fields for %s", len(values), resourceName))

	for _, fv := range values {
		if fv.Value == "" {
			continue
		}
		loc := e.page.Locator(fv.Selector).First()
		if visible, _ := loc.IsVisible(); !visible {
			continue
		}
		// Use SelectOption for selects, Fill for everything else
		if strings.HasPrefix(fv.Selector, "select") || e.isSelect(fv.Selector) {
			e.page.Locator(fv.Selector).First().SelectOption(playwright.SelectOptionValues{
				Values: &[]string{fv.Value},
			})
		} else {
			loc.Fill(fv.Value)
		}
	}

	time.Sleep(300 * time.Millisecond)
	if !e.submitForm() {
		e.log("Create: could not find submit button")
		return false
	}
	time.Sleep(900 * time.Millisecond)

	return e.checkActionSuccess()
}

// attemptEdit clicks Edit on the first row, modifies a field, and saves.
func (e *CRUDExplorer) attemptEdit(ctx context.Context, info PageInfo, resourceName string) bool {
	editFallbacks := []string{"Edit", "Modify", "Update", "Rename"}
	if !e.clickButton(info.EditSel, editFallbacks) {
		e.log("Edit: could not click Edit button")
		return false
	}
	time.Sleep(700 * time.Millisecond)

	fields := e.probeOpenForm()
	if len(fields) == 0 {
		time.Sleep(500 * time.Millisecond)
		fields = e.probeOpenForm()
	}
	if len(fields) == 0 {
		e.log("Edit: no form fields found")
		return false
	}

	// Modify the first editable text/textarea/email field
	modified := false
	for _, f := range fields {
		if f.Type == "text" || f.Type == "email" || f.Type == "textarea" || f.Type == "" {
			loc := e.page.Locator(f.Selector).First()
			if visible, _ := loc.IsVisible(); visible {
				loc.Fill("QA Edited " + resourceName)
				modified = true
				break
			}
		}
	}
	if !modified {
		e.log("Edit: could not find a text field to modify")
		return false
	}

	time.Sleep(200 * time.Millisecond)
	if !e.submitForm() {
		e.log("Edit: could not find save/submit button")
		return false
	}
	time.Sleep(700 * time.Millisecond)

	return e.checkActionSuccess()
}

// attemptDelete clicks Delete on the first row and confirms any dialog.
func (e *CRUDExplorer) attemptDelete(info PageInfo) bool {
	deleteFallbacks := []string{"Delete", "Remove", "Archive"}
	if !e.clickButton(info.DeleteSel, deleteFallbacks) {
		e.log("Delete: could not click Delete button")
		return false
	}
	time.Sleep(500 * time.Millisecond)

	// Try to confirm the deletion dialog
	confirmSelectors := []string{
		`button:has-text("Confirm")`,
		`button:has-text("Yes")`,
		`button:has-text("Delete")`,
		`button:has-text("OK")`,
		`button:has-text("Yes, delete")`,
		`[data-testid*="confirm"]`,
		`[data-testid*="delete-confirm"]`,
	}
	for _, sel := range confirmSelectors {
		loc := e.page.Locator(sel).First()
		if visible, _ := loc.IsVisible(); visible {
			loc.Click()
			break
		}
	}
	time.Sleep(700 * time.Millisecond)

	return e.checkActionSuccess()
}

// clickButton tries the primary selector, then text-based fallbacks.
func (e *CRUDExplorer) clickButton(primarySel string, textFallbacks []string) bool {
	if primarySel != "" {
		loc := e.page.Locator(primarySel).First()
		if visible, _ := loc.IsVisible(); visible {
			if err := loc.Click(); err == nil {
				return true
			}
		}
	}
	for _, text := range textFallbacks {
		loc := e.page.Locator("text=" + text).First()
		if visible, _ := loc.IsVisible(); visible {
			if err := loc.Click(); err == nil {
				return true
			}
		}
	}
	return false
}

// submitForm tries common submit button selectors.
func (e *CRUDExplorer) submitForm() bool {
	submitSels := []string{
		`button[type="submit"]`,
		`input[type="submit"]`,
		`button:has-text("Save")`,
		`button:has-text("Create")`,
		`button:has-text("Submit")`,
		`button:has-text("Add")`,
		`button:has-text("Invite")`,
		`button:has-text("Register")`,
		`button:has-text("Confirm")`,
	}
	for _, sel := range submitSels {
		loc := e.page.Locator(sel).First()
		if visible, _ := loc.IsVisible(); visible {
			if err := loc.Click(); err == nil {
				return true
			}
		}
	}
	return false
}

// checkActionSuccess returns true if the form closed or a success indicator appeared.
func (e *CRUDExplorer) checkActionSuccess() bool {
	// Check for open dialog — if dialog is gone, action probably succeeded
	script := `() => {
		const dialog = document.querySelector('[role="dialog"]:not([aria-hidden="true"])');
		const toast = document.querySelector('[role="alert"], .toast, .notification, .snackbar, [class*="success"], [class*="toast"]');
		const errorMsg = document.querySelector('.error, .alert-danger, [class*="error"]:not([class*="no-error"])');
		return {
			dialogOpen: !!dialog,
			hasSuccess: !!(toast && !errorMsg),
			hasError: !!(errorMsg),
		};
	}`
	res, err := e.page.Evaluate(script)
	if err != nil {
		return false
	}
	m, ok := res.(map[string]interface{})
	if !ok {
		return false
	}
	dialogOpen, _ := m["dialogOpen"].(bool)
	hasError, _ := m["hasError"].(bool)
	// Success if dialog closed without error
	return !dialogOpen && !hasError
}

// isSelect checks if the field at the given selector is a <select> element.
func (e *CRUDExplorer) isSelect(sel string) bool {
	script := fmt.Sprintf(`() => {
		const el = document.querySelector('%s');
		return el ? el.tagName.toLowerCase() === 'select' : false;
	}`, strings.ReplaceAll(sel, "'", "\\'"))
	res, _ := e.page.Evaluate(script)
	b, _ := res.(bool)
	return b
}

// navBack navigates back to the resource list URL.
func (e *CRUDExplorer) navBack(resourceURL string) {
	e.page.Goto(resourceURL, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(12000),
	})
	time.Sleep(500 * time.Millisecond)
}

// log publishes an info log event to the run store.
func (e *CRUDExplorer) log(msg string) {
	log.Info().Str("run_id", e.runID).Msg("[CRUD] " + msg)
	e.runStore.Publish(models.NewEvent(e.runID, models.EventLog, models.LogData{
		Level:   "info",
		Message: "[CRUD] " + msg,
	}))
}

// extractResourceName derives a human-readable resource name from a URL path or page title.
// Examples: "/users" → "User", "/admin/product-categories" → "Product Category"
func extractResourceName(rawURL, title string) string {
	if title != "" && title != "untitled" && title != "Untitled" {
		return strings.TrimSpace(title)
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Path == "" || parsed.Path == "/" {
		return "Resource"
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) == 0 {
		return "Resource"
	}
	last := parts[len(parts)-1]
	// Strip trailing 's' for singular form
	if len(last) > 2 && strings.HasSuffix(last, "s") && !strings.HasSuffix(last, "ss") {
		last = last[:len(last)-1]
	}
	// Title-case words split by hyphen/underscore
	words := strings.FieldsFunc(last, func(r rune) bool { return r == '-' || r == '_' })
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}

// strVal safely extracts a string from an interface{}.
func strVal(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// boolVal safely extracts a bool from an interface{}.
func boolVal(v interface{}) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}

package discovery

import (
	"fmt"
	"strings"

	"github.com/playwright-community/playwright-go"
	"github.com/qabuddy/agent/internal/models"
	"github.com/qabuddy/agent/internal/store"
)

// DetectedFeature holds one detected UI feature on a page
type DetectedFeature struct {
	Type     models.FeatureType
	Selector string
	Label    string
	Count    int
	Details  map[string]interface{}
}

// PageFeatures holds all detected features for a page
type PageFeatures struct {
	URL      string
	Features []DetectedFeature
	Forms    []store.PageForm
	Tables   []store.PageTable
	NavLinks []store.NavLink
}

// FeatureDetector detects UI features on a Playwright page
type FeatureDetector struct{}

// NewFeatureDetector creates a new FeatureDetector
func NewFeatureDetector() *FeatureDetector {
	return &FeatureDetector{}
}

// DetectFeatures runs all feature detectors on the current page
func (d *FeatureDetector) DetectFeatures(page playwright.Page) (*PageFeatures, error) {
	url := page.URL()
	pf := &PageFeatures{URL: url}

	detectors := []func(playwright.Page) (*DetectedFeature, error){
		d.detectSearch,
		d.detectPagination,
		d.detectFilter,
		d.detectTabs,
		d.detectModal,
		d.detectFileUpload,
		d.detectDatePicker,
		d.detectMultiSelect,
		d.detectRichText,
		d.detectInfiniteScroll,
		d.detectAccordion,
		d.detectStepper,
		d.detectChart,
		d.detectNotification,
		d.detectDragDrop,
		d.detectDataTable,
	}

	for _, detect := range detectors {
		feature, err := detect(page)
		if err != nil || feature == nil {
			continue
		}
		pf.Features = append(pf.Features, *feature)
	}

	// Always detect forms, tables, navigation
	forms, _ := d.ExtractForms(page)
	pf.Forms = forms
	if len(forms) > 0 {
		pf.Features = append(pf.Features, DetectedFeature{
			Type: models.FeatureForm, Count: len(forms),
			Selector: "form", Label: fmt.Sprintf("%d form(s)", len(forms)),
		})
	}

	tables, _ := d.ExtractTables(page)
	pf.Tables = tables
	if len(tables) > 0 {
		pf.Features = append(pf.Features, DetectedFeature{
			Type: models.FeatureDataTable, Count: len(tables),
			Selector: "table", Label: fmt.Sprintf("%d table(s)", len(tables)),
		})
		if tables[0].HasPagination {
			pf.Features = append(pf.Features, DetectedFeature{Type: models.FeaturePagination, Selector: ".pagination"})
		}
		if tables[0].HasSort {
			pf.Features = append(pf.Features, DetectedFeature{Type: models.FeatureFilter, Selector: "th[aria-sort]"})
		}
	}

	links, _ := d.ExtractNavigationLinks(page)
	pf.NavLinks = links
	if len(links) > 0 {
		pf.Features = append(pf.Features, DetectedFeature{
			Type: models.FeatureNavigation, Count: len(links),
			Selector: "nav a", Label: fmt.Sprintf("%d nav links", len(links)),
		})
	}

	// Detect resource CRUD pages (list + add + edit + delete)
	if crudFeature, err := d.detectResourceCRUD(page); err == nil && crudFeature != nil {
		pf.Features = append(pf.Features, *crudFeature)
	}

	return pf, nil
}

// detectResourceCRUD detects pages that manage a resource (list + CRUD actions).
// These are the most important pages to generate comprehensive tests for.
func (d *FeatureDetector) detectResourceCRUD(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		// Must have a data list/table with rows
		const tableEl = document.querySelector('table tbody tr, [role="grid"] [role="row"], [role="table"] [role="row"]');
		const listEl  = !tableEl && document.querySelector('.list-group-item, .data-row, [class*="list-item"], [class*="row-item"]');
		if (!tableEl && !listEl) return null;

		const tableSel = tableEl ? 'table' : (listEl ? listEl.closest('[class]')?.tagName?.toLowerCase() || 'ul' : null);

		// Create/Add button detection
		const addTexts = ['add', 'create', 'new', 'invite', 'register', 'upload'];
		let addSel = '';
		const allBtns = Array.from(document.querySelectorAll('button, a[href], [role="button"]'));
		for (const el of allBtns) {
			const txt = (el.textContent || '').trim().toLowerCase();
			if (addTexts.some(t => txt === t || txt.startsWith(t + ' ') || txt.endsWith(' ' + t))) {
				if (el.id) addSel = '#' + el.id;
				else if (el.className) addSel = el.tagName.toLowerCase() + '.' + el.className.trim().split(/\s+/)[0];
				else addSel = el.tagName.toLowerCase();
				break;
			}
		}

		// Row-level Edit button
		const editTexts = ['edit', 'modify', 'update', 'rename', 'change'];
		let editSel = '';
		const rowBtns = document.querySelectorAll('td button, td a, [role="row"] button, [role="row"] a, [class*="action"] button');
		for (const el of rowBtns) {
			const txt = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
			if (editTexts.some(t => txt.includes(t))) {
				editSel = el.tagName.toLowerCase() + (el.className ? '.' + el.className.trim().split(/\s+/)[0] : '');
				break;
			}
		}

		// Row-level Delete button
		const deleteTexts = ['delete', 'remove', 'trash', 'archive'];
		let deleteSel = '';
		for (const el of rowBtns) {
			const txt = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
			if (deleteTexts.some(t => txt.includes(t))) {
				deleteSel = el.tagName.toLowerCase() + (el.className ? '.' + el.className.trim().split(/\s+/)[0] : '');
				break;
			}
		}

		// Search input on the list page
		const searchEl = document.querySelector('input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i], input[name="q"]');
		const searchSel = searchEl ? (searchEl.id ? '#' + searchEl.id : searchEl.tagName.toLowerCase() + '[type="' + searchEl.type + '"]') : '';

		// Filter control (select/dropdown)
		const filterEl = document.querySelector('select[name*="filter"], select[aria-label*="filter" i], [data-testid*="filter"], [class*="filter"] select');
		const filterSel = filterEl ? (filterEl.id ? '#' + filterEl.id : 'select') : '';

		return {
			tableSel,
			addSel,
			editSel,
			deleteSel,
			searchSel,
			filterSel,
			hasAdd:    addSel !== '',
			hasEdit:   editSel !== '',
			hasDelete: deleteSel !== '',
			hasSearch: searchSel !== '',
			hasFilter: filterSel !== '',
		};
	}`

	res, err := page.Evaluate(script)
	if err != nil || res == nil {
		return nil, nil
	}
	m, ok := res.(map[string]interface{})
	if !ok {
		return nil, nil
	}

	tableSel, _ := m["tableSel"].(string)
	if tableSel == "" {
		return nil, nil
	}

	// Build details map for multi-selector template substitution
	details := map[string]interface{}{
		"table_sel":  tableSel,
		"add_sel":    m["addSel"],
		"edit_sel":   m["editSel"],
		"delete_sel": m["deleteSel"],
		"search_sel": m["searchSel"],
		"filter_sel": m["filterSel"],
		"has_add":    m["hasAdd"],
		"has_edit":   m["hasEdit"],
		"has_delete": m["hasDelete"],
		"has_search": m["hasSearch"],
		"has_filter": m["hasFilter"],
	}

	label := "Resource list"
	caps := []string{"list"}
	if hasAdd, _ := m["hasAdd"].(bool); hasAdd {
		caps = append(caps, "create")
	}
	if hasEdit, _ := m["hasEdit"].(bool); hasEdit {
		caps = append(caps, "edit")
	}
	if hasDelete, _ := m["hasDelete"].(bool); hasDelete {
		caps = append(caps, "delete")
	}
	if hasSearch, _ := m["hasSearch"].(bool); hasSearch {
		caps = append(caps, "search")
	}
	if hasFilter, _ := m["hasFilter"].(bool); hasFilter {
		caps = append(caps, "filter")
	}
	label = fmt.Sprintf("Resource CRUD page (%s)", strings.Join(caps, ", "))

	return &DetectedFeature{
		Type:     models.FeatureResourceCRUD,
		Selector: tableSel,
		Label:    label,
		Details:  details,
	}, nil
}

func (d *FeatureDetector) detectSearch(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const selectors = [
			'input[type="search"]',
			'input[placeholder*="search" i]',
			'input[placeholder*="Search" i]',
			'input[aria-label*="search" i]',
			'.search-input', '#search', '[data-testid*="search"]',
			'input[name="q"]', 'input[name="search"]'
		];
		for (const sel of selectors) {
			const el = document.querySelector(sel);
			if (el) return { found: true, selector: sel };
		}
		return { found: false };
	}`
	res, err := page.Evaluate(script)
	if err != nil {
		return nil, nil
	}
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		sel, _ := m["selector"].(string)
		return &DetectedFeature{Type: models.FeatureSearch, Selector: sel, Label: "Search input"}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectPagination(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const selectors = [
			'[aria-label*="pagination" i]', '.pagination', '[data-testid*="pagination"]',
			'button[aria-label="Next"]', 'button[aria-label="next page"]',
			'.page-item', 'nav[aria-label*="page"]'
		];
		for (const sel of selectors) {
			if (document.querySelector(sel)) return { found: true, selector: sel };
		}
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		sel, _ := m["selector"].(string)
		return &DetectedFeature{Type: models.FeaturePagination, Selector: sel, Label: "Pagination"}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectFilter(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const selectors = ['[data-testid*="filter"]', '.filter-panel', 'button[aria-label*="filter" i]',
			'select[name*="filter"]', '[aria-label*="filter" i]'];
		for (const sel of selectors) {
			if (document.querySelector(sel)) return { found: true, selector: sel };
		}
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		sel, _ := m["selector"].(string)
		return &DetectedFeature{Type: models.FeatureFilter, Selector: sel, Label: "Filter"}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectTabs(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const el = document.querySelector('[role="tablist"]') || document.querySelector('.tabs') ||
			document.querySelector('[data-testid*="tab"]');
		if (el) {
			const tabs = el.querySelectorAll('[role="tab"]');
			return { found: true, count: tabs.length, selector: '[role="tablist"]' };
		}
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		count := 0
		if c, ok := m["count"].(float64); ok {
			count = int(c)
		}
		return &DetectedFeature{Type: models.FeatureTabs, Selector: `[role="tablist"]`, Count: count}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectModal(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const triggers = document.querySelectorAll('button[data-bs-toggle="modal"], [data-testid*="modal-trigger"], button[aria-haspopup="dialog"]');
		if (triggers.length > 0) return { found: true, selector: 'button[aria-haspopup="dialog"]' };
		// Check if modal is already open
		const modal = document.querySelector('[role="dialog"]:not([aria-hidden="true"])');
		if (modal) return { found: true, selector: '[role="dialog"]' };
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		sel, _ := m["selector"].(string)
		return &DetectedFeature{Type: models.FeatureModal, Selector: sel, Label: "Modal/Dialog"}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectFileUpload(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const el = document.querySelector('input[type="file"]') || document.querySelector('.dropzone') ||
			document.querySelector('[data-testid*="upload"]');
		if (el) return { found: true };
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		return &DetectedFeature{Type: models.FeatureFileUpload, Selector: `input[type="file"]`}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectDatePicker(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const el = document.querySelector('input[type="date"]') || document.querySelector('input[type="datetime-local"]') ||
			document.querySelector('.flatpickr-input') || document.querySelector('.react-datepicker__input-container') ||
			document.querySelector('[data-testid*="date"]');
		if (el) return { found: true };
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		return &DetectedFeature{Type: models.FeatureDatePicker, Selector: `input[type="date"]`}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectMultiSelect(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const el = document.querySelector('select[multiple]') || document.querySelector('.react-select__multi-value') ||
			document.querySelector('.ant-select-multiple') || document.querySelector('[aria-multiselectable="true"]');
		if (el) return { found: true };
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		return &DetectedFeature{Type: models.FeatureMultiSelect, Selector: `select[multiple]`}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectRichText(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const el = document.querySelector('.ql-editor') || document.querySelector('.ProseMirror') ||
			document.querySelector('[contenteditable="true"]') || document.querySelector('.tiptap');
		if (el) return { found: true };
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		return &DetectedFeature{Type: models.FeatureRichText, Selector: `[contenteditable="true"]`}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectInfiniteScroll(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		// Check for infinite scroll indicators
		const el = document.querySelector('[data-testid*="infinite"]') || document.querySelector('.infinite-scroll-component') ||
			document.querySelector('[data-infinite-scroll]');
		if (el) return { found: true };
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		return &DetectedFeature{Type: models.FeatureInfScroll, Selector: `.infinite-scroll-component`}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectAccordion(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const el = document.querySelector('.accordion') || document.querySelector('details') ||
			document.querySelector('[data-testid*="accordion"]') || document.querySelector('[aria-expanded]');
		if (el) return { found: true, selector: el.tagName.toLowerCase() === 'details' ? 'details' : '.accordion' };
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		sel, _ := m["selector"].(string)
		return &DetectedFeature{Type: models.FeatureAccordion, Selector: sel}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectStepper(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const el = document.querySelector('.stepper') || document.querySelector('[data-testid*="step"]') ||
			document.querySelector('[aria-label*="step" i]') || document.querySelector('.wizard');
		if (el) return { found: true };
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		return &DetectedFeature{Type: models.FeatureStepper, Selector: `.stepper`}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectChart(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const el = document.querySelector('canvas') || document.querySelector('.recharts-wrapper') ||
			document.querySelector('.chartjs-render-monitor') || document.querySelector('[data-testid*="chart"]');
		if (el) return { found: true };
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		return &DetectedFeature{Type: models.FeatureChart, Selector: `canvas`}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectNotification(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const el = document.querySelector('[role="alert"]') || document.querySelector('.toast') ||
			document.querySelector('.notification') || document.querySelector('.snackbar') ||
			document.querySelector('[data-testid*="toast"]') || document.querySelector('[data-testid*="notification"]');
		if (el) return { found: true };
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		return &DetectedFeature{Type: models.FeatureNotification, Selector: `[role="alert"]`}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectDragDrop(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const el = document.querySelector('[draggable="true"]') || document.querySelector('.react-beautiful-dnd-draggable') ||
			document.querySelector('[data-rbd-draggable-id]') || document.querySelector('.sortable-item');
		if (el) return { found: true };
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		return &DetectedFeature{Type: models.FeatureDragDrop, Selector: `[draggable="true"]`}, nil
	}
	return nil, nil
}

func (d *FeatureDetector) detectDataTable(page playwright.Page) (*DetectedFeature, error) {
	script := `() => {
		const selectors = ['.ag-grid-react', '.ag-root', '[class*="DataGrid"]', '[data-testid*="grid"]'];
		for (const sel of selectors) {
			if (document.querySelector(sel)) return { found: true, selector: sel };
		}
		return { found: false };
	}`
	res, _ := page.Evaluate(script)
	m, _ := res.(map[string]interface{})
	if found, _ := m["found"].(bool); found {
		sel, _ := m["selector"].(string)
		return &DetectedFeature{Type: models.FeatureDataTable, Selector: sel, Label: "Data grid"}, nil
	}
	return nil, nil
}

// ExtractForms extracts all form data from the page
func (d *FeatureDetector) ExtractForms(page playwright.Page) ([]store.PageForm, error) {
	script := `() => {
		return Array.from(document.querySelectorAll('form')).map(form => ({
			id: form.id || '',
			action: form.action || '',
			method: form.method || 'get',
			fields: Array.from(form.querySelectorAll('input, select, textarea')).filter(el => {
				return el.type !== 'hidden' && el.type !== 'submit' && el.type !== 'button' &&
					!el.disabled && !el.readOnly;
			}).map(el => {
				const label = document.querySelector('label[for="' + el.id + '"]');
				const options = el.tagName === 'SELECT' ?
					Array.from(el.options).map(o => o.text) : [];
				return {
					name: el.name || el.id || '',
					type: el.type || el.tagName.toLowerCase(),
					label: label ? label.textContent.trim() : (el.placeholder || el.name || ''),
					placeholder: el.placeholder || '',
					required: el.required,
					options: options
				};
			})
		})).filter(f => f.fields.length > 0);
	}`

	res, err := page.Evaluate(script)
	if err != nil {
		return nil, err
	}

	rawForms, _ := res.([]interface{})
	var forms []store.PageForm
	for _, rf := range rawForms {
		fm, _ := rf.(map[string]interface{})
		form := store.PageForm{
			ID:     strVal(fm["id"]),
			Action: strVal(fm["action"]),
			Method: strVal(fm["method"]),
		}
		rawFields, _ := fm["fields"].([]interface{})
		for _, rfl := range rawFields {
			fl, _ := rfl.(map[string]interface{})
			field := store.FormField{
				Name:        strVal(fl["name"]),
				Type:        strVal(fl["type"]),
				Label:       strVal(fl["label"]),
				Placeholder: strVal(fl["placeholder"]),
				Required:    boolVal(fl["required"]),
			}
			if opts, ok := fl["options"].([]interface{}); ok {
				for _, o := range opts {
					if s, ok := o.(string); ok {
						field.Options = append(field.Options, s)
					}
				}
			}
			form.Fields = append(form.Fields, field)
		}
		forms = append(forms, form)
	}
	return forms, nil
}

// ExtractTables extracts table metadata from the page
func (d *FeatureDetector) ExtractTables(page playwright.Page) ([]store.PageTable, error) {
	script := `() => {
		return Array.from(document.querySelectorAll('table, [role="grid"]')).map(t => {
			const headers = Array.from(t.querySelectorAll('th, [role="columnheader"]')).map(h => h.textContent.trim()).filter(Boolean);
			const rows = t.querySelectorAll('tbody tr, [role="row"]');
			const hasPagination = !!(document.querySelector('[aria-label*="pagination" i]') || document.querySelector('.pagination'));
			const hasSort = !!t.querySelector('[aria-sort]');
			const hasFilter = !!document.querySelector('[aria-label*="filter" i]');
			return {
				id: t.id || '',
				headers: headers,
				hasSort: hasSort,
				hasFilter: hasFilter,
				hasPagination: hasPagination,
				rowCount: rows.length
			};
		}).filter(t => t.headers.length > 0);
	}`

	res, err := page.Evaluate(script)
	if err != nil {
		return nil, err
	}

	rawTables, _ := res.([]interface{})
	var tables []store.PageTable
	for _, rt := range rawTables {
		tm, _ := rt.(map[string]interface{})
		table := store.PageTable{
			ID:            strVal(tm["id"]),
			HasSort:       boolVal(tm["hasSort"]),
			HasFilter:     boolVal(tm["hasFilter"]),
			HasPagination: boolVal(tm["hasPagination"]),
		}
		if rc, ok := tm["rowCount"].(float64); ok {
			table.RowCount = int(rc)
		}
		if hdrs, ok := tm["headers"].([]interface{}); ok {
			for _, h := range hdrs {
				if s, ok := h.(string); ok && s != "" {
					table.Headers = append(table.Headers, s)
				}
			}
		}
		tables = append(tables, table)
	}
	return tables, nil
}

// ExtractNavigationLinks extracts navigation links from the page
func (d *FeatureDetector) ExtractNavigationLinks(page playwright.Page) ([]store.NavLink, error) {
	script := `() => {
		const navEl = document.querySelector('nav, [role="navigation"], .sidebar, .navbar');
		if (!navEl) return [];
		return Array.from(navEl.querySelectorAll('a')).map(a => ({
			text: a.textContent.trim(),
			url: a.href,
			isActive: a.classList.contains('active') || a.getAttribute('aria-current') === 'page'
		})).filter(l => l.text && l.url && !l.url.startsWith('javascript:'));
	}`

	res, err := page.Evaluate(script)
	if err != nil {
		return nil, err
	}

	rawLinks, _ := res.([]interface{})
	var links []store.NavLink
	for _, rl := range rawLinks {
		lm, _ := rl.(map[string]interface{})
		links = append(links, store.NavLink{
			Text:     strVal(lm["text"]),
			URL:      strVal(lm["url"]),
			IsActive: boolVal(lm["isActive"]),
		})
	}
	return links, nil
}

func strVal(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func boolVal(v interface{}) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}

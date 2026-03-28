package discovery

import (
	"context"
	"fmt"
	"math/rand"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/playwright-community/playwright-go"
	"github.com/qabuddy/agent/internal/config"
	"github.com/qabuddy/agent/internal/models"
	"github.com/qabuddy/agent/internal/store"
	"github.com/rs/zerolog/log"
)

// TestCaseCollector is an interface for generating test cases during discovery
type TestCaseCollector interface {
	CollectFromPage(pageURL string, features []DetectedFeature, forms []store.PageForm, tables []store.PageTable) []models.TestCase
}

// Crawler crawls a web application and discovers pages and features
type Crawler struct {
	page        playwright.Page
	baseURL     string
	baseDomain  string
	scope       models.DiscoveryScope
	cfg         *config.Config
	runStore    *store.RunStore
	runID       string
	visited     map[string]bool
	mu          sync.Mutex
	results     *store.DiscoveryResult
	featureDet  *FeatureDetector
	frameDet    *FrameworkDetector
	collector   TestCaseCollector
}

// NewCrawler creates a new Crawler
func NewCrawler(
	page playwright.Page,
	runID, baseURL string,
	scope models.DiscoveryScope,
	s *store.RunStore,
	cfg *config.Config,
	collector TestCaseCollector,
) (*Crawler, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid base URL: %w", err)
	}

	maxPages := scope.MaxPages
	if maxPages <= 0 {
		maxPages = cfg.MaxDiscoveryPages
	}
	scope.MaxPages = maxPages

	return &Crawler{
		page:       page,
		baseURL:    baseURL,
		baseDomain: parsed.Host,
		scope:      scope,
		cfg:        cfg,
		runStore:   s,
		runID:      runID,
		visited:    make(map[string]bool),
		results: &store.DiscoveryResult{
			Features: make(map[string][]models.FeatureType),
		},
		featureDet: NewFeatureDetector(),
		frameDet:   NewFrameworkDetector(),
		collector:  collector,
	}, nil
}

// Crawl starts the discovery process and returns all results
func (c *Crawler) Crawl(ctx context.Context) (*store.DiscoveryResult, error) {
	deadline := time.Now().Add(time.Duration(c.cfg.MaxDiscoveryTimeMin) * time.Minute)

	queue := []string{c.baseURL}

	for len(queue) > 0 && len(c.visited) < c.scope.MaxPages {
		if ctx.Err() != nil {
			return c.results, ctx.Err()
		}
		if time.Now().After(deadline) {
			log.Info().Str("run_id", c.runID).Msg("discovery time limit reached")
			break
		}

		nextURL := queue[0]
		queue = queue[1:]

		c.mu.Lock()
		if c.visited[nextURL] {
			c.mu.Unlock()
			continue
		}
		c.visited[nextURL] = true
		c.mu.Unlock()

		if !c.isSafeLink(nextURL) {
			continue
		}
		if !c.isInScope(nextURL) {
			continue
		}

		page, err := c.visitPage(ctx, nextURL)
		if err != nil {
			log.Warn().Err(err).Str("url", nextURL).Msg("failed to visit page")
			continue
		}

		// Extract new links and add to queue
		links, _ := c.extractLinks(page)
		for _, link := range links {
			c.mu.Lock()
			if !c.visited[link] {
				queue = append(queue, link)
			}
			c.mu.Unlock()
		}

		// Natural pacing between pages
		delay := time.Duration(c.cfg.NaturalDelayMinMs+rand.Intn(c.cfg.NaturalDelayMaxMs-c.cfg.NaturalDelayMinMs)) * time.Millisecond
		time.Sleep(delay)
	}

	// Deduplicate modules
	c.results.Modules = dedupStrings(c.results.Modules)
	return c.results, nil
}

// visitPage navigates to a URL, detects features, and generates test cases
func (c *Crawler) visitPage(ctx context.Context, pageURL string) (playwright.Page, error) {
	log.Debug().Str("url", pageURL).Msg("visiting page")

	navCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	_ = navCtx

	_, err := c.page.Goto(pageURL, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateNetworkidle,
		Timeout:   playwright.Float(15000),
	})
	if err != nil {
		// Try domcontentloaded fallback
		_, err = c.page.Goto(pageURL, playwright.PageGotoOptions{
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
			Timeout:   playwright.Float(10000),
		})
		if err != nil {
			return nil, err
		}
	}

	title, _ := c.page.Title()
	currentURL := c.page.URL()

	// Detect stack on first page only
	if len(c.results.Pages) == 0 {
		_, _ = c.frameDet.DetectStack(c.page)
	}

	// Detect features
	pf, err := c.featureDet.DetectFeatures(c.page)
	if err != nil {
		pf = &PageFeatures{URL: currentURL}
	}

	// Extract feature types for this page
	featureTypes := make([]models.FeatureType, 0, len(pf.Features))
	for _, f := range pf.Features {
		featureTypes = append(featureTypes, f.Type)
	}

	// Generate test cases during discovery
	var testCases []models.TestCase
	if c.collector != nil {
		testCases = c.collector.CollectFromPage(currentURL, pf.Features, pf.Forms, pf.Tables)
	}
	c.results.TestCases = append(c.results.TestCases, testCases...)

	// Build discovered page record
	dp := store.DiscoveredPage{
		URL:       currentURL,
		Title:     title,
		Forms:     pf.Forms,
		Tables:    pf.Tables,
		NavLinks:  pf.NavLinks,
		Features:  featureTypes,
		VisitedAt: time.Now(),
	}
	c.results.Pages = append(c.results.Pages, dp)
	c.results.Features[currentURL] = featureTypes

	// Infer module from URL path
	if mod := inferModule(currentURL, c.baseURL); mod != "" {
		c.results.Modules = append(c.results.Modules, mod)
	}

	// Publish discovery event
	c.runStore.Publish(models.NewEvent(c.runID, models.EventDiscoveryPage, models.DiscoveryPageData{
		URL:            currentURL,
		Title:          title,
		FeaturesFound:  featureTypes,
		TestsGenerated: len(testCases),
		TotalPages:     len(c.results.Pages),
	}))

	// Update run context progress
	if rc, ok := c.runStore.Get(c.runID); ok {
		rc.DiscoveredPages = len(c.results.Pages)
		rc.Progress = min(90, 20+len(c.results.Pages)*2)
		rc.LastStep = fmt.Sprintf("Discovered: %s", title)
		c.runStore.Update(rc)
	}

	return c.page, nil
}

func (c *Crawler) extractLinks(page playwright.Page) ([]string, error) {
	script := `() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(Boolean)`
	res, err := page.Evaluate(script)
	if err != nil {
		return nil, err
	}

	rawLinks, _ := res.([]interface{})
	var links []string
	seen := make(map[string]bool)

	for _, rl := range rawLinks {
		href, ok := rl.(string)
		if !ok || seen[href] {
			continue
		}
		seen[href] = true

		if !c.isInternalLink(href) {
			continue
		}
		normalized := normalizeURL(href)
		if normalized != "" {
			links = append(links, normalized)
		}
	}
	return links, nil
}

func (c *Crawler) isInternalLink(href string) bool {
	parsed, err := url.Parse(href)
	if err != nil {
		return false
	}
	// Must be same host
	if parsed.Host != "" && parsed.Host != c.baseDomain {
		return false
	}
	// Must be http/https or relative
	if parsed.Scheme != "" && parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	return true
}

func (c *Crawler) isSafeLink(href string) bool {
	lower := strings.ToLower(href)
	dangerousKeywords := []string{
		"logout", "signout", "sign-out", "log-out",
		"delete", "remove", "destroy",
		"#", "javascript:",
		"mailto:", "tel:", "ftp:",
	}
	for _, kw := range dangerousKeywords {
		if strings.Contains(lower, kw) {
			return false
		}
	}
	return true
}

func (c *Crawler) isInScope(href string) bool {
	switch c.scope.Mode {
	case models.ScopeFull:
		return true
	case models.ScopeModule:
		lower := strings.ToLower(href)
		for _, target := range c.scope.Targets {
			if strings.Contains(lower, strings.ToLower(target)) {
				return true
			}
		}
		return false
	case models.ScopeURLPattern:
		for _, pattern := range c.scope.Targets {
			if matchGlob(href, pattern) {
				return true
			}
		}
		return false
	default:
		return true
	}
}

func normalizeURL(href string) string {
	parsed, err := url.Parse(href)
	if err != nil {
		return ""
	}
	// Remove fragments
	parsed.Fragment = ""
	// Remove common tracking params
	q := parsed.Query()
	for _, param := range []string{"utm_source", "utm_medium", "utm_campaign", "ref", "_ga"} {
		q.Del(param)
	}
	parsed.RawQuery = q.Encode()
	return parsed.String()
}

func inferModule(pageURL, baseURL string) string {
	base, _ := url.Parse(baseURL)
	page, _ := url.Parse(pageURL)
	if base == nil || page == nil {
		return ""
	}
	path := strings.TrimPrefix(page.Path, base.Path)
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) > 0 && parts[0] != "" {
		return parts[0]
	}
	return ""
}

func matchGlob(s, pattern string) bool {
	// Simple glob: * matches any sequence
	if pattern == "*" {
		return true
	}
	if !strings.Contains(pattern, "*") {
		return strings.Contains(s, pattern)
	}
	parts := strings.Split(pattern, "*")
	idx := 0
	for _, part := range parts {
		if part == "" {
			continue
		}
		found := strings.Index(s[idx:], part)
		if found < 0 {
			return false
		}
		idx += found + len(part)
	}
	return true
}

func dedupStrings(ss []string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, s := range ss {
		if !seen[s] {
			seen[s] = true
			result = append(result, s)
		}
	}
	return result
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

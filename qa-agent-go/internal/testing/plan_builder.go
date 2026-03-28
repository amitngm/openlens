package testing

import (
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qabuddy/agent/internal/models"
	"github.com/qabuddy/agent/internal/store"
)

// Intent defines the testing strategy
type Intent string

const (
	IntentSmoke       Intent = "smoke"
	IntentCRUD        Intent = "crud"
	IntentModule      Intent = "module"
	IntentExploratory Intent = "exploratory"
	IntentCustom      Intent = "custom"
)

// ParseIntent converts a string to an Intent
func ParseIntent(s string) Intent {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "smoke":
		return IntentSmoke
	case "crud":
		return IntentCRUD
	case "module":
		return IntentModule
	case "exploratory", "full":
		return IntentExploratory
	default:
		return IntentCustom
	}
}

// PlanBuilder builds a test plan from discovery results and user intent
type PlanBuilder struct {
	scorer *QualityScorer
}

// NewPlanBuilder creates a new PlanBuilder
func NewPlanBuilder(scorer *QualityScorer) *PlanBuilder {
	return &PlanBuilder{scorer: scorer}
}

// Build creates a TestPlan from discovery results
func (b *PlanBuilder) Build(
	runID string,
	discovery *store.DiscoveryResult,
	intent Intent,
	customText string,
	benchmarks map[string]models.BenchmarkStatus,
	includeDiscarded bool,
	maxTests int,
) (*models.TestPlan, error) {
	allCases := discovery.TestCases

	// Score all test cases
	allCases = b.scorer.ScoreAll(allCases)

	// Remove low quality cases (score < 30)
	allCases = b.scorer.Filter(allCases, 30)

	// Apply benchmark filtering
	allCases = b.applyBenchmarks(allCases, benchmarks, includeDiscarded)

	// Deduplicate by fingerprint
	allCases = b.deduplicate(allCases)

	// Filter by intent
	var selected []models.TestCase
	switch intent {
	case IntentSmoke:
		selected = b.filterSmoke(allCases)
	case IntentCRUD:
		selected = b.filterCRUD(allCases)
	case IntentModule:
		selected = b.filterByModule(allCases, discovery.Modules)
	case IntentCustom:
		selected = b.filterCustom(allCases, customText)
	default: // IntentExploratory
		selected = allCases
	}

	// Sort by quality
	selected = b.scorer.SortByQuality(selected)

	// Cap to max tests
	if maxTests > 0 && len(selected) > maxTests {
		selected = selected[:maxTests]
	}

	return &models.TestPlan{
		RunID:     runID,
		Intent:    string(intent),
		TestCases: selected,
		CreatedAt: time.Now(),
	}, nil
}

func (b *PlanBuilder) applyBenchmarks(
	cases []models.TestCase,
	benchmarks map[string]models.BenchmarkStatus,
	includeDiscarded bool,
) []models.TestCase {
	if len(benchmarks) == 0 {
		return cases
	}
	var result []models.TestCase
	for _, tc := range cases {
		status, exists := benchmarks[tc.Fingerprint]
		if !exists {
			result = append(result, tc)
			continue
		}
		if status == models.BenchmarkDiscarded && !includeDiscarded {
			continue // skip discarded
		}
		result = append(result, tc)
	}
	return result
}

func (b *PlanBuilder) deduplicate(cases []models.TestCase) []models.TestCase {
	seen := make(map[string]bool)
	var result []models.TestCase
	for _, tc := range cases {
		if tc.Fingerprint == "" {
			tc.Fingerprint = b.scorer.Fingerprint(tc)
		}
		if seen[tc.Fingerprint] {
			continue
		}
		seen[tc.Fingerprint] = true
		result = append(result, tc)
	}
	return result
}

func (b *PlanBuilder) filterSmoke(cases []models.TestCase) []models.TestCase {
	var result []models.TestCase
	for _, tc := range cases {
		if tc.Severity == models.SeverityCritical || tc.Category == "positive" {
			result = append(result, tc)
		}
	}
	return result
}

func (b *PlanBuilder) filterCRUD(cases []models.TestCase) []models.TestCase {
	crudTags := []string{"create", "read", "update", "delete", "form", "submit"}
	var result []models.TestCase
	for _, tc := range cases {
		for _, tag := range crudTags {
			if containsAny(tc.Name+" "+tc.Description+" "+strings.Join(tc.Tags, " "), []string{tag}) {
				result = append(result, tc)
				break
			}
		}
	}
	return result
}

func (b *PlanBuilder) filterByModule(cases []models.TestCase, modules []string) []models.TestCase {
	if len(modules) == 0 {
		return cases
	}
	// Pick best tests per module (top 5 by quality)
	byModule := make(map[string][]models.TestCase)
	for _, tc := range cases {
		mod := inferModuleFromURL(tc.PageURL)
		byModule[mod] = append(byModule[mod], tc)
	}

	var result []models.TestCase
	for _, modCases := range byModule {
		modCases = b.scorer.SortByQuality(modCases)
		limit := 5
		if len(modCases) < limit {
			limit = len(modCases)
		}
		result = append(result, modCases[:limit]...)
	}
	return result
}

func (b *PlanBuilder) filterCustom(cases []models.TestCase, customText string) []models.TestCase {
	if customText == "" {
		return cases
	}
	keywords := strings.Fields(strings.ToLower(customText))
	var result []models.TestCase
	for _, tc := range cases {
		searchSpace := strings.ToLower(tc.Name + " " + tc.Description + " " + string(tc.FeatureType) + " " + strings.Join(tc.Tags, " "))
		matchCount := 0
		for _, kw := range keywords {
			if strings.Contains(searchSpace, kw) {
				matchCount++
			}
		}
		if matchCount > 0 {
			result = append(result, tc)
		}
	}
	// If no matches, return all cases
	if len(result) == 0 {
		return cases
	}
	return result
}

func inferModuleFromURL(rawURL string) string {
	if idx := strings.Index(rawURL, "?"); idx > 0 {
		rawURL = rawURL[:idx]
	}
	parts := strings.Split(strings.Trim(rawURL, "/"), "/")
	// Find first non-empty, non-numeric path segment after the domain
	for i, p := range parts {
		if i == 0 { // skip domain
			continue
		}
		if p != "" && !isNumeric(p) {
			return p
		}
	}
	return "root"
}

func isNumeric(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func containsAny(s string, keywords []string) bool {
	lower := strings.ToLower(s)
	for _, kw := range keywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

// NewPlanID generates a unique plan ID
func NewPlanID() string {
	return uuid.New().String()
}

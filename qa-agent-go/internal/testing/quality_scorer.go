package testing

import (
	"crypto/md5"
	"fmt"
	"sort"
	"strings"

	"github.com/qabuddy/agent/internal/models"
)

// QualityScorer scores test cases on a 0-100 scale
type QualityScorer struct{}

// NewQualityScorer creates a new QualityScorer
func NewQualityScorer() *QualityScorer {
	return &QualityScorer{}
}

// Score evaluates a test case and returns a quality score 0-100
//
// Scoring criteria:
//   - Has real selector (not empty):       +20
//   - Has expected result:                 +15
//   - Has more than 2 steps:               +15
//   - Has at least one assert step:        +15
//   - Has description:                     +10
//   - Has preconditions:                   +10
//   - Has test data:                       +10
//   - Severity is critical or high:        +5
func (s *QualityScorer) Score(tc models.TestCase) int {
	score := 0

	// Has a real selector in at least one step
	for _, step := range tc.Steps {
		if step.Selector != "" && !strings.Contains(step.Selector, "{{") {
			score += 20
			break
		}
	}

	// Has expected result
	if tc.ExpectedResult != "" {
		score += 15
	}

	// Has more than 2 steps
	if len(tc.Steps) > 2 {
		score += 15
	}

	// Has at least one assert step
	for _, step := range tc.Steps {
		if step.Action == models.ActionAssert {
			score += 15
			break
		}
	}

	// Has description
	if tc.Description != "" {
		score += 10
	}

	// Has preconditions
	if len(tc.Preconditions) > 0 {
		score += 10
	}

	// Has test data
	if len(tc.TestData) > 0 {
		score += 10
	}

	// High/critical severity
	if tc.Severity == models.SeverityCritical || tc.Severity == models.SeverityHigh {
		score += 5
	}

	if score > 100 {
		score = 100
	}
	return score
}

// ScoreAll scores all test cases and sets QualityScore field
func (s *QualityScorer) ScoreAll(cases []models.TestCase) []models.TestCase {
	for i := range cases {
		cases[i].QualityScore = s.Score(cases[i])
	}
	return cases
}

// Filter returns only test cases with score >= minScore
func (s *QualityScorer) Filter(cases []models.TestCase, minScore int) []models.TestCase {
	var result []models.TestCase
	for _, tc := range cases {
		if tc.QualityScore >= minScore {
			result = append(result, tc)
		}
	}
	return result
}

// SortByQuality sorts test cases by severity then quality score (highest first)
func (s *QualityScorer) SortByQuality(cases []models.TestCase) []models.TestCase {
	sort.Slice(cases, func(i, j int) bool {
		pi := severityOrder(cases[i].Severity)
		pj := severityOrder(cases[j].Severity)
		if pi != pj {
			return pi < pj
		}
		return cases[i].QualityScore > cases[j].QualityScore
	})
	return cases
}

// Fingerprint generates a stable fingerprint hash for a test case
// Based on: normalized page URL + feature type + sorted action sequence
func (s *QualityScorer) Fingerprint(tc models.TestCase) string {
	// Normalize URL: remove query params, replace numeric segments with :id
	u := normalizeURLForFingerprint(tc.PageURL)

	// Build action sequence
	actions := make([]string, len(tc.Steps))
	for i, step := range tc.Steps {
		actions[i] = string(step.Action)
	}
	sort.Strings(actions)

	key := u + "|" + string(tc.FeatureType) + "|" + strings.Join(actions, ",")
	return fmt.Sprintf("%x", md5.Sum([]byte(key)))
}

func normalizeURLForFingerprint(rawURL string) string {
	if idx := strings.Index(rawURL, "?"); idx > 0 {
		rawURL = rawURL[:idx]
	}
	parts := strings.Split(rawURL, "/")
	normalized := make([]string, 0, len(parts))
	for _, p := range parts {
		if p == "" {
			continue
		}
		isNumeric := true
		for _, c := range p {
			if c < '0' || c > '9' {
				isNumeric = false
				break
			}
		}
		if isNumeric {
			normalized = append(normalized, ":id")
		} else {
			normalized = append(normalized, p)
		}
	}
	return strings.Join(normalized, "/")
}

func severityOrder(s models.Severity) int {
	switch s {
	case models.SeverityCritical:
		return 1
	case models.SeverityHigh:
		return 2
	case models.SeverityMedium:
		return 3
	default:
		return 4
	}
}

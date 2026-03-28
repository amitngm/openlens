package models

import "time"

// BenchmarkStatus tracks whether a test case fingerprint is approved or discarded
type BenchmarkStatus string

const (
	BenchmarkPending  BenchmarkStatus = "pending"
	BenchmarkApproved BenchmarkStatus = "approved"
	BenchmarkDiscarded BenchmarkStatus = "discarded"
)

// TestBenchmark is persisted per fingerprint to avoid regenerating bad test cases
type TestBenchmark struct {
	ID              uint            `json:"id" gorm:"primaryKey"`
	Fingerprint     string          `json:"fingerprint" gorm:"uniqueIndex;not null"`
	Name            string          `json:"name"`
	FeatureType     string          `json:"feature_type"`
	PageURLPattern  string          `json:"page_url_pattern"`
	Status          BenchmarkStatus `json:"status" gorm:"default:pending"`
	RunCount        int             `json:"run_count" gorm:"default:0"`
	PassCount       int             `json:"pass_count" gorm:"default:0"`
	FailCount       int             `json:"fail_count" gorm:"default:0"`
	DiscardedReason string          `json:"discarded_reason,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

// BlockerPattern is a learned pattern for handling stuck states (cookie banners, popups, etc.)
type BlockerPattern struct {
	ID               uint      `json:"id" gorm:"primaryKey"`
	URLPattern       string    `json:"url_pattern"`        // glob pattern e.g. "*/onboarding/*"
	ScreenSignature  string    `json:"screen_signature"`   // text visible on the blocking screen
	Action           string    `json:"action"`             // click, navigate, press_key
	ActionTarget     string    `json:"action_target"`      // selector or key name
	ActionValue      string    `json:"action_value,omitempty"`
	LearnedFromRunID string    `json:"learned_from_run_id"`
	AppliedCount     int       `json:"applied_count" gorm:"default:0"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// KnownBlocker defines a hard-coded pattern for common blockers
type KnownBlocker struct {
	Name     string   // e.g. "cookie_banner"
	Patterns []string // text patterns to match on page
	Action   string   // "click_button"
}

// DefaultKnownBlockers are built-in patterns for common interstitial screens
var DefaultKnownBlockers = []KnownBlocker{
	{
		Name:     "cookie_consent",
		Patterns: []string{"accept cookies", "accept all cookies", "accept all", "i agree", "got it", "allow cookies", "allow all"},
		Action:   "click_button",
	},
	{
		Name:     "tour_skip",
		Patterns: []string{"skip tour", "skip for now", "maybe later", "no thanks", "dismiss", "skip this", "skip tutorial"},
		Action:   "click_button",
	},
	{
		Name:     "terms_accept",
		Patterns: []string{"i accept", "agree and continue", "accept terms", "accept & continue", "i agree to the terms"},
		Action:   "click_button",
	},
	{
		Name:     "newsletter_dismiss",
		Patterns: []string{"no thanks", "not now", "close", "maybe later"},
		Action:   "click_close_button",
	},
	{
		Name:     "announcement_close",
		Patterns: []string{"got it", "ok", "dismiss", "close announcement"},
		Action:   "click_button",
	},
	{
		Name:     "session_warning",
		Patterns: []string{"stay logged in", "continue session", "keep me logged in", "extend session"},
		Action:   "click_button",
	},
	{
		Name:     "upgrade_wall",
		Patterns: []string{"maybe later", "continue with free", "no thanks", "remind me later"},
		Action:   "click_button",
	},
}

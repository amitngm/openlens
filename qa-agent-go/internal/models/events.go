package models

import "time"

// EventType identifies the kind of event emitted
type EventType string

const (
	EventStateChange   EventType = "state_change"
	EventProgress      EventType = "progress"
	EventBuddyMessage  EventType = "buddy_message"
	EventDiscoveryPage EventType = "discovery_page"
	EventTestResult    EventType = "test_result"
	EventStuck         EventType = "stuck"
	EventStuckResolved EventType = "stuck_resolved"
	EventError         EventType = "error"
	EventDone          EventType = "done"
	EventLog           EventType = "log"
)

// Event is a real-time event emitted during a run (streamed via SSE)
type Event struct {
	RunID     string      `json:"run_id"`
	Type      EventType   `json:"type"`
	Data      interface{} `json:"data"`
	Timestamp time.Time   `json:"timestamp"`
}

// StateChangeData is the payload for EventStateChange
type StateChangeData struct {
	From    RunState `json:"from"`
	To      RunState `json:"to"`
	Message string   `json:"message,omitempty"`
}

// ProgressData is the payload for EventProgress
type ProgressData struct {
	Percent int    `json:"percent"`
	Step    string `json:"step"`
	Detail  string `json:"detail,omitempty"`
}

// BuddyMessageData is the payload for EventBuddyMessage
type BuddyMessageData struct {
	Message string `json:"message"`
	IsUser  bool   `json:"is_user"`
}

// DiscoveryPageData is emitted for each discovered page
type DiscoveryPageData struct {
	URL            string        `json:"url"`
	Title          string        `json:"title"`
	FeaturesFound  []FeatureType `json:"features_found"`
	TestsGenerated int           `json:"tests_generated"`
	TotalPages     int           `json:"total_pages"`
}

// StuckData is emitted when the agent detects a stuck state
type StuckData struct {
	URL        string   `json:"url"`
	Reason     string   `json:"reason"`
	Screenshot string   `json:"screenshot,omitempty"` // base64 PNG
	Hints      []string `json:"hints,omitempty"`
}

// TestResultData is emitted after each test case executes
type TestResultData struct {
	TestCaseID   string     `json:"test_case_id"`
	Name         string     `json:"name"`
	Status       TestStatus `json:"status"`
	Severity     Severity   `json:"severity"`
	DurationMs   int64      `json:"duration_ms"`
	ErrorMessage string     `json:"error_message,omitempty"`
	Screenshot   string     `json:"screenshot,omitempty"` // base64 PNG
}

// LogData is a generic log entry event
type LogData struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

// NewEvent constructs an event with current timestamp
func NewEvent(runID string, t EventType, data interface{}) Event {
	return Event{
		RunID:     runID,
		Type:      t,
		Data:      data,
		Timestamp: time.Now(),
	}
}

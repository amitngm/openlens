package store

import (
	"sync"
	"time"

	"github.com/qabuddy/agent/internal/models"
)

// DiscoveryResult holds everything found during page crawling
type DiscoveryResult struct {
	Pages     []DiscoveredPage
	Modules   []string
	Features  map[string][]models.FeatureType // url -> features found
	TestCases []models.TestCase               // generated during discovery
}

// DiscoveredPage holds data about a single crawled page
type DiscoveredPage struct {
	URL        string
	Title      string
	Forms      []PageForm
	Tables     []PageTable
	NavLinks   []NavLink
	Features   []models.FeatureType
	Framework  string
	Screenshot string // base64 PNG
	VisitedAt  time.Time
}

// PageForm holds a discovered HTML form
type PageForm struct {
	ID     string
	Action string
	Method string
	Fields []FormField
}

// FormField is a single input within a form
type FormField struct {
	Name        string
	Type        string
	Label       string
	Placeholder string
	Required    bool
	Options     []string // for select / radio
}

// PageTable is a discovered data table
type PageTable struct {
	ID            string
	Headers       []string
	HasSort       bool
	HasFilter     bool
	HasPagination bool
	RowCount      int
}

// NavLink is a discovered navigation link
type NavLink struct {
	Text     string
	URL      string
	IsActive bool
}

// RunStore manages all active runs in memory with pub/sub for SSE
type RunStore struct {
	mu          sync.RWMutex
	runs        map[string]*models.RunContext
	subscribers map[string][]chan models.Event
	testPlans   map[string]*models.TestPlan
	testSuites  map[string]*models.TestSuite
	discovery   map[string]*DiscoveryResult
}

// NewRunStore creates a new in-memory run store
func NewRunStore() *RunStore {
	return &RunStore{
		runs:        make(map[string]*models.RunContext),
		subscribers: make(map[string][]chan models.Event),
		testPlans:   make(map[string]*models.TestPlan),
		testSuites:  make(map[string]*models.TestSuite),
		discovery:   make(map[string]*DiscoveryResult),
	}
}

// Create stores a new run context
func (s *RunStore) Create(ctx *models.RunContext) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ctx.CreatedAt = time.Now()
	ctx.UpdatedAt = time.Now()
	s.runs[ctx.RunID] = ctx
}

// Get retrieves a run context by ID
func (s *RunStore) Get(runID string) (*models.RunContext, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ctx, ok := s.runs[runID]
	return ctx, ok
}

// Update saves an updated run context and publishes a state change event if state changed
func (s *RunStore) Update(ctx *models.RunContext) {
	s.mu.Lock()
	prev, exists := s.runs[ctx.RunID]
	var prevState models.RunState
	if exists {
		prevState = prev.State
	}
	ctx.UpdatedAt = time.Now()
	s.runs[ctx.RunID] = ctx
	s.mu.Unlock()

	if exists && prevState != ctx.State {
		s.Publish(models.NewEvent(ctx.RunID, models.EventStateChange, models.StateChangeData{
			From:    prevState,
			To:      ctx.State,
			Message: ctx.BuddyMsg,
		}))
	}
}

// List returns all run contexts sorted by creation time (newest first)
func (s *RunStore) List() []*models.RunContext {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*models.RunContext, 0, len(s.runs))
	for _, ctx := range s.runs {
		result = append(result, ctx)
	}
	return result
}

// Delete removes a run from the store
func (s *RunStore) Delete(runID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.runs, runID)
	delete(s.testPlans, runID)
	delete(s.testSuites, runID)
	delete(s.discovery, runID)
}

// SetTestPlan stores the test plan for a run
func (s *RunStore) SetTestPlan(runID string, plan *models.TestPlan) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.testPlans[runID] = plan
}

// GetTestPlan retrieves the test plan for a run
func (s *RunStore) GetTestPlan(runID string) (*models.TestPlan, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	plan, ok := s.testPlans[runID]
	return plan, ok
}

// SetTestSuite stores the test suite results for a run
func (s *RunStore) SetTestSuite(runID string, suite *models.TestSuite) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.testSuites[runID] = suite
}

// GetTestSuite retrieves the test suite results for a run
func (s *RunStore) GetTestSuite(runID string) (*models.TestSuite, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	suite, ok := s.testSuites[runID]
	return suite, ok
}

// SetDiscovery stores discovery results for a run
func (s *RunStore) SetDiscovery(runID string, result *DiscoveryResult) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.discovery[runID] = result
}

// GetDiscovery retrieves discovery results for a run
func (s *RunStore) GetDiscovery(runID string) (*DiscoveryResult, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result, ok := s.discovery[runID]
	return result, ok
}

// Publish sends an event to all subscribers of a run
func (s *RunStore) Publish(event models.Event) {
	s.mu.RLock()
	channels := s.subscribers[event.RunID]
	s.mu.RUnlock()

	for _, ch := range channels {
		select {
		case ch <- event:
		default:
			// Non-blocking: drop if subscriber is slow
		}
	}
}

// Subscribe returns a channel that receives events for a run
func (s *RunStore) Subscribe(runID string) chan models.Event {
	ch := make(chan models.Event, 64)
	s.mu.Lock()
	s.subscribers[runID] = append(s.subscribers[runID], ch)
	s.mu.Unlock()
	return ch
}

// Unsubscribe removes a channel from the subscribers list
func (s *RunStore) Unsubscribe(runID string, ch chan models.Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	channels := s.subscribers[runID]
	for i, c := range channels {
		if c == ch {
			s.subscribers[runID] = append(channels[:i], channels[i+1:]...)
			close(ch)
			return
		}
	}
}

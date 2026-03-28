package engine

import (
	"fmt"
	"sync"
	"time"

	"github.com/qabuddy/agent/internal/models"
)

// AnswerChan manages pending answer channels per run
type AnswerChan struct {
	mu    sync.Mutex
	chans map[string]chan models.AnswerRequest
}

// NewAnswerChan creates a new AnswerChan
func NewAnswerChan() *AnswerChan {
	return &AnswerChan{
		chans: make(map[string]chan models.AnswerRequest),
	}
}

// Register creates a channel for a run (call before starting a WAIT_* state)
func (a *AnswerChan) Register(runID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.chans[runID] = make(chan models.AnswerRequest, 1)
}

// Wait blocks until an answer is received or timeout expires
func (a *AnswerChan) Wait(runID string, timeout time.Duration) (models.AnswerRequest, error) {
	a.mu.Lock()
	ch, ok := a.chans[runID]
	a.mu.Unlock()

	if !ok {
		return models.AnswerRequest{}, fmt.Errorf("no answer channel for run %s", runID)
	}

	select {
	case answer := <-ch:
		return answer, nil
	case <-time.After(timeout):
		return models.AnswerRequest{}, fmt.Errorf("answer timeout after %v", timeout)
	}
}

// Send delivers an answer to the waiting runner goroutine
func (a *AnswerChan) Send(runID string, answer models.AnswerRequest) error {
	a.mu.Lock()
	ch, ok := a.chans[runID]
	a.mu.Unlock()

	if !ok {
		return fmt.Errorf("no answer channel for run %s — run may not be waiting for input", runID)
	}

	select {
	case ch <- answer:
		return nil
	default:
		return fmt.Errorf("answer channel full for run %s", runID)
	}
}

// Close removes the answer channel for a run
func (a *AnswerChan) Close(runID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if ch, ok := a.chans[runID]; ok {
		close(ch)
		delete(a.chans, runID)
	}
}

// IsWaiting returns true if the run has a pending answer channel
func (a *AnswerChan) IsWaiting(runID string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	_, ok := a.chans[runID]
	return ok
}

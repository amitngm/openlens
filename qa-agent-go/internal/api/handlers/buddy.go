package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/qabuddy/agent/internal/engine"
	"github.com/qabuddy/agent/internal/models"
	"github.com/qabuddy/agent/internal/store"
)

// BuddyHandler handles /runs/:id/buddy endpoints
type BuddyHandler struct {
	runStore *store.RunStore
	runner   *engine.Runner // used to get the live Buddy for a run
	answers  *engine.AnswerChan
}

// NewBuddyHandler creates a new BuddyHandler
func NewBuddyHandler(s *store.RunStore, runner *engine.Runner, answers *engine.AnswerChan) *BuddyHandler {
	return &BuddyHandler{
		runStore: s,
		runner:   runner,
		answers:  answers,
	}
}

// Chat handles POST /runs/:id/buddy
func (h *BuddyHandler) Chat(c *gin.Context) {
	runID := c.Param("id")

	rc, ok := h.runStore.Get(runID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "run not found"})
		return
	}

	var req models.BuddyMessage
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Publish the user's message as an event
	h.runStore.Publish(models.NewEvent(runID, models.EventBuddyMessage, models.BuddyMessageData{
		Message: req.Message,
		IsUser:  true,
	}))

	// If run is waiting for user guidance (stuck), send to answer channel
	if rc.State == models.StateWaitBuddyGuidance || rc.QuestionType != "" {
		answer := models.AnswerRequest{Answer: req.Message}
		if err := h.answers.Send(runID, answer); err != nil {
			// Not waiting — handle as chat
		} else {
			c.JSON(http.StatusOK, models.BuddyResponse{
				Message: "Got it! Acting on your instruction...",
				State:   rc.State,
			})
			return
		}
	}

	// Get the live Buddy from the runner
	buddy, hasBuddy := h.runner.GetBuddy(runID)
	if hasBuddy {
		response, err := buddy.HandleMessage(c.Request.Context(), req.Message)
		if err != nil {
			c.JSON(http.StatusOK, models.BuddyResponse{
				Message: "I couldn't complete that action. " + err.Error(),
				State:   rc.State,
			})
			return
		}
		c.JSON(http.StatusOK, models.BuddyResponse{
			Message: response,
			State:   rc.State,
		})
		return
	}

	// No buddy available — return contextual response
	c.JSON(http.StatusOK, models.BuddyResponse{
		Message: "I received your message. The run is currently in state: " + string(rc.State),
		State:   rc.State,
	})
}

// GetHints handles GET /runs/:id/buddy/hints
func (h *BuddyHandler) GetHints(c *gin.Context) {
	runID := c.Param("id")

	rc, ok := h.runStore.Get(runID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "run not found"})
		return
	}

	// Get dynamic hints from stuck detector if available
	var hints []string
	if rc.QuestionHints != nil {
		hints = rc.QuestionHints
	} else if buddy, ok := h.runner.GetBuddy(runID); ok {
		hints = buddy.GetHints(rc.State)
	} else {
		hints = defaultHints(rc.State)
	}

	c.JSON(http.StatusOK, gin.H{
		"hints": hints,
		"state": rc.State,
	})
}

func defaultHints(state models.RunState) []string {
	switch state {
	case models.StateWaitLoginInput:
		return []string{"admin:password", "user@example.com:secret", "skip - no login needed"}
	case models.StateWaitManualLogin:
		return []string{"done", "skip - continue without login"}
	case models.StateDiscoveryRun:
		return []string{"Stop discovery", "Focus on forms", "Check navigation only"}
	case models.StateWaitTestIntent:
		return []string{"Smoke tests", "Test all forms", "Full exploratory", "Check navigation", "Custom: describe what to test"}
	case models.StateWaitBuddyGuidance:
		return []string{"Click Accept", "Close popup", "Press Enter", "Skip this", "Go to next page", "Scroll down"}
	case models.StateDone:
		return []string{"Show coverage gaps", "Export results", "Rerun failed tests"}
	default:
		return []string{"What can you test?", "Run full QA", "Check forms", "Find broken links"}
	}
}

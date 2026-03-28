package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/qabuddy/agent/internal/config"
	"github.com/qabuddy/agent/internal/database"
	"github.com/qabuddy/agent/internal/engine"
	"github.com/qabuddy/agent/internal/models"
	"github.com/qabuddy/agent/internal/store"
	"github.com/rs/zerolog/log"
)

// RunHandler handles all /runs endpoints
type RunHandler struct {
	runStore *store.RunStore
	runner   *engine.Runner
	answers  *engine.AnswerChan
	db       *database.DB
	cfg      *config.Config
}

// NewRunHandler creates a new RunHandler
func NewRunHandler(s *store.RunStore, r *engine.Runner, a *engine.AnswerChan, db *database.DB, cfg *config.Config) *RunHandler {
	return &RunHandler{runStore: s, runner: r, answers: a, db: db, cfg: cfg}
}

// StartRun handles POST /runs
func (h *RunHandler) StartRun(c *gin.Context) {
	var req models.StartRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.createAndStartRun(c, req)
}

// StartFullRun handles POST /runs/start-full (single-click, auto_mode=true)
func (h *RunHandler) StartFullRun(c *gin.Context) {
	var req models.StartRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.AutoMode = true
	h.createAndStartRun(c, req)
}

func (h *RunHandler) createAndStartRun(c *gin.Context, req models.StartRunRequest) {
	runID := uuid.New().String()

	// Build run context with defaults
	rc := &models.RunContext{
		RunID:     runID,
		BaseURL:   req.BaseURL,
		State:     models.StateStart,
		AppType:   req.AppType,
		Headless:  req.Headless,
		AutoMode:  req.AutoMode,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		EnabledOps: models.EnabledOps{Read: true, Create: true, Update: true, Delete: false},
		DiscoveryScope: models.DiscoveryScope{
			Mode:     models.ScopeFull,
			MaxPages: h.cfg.MaxDiscoveryPages,
		},
		AI: models.AIConfig{
			Enabled:  true,
			Mode:     models.AIModeHybrid,
			MaxSteps: h.cfg.MaxBuddySteps,
		},
	}

	if req.Auth != nil {
		rc.Auth = req.Auth
	}
	if req.DiscoveryScope != nil {
		rc.DiscoveryScope = *req.DiscoveryScope
		if rc.DiscoveryScope.MaxPages <= 0 {
			rc.DiscoveryScope.MaxPages = h.cfg.MaxDiscoveryPages
		}
	}
	if req.EnabledOps != nil {
		rc.EnabledOps = *req.EnabledOps
	}
	if req.AI != nil {
		rc.AI = *req.AI
	}
	if req.AppType == "" {
		rc.AppType = models.AppTypeAuto
	}

	h.runStore.Create(rc)

	// Start the run in background
	h.runner.Start(runID)

	log.Info().Str("run_id", runID).Str("url", req.BaseURL).Bool("auto", req.AutoMode).Msg("run started")
	c.JSON(http.StatusCreated, rc)
}

// GetStatus handles GET /runs/:id/status
func (h *RunHandler) GetStatus(c *gin.Context) {
	runID := c.Param("id")
	rc, ok := h.runStore.Get(runID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "run not found"})
		return
	}
	c.JSON(http.StatusOK, rc)
}

// Answer handles POST /runs/:id/answer
func (h *RunHandler) Answer(c *gin.Context) {
	runID := c.Param("id")
	var req models.AnswerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.runner.SendAnswer(runID, req); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	// Clear the question from the run context
	if rc, ok := h.runStore.Get(runID); ok {
		rc.Question = ""
		rc.QuestionType = ""
		rc.QuestionHints = nil
		h.runStore.Update(rc)
	}

	c.JSON(http.StatusOK, gin.H{"status": "answer received"})
}

// StreamEvents handles GET /runs/:id/events (SSE)
func (h *RunHandler) StreamEvents(c *gin.Context) {
	runID := c.Param("id")

	if _, ok := h.runStore.Get(runID); !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "run not found"})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Header("Access-Control-Allow-Origin", "*")

	ch := h.runStore.Subscribe(runID)
	defer h.runStore.Unsubscribe(runID, ch)

	notify := c.Request.Context().Done()
	c.Stream(func(w io.Writer) bool {
		select {
		case event, ok := <-ch:
			if !ok {
				return false
			}
			data, err := json.Marshal(event)
			if err != nil {
				return true
			}
			c.SSEvent("message", string(data))
			return true
		case <-notify:
			return false
		case <-time.After(30 * time.Second):
			// Keepalive ping
			c.SSEvent("ping", "")
			return true
		}
	})
}

// GetReport handles GET /runs/:id/report
func (h *RunHandler) GetReport(c *gin.Context) {
	runID := c.Param("id")
	suite, ok := h.runStore.GetTestSuite(runID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "no test suite found for run"})
		return
	}
	rc, _ := h.runStore.Get(runID)
	disc, _ := h.runStore.GetDiscovery(runID)
	c.JSON(http.StatusOK, gin.H{
		"run":       rc,
		"suite":     suite,
		"discovery": disc,
	})
}

// GetReportHTML handles GET /runs/:id/report.html
func (h *RunHandler) GetReportHTML(c *gin.Context) {
	runID := c.Param("id")
	rc, ok := h.runStore.Get(runID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "run not found"})
		return
	}
	if rc.ReportPath == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "report not yet generated"})
		return
	}
	data, err := os.ReadFile(rc.ReportPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read report"})
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", data)
}

// CancelRun handles POST /runs/:id/cancel
func (h *RunHandler) CancelRun(c *gin.Context) {
	runID := c.Param("id")
	if _, ok := h.runStore.Get(runID); !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "run not found"})
		return
	}
	h.runner.Cancel(runID)
	c.JSON(http.StatusOK, gin.H{"status": "cancelled"})
}

// ListRuns handles GET /runs
func (h *RunHandler) ListRuns(c *gin.Context) {
	runs := h.runStore.List()
	items := make([]models.RunListItem, 0, len(runs))
	for _, rc := range runs {
		items = append(items, models.RunListItem{
			RunID:     rc.RunID,
			BaseURL:   rc.BaseURL,
			State:     rc.State,
			Progress:  rc.Progress,
			CreatedAt: rc.CreatedAt,
			UpdatedAt: rc.UpdatedAt,
		})
	}
	c.JSON(http.StatusOK, items)
}

// UpdateBenchmark handles POST /runs/:id/benchmark
func (h *RunHandler) UpdateBenchmark(c *gin.Context) {
	runID := c.Param("id")
	var req models.BenchmarkUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Find the test case in the suite
	suite, ok := h.runStore.GetTestSuite(runID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "no test suite found"})
		return
	}

	var tc *models.TestCase
	for i := range suite.TestCases {
		if suite.TestCases[i].ID == req.TestCaseID {
			tc = &suite.TestCases[i]
			break
		}
	}
	if tc == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "test case not found"})
		return
	}

	if h.db != nil && tc.Fingerprint != "" {
		existing, _ := h.db.GetBenchmark(tc.Fingerprint)
		if existing == nil {
			existing = &models.TestBenchmark{
				Fingerprint: tc.Fingerprint,
				Name:        tc.Name,
				FeatureType: string(tc.FeatureType),
			}
		}
		existing.Status = models.BenchmarkStatus(req.Status)
		existing.DiscardedReason = req.Reason
		h.db.SaveBenchmark(existing)
	}

	log.Info().Str("run_id", runID).Str("test_id", req.TestCaseID).Str("status", req.Status).Msg("benchmark updated")
	c.JSON(http.StatusOK, gin.H{"status": "benchmark updated"})
}

// Health handles GET /health
func (h *RunHandler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "ok",
		"timestamp": time.Now(),
	})
}

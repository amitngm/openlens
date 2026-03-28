package api

import (
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/qabuddy/agent/internal/ai"
	"github.com/qabuddy/agent/internal/api/handlers"
	"github.com/qabuddy/agent/internal/config"
	"github.com/qabuddy/agent/internal/database"
	"github.com/qabuddy/agent/internal/engine"
	"github.com/qabuddy/agent/internal/store"
)

// NewServer creates and configures the Gin HTTP server
func NewServer(
	s *store.RunStore,
	runner *engine.Runner,
	answers *engine.AnswerChan,
	db *database.DB,
	buddy *ai.Buddy,
	cfg *config.Config,
) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())

	// CORS — allow all origins in development
	router.Use(cors.New(cors.Config{
		AllowAllOrigins:  true,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: false,
	}))

	// Serve static UI
	router.Static("/ui", "./ui")
	router.StaticFile("/", "./ui/index.html")
	router.StaticFile("/favicon.ico", "./ui/favicon.ico")

	// Handlers
	runHandler := handlers.NewRunHandler(s, runner, answers, db, cfg)
	buddyHandler := handlers.NewBuddyHandler(s, answers)

	// Health check
	router.GET("/health", runHandler.Health)

	// Run endpoints
	runs := router.Group("/runs")
	{
		runs.POST("/start-full", runHandler.StartFullRun)    // single-click
		runs.POST("", runHandler.StartRun)                  // standard
		runs.GET("", runHandler.ListRuns)
		runs.GET("/:id/status", runHandler.GetStatus)
		runs.POST("/:id/answer", runHandler.Answer)
		runs.GET("/:id/events", runHandler.StreamEvents)    // SSE
		runs.POST("/:id/cancel", runHandler.CancelRun)
		runs.GET("/:id/report", runHandler.GetReport)
		runs.GET("/:id/report.html", runHandler.GetReportHTML)
		runs.POST("/:id/benchmark", runHandler.UpdateBenchmark)
		runs.POST("/:id/buddy", buddyHandler.Chat)
		runs.GET("/:id/buddy/hints", buddyHandler.GetHints)
	}

	return router
}

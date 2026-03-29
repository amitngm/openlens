package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/qabuddy/agent/internal/ai"
	"github.com/qabuddy/agent/internal/api"
	"github.com/qabuddy/agent/internal/browser"
	"github.com/qabuddy/agent/internal/config"
	"github.com/qabuddy/agent/internal/database"
	"github.com/qabuddy/agent/internal/engine"
	"github.com/qabuddy/agent/internal/rules"
	"github.com/qabuddy/agent/internal/store"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	// 1. Load configuration
	cfg := config.Load()

	// 2. Initialize structured logging
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	if cfg.LogLevel == "debug" {
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	} else {
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	}
	// Pretty console output in development
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: "15:04:05"})
	log.Info().Str("version", "1.0.0").Msg("QA Buddy starting")

	// 3. Create artifacts directory
	if err := os.MkdirAll(cfg.ArtifactsDir, 0755); err != nil {
		log.Fatal().Err(err).Msg("failed to create artifacts dir")
	}

	// 4. Initialize database
	db, err := database.Initialize(cfg.DBPath)
	if err != nil {
		log.Warn().Err(err).Msg("database initialization failed, running without persistence")
		db = nil
	}

	// 5. Initialize browser manager (Playwright)
	bm, err := browser.NewManager()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to start Playwright")
	}
	defer bm.CloseAll()

	// 6. Auto-detect AI provider (Ollama → Claude → OpenAI → None)
	ctx := context.Background()
	aiProv := ai.AutoDetect(ctx,
		cfg.OllamaBaseURL, cfg.OllamaModel,
		cfg.OpenAIAPIKey, cfg.OpenAIModel,
		cfg.AnthropicAPIKey, cfg.ClaudeModel,
	)
	log.Info().Str("ai_provider", aiProv.Name()).Msg("AI provider selected")

	// 7. Initialize run store
	runStore := store.NewRunStore()

	// 8. Initialize answer channel
	answers := engine.NewAnswerChan()

	// 9. Initialize rules registry
	registry := rules.NewRegistry()
	log.Info().Int("schemas", len(registry.All())).Msg("rules registry loaded")

	// 10. Initialize runner
	runner := engine.NewRunner(runStore, bm, answers, registry, aiProv, db, cfg)

	// 11. Build and start HTTP server
	server := api.NewServer(runStore, runner, answers, db, nil, cfg)

	addr := fmt.Sprintf(":%d", cfg.ServerPort)
	log.Info().Str("addr", addr).Msg("server starting")

	// Handle graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := server.Run(addr); err != nil {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	log.Info().Str("url", "http://localhost"+addr).Msg("QA Buddy ready")

	// Wait for shutdown signal
	<-quit
	log.Info().Msg("shutting down gracefully...")
	bm.CloseAll()
	log.Info().Msg("shutdown complete")
}

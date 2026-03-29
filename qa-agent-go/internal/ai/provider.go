package ai

import (
	"context"
	"fmt"
	"time"
)

// Provider is the interface all AI providers must implement
type Provider interface {
	Complete(ctx context.Context, systemPrompt, userPrompt string) (string, error)
	IsAvailable(ctx context.Context) bool
	Name() string
}

// Config holds configuration for an AI provider
type Config struct {
	Provider    string // ollama, openai, claude, none
	ModelName   string
	APIKey      string
	BaseURL     string
	Temperature float64
	MaxTokens   int
	TimeoutSec  int
}

// NoneProvider is a no-op provider used when AI is disabled
type NoneProvider struct{}

func (n *NoneProvider) Complete(_ context.Context, _, _ string) (string, error) {
	return "", fmt.Errorf("AI is disabled")
}
func (n *NoneProvider) IsAvailable(_ context.Context) bool { return false }
func (n *NoneProvider) Name() string                        { return "none" }

// NewProvider creates the appropriate provider based on config
func NewProvider(cfg Config) (Provider, error) {
	if cfg.TimeoutSec <= 0 {
		cfg.TimeoutSec = 30
	}
	switch cfg.Provider {
	case "ollama":
		url := cfg.BaseURL
		if url == "" {
			url = "http://localhost:11434"
		}
		return NewOllamaProvider(url, cfg.ModelName, cfg.TimeoutSec), nil
	case "openai":
		if cfg.APIKey == "" {
			return nil, fmt.Errorf("OpenAI API key required")
		}
		return NewOpenAIProvider(cfg.APIKey, cfg.ModelName, cfg.TimeoutSec), nil
	case "claude", "anthropic":
		if cfg.APIKey == "" {
			return nil, fmt.Errorf("Anthropic API key required")
		}
		return NewClaudeProvider(cfg.APIKey, cfg.ModelName, cfg.TimeoutSec), nil
	case "none", "":
		return &NoneProvider{}, nil
	default:
		return nil, fmt.Errorf("unknown provider: %s", cfg.Provider)
	}
}

// AutoDetect tries Ollama first, then OpenAI, then Claude, falls back to none
func AutoDetect(ctx context.Context, ollamaURL, ollamaModel, openAIKey, openAIModel, anthropicKey, claudeModel string) Provider {
	detectCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	// Try Ollama first (local — zero cost)
	if ollamaURL != "" {
		p := NewOllamaProvider(ollamaURL, ollamaModel, 5)
		if p.IsAvailable(detectCtx) {
			return p
		}
	}

	// Try Anthropic Claude
	if anthropicKey != "" {
		return NewClaudeProvider(anthropicKey, claudeModel, 30)
	}

	// Try OpenAI
	if openAIKey != "" {
		return NewOpenAIProvider(openAIKey, openAIModel, 30)
	}

	return &NoneProvider{}
}

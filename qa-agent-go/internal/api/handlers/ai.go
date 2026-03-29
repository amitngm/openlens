package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/qabuddy/agent/internal/config"
)

// AIHandler handles /ai/* endpoints
type AIHandler struct {
	cfg *config.Config
}

// NewAIHandler creates a new AIHandler
func NewAIHandler(cfg *config.Config) *AIHandler {
	return &AIHandler{cfg: cfg}
}

// GetProviders returns available AI providers and their models
func (h *AIHandler) GetProviders(c *gin.Context) {
	providers := []gin.H{
		{
			"id":       "ollama",
			"name":     "Ollama (Local)",
			"base_url": h.cfg.OllamaBaseURL,
			"default_model": h.cfg.OllamaModel,
			"models":   []string{}, // populated client-side via /ai/ollama/models
		},
		{
			"id":            "openai",
			"name":          "OpenAI",
			"configured":    h.cfg.OpenAIAPIKey != "",
			"default_model": h.cfg.OpenAIModel,
			"models":        []string{"gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"},
		},
		{
			"id":            "claude",
			"name":          "Anthropic Claude",
			"configured":    h.cfg.AnthropicAPIKey != "",
			"default_model": h.cfg.ClaudeModel,
			"models": []string{
				"claude-opus-4-5",
				"claude-sonnet-4-5",
				"claude-haiku-3-5",
				"claude-3-5-sonnet-20241022",
				"claude-3-opus-20240229",
				"claude-3-haiku-20240307",
			},
		},
		{
			"id":   "none",
			"name": "No AI (Rules only)",
		},
	}
	c.JSON(http.StatusOK, gin.H{"providers": providers})
}

// GetOllamaModels lists models from a local Ollama instance
func (h *AIHandler) GetOllamaModels(c *gin.Context) {
	baseURL := c.Query("base_url")
	if baseURL == "" {
		baseURL = h.cfg.OllamaBaseURL
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", baseURL+"/api/tags", nil)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"available": false, "models": []string{}, "error": err.Error()})
		return
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"available": false, "models": []string{}, "error": "Ollama not running at " + baseURL})
		return
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(resp.Body)

	var result struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		c.JSON(http.StatusOK, gin.H{"available": true, "models": []string{}})
		return
	}

	names := make([]string, 0, len(result.Models))
	for _, m := range result.Models {
		names = append(names, m.Name)
	}
	c.JSON(http.StatusOK, gin.H{"available": true, "models": names, "base_url": baseURL})
}

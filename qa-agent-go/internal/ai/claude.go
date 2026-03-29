package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ClaudeProvider calls the Anthropic Messages API
type ClaudeProvider struct {
	apiKey  string
	model   string
	timeout int
}

// NewClaudeProvider creates a new Anthropic Claude provider
func NewClaudeProvider(apiKey, model string, timeoutSec int) *ClaudeProvider {
	if model == "" {
		model = "claude-opus-4-5"
	}
	if timeoutSec <= 0 {
		timeoutSec = 30
	}
	return &ClaudeProvider{apiKey: apiKey, model: model, timeout: timeoutSec}
}

func (p *ClaudeProvider) Name() string { return "claude" }

func (p *ClaudeProvider) IsAvailable(_ context.Context) bool {
	return p.apiKey != ""
}

func (p *ClaudeProvider) Complete(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	type contentBlock struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	type message struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	type reqBody struct {
		Model     string    `json:"model"`
		MaxTokens int       `json:"max_tokens"`
		System    string    `json:"system,omitempty"`
		Messages  []message `json:"messages"`
	}

	payload := reqBody{
		Model:     p.model,
		MaxTokens: 2048,
		System:    systemPrompt,
		Messages:  []message{{Role: "user", Content: userPrompt}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal claude request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST",
		"https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("x-api-key", p.apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	httpReq.Header.Set("content-type", "application/json")

	client := &http.Client{Timeout: time.Duration(p.timeout) * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("claude request: %w", err)
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("claude api %d: %s", resp.StatusCode, string(data))
	}

	var result struct {
		Content []contentBlock `json:"content"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return "", fmt.Errorf("unmarshal claude response: %w", err)
	}
	for _, c := range result.Content {
		if c.Type == "text" {
			return c.Text, nil
		}
	}
	return "", fmt.Errorf("no text content in claude response")
}

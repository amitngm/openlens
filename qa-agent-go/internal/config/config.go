package config

import (
	"os"
	"strconv"
	"sync"
)

// Config holds all application configuration
type Config struct {
	ServerPort          int
	DBPath              string
	ArtifactsDir        string
	MaxDiscoveryPages   int
	MaxDiscoveryTimeMin int
	MaxTestsPerRun      int
	DefaultHeadless     bool
	OllamaBaseURL       string
	OllamaModel         string
	OpenAIAPIKey        string
	OpenAIModel         string
	StuckTimeoutSec     int
	MaxBuddySteps       int
	NaturalDelayMinMs   int
	NaturalDelayMaxMs   int
	BrowserChannel      string
	LogLevel            string
}

var (
	instance *Config
	once     sync.Once
)

// Get returns the singleton config instance
func Get() *Config {
	once.Do(func() {
		instance = Load()
	})
	return instance
}

// Load reads config from environment variables with defaults
func Load() *Config {
	return &Config{
		ServerPort:          envInt("SERVER_PORT", 8080),
		DBPath:              envStr("DB_PATH", "./qa_buddy.db"),
		ArtifactsDir:        envStr("ARTIFACTS_DIR", "./artifacts"),
		MaxDiscoveryPages:   envInt("MAX_DISCOVERY_PAGES", 200),
		MaxDiscoveryTimeMin: envInt("MAX_DISCOVERY_TIME_MIN", 30),
		MaxTestsPerRun:      envInt("MAX_TESTS_PER_RUN", 100),
		DefaultHeadless:     envBool("DEFAULT_HEADLESS", true),
		OllamaBaseURL:       envStr("OLLAMA_BASE_URL", "http://localhost:11434"),
		OllamaModel:         envStr("OLLAMA_MODEL", "llama3"),
		OpenAIAPIKey:        envStr("OPENAI_API_KEY", ""),
		OpenAIModel:         envStr("OPENAI_MODEL", "gpt-4o"),
		StuckTimeoutSec:     envInt("STUCK_TIMEOUT_SEC", 15),
		MaxBuddySteps:       envInt("MAX_BUDDY_STEPS", 30),
		NaturalDelayMinMs:   envInt("NATURAL_DELAY_MIN_MS", 100),
		NaturalDelayMaxMs:   envInt("NATURAL_DELAY_MAX_MS", 600),
		BrowserChannel:      envStr("BROWSER_CHANNEL", "chrome"),
		LogLevel:            envStr("LOG_LEVEL", "info"),
	}
}

func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

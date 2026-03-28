.PHONY: build run test clean tidy install-playwright

# Binary name
BINARY=qa-buddy

# Build the server binary
build:
	go build -o $(BINARY) ./cmd/server/

# Run the server (development)
run:
	go run ./cmd/server/

# Run with hot reload (requires air: go install github.com/air-verse/air@latest)
dev:
	air

# Install Go dependencies
tidy:
	go mod tidy

# Install Playwright browsers
install-playwright:
	go run github.com/playwright-community/playwright-go/cmd/playwright@latest install --with-deps chromium

# Install everything (first-time setup)
setup: tidy install-playwright
	@echo "✅ Setup complete. Run 'make run' to start QA Buddy."

# Run tests
test:
	go test ./...

# Clean build artifacts
clean:
	rm -f $(BINARY)
	rm -rf artifacts/

# Build for multiple platforms
build-all:
	GOOS=darwin  GOARCH=amd64 go build -o dist/qa-buddy-darwin-amd64 ./cmd/server/
	GOOS=darwin  GOARCH=arm64 go build -o dist/qa-buddy-darwin-arm64 ./cmd/server/
	GOOS=linux   GOARCH=amd64 go build -o dist/qa-buddy-linux-amd64  ./cmd/server/
	GOOS=windows GOARCH=amd64 go build -o dist/qa-buddy-windows-amd64.exe ./cmd/server/

# Show help
help:
	@echo "QA Buddy - Make targets:"
	@echo "  make setup              First-time setup (install deps + playwright browsers)"
	@echo "  make run                Run the server"
	@echo "  make dev                Run with hot reload"
	@echo "  make build              Build binary"
	@echo "  make test               Run tests"
	@echo "  make clean              Clean build artifacts"
	@echo ""
	@echo "Environment variables:"
	@echo "  SERVER_PORT             HTTP port (default: 8080)"
	@echo "  OPENAI_API_KEY          OpenAI API key (optional)"
	@echo "  OLLAMA_BASE_URL         Ollama URL (default: http://localhost:11434)"
	@echo "  OLLAMA_MODEL            Ollama model (default: llama3)"
	@echo "  BROWSER_CHANNEL         Browser channel (default: chrome)"
	@echo "  DEFAULT_HEADLESS        Run headless by default (default: true)"
	@echo "  MAX_DISCOVERY_PAGES     Max pages to crawl (default: 200)"

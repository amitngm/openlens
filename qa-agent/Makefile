# QA Agent - Makefile

.PHONY: help install run-api run-ui run docker-build docker-run test clean

help:
	@echo "QA Agent Commands:"
	@echo "  make install     - Install dependencies"
	@echo "  make run-api     - Run API server locally"
	@echo "  make run-ui      - Run UI dev server"
	@echo "  make run         - Run both API and UI"
	@echo "  make docker-build - Build Docker image"
	@echo "  make docker-run  - Run with Docker Compose"
	@echo "  make test        - Run tests"
	@echo "  make clean       - Clean up"

# Install dependencies
install:
	cd agent-api && pip install -r requirements.txt && playwright install chromium
	cd ui && npm install

# Run API locally
run-api:
	cd agent-api && \
	DATA_DIR=./data \
	ALLOW_PROD=false \
	uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload

# Run UI locally
run-ui:
	cd ui && npm run dev

# Run both (requires two terminals or use &)
run:
	@echo "Starting API in background..."
	cd agent-api && DATA_DIR=./data uvicorn app.main:app --host 0.0.0.0 --port 8080 &
	@echo "Starting UI..."
	cd ui && npm run dev

# Docker build
docker-build:
	docker build -t qa-agent-api:latest ./agent-api

# Docker run with compose
docker-run:
	docker-compose up --build

# Run tests
test:
	cd agent-api && pytest

# Clean up
clean:
	rm -rf agent-api/data/*
	rm -rf agent-api/__pycache__
	rm -rf agent-api/app/__pycache__
	rm -rf ui/.next
	rm -rf ui/node_modules/.cache

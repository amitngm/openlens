# QA Agent Makefile
# Build, test, and deploy the QA Agent

.PHONY: all build build-api build-runner test test-api test-runner lint clean docker-build docker-push helm-lint helm-install helm-upgrade help

# Configuration
REGISTRY ?= docker.io/library
VERSION ?= latest
NAMESPACE ?= qa-agent

# Image names
API_IMAGE = $(REGISTRY)/qa-agent-api:$(VERSION)
RUNNER_IMAGE = $(REGISTRY)/qa-agent-runner:$(VERSION)

# Default target
all: lint test build

# ==============================================================================
# Build
# ==============================================================================

build: build-api build-runner ## Build all components

build-api: ## Build Agent API
	@echo "Building Agent API..."
	cd agent-api && pip install -r requirements.txt

build-runner: ## Build Runner
	@echo "Building Runner..."
	cd runner && npm install

# ==============================================================================
# Test
# ==============================================================================

test: test-api test-runner ## Run all tests

test-api: ## Test Agent API
	@echo "Testing Agent API..."
	cd agent-api && python -m pytest tests/ -v --cov=app --cov-report=term-missing

test-runner: ## Test Runner
	@echo "Testing Runner..."
	cd runner && npm test

# ==============================================================================
# Lint
# ==============================================================================

lint: lint-api lint-runner lint-helm ## Lint all components

lint-api: ## Lint Agent API
	@echo "Linting Agent API..."
	cd agent-api && python -m flake8 app/ --max-line-length=100 --ignore=E501

lint-runner: ## Lint Runner
	@echo "Linting Runner..."
	cd runner && npm run lint || true

lint-helm: ## Lint Helm chart
	@echo "Linting Helm chart..."
	helm lint charts/qa-agent

# ==============================================================================
# Docker
# ==============================================================================

docker-build: docker-build-api docker-build-runner ## Build Docker images

docker-build-api: ## Build Agent API Docker image
	@echo "Building Agent API Docker image..."
	docker build -t $(API_IMAGE) agent-api/

docker-build-runner: ## Build Runner Docker image
	@echo "Building Runner Docker image..."
	docker build -t $(RUNNER_IMAGE) runner/

docker-push: ## Push Docker images
	@echo "Pushing Docker images..."
	docker push $(API_IMAGE)
	docker push $(RUNNER_IMAGE)

docker-run-api: ## Run Agent API locally
	docker run --rm -p 8080:8080 \
		-e ENVIRONMENT=development \
		-e IN_CLUSTER=false \
		$(API_IMAGE)

# ==============================================================================
# Kubernetes/Helm
# ==============================================================================

helm-lint: ## Lint Helm chart
	helm lint charts/qa-agent

helm-template: ## Template Helm chart (dry-run)
	helm template qa-agent charts/qa-agent --namespace $(NAMESPACE)

helm-install: ## Install Helm chart
	@echo "Installing QA Agent..."
	kubectl create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -
	helm install qa-agent charts/qa-agent \
		--namespace $(NAMESPACE) \
		--wait

helm-upgrade: ## Upgrade Helm chart
	@echo "Upgrading QA Agent..."
	helm upgrade qa-agent charts/qa-agent \
		--namespace $(NAMESPACE) \
		--wait

helm-uninstall: ## Uninstall Helm chart
	helm uninstall qa-agent --namespace $(NAMESPACE)

# ==============================================================================
# Development
# ==============================================================================

dev-api: ## Run Agent API in development mode
	cd agent-api && uvicorn app.main:app --reload --port 8080

dev-runner: ## Run Runner in development mode
	cd runner && npm run start -- --help

# ==============================================================================
# Utilities
# ==============================================================================

clean: ## Clean build artifacts
	@echo "Cleaning..."
	rm -rf agent-api/__pycache__ agent-api/.pytest_cache
	rm -rf agent-api/app/__pycache__ agent-api/app/**/__pycache__
	rm -rf runner/node_modules
	rm -rf api-runner/__pycache__
	find . -name "*.pyc" -delete
	find . -name ".coverage" -delete

logs: ## Show Agent API logs
	kubectl logs -f deployment/qa-agent-api -n $(NAMESPACE)

port-forward: ## Port forward Agent API
	kubectl port-forward svc/qa-agent-api 8080:8080 -n $(NAMESPACE)

status: ## Show deployment status
	kubectl get pods,svc,jobs -n $(NAMESPACE)

# ==============================================================================
# Help
# ==============================================================================

help: ## Show this help
	@echo "QA Agent Makefile"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

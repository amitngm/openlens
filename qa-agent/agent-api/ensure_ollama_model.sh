#!/usr/bin/env bash
set -euo pipefail

# Ensures an Ollama model is present locally.
# Usage:
#   ./ensure_ollama_model.sh llama3.1
#   MODEL=llama3.1 ./ensure_ollama_model.sh

MODEL="${1:-${MODEL:-llama2}}"

if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama is not installed. Install it first:"
  echo "  brew install ollama"
  echo "or download from:"
  echo "  https://ollama.com/download"
  exit 1
fi

echo "Checking Ollama..."
ollama --version >/dev/null

if ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$MODEL"; then
  echo "Model already present: $MODEL"
  exit 0
fi

echo "Pulling model: $MODEL"
ollama pull "$MODEL"

echo "Done. Installed model: $MODEL"


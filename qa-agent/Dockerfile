# QA Agent - Combined UI + API Docker Image
# Multi-stage build for optimal size

# ============================================
# Stage 1: Build the Next.js UI
# ============================================
FROM node:20-alpine AS ui-builder

WORKDIR /ui

# Copy package files
COPY ui/package*.json ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy UI source
COPY ui/ ./

# Update next.config.js for static export
RUN cat > next.config.js << 'EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_API_URL: '',
  },
};
module.exports = nextConfig;
EOF

# Build static export
RUN npm run build

# ============================================
# Stage 2: Build the Python API + Serve UI
# ============================================
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Create non-root user
RUN groupadd -r qaagent && useradd -r -g qaagent qaagent

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Python requirements
COPY agent-api/requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy API application code
COPY agent-api/app/ app/

# Copy sample flows
COPY flows/ /app/flows/

# Copy built UI static files from builder stage
COPY --from=ui-builder /ui/out /app/static

# Create data directories
RUN mkdir -p /data/artifacts && \
    chown -R qaagent:qaagent /data /app

# Switch to non-root user
USER qaagent

# Expose port (single port for both API and UI)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]

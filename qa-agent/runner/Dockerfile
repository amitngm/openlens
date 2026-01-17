# QA Agent Runner Dockerfile
FROM mcr.microsoft.com/playwright:v1.41.0-jammy

# Set environment variables
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Create non-root user
RUN groupadd -r qaagent && useradd -r -g qaagent qaagent

# Set work directory
WORKDIR /app

# Install kubectl for K8s checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    && chmod +x kubectl \
    && mv kubectl /usr/local/bin/ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ src/

# Create directories
RUN mkdir -p /data/artifacts /app/flows && \
    chown -R qaagent:qaagent /data /app

# Switch to non-root user
USER qaagent

# Default command
CMD ["node", "src/index.js"]

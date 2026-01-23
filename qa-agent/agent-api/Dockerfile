# QA Buddy Docker Image
FROM python:3.11-slim

# Install system dependencies for Playwright and image processing
RUN apt-get update && apt-get install -y \
    # Playwright dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    # OCR dependencies (optional)
    tesseract-ocr \
    # Image processing
    libjpeg-dev \
    libpng-dev \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy application code
COPY app/ /app/app/
COPY ui/ /app/ui/
COPY data/ /app/data/

# Create requirements.txt from current installation
RUN pip install --no-cache-dir \
    fastapi==0.128.0 \
    uvicorn==0.40.0 \
    playwright==1.57.0 \
    pydantic==2.12.5 \
    python-multipart==0.0.21 \
    Pillow \
    pytesseract

# Install Playwright browsers
RUN playwright install chromium && \
    playwright install-deps chromium

# Create data directories
RUN mkdir -p /app/data/temp_uploads/images

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/runs/health').read()"

# Start server
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

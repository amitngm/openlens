"""QA Agent API - Main FastAPI application."""

import logging
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.routers import interactive_qa
from app.database import init_db, close_db

logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","msg":"%(message)s"}'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager - startup and shutdown events."""
    # Startup
    logger.info("Initializing database...")
    try:
        await init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}", exc_info=True)
        # Continue anyway - file-based storage will work

    yield

    # Shutdown
    logger.info("Closing database connections...")
    await close_db()
    logger.info("Application shutdown complete")


app = FastAPI(
    title="QA Agent API",
    description="Intelligent Test Discovery and Execution with Interactive QA Buddy",
    version="2.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static UI files (must be before routers to avoid route conflicts)
ui_path = Path(__file__).parent.parent / "ui"
if ui_path.exists():
    try:
        app.mount("/ui", StaticFiles(directory=str(ui_path), html=True), name="ui")
        logger.info(f"UI served from: {ui_path.absolute()}")
    except Exception as e:
        logger.warning(f"Failed to mount UI: {e}")

# Direct route handler for /ui/ as fallback (serves index.html)
@app.get("/ui/")
async def ui_index():
    """Serve UI index page directly."""
    ui_path_check = Path(__file__).parent.parent / "ui" / "index.html"
    if ui_path_check.exists():
        return FileResponse(str(ui_path_check))
    raise HTTPException(status_code=404, detail="UI not found. Please ensure ui/index.html exists.")

# Include routers (after static mounts)
app.include_router(interactive_qa.router)

logger.info("QA Agent API initialized")


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "QA Agent API",
        "version": "2.1.0",
        "docs": "/docs",
        "endpoints": {
            "interactive_qa": "/runs",
            "ui": "/ui"
        }
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}

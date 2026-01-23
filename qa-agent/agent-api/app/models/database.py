"""Database models for QA Buddy persistence."""

from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, Integer, DateTime, JSON, Text, Boolean, Float, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class Run(Base):
    """Run metadata and summary."""
    __tablename__ = "runs"

    run_id = Column(String(50), primary_key=True, index=True)
    base_url = Column(String(500), nullable=False, index=True)
    env = Column(String(50), default="staging")
    status = Column(String(20), nullable=False, index=True)

    # Timestamps
    started_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    # Discovery summary (JSONB for fast queries)
    discovery_summary = Column(JSON, nullable=True)

    # Auth config (encrypted/hashed)
    auth_type = Column(String(50), nullable=True)

    # Artifacts path (file system)
    artifacts_path = Column(String(500), nullable=False)

    # Configuration
    headless = Column(Boolean, default=True)
    discovery_debug = Column(Boolean, default=False)

    # Metrics
    pages_discovered = Column(Integer, default=0)
    forms_found = Column(Integer, default=0)
    tables_found = Column(Integer, default=0)
    api_calls_captured = Column(Integer, default=0)

    # Relationships
    pages = relationship("Page", back_populates="run", cascade="all, delete-orphan")
    test_cases = relationship("TestCase", back_populates="run", cascade="all, delete-orphan")
    comparisons = relationship("RunComparison",
                               foreign_keys="RunComparison.run_id_a",
                               cascade="all, delete-orphan")


class Page(Base):
    """Discovered page details."""
    __tablename__ = "pages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(String(50), ForeignKey("runs.run_id", ondelete="CASCADE"), nullable=False, index=True)

    # Page identification
    url = Column(String(1000), nullable=False)
    title = Column(String(500), nullable=True)
    nav_text = Column(String(200), nullable=True)
    breadcrumb = Column(String(500), nullable=True)

    # Page signature (for comparison)
    page_signature = Column(JSON, nullable=True)

    # Page content summary
    forms_count = Column(Integer, default=0)
    tables_count = Column(Integer, default=0)
    buttons_count = Column(Integer, default=0)
    links_count = Column(Integer, default=0)

    # Full page data (JSONB)
    page_data = Column(JSON, nullable=True)

    # Discovery metadata
    discovered_at = Column(DateTime, default=datetime.utcnow)
    discovery_depth = Column(Integer, default=0)

    # Screenshot path
    screenshot_path = Column(String(500), nullable=True)

    # Relationship
    run = relationship("Run", back_populates="pages")


class TestCase(Base):
    """Generated test cases."""
    __tablename__ = "test_cases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(String(50), ForeignKey("runs.run_id", ondelete="CASCADE"), nullable=False, index=True)

    # Test case identification
    test_id = Column(String(100), nullable=False)
    test_name = Column(String(500), nullable=False)
    test_type = Column(String(50), nullable=False, index=True)

    # Test details
    feature_name = Column(String(200), nullable=True, index=True)
    priority = Column(String(20), default="medium")
    steps = Column(JSON, nullable=True)  # Array of steps

    # Test status (if executed)
    status = Column(String(20), default="pending")  # pending, passed, failed, skipped
    executed_at = Column(DateTime, nullable=True)
    execution_time_ms = Column(Float, nullable=True)

    # Relationship
    run = relationship("Run", back_populates="test_cases")


class RunComparison(Base):
    """Comparison between two runs."""
    __tablename__ = "run_comparisons"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Runs being compared
    run_id_a = Column(String(50), ForeignKey("runs.run_id", ondelete="CASCADE"), nullable=False, index=True)
    run_id_b = Column(String(50), ForeignKey("runs.run_id", ondelete="CASCADE"), nullable=False, index=True)

    # Comparison timestamp
    compared_at = Column(DateTime, default=datetime.utcnow)

    # Comparison results (JSONB)
    comparison_data = Column(JSON, nullable=False)

    # Summary metrics
    pages_added = Column(Integer, default=0)
    pages_removed = Column(Integer, default=0)
    pages_changed = Column(Integer, default=0)

    forms_added = Column(Integer, default=0)
    forms_removed = Column(Integer, default=0)

    test_cases_added = Column(Integer, default=0)
    test_cases_removed = Column(Integer, default=0)

    # Relationship
    run_a = relationship("Run", foreign_keys=[run_id_a])
    run_b = relationship("Run", foreign_keys=[run_id_b])


class UploadedImage(Base):
    """Uploaded images for analysis."""
    __tablename__ = "uploaded_images"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Image identification
    file_id = Column(String(50), unique=True, nullable=False, index=True)
    filename = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)

    # Image metadata
    content_type = Column(String(100), nullable=True)
    size = Column(Integer, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)

    # Upload timestamp
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    # Analysis results (JSONB)
    analysis_result = Column(JSON, nullable=True)

    # Associated run (nullable for pre-run uploads)
    run_id = Column(String(50), nullable=True, index=True)

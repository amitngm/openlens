"""Database repositories for CRUD operations."""

import logging
from datetime import datetime
from typing import List, Optional, Dict, Any
from sqlalchemy import select, and_, or_, desc, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.database import Run, Page, TestCase, RunComparison, UploadedImage

logger = logging.getLogger(__name__)


class RunRepository:
    """Repository for Run operations."""

    @staticmethod
    async def create_run(
        db: AsyncSession,
        run_id: str,
        base_url: str,
        env: str,
        artifacts_path: str,
        **kwargs
    ) -> Run:
        """Create a new run."""
        run = Run(
            run_id=run_id,
            base_url=base_url,
            env=env,
            artifacts_path=artifacts_path,
            status="pending",
            started_at=datetime.utcnow(),
            **kwargs
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        logger.info(f"Created run: {run_id}")
        return run

    @staticmethod
    async def get_run(db: AsyncSession, run_id: str) -> Optional[Run]:
        """Get run by ID."""
        result = await db.execute(select(Run).where(Run.run_id == run_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def update_run(db: AsyncSession, run_id: str, **updates) -> Optional[Run]:
        """Update run fields."""
        run = await RunRepository.get_run(db, run_id)
        if not run:
            return None

        for key, value in updates.items():
            if hasattr(run, key):
                setattr(run, key, value)

        await db.commit()
        await db.refresh(run)
        logger.info(f"Updated run: {run_id}")
        return run

    @staticmethod
    async def list_runs(
        db: AsyncSession,
        base_url: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[Run]:
        """List runs with optional filters."""
        query = select(Run).order_by(desc(Run.started_at))

        if base_url:
            query = query.where(Run.base_url == base_url)
        if status:
            query = query.where(Run.status == status)

        query = query.limit(limit).offset(offset)

        result = await db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    async def get_run_with_pages(db: AsyncSession, run_id: str) -> Optional[Run]:
        """Get run with all related pages."""
        result = await db.execute(
            select(Run)
            .options(selectinload(Run.pages))
            .where(Run.run_id == run_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def get_run_with_test_cases(db: AsyncSession, run_id: str) -> Optional[Run]:
        """Get run with all related test cases."""
        result = await db.execute(
            select(Run)
            .options(selectinload(Run.test_cases))
            .where(Run.run_id == run_id)
        )
        return result.scalar_one_or_none()


class PageRepository:
    """Repository for Page operations."""

    @staticmethod
    async def create_page(db: AsyncSession, run_id: str, page_data: Dict[str, Any]) -> Page:
        """Create a new page."""
        page = Page(
            run_id=run_id,
            url=page_data.get("url", ""),
            title=page_data.get("title", ""),
            nav_text=page_data.get("nav_text", ""),
            breadcrumb=page_data.get("breadcrumb", ""),
            page_signature=page_data.get("page_signature"),
            page_data=page_data,
            forms_count=len(page_data.get("forms", [])),
            tables_count=len(page_data.get("tables", [])),
            buttons_count=len(page_data.get("primary_actions", [])),
            links_count=len(page_data.get("navigation_items", [])),
            discovery_depth=page_data.get("depth", 0),
            screenshot_path=page_data.get("screenshot"),
            discovered_at=datetime.utcnow()
        )
        db.add(page)
        await db.commit()
        await db.refresh(page)
        return page

    @staticmethod
    async def bulk_create_pages(db: AsyncSession, run_id: str, pages_data: List[Dict[str, Any]]):
        """Bulk create pages for a run."""
        pages = [
            Page(
                run_id=run_id,
                url=p.get("url", ""),
                title=p.get("title", ""),
                nav_text=p.get("nav_text", ""),
                breadcrumb=p.get("page_signature", {}).get("breadcrumb", ""),
                page_signature=p.get("page_signature"),
                page_data=p,
                forms_count=len(p.get("forms", [])),
                tables_count=len(p.get("tables", [])),
                buttons_count=len(p.get("primary_actions", [])),
                links_count=len(p.get("navigation_items", [])),
                discovered_at=datetime.utcnow()
            )
            for p in pages_data
        ]
        db.add_all(pages)
        await db.commit()
        logger.info(f"Created {len(pages)} pages for run: {run_id}")

    @staticmethod
    async def get_pages_by_run(db: AsyncSession, run_id: str) -> List[Page]:
        """Get all pages for a run."""
        result = await db.execute(select(Page).where(Page.run_id == run_id))
        return list(result.scalars().all())


class TestCaseRepository:
    """Repository for TestCase operations."""

    @staticmethod
    async def create_test_case(
        db: AsyncSession,
        run_id: str,
        test_id: str,
        test_name: str,
        test_type: str,
        **kwargs
    ) -> TestCase:
        """Create a new test case."""
        test_case = TestCase(
            run_id=run_id,
            test_id=test_id,
            test_name=test_name,
            test_type=test_type,
            **kwargs
        )
        db.add(test_case)
        await db.commit()
        await db.refresh(test_case)
        return test_case

    @staticmethod
    async def bulk_create_test_cases(db: AsyncSession, run_id: str, test_cases_data: List[Dict[str, Any]]):
        """Bulk create test cases for a run."""
        test_cases = [
            TestCase(
                run_id=run_id,
                test_id=tc.get("test_id", ""),
                test_name=tc.get("test_name", ""),
                test_type=tc.get("test_type", ""),
                feature_name=tc.get("feature_name"),
                priority=tc.get("priority", "medium"),
                steps=tc.get("steps"),
                status=tc.get("status", "pending")
            )
            for tc in test_cases_data
        ]
        db.add_all(test_cases)
        await db.commit()
        logger.info(f"Created {len(test_cases)} test cases for run: {run_id}")

    @staticmethod
    async def get_test_cases_by_run(db: AsyncSession, run_id: str) -> List[TestCase]:
        """Get all test cases for a run."""
        result = await db.execute(select(TestCase).where(TestCase.run_id == run_id))
        return list(result.scalars().all())

    @staticmethod
    async def get_test_cases_by_feature(db: AsyncSession, run_id: str, feature_name: str) -> List[TestCase]:
        """Get test cases for a specific feature."""
        result = await db.execute(
            select(TestCase).where(
                and_(TestCase.run_id == run_id, TestCase.feature_name == feature_name)
            )
        )
        return list(result.scalars().all())


class ComparisonRepository:
    """Repository for RunComparison operations."""

    @staticmethod
    async def create_comparison(
        db: AsyncSession,
        run_id_a: str,
        run_id_b: str,
        comparison_data: Dict[str, Any],
        **metrics
    ) -> RunComparison:
        """Create a new run comparison."""
        comparison = RunComparison(
            run_id_a=run_id_a,
            run_id_b=run_id_b,
            comparison_data=comparison_data,
            compared_at=datetime.utcnow(),
            **metrics
        )
        db.add(comparison)
        await db.commit()
        await db.refresh(comparison)
        logger.info(f"Created comparison: {run_id_a} vs {run_id_b}")
        return comparison

    @staticmethod
    async def get_comparison(db: AsyncSession, run_id_a: str, run_id_b: str) -> Optional[RunComparison]:
        """Get existing comparison between two runs."""
        result = await db.execute(
            select(RunComparison).where(
                or_(
                    and_(RunComparison.run_id_a == run_id_a, RunComparison.run_id_b == run_id_b),
                    and_(RunComparison.run_id_a == run_id_b, RunComparison.run_id_b == run_id_a)
                )
            ).order_by(desc(RunComparison.compared_at))
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def get_comparisons_for_run(db: AsyncSession, run_id: str) -> List[RunComparison]:
        """Get all comparisons involving a run."""
        result = await db.execute(
            select(RunComparison).where(
                or_(RunComparison.run_id_a == run_id, RunComparison.run_id_b == run_id)
            ).order_by(desc(RunComparison.compared_at))
        )
        return list(result.scalars().all())


class ImageRepository:
    """Repository for UploadedImage operations."""

    @staticmethod
    async def create_image(
        db: AsyncSession,
        file_id: str,
        filename: str,
        file_path: str,
        analysis_result: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> UploadedImage:
        """Create a new uploaded image record."""
        image = UploadedImage(
            file_id=file_id,
            filename=filename,
            file_path=file_path,
            analysis_result=analysis_result,
            uploaded_at=datetime.utcnow(),
            **kwargs
        )
        db.add(image)
        await db.commit()
        await db.refresh(image)
        return image

    @staticmethod
    async def get_image(db: AsyncSession, file_id: str) -> Optional[UploadedImage]:
        """Get uploaded image by file_id."""
        result = await db.execute(select(UploadedImage).where(UploadedImage.file_id == file_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def get_images_by_run(db: AsyncSession, run_id: str) -> List[UploadedImage]:
        """Get all images for a run."""
        result = await db.execute(select(UploadedImage).where(UploadedImage.run_id == run_id))
        return list(result.scalars().all())

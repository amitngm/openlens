"""Database storage service for persisting analysis results."""

import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.database.repositories import (
    RunRepository,
    PageRepository,
    TestCaseRepository,
    ComparisonRepository,
    ImageRepository
)

logger = logging.getLogger(__name__)


class DatabaseStorageService:
    """Service for storing and retrieving analysis data from database."""

    @staticmethod
    async def store_run_metadata(
        db: AsyncSession,
        run_id: str,
        base_url: str,
        env: str,
        artifacts_path: str,
        config: Dict[str, Any]
    ):
        """Store run metadata in database."""
        await RunRepository.create_run(
            db=db,
            run_id=run_id,
            base_url=base_url,
            env=env,
            artifacts_path=artifacts_path,
            headless=config.get("headless", True),
            discovery_debug=config.get("discovery_debug", False),
            auth_type=config.get("auth", {}).get("type") if config.get("auth") else None
        )
        logger.info(f"[{run_id}] Stored run metadata in database")

    @staticmethod
    async def store_discovery_results(
        db: AsyncSession,
        run_id: str,
        discovery_file: Path
    ):
        """
        Store discovery results in database.

        Reads discovery.json and stores:
        - Pages with signatures
        - Summary metrics
        """
        if not discovery_file.exists():
            logger.warning(f"[{run_id}] Discovery file not found: {discovery_file}")
            return

        try:
            with open(discovery_file, "r", encoding="utf-8") as f:
                discovery_data = json.load(f)

            # Update run with discovery summary
            await RunRepository.update_run(
                db=db,
                run_id=run_id,
                discovery_summary=discovery_data.get("summary"),
                pages_discovered=len(discovery_data.get("pages", [])),
                forms_found=sum(len(p.get("forms", [])) for p in discovery_data.get("pages", [])),
                tables_found=sum(len(p.get("tables", [])) for p in discovery_data.get("pages", [])),
                api_calls_captured=len(discovery_data.get("api_calls", []))
            )

            # Store pages
            pages = discovery_data.get("pages", [])
            if pages:
                await PageRepository.bulk_create_pages(db, run_id, pages)

            logger.info(f"[{run_id}] Stored {len(pages)} pages in database")

        except Exception as e:
            logger.error(f"[{run_id}] Failed to store discovery results: {e}", exc_info=True)

    @staticmethod
    async def store_test_cases(
        db: AsyncSession,
        run_id: str,
        test_cases: List[Dict[str, Any]]
    ):
        """Store generated test cases in database."""
        if not test_cases:
            return

        try:
            await TestCaseRepository.bulk_create_test_cases(db, run_id, test_cases)
            logger.info(f"[{run_id}] Stored {len(test_cases)} test cases in database")
        except Exception as e:
            logger.error(f"[{run_id}] Failed to store test cases: {e}", exc_info=True)

    @staticmethod
    async def complete_run(
        db: AsyncSession,
        run_id: str,
        status: str
    ):
        """Mark run as completed."""
        await RunRepository.update_run(
            db=db,
            run_id=run_id,
            status=status,
            completed_at=datetime.utcnow()
        )
        logger.info(f"[{run_id}] Marked run as {status}")

    @staticmethod
    async def compare_runs(
        db: AsyncSession,
        run_id_a: str,
        run_id_b: str
    ) -> Dict[str, Any]:
        """
        Compare two runs and return differences.

        Compares:
        - Pages added/removed/changed
        - Forms added/removed
        - Test cases added/removed
        - API calls changed
        """
        # Get runs with pages
        run_a = await RunRepository.get_run_with_pages(db, run_id_a)
        run_b = await RunRepository.get_run_with_pages(db, run_id_b)

        if not run_a or not run_b:
            raise ValueError("One or both runs not found")

        # Extract page URLs and signatures
        pages_a = {p.url: p for p in run_a.pages}
        pages_b = {p.url: p for p in run_b.pages}

        urls_a = set(pages_a.keys())
        urls_b = set(pages_b.keys())

        # Calculate differences
        added_urls = urls_b - urls_a
        removed_urls = urls_a - urls_b
        common_urls = urls_a & urls_b

        # Check for changes in common pages
        changed_pages = []
        for url in common_urls:
            page_a = pages_a[url]
            page_b = pages_b[url]

            # Compare signatures or content
            if (page_a.forms_count != page_b.forms_count or
                page_a.tables_count != page_b.tables_count or
                page_a.buttons_count != page_b.buttons_count):
                changed_pages.append({
                    "url": url,
                    "changes": {
                        "forms": {"before": page_a.forms_count, "after": page_b.forms_count},
                        "tables": {"before": page_a.tables_count, "after": page_b.tables_count},
                        "buttons": {"before": page_a.buttons_count, "after": page_b.buttons_count}
                    }
                })

        # Get test cases
        test_cases_a = await TestCaseRepository.get_test_cases_by_run(db, run_id_a)
        test_cases_b = await TestCaseRepository.get_test_cases_by_run(db, run_id_b)

        test_ids_a = {tc.test_id for tc in test_cases_a}
        test_ids_b = {tc.test_id for tc in test_cases_b}

        # Build comparison result
        comparison_data = {
            "run_a": {
                "run_id": run_id_a,
                "base_url": run_a.base_url,
                "started_at": run_a.started_at.isoformat(),
                "pages_count": len(run_a.pages),
                "test_cases_count": len(test_cases_a)
            },
            "run_b": {
                "run_id": run_id_b,
                "base_url": run_b.base_url,
                "started_at": run_b.started_at.isoformat(),
                "pages_count": len(run_b.pages),
                "test_cases_count": len(test_cases_b)
            },
            "pages": {
                "added": [{"url": url, "title": pages_b[url].title} for url in added_urls],
                "removed": [{"url": url, "title": pages_a[url].title} for url in removed_urls],
                "changed": changed_pages,
                "unchanged": len(common_urls) - len(changed_pages)
            },
            "test_cases": {
                "added": list(test_ids_b - test_ids_a),
                "removed": list(test_ids_a - test_ids_b),
                "total_a": len(test_cases_a),
                "total_b": len(test_cases_b)
            },
            "summary": {
                "pages_added": len(added_urls),
                "pages_removed": len(removed_urls),
                "pages_changed": len(changed_pages),
                "test_cases_added": len(test_ids_b - test_ids_a),
                "test_cases_removed": len(test_ids_a - test_ids_b)
            }
        }

        # Store comparison in database
        await ComparisonRepository.create_comparison(
            db=db,
            run_id_a=run_id_a,
            run_id_b=run_id_b,
            comparison_data=comparison_data,
            pages_added=len(added_urls),
            pages_removed=len(removed_urls),
            pages_changed=len(changed_pages),
            forms_added=sum(pages_b[url].forms_count for url in added_urls),
            forms_removed=sum(pages_a[url].forms_count for url in removed_urls),
            test_cases_added=len(test_ids_b - test_ids_a),
            test_cases_removed=len(test_ids_a - test_ids_b)
        )

        logger.info(f"Compared runs: {run_id_a} vs {run_id_b}")
        return comparison_data

    @staticmethod
    async def store_uploaded_image(
        db: AsyncSession,
        file_id: str,
        filename: str,
        file_path: str,
        analysis_result: Dict[str, Any],
        run_id: Optional[str] = None,
        **metadata
    ):
        """Store uploaded image and analysis in database."""
        await ImageRepository.create_image(
            db=db,
            file_id=file_id,
            filename=filename,
            file_path=file_path,
            analysis_result=analysis_result,
            run_id=run_id,
            **metadata
        )
        logger.info(f"Stored uploaded image: {file_id}")

    @staticmethod
    async def get_historical_runs(
        db: AsyncSession,
        base_url: str,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Get historical runs for a base URL."""
        runs = await RunRepository.list_runs(db, base_url=base_url, limit=limit)
        return [
            {
                "run_id": run.run_id,
                "started_at": run.started_at.isoformat(),
                "status": run.status,
                "pages_discovered": run.pages_discovered,
                "forms_found": run.forms_found,
                "env": run.env
            }
            for run in runs
        ]

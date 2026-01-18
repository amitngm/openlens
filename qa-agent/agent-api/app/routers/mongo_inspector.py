"""
MongoDB Inspector - Read-only access to MongoDB for debugging

Endpoints:
- GET /mongo/collections/{namespace} - List collections (if MONGO_URI configured)
- GET /mongo/verify/{namespace} - Verify record patterns (read-only)
"""

import os
import json
import logging
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, OperationFailure

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mongo", tags=["MongoDB Inspector"])

# Configuration: MONGO_URI_<NAMESPACE>=mongodb://...
def get_mongo_uri(namespace: str) -> Optional[str]:
    """Get MongoDB URI for a namespace from environment."""
    uri = os.getenv(f"MONGO_URI_{namespace.upper().replace('-', '_')}")
    if not uri:
        # Try generic MONGO_URI
        uri = os.getenv("MONGO_URI")
    return uri


def get_mongo_client(namespace: str) -> Optional[MongoClient]:
    """Get MongoDB client for namespace (if configured)."""
    uri = get_mongo_uri(namespace)
    if not uri:
        return None
    
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        # Test connection
        client.admin.command('ping')
        return client
    except ConnectionFailure as e:
        logger.warning(f"MongoDB connection failed for {namespace}: {e}")
        return None
    except Exception as e:
        logger.error(f"MongoDB error for {namespace}: {e}")
        return None


@router.get("/collections/{namespace}")
async def list_collections(namespace: str):
    """List collections in MongoDB for a namespace (read-only)."""
    client = get_mongo_client(namespace)
    if not client:
        raise HTTPException(404, f"MongoDB not configured for namespace '{namespace}' (set MONGO_URI_{namespace.upper()})")
    
    try:
        db_name = urlparse(get_mongo_uri(namespace)).path.lstrip('/') or 'admin'
        db = client[db_name]
        
        collections = []
        for coll_name in db.list_collection_names():
            try:
                count = db[coll_name].count_documents({})
                # Get sample document structure (first doc only, read-only)
                sample = db[coll_name].find_one({}, {"_id": 0})
                collections.append({
                    "name": coll_name,
                    "count": count,
                    "sample_fields": list(sample.keys()) if sample else []
                })
            except Exception as e:
                logger.warning(f"Failed to inspect collection {coll_name}: {e}")
                collections.append({
                    "name": coll_name,
                    "count": None,
                    "error": str(e)[:100]
                })
        
        return {
            "namespace": namespace,
            "database": db_name,
            "collections": collections,
            "total": len(collections)
        }
        
    except OperationFailure as e:
        raise HTTPException(403, f"MongoDB access denied: {e}")
    except Exception as e:
        raise HTTPException(500, f"Failed to list collections: {str(e)}")
    finally:
        client.close()


@router.get("/verify/{namespace}")
async def verify_patterns(namespace: str, collection: Optional[str] = None):
    """Verify record patterns in MongoDB (read-only checks)."""
    client = get_mongo_client(namespace)
    if not client:
        raise HTTPException(404, f"MongoDB not configured for namespace '{namespace}'")
    
    try:
        db_name = urlparse(get_mongo_uri(namespace)).path.lstrip('/') or 'admin'
        db = client[db_name]
        
        if collection:
            collections_to_check = [collection]
        else:
            collections_to_check = db.list_collection_names()[:10]  # Limit to 10
        
        results = []
        for coll_name in collections_to_check:
            try:
                coll = db[coll_name]
                total = coll.count_documents({})
                
                # Sample a few documents to check patterns
                samples = list(coll.find({}).limit(5))
                
                # Check for common patterns
                patterns = {
                    "has_id": all("_id" in doc for doc in samples),
                    "has_timestamps": any("created_at" in doc or "updated_at" in doc or "timestamp" in doc for doc in samples),
                    "has_status": any("status" in doc for doc in samples),
                    "sample_count": len(samples)
                }
                
                results.append({
                    "collection": coll_name,
                    "total_documents": total,
                    "patterns": patterns,
                    "sample_keys": list(samples[0].keys()) if samples else []
                })
            except Exception as e:
                results.append({
                    "collection": coll_name,
                    "error": str(e)[:100]
                })
        
        return {
            "namespace": namespace,
            "database": db_name,
            "checks": results
        }
        
    except Exception as e:
        raise HTTPException(500, f"Failed to verify patterns: {str(e)}")
    finally:
        client.close()

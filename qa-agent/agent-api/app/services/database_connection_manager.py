"""Database connection manager for introspection via port-forward."""

import asyncio
import logging
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)


class DatabaseConnectionManager:
    """Manage connections to databases through port-forward for introspection."""

    def __init__(self):
        self.connections: Dict[int, Any] = {}  # db_service_id -> connection
        self.connection_types: Dict[int, str] = {}  # db_service_id -> db_type

    async def connect_postgresql(self, host: str, port: int, database: str = "postgres", user: str = "postgres", password: str = "") -> Optional[Any]:
        """
        Connect to PostgreSQL via asyncpg.

        Args:
            host: Database host (usually localhost for port-forward)
            port: Database port (local port from port-forward)
            database: Database name
            user: Username
            password: Password

        Returns:
            asyncpg Connection object or None
        """
        try:
            import asyncpg

            conn = await asyncpg.connect(
                host=host,
                port=port,
                database=database,
                user=user,
                password=password,
                timeout=10
            )

            logger.info(f"Connected to PostgreSQL at {host}:{port}")
            return conn

        except ImportError:
            logger.error("asyncpg not installed. Install with: pip install asyncpg")
            return None
        except Exception as e:
            logger.error(f"Failed to connect to PostgreSQL: {e}")
            return None

    async def connect_mongodb(self, host: str, port: int, database: str = "admin", username: str = "", password: str = "") -> Optional[Any]:
        """
        Connect to MongoDB via motor (async driver).

        Args:
            host: Database host (usually localhost for port-forward)
            port: Database port (local port from port-forward)
            database: Database name
            username: Username (optional)
            password: Password (optional)

        Returns:
            motor AsyncIOMotorClient object or None
        """
        try:
            from motor.motor_asyncio import AsyncIOMotorClient

            # Build connection string
            if username and password:
                connection_string = f"mongodb://{username}:{password}@{host}:{port}/{database}"
            else:
                connection_string = f"mongodb://{host}:{port}/{database}"

            client = AsyncIOMotorClient(
                connection_string,
                serverSelectionTimeoutMS=10000
            )

            # Test connection
            await client.admin.command('ping')

            logger.info(f"Connected to MongoDB at {host}:{port}")
            return client

        except ImportError:
            logger.error("motor not installed. Install with: pip install motor")
            return None
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            return None

    async def list_postgresql_tables(self, conn: Any) -> List[Dict]:
        """
        Query pg_catalog to list tables.

        Args:
            conn: asyncpg Connection object

        Returns:
            List of table info dictionaries
        """
        try:
            query = """
                SELECT
                    schemaname as schema,
                    tablename as table_name,
                    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
                FROM pg_tables
                WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY schemaname, tablename;
            """

            rows = await conn.fetch(query)

            tables = []
            for row in rows:
                tables.append({
                    "schema": row["schema"],
                    "name": row["table_name"],
                    "size": row["size"],
                })

            logger.info(f"Found {len(tables)} PostgreSQL tables")
            return tables

        except Exception as e:
            logger.error(f"Error listing PostgreSQL tables: {e}")
            return []

    async def list_postgresql_columns(self, conn: Any, schema: str, table_name: str) -> List[Dict]:
        """
        Get column information for a PostgreSQL table.

        Args:
            conn: asyncpg Connection object
            schema: Schema name
            table_name: Table name

        Returns:
            List of column info dictionaries
        """
        try:
            query = """
                SELECT
                    column_name,
                    data_type,
                    is_nullable,
                    column_default
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position;
            """

            rows = await conn.fetch(query, schema, table_name)

            columns = []
            for row in rows:
                columns.append({
                    "name": row["column_name"],
                    "type": row["data_type"],
                    "nullable": row["is_nullable"] == "YES",
                    "default": row["column_default"],
                })

            return columns

        except Exception as e:
            logger.error(f"Error listing columns: {e}")
            return []

    async def list_mongodb_databases(self, client: Any) -> List[str]:
        """
        List all databases in MongoDB.

        Args:
            client: motor AsyncIOMotorClient object

        Returns:
            List of database names
        """
        try:
            db_list = await client.list_database_names()
            # Filter out system databases
            user_dbs = [db for db in db_list if db not in ["admin", "config", "local"]]

            logger.info(f"Found {len(user_dbs)} MongoDB databases")
            return user_dbs

        except Exception as e:
            logger.error(f"Error listing MongoDB databases: {e}")
            return []

    async def list_mongodb_collections(self, client: Any, database: str) -> List[Dict]:
        """
        List collections in MongoDB database.

        Args:
            client: motor AsyncIOMotorClient object
            database: Database name

        Returns:
            List of collection info dictionaries
        """
        try:
            db = client[database]
            collection_names = await db.list_collection_names()

            collections = []
            for name in collection_names:
                # Get document count
                try:
                    count = await db[name].count_documents({})
                except Exception:
                    count = 0

                collections.append({
                    "name": name,
                    "document_count": count,
                })

            logger.info(f"Found {len(collections)} collections in {database}")
            return collections

        except Exception as e:
            logger.error(f"Error listing MongoDB collections: {e}")
            return []

    async def get_mongodb_sample_document(self, client: Any, database: str, collection: str) -> Optional[Dict]:
        """
        Get a sample document from MongoDB collection to infer schema.

        Args:
            client: motor AsyncIOMotorClient object
            database: Database name
            collection: Collection name

        Returns:
            Sample document or None
        """
        try:
            db = client[database]
            doc = await db[collection].find_one()
            return doc

        except Exception as e:
            logger.error(f"Error getting sample document: {e}")
            return None

    async def connect(self, db_service_id: int, db_type: str, host: str, port: int, **kwargs) -> bool:
        """
        Connect to database and store connection.

        Args:
            db_service_id: Database service ID
            db_type: Database type (mongodb, postgresql, etc.)
            host: Database host
            port: Database port
            **kwargs: Additional connection parameters (database, user, password)

        Returns:
            True if connected successfully
        """
        try:
            if db_type == "postgresql":
                conn = await self.connect_postgresql(
                    host=host,
                    port=port,
                    database=kwargs.get("database", "postgres"),
                    user=kwargs.get("user", "postgres"),
                    password=kwargs.get("password", "")
                )
                if conn:
                    self.connections[db_service_id] = conn
                    self.connection_types[db_service_id] = db_type
                    return True

            elif db_type == "mongodb":
                client = await self.connect_mongodb(
                    host=host,
                    port=port,
                    database=kwargs.get("database", "admin"),
                    username=kwargs.get("username", ""),
                    password=kwargs.get("password", "")
                )
                if client:
                    self.connections[db_service_id] = client
                    self.connection_types[db_service_id] = db_type
                    return True

            else:
                logger.warning(f"Unsupported database type: {db_type}")
                return False

        except Exception as e:
            logger.error(f"Error connecting to database: {e}")
            return False

        return False

    async def disconnect(self, db_service_id: int):
        """
        Disconnect from database.

        Args:
            db_service_id: Database service ID
        """
        conn = self.connections.get(db_service_id)
        if not conn:
            return

        db_type = self.connection_types.get(db_service_id)

        try:
            if db_type == "postgresql":
                await conn.close()
            elif db_type == "mongodb":
                conn.close()

            logger.info(f"Disconnected from {db_type} database (service ID: {db_service_id})")

        except Exception as e:
            logger.error(f"Error disconnecting: {e}")

        finally:
            del self.connections[db_service_id]
            del self.connection_types[db_service_id]

    async def list_tables(self, db_service_id: int, **kwargs) -> List[Dict]:
        """
        List tables/collections for a connected database.

        Args:
            db_service_id: Database service ID
            **kwargs: Additional parameters (schema, database name)

        Returns:
            List of table/collection info
        """
        conn = self.connections.get(db_service_id)
        if not conn:
            logger.error(f"No connection for service ID {db_service_id}")
            return []

        db_type = self.connection_types.get(db_service_id)

        try:
            if db_type == "postgresql":
                return await self.list_postgresql_tables(conn)

            elif db_type == "mongodb":
                # For MongoDB, we need database name
                database = kwargs.get("database")
                if not database:
                    # List databases instead
                    databases = await self.list_mongodb_databases(conn)
                    return [{"name": db, "type": "database"} for db in databases]
                else:
                    return await self.list_mongodb_collections(conn, database)

        except Exception as e:
            logger.error(f"Error listing tables: {e}")
            return []

        return []

    def is_connected(self, db_service_id: int) -> bool:
        """Check if database service is connected."""
        return db_service_id in self.connections


# Global instance
_db_connection_manager = None


def get_database_connection_manager() -> DatabaseConnectionManager:
    """Get global DatabaseConnectionManager instance."""
    global _db_connection_manager
    if _db_connection_manager is None:
        _db_connection_manager = DatabaseConnectionManager()
    return _db_connection_manager

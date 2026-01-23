# QA Buddy - Database Storage & Analysis Comparison

## Overview

QA Buddy now includes **persistent database storage** for all discovery analysis results. This enables:

- ✅ **Historical tracking** - Store every discovery run
- ✅ **Run comparison** - Compare runs to identify changes
- ✅ **Trend analysis** - Track application changes over time
- ✅ **Test case management** - Store and manage generated test cases
- ✅ **Fast queries** - Search and filter historical data

---

## Database Support

QA Buddy supports two database backends:

### 1. SQLite (Default - Development)

**Advantages:**
- Zero configuration
- File-based (`qa_buddy.db`)
- Perfect for development
- No separate database server needed

**Current setup:** Automatically used when no `DATABASE_URL` is set.

### 2. PostgreSQL (Recommended - Production)

**Advantages:**
- Scalable and robust
- Advanced JSON querying (JSONB)
- Concurrent access support
- Production-ready

**Setup:** Set `DATABASE_URL` environment variable

---

## Quick Start

### Using SQLite (Already Working!)

No configuration needed! The database is automatically created:

```bash
# Database file location
ls -la qa_buddy.db

# Test the database
curl http://localhost:8000/runs/stats
```

### Switching to PostgreSQL

1. **Using Docker Compose** (Easiest):

```bash
# Start QA Buddy with PostgreSQL
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

2. **Manual PostgreSQL Setup**:

```bash
# Install PostgreSQL
brew install postgresql@15  # Mac
# or
sudo apt install postgresql-15  # Linux

# Create database
createdb qa_buddy

# Set environment variable
export DATABASE_URL="postgresql+asyncpg://user:password@localhost/qa_buddy"

# Start server
uvicorn app.main:app --reload
```

---

## Database Features

### 1. Store Run Analysis

After a discovery run completes, store it in the database:

```bash
# Store analysis for a run
curl -X POST http://localhost:8000/runs/{run_id}/store

# Response
{
  "run_id": "abc123",
  "message": "Run analysis stored successfully in database",
  "stored": {
    "metadata": true,
    "discovery": true,
    "test_cases": 45
  }
}
```

**What gets stored:**
- Run metadata (URL, environment, timestamps)
- All discovered pages with signatures
- Forms, tables, buttons counts
- Generated test cases organized by feature
- API calls captured
- Screenshots paths

### 2. Compare Two Runs

Compare any two stored runs to see what changed:

```bash
# Compare runs
curl http://localhost:8000/runs/compare/run_1/vs/run_2

# Response
{
  "comparison": {
    "run_a": {
      "run_id": "run_1",
      "started_at": "2026-01-23T10:00:00Z",
      "pages_count": 25
    },
    "run_b": {
      "run_id": "run_2",
      "started_at": "2026-01-23T14:00:00Z",
      "pages_count": 28
    },
    "pages": {
      "added": [
        {"url": "/new-feature", "title": "New Feature Page"}
      ],
      "removed": [
        {"url": "/old-page", "title": "Deprecated Page"}
      ],
      "changed": [
        {
          "url": "/dashboard",
          "changes": {
            "forms": {"before": 2, "after": 3},
            "tables": {"before": 1, "after": 1}
          }
        }
      ]
    },
    "test_cases": {
      "added": ["TC_NEW_1", "TC_NEW_2"],
      "removed": [],
      "total_a": 45,
      "total_b": 47
    },
    "summary": {
      "pages_added": 3,
      "pages_removed": 1,
      "pages_changed": 5,
      "test_cases_added": 2
    }
  }
}
```

### 3. Get Run History

View all historical runs for an application:

```bash
# Get history for a base URL
curl "http://localhost:8000/runs/history?base_url=https://myapp.com&limit=10"

# Response
{
  "base_url": "https://myapp.com",
  "runs": [
    {
      "run_id": "latest_run",
      "started_at": "2026-01-23T18:00:00Z",
      "status": "completed",
      "pages_discovered": 28,
      "forms_found": 12,
      "env": "staging"
    },
    {
      "run_id": "previous_run",
      "started_at": "2026-01-22T18:00:00Z",
      "status": "completed",
      "pages_discovered": 25,
      "forms_found": 10,
      "env": "staging"
    }
  ],
  "total": 10
}
```

### 4. Database Statistics

Get overall statistics:

```bash
curl http://localhost:8000/runs/stats

# Response
{
  "statistics": {
    "total_runs": 42,
    "total_pages": 1250,
    "total_test_cases": 3500
  },
  "recent_runs": [
    {"run_id": "...", "started_at": "...", "pages": 28},
    ...
  ]
}
```

---

## Database Schema

### Tables

1. **runs** - Run metadata
   - `run_id` (PK)
   - `base_url`, `env`, `status`
   - `started_at`, `completed_at`
   - `discovery_summary` (JSON)
   - `pages_discovered`, `forms_found`, `tables_found`

2. **pages** - Discovered pages
   - `id` (PK)
   - `run_id` (FK)
   - `url`, `title`, `breadcrumb`
   - `page_signature` (JSON)
   - `forms_count`, `tables_count`
   - `page_data` (JSON)

3. **test_cases** - Generated test cases
   - `id` (PK)
   - `run_id` (FK)
   - `test_id`, `test_name`, `test_type`
   - `feature_name`, `priority`
   - `steps` (JSON)
   - `status`, `executed_at`

4. **run_comparisons** - Stored comparisons
   - `id` (PK)
   - `run_id_a`, `run_id_b` (FK)
   - `comparison_data` (JSON)
   - `pages_added`, `pages_removed`, `pages_changed`

5. **uploaded_images** - Image analysis
   - `id` (PK)
   - `file_id`, `filename`
   - `analysis_result` (JSON)
   - `run_id` (FK, nullable)

---

## Typical Workflow

### Daily Regression Testing

```bash
# 1. Run discovery
curl -X POST http://localhost:8000/runs/start \
  -H "Content-Type: application/json" \
  -d '{"base_url": "https://myapp.com", "env": "staging"}'

# Response: {"run_id": "today_run"}

# 2. Wait for completion, then store
curl -X POST http://localhost:8000/runs/today_run/store

# 3. Compare with yesterday's run
curl http://localhost:8000/runs/compare/yesterday_run/vs/today_run

# 4. Review changes
# - New pages? New features added?
# - Missing pages? Features removed?
# - Changed pages? UI updates?
```

### Weekly Trend Analysis

```bash
# Get last 30 runs
curl "http://localhost:8000/runs/history?base_url=https://myapp.com&limit=30"

# Analyze trends:
# - Pages discovered over time
# - Forms added/removed
# - Test cases growing/shrinking
```

---

## Configuration

### Environment Variables

```bash
# Database URL (default: SQLite)
DATABASE_URL=sqlite+aiosqlite:///./qa_buddy.db

# For PostgreSQL
DATABASE_URL=postgresql+asyncpg://user:pass@localhost/qa_buddy

# For PostgreSQL in Docker
DATABASE_URL=postgresql+asyncpg://qa_user:qa_password@postgres:5432/qa_buddy
```

### Docker Compose Configuration

The `docker-compose.yml` includes:
- PostgreSQL 15 container
- Health checks
- Persistent volume for database
- Automatic connection from QA Buddy

**To use:**
```bash
docker-compose up -d
```

---

## Migrations (Future)

For schema changes, Alembic is included:

```bash
# Initialize migrations (one time)
alembic init migrations

# Generate migration
alembic revision --autogenerate -m "Add new field"

# Apply migrations
alembic upgrade head
```

---

## Performance Tips

### SQLite
- ✅ Perfect for development
- ✅ Single user
- ⚠️ Limited concurrent writes

### PostgreSQL
- ✅ Production-ready
- ✅ Multiple users
- ✅ Advanced JSON queries
- ✅ Indexing for fast searches

### Recommended Indexes (PostgreSQL)

Already included in models:
- `runs.run_id` (primary key)
- `runs.base_url` (for history queries)
- `runs.status` (for filtering)
- `pages.run_id` (for joins)
- `test_cases.run_id`, `test_cases.feature_name` (for queries)

---

## API Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/runs/{run_id}/store` | POST | Store run analysis in DB |
| `/runs/compare/{a}/vs/{b}` | GET | Compare two runs |
| `/runs/history` | GET | Get historical runs |
| `/runs/stats` | GET | Get database statistics |

---

## Benefits of Database Storage

### Before (File-based only):
- ❌ Hard to find specific runs
- ❌ No comparison between runs
- ❌ No historical trends
- ❌ Manual file searches

### After (Database + Files):
- ✅ Query any run instantly
- ✅ Automated comparisons
- ✅ Track changes over time
- ✅ Fast searches and filters
- ✅ Files kept for detailed analysis

**Best of both worlds:** Database for queries, files for artifacts!

---

## Troubleshooting

### Database not initializing

**Check logs:**
```bash
# Look for database initialization messages
tail -f logs/server.log | grep database
```

**Fix:**
```bash
# Verify DATABASE_URL
echo $DATABASE_URL

# Test connection (PostgreSQL)
psql $DATABASE_URL -c "SELECT 1"

# Reset SQLite database
rm qa_buddy.db
# Restart server to recreate
```

### Comparison endpoint errors

**Error:** `Run not found in database`

**Fix:** Store the run first:
```bash
curl -X POST http://localhost:8000/runs/{run_id}/store
```

### PostgreSQL connection refused

**Docker:** Ensure Postgres is running:
```bash
docker-compose ps
docker-compose logs postgres
```

**Manual:** Check PostgreSQL status:
```bash
pg_isready
brew services list  # Mac
systemctl status postgresql  # Linux
```

---

## Next Steps

1. ✅ **Start using it:** Runs are automatically stored in SQLite
2. 📊 **Compare runs:** Use `/compare` endpoint after each discovery
3. 📈 **Track trends:** Use `/history` to see changes over time
4. 🚀 **Upgrade to PostgreSQL:** Use Docker Compose for production

Your QA Buddy now has a memory! 🧠💾

# QA PR Dashboard API Server

Backend API server for the QA PR Management Dashboard. This server handles GitHub and Jira API integrations.

## Features

- ✅ Health check endpoint
- 🔄 GitHub PR synchronization
- 🔄 Jira issue synchronization
- 📊 PR data filtering and statistics
- 🔒 Secure credential handling

## Quick Start

### 1. Install Dependencies

```bash
cd api-server
npm install
```

### 2. Run the Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

The server will start on `http://localhost:8000`

## API Endpoints

### Health Check
```
GET /api/health
```

### Get PRs
```
POST /api/prs
Body: {
  "repository": "All Repositories",
  "status": "All Status",
  "view": "Active PRs"
}
```

### Sync GitHub
```
POST /api/sync/github
Body: {
  "token": "ghp_xxxxxxxxxxxx",
  "organization": "my-org",
  "username": "myuser",
  "repositories": ["repo1", "repo2"]
}
```

### Sync Jira
```
POST /api/sync/jira
Body: {
  "baseUrl": "https://your-domain.atlassian.net",
  "email": "your.email@example.com",
  "apiToken": "your_token",
  "projectKey": "PROJ"
}
```

## Environment Variables

Create a `.env` file (optional):

```env
PORT=8000
```

## Notes

- The server stores PR data in memory (resets on restart)
- For production, consider using a database
- GitHub and Jira credentials are not stored on the server (sent from frontend each time)

## Troubleshooting

### Port Already in Use
If port 8000 is already in use, set a different port:
```env
PORT=8001
```

### CORS Issues
CORS is enabled by default for all origins. For production, configure it to allow only your frontend domain.


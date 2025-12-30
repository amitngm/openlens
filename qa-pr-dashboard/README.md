# FlowLens - See Every Flow

**FlowLens** is a unified DevOps platform that consolidates Kubernetes management, GitHub PR tracking, Jira integration, and distributed flow tracing into one tool. See every flow from UI action to database with complete visibility and control.

**Tagline:** *See Every Flow*

## Features

- 📊 **Real-time Dashboard**: View summary statistics and PR status at a glance
- 🔗 **API Integration**: Connect to your backend API for data fetching
- 🔄 **GitHub & Jira Sync**: Synchronize data from GitHub and Jira
- 📋 **Advanced Filtering**: Filter PRs by repository, status, and view type
- 📥 **Export Functionality**: Export data to Excel or CSV format
- 🎨 **Modern UI**: Clean, responsive design built with Next.js and Tailwind CSS

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Date Handling**: date-fns
- **Export**: xlsx (Excel), CSV

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn
- Backend API server (included in `api-server/` directory)

### Installation

1. Navigate to the FlowOps directory:
   ```bash
   cd qa-pr-dashboard
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

3. Create a `.env.local` file (optional):
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:8000/api
   
   # GitHub Configuration (optional - can also be set via UI)
   GITHUB_TOKEN=your_github_personal_access_token
   GITHUB_ORGANIZATION=your-organization
   GITHUB_USERNAME=your-username
   
   # Jira Configuration (optional - can also be set via UI)
   JIRA_BASE_URL=https://your-domain.atlassian.net
   JIRA_EMAIL=your.email@example.com
   JIRA_API_TOKEN=your_jira_api_token
   JIRA_PROJECT_KEY=PROJ
   ```

4. **Start the API Server** (in a separate terminal):
   ```bash
   cd api-server
   npm install
   npm start
   ```
   The API server will run on `http://localhost:8000`

5. **Start the Frontend** (in the main dashboard directory):
   ```bash
   npm run dev
   # or
   yarn dev
   ```

6. Open [http://localhost:3000](http://localhost:3000) in your browser

> **Note**: The API server must be running for the dashboard to work properly. Make sure both servers are running simultaneously.

## Project Structure

```
flowops/
├── app/
│   ├── globals.css          # Global styles
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Main dashboard page
├── components/
│   ├── DashboardHeader.tsx  # API connection and header
│   ├── SummaryCards.tsx     # Statistics cards
│   ├── FilterBar.tsx        # Filters and action buttons
│   └── PRTable.tsx          # Pull request table
├── lib/
│   └── api.ts               # API client functions
├── types/
│   └── index.ts             # TypeScript type definitions
├── utils/
│   └── export.ts            # Export utilities (Excel/CSV)
└── package.json
```

## API Endpoints

The dashboard expects the following API endpoints:

- `GET /health` - Health check endpoint
- `POST /prs` - Fetch PRs with filters
- `POST /sync/github` - Sync with GitHub
- `POST /sync/jira` - Sync with Jira

### API Request Format

```json
{
  "repository": "All Repositories",
  "status": "All Status",
  "view": "Active PRs"
}
```

### API Response Format

```json
{
  "prs": [
    {
      "id": "1",
      "repo": "app-core",
      "prNumber": 142,
      "title": "Add user authentication flow",
      "author": "dev_alex",
      "created": "2024-12-02T10:00:00Z",
      "assignedTo": "QA_Sarah",
      "qaStatus": "Approved",
      "mergeStatus": "Open",
      "jira": "PROJ-234"
    }
  ],
  "stats": {
    "totalActive": 12,
    "pending": 4,
    "inReview": 3,
    "approved": 5,
    "rejected": 0,
    "merged": 24
  }
}
```

## Configuration

### API URL

You can configure the API URL in two ways:

1. **Environment Variable**: Set `NEXT_PUBLIC_API_URL` in `.env.local`
2. **UI**: Enter the API URL in the dashboard header and click "Connect"

### GitHub & Jira Credentials

You can configure GitHub and Jira credentials in two ways:

1. **Via UI (Recommended)**: 
   - Click the "Settings" button in the top right corner
   - Enter your GitHub and/or Jira credentials
   - Click "Save Settings"
   - Credentials are stored securely in browser localStorage

2. **Via Environment Variables** (for server-side):
   - Add GitHub and Jira variables to `.env.local`
   - Note: These are not automatically loaded in the client-side app

#### GitHub Configuration

**Required:**
- **Personal Access Token**: Create at [GitHub → Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
  - Required scopes: `repo` (for private repos) or `public_repo` (for public repos only)

**Optional:**
- **Organization**: Filter to specific GitHub organization (e.g., `coredgeio`) - PRs will be synced from all repos in this organization
- **Username**: Filter to specific GitHub username (use this if syncing personal repos, not organization repos)
- **Repositories**: Comma-separated list of specific repositories to sync (leave empty to sync all repos from the organization)

> **Note**: If you specify an organization, all repositories in that organization will be synced unless you provide a specific repository list.

#### Jira Configuration

**Required:**
- **Base URL**: Your Jira instance URL (e.g., `https://your-domain.atlassian.net`)
- **Email**: Your Jira account email
- **API Token**: Create at [Jira → Account Settings → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
- **Project Key**: The key of the Jira project (e.g., `PROJ`)

### Getting API Tokens

#### GitHub Personal Access Token
1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a name and select scopes:
   - `repo` - Full control of private repositories
   - `public_repo` - Access public repositories
4. Copy the token (starts with `ghp_`)
5. Paste it in the Settings modal

#### Jira API Token
1. Go to [Atlassian Account Security](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Give it a label and click "Create"
4. Copy the token immediately (you won't see it again)
5. Paste it in the Settings modal

## Building for Production

```bash
npm run build
npm start
```

## Features in Detail

### Summary Cards

Six cards display key metrics:
- Total Active PRs
- Pending Reviews
- In Review
- Approved
- Rejected
- Merged

### Filtering

Filter PRs by:
- **Repository**: All repositories or specific ones
- **Status**: All statuses or specific QA status
- **View**: Active PRs, All PRs, or Merged PRs

### Actions

- **Sync GitHub**: Refresh data from GitHub
- **Sync Jira**: Refresh data from Jira
- **Export Excel**: Download data as Excel file
- **Export CSV**: Download data as CSV file

## Development

### Adding New Features

1. Create components in the `components/` directory
2. Add types in `types/index.ts`
3. Add API functions in `lib/api.ts`
4. Update the main page in `app/page.tsx`

### Styling

The project uses Tailwind CSS. Customize styles in:
- `tailwind.config.js` - Tailwind configuration
- `app/globals.css` - Global styles

## License

Internal use only.

## Support

For issues or questions, contact the development team.


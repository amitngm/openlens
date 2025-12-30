import { Github, GitBranch, FileSpreadsheet, FileText, Search } from 'lucide-react'
import { Filters } from '@/types'

interface FilterBarProps {
  filters: Filters
  onFiltersChange: (filters: Filters) => void
  onSyncGitHub: () => void
  onSyncJira: () => void
  onExportExcel: () => void
  onExportCSV: () => void
  isSyncingGitHub?: boolean
  isSyncingJira?: boolean
  jiraTickets?: string[]
  monthYearOptions?: string[]
  repositories?: string[]
  jiraLabels?: string[]
  jiraSynced?: boolean
}

export default function FilterBar({
  filters,
  onFiltersChange,
  onSyncGitHub,
  onSyncJira,
  onExportExcel,
  onExportCSV,
  isSyncingGitHub = false,
  isSyncingJira = false,
  jiraTickets = [],
  monthYearOptions = [],
  repositories = [],
  jiraLabels = [],
  jiraSynced = false,
}: FilterBarProps) {
  const handleFilterChange = (key: keyof Filters, value: string) => {
    onFiltersChange({ ...filters, [key]: value })
  }

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm mb-6">
      <div className="flex flex-wrap items-center gap-4">
        {/* Filters */}
        <div className="flex gap-4 flex-1">
          <select
            value={filters.repository}
            onChange={(e) => handleFilterChange('repository', e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option>All Repositories</option>
            {repositories.length > 0 ? (
              repositories.map((repo) => (
                <option key={repo} value={repo}>
                  {repo}
                </option>
              ))
            ) : (
              <option disabled>No repositories available</option>
            )}
          </select>

          <select
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option>All Status</option>
            <option>Pending</option>
            <option>In Review</option>
            <option>Approved</option>
            <option>Rejected</option>
          </select>

          <select
            value={filters.view}
            onChange={(e) => handleFilterChange('view', e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option>Active PRs</option>
            <option>All PRs</option>
            <option>Merged PRs</option>
          </select>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              value={filters.jira === 'All JIRA' ? '' : filters.jira}
              onChange={(e) => handleFilterChange('jira', e.target.value || 'All JIRA')}
              placeholder="Search JIRA ticket (contains)..."
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
            />
            {filters.jira && filters.jira !== 'All JIRA' && (
              <button
                onClick={() => handleFilterChange('jira', 'All JIRA')}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            )}
          </div>

          <select
            value={filters.createdDate}
            onChange={(e) => handleFilterChange('createdDate', e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option>All Dates</option>
            {monthYearOptions.length > 0 ? (
              monthYearOptions.map((monthYear) => (
                <option key={monthYear} value={monthYear}>
                  {monthYear}
                </option>
              ))
            ) : (
              <option disabled>No dates available</option>
            )}
          </select>

          <select
            value={filters.jiraLabel || 'All Labels'}
            onChange={(e) => handleFilterChange('jiraLabel', e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option>All Labels</option>
            {jiraLabels.length > 0 ? (
              jiraLabels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))
            ) : (
              <option disabled>No labels available</option>
            )}
          </select>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onSyncGitHub}
            disabled={isSyncingGitHub || !jiraSynced}
            className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-md hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={!jiraSynced ? 'Please sync Jira first' : 'Sync GitHub'}
          >
            <Github className="w-4 h-4" />
            {isSyncingGitHub ? 'Syncing...' : 'Sync GitHub'}
          </button>
          <button
            onClick={onSyncJira}
            disabled={isSyncingJira}
            className="flex items-center gap-2 px-4 py-2 bg-blue-400 text-white rounded-md hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <GitBranch className="w-4 h-4" />
            {isSyncingJira ? 'Syncing...' : 'Sync Jira'}
          </button>
          <button
            onClick={onExportExcel}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export Excel
          </button>
          <button
            onClick={onExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>
    </div>
  )
}


'use client'

import { useState, useMemo, useEffect } from 'react'
import { Eye, Edit, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { PRData, PaginationInfo } from '@/types'
import { format } from 'date-fns'

interface PRTableProps {
  prs: PRData[]
  pagination?: PaginationInfo
  onPageChange?: (page: number) => void
}

export default function PRTable({ prs, pagination, onPageChange }: PRTableProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10

  // Filter PRs based on search query across all columns
  const filteredPRs = useMemo(() => {
    if (!searchQuery.trim()) {
      return prs
    }

    const query = searchQuery.toLowerCase().trim()
    return prs.filter((pr) => {
      // Search across all columns
      const repo = (pr.repo || '').toLowerCase()
      const prNumber = String(pr.prNumber || '').toLowerCase()
      const title = (pr.title || '').toLowerCase()
      const author = (pr.author || '').toLowerCase()
      const assignedTo = (pr.assignedTo || '').toLowerCase()
      const qaStatus = (pr.qaStatus || '').toLowerCase()
      const mergeStatus = (pr.mergeStatus || '').toLowerCase()
      const jira = (pr.jira || '').toLowerCase()
      const jiraStatus = (pr.jiraStatus || '').toLowerCase()
      const jiraAssignee = (pr.jiraAssignee || '').toLowerCase()
      const jiraLabels = (pr.jiraLabels || []).join(' ').toLowerCase()
      const created = format(new Date(pr.created), 'MMM dd yyyy').toLowerCase()

      return (
        repo.includes(query) ||
        prNumber.includes(query) ||
        title.includes(query) ||
        author.includes(query) ||
        assignedTo.includes(query) ||
        qaStatus.includes(query) ||
        mergeStatus.includes(query) ||
        jira.includes(query) ||
        jiraStatus.includes(query) ||
        jiraAssignee.includes(query) ||
        jiraLabels.includes(query) ||
        created.includes(query)
      )
    })
  }, [prs, searchQuery])

  // Reset to page 1 when search query changes
  useEffect(() => {
    if (searchQuery && currentPage > 1) {
      setCurrentPage(1)
    }
  }, [searchQuery, currentPage])

  // Pagination for filtered results
  const totalFilteredPages = Math.max(1, Math.ceil(filteredPRs.length / pageSize))
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedPRs = filteredPRs.slice(startIndex, endIndex)

  // Clamp page when filtered results shrink
  useEffect(() => {
    if (searchQuery && currentPage > totalFilteredPages) {
      setCurrentPage(totalFilteredPages)
    }
  }, [searchQuery, currentPage, totalFilteredPages])

  // Use server-side pagination when not searching, client-side when searching
  const displayPRs = searchQuery ? paginatedPRs : prs
  const showClientPagination = searchQuery && totalFilteredPages > 1
  const showServerPagination = !searchQuery && pagination && pagination.total > 0
  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'Approved':
        return 'bg-green-100 text-green-800'
      case 'In Review':
        return 'bg-blue-100 text-blue-800'
      case 'Pending':
        return 'bg-orange-100 text-orange-800'
      case 'Rejected':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getMergeStatusColor = (status: string) => {
    if (status === 'Merged') {
      return 'text-purple-600 font-medium'
    }
    return 'text-gray-600'
  }

  const getJiraStatusBadgeColor = (status: string) => {
    const statusLower = status?.toLowerCase() || ''
    if (statusLower.includes('done') || statusLower.includes('closed') || statusLower.includes('resolved')) {
      return 'bg-green-100 text-green-800'
    } else if (statusLower.includes('in progress') || statusLower.includes('testing')) {
      return 'bg-blue-100 text-blue-800'
    } else if (statusLower.includes('blocked') || statusLower.includes('on hold')) {
      return 'bg-red-100 text-red-800'
    } else if (statusLower.includes('to do') || statusLower.includes('open')) {
      return 'bg-gray-100 text-gray-800'
    }
    return 'bg-yellow-100 text-yellow-800'
  }

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      {/* Search Bar */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search across all columns (repo, PR #, title, author, status, Jira, etc.)..."
            className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              title="Clear search"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        {searchQuery && (
          <div className="mt-2 text-sm text-gray-600">
            {filteredPRs.length > 0
              ? <>Showing {startIndex + 1} to {Math.min(endIndex, filteredPRs.length)} of {filteredPRs.length} filtered PRs (from {prs.length} total)</>
              : <>No results for &quot;{searchQuery}&quot;. Showing 0 of {prs.length} PRs.</>}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                REPO
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                PR #
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                TITLE
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                AUTHOR
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                CREATED
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                ASSIGNED TO
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                QA STATUS
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                MERGE STATUS
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                JIRA
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                JIRA STATUS
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                ACTIONS
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {displayPRs.length > 0 ? (
              displayPRs.map((pr) => (
              <tr key={pr.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {pr.repo}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  #{pr.prNumber}
                </td>
                <td className="px-6 py-4 text-sm text-gray-900 max-w-xs">
                  <div 
                    className="truncate group relative cursor-help"
                  >
                    <span className="truncate block">{pr.title}</span>
                    {/* Tooltip on hover - always show full title if truncated */}
                    <div className="absolute left-0 top-full mt-2 hidden group-hover:block z-50 w-96 max-w-md p-3 bg-gray-900 text-white text-sm rounded-lg shadow-xl pointer-events-none break-words whitespace-normal">
                      {pr.title}
                      {/* Arrow pointing up */}
                      <div className="absolute bottom-full left-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-900"></div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {pr.author}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {format(new Date(pr.created), 'MMM dd')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {pr.assignedTo}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadgeColor(
                      pr.qaStatus
                    )}`}
                  >
                    {pr.qaStatus}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <span className={getMergeStatusColor(pr.mergeStatus)}>
                    {pr.mergeStatus}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {pr.jira && pr.jiraUrl ? (
                    <a
                      href={pr.jiraUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer font-medium"
                      title={`Open ${pr.jira} in Jira (new tab)`}
                    >
                      {pr.jira}
                    </a>
                  ) : pr.jira ? (
                    <span className="text-gray-500">{pr.jira}</span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                  {pr.jiraLabels && pr.jiraLabels.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {pr.jiraLabels.slice(0, 2).map((label, idx) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded"
                          title={pr.jiraLabels && pr.jiraLabels.length > 2 ? `Labels: ${pr.jiraLabels.join(', ')}` : label}
                        >
                          {label}
                        </span>
                      ))}
                      {pr.jiraLabels.length > 2 && (
                        <span className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                          +{pr.jiraLabels.length - 2}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {pr.jiraStatus ? (
                    <span
                      className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getJiraStatusBadgeColor(
                        pr.jiraStatus
                      )}`}
                      title={pr.jiraAssignee ? `Assignee: ${pr.jiraAssignee}` : pr.jiraStatus}
                    >
                      {pr.jiraStatus}
                    </span>
                  ) : (
                    <span className="text-gray-400 text-sm">-</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <div className="flex items-center gap-3">
                    <button className="text-gray-600 hover:text-blue-600 transition-colors">
                      <Eye className="w-5 h-5" />
                    </button>
                    <button className="text-gray-600 hover:text-blue-600 transition-colors">
                      <Edit className="w-5 h-5" />
                    </button>
                  </div>
                </td>
              </tr>
              ))
            ) : (
              <tr>
                <td colSpan={11} className="px-6 py-12 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <svg
                      className="w-12 h-12 text-gray-400 mb-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <p className="text-gray-500 text-lg font-medium mb-2">
                      {searchQuery ? 'No Pull Requests Match Your Search' : 'No Pull Requests Found'}
                    </p>
                    <p className="text-gray-400 text-sm">
                      {searchQuery
                        ? 'Try adjusting your search query or clear the search to see all PRs.'
                        : 'Sync GitHub to fetch pull requests, or adjust your filters.'}
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Client-side pagination for search results */}
      {showClientPagination && (
        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Showing {startIndex + 1} to {Math.min(endIndex, filteredPRs.length)} of {filteredPRs.length} filtered results
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <div className="text-sm text-gray-700">
              Page {currentPage} of {totalFilteredPages}
            </div>
            <button
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={currentPage === totalFilteredPages}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Server-side pagination when not searching */}
      {showServerPagination && (
        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Showing {((pagination.page - 1) * pagination.pageSize) + 1} to{' '}
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
            {pagination.total} results
          </div>
          {pagination.totalPages > 1 ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onPageChange && onPageChange(pagination.page - 1)}
                disabled={!pagination.hasPreviousPage}
                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <div className="text-sm text-gray-700">
                Page {pagination.page} of {pagination.totalPages}
              </div>
              <button
                onClick={() => onPageChange && onPageChange(pagination.page + 1)}
                disabled={!pagination.hasNextPage}
                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              All results on one page
            </div>
          )}
        </div>
      )}
      {(!pagination || pagination.total === 0) && (
        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
          <p className="text-sm text-gray-600 text-center">
            {pagination ? `Total: ${pagination.total} PRs` : 'Built with GitHub API + Jira API Integration'}
          </p>
        </div>
      )}
    </div>
  )
}


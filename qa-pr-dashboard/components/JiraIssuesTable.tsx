'use client'

import { useState, useMemo, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Search, X, ExternalLink, Bell, Mail, FileSpreadsheet, FileText, Tag, Filter, User, Calendar, ArrowUpDown, ArrowUp, ArrowDown, LayoutGrid, Table2, MoreVertical, Edit, Trash2, Copy, Download, BarChart3, TrendingUp, Users, Clock, CheckCircle2 } from 'lucide-react'
import { PRData } from '@/types'
import { format } from 'date-fns'
import { exportJiraToExcel, exportJiraToCSV } from '@/utils/export'

interface JiraIssue {
  key: string
  summary: string
  status: string
  assignee: string
  labels: string[]
  created: string
  url: string
  issueType?: string
}

interface JiraConfig {
  baseUrl?: string
  email?: string
  apiToken?: string
  projectKey?: string
}

interface JiraIssuesTableProps {
  issues: JiraIssue[]
  prs?: PRData[]
  currentPage?: number
  onPageChange?: (page: number) => void
  apiUrl?: string
  jiraConfig?: JiraConfig
}

export default function JiraIssuesTable({ issues, prs = [], currentPage, onPageChange, apiUrl = 'http://localhost:8000/api', jiraConfig }: JiraIssuesTableProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('')
  const [labelFilter, setLabelFilter] = useState<string>('')
  const [dateRangeFilter, setDateRangeFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all')
  const [customDateStart, setCustomDateStart] = useState('')
  const [customDateEnd, setCustomDateEnd] = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table')
  const [sortColumn, setSortColumn] = useState<string>('')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [manualKeys, setManualKeys] = useState('')
  const [internalPage, setInternalPage] = useState(1)
  const [showNotificationModal, setShowNotificationModal] = useState(false)
  const [notificationMessage, setNotificationMessage] = useState('')
  const [notificationType, setNotificationType] = useState<'slack' | 'teams' | 'email'>('slack')
  const [selectMode, setSelectMode] = useState<'page' | 'all'>('page')
  const [showReleaseModal, setShowReleaseModal] = useState(false)
  const [releaseName, setReleaseName] = useState('')
  const [isAddingToRelease, setIsAddingToRelease] = useState(false)
  const [labelBoards, setLabelBoards] = useState<string[]>([])
  const [activeLabelTab, setActiveLabelTab] = useState<string | null>(null)
  const [showBulkActions, setShowBulkActions] = useState(false)
  const effectivePage = currentPage ?? internalPage

  // Helper function to open a label board
  const openLabelBoard = (label: string) => {
    // Extract base URL from first issue or use jiraConfig
    let jiraBaseUrl = jiraConfig?.baseUrl || 'https://your-jira.atlassian.net'
    if (issues.length > 0 && issues[0]?.url) {
      const urlParts = issues[0].url.split('/browse/')
      if (urlParts.length > 0) {
        jiraBaseUrl = urlParts[0]
      }
    }
    // Create JQL query for the label
    const jql = `labels = "${label}"`
    const boardUrl = `${jiraBaseUrl}/issues/?jql=${encodeURIComponent(jql)}`
    const newWindow = window.open(boardUrl, `jira-board-${label}`, 'width=1400,height=900,menubar=no,toolbar=no,location=yes,resizable=yes,scrollbars=yes')
    if (!newWindow) {
      alert(`Popup blocked for ${label}. Please allow popups for this site.`)
    }
  }

  // Handle adding labels
  const handleAddLabels = (labels: string[]) => {
    const newLabels = labels.filter(l => !labelBoards.includes(l)) // Avoid duplicates
    if (newLabels.length > 0) {
      setLabelBoards([...labelBoards, ...newLabels])
      if (!activeLabelTab && newLabels.length > 0) {
        setActiveLabelTab(newLabels[0])
      }
      // Automatically open boards for new labels
      newLabels.forEach((label, index) => {
        setTimeout(() => {
          openLabelBoard(label)
        }, index * 200) // 200ms delay between each window
      })
    }
  }

  // Find linked PR for a Jira issue
  function findLinkedPR(jiraKey: string): PRData | undefined {
    if (!jiraKey || !prs || prs.length === 0) return undefined
    
    const matched = prs.find(pr => {
      if (!pr.jira) return false
      
      const prJira = pr.jira.trim().toUpperCase()
      const keyUpper = jiraKey.trim().toUpperCase()
      
      // Exact match
      if (prJira === keyUpper) {
        return true
      }
      
      // PR.jira contains the full key (e.g., "PROJ-123 description" contains "PROJ-123")
      if (prJira.includes(keyUpper)) {
        return true
      }
      
      // Key contains PR.jira (backward match for partial keys)
      if (keyUpper.includes(prJira) && prJira.length >= 3) {
        return true
      }
      
      // Extract just the ticket number and match (e.g., "PROJ-123" matches "123")
      const keyNumber = keyUpper.replace(/^[A-Z]+-/, '') // Remove prefix like "PROJ-"
      const prNumber = prJira.replace(/^[A-Z]+-/, '')
      if (keyNumber && prNumber && keyNumber === prNumber) {
        return true
      }
      
      return false
    })
    
    return matched
  }

  // Get unique statuses for filter dropdown
  const uniqueStatuses = useMemo(() => {
    const statusSet = new Set<string>()
    issues.forEach(issue => {
      if (issue.status) {
        statusSet.add(issue.status)
      }
    })
    return Array.from(statusSet).sort()
  }, [issues])

  // Get unique assignees for filter dropdown
  const uniqueAssignees = useMemo(() => {
    const assigneeSet = new Set<string>()
    issues.forEach(issue => {
      if (issue.assignee) {
        assigneeSet.add(issue.assignee)
      }
    })
    return Array.from(assigneeSet).sort()
  }, [issues])

  // Get unique labels for filter dropdown
  const uniqueLabels = useMemo(() => {
    const labelSet = new Set<string>()
    issues.forEach(issue => {
      if (issue.labels && issue.labels.length > 0) {
        issue.labels.forEach(label => labelSet.add(label))
      }
    })
    return Array.from(labelSet).sort()
  }, [issues])

  // Handle column sorting
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  // Get sort icon
  const getSortIcon = (column: string) => {
    if (sortColumn !== column) return <ArrowUpDown className="w-4 h-4 text-gray-400" />
    return sortDirection === 'asc' ? <ArrowUp className="w-4 h-4 text-blue-600" /> : <ArrowDown className="w-4 h-4 text-blue-600" />
  }

  // Filter issues based on all filters
  const filteredIssues = useMemo(() => {
    let filtered = issues

    // Apply status filter
    if (statusFilter) {
      filtered = filtered.filter(issue => issue.status === statusFilter)
    }

    // Apply assignee filter
    if (assigneeFilter) {
      filtered = filtered.filter(issue => issue.assignee === assigneeFilter)
    }

    // Apply label filter
    if (labelFilter) {
      filtered = filtered.filter(issue => issue.labels && issue.labels.includes(labelFilter))
    }

    // Apply date range filter
    if (dateRangeFilter !== 'all') {
      const now = new Date()
      filtered = filtered.filter(issue => {
        if (!issue.created) return false
        const createdDate = new Date(issue.created)
        
        if (dateRangeFilter === 'today') {
          return createdDate.toDateString() === now.toDateString()
        } else if (dateRangeFilter === 'week') {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          return createdDate >= weekAgo
        } else if (dateRangeFilter === 'month') {
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          return createdDate >= monthAgo
        } else if (dateRangeFilter === 'custom') {
          if (customDateStart && customDateEnd) {
            const start = new Date(customDateStart)
            const end = new Date(customDateEnd)
            end.setHours(23, 59, 59, 999) // Include entire end date
            return createdDate >= start && createdDate <= end
          }
        }
        return true
      })
    }

    // Apply search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter((issue) => {
        // Search across all columns
        const key = (issue.key || '').toLowerCase()
        const summary = (issue.summary || '').toLowerCase()
        const status = (issue.status || '').toLowerCase()
        const assignee = (issue.assignee || '').toLowerCase()
        const labels = (issue.labels || []).join(' ').toLowerCase()
        const issueType = (issue.issueType || '').toLowerCase()
        
        // Also search in linked PR data
        const linkedPR = findLinkedPR(issue.key)
        const prRepo = linkedPR ? (linkedPR.repo || '').toLowerCase() : ''
        const prNumber = linkedPR ? String(linkedPR.prNumber || '').toLowerCase() : ''
        const prStatus = linkedPR ? (linkedPR.qaStatus || '').toLowerCase() : ''

        return (
          key.includes(query) ||
          summary.includes(query) ||
          status.includes(query) ||
          assignee.includes(query) ||
          labels.includes(query) ||
          issueType.includes(query) ||
          prRepo.includes(query) ||
          prNumber.includes(query) ||
          prStatus.includes(query)
        )
      })
    }

    // Apply sorting
    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let aValue: any = ''
        let bValue: any = ''
        
        switch (sortColumn) {
          case 'key':
            aValue = a.key || ''
            bValue = b.key || ''
            break
          case 'summary':
            aValue = a.summary || ''
            bValue = b.summary || ''
            break
          case 'status':
            aValue = a.status || ''
            bValue = b.status || ''
            break
          case 'assignee':
            aValue = a.assignee || ''
            bValue = b.assignee || ''
            break
          case 'created':
            aValue = a.created ? new Date(a.created).getTime() : 0
            bValue = b.created ? new Date(b.created).getTime() : 0
            break
          default:
            return 0
        }
        
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return sortDirection === 'asc' 
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue)
        } else {
          return sortDirection === 'asc' 
            ? aValue - bValue
            : bValue - aValue
        }
      })
    }

    return filtered
  }, [issues, searchQuery, statusFilter, assigneeFilter, labelFilter, dateRangeFilter, customDateStart, customDateEnd, sortColumn, sortDirection, prs])

  // Keep internal page in sync with optional prop
  useEffect(() => {
    if (currentPage !== undefined && currentPage !== internalPage) {
      setInternalPage(currentPage)
    }
  }, [currentPage, internalPage])

  // Reset to page 1 when search query or status filter changes
  useEffect(() => {
    if (searchQuery.trim() || statusFilter) {
      // Reset to page 1 when search starts or filter changes
      if (onPageChange) {
        onPageChange(1)
      } else {
        setInternalPage(1)
      }
    }
  }, [searchQuery, statusFilter, onPageChange])

  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(filteredIssues.length / pageSize))
  const startIndex = (effectivePage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedIssues = filteredIssues.slice(startIndex, endIndex)

  // Clamp page when filtered results shrink (but only if we're past the max)
  useEffect(() => {
    if (totalPages > 0 && effectivePage > totalPages) {
      const clampedPage = totalPages
      if (onPageChange) {
        onPageChange(clampedPage)
      } else {
        setInternalPage(clampedPage)
      }
    }
  }, [effectivePage, totalPages, onPageChange])

  const handlePageChange = (page: number) => {
    if (onPageChange) {
      onPageChange(page)
    } else {
      setInternalPage(page)
    }
  }

  // Update findLinkedPR reference in the component
  const findLinkedPRInComponent = (jiraKey: string) => findLinkedPR(jiraKey)

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

  const getPRStatusBadgeColor = (status: string) => {
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

  // Calculate analytics metrics
  const analytics = useMemo(() => {
    const total = filteredIssues.length
    const byStatus = filteredIssues.reduce((acc, issue) => {
      acc[issue.status] = (acc[issue.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    const byAssignee = filteredIssues.reduce((acc, issue) => {
      const assignee = issue.assignee || 'Unassigned'
      acc[assignee] = (acc[assignee] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    const completed = filteredIssues.filter(i => {
      const status = (i.status || '').toLowerCase()
      return status.includes('done') || status.includes('closed') || status.includes('resolved')
    }).length
    const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : '0'
    
    return { total, byStatus, byAssignee, completed, completionRate }
  }, [filteredIssues])

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden mb-4 sm:mb-6">
      {/* Analytics Dashboard */}
      <div className="px-3 sm:px-4 lg:px-6 py-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base sm:text-lg font-semibold text-gray-800 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            Analytics Overview
          </h3>
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            <Filter className="w-4 h-4" />
            {showAdvancedFilters ? 'Hide' : 'Show'} Filters
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs sm:text-sm text-gray-600 font-medium">Total Issues</span>
              <FileText className="w-4 h-4 text-gray-400" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-gray-900">{analytics.total}</div>
            <div className="text-xs text-gray-500 mt-1">of {issues.length} total</div>
          </div>
          <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs sm:text-sm text-gray-600 font-medium">Completed</span>
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-green-600">{analytics.completed}</div>
            <div className="text-xs text-gray-500 mt-1">{analytics.completionRate}% completion</div>
          </div>
          <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs sm:text-sm text-gray-600 font-medium">In Progress</span>
              <Clock className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-blue-600">
              {filteredIssues.filter(i => {
                const status = (i.status || '').toLowerCase()
                return status.includes('in progress') || status.includes('testing')
              }).length}
            </div>
            <div className="text-xs text-gray-500 mt-1">Active work</div>
          </div>
          <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs sm:text-sm text-gray-600 font-medium">Assignees</span>
              <Users className="w-4 h-4 text-purple-500" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-purple-600">{Object.keys(analytics.byAssignee).length}</div>
            <div className="text-xs text-gray-500 mt-1">Active assignees</div>
          </div>
        </div>
      </div>

      <div className="px-3 sm:px-4 lg:px-6 py-3 sm:py-4 border-b border-gray-200">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-base sm:text-lg font-semibold text-gray-800">
              Jira Issues ({filteredIssues.length}{(searchQuery || statusFilter || assigneeFilter || labelFilter) ? ` of ${issues.length}` : ''})
            </h3>
            {selectedKeys.size > 0 && (
              <span className="px-2.5 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">
                {selectedKeys.size} selected
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-md p-1">
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'table' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                title="Table View"
              >
                <Table2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'kanban' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                title="Kanban View"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
            {selectedKeys.size > 0 && (
              <button
                onClick={() => setShowBulkActions(!showBulkActions)}
                className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors text-xs sm:text-sm font-medium"
              >
                <MoreVertical className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                Bulk Actions
              </button>
            )}
            <button
              onClick={() => {
                const filename = `jira-issues-${new Date().toISOString().split('T')[0]}.xlsx`
                exportJiraToExcel(filteredIssues, filename)
              }}
              className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-xs sm:text-sm font-medium"
              title="Export to Excel"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Export Excel</span>
              <span className="sm:hidden">Excel</span>
            </button>
            <button
              onClick={() => {
                const filename = `jira-issues-${new Date().toISOString().split('T')[0]}.csv`
                exportJiraToCSV(filteredIssues, filename)
              }}
              className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-xs sm:text-sm font-medium"
              title="Export to CSV"
            >
              <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">CSV</span>
            </button>
          </div>
        </div>
        
        {/* Advanced Filters Panel */}
        {showAdvancedFilters && (
          <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div>
                <label htmlFor="assignee-filter" className="block text-sm font-medium text-gray-700 mb-1">
                  <User className="w-4 h-4 inline mr-1" />
                  Assignee
                </label>
                <select
                  id="assignee-filter"
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
                >
                  <option value="">All Assignees</option>
                  {uniqueAssignees.map((assignee) => (
                    <option key={assignee} value={assignee}>
                      {assignee}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="label-filter" className="block text-sm font-medium text-gray-700 mb-1">
                  <Tag className="w-4 h-4 inline mr-1" />
                  Label
                </label>
                <select
                  id="label-filter"
                  value={labelFilter}
                  onChange={(e) => setLabelFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
                >
                  <option value="">All Labels</option>
                  {uniqueLabels.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="date-range-filter" className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="w-4 h-4 inline mr-1" />
                  Date Range
                </label>
                <select
                  id="date-range-filter"
                  value={dateRangeFilter}
                  onChange={(e) => setDateRangeFilter(e.target.value as any)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
                >
                  <option value="all">All Time</option>
                  <option value="today">Today</option>
                  <option value="week">Last 7 Days</option>
                  <option value="month">Last 30 Days</option>
                  <option value="custom">Custom Range</option>
                </select>
              </div>
              {dateRangeFilter === 'custom' && (
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Custom Dates</label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={customDateStart}
                      onChange={(e) => setCustomDateStart(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                    <input
                      type="date"
                      value={customDateEnd}
                      onChange={(e) => setCustomDateEnd(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
            {(assigneeFilter || labelFilter || dateRangeFilter !== 'all') && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => {
                    setAssigneeFilter('')
                    setLabelFilter('')
                    setDateRangeFilter('all')
                    setCustomDateStart('')
                    setCustomDateEnd('')
                  }}
                  className="text-sm text-blue-600 hover:text-blue-800 underline"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        )}
        
        {/* Bulk Actions Panel */}
        {showBulkActions && selectedKeys.size > 0 && (
          <div className="mb-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-800">
                Bulk Actions ({selectedKeys.size} selected)
              </h4>
              <button
                onClick={() => setShowBulkActions(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 text-sm font-medium text-gray-700"
                onClick={() => alert('Bulk assign feature - Coming soon!')}
              >
                <User className="w-4 h-4" />
                Assign
              </button>
              <button
                className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 text-sm font-medium text-gray-700"
                onClick={() => alert('Bulk status change feature - Coming soon!')}
              >
                <Edit className="w-4 h-4" />
                Change Status
              </button>
              <button
                className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 text-sm font-medium text-gray-700"
                onClick={() => {
                  const filename = `jira-issues-selected-${new Date().toISOString().split('T')[0]}.xlsx`
                  const selectedIssues = filteredIssues.filter(i => selectedKeys.has(i.key))
                  exportJiraToExcel(selectedIssues, filename)
                }}
              >
                <Download className="w-4 h-4" />
                Export Selected
              </button>
              <button
                className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 text-sm font-medium text-gray-700"
                onClick={() => {
                  const selectedKeysArray = Array.from(selectedKeys)
                  navigator.clipboard.writeText(selectedKeysArray.join(', '))
                  alert(`Copied ${selectedKeys.size} keys to clipboard!`)
                }}
              >
                <Copy className="w-4 h-4" />
                Copy Keys
              </button>
            </div>
          </div>
        )}
        {/* Basic Filters Row */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4">
          {/* Status Filter */}
          <div className="flex-1 min-w-0 sm:min-w-[200px]">
            <label htmlFor="status-filter" className="block text-sm font-medium text-gray-700 mb-1">
              Filter by Status
            </label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              <option value="">All Statuses</option>
              {uniqueStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          {/* Selection mode */}
          <div className="flex items-center gap-3 text-sm text-gray-700">
            <span className="font-medium">Select mode:</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="selectMode"
                value="page"
                checked={selectMode === 'page'}
                onChange={() => setSelectMode('page')}
                className="w-4 h-4"
              />
              <span>Current page</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="selectMode"
                value="all"
                checked={selectMode === 'all'}
                onChange={() => {
                  setSelectMode('all')
                  const allKeys = new Set(selectedKeys)
                  filteredIssues.forEach((issue) => allKeys.add(issue.key))
                  setSelectedKeys(allKeys)
                }}
                className="w-4 h-4"
              />
              <span>All filtered</span>
            </label>
          </div>
        </div>
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search across all columns (Jira key, summary, status, assignee, labels, PR #, repo, etc.)..."
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
        {(searchQuery || statusFilter) && (
          <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
            <span>
              Showing {filteredIssues.length} of {issues.length} issues
            </span>
            {statusFilter && (
              <button
                onClick={() => setStatusFilter('')}
                className="text-blue-600 hover:text-blue-800 underline"
                title="Clear status filter"
              >
                Clear status filter
              </button>
            )}
          </div>
        )}
        
        {/* Multi-Label Board Section */}
        <div className="mt-4 p-4 bg-indigo-50 rounded-lg border border-indigo-200">
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Create Label-Based Boards (Tabbed Windows)</h4>
            <div className="flex items-center gap-2">
              <input
                type="text"
                id="label-input"
                placeholder="Enter labels (e.g., APC-19-DEC-RC, C42) - comma separated"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const input = e.target as HTMLInputElement
                    const labels = input.value.split(',').map(l => l.trim()).filter(l => l.length > 0)
                    if (labels.length > 0) {
                      handleAddLabels(labels)
                      input.value = ''
                    }
                  }
                }}
              />
              <button
                onClick={() => {
                  const input = document.getElementById('label-input') as HTMLInputElement
                  if (input) {
                    const labels = input.value.split(',').map(l => l.trim()).filter(l => l.length > 0)
                    if (labels.length > 0) {
                      handleAddLabels(labels)
                      input.value = ''
                    }
                  }
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
              >
                Add & Open Boards
              </button>
            </div>
          </div>
          {labelBoards.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-3 flex-wrap border-b border-indigo-200">
                {labelBoards.map((label, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      openLabelBoard(label)
                      setActiveLabelTab(label)
                    }}
                    className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                      activeLabelTab === label
                        ? 'border-indigo-600 text-indigo-600 bg-white'
                        : 'border-transparent text-indigo-700 hover:text-indigo-900 hover:border-indigo-300'
                    }`}
                  >
                    {label}
                    <span className="ml-2 text-xs text-gray-500">({issues.filter(i => i.labels?.includes(label)).length})</span>
                  </button>
                ))}
                <button
                  onClick={() => {
                    setLabelBoards([])
                    setActiveLabelTab(null)
                  }}
                  className="ml-auto px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                  title="Clear all labels"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    // Open all label boards in separate windows
                    labelBoards.forEach((label, index) => {
                      setTimeout(() => {
                        openLabelBoard(label)
                      }, index * 200) // 200ms delay between each window
                    })
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors text-sm font-medium"
                >
                  <ExternalLink className="w-4 h-4 inline mr-2" />
                  Open All Boards ({labelBoards.length})
                </button>
                <div className="text-xs text-gray-600">
                  Each label opens in a separate window. Click a tab to open that board, or click &quot;Open All Boards&quot; to open all at once.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Jira Board Creation Section */}
        <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex items-center gap-4 mb-3">
            <div className="flex-1">
              <label htmlFor="manual-keys" className="block text-sm font-medium text-gray-700 mb-1">
                Enter Jira Keys (comma or space separated)
              </label>
              <input
                id="manual-keys"
                type="text"
                value={manualKeys}
                onChange={(e) => setManualKeys(e.target.value)}
                placeholder="e.g., PROJ-123, PROJ-456 PROJ-789"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const allKeys = Array.from(selectedKeys)
                const manualKeysArray = manualKeys.split(/[,\s]+/).filter(k => k.trim())
                const combinedKeys = [...allKeys, ...manualKeysArray].filter(k => k.trim())
                if (combinedKeys.length > 0) {
                  // Create Jira board URL with selected keys
                  // Extract base URL from first issue or use a default
                  let jiraBaseUrl = 'https://your-jira.atlassian.net'
                  if (issues.length > 0 && issues[0]?.url) {
                    const urlParts = issues[0].url.split('/browse/')
                    if (urlParts.length > 0) {
                      jiraBaseUrl = urlParts[0]
                    }
                  }
                  // Create JQL query for the board
                  const jql = `key IN (${combinedKeys.join(',')})`
                  const boardUrl = `${jiraBaseUrl}/issues/?jql=${encodeURIComponent(jql)}`
                  window.open(boardUrl, '_blank')
                } else {
                  alert('Please select Jira issues or enter Jira keys to create a board.')
                }
              }}
              disabled={selectedKeys.size === 0 && !manualKeys.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ExternalLink className="w-4 h-4" />
              Create Jira Board ({selectedKeys.size + (manualKeys ? manualKeys.split(/[,\s]+/).filter(k => k.trim()).length : 0)} keys)
            </button>
            <button
              onClick={() => {
                // Check for incomplete items from filtered results
                const incompleteIssues = filteredIssues.filter(issue => {
                  const status = (issue.status || '').toLowerCase()
                  return !status.includes('done') && !status.includes('closed') && !status.includes('resolved')
                })
                if (incompleteIssues.length > 0) {
                  setShowNotificationModal(true)
                  setNotificationMessage(`Found ${incompleteIssues.length} incomplete Jira issues that need attention.`)
                } else {
                  alert('All issues are complete! No incomplete issues found.')
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 transition-colors"
            >
              <Bell className="w-4 h-4" />
              Check Incomplete & Notify
            </button>
            {selectedKeys.size > 0 && (
              <>
                <button
                  onClick={() => {
                    if (!jiraConfig?.baseUrl || !jiraConfig?.email || !jiraConfig?.apiToken || !jiraConfig?.projectKey) {
                      alert('Jira configuration is missing. Please configure Jira settings first.')
                      return
                    }
                    setShowReleaseModal(true)
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                >
                  <Tag className="w-4 h-4" />
                  Add to Release ({selectedKeys.size})
                </button>
                <button
                  onClick={() => setSelectedKeys(new Set())}
                  className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  Clear Selection ({selectedKeys.size})
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto -mx-3 sm:mx-0">
        <div className="inline-block min-w-full align-middle">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10 sm:w-12">
                <input
                  type="checkbox"
                  checked={
                    selectMode === 'page'
                      ? paginatedIssues.length > 0 && paginatedIssues.every((i) => selectedKeys.has(i.key))
                      : filteredIssues.length > 0 && filteredIssues.every((i) => selectedKeys.has(i.key))
                  }
                  onChange={(e) => {
                    const target = selectMode === 'page' ? paginatedIssues : filteredIssues
                    const newSelected = new Set(selectedKeys)
                    if (e.target.checked) {
                      target.forEach((issue) => newSelected.add(issue.key))
                    } else {
                      target.forEach((issue) => newSelected.delete(issue.key))
                    }
                    setSelectedKeys(newSelected)
                  }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th 
                className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => handleSort('key')}
              >
                <div className="flex items-center gap-1">
                  JIRA KEY
                  {getSortIcon('key')}
                </div>
              </th>
              <th 
                className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => handleSort('summary')}
              >
                <div className="flex items-center gap-1">
                  SUMMARY
                  {getSortIcon('summary')}
                </div>
              </th>
              <th 
                className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => handleSort('status')}
              >
                <div className="flex items-center gap-1">
                  JIRA STATUS
                  {getSortIcon('status')}
                </div>
              </th>
              <th className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                LABELS
              </th>
              <th 
                className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => handleSort('assignee')}
              >
                <div className="flex items-center gap-1">
                  ASSIGNEE
                  {getSortIcon('assignee')}
                </div>
              </th>
              <th className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                PR STATUS
              </th>
              <th className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                PR #
              </th>
              <th className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                REPOSITORY
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {paginatedIssues.length > 0 ? (
              paginatedIssues.map((issue) => {
              const linkedPR = findLinkedPRInComponent(issue.key)
              return (
                <tr key={issue.key} className="hover:bg-gray-50">
                  <td className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(issue.key)}
                      onChange={(e) => {
                        const newSelected = new Set(selectedKeys)
                        if (e.target.checked) {
                          newSelected.add(issue.key)
                        } else {
                          newSelected.delete(issue.key)
                        }
                        setSelectedKeys(newSelected)
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                    >
                      {issue.key}
                    </a>
                  </td>
                  <td className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-sm text-gray-900 max-w-md">
                    <div className="truncate group relative cursor-help">
                      <span className="truncate block" title={issue.summary}>{issue.summary || 'No summary'}</span>
                      {/* Enhanced tooltip that shows full summary on hover - always show if summary exists */}
                      {issue.summary && (
                        <div className="absolute left-0 top-full mt-2 hidden group-hover:block z-50 w-96 max-w-md p-3 bg-gray-900 text-white text-sm rounded-lg shadow-xl pointer-events-none break-words whitespace-normal">
                          <div className="font-semibold mb-1 text-xs text-gray-300 uppercase">Full Summary:</div>
                          <div className="whitespace-normal">{issue.summary}</div>
                          {/* Arrow pointing up */}
                          <div className="absolute bottom-full left-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-900"></div>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getJiraStatusBadgeColor(
                        issue.status
                      )}`}
                    >
                      {issue.status || 'Unknown'}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                      {issue.labels && issue.labels.length > 0 ? (
                        issue.labels.slice(0, 3).map((label, idx) => (
                          <span
                            key={idx}
                            className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded"
                          >
                            {label}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-400 text-sm">-</span>
                      )}
                      {issue.labels && issue.labels.length > 3 && (
                        <span className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                          +{issue.labels.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {issue.assignee || 'Unassigned'}
                  </td>
                  <td className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 whitespace-nowrap">
                    {linkedPR ? (
                      <span
                        className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getPRStatusBadgeColor(
                          linkedPR.qaStatus
                        )}`}
                      >
                        {linkedPR.qaStatus}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-sm">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {linkedPR ? (
                      <a
                        href={`https://github.com/${linkedPR.repo}/pull/${linkedPR.prNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        #{linkedPR.prNumber}
                      </a>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {linkedPR ? linkedPR.repo : <span className="text-gray-400">-</span>}
                  </td>
                </tr>
              )
            })
            ) : (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center">
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
                      {searchQuery ? 'No Jira Issues Match Your Search' : 'No Jira Issues Found'}
                    </p>
                    <p className="text-gray-400 text-sm">
                      {searchQuery
                        ? 'Try adjusting your search query or clear the search to see all issues.'
                        : 'Sync Jira to fetch issues.'}
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      {totalPages > 1 && (
        <div className="bg-gray-50 px-3 sm:px-4 lg:px-6 py-3 sm:py-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
          <div className="text-sm text-gray-600">
            Showing {startIndex + 1} to {Math.min(endIndex, filteredIssues.length)} of {filteredIssues.length} {searchQuery ? 'filtered ' : ''}issues
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(effectivePage - 1)}
              disabled={effectivePage === 1}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <div className="text-sm text-gray-700">
              Page {effectivePage} of {totalPages}
            </div>
            <button
              onClick={() => handlePageChange(effectivePage + 1)}
              disabled={effectivePage === totalPages}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Notification Modal */}
      {showNotificationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800">Send Notification</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-gray-600 mb-4">{notificationMessage}</p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notification Type
                </label>
                <select
                  value={notificationType}
                  onChange={(e) => setNotificationType(e.target.value as 'slack' | 'teams' | 'email')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="slack">Slack</option>
                  <option value="teams">Microsoft Teams</option>
                  <option value="email">Email</option>
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Additional Message (optional)
                </label>
                <textarea
                  value={notificationMessage}
                  onChange={(e) => setNotificationMessage(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Add any additional details..."
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowNotificationModal(false)
                  setNotificationMessage('')
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    // Get incomplete issues from filtered results
                    const incompleteIssues = filteredIssues.filter(issue => {
                      const status = (issue.status || '').toLowerCase()
                      return !status.includes('done') && !status.includes('closed') && !status.includes('resolved')
                    })
                    
                    if (incompleteIssues.length === 0) {
                      alert('No incomplete issues found.')
                      return
                    }
                    
                    const response = await fetch(`${apiUrl}/notifications/send`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        type: notificationType,
                        message: notificationMessage,
                        issues: incompleteIssues.map(i => ({ key: i.key, summary: i.summary, status: i.status })),
                      }),
                    })
                    
                    const data = await response.json()
                    
                    if (response.ok) {
                      alert(`Notification sent successfully! ${data.message || ''}`)
                      setShowNotificationModal(false)
                      setNotificationMessage('')
                    } else {
                      alert(`Failed to send notification: ${data.message || data.error || 'Please check your configuration.'}`)
                    }
                  } catch (error: any) {
                    console.error('Notification error:', error)
                    alert(`Error sending notification: ${error.message || 'Please try again.'}`)
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                <Mail className="w-4 h-4 inline mr-2" />
                Send Notification
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add to Release Modal */}
      {showReleaseModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800">Add Issues to Release</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-gray-600 mb-4">
                Add {selectedKeys.size} selected issue{selectedKeys.size !== 1 ? 's' : ''} to a Jira release/version.
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Release/Version Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={releaseName}
                  onChange={(e) => setReleaseName(e.target.value)}
                  placeholder="e.g., v1.2.0, Release 2024.1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isAddingToRelease}
                />
                <p className="text-xs text-gray-500 mt-1">
                  The release will be created if it doesn&apos;t exist.
                </p>
              </div>
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Selected Issues:</p>
                <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-md p-2 bg-gray-50">
                  {Array.from(selectedKeys).slice(0, 10).map((key) => (
                    <span key={key} className="inline-block mr-2 mb-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                      {key}
                    </span>
                  ))}
                  {selectedKeys.size > 10 && (
                    <span className="text-xs text-gray-500">... and {selectedKeys.size - 10} more</span>
                  )}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowReleaseModal(false)
                  setReleaseName('')
                }}
                disabled={isAddingToRelease}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!releaseName.trim()) {
                    alert('Please enter a release name')
                    return
                  }

                  if (!jiraConfig?.baseUrl || !jiraConfig?.email || !jiraConfig?.apiToken || !jiraConfig?.projectKey) {
                    alert('Jira configuration is missing. Please configure Jira settings first.')
                    return
                  }

                  setIsAddingToRelease(true)
                  try {
                    const issueKeys = Array.from(selectedKeys)
                    const response = await fetch(`${apiUrl}/jira/release/add-issues`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        baseUrl: jiraConfig.baseUrl,
                        email: jiraConfig.email,
                        apiToken: jiraConfig.apiToken,
                        projectKey: jiraConfig.projectKey,
                        releaseName: releaseName.trim(),
                        issueKeys,
                      }),
                    })

                    const data = await response.json()

                    if (response.ok) {
                      alert(`✅ ${data.message}\n\nSuccessfully added: ${data.summary?.successful || 0}\nFailed: ${data.summary?.failed || 0}`)
                      setShowReleaseModal(false)
                      setReleaseName('')
                      setSelectedKeys(new Set())
                    } else {
                      alert(`❌ Failed to add issues to release: ${data.error || data.message || 'Unknown error'}`)
                    }
                  } catch (error: any) {
                    console.error('Error adding issues to release:', error)
                    alert(`❌ Error adding issues to release: ${error.message || 'Please try again.'}`)
                  } finally {
                    setIsAddingToRelease(false)
                  }
                }}
                disabled={isAddingToRelease || !releaseName.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isAddingToRelease ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Adding...
                  </>
                ) : (
                  <>
                    <Tag className="w-4 h-4" />
                    Add to Release
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


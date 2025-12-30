"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Github, GitBranch, User, Calendar, Search, Filter, ExternalLink, RefreshCw, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, LayoutGrid, Table2, MoreVertical, Download, Copy, BarChart3, TrendingUp, Users, Clock, CheckCircle2, XCircle, GitMerge, AlertCircle, Eye, MessageSquare, FileCode, Star } from "lucide-react"
import { GitHubConfig, JiraConfig } from "@/types/config"
import { storage, STORAGE_KEYS } from "@/utils/storage"

interface PR {
  id: string
  number: number
  title: string
  state: "open" | "closed" | "merged"
  author: string
  createdAt: string
  updatedAt: string
  url: string
  repo: string
  baseBranch: string
  headBranch: string
  labels?: string[]
  reviewers?: string[]
  jira?: string
  jiraStatus?: string
}

interface GitHubPRDashboardProps {
  apiUrl: string
}

export default function GitHubPRDashboard({ apiUrl }: GitHubPRDashboardProps) {
  const [prs, setPRs] = useState<PR[]>([])
  const [allPRsForStats, setAllPRsForStats] = useState<PR[]>([]) // All PRs for accurate stats
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [filterState, setFilterState] = useState<"all" | "open" | "closed" | "merged">("all")
  const [selectedRepo, setSelectedRepo] = useState<string>("all")
  const [filterJiraLinked, setFilterJiraLinked] = useState<boolean>(false)
  const [authorFilter, setAuthorFilter] = useState<string>("")
  const [reviewerFilter, setReviewerFilter] = useState<string>("")
  const [labelFilter, setLabelFilter] = useState<string>("")
  const [dateRangeFilter, setDateRangeFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all')
  const [customDateStart, setCustomDateStart] = useState('')
  const [customDateEnd, setCustomDateEnd] = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table')
  const [sortColumn, setSortColumn] = useState<string>('')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [selectedPRs, setSelectedPRs] = useState<Set<string>>(new Set())
  const [repos, setRepos] = useState<string[]>([])
  const [githubConfig, setGitHubConfig] = useState<GitHubConfig | undefined>()
  const [jiraConfig, setJiraConfig] = useState<JiraConfig | undefined>()
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(100)
  const [totalPages, setTotalPages] = useState(1)
  const [totalPRs, setTotalPRs] = useState(0)
  const [lastResponseData, setLastResponseData] = useState<any>(null)
  const [pageInput, setPageInput] = useState<string>('')

  // Load GitHub and Jira configs
  useEffect(() => {
    const githubCfg = storage.getLocal<GitHubConfig>(STORAGE_KEYS.GITHUB_CONFIG)
    if (githubCfg) {
      setGitHubConfig(githubCfg)
      setRepos(githubCfg.repositories || [])
    }
    
    const jiraCfg = storage.getLocal<JiraConfig>(STORAGE_KEYS.JIRA_CONFIG)
    if (jiraCfg) {
      setJiraConfig(jiraCfg)
    }
  }, [])

  // Fetch PRs (sync from GitHub, then read from /api/prs)
  const fetchPRs = useCallback(async () => {
    if (!githubConfig) {
      setError("Please configure GitHub settings in Settings tab")
      return
    }

    setLoading(true)
    setError(null)

    try {
      console.log('🔄 Starting PR fetch process (on-demand pagination)...', { currentPage, selectedRepo, filterState, pageSize })
      
      // Fetch PRs directly from GitHub API with pagination (no sync needed)
      const requestBody: any = { 
        page: currentPage,
        pageSize: pageSize,
        githubToken: githubConfig.token,
        githubConfig: {
          organization: githubConfig.organization,
          username: githubConfig.username,
          repositories: githubConfig.repositories || [],
        },
      }
      
      // Add server-side filters
      if (selectedRepo !== 'all') {
        requestBody.repository = selectedRepo
      }
      
      // Add state filter (send directly to server)
      if (filterState !== 'all') {
        requestBody.state = filterState
      }

      // Add additional filters for server-side filtering
      if (authorFilter) {
        requestBody.author = authorFilter
      }
      if (reviewerFilter) {
        requestBody.reviewer = reviewerFilter
      }
      if (labelFilter) {
        requestBody.label = labelFilter
      }
      if (dateRangeFilter !== 'all') {
        requestBody.dateRange = dateRangeFilter
        if (dateRangeFilter === 'custom' && customDateStart && customDateEnd) {
          requestBody.customDateStart = customDateStart
          requestBody.customDateEnd = customDateEnd
        }
      }
      if (filterJiraLinked) {
        requestBody.jiraLinked = true
      }
      if (searchTerm) {
        requestBody.search = searchTerm
      }
      
      console.log('📥 Fetching paginated PRs directly from GitHub API...', { 
        page: currentPage, 
        pageSize, 
        state: filterState, 
        repository: selectedRepo 
      })
      
      const prsResponse = await fetch(`${apiUrl}/prs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      })

      if (!prsResponse.ok) {
        const errorData = await prsResponse.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || "Failed to fetch PRs from API")
      }

      const data = await prsResponse.json()
      
      console.log('📥 Received PRs from API:', {
        prsCount: data.prs?.length || 0,
        requestedPage: currentPage,
        requestedPageSize: pageSize,
        pagination: data.pagination,
        filteredTotal: data.pagination?.filteredTotal,
        total: data.pagination?.total
      })
      
      // Update pagination info
      if (data.pagination) {
        const prsReceived = data.prs?.length || 0
        // Use server-provided filtered total (accurate across all pages)
        const filteredTotal = data.pagination.filteredTotal || data.pagination.total || 0
        const newTotalPRs = data.pagination.total || 0 // Overall total (unfiltered)
        const newTotalPages = data.pagination.totalPages || 1
        
        // Calculate minimum total based on what we actually received
        // If we're on page N and got X PRs, minimum total is (N-1)*pageSize + X
        const minTotalBasedOnPage = (currentPage - 1) * pageSize + prsReceived
        const actualTotal = Math.max(newTotalPRs, minTotalBasedOnPage)
        const actualTotalPages = Math.max(1, Math.ceil(actualTotal / pageSize))
        
        // Calculate filtered total pages
        const filteredTotalPages = filteredTotal > 0 ? Math.max(1, Math.ceil(filteredTotal / pageSize)) : actualTotalPages
        
        console.log('📊 Pagination info:', { 
          currentPage, 
          totalPages: actualTotalPages,
          filteredTotalPages: filteredTotalPages,
          totalPRs: actualTotal, // Overall total
          filteredTotal: filteredTotal, // Filtered total
          pageSize: data.pagination.pageSize,
          hasNext: data.pagination.hasNextPage,
          hasPrev: data.pagination.hasPreviousPage,
          prsReceived: prsReceived,
          minTotalBasedOnPage: minTotalBasedOnPage
        })
        
        setTotalPages(filteredTotal > 0 ? filteredTotalPages : actualTotalPages)
        setTotalPRs(actualTotal)
        
        // Store filtered total for analytics (always store it, even if 0)
        const filteredTotalValue = data.pagination.filteredTotal !== undefined 
          ? data.pagination.filteredTotal 
          : (data.pagination.total || 0)
        console.log('💾 Storing filteredTotal for analytics:', filteredTotalValue)
        setLastResponseData({ ...data, filteredTotal: filteredTotalValue })
        
        // Ensure current page doesn't exceed total pages
        if (currentPage > actualTotalPages && actualTotalPages > 0) {
          console.log('⚠️ Current page exceeds total pages, resetting to page 1')
          setCurrentPage(1)
          return // Will refetch with page 1
        }
      } else {
        console.warn('⚠️ No pagination info in response')
      }
      
      // Helper function to map PR data
      const mapPR = (pr: any): PR => ({
        id: pr.id || `${pr.repo}-${pr.prNumber}`,
        number: pr.prNumber,
        title: pr.title,
        state: pr.mergeStatus === "Merged" ? "merged" : pr.mergeStatus === "Closed" ? "closed" : "open",
        author: pr.author,
        createdAt: pr.created,
        updatedAt: pr.updated || pr.created,
        url: pr.url || `https://github.com/${pr.repo}/pull/${pr.prNumber}`,
        repo: pr.repo,
        baseBranch: pr.baseBranch || "main",
        headBranch: pr.headBranch || "feature",
        labels: pr.labels || [],
        reviewers: pr.reviewers || [],
        jira: pr.jira,
        jiraStatus: pr.jiraStatus,
      })
      
      // Map current page PRs
      const prsList: PR[] = (data.prs || []).map(mapPR)
      console.log(`✅ Mapped ${prsList.length} PRs for display (expected ${pageSize} per page)`)
      setPRs(prsList)

      // Map all PRs for stats (if available from API, otherwise use current page)
      const allPRsList: PR[] = (data.allPRs || data.prs || []).map(mapPR)
      setAllPRsForStats(allPRsList)
      
      // Extract unique repos from all PRs (for dropdown)
      const uniqueReposFromPRs = Array.from(new Set(allPRsList.map((pr) => pr.repo)))
      const allRepos = Array.from(
        new Set([...(githubConfig.repositories || []), ...uniqueReposFromPRs])
      )
      setRepos(allRepos)
    } catch (err: any) {
      setError(err.message || "Failed to fetch PRs")
      console.error("Error fetching PRs:", err)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, githubConfig, currentPage, pageSize, selectedRepo, filterState, authorFilter, reviewerFilter, labelFilter, dateRangeFilter, customDateStart, customDateEnd, filterJiraLinked, searchTerm])

  // Fetch PRs when config, page, or filters change
  useEffect(() => {
    if (githubConfig) {
      console.log('Fetching PRs with:', { currentPage, selectedRepo, filterState, pageSize })
      fetchPRs()
    }
  }, [githubConfig, fetchPRs, currentPage, selectedRepo, filterState])

  // Reset to page 1 when search term or Jira filter changes
  useEffect(() => {
    if ((searchTerm || filterJiraLinked) && currentPage !== 1) {
      setCurrentPage(1)
      setPageInput('')
    }
  }, [searchTerm, filterJiraLinked])

  // Reset page input when currentPage changes externally (from Previous/Next buttons)
  useEffect(() => {
    if (pageInput !== '' && parseInt(pageInput, 10) === currentPage) {
      // Only clear if it matches current page (user successfully navigated)
      setPageInput('')
    }
  }, [currentPage, pageInput])

  // Get unique values for filters
  const uniqueAuthors = useMemo(() => {
    const authorSet = new Set<string>()
    prs.forEach(pr => {
      if (pr.author) authorSet.add(pr.author)
    })
    return Array.from(authorSet).sort()
  }, [prs])

  const uniqueReviewers = useMemo(() => {
    const reviewerSet = new Set<string>()
    prs.forEach(pr => {
      if (pr.reviewers && pr.reviewers.length > 0) {
        pr.reviewers.forEach((reviewer: string) => reviewerSet.add(reviewer))
      }
    })
    return Array.from(reviewerSet).sort()
  }, [prs])

  const uniqueLabels = useMemo(() => {
    const labelSet = new Set<string>()
    prs.forEach(pr => {
      if (pr.labels && pr.labels.length > 0) {
        pr.labels.forEach((label: string) => labelSet.add(label))
      }
    })
    return Array.from(labelSet).sort()
  }, [prs])

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

  // Filter PRs with all filters
  const filteredPRs = useMemo(() => {
    let filtered = prs

    // Apply state filter
    if (filterState !== "all") {
      filtered = filtered.filter(pr => pr.state === filterState)
    }

    // Apply author filter
    if (authorFilter) {
      filtered = filtered.filter(pr => pr.author === authorFilter)
    }

    // Apply reviewer filter
    if (reviewerFilter) {
      filtered = filtered.filter(pr => 
        pr.reviewers && pr.reviewers.some((reviewer: string) => reviewer === reviewerFilter)
      )
    }

    // Apply label filter
    if (labelFilter) {
      filtered = filtered.filter(pr => 
        pr.labels && pr.labels.includes(labelFilter)
      )
    }

    // Apply date range filter
    if (dateRangeFilter !== 'all') {
      const now = new Date()
      filtered = filtered.filter(pr => {
        if (!pr.createdAt) return false
        const createdDate = new Date(pr.createdAt)
        
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
            end.setHours(23, 59, 59, 999)
            return createdDate >= start && createdDate <= end
          }
        }
        return true
      })
    }

    // Jira linked filter
    if (filterJiraLinked) {
      filtered = filtered.filter(pr => {
        const defaultJiraPattern = `PROJ-${pr.number}`
        const hasJiraStatus = !!pr.jiraStatus
        const hasRealJiraKey = pr.jira && pr.jira.trim() !== '' && pr.jira !== defaultJiraPattern
        return hasJiraStatus || hasRealJiraKey
      })
    }

    // Apply search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase()
      filtered = filtered.filter(pr => {
        return (
          pr.title.toLowerCase().includes(searchLower) ||
          pr.author.toLowerCase().includes(searchLower) ||
          pr.number.toString().includes(searchTerm) ||
          (pr.jira && pr.jira.toLowerCase().includes(searchLower)) ||
          (pr.repo && pr.repo.toLowerCase().includes(searchLower)) ||
          (pr.reviewers && pr.reviewers.some((reviewer: string) => 
            reviewer.toLowerCase().includes(searchLower)
          ))
        )
      })
    }

    // Apply sorting
    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let aValue: any = ''
        let bValue: any = ''
        
        switch (sortColumn) {
          case 'number':
            aValue = a.number
            bValue = b.number
            break
          case 'title':
            aValue = a.title || ''
            bValue = b.title || ''
            break
          case 'author':
            aValue = a.author || ''
            bValue = b.author || ''
            break
          case 'state':
            aValue = a.state || ''
            bValue = b.state || ''
            break
          case 'created':
            aValue = a.createdAt ? new Date(a.createdAt).getTime() : 0
            bValue = b.createdAt ? new Date(b.createdAt).getTime() : 0
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
  }, [prs, filterState, authorFilter, reviewerFilter, labelFilter, dateRangeFilter, customDateStart, customDateEnd, filterJiraLinked, searchTerm, sortColumn, sortDirection])

  // Calculate analytics metrics
  const analytics = useMemo(() => {
    // Use server-provided filtered total if available (accurate across all pages)
    // Server handles: state, repository, and any additional filters
    const serverFilteredTotal = lastResponseData?.filteredTotal ?? lastResponseData?.pagination?.filteredTotal
    
    // Always prefer server filtered total if available (it's accurate across all pages)
    // Only fall back to client-side count if server didn't provide filtered total
    const total = serverFilteredTotal !== undefined && serverFilteredTotal !== null 
      ? serverFilteredTotal 
      : filteredPRs.length
    
    console.log('📊 Analytics calculation:', {
      serverFilteredTotal,
      filteredPRsLength: filteredPRs.length,
      calculatedTotal: total,
      lastResponseDataExists: !!lastResponseData,
      paginationFilteredTotal: lastResponseData?.pagination?.filteredTotal,
      storedFilteredTotal: lastResponseData?.filteredTotal
    })
    const totalOverall = totalPRs > 0 ? totalPRs : prs.length // Total PRs across all pages (unfiltered)
    
    // For other metrics, we still use client-side filtering since server doesn't return these stats
    // But we can estimate based on proportions if we have server filtered total
    const clientFilteredCount = filteredPRs.length
    const clientTotalCount = prs.length
    const ratio = clientTotalCount > 0 ? clientFilteredCount / clientTotalCount : 1
    
    const open = filteredPRs.filter(p => p.state === 'open').length
    const merged = filteredPRs.filter(p => p.state === 'merged').length
    const closed = filteredPRs.filter(p => p.state === 'closed').length
    const withReviews = filteredPRs.filter(p => p.reviewers && p.reviewers.length > 0).length
    const jiraLinked = filteredPRs.filter(p => {
      const defaultJiraPattern = `PROJ-${p.number}`
      const hasJiraStatus = !!p.jiraStatus
      const hasRealJiraKey = p.jira && p.jira.trim() !== '' && p.jira !== defaultJiraPattern
      return hasJiraStatus || hasRealJiraKey
    }).length
    
    return { total, totalOverall, open, merged, closed, withReviews, jiraLinked }
  }, [filteredPRs, totalPRs, prs, lastResponseData, searchTerm, filterJiraLinked, authorFilter, reviewerFilter, labelFilter, dateRangeFilter])

  const getStateColor = (state: string) => {
    switch (state) {
      case "open":
        return "bg-green-100 text-green-800"
      case "closed":
        return "bg-gray-100 text-gray-800"
      case "merged":
        return "bg-purple-100 text-purple-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm">
        {/* Analytics Dashboard */}
        <div className="mb-6 p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base sm:text-lg font-semibold text-gray-800 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-purple-600" />
              PR Analytics Overview
            </h3>
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <Filter className="w-4 h-4" />
              {showAdvancedFilters ? 'Hide' : 'Show'} Filters
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 sm:gap-4">
            <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs sm:text-sm text-gray-600 font-medium">Total PRs Overall</span>
                <BarChart3 className="w-4 h-4 text-blue-500" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-blue-600">{analytics.totalOverall}</div>
              <div className="text-xs text-gray-500 mt-1">All pages</div>
            </div>
            <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs sm:text-sm text-gray-600 font-medium">Total PRs</span>
                <GitBranch className="w-4 h-4 text-gray-400" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-gray-900">{analytics.total}</div>
              <div className="text-xs text-gray-500 mt-1">
                {searchTerm || filterJiraLinked || authorFilter || reviewerFilter || labelFilter || dateRangeFilter !== 'all' 
                  ? 'Filtered (all pages)' 
                  : 'Current page'}
              </div>
            </div>
            <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs sm:text-sm text-gray-600 font-medium">Open</span>
                <AlertCircle className="w-4 h-4 text-green-500" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-green-600">{analytics.open}</div>
              <div className="text-xs text-gray-500 mt-1">Active PRs</div>
            </div>
            <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs sm:text-sm text-gray-600 font-medium">Merged</span>
                <GitMerge className="w-4 h-4 text-purple-500" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-purple-600">{analytics.merged}</div>
              <div className="text-xs text-gray-500 mt-1">Completed</div>
            </div>
            <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs sm:text-sm text-gray-600 font-medium">Closed</span>
                <XCircle className="w-4 h-4 text-gray-500" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-gray-600">{analytics.closed}</div>
              <div className="text-xs text-gray-500 mt-1">Not merged</div>
            </div>
            <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs sm:text-sm text-gray-600 font-medium">With Reviews</span>
                <Eye className="w-4 h-4 text-blue-500" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-blue-600">{analytics.withReviews}</div>
              <div className="text-xs text-gray-500 mt-1">Reviewed PRs</div>
            </div>
            <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs sm:text-sm text-gray-600 font-medium">Jira Linked</span>
                <CheckCircle2 className="w-4 h-4 text-indigo-500" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-indigo-600">{analytics.jiraLinked}</div>
              <div className="text-xs text-gray-500 mt-1">Linked issues</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Github className="w-6 h-6" />
              GitHub Pull Requests
            </h2>
            <p className="text-gray-600 mt-1">View and manage pull requests from your repositories</p>
          </div>
          <div className="flex items-center gap-2">
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
                onClick={() => setViewMode('cards')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'cards' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                title="Card View"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={fetchPRs}
              disabled={loading || !githubConfig}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {!githubConfig && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-yellow-800">
              Please configure GitHub settings in the Settings tab to view pull requests.
            </p>
          </div>
        )}

        {/* Configured Repositories List */}
        {githubConfig && githubConfig.repositories && githubConfig.repositories.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-semibold text-blue-900 mb-2">
              Configured Repositories ({githubConfig.repositories.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {githubConfig.repositories.map((repo, index) => (
                <span
                  key={index}
                  className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium"
                >
                  {repo}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Advanced Filters Panel */}
        {showAdvancedFilters && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div>
                <label htmlFor="author-filter" className="block text-sm font-medium text-gray-700 mb-1">
                  <User className="w-4 h-4 inline mr-1" />
                  Author
                </label>
                <select
                  id="author-filter"
                  value={authorFilter}
                  onChange={(e) => setAuthorFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
                >
                  <option value="">All Authors</option>
                  {uniqueAuthors.map((author) => (
                    <option key={author} value={author}>
                      {author}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="reviewer-filter" className="block text-sm font-medium text-gray-700 mb-1">
                  <Users className="w-4 h-4 inline mr-1" />
                  Reviewer
                </label>
                <select
                  id="reviewer-filter"
                  value={reviewerFilter}
                  onChange={(e) => setReviewerFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
                >
                  <option value="">All Reviewers</option>
                  {uniqueReviewers.map((reviewer) => (
                    <option key={reviewer} value={reviewer}>
                      {reviewer}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="pr-label-filter" className="block text-sm font-medium text-gray-700 mb-1">
                  <Star className="w-4 h-4 inline mr-1" />
                  Label
                </label>
                <select
                  id="pr-label-filter"
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
                <label htmlFor="pr-date-range-filter" className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="w-4 h-4 inline mr-1" />
                  Date Range
                </label>
                <select
                  id="pr-date-range-filter"
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
            {(authorFilter || reviewerFilter || labelFilter || dateRangeFilter !== 'all') && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => {
                    setAuthorFilter('')
                    setReviewerFilter('')
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

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search PRs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <select
            value={filterState}
            onChange={(e) => {
              setFilterState(e.target.value as any)
              setCurrentPage(1) // Reset to first page when filter changes
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All States</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="merged">Merged</option>
          </select>
          <select
            value={selectedRepo}
            onChange={(e) => {
              setSelectedRepo(e.target.value)
              setCurrentPage(1) // Reset to first page when filter changes
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Repositories</option>
            {repos.map((repo) => (
              <option key={repo} value={repo}>
                {repo}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={filterJiraLinked}
              onChange={(e) => {
                setFilterJiraLinked(e.target.checked)
                setCurrentPage(1) // Reset to first page when filter changes
              }}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700 font-medium">Jira Linked Only</span>
          </label>
        </div>

        {/* PRs Table */}
        {loading ? (
          <div className="text-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-4" />
            <p className="text-gray-600">Loading pull requests...</p>
          </div>
        ) : filteredPRs.length === 0 ? (
          <div className="text-center py-12">
            <GitBranch className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600">
              {(() => {
                const filters = []
                if (filterJiraLinked) filters.push('Jira-linked')
                if (searchTerm) filters.push(`matching "${searchTerm}"`)
                return filters.length > 0 
                  ? `No pull requests found ${filters.join(' and ')}`
                  : "No pull requests found"
              })()}
            </p>
            {(searchTerm || filterJiraLinked) && (
              <button
                onClick={() => {
                  setSearchTerm("")
                  setFilterJiraLinked(false)
                }}
                className="mt-4 text-blue-600 hover:text-blue-800 underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => handleSort('number')}
                  >
                    <div className="flex items-center gap-1">
                      PR #
                      {getSortIcon('number')}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => handleSort('title')}
                  >
                    <div className="flex items-center gap-1">
                      Title
                      {getSortIcon('title')}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Repository
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => handleSort('author')}
                  >
                    <div className="flex items-center gap-1">
                      Author
                      {getSortIcon('author')}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reviewers
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => handleSort('state')}
                  >
                    <div className="flex items-center gap-1">
                      State
                      {getSortIcon('state')}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Jira
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPRs.map((pr) => (
                  <tr key={pr.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      #{pr.number}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div className="max-w-md truncate" title={pr.title}>
                        {pr.title}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {pr.repo}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4" />
                        {pr.author}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {pr.reviewers && pr.reviewers.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {pr.reviewers.slice(0, 3).map((reviewer: string, idx: number) => (
                            <span
                              key={idx}
                              className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs"
                              title={reviewer}
                            >
                              {reviewer}
                            </span>
                          ))}
                          {pr.reviewers.length > 3 && (
                            <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">
                              +{pr.reviewers.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded-full ${getStateColor(
                          pr.state
                        )}`}
                      >
                        {pr.state}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {pr.jira ? (
                        jiraConfig?.baseUrl ? (
                          <a
                            href={`${jiraConfig.baseUrl}/browse/${pr.jira}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                            title={`View ${pr.jira} in Jira`}
                          >
                            {pr.jira}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-gray-900">{pr.jira}</span>
                        )
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        {new Date(pr.createdAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                      >
                        <ExternalLink className="w-4 h-4" />
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls - Show if we have PRs or total count */}
        {(totalPRs > 0 || filteredPRs.length > 0) && (
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              {(() => {
                if (filterJiraLinked && filteredPRs.length === 0) {
                  return 'No Jira-linked pull requests found';
                }
                
                if (searchTerm) {
                  // When searching, show filtered results count
                  if (filteredPRs.length === 0) {
                    const filters = []
                    if (filterJiraLinked) filters.push('Jira-linked')
                    if (searchTerm) filters.push(`matching "${searchTerm}"`)
                    return `No pull requests found${filters.length > 0 ? ` ${filters.join(' and ')}` : ''}`;
                  }
                  const filters = []
                  if (filterJiraLinked) filters.push('Jira-linked')
                  return `Found ${filteredPRs.length} pull request${filteredPRs.length !== 1 ? 's' : ''} ${filters.length > 0 ? filters.join(' ') + ' ' : ''}matching "${searchTerm}"${prs.length < totalPRs ? ` (searching in ${prs.length} loaded PRs)` : ''}`;
                }
                
                if (filterJiraLinked) {
                  return `Showing ${filteredPRs.length} Jira-linked pull request${filteredPRs.length !== 1 ? 's' : ''}${prs.length < totalPRs ? ` (from ${prs.length} loaded PRs)` : ''}`;
                }
                
                if (prs.length === 0) {
                  return 'No pull requests found'
                }
                
                const startIndex = (currentPage - 1) * pageSize;
                const actualStart = startIndex + 1;
                const actualEnd = Math.min(startIndex + prs.length, totalPRs);
                
                // If calculated start exceeds what we can show, adjust
                if (actualStart > totalPRs) {
                  // This shouldn't happen, but if it does, show what we have
                  return `Showing ${prs.length} pull request${prs.length !== 1 ? 's' : ''} on page ${currentPage}`;
                }
                
                // Show accurate range
                if (actualEnd === totalPRs && !lastResponseData?.pagination?.hasNextPage) {
                  // Last page - show exact count
                  return `Showing ${actualStart} to ${actualEnd} of ${totalPRs} pull request${totalPRs !== 1 ? 's' : ''}`;
                } else {
                  // Not last page - might be more
                  return `Showing ${actualStart} to ${actualEnd} of at least ${totalPRs} pull request${totalPRs !== 1 ? 's' : ''}`;
                }
              })()}
            </div>
            {(() => {
              // When searching, don't show pagination controls (search is client-side only)
              if (searchTerm) {
                return null
              }
              
              // Show pagination controls only if there are multiple pages
              if (totalPages > 1) {
                const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                  const value = e.target.value
                  // Allow empty, numbers only
                  if (value === '' || /^\d+$/.test(value)) {
                    setPageInput(value)
                  }
                }

                const handlePageJump = () => {
                  const pageNum = parseInt(pageInput, 10)
                  if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
                    setCurrentPage(pageNum)
                    setPageInput('')
                  } else {
                    // Reset to current page if invalid
                    setPageInput('')
                  }
                }

                const handlePageInputKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter') {
                    handlePageJump()
                  }
                }

                return (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        console.log('Previous clicked, current page:', currentPage)
                        setCurrentPage(prev => {
                          const newPage = Math.max(1, prev - 1)
                          console.log('Setting page to:', newPage)
                          return newPage
                        })
                        setPageInput('')
                      }}
                      disabled={currentPage === 1 || loading}
                      className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Previous
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">Page</span>
                      <input
                        type="text"
                        value={pageInput !== '' ? pageInput : currentPage.toString()}
                        onChange={handlePageInputChange}
                        onKeyPress={handlePageInputKeyPress}
                        onBlur={handlePageJump}
                        onFocus={(e) => e.target.select()}
                        className="w-16 px-2 py-1 text-sm text-center border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        disabled={loading}
                      />
                      <span className="text-sm text-gray-600">of {totalPages}</span>
                    </div>
                    <button
                      onClick={() => {
                        console.log('Next clicked, current page:', currentPage, 'totalPages:', totalPages)
                        setCurrentPage(prev => {
                          const newPage = Math.min(totalPages, prev + 1)
                          console.log('Setting page to:', newPage)
                          return newPage
                        })
                        setPageInput('')
                      }}
                      disabled={currentPage >= totalPages || loading}
                      className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )
              }
              return null
            })()}
          </div>
        )}
      </div>
    </div>
  )
}









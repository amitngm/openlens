'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Settings, Github, GitBranch, Shield, LogOut, Zap, Package, GitPullRequest } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import AppHeader from '@/components/AppHeader'
import DashboardHeader from '@/components/DashboardHeader'
import SummaryCards from '@/components/SummaryCards'
import JiraIssuesTable from '@/components/JiraIssuesTable'
import SettingsModal from '@/components/SettingsModal'
import ManagerSettings from '@/components/ManagerSettings'
import KubernetesManagement from '@/components/KubernetesManagement'
import Login from '@/components/Login'
import AdminPanel from '@/components/AdminPanel'
import AutomationManagement from '@/components/AutomationManagement'
import GitHubPRDashboard from '@/components/GitHubPRDashboard'
import ReleaseNotes from '@/components/ReleaseNotes'
import QAAutomation from '@/components/QAAutomation'
import { useAuth } from '@/contexts/AuthContext'
import { JiraSummaryStats } from '@/types'
import { GitHubConfig, JiraConfig } from '@/types/config'
import { checkConnection as checkApiConnection, syncJira } from '@/lib/api'
import { storage, STORAGE_KEYS } from '@/utils/storage'

export default function Home() {
  const { isAuthenticated, isLoading: authLoading, user, logout, hasRole, token, hasAccessGrant } = useAuth()
  const [hasK8sAccess, setHasK8sAccess] = useState(false)
  const [checkingK8sAccess, setCheckingK8sAccess] = useState(false)
  const [apiUrl, setApiUrl] = useState('http://localhost:8000/api')
  const [isConnected, setIsConnected] = useState(false)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [jiraSynced, setJiraSynced] = useState(false)
  const [jiraIssues, setJiraIssues] = useState<any[]>([])
  const [jiraTablePage, setJiraTablePage] = useState(1)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)
  const [summaryStats, setSummaryStats] = useState<JiraSummaryStats>({
    totalIssues: 0,
    toDo: 0,
    inProgress: 0,
    qaReady: 0,
    uatReady: 0,
    devComplete: 0,
    reviewMerge: 0,
    reOpen: 0,
    duplicate: 0,
    onHold: 0,
    rejected: 0,
    done: 0,
  })
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [githubConfig, setGitHubConfig] = useState<GitHubConfig | undefined>()
  const [jiraConfig, setJiraConfig] = useState<JiraConfig | undefined>()
  const [managerSettings, setManagerSettings] = useState<any>(null) // Manager's personal settings
  const [isSyncingJira, setIsSyncingJira] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  
  // Initialize activeTab (load from sessionStorage in useEffect to avoid SSR issues)
  const [activeTab, setActiveTabState] = useState<'jira' | 'k8s' | 'admin' | 'automation' | 'github' | 'releases' | 'qa-automation'>('jira')

  // Wrapper to update both state and sessionStorage
  const setActiveTab = useCallback((tab: 'jira' | 'k8s' | 'admin' | 'automation' | 'github' | 'releases' | 'qa-automation') => {
    setActiveTabState(tab)
    storage.setSession(STORAGE_KEYS.ACTIVE_TAB, tab)
  }, [])

      // Load activeTab from sessionStorage on mount and validate against role
  useEffect(() => {
      try {
      const savedTab = storage.getSession<'jira' | 'k8s' | 'admin' | 'automation' | 'github' | 'releases' | 'qa-automation'>(STORAGE_KEYS.ACTIVE_TAB)
      if (savedTab) {
        // Validate saved tab against user role before setting
        const isViewer = !hasRole('admin') && !hasRole('manager')
        const isManager = hasRole('manager') && !hasRole('admin')
        const isAdmin = hasRole('admin')
        
        // Define allowed tabs for each role
        const viewerTabs: Array<'jira' | 'k8s' | 'admin' | 'automation' | 'github' | 'releases' | 'qa-automation'> = ['jira', 'github', 'releases', 'qa-automation']
        const managerTabs: Array<'jira' | 'k8s' | 'admin' | 'automation' | 'github' | 'releases' | 'qa-automation'> = ['jira', 'k8s', 'github', 'releases', 'qa-automation']
        const adminTabs: Array<'jira' | 'k8s' | 'admin' | 'automation' | 'github' | 'releases' | 'qa-automation'> = ['jira', 'k8s', 'admin', 'automation', 'github', 'releases', 'qa-automation']
        
        // Check if saved tab is allowed for current role
        let allowedTabs: Array<'jira' | 'k8s' | 'admin' | 'automation' | 'github' | 'releases' | 'qa-automation'>
        if (isAdmin) {
          allowedTabs = adminTabs
        } else if (isManager) {
          allowedTabs = managerTabs
        } else {
          allowedTabs = viewerTabs
        }
        
        if (allowedTabs.includes(savedTab)) {
          setActiveTabState(savedTab)
        } else {
          // Redirect to first allowed tab
          setActiveTabState(allowedTabs[0])
          storage.setSession(STORAGE_KEYS.ACTIVE_TAB, allowedTabs[0])
        }
      }
    } catch (error) {
      console.error('Error loading activeTab from storage:', error)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Check Kubernetes access (role-based or time-based grant)
  useEffect(() => {
    const checkK8sAccess = async () => {
      if (!user || !token) {
        setHasK8sAccess(false)
        return
      }
      
      // Check role-based access first
      if (hasRole('admin') || hasRole('manager')) {
        setHasK8sAccess(true)
        return
      }
      
      // Check time-based access grant
      setCheckingK8sAccess(true)
      try {
        const hasGrant = await hasAccessGrant('kubernetes', apiUrl)
        setHasK8sAccess(hasGrant)
      } catch (error) {
        console.error('Error checking K8s access grant:', error)
        setHasK8sAccess(false)
      } finally {
        setCheckingK8sAccess(false)
      }
    }
    
    checkK8sAccess()
    
    // Re-check access every 30 seconds to catch expired grants
    const interval = setInterval(() => {
      if (user && token && !hasRole('admin') && !hasRole('manager')) {
        checkK8sAccess()
      }
    }, 30000) // Check every 30 seconds
    
    return () => clearInterval(interval)
  }, [user, token, hasRole, hasAccessGrant, apiUrl])

  // Ensure role-based access control for tabs (safety check)
  useEffect(() => {
    // Skip if user is not loaded yet
    if (!user) return
    
    const isViewer = !hasRole('admin') && !hasRole('manager')
    const isManager = hasRole('manager') && !hasRole('admin')
    const isAdmin = hasRole('admin')
    
    // Define allowed tabs for each role (include k8s if user has access grant)
    const viewerTabs: Array<'jira' | 'k8s' | 'admin' | 'automation' | 'github' | 'releases' | 'qa-automation'> = hasK8sAccess 
      ? ['jira', 'k8s', 'github', 'releases', 'qa-automation']
      : ['jira', 'github', 'releases', 'qa-automation']
    const managerTabs: Array<'jira' | 'k8s' | 'admin' | 'automation' | 'github' | 'releases' | 'qa-automation'> = ['jira', 'k8s', 'github', 'releases', 'qa-automation']
    const adminTabs: Array<'jira' | 'k8s' | 'admin' | 'automation' | 'github' | 'releases' | 'qa-automation'> = ['jira', 'k8s', 'admin', 'automation', 'github', 'releases', 'qa-automation']
    
    // Get allowed tabs for current role
    const allowedTabs = isAdmin ? adminTabs : (isManager ? managerTabs : viewerTabs)
    
    // If current tab is not allowed, redirect to first allowed tab
    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0])
      return
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, user, hasK8sAccess])

  // ALL HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
  // Calculate Jira stats from issues
  const calculateJiraStats = useCallback((issues: any[]): JiraSummaryStats => {
    const stats: JiraSummaryStats = {
      totalIssues: issues.length,
      toDo: 0,
      inProgress: 0,
      qaReady: 0,
      uatReady: 0,
      devComplete: 0,
      reviewMerge: 0,
      reOpen: 0,
      duplicate: 0,
      onHold: 0,
      rejected: 0,
      done: 0,
    }

    issues.forEach((issue) => {
      const status = (issue.status || '').toLowerCase()
      
      if (status.includes('done') || status.includes('resolved')) {
        stats.done++
      } else if (status.includes('uat') && status.includes('ready')) {
        // UAT Ready (check this first to avoid matching "qa" in "qa uat ready")
        stats.uatReady++
      } else if (status === 'qa' || (status.includes('qa') && !status.includes('uat'))) {
        // QA status (exact match "qa" or contains "qa" but not "uat")
        stats.qaReady++
      } else if (status.includes('dev complete') || status.includes('devcomplete')) {
        stats.devComplete++
      } else if (status.includes('review') && status.includes('merge')) {
        stats.reviewMerge++
      } else if (status.includes('re-open') || status.includes('reopen') || status.includes('re open')) {
        stats.reOpen++
      } else if (status.includes('reject')) {
        // Rejected / declined statuses
        stats.rejected++
      } else if (status.includes('duplicate')) {
        stats.duplicate++
      } else if (status.includes('on hold') || status.includes('onhold')) {
        stats.onHold++
      } else if (status.includes('progress') || status.includes('in progress')) {
        stats.inProgress++
      } else {
        // Default to "To Do" for other statuses
        stats.toDo++
      }
    })

    return stats
  }, [])

  // Get configured labels from settings for tabs
  const configuredLabels = useMemo(() => {
    if (!jiraConfig?.labels) {
      return []
    }
    if (Array.isArray(jiraConfig.labels)) {
      return jiraConfig.labels.map(l => String(l).trim()).filter(l => l.length > 0).sort()
    }
    // Handle case where labels might be stored as a comma-separated string
    const labelsValue = jiraConfig.labels as any
    if (typeof labelsValue === 'string') {
      return labelsValue.split(',').map(l => l.trim()).filter(l => l.length > 0).sort()
    }
    return []
  }, [jiraConfig])

  // Filter issues by label (case-insensitive matching)
  const filterIssuesByLabel = useCallback((issues: any[], labelFilter: string | null): any[] => {
    if (!labelFilter) {
      return issues // Show all issues when no label filter
    }
    
    const normalizedFilter = labelFilter.trim().toLowerCase()
    
    return issues.filter((issue) => {
      const labels = issue.labels || issue.fields?.labels || []
      if (!Array.isArray(labels) || labels.length === 0) {
        return false
      }
      
      return labels.some((label: string) => {
        if (!label || typeof label !== 'string') return false
        return label.trim().toLowerCase() === normalizedFilter
      })
    })
  }, [])

  // Filter issues by status
  const filterIssuesByStatus = useCallback((issues: any[], statusFilter: string | null): any[] => {
    if (!statusFilter) {
      return issues // Show all issues
    }

    return issues.filter((issue) => {
      const status = (issue.status || '').toLowerCase()
      
      switch (statusFilter) {
        case 'todo':
          // To Do: not done, not in progress, not qa, not uat ready, not dev complete, not review merge, not re-open, not duplicate, not on hold, not rejected
          return !status.includes('done') && 
                 !status.includes('resolved') && 
                 !status.includes('progress') && 
                 status !== 'qa' &&
                 !(status.includes('qa') && !status.includes('uat')) &&
                 !(status.includes('uat') && status.includes('ready')) &&
                 !(status.includes('dev complete') || status.includes('devcomplete')) &&
                 !(status.includes('review') && status.includes('merge')) &&
                 !(status.includes('re-open') || status.includes('reopen') || status.includes('re open')) &&
                 !status.includes('duplicate') &&
                 !(status.includes('on hold') || status.includes('onhold')) &&
                 !status.includes('reject')
        case 'inprogress':
          return status.includes('progress') || status.includes('in progress')
        case 'qaready':
          // QA status (exact match "qa" or contains "qa" but not "uat")
          return status === 'qa' || (status.includes('qa') && !status.includes('uat'))
        case 'uatready':
          // UAT Ready
          return status.includes('uat') && status.includes('ready')
        case 'devcomplete':
          return status.includes('dev complete') || status.includes('devcomplete')
        case 'reviewmerge':
          return status.includes('review') && status.includes('merge')
        case 'reopen':
          return status.includes('re-open') || status.includes('reopen') || status.includes('re open')
        case 'rejected':
          return status.includes('reject')
        case 'duplicate':
          return status.includes('duplicate')
        case 'onhold':
          return status.includes('on hold') || status.includes('onhold')
        case 'done':
          return status.includes('done') || status.includes('resolved')
        default:
          return true
      }
    })
  }, [])


  // Load Jira issues from MongoDB (if available)
  const loadJiraIssues = useCallback(async () => {
    try {
      const jiraResponse = await fetch(`${apiUrl}/jira/issues`)
      if (jiraResponse.ok) {
        const jiraData = await jiraResponse.json()
        if (jiraData.issues && jiraData.issues.length > 0) {
          // Load ALL issues from database (no filtering here)
          // Backend already fetches issues with labels IN (...) for all configured labels
          // Client-side label tabs will handle filtering by individual labels
          setJiraIssues(jiraData.issues)
          setJiraSynced(true)
          // Calculate and set Jira stats from all issues
          const jiraStats = calculateJiraStats(jiraData.issues)
          setSummaryStats(jiraStats)
          console.log(`✅ Loaded ${jiraData.issues.length} Jira issues from database (all issues with configured labels)`)
        } else {
          // Reset stats if no issues
          setSummaryStats({
            totalIssues: 0,
            toDo: 0,
            inProgress: 0,
            qaReady: 0,
            uatReady: 0,
            devComplete: 0,
            reviewMerge: 0,
            reOpen: 0,
            duplicate: 0,
            onHold: 0,
            rejected: 0,
            done: 0,
          })
        }
      }
    } catch (err) {
      console.error('Error loading Jira issues:', err)
    }
  }, [apiUrl, calculateJiraStats, managerSettings, hasRole])

  // Load session state on mount (after component mounts to avoid SSR issues)
  useEffect(() => {
    try {
      const savedPage = storage.getSession<number>(STORAGE_KEYS.JIRA_TABLE_PAGE)
      const savedStatus = storage.getSession<string | null>(STORAGE_KEYS.SELECTED_STATUS)
      
      if (savedPage) setJiraTablePage(savedPage)
      if (savedStatus !== null) setSelectedStatus(savedStatus)
    } catch (error) {
      console.error('Error loading session state:', error)
    }
  }, [])

  // Save session state when it changes (only on client side)
  useEffect(() => {
    try {
      storage.setSession(STORAGE_KEYS.JIRA_TABLE_PAGE, jiraTablePage)
    } catch (error) {
      console.error('Error saving session state:', error)
    }
  }, [jiraTablePage])

  useEffect(() => {
    try {
      storage.setSession(STORAGE_KEYS.SELECTED_STATUS, selectedStatus)
    } catch (error) {
      console.error('Error saving session state:', error)
    }
  }, [selectedStatus])

  // Reset Jira table page when data changes or status filter changes
  useEffect(() => {
    setJiraTablePage(1)
  }, [jiraIssues, selectedStatus])

  // Recalculate stats when Jira issues or label filter changes (NOT status filter)
  // Stats should always show totals from all issues (or all issues matching label)
  // Status filter only affects the table/list below, not the summary cards
  useEffect(() => {
    if (jiraIssues.length > 0) {
      // Only filter by label for stats calculation (NOT by status)
      // This ensures "Total Issues" and all status counts remain constant
      const filteredByLabel = filterIssuesByLabel(jiraIssues, selectedLabel)
      const jiraStats = calculateJiraStats(filteredByLabel)
      setSummaryStats(jiraStats)
    }
  }, [jiraIssues, selectedLabel, calculateJiraStats, filterIssuesByLabel])
  

  useEffect(() => {
    // Auto-load Jira issues when connected
    if (isConnected) {
      loadJiraIssues()
    }
  }, [isConnected, loadJiraIssues])

  // Load manager's personal settings
  useEffect(() => {
    if (user && token && hasRole('manager') && !hasRole('admin')) {
      loadManagerSettings()
    }
  }, [user, token, apiUrl])

  const loadManagerSettings = async () => {
    try {
      const response = await fetch(`${apiUrl}/user/settings`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json()
        if (data.success) {
          setManagerSettings(data.settings || {})
        }
      }
    } catch (err) {
      console.error('Failed to load manager settings:', err)
    }
  }

  // Load saved API URL from localStorage (only once on mount)
  useEffect(() => {
    try {
      // Ensure storage is available
      if (typeof storage === 'undefined' || !storage || typeof storage.getLocal !== 'function') {
        console.warn('Storage utility not available, using default API URL')
        checkApiConnection(apiUrl).then(setIsConnected)
        return
      }

      // Load saved API URL from localStorage (persistent preference)
      const savedApiUrl = storage.getLocal<string>(STORAGE_KEYS.API_URL)
      if (savedApiUrl) {
        setApiUrl(savedApiUrl)
        checkApiConnection(savedApiUrl).then(setIsConnected)
      } else {
        checkApiConnection(apiUrl).then(setIsConnected)
      }
    } catch (error) {
      console.error('Error loading API URL from storage:', error)
      checkApiConnection(apiUrl).then(setIsConnected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load saved GitHub and Jira configs when admin user is authenticated
  useEffect(() => {
    // Only load for admins and when user is authenticated
    if (!user || !hasRole('admin')) {
      return
    }

    // Ensure storage is available
    if (typeof storage === 'undefined' || !storage || typeof storage.getLocal !== 'function') {
      console.warn('Storage utility not available, cannot load admin settings')
      return
    }

    try {
      const savedGitHub = storage.getLocal<GitHubConfig>(STORAGE_KEYS.GITHUB_CONFIG)
      const savedJira = storage.getLocal<JiraConfig>(STORAGE_KEYS.JIRA_CONFIG)
      
      console.log('📖 Loading admin settings from localStorage:', {
        hasGitHub: !!savedGitHub,
        hasJira: !!savedJira,
        jiraBaseUrl: savedJira?.baseUrl,
        jiraEmail: savedJira?.email,
        jiraProjectKey: savedJira?.projectKey
      })
      
      if (savedGitHub) {
        setGitHubConfig(savedGitHub)
        console.log('✅ Loaded GitHub config from localStorage')
      } else {
        // Set default organization if not configured
        setGitHubConfig({
          token: '',
          organization: 'coredgeio',
          username: '',
          repositories: [],
        })
        console.log('ℹ️ No saved GitHub config, using defaults')
      }
      if (savedJira) {
        setJiraConfig(savedJira)
        console.log('✅ Loaded Jira config from localStorage:', {
          baseUrl: savedJira.baseUrl,
          email: savedJira.email,
          projectKey: savedJira.projectKey
        })
      } else {
        console.log('ℹ️ No saved Jira config found in localStorage')
      }
    } catch (error) {
      console.error('Error loading admin settings from storage:', error)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAuthenticated])

  const handleSaveSettings = useCallback((config: { github?: GitHubConfig; jira?: JiraConfig }) => {
    if (config.github) {
      setGitHubConfig(config.github)
      // Save to localStorage (persistent preference)
      storage.setLocal(STORAGE_KEYS.GITHUB_CONFIG, config.github)
    }
    if (config.jira) {
      setJiraConfig(config.jira)
      // Save to localStorage (persistent preference)
      storage.setLocal(STORAGE_KEYS.JIRA_CONFIG, config.jira)
    }
  }, [])

  // Show login if not authenticated - MUST BE AFTER ALL HOOKS
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-50">
        <div className="text-center">
          <div className="spinner h-12 w-12 mx-auto"></div>
          <p className="mt-4 text-gray-600 font-medium">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Login apiUrl={apiUrl} onLoginSuccess={() => {}} />
  }
  
  const handleConnect = async () => {
    // Save API URL to localStorage (persistent preference)
    storage.setLocal(STORAGE_KEYS.API_URL, apiUrl)
    const connected = await checkApiConnection(apiUrl)
    setIsConnected(connected)
    if (connected) {
      await loadJiraIssues()
    }
  }

  const handleSyncJira = async () => {
    // Use manager's personal Jira config if they're a manager, otherwise use global config
    let jiraSettings: JiraConfig | undefined
    
    if (hasRole('manager') && !hasRole('admin') && managerSettings) {
      // Manager: Use personal settings
      jiraSettings = {
        baseUrl: managerSettings.jiraUrl || '',
        email: managerSettings.jiraEmail || '',
        apiToken: managerSettings.jiraToken || '',
        projectKey: managerSettings.jiraProjectKey || '',
        labels: managerSettings.jiraLabel ? [managerSettings.jiraLabel] : [],
      }
    } else {
      // Admin: Use global config
      jiraSettings = jiraConfig
    }

    if (!jiraSettings?.apiToken || !jiraSettings?.baseUrl || !jiraSettings?.email || !jiraSettings?.projectKey) {
      if (hasRole('manager') && !hasRole('admin')) {
        setErrorMessage('Please configure your Jira settings in Settings tab (Jira Base URL, Jira API Token, Jira Email, and Project Key are required).')
      } else {
        setErrorMessage('Please configure Jira settings in Settings (Jira Base URL, Jira API Token, Jira Email, and Project Key are required).')
      }
      return
    }

    // Validate projectKey is not just whitespace
    const trimmedProjectKey = jiraSettings.projectKey?.trim()
    if (!trimmedProjectKey || trimmedProjectKey.length === 0) {
      setErrorMessage('Project Key cannot be empty. Please enter a valid project key in Settings.')
      return
    }

    setIsSyncingJira(true)
    setErrorMessage(null)

    try {
      // Ensure projectKey is trimmed and all required fields are present
      const syncConfig = {
        ...jiraSettings,
        projectKey: trimmedProjectKey,
      }
      
      console.log('Syncing Jira with config:', {
        baseUrl: syncConfig.baseUrl,
        email: syncConfig.email,
        apiToken: syncConfig.apiToken ? `${syncConfig.apiToken.substring(0, 4)}...` : 'MISSING',
        projectKey: syncConfig.projectKey,
        labels: syncConfig.labels,
      })
      
      const result = await syncJira(apiUrl, syncConfig)
      // If sync succeeds, mark as connected
      setIsConnected(true)
      setJiraSynced(true)
      
      // Reload Jira issues after sync
      await loadJiraIssues()
      setErrorMessage(null)
      // Show success message briefly
      const successMsg = result.message || 'Jira sync completed successfully!'
      setErrorMessage(`✅ ${successMsg}`)
      setTimeout(() => setErrorMessage(null), 5000)
    } catch (error: any) {
      console.error('Error syncing Jira:', error)
      
      // Extract detailed error information
      let errorMsg = error.message || 'Failed to sync Jira. Please check your configuration and try again.'
      
      // Add troubleshooting suggestion if available
      if (error.response?.data?.troubleshooting?.suggestion) {
        errorMsg += `\n\n💡 ${error.response.data.troubleshooting.suggestion}`
      }
      
      // Add error details if available
      if (error.response?.data?.details && Array.isArray(error.response.data.details)) {
        const details = error.response.data.details.join(', ')
        if (details) {
          errorMsg += `\n\nDetails: ${details}`
        }
      }
      
      setErrorMessage(`❌ ${errorMsg}`)
      // If it's a connection error, mark as disconnected
      if (errorMsg.includes('Cannot connect') || errorMsg.includes('fetch')) {
        setIsConnected(false)
      }
    } finally {
      setIsSyncingJira(false)
    }
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 overflow-hidden">
      {/* Sidebar */}
      <Sidebar 
        activeTab={activeTab} 
        onTabChange={setActiveTab}
        isMobileOpen={isMobileMenuOpen}
        onMobileToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      />
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:ml-64 min-w-0">
        {/* Header */}
        <AppHeader 
          onMenuClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          onSettingsClick={() => setIsSettingsOpen(true)}
        />
        
        {/* Content */}
        <main className="flex-1 overflow-y-auto pt-14 lg:pt-16">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 lg:py-6 max-w-7xl">
            {/* API Connection Section - Only show on admin panel */}
            {hasRole('admin') && activeTab === 'admin' && (
              <div className="mb-4 lg:mb-6">
                <DashboardHeader
                  apiUrl={apiUrl}
                  onApiUrlChange={setApiUrl}
                  onConnect={handleConnect}
                  isConnected={isConnected}
                />
              </div>
            )}


        {/* Tab Content with RBAC protection */}
        {activeTab === 'k8s' ? (
          checkingK8sAccess ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-sm sm:text-base text-gray-600">Checking access...</p>
            </div>
          ) : hasK8sAccess ? (
            <KubernetesManagement 
              apiUrl={apiUrl}
              managerKubeconfig={hasRole('manager') && !hasRole('admin') ? managerSettings?.kubeconfig : undefined}
            />
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-8 text-center">
              <Shield className="w-12 h-12 sm:w-16 sm:h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
              <p className="text-sm sm:text-base text-gray-600">You need admin or manager privileges, or an active time-based access grant to access Kubernetes Management.</p>
            </div>
          )
        ) : activeTab === 'admin' ? (
          hasRole('admin') ? (
            <AdminPanel apiUrl={apiUrl} />
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
              <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
              <p className="text-gray-600">You need admin privileges to access the Admin Panel.</p>
            </div>
          )
        ) : activeTab === 'automation' ? (
          hasRole('admin') ? (
            <AutomationManagement apiUrl={apiUrl} />
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
              <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
              <p className="text-gray-600">You need admin privileges to access Automation Management.</p>
            </div>
          )
        ) : activeTab === 'github' ? (
          <GitHubPRDashboard apiUrl={apiUrl} />
        ) : activeTab === 'releases' ? (
          <ReleaseNotes apiUrl={apiUrl} />
        ) : activeTab === 'qa-automation' ? (
          <QAAutomation apiUrl={apiUrl} />
        ) : (
          <>

        {errorMessage && (
          <div
            className={`mb-4 p-4 sm:p-5 rounded-xl shadow-md border-2 backdrop-blur-sm animate-slide-down ${
              errorMessage.startsWith('✅')
                ? 'bg-green-50/95 border-green-300 text-green-800'
                : 'bg-red-50/95 border-red-300 text-red-800'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm sm:text-base flex-1 break-words font-medium">{errorMessage}</span>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-gray-500 hover:text-gray-700 hover:bg-white/50 rounded-lg flex-shrink-0 p-1.5 transition-all duration-200"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Label Tabs */}
        {jiraSynced && jiraIssues.length > 0 && configuredLabels.length > 0 && (
          <div className="mb-4 lg:mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Filter by Label</h3>
              {selectedLabel && (
                <button
                  onClick={() => {
                    setSelectedLabel(null)
                    setSelectedStatus(null)
                    setJiraTablePage(1)
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Clear filter
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {/* All Issues Tab - shows combination of all configured labels */}
              <button
                onClick={() => {
                  setSelectedLabel(null)
                  setSelectedStatus(null)
                  setJiraTablePage(1)
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  selectedLabel === null
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All Issues
                <span className="ml-2 text-xs opacity-75">({jiraIssues.length})</span>
              </button>
              {/* Individual Label Tabs */}
              {configuredLabels.map((label) => {
                const labelIssues = filterIssuesByLabel(jiraIssues, label)
                const isSelected = selectedLabel && selectedLabel.trim().toLowerCase() === label.trim().toLowerCase()
                return (
                  <button
                    key={label}
                    onClick={() => {
                      setSelectedLabel(label)
                      setSelectedStatus(null)
                      setJiraTablePage(1)
                    }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      isSelected
                        ? 'bg-primary-600 text-white shadow-md'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                    <span className="ml-2 text-xs opacity-75">({labelIssues.length})</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <SummaryCards 
          stats={summaryStats} 
          selectedStatus={selectedStatus}
          onCardClick={(status) => {
            setSelectedStatus(status === selectedStatus ? null : status) // Toggle if same status clicked
            setJiraTablePage(1) // Reset to first page when filter changes
          }}
        />


        {/* Sync Button */}
        <div className="bg-white/95 backdrop-blur-sm p-4 rounded-xl shadow-md border border-gray-200/80 mb-4 lg:mb-6 hover:shadow-lg transition-all duration-200">
          <div className="flex gap-3">
            <button
              onClick={handleSyncJira}
              disabled={isSyncingJira}
              className="btn-primary flex items-center gap-2"
            >
              <GitBranch className={`w-4 h-4 flex-shrink-0 ${isSyncingJira ? 'animate-spin' : ''}`} />
              <span>{isSyncingJira ? 'Syncing...' : 'Sync Jira'}</span>
            </button>
          </div>
        </div>

        {/* Status/Label Filter Indicator */}
        {(selectedStatus || selectedLabel) && jiraSynced && (() => {
          let filteredIssues = filterIssuesByLabel(jiraIssues, selectedLabel)
          filteredIssues = filterIssuesByStatus(filteredIssues, selectedStatus)
          return (
            <div className="bg-gradient-to-r from-primary-50 to-primary-100/50 border-2 border-primary-200 rounded-xl p-4 sm:p-5 mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 shadow-md backdrop-blur-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-primary-900 font-semibold text-sm sm:text-base">
                  Showing: {selectedLabel ? `Label: ${selectedLabel}` : 'All Labels'}
                  {selectedStatus && ` • ${selectedStatus === 'todo' ? 'To Do' : 
                          selectedStatus === 'inprogress' ? 'In Progress' : 
                          selectedStatus === 'qaready' ? 'QA' : 
                          selectedStatus === 'uatready' ? 'UAT Ready' : 
                          selectedStatus === 'devcomplete' ? 'Dev Complete' : 
                          selectedStatus === 'reviewmerge' ? 'Review & Merge' : 
                          selectedStatus === 'reopen' ? 'Re-Open' : 
                          selectedStatus === 'duplicate' ? 'Duplicate' : 
                          selectedStatus === 'onhold' ? 'On Hold' : 
                          selectedStatus === 'done' ? 'Done' : 'All Statuses'}`}
                </span>
                <span className="text-primary-700 text-xs sm:text-sm font-medium bg-white/60 px-2 py-1 rounded-md">
                  {filteredIssues.length} issue{filteredIssues.length !== 1 ? 's' : ''}
                </span>
              </div>
              <button
                onClick={() => {
                  setSelectedStatus(null)
                  setSelectedLabel(null)
                }}
                className="text-primary-700 hover:text-primary-900 hover:bg-white/60 text-xs sm:text-sm font-semibold px-3 py-1.5 rounded-lg transition-all duration-200 self-start sm:self-auto"
              >
                Clear filters
              </button>
            </div>
          )
        })()}

        {jiraSynced && jiraIssues.length > 0 && (() => {
          // First filter by label (from tab click) - only show issues with selected label
          let filteredIssues = filterIssuesByLabel(jiraIssues, selectedLabel)
          // Then filter by status (from card click)
          filteredIssues = filterIssuesByStatus(filteredIssues, selectedStatus)
          
          // Determine which Jira config to use (manager's personal or admin's global)
          const effectiveJiraConfig = (hasRole('manager') && !hasRole('admin') && managerSettings) ? {
            baseUrl: managerSettings.jiraUrl,
            email: managerSettings.jiraEmail,
            apiToken: managerSettings.jiraToken,
            projectKey: managerSettings.jiraProjectKey,
          } : (jiraConfig ? {
            baseUrl: jiraConfig.baseUrl,
            email: jiraConfig.email,
            apiToken: jiraConfig.apiToken,
            projectKey: jiraConfig.projectKey,
          } : undefined)

          return (
            <JiraIssuesTable 
              issues={filteredIssues}
              currentPage={jiraTablePage}
              onPageChange={setJiraTablePage}
              apiUrl={apiUrl}
              jiraConfig={effectiveJiraConfig}
            />
          )
        })()}

          </>
        )}

        {hasRole('admin') && (
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onSave={handleSaveSettings}
            initialConfig={{ github: githubConfig, jira: jiraConfig }}
            apiUrl={apiUrl}
          />
        )}
          </div>
        </main>
      </div>
    </div>
  )
}


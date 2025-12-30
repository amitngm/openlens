'use client'

import { useState, useEffect, useCallback } from 'react'
import { Tag, GitBranch, Package, RefreshCw, Download, Play, AlertCircle, CheckCircle, FileText, Plus } from 'lucide-react'
import { GitHubConfig } from '@/types/config'
import { storage, STORAGE_KEYS } from '@/utils/storage'
import { useAuth } from '@/contexts/AuthContext'

interface Release {
  id: string
  tagName: string
  name: string
  body: string
  publishedAt: string
  author: string
  prerelease: boolean
  draft: boolean
  url: string
  repo: string
  assets?: Array<{
    name: string
    downloadUrl: string
    size: number
  }>
}

interface GitTag {
  name: string
  sha: string
  url: string
  zipballUrl?: string
  tarballUrl?: string
  commit?: {
    sha: string
    url: string
  }
  repo: string
}

interface ReleaseNotesProps {
  apiUrl: string
}

export default function ReleaseNotes({ apiUrl }: ReleaseNotesProps) {
  const { token, hasRole } = useAuth()
  const [releases, setReleases] = useState<Release[]>([])
  const [tags, setTags] = useState<GitTag[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingTags, setLoadingTags] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<string>('all')
  const [repos, setRepos] = useState<string[]>([])

  // Check if user has permission to build tags (admin or manager only)
  const canBuildTags = hasRole('admin') || hasRole('manager')

  // Helper function to normalize repository name (append org if missing)
  const normalizeRepoName = useCallback((repo: string, githubConfig: GitHubConfig | null): string => {
    if (!repo) return repo
    // If already in org/repo format, return as is
    if (repo.includes('/')) {
      return repo
    }
    // Otherwise, try to append organization
    const org = githubConfig?.organization || githubConfig?.username
    if (org) {
      return `${org}/${repo}`
    }
    // If no org available, return as is (will likely fail but at least we tried)
    return repo
  }, [])
  const [githubConfig, setGitHubConfig] = useState<GitHubConfig | undefined>()
  const [building, setBuilding] = useState<{ [key: string]: boolean }>({})
  const [buildStatus, setBuildStatus] = useState<{ [key: string]: 'success' | 'error' | null }>({})
  const [showTags, setShowTags] = useState(true) // Toggle to show/hide tags
  const [showBuildForm, setShowBuildForm] = useState(false)
  const [buildFormData, setBuildFormData] = useState({
    branchName: '',
    consoleName: '',
    tagName: '',
    repo: '',
  })
  const [pendingBuildAction, setPendingBuildAction] = useState<(() => void) | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)
  const [customers, setCustomers] = useState<string[]>([])
  const [loadingCustomers, setLoadingCustomers] = useState(false)
  const [showDraftReleaseForm, setShowDraftReleaseForm] = useState(false)
  const [draftReleaseData, setDraftReleaseData] = useState({
    tag: '',
    branch: '',
    name: '',
    body: '',
    prerelease: false,
    repo: '',
  })
  const [creatingRelease, setCreatingRelease] = useState(false)
  const [loadingReleaseNotes, setLoadingReleaseNotes] = useState(false)
  const [tagHasRelease, setTagHasRelease] = useState(false)
  const [hasGeneratedReleaseNotes, setHasGeneratedReleaseNotes] = useState(false)
  const [confirmCreateRelease, setConfirmCreateRelease] = useState(false)
  
  // Customer/Console options (can be customer names or environments)
  // Will be populated from GitHub or use defaults
  const consoleOptions = customers.length > 0 ? customers : ['production', 'staging', 'dev', 'qa', 'test', 'preprod']

  // Load GitHub config
  useEffect(() => {
    const config = storage.getLocal<GitHubConfig>(STORAGE_KEYS.GITHUB_CONFIG)
    if (config) {
      setGitHubConfig(config)
      setRepos(config.repositories || [])
      if (config.repositories && config.repositories.length > 0) {
        setSelectedRepo(config.repositories[0])
      }
    }
  }, [])

  // Fetch tags
  const fetchTags = useCallback(async () => {
    if (!githubConfig) {
      return
    }

    setLoadingTags(true)

    try {
      const reposToFetch = selectedRepo === 'all' ? (githubConfig.repositories || []) : [selectedRepo]
      const allTags: GitTag[] = []

      for (const repo of reposToFetch) {
        try {
          // Automatically append organization if missing
          const normalizedRepo = normalizeRepoName(repo, githubConfig)
          const response = await fetch(`${apiUrl}/github/tags?repo=${encodeURIComponent(normalizedRepo)}`, {
            headers: {
              'Authorization': `token ${githubConfig.token}`,
            },
          })

          if (response.ok) {
            const data = await response.json()
            const repoTags: GitTag[] = (data.tags || []).map((tag: any) => ({
              name: tag.name,
              sha: tag.sha,
              url: tag.url,
              zipballUrl: tag.zipballUrl || '',
              tarballUrl: tag.tarballUrl || '',
              commit: tag.commit || null,
              repo: normalizedRepo, // Use normalized repo name
            }))
            allTags.push(...repoTags)
          }
        } catch (err) {
          console.error(`Error fetching tags for ${repo}:`, err)
        }
      }

      setTags(allTags)
    } catch (err: any) {
      console.error('Error fetching tags:', err)
    } finally {
      setLoadingTags(false)
    }
  }, [apiUrl, githubConfig, selectedRepo, normalizeRepoName])

  // Fetch releases
  const fetchReleases = useCallback(async () => {
    if (!githubConfig) {
      setError('Please configure GitHub settings in Settings tab')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const reposToFetch = selectedRepo === 'all' ? (githubConfig.repositories || []) : [selectedRepo]
      const allReleases: Release[] = []

      for (const repo of reposToFetch) {
        try {
          // Automatically append organization if missing
          const normalizedRepo = normalizeRepoName(repo, githubConfig)
          
          const response = await fetch(`${apiUrl}/github/releases?repo=${encodeURIComponent(normalizedRepo)}`, {
            headers: {
              'Authorization': `token ${githubConfig.token}`,
            },
          })

          if (response.ok) {
            const data = await response.json()
            const repoReleases: Release[] = (data.releases || []).map((release: any) => ({
              id: release.id || `${normalizedRepo}-${release.tag_name}`,
              tagName: release.tag_name,
              name: release.name || release.tag_name,
              body: release.body || '',
              publishedAt: release.published_at || release.created_at,
              author: release.author?.login || 'Unknown',
              prerelease: release.prerelease || false,
              draft: release.draft || false,
              url: release.html_url,
              repo: normalizedRepo, // Use normalized repo name
              assets: (release.assets || []).map((asset: any) => ({
                name: asset.name,
                downloadUrl: asset.browser_download_url,
                size: asset.size,
              })),
            }))
            allReleases.push(...repoReleases)
          } else {
            // Handle API errors
            let errorData: any = {}
            try {
              errorData = await response.json()
            } catch {
              // Response might not be JSON
            }
            const errorMessage = errorData.message || errorData.error || `Failed to fetch releases for ${repo}`
            
            if (response.status === 401 || response.status === 403) {
              setError('GitHub authentication failed. Please check your token in Settings and ensure it has the required permissions.')
            } else if (response.status === 404) {
              // Repository not found - check if it's a format issue
              if (!repo.includes('/')) {
                const org = githubConfig.organization || githubConfig.username
                if (org) {
                  console.log(`Repository ${repo} not found. Did you mean ${org}/${repo}?`)
                }
              }
              // Repository not found or no releases - this is not necessarily an error
              // Only show error if we're fetching a specific repo, not when fetching all
              if (selectedRepo !== 'all') {
                console.log(`Repository ${repo} not found or has no releases`)
              }
            } else {
              setError(`Error fetching releases for ${repo}: ${errorMessage} (Status: ${response.status})`)
            }
          }
        } catch (err: any) {
          console.error(`Error fetching releases for ${repo}:`, err)
          setError(`Network error: ${err.message || 'Failed to fetch releases'}`)
        }
      }

      // Sort by published date (newest first)
      allReleases.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      setReleases(allReleases)
      
      // Clear error if we successfully fetched (even if no releases found)
      if (allReleases.length === 0 && reposToFetch.length > 0) {
        // Only set error if we actually tried to fetch but got no results
        // Don't show error for empty results - that's normal for repos without releases
        setError(null)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch releases')
      console.error('Error fetching releases:', err)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, githubConfig, selectedRepo, normalizeRepoName])

  // Fetch customers from GitHub
  const fetchCustomers = useCallback(async (repo: string) => {
    if (!githubConfig) return
    
    setLoadingCustomers(true)
    try {
      const normalizedRepo = normalizeRepoName(repo, githubConfig)
      const org = githubConfig.organization || githubConfig.username
      const customersUrl = `${apiUrl}/github/customers?repo=${encodeURIComponent(normalizedRepo)}${org ? `&organization=${encodeURIComponent(org)}` : ''}`
      
      const response = await fetch(customersUrl, {
        headers: {
          'Authorization': `token ${githubConfig.token}`,
        },
      })
      
      if (response.ok) {
        const data = await response.json()
        const customerNames = (data.customers || []).map((c: any) => typeof c === 'string' ? c : c.name || c)
        if (customerNames.length > 0) {
          setCustomers(customerNames)
        }
      }
    } catch (err) {
      console.error('Error fetching customers:', err)
      // Keep default options on error
    } finally {
      setLoadingCustomers(false)
    }
  }, [apiUrl, githubConfig, normalizeRepoName])

  // Fetch releases and tags when component mounts or when config/repo changes
  useEffect(() => {
    if (githubConfig) {
      fetchReleases()
      fetchTags()
    }
  }, [githubConfig, selectedRepo, fetchReleases, fetchTags])

  // Fetch customers automatically when GitHub config is available or repository changes
  useEffect(() => {
    if (githubConfig && selectedRepo && selectedRepo !== 'all') {
      const normalizedRepo = normalizeRepoName(selectedRepo, githubConfig)
      fetchCustomers(normalizedRepo)
    } else if (githubConfig && githubConfig.repositories && githubConfig.repositories.length > 0) {
      // If no specific repo selected, try to fetch from first repo or organization
      const firstRepo = normalizeRepoName(githubConfig.repositories[0], githubConfig)
      fetchCustomers(firstRepo)
    }
  }, [githubConfig, selectedRepo, fetchCustomers, normalizeRepoName])

  // Build latest tag
  const buildLatestTag = useCallback(async (repo: string) => {
    if (!githubConfig) {
      setError('GitHub configuration required')
      return
    }

    // Normalize repo name (append org if missing)
    const normalizedRepo = normalizeRepoName(repo, githubConfig)
    const buildKey = `${normalizedRepo}-latest`
    setBuilding(prev => ({ ...prev, [buildKey]: true }))
    setBuildStatus(prev => ({ ...prev, [buildKey]: null }))
    setError(null)

    try {
      // Get latest release for the repo (match by normalized repo name)
      const repoReleases = releases.filter(r => r.repo === normalizedRepo && !r.draft && !r.prerelease)
      const latestRelease = repoReleases[0]

      if (!latestRelease) {
        // Check if we have any releases at all for this repo
        const anyReleases = releases.filter(r => r.repo === normalizedRepo)
        if (anyReleases.length === 0) {
          setError(`No releases found for repository: ${normalizedRepo}. Please ensure: 1) The repository has releases, 2) Your GitHub token has access to this repository.`)
        } else {
          setError(`No published releases found for repository: ${normalizedRepo}. All releases are either drafts or pre-releases.`)
        }
        setBuildStatus(prev => ({ ...prev, [buildKey]: 'error' }))
        return
      }

      if (!token) {
        setError('Authentication required. Please log in to build tags.')
        setBuildStatus(prev => ({ ...prev, [buildKey]: 'error' }))
        return
      }

      if (!canBuildTags) {
        setError('Permission denied. Only administrators and managers can build tags.')
        setBuildStatus(prev => ({ ...prev, [buildKey]: 'error' }))
        return
      }

      const response = await fetch(`${apiUrl}/github/build-tag`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          repo: normalizedRepo, // Use normalized repo name
          tag: latestRelease.tagName,
          githubToken: githubConfig.token,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'Build failed')
      }

      const data = await response.json()
      setBuildStatus(prev => ({ ...prev, [buildKey]: 'success' }))
      
      // Show success message
      alert(`Build started successfully for ${normalizedRepo}@${latestRelease.tagName}\n\n${data.message || 'Check build logs for progress'}`)
    } catch (err: any) {
      setError(err.message || 'Failed to build latest tag')
      setBuildStatus(prev => ({ ...prev, [buildKey]: 'error' }))
      console.error('Error building tag:', err)
    } finally {
      setBuilding(prev => ({ ...prev, [buildKey]: false }))
    }
  }, [apiUrl, githubConfig, releases, normalizeRepoName, canBuildTags, token])

  // Trigger build with form data
  const triggerBuild = useCallback(async (repo: string, tag: string, branchName: string, consoleName: string) => {
    if (!githubConfig) {
      setError('GitHub configuration required')
      return
    }

    if (!token) {
      setError('Authentication required. Please log in to build tags.')
      return
    }

    if (!canBuildTags) {
      setError('Permission denied. Only administrators and managers can build tags.')
      return
    }

    const normalizedRepo = normalizeRepoName(repo, githubConfig)
    const buildKey = `${normalizedRepo}-${tag}`
    setBuilding(prev => ({ ...prev, [buildKey]: true }))
    setBuildStatus(prev => ({ ...prev, [buildKey]: null }))
    setError(null)

    try {
      const response = await fetch(`${apiUrl}/github/build-tag`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          repo: normalizedRepo,
          tag: tag,
          branchName: branchName,
          consoleName: consoleName,
          githubToken: githubConfig.token,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'Build failed')
      }

      const data = await response.json()
      setBuildStatus(prev => ({ ...prev, [buildKey]: 'success' }))
      
      alert(`Build started successfully for ${normalizedRepo}@${tag}\n\nBranch: ${branchName}\nConsole: ${consoleName}\nTag: ${tag}\n\n${data.message || 'Check build logs for progress'}`)
    } catch (err: any) {
      setError(err.message || 'Failed to build tag')
      setBuildStatus(prev => ({ ...prev, [buildKey]: 'error' }))
      console.error('Error building tag:', err)
    } finally {
      setBuilding(prev => ({ ...prev, [buildKey]: false }))
    }
  }, [apiUrl, githubConfig, normalizeRepoName, canBuildTags, token])

  // Fetch branches for a repository
  const fetchBranches = useCallback(async (repo: string) => {
    if (!githubConfig) return
    
    setLoadingBranches(true)
    try {
      const normalizedRepo = normalizeRepoName(repo, githubConfig)
      const response = await fetch(`${apiUrl}/github/branches?repo=${encodeURIComponent(normalizedRepo)}`, {
        headers: {
          'Authorization': `token ${githubConfig.token}`,
        },
      })
      
      if (response.ok) {
        const data = await response.json()
        const branchNames = (data.branches || []).map((b: any) => b.name)
        setBranches(branchNames)
      }
    } catch (err) {
      console.error('Error fetching branches:', err)
    } finally {
      setLoadingBranches(false)
    }
  }, [apiUrl, githubConfig, normalizeRepoName])

  // Generate tag suggestions based on existing tags
  const generateTagSuggestions = useCallback((input: string) => {
    if (!input || input.length < 1) {
      // Show recent tags as suggestions
      const recentTags = tags
        .filter(t => t.repo === buildFormData.repo)
        .slice(0, 10)
        .map(t => t.name)
      setTagSuggestions(recentTags)
      return
    }
    
    // Filter tags that match the input
    const matchingTags = tags
      .filter(t => t.repo === buildFormData.repo && t.name.toLowerCase().includes(input.toLowerCase()))
      .slice(0, 10)
      .map(t => t.name)
    
    setTagSuggestions(matchingTags)
  }, [tags, buildFormData.repo])

  // Open build form
  const openBuildForm = useCallback((repo: string, tag: string, onConfirm: () => void) => {
    const normalizedRepo = normalizeRepoName(repo, githubConfig || null)
    setBuildFormData({
      branchName: '',
      consoleName: '',
      tagName: '',
      repo: normalizedRepo,
    })
    setPendingBuildAction(() => onConfirm)
    setShowBuildForm(true)
    setBranches([])
    setTagSuggestions([])
    
    // Fetch branches for this repo (customers are fetched automatically on component load)
    if (githubConfig) {
      fetchBranches(repo)
      // Refresh customers if needed (they're already fetched automatically)
      if (customers.length === 0) {
        fetchCustomers(repo)
      }
    }
    
    // Generate initial tag suggestions
    if (tags.length > 0) {
      const repoTags = tags
        .filter(t => t.repo === normalizedRepo)
        .slice(0, 10)
        .map(t => t.name)
      setTagSuggestions(repoTags)
    }
  }, [githubConfig, tags, fetchBranches, fetchCustomers, normalizeRepoName])

  // Fetch release notes from commits for a tag
  const fetchReleaseNotes = useCallback(async (repo: string, tag: string, previousTag?: string) => {
    if (!githubConfig) return ''
    
    setLoadingReleaseNotes(true)
    try {
      const normalizedRepo = normalizeRepoName(repo, githubConfig)
      const notesUrl = `${apiUrl}/github/release-notes?repo=${encodeURIComponent(normalizedRepo)}&tag=${encodeURIComponent(tag)}${previousTag ? `&previousTag=${encodeURIComponent(previousTag)}` : ''}`
      
      const response = await fetch(notesUrl, {
        headers: {
          'Authorization': `token ${githubConfig.token}`,
        },
      })
      
      if (response.ok) {
        const data = await response.json()
        return data.releaseNotes || ''
      }
    } catch (err) {
      console.error('Error fetching release notes:', err)
    } finally {
      setLoadingReleaseNotes(false)
    }
    return ''
  }, [apiUrl, githubConfig, normalizeRepoName])

  // Check if a tag already has a release
  const checkTagHasRelease = useCallback((repo: string, tag: string) => {
    const normalizedRepo = normalizeRepoName(repo, githubConfig || null)
    const existingRelease = releases.find(r => r.repo === normalizedRepo && r.tagName === tag)
    return !!existingRelease
  }, [releases, githubConfig, normalizeRepoName])

  // Handle tag change in draft release form - auto-generate release notes
  const handleTagChange = useCallback(async (tag: string) => {
    setDraftReleaseData(prev => ({ ...prev, tag }))
    
    // Check if tag already has a release
    if (draftReleaseData.repo && tag) {
      const hasRelease = checkTagHasRelease(draftReleaseData.repo, tag)
      setTagHasRelease(hasRelease)
      
      if (hasRelease) {
        // Don't generate release notes if release already exists
        setDraftReleaseData(prev => ({ ...prev, body: '' }))
        return
      }
    }
    
    // Auto-generate release notes if repo is set and tag doesn't have a release
    if (draftReleaseData.repo && tag && githubConfig) {
      setLoadingReleaseNotes(true)
      try {
        // Find previous tag (the one before this tag in the list)
        const repoTags = tags
          .filter(t => t.repo === draftReleaseData.repo)
          .sort((a, b) => b.name.localeCompare(a.name))
        
        const currentTagIndex = repoTags.findIndex(t => t.name === tag)
        const previousTag = currentTagIndex > 0 ? repoTags[currentTagIndex - 1]?.name : undefined
        
        const releaseNotes = await fetchReleaseNotes(draftReleaseData.repo, tag, previousTag)
        if (releaseNotes) {
          setDraftReleaseData(prev => ({ ...prev, body: releaseNotes }))
          // If release notes were generated (commits found), set flag to require confirmation
          setHasGeneratedReleaseNotes(true)
          setConfirmCreateRelease(false) // Reset confirmation when new notes are generated
        } else {
          setHasGeneratedReleaseNotes(false)
        }
      } catch (err) {
        console.error('Error generating release notes:', err)
        setHasGeneratedReleaseNotes(false)
      } finally {
        setLoadingReleaseNotes(false)
      }
    } else {
      setHasGeneratedReleaseNotes(false)
      setConfirmCreateRelease(false)
    }
  }, [draftReleaseData.repo, tags, githubConfig, fetchReleaseNotes, checkTagHasRelease])

  // Open draft release form
  const openDraftReleaseForm = useCallback((repo?: string) => {
    const normalizedRepo = repo ? normalizeRepoName(repo, githubConfig || null) : (selectedRepo !== 'all' ? normalizeRepoName(selectedRepo, githubConfig || null) : '')
    setDraftReleaseData({
      tag: '',
      branch: '',
      name: '',
      body: '',
      prerelease: false,
      repo: normalizedRepo,
    })
    setTagHasRelease(false)
    setHasGeneratedReleaseNotes(false)
    setConfirmCreateRelease(false)
    setShowDraftReleaseForm(true)
    setBranches([])
    
    // Fetch branches for this repo
    if (githubConfig && normalizedRepo) {
      fetchBranches(normalizedRepo)
    }
  }, [githubConfig, selectedRepo, fetchBranches, normalizeRepoName])

  // Create draft release
  const createDraftRelease = useCallback(async () => {
    if (!githubConfig) {
      setError('GitHub configuration required')
      return
    }

    if (!token) {
      setError('Authentication required. Please log in to create releases.')
      return
    }

    if (!canBuildTags) {
      setError('Permission denied. Only administrators and managers can create releases.')
      return
    }

    if (!draftReleaseData.tag || !draftReleaseData.branch || !draftReleaseData.repo) {
      setError('Please fill in Tag, Branch, and Repository fields')
      return
    }

    // If release notes were generated (commits found), require explicit confirmation
    if (hasGeneratedReleaseNotes && !confirmCreateRelease) {
      setError('Please confirm that you want to create a draft release. Release notes have been generated from commits - please recheck before proceeding.')
      return
    }

    const normalizedRepo = normalizeRepoName(draftReleaseData.repo, githubConfig)
    setCreatingRelease(true)
    setError(null)

    try {
      const response = await fetch(`${apiUrl}/github/create-release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          repo: normalizedRepo,
          tag: draftReleaseData.tag,
          branch: draftReleaseData.branch,
          name: draftReleaseData.name || draftReleaseData.tag,
          body: draftReleaseData.body || `Release ${draftReleaseData.tag} from branch ${draftReleaseData.branch}`,
          prerelease: draftReleaseData.prerelease,
          githubToken: githubConfig.token,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        alert(`Draft release created successfully!\n\nTag: ${data.release.tagName}\nBranch: ${draftReleaseData.branch}\nName: ${data.release.name}\n\nView release: ${data.release.url}`)
        setShowDraftReleaseForm(false)
        // Refresh releases
        fetchReleases()
      } else {
        setError(data.message || 'Failed to create draft release')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create draft release')
      console.error('Error creating draft release:', err)
    } finally {
      setCreatingRelease(false)
    }
  }, [apiUrl, githubConfig, token, canBuildTags, draftReleaseData, fetchReleases, normalizeRepoName])

  // Handle build form submission
  const handleBuildFormSubmit = useCallback(() => {
    if (!buildFormData.branchName || !buildFormData.consoleName || !buildFormData.tagName) {
      setError('Please fill in all fields: Branch Name, Console Name, and Tag Name')
      return
    }

    setShowBuildForm(false)
    setError(null)
    
    // Trigger build with form data
    triggerBuild(
      buildFormData.repo,
      buildFormData.tagName,
      buildFormData.branchName,
      buildFormData.consoleName
    )
    
    setPendingBuildAction(null)
  }, [buildFormData, triggerBuild])

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  const filteredReleases = selectedRepo === 'all' 
    ? releases 
    : releases.filter(r => r.repo === selectedRepo)

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Package className="w-6 h-6" />
              Release Notes
            </h2>
            <p className="text-gray-600 mt-1">View release notes and build latest tags</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                fetchReleases()
                fetchTags()
              }}
              disabled={loading || loadingTags || !githubConfig}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading || loadingTags ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={() => setShowTags(!showTags)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              <Tag className="w-4 h-4" />
              {showTags ? 'Hide' : 'Show'} Tags
            </button>
            {canBuildTags && (
              <button
                onClick={() => openDraftReleaseForm()}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Draft Release
              </button>
            )}
          </div>
        </div>

        {!githubConfig && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-yellow-800">
              Please configure GitHub settings in the Settings tab to view releases.
            </p>
          </div>
        )}

        {/* Configured Repositories List */}
        {githubConfig && githubConfig.repositories && githubConfig.repositories.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-semibold text-blue-900 mb-2">Configured Repositories ({githubConfig.repositories.length})</h3>
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

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Repository Filter */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Repository
          </label>
          <select
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Repositories</option>
            {repos.map(repo => (
              <option key={repo} value={repo}>{repo}</option>
            ))}
          </select>
        </div>

        {/* Build Latest Tag Button - Only visible to admin/manager */}
        {selectedRepo !== 'all' && repos.includes(selectedRepo) && canBuildTags && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Build Latest Tag</h3>
                <p className="text-sm text-gray-600">
                  Build the latest release tag for <strong>{selectedRepo}</strong>
                </p>
              </div>
              <button
                onClick={() => {
                  const normalizedRepo = normalizeRepoName(selectedRepo, githubConfig || null)
                  const repoReleases = releases.filter(r => r.repo === normalizedRepo && !r.draft && !r.prerelease)
                  const latestRelease = repoReleases[0]
                  if (latestRelease) {
                    openBuildForm(normalizedRepo, latestRelease.tagName, () => {})
                  } else {
                    setError('No published releases found for this repository')
                  }
                }}
                disabled={building[`${selectedRepo}-latest`] || !githubConfig}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {building[`${selectedRepo}-latest`] ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Building...
                  </>
                ) : buildStatus[`${selectedRepo}-latest`] === 'success' ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Build Started
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Build Latest Tag
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Tags Section */}
        {showTags && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Tag className="w-5 h-5" />
                Git Tags ({tags.length})
              </h3>
            </div>
            {loadingTags ? (
              <div className="text-center py-8">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-blue-600 mb-2" />
                <p className="text-sm text-gray-600">Loading tags...</p>
              </div>
            ) : tags.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-lg">
                <Tag className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-600">No tags found</p>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {tags
                    .filter(tag => selectedRepo === 'all' || tag.repo === selectedRepo)
                    .map((tag, index) => (
                      <div
                        key={`${tag.repo}-${tag.name}-${index}`}
                        className="bg-white border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-gray-900 truncate" title={tag.name}>
                              {tag.name}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">{tag.repo}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <a
                            href={tag.zipballUrl || `https://github.com/${tag.repo}/archive/refs/tags/${tag.name}.zip`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                            title="Download ZIP"
                          >
                            <Download className="w-3 h-3" />
                            ZIP
                          </a>
                          {tag.commit && (
                            <a
                              href={`https://github.com/${tag.repo}/commit/${tag.commit.sha}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-gray-600 hover:text-gray-800"
                              title="View Commit"
                            >
                              {tag.commit.sha.substring(0, 7)}
                            </a>
                          )}
                        </div>
                        {canBuildTags && (
                        <button
                          onClick={() => {
                              openBuildForm(tag.repo, tag.name, () => {})
                          }}
                          disabled={building[`${tag.repo}-${tag.name}`] || !githubConfig}
                          className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                        >
                          {building[`${tag.repo}-${tag.name}`] ? (
                            <>
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              Building...
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3" />
                              Build
                            </>
                          )}
                        </button>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Releases List */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Package className="w-5 h-5" />
            Releases ({filteredReleases.length})
          </h3>
          {loading ? (
            <div className="text-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-4" />
              <p className="text-gray-600">Loading releases...</p>
            </div>
          ) : filteredReleases.length === 0 ? (
            <div className="text-center py-12">
              <Tag className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600">No releases found</p>
            </div>
          ) : (
          <div className="space-y-4">
            {filteredReleases.map((release) => (
              <div
                key={release.id}
                className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Tag className="w-5 h-5 text-blue-600" />
                      <h3 className="text-xl font-bold text-gray-900">{release.name}</h3>
                      {release.prerelease && (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                          Pre-release
                        </span>
                      )}
                      {release.draft && (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                          Draft
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                      <span className="flex items-center gap-1">
                        <GitBranch className="w-4 h-4" />
                        {release.tagName}
                      </span>
                      <span className="flex items-center gap-1">
                        <Package className="w-4 h-4" />
                        {release.repo}
                      </span>
                      <span>{formatDate(release.publishedAt)}</span>
                    </div>
                  </div>
                  <a
                    href={release.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    View on GitHub
                  </a>
                </div>

                {release.body && (
                  <div className="prose max-w-none mb-4">
                    <div className="text-gray-700 whitespace-pre-wrap text-sm">
                      {release.body}
                    </div>
                  </div>
                )}

                {release.assets && release.assets.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Assets</h4>
                    <div className="space-y-2">
                      {release.assets.map((asset, index) => (
                        <a
                          key={index}
                          href={asset.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <Download className="w-4 h-4 text-gray-600" />
                            <span className="text-sm text-gray-900">{asset.name}</span>
                          </div>
                          <span className="text-xs text-gray-500">{formatFileSize(asset.size)}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Build Tag Button for this specific release */}
                {!release.draft && !release.prerelease && canBuildTags && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <button
                      onClick={() => {
                        openBuildForm(release.repo, release.tagName, () => {})
                      }}
                      disabled={building[`${release.repo}-${release.tagName}`] || !githubConfig}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      {building[`${release.repo}-${release.tagName}`] ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Building...
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          Build This Tag
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {filteredReleases.length > 0 && (
          <div className="mt-4 text-sm text-gray-600">
            Showing {filteredReleases.length} release{filteredReleases.length !== 1 ? 's' : ''}
          </div>
        )}
        </div>
      </div>

      {/* Build Form Modal */}
      {showBuildForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]" onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowBuildForm(false)
            setPendingBuildAction(null)
            setError(null)
          }
        }}>
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Build Configuration</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Branch Name <span className="text-red-500">*</span>
                </label>
                <select
                  value={buildFormData.branchName}
                  onChange={(e) => setBuildFormData(prev => ({ ...prev, branchName: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={loadingBranches}
                >
                  <option value="">{loadingBranches ? 'Loading branches...' : 'Select a branch'}</option>
                  {branches.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
                {loadingBranches && (
                  <p className="mt-1 text-xs text-gray-500">Fetching branches from GitHub...</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Customer/Console Name <span className="text-red-500">*</span>
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Which customer will consume this build? Enter the customer name or select an environment.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={buildFormData.consoleName}
                    onChange={(e) => setBuildFormData(prev => ({ ...prev, consoleName: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={loadingCustomers ? "Loading customers from GitHub..." : "Enter customer name or select from list"}
                    list="console-options"
                    disabled={loadingCustomers}
                  />
                  <datalist id="console-options">
                    {consoleOptions.map((console) => (
                      <option key={console} value={console} />
                    ))}
                  </datalist>
                </div>
                {loadingCustomers && (
                  <p className="mt-1 text-xs text-gray-500">Fetching customers from GitHub...</p>
                )}
                {!loadingCustomers && consoleOptions.length > 0 && (
                  <p className="mt-1 text-xs text-gray-400">
                    {customers.length > 0 ? 'Customers from GitHub' : 'Default options'}: {consoleOptions.slice(0, 10).join(', ')}{consoleOptions.length > 10 ? '...' : ''}
                  </p>
                )}
              </div>
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tag Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={buildFormData.tagName}
                  onChange={(e) => {
                    setBuildFormData(prev => ({ ...prev, tagName: e.target.value }))
                    generateTagSuggestions(e.target.value)
                    setShowTagSuggestions(true)
                  }}
                  onFocus={() => {
                    generateTagSuggestions(buildFormData.tagName)
                    setShowTagSuggestions(true)
                  }}
                  onBlur={() => {
                    // Delay hiding suggestions to allow clicking on them
                    setTimeout(() => setShowTagSuggestions(false), 200)
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., v1.0.0"
                />
                {showTagSuggestions && tagSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {tagSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => {
                          setBuildFormData(prev => ({ ...prev, tagName: suggestion }))
                          setShowTagSuggestions(false)
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none text-sm"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
                {tagSuggestions.length === 0 && buildFormData.tagName && (
                  <p className="mt-1 text-xs text-gray-500">No matching tags found. You can enter a new tag name.</p>
                )}
              </div>
            </div>
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}
            <div className="mt-6 flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowBuildForm(false)
                  setPendingBuildAction(null)
                  setError(null)
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBuildFormSubmit}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Start Build
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Draft Release Form Modal */}
      {showDraftReleaseForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]" onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowDraftReleaseForm(false)
            setError(null)
          }
        }}>
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Draft Release
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Repository <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={draftReleaseData.repo}
                  onChange={(e) => setDraftReleaseData(prev => ({ ...prev, repo: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="e.g., org/repo"
                />
                {selectedRepo !== 'all' && (
                  <button
                    onClick={() => {
                      const normalizedRepo = normalizeRepoName(selectedRepo, githubConfig || null)
                      setDraftReleaseData(prev => ({ ...prev, repo: normalizedRepo }))
                      if (normalizedRepo) {
                        fetchBranches(normalizedRepo)
                      }
                    }}
                    className="mt-1 text-xs text-purple-600 hover:text-purple-700"
                  >
                    Use selected repository: {selectedRepo}
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tag Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={draftReleaseData.tag}
                    onChange={(e) => handleTagChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="e.g., v1.0.0"
                    list="tag-suggestions-draft"
                  />
                  {loadingReleaseNotes && (
                    <p className="mt-1 text-xs text-gray-500">Generating release notes from commits...</p>
                  )}
                  <datalist id="tag-suggestions-draft">
                    {tags
                      .filter(t => !draftReleaseData.repo || t.repo === draftReleaseData.repo)
                      .slice(0, 20)
                      .map((tag) => (
                        <option key={tag.name} value={tag.name} />
                      ))}
                  </datalist>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Branch <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={draftReleaseData.branch}
                    onChange={(e) => setDraftReleaseData(prev => ({ ...prev, branch: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                    disabled={loadingBranches}
                  >
                    <option value="">{loadingBranches ? 'Loading branches...' : 'Select a branch'}</option>
                    {branches.map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </select>
                  {loadingBranches && (
                    <p className="mt-1 text-xs text-gray-500">Fetching branches...</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Release Name
                </label>
                <input
                  type="text"
                  value={draftReleaseData.name}
                  onChange={(e) => setDraftReleaseData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Leave empty to use tag name"
                />
                <p className="mt-1 text-xs text-gray-500">If empty, will use the tag name</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Release Notes {loadingReleaseNotes && <span className="text-xs text-gray-500">(Generating...)</span>}
                </label>
                <textarea
                  value={draftReleaseData.body}
                  onChange={(e) => setDraftReleaseData(prev => ({ ...prev, body: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
                  rows={10}
                  placeholder="Release notes will be auto-generated from commits when you select a tag..."
                  disabled={loadingReleaseNotes}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Release notes are automatically generated from commits when you select a tag. You can edit them manually.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="prerelease"
                  checked={draftReleaseData.prerelease}
                  onChange={(e) => setDraftReleaseData(prev => ({ ...prev, prerelease: e.target.checked }))}
                  className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                />
                <label htmlFor="prerelease" className="text-sm text-gray-700">
                  Mark as pre-release
                </label>
              </div>

              {tagHasRelease && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-yellow-600" />
                  <p className="text-yellow-800 text-sm">
                    This tag already has a release. You cannot create a draft release for a tag that already has a published release.
                  </p>
                </div>
              )}

              {hasGeneratedReleaseNotes && !tagHasRelease && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <div className="flex items-start gap-2 mb-3">
                    <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-orange-800 font-semibold text-sm mb-1">
                        Release notes have been generated from commits
                      </p>
                      <p className="text-orange-700 text-sm">
                        Please recheck the release notes above. If the commits shown are correct, confirm below to proceed with creating the draft release.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="confirm-release"
                      checked={confirmCreateRelease}
                      onChange={(e) => {
                        setConfirmCreateRelease(e.target.checked)
                        if (e.target.checked) {
                          setError(null) // Clear error when confirmed
                        }
                      }}
                      className="w-4 h-4 text-orange-600 border-orange-300 rounded focus:ring-orange-500"
                    />
                    <label htmlFor="confirm-release" className="text-sm text-orange-800 cursor-pointer">
                      I have reviewed the release notes and confirm to create the draft release
                    </label>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                  <p className="text-red-800 text-sm">{error}</p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  onClick={() => {
                    setShowDraftReleaseForm(false)
                    setError(null)
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  disabled={creatingRelease}
                >
                  Cancel
                </button>
                <button
                  onClick={createDraftRelease}
                  disabled={creatingRelease || !draftReleaseData.tag || !draftReleaseData.branch || !draftReleaseData.repo || tagHasRelease || (hasGeneratedReleaseNotes && !confirmCreateRelease)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  title={tagHasRelease ? 'This tag already has a release' : (hasGeneratedReleaseNotes && !confirmCreateRelease) ? 'Please confirm after reviewing the release notes' : ''}
                >
                  {creatingRelease ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Create Draft Release
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}









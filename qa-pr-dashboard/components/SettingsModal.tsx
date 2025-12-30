'use client'

import { useState, useEffect } from 'react'
import { X, Save, Eye, EyeOff, List } from 'lucide-react'
import { GitHubConfig, JiraConfig } from '@/types/config'
import { listJiraProjects } from '@/lib/api'
import { storage, STORAGE_KEYS } from '@/utils/storage'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (config: { github?: GitHubConfig; jira?: JiraConfig }) => void
  initialConfig?: { github?: GitHubConfig; jira?: JiraConfig }
  apiUrl?: string
  inline?: boolean  // If true, render without modal overlay (for tab view)
}

export default function SettingsModal({
  isOpen,
  onClose,
  onSave,
  initialConfig,
  apiUrl = 'http://localhost:8000/api',
  inline = false,
}: SettingsModalProps) {
  const [githubConfig, setGitHubConfig] = useState<GitHubConfig>({
    token: '',
    organization: 'coredgeio',
    username: '',
    repositories: [],
  })
  const [jiraConfig, setJiraConfig] = useState<JiraConfig>({
    baseUrl: '',
    email: '',
    apiToken: '',
    projectKey: '',
    labels: [],
  })
  const [showGitHubToken, setShowGitHubToken] = useState(false)
  const [showJiraToken, setShowJiraToken] = useState(false)
  const [repositoriesInput, setRepositoriesInput] = useState('')
  const [jiraLabelsInput, setJiraLabelsInput] = useState('')
  const [isLoadingProjects, setIsLoadingProjects] = useState(false)
  const [availableProjects, setAvailableProjects] = useState<Array<{ key: string; name: string; projectType: string; archived: boolean }>>([])
  const [showProjectsList, setShowProjectsList] = useState(false)

  useEffect(() => {
    // Ensure storage is available before using it
    if (typeof storage === 'undefined' || !storage || typeof storage.getLocal !== 'function') {
      console.error('❌ Storage utility is not available')
      return
    }

    // Priority: initialConfig prop > localStorage
    if (initialConfig) {
      if (initialConfig.github) {
        setGitHubConfig(initialConfig.github)
        setRepositoriesInput(initialConfig.github.repositories?.join(', ') || '')
        console.log('📖 SettingsModal: Loaded GitHub config from initialConfig prop')
      }
      if (initialConfig.jira) {
        setJiraConfig(initialConfig.jira)
        setJiraLabelsInput(initialConfig.jira.labels?.join(', ') || '')
        console.log('📖 SettingsModal: Loaded Jira config from initialConfig prop:', {
          baseUrl: initialConfig.jira.baseUrl,
          email: initialConfig.jira.email,
          projectKey: initialConfig.jira.projectKey
        })
      }
    } else {
      // Load from localStorage if no initialConfig provided
      try {
        const savedGitHub = storage.getLocal<GitHubConfig>(STORAGE_KEYS.GITHUB_CONFIG)
        const savedJira = storage.getLocal<JiraConfig>(STORAGE_KEYS.JIRA_CONFIG)

        if (savedGitHub) {
          const config = savedGitHub
          setGitHubConfig(config)
          setRepositoriesInput(config.repositories?.join(', ') || '')
          console.log('📖 SettingsModal: Loaded GitHub config from localStorage')
        }
        if (savedJira) {
          setJiraConfig(savedJira)
          setJiraLabelsInput(savedJira.labels?.join(', ') || '')
          console.log('📖 SettingsModal: Loaded Jira config from localStorage:', {
            baseUrl: savedJira.baseUrl,
            email: savedJira.email,
            projectKey: savedJira.projectKey
          })
        }
      } catch (error) {
        console.error('❌ Error loading settings from localStorage:', error)
      }
    }
  }, [initialConfig, isOpen])

  const handleSave = () => {
    const repos = repositoriesInput
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0)

    const labels = jiraLabelsInput
      .split(',')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    const config = {
      github: {
        ...githubConfig,
        repositories: repos,
      },
      jira: {
        ...jiraConfig,
        labels: labels.length > 0 ? labels : undefined,
      },
    }

    // Save to localStorage using storage utility (persistent preferences)
    // Ensure storage is available before using it
    if (typeof storage === 'undefined' || !storage || typeof storage.setLocal !== 'function') {
      console.error('❌ Storage utility is not available, cannot save settings')
      alert('Error: Storage utility is not available. Settings may not persist.')
    } else {
      try {
        const savedGitHub = storage.setLocal(STORAGE_KEYS.GITHUB_CONFIG, config.github)
        const savedJira = storage.setLocal(STORAGE_KEYS.JIRA_CONFIG, config.jira)
        
        if (!savedGitHub || !savedJira) {
          console.warn('⚠️ Failed to save settings to localStorage')
        } else {
          console.log('✅ Settings saved to localStorage successfully')
        }
      } catch (error) {
        console.error('❌ Error saving settings to localStorage:', error)
        alert('Error saving settings. Please try again.')
        return // Don't proceed if save failed
      }
    }

    onSave(config)
    onClose()
  }

  const handleListProjects = async () => {
    if (!jiraConfig.baseUrl || !jiraConfig.email || !jiraConfig.apiToken) {
      alert('Please fill in Base URL, Email, and API Token first to list projects.')
      return
    }

    setIsLoadingProjects(true)
    setShowProjectsList(false)

    try {
      const result = await listJiraProjects(apiUrl, {
        baseUrl: jiraConfig.baseUrl,
        email: jiraConfig.email,
        apiToken: jiraConfig.apiToken,
      })
      
      setAvailableProjects(result.projects || [])
      setShowProjectsList(true)
    } catch (error: any) {
      alert(`Failed to fetch projects: ${error.message}`)
      console.error('Error fetching projects:', error)
    } finally {
      setIsLoadingProjects(false)
    }
  }

  const handleSelectProject = (projectKey: string) => {
    setJiraConfig({ ...jiraConfig, projectKey })
    setShowProjectsList(false)
  }

  if (!isOpen) return null

  const content = (
    <div className={`${inline ? 'w-full bg-white rounded-xl' : 'bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4 border border-gray-200/80 backdrop-blur-sm'}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-200/80 bg-gradient-to-r from-gray-50 to-white">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Integration Settings</h2>
          <p className="text-sm text-gray-500 mt-1">Configure GitHub and Jira integrations</p>
        </div>
        {!inline && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1.5 transition-all duration-200 hover:scale-110 active:scale-95"
            aria-label="Close settings"
          >
            <X className="w-6 h-6" />
          </button>
        )}
      </div>

        {/* Content */}
        <div className="p-6 space-y-8">
          {/* GitHub Configuration */}
          <div className="bg-gradient-to-br from-gray-50/50 to-white p-5 rounded-xl border border-gray-100">
            <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-1 h-6 bg-primary-500 rounded-full"></span>
              GitHub Configuration
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Personal Access Token *
                </label>
                <div className="relative">
                  <input
                    type={showGitHubToken ? 'text' : 'password'}
                    value={githubConfig.token}
                    onChange={(e) =>
                      setGitHubConfig({ ...githubConfig, token: e.target.value })
                    }
                    className="input-primary pr-10"
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGitHubToken(!showGitHubToken)}
                    className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-700"
                  >
                    {showGitHubToken ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Create token at: GitHub → Settings → Developer settings → Personal access tokens
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Organization (optional)
                </label>
                <input
                  type="text"
                  value={githubConfig.organization || ''}
                  onChange={(e) =>
                    setGitHubConfig({ ...githubConfig, organization: e.target.value })
                  }
                    className="input-primary"
                  placeholder="coredgeio"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Enter the GitHub organization name (e.g., coredgeio) to sync PRs from that org only
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Username (optional)
                </label>
                <input
                  type="text"
                  value={githubConfig.username || ''}
                  onChange={(e) =>
                    setGitHubConfig({ ...githubConfig, username: e.target.value })
                  }
                    className="input-primary"
                  placeholder="myusername"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Repositories (comma-separated)
                </label>
                <input
                  type="text"
                  value={repositoriesInput}
                  onChange={(e) => setRepositoriesInput(e.target.value)}
                    className="input-primary"
                  placeholder="repo1, repo2, repo3"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Leave empty to sync all accessible repositories
                </p>
              </div>
            </div>
          </div>

          {/* Jira Configuration */}
          <div className="bg-gradient-to-br from-gray-50/50 to-white p-5 rounded-xl border border-gray-100">
            <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-1 h-6 bg-primary-500 rounded-full"></span>
              Jira Configuration
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Base URL *
                </label>
                <input
                  type="text"
                  value={jiraConfig.baseUrl}
                  onChange={(e) =>
                    setJiraConfig({ ...jiraConfig, baseUrl: e.target.value })
                  }
                    className="input-primary"
                  placeholder="https://your-domain.atlassian.net"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  value={jiraConfig.email}
                  onChange={(e) =>
                    setJiraConfig({ ...jiraConfig, email: e.target.value })
                  }
                    className="input-primary"
                  placeholder="your.email@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API Token *
                </label>
                <div className="relative">
                  <input
                    type={showJiraToken ? 'text' : 'password'}
                    value={jiraConfig.apiToken}
                    onChange={(e) =>
                      setJiraConfig({ ...jiraConfig, apiToken: e.target.value })
                    }
                    className="input-primary pr-10"
                    placeholder="Your Jira API token"
                  />
                  <button
                    type="button"
                    onClick={() => setShowJiraToken(!showJiraToken)}
                    className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-700"
                  >
                    {showJiraToken ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Create token at: Jira → Account Settings → Security → API tokens
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Project Key *
                  </label>
                  <button
                    type="button"
                    onClick={handleListProjects}
                    disabled={isLoadingProjects || !jiraConfig.baseUrl || !jiraConfig.email || !jiraConfig.apiToken}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    <List className="w-3 h-3" />
                    {isLoadingProjects ? 'Loading...' : 'List Projects'}
                  </button>
                </div>
                <input
                  type="text"
                  value={jiraConfig.projectKey}
                  onChange={(e) =>
                    setJiraConfig({ ...jiraConfig, projectKey: e.target.value })
                  }
                    className="input-primary"
                  placeholder="PROJ"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Enter the project key (e.g., PROJ, TEST). Click &quot;List Projects&quot; to see all available projects.
                </p>
                
                {showProjectsList && availableProjects.length > 0 && (
                  <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md max-h-48 overflow-y-auto">
                    <p className="text-xs font-medium text-blue-900 mb-2">Available Projects:</p>
                    <div className="space-y-1">
                      {availableProjects.map((project) => (
                        <button
                          key={project.key}
                          type="button"
                          onClick={() => handleSelectProject(project.key)}
                          disabled={project.archived}
                          className={`w-full text-left px-2 py-1 text-xs rounded hover:bg-blue-100 transition-colors ${
                            project.archived 
                              ? 'text-gray-500 line-through cursor-not-allowed' 
                              : 'text-blue-800 cursor-pointer'
                          }`}
                        >
                          <span className="font-medium">{project.key}</span> - {project.name}
                          {project.archived && <span className="ml-2 text-red-600">(Archived)</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Labels (comma-separated, optional)
                </label>
                <input
                  type="text"
                  value={jiraLabelsInput}
                  onChange={(e) => setJiraLabelsInput(e.target.value)}
                    className="input-primary"
                  placeholder="qa, testing, bug, enhancement"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Filter Jira issues by labels. Leave empty to sync all issues from the project.
                  <br />
                  <strong>Example:</strong> <code className="bg-gray-100 px-1 rounded">qa, testing</code> - will fetch issues with both &quot;qa&quot; AND &quot;testing&quot; labels
                </p>
              </div>
            </div>
          </div>
        </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200/80 bg-gray-50/50">
        <button
          onClick={onClose}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="btn-primary flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          Save Settings
        </button>
      </div>
    </div>
  )

  if (inline) {
    return content
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      {content}
    </div>
  )
}


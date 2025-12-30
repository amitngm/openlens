'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Save, Loader2, Key, Settings, Server, Zap, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react'

interface UserSettingsProps {
  apiUrl: string
  onSettingsSaved?: () => void
}

interface UserSettingsData {
  jiraToken?: string
  jiraLabel?: string
  jiraUrl?: string
  jiraEmail?: string
  jiraProjectKey?: string
  preferences?: {
    theme?: string
    notifications?: boolean
    defaultNamespace?: string
  }
}

export default function UserSettings({ apiUrl, onSettingsSaved }: UserSettingsProps) {
  const { user, token } = useAuth()
  const [settings, setSettings] = useState<UserSettingsData>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showJiraToken, setShowJiraToken] = useState(false)

  const loadSettings = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${apiUrl}/user/settings`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      
      // Check if response is HTML (error page)
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text()
        console.error('Non-JSON response:', text.substring(0, 200))
        setError(`Server returned non-JSON response (${response.status}). Please check if the API server is running.`)
        setLoading(false)
        return
      }
      
      const data = await response.json()
      if (data.success) {
        setSettings(data.settings || {})
      } else {
        setError(data.error || 'Failed to load settings')
      }
    } catch (err: any) {
      console.error('Settings load error:', err)
      if (err.message && err.message.includes('Unexpected token')) {
        setError('API endpoint not found. Please ensure the API server is running and restart it if needed.')
      } else {
        setError('Failed to load settings: ' + (err.message || 'Network error'))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user && token) {
      loadSettings()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, token])
  
  // Initialize jiraEmail with user's email if not set
  useEffect(() => {
    if (user?.email && settings && !settings.jiraEmail) {
      setSettings(prev => ({ ...prev, jiraEmail: user.email }))
    }
  }, [user?.email, settings])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch(`${apiUrl}/user/settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ settings })
      })
      const data = await response.json()
      if (data.success) {
        setSuccess('Settings saved successfully')
        setTimeout(() => setSuccess(null), 3000)
        // Notify parent component to reload settings if callback provided
        if (onSettingsSaved) {
          onSettingsSaved()
        }
      } else {
        setError(data.error || 'Failed to save settings')
      }
    } catch (err: any) {
      setError('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const updateSetting = (key: keyof UserSettingsData, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  const updatePreference = (key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        [key]: value
      }
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        <span className="ml-3 text-gray-500">Loading settings...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">User Settings</h2>
          <p className="text-sm text-gray-600 mt-1">Manage your personal settings and tokens</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Settings
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md flex items-center gap-2">
          <XCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-md flex items-center gap-2">
          <CheckCircle className="w-5 h-5" />
          {success}
        </div>
      )}

      {/* API Tokens Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Key className="w-5 h-5 text-gray-600" />
          <h3 className="text-lg font-semibold text-gray-900">API Tokens</h3>
        </div>

        <div className="space-y-4">
          {/* Jira Token */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Jira API Token
            </label>
            <div className="relative">
              <input
                type={showJiraToken ? 'text' : 'password'}
                value={settings.jiraToken || ''}
                onChange={(e) => updateSetting('jiraToken', e.target.value)}
                placeholder="xxxxxxxxxxxxxxxxxxxx"
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowJiraToken(!showJiraToken)}
                className="absolute right-2 top-2 text-gray-500 hover:text-gray-700"
              >
                {showJiraToken ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Used for Jira API operations and issue management
            </p>
          </div>

          {/* Jira URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Jira Base URL
            </label>
            <input
              type="url"
              value={settings.jiraUrl || ''}
              onChange={(e) => updateSetting('jiraUrl', e.target.value)}
              placeholder="https://yourcompany.atlassian.net"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Your Jira instance URL
            </p>
          </div>

          {/* Jira Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Jira Email
            </label>
            <input
              type="email"
              value={settings.jiraEmail || user?.email || ''}
              onChange={(e) => updateSetting('jiraEmail', e.target.value)}
              placeholder="your.email@company.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Your Jira account email (used for API authentication)
            </p>
          </div>

          {/* Jira Project Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Jira Project Key
            </label>
            <input
              type="text"
              value={settings.jiraProjectKey || ''}
              onChange={(e) => updateSetting('jiraProjectKey', e.target.value)}
              placeholder="e.g., PROJ, QA, DEV"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              The project key to fetch issues from (e.g., PROJ, QA)
            </p>
          </div>

          {/* Jira Label */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Jira Label (Optional)
            </label>
            <input
              type="text"
              value={settings.jiraLabel || ''}
              onChange={(e) => updateSetting('jiraLabel', e.target.value)}
              placeholder="e.g., qa-team, automation"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Filter issues by this label (leave empty to show all issues)
            </p>
          </div>
        </div>
      </div>

      {/* Kubernetes Configuration Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Server className="w-5 h-5 text-gray-600" />
          <h3 className="text-lg font-semibold text-gray-900">Kubernetes Configuration</h3>
        </div>
        <p className="text-sm text-gray-600">
          Kubernetes cluster configurations are managed in the{' '}
          <span className="font-medium text-blue-600">Kubernetes Management</span> tab.
          Your kubeconfigs are stored separately and are only visible to you (or admins).
        </p>
      </div>

      {/* Automation Rules Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-5 h-5 text-gray-600" />
          <h3 className="text-lg font-semibold text-gray-900">Automation Rules</h3>
        </div>
        <p className="text-sm text-gray-600">
          Automation rules are managed in the{' '}
          <span className="font-medium text-blue-600">Automation</span> tab.
          Rules you create are personal to your account unless you&apos;re an admin.
        </p>
      </div>

      {/* Preferences Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-5 h-5 text-gray-600" />
          <h3 className="text-lg font-semibold text-gray-900">Preferences</h3>
        </div>

        <div className="space-y-4">
          {/* Theme */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Theme
            </label>
            <select
              value={settings.preferences?.theme || 'light'}
              onChange={(e) => updatePreference('theme', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="auto">Auto (System)</option>
            </select>
          </div>

          {/* Default Namespace */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Kubernetes Namespace
            </label>
            <input
              type="text"
              value={settings.preferences?.defaultNamespace || ''}
              onChange={(e) => updatePreference('defaultNamespace', e.target.value)}
              placeholder="default"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Default namespace to use when working with Kubernetes resources
            </p>
          </div>

          {/* Notifications */}
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Enable Notifications
              </label>
              <p className="text-xs text-gray-500">
                Receive notifications for important events and updates
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.preferences?.notifications ?? true}
                onChange={(e) => updatePreference('notifications', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}


'use client'

import { useState, useEffect } from 'react'
import { Save, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

interface ManagerSettingsProps {
  apiUrl: string
  onSave?: () => void
}

interface ManagerSettingsData {
  jiraLabel?: string
  jiraUrl?: string
  jiraEmail?: string
  jiraToken?: string
  jiraProjectKey?: string
  kubeconfig?: string
}

export default function ManagerSettings({ apiUrl, onSave }: ManagerSettingsProps) {
  const { user, token } = useAuth()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showJiraToken, setShowJiraToken] = useState(false)
  const [showKubeconfig, setShowKubeconfig] = useState(false)
  
  const [settings, setSettings] = useState<ManagerSettingsData>({
    jiraLabel: '',
    jiraUrl: '',
    jiraEmail: '',
    jiraToken: '',
    jiraProjectKey: '',
    kubeconfig: '',
  })

  useEffect(() => {
    if (user && token) {
      loadSettings()
    }
  }, [user, token])

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
      
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text()
        console.error('Non-JSON response:', text.substring(0, 200))
        setError(`Server returned non-JSON response (${response.status})`)
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
      setError('Failed to load settings: ' + (err.message || 'Network error'))
    } finally {
      setLoading(false)
    }
  }

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
        setSuccess('Settings saved successfully!')
        setTimeout(() => setSuccess(null), 3000)
        if (onSave) {
          onSave()
        }
      } else {
        setError(data.error || 'Failed to save settings')
      }
    } catch (err: any) {
      console.error('Settings save error:', err)
      setError('Failed to save settings: ' + (err.message || 'Network error'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-500">Loading settings...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-800">
          {error}
        </div>
      )}
      
      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-md text-green-800">
          {success}
        </div>
      )}

      <div className="space-y-6">
        {/* Jira Configuration */}
        <div>
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Jira Configuration</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Jira Label (optional)
              </label>
              <input
                type="text"
                value={settings.jiraLabel || ''}
                onChange={(e) => setSettings({ ...settings, jiraLabel: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., qa, testing"
              />
              <p className="mt-1 text-xs text-gray-500">
                Filter Jira issues by this label. Leave empty to see all issues.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Jira Base URL
              </label>
              <input
                type="text"
                value={settings.jiraUrl || ''}
                onChange={(e) => setSettings({ ...settings, jiraUrl: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://your-domain.atlassian.net"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Jira Email
              </label>
              <input
                type="email"
                value={settings.jiraEmail || ''}
                onChange={(e) => setSettings({ ...settings, jiraEmail: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="your.email@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Jira API Token
              </label>
              <div className="relative">
                <input
                  type={showJiraToken ? 'text' : 'password'}
                  value={settings.jiraToken || ''}
                  onChange={(e) => setSettings({ ...settings, jiraToken: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                  placeholder="Your Jira API token"
                />
                <button
                  type="button"
                  onClick={() => setShowJiraToken(!showJiraToken)}
                  className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-700"
                >
                  {showJiraToken ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Jira Project Key
              </label>
              <input
                type="text"
                value={settings.jiraProjectKey || ''}
                onChange={(e) => setSettings({ ...settings, jiraProjectKey: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="PROJ"
              />
            </div>
          </div>
        </div>

        {/* Kubernetes Configuration */}
        <div>
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Kubernetes Configuration</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Kubeconfig
            </label>
            <div className="relative">
              <textarea
                value={showKubeconfig ? (settings.kubeconfig || '') : (settings.kubeconfig ? '••••••••••••••••' : '')}
                onChange={(e) => setSettings({ ...settings, kubeconfig: e.target.value })}
                onFocus={() => setShowKubeconfig(true)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                rows={8}
                placeholder="Paste your kubeconfig YAML here"
                disabled={!showKubeconfig}
              />
              <button
                type="button"
                onClick={() => setShowKubeconfig(!showKubeconfig)}
                className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
              >
                {showKubeconfig ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Your personal Kubernetes configuration. This will be used for your Kubernetes operations.
            </p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-200">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

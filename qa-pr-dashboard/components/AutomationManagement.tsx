'use client'

import { useState, useEffect } from 'react'
import { Settings, Plus, Trash2, Edit, Save, X, ToggleLeft, ToggleRight, Bell, Link as LinkIcon, UserCheck, RefreshCw, Calendar, AlertTriangle, HelpCircle, BookOpen, Shield } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

interface AutomationConfig {
  enabled: boolean
  autoLinkPRToJira: boolean
  autoAssign: boolean
  statusSync: boolean
  webhooks: {
    github: { enabled: boolean; secret: string }
    jira: { enabled: boolean; secret: string }
  }
  autoAssignRules: Array<{
    id?: string
    name: string
    enabled: boolean
    repository?: string
    label?: string
    author?: string
    titlePattern?: string
    assignTo: string
  }>
  statusSyncRules: Array<any>
  statusBasedAssignRules: Array<{
    id?: string
    name: string
    enabled: boolean
    status: string
    assignTo: string
    label?: string
    projectKey?: string
  }>
  customRules: Array<{
    id?: string
    name: string
    enabled: boolean
    eventType?: string
    conditions?: Array<{
      field: string
      operator: 'equals' | 'contains' | 'regex'
      value: string
    }>
    actions?: Array<{
      type: 'assign' | 'add_label' | 'update_jira_status' | 'notify'
      value: string
    }>
  }>
  scheduledReports: Array<{
    id?: string
    name: string
    enabled: boolean
    type: 'pr' | 'jira'
    schedule: string
    filters: any
    recipients: Array<{ email: string }>
    format: 'json' | 'csv' | 'excel'
  }>
  blockerDetection: {
    enabled: boolean
    keywords: string[]
    notificationChannels: Array<{
      type: 'slack' | 'teams' | 'email'
      enabled: boolean
      webhookUrl?: string
      email?: string
    }>
  }
}

interface AutomationManagementProps {
  apiUrl?: string
}

export default function AutomationManagement({ apiUrl = 'http://localhost:8000/api' }: AutomationManagementProps) {
  const { hasRole } = useAuth()
  const [config, setConfig] = useState<AutomationConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'general' | 'auto-assign' | 'status-assign' | 'custom-rules' | 'reports' | 'webhooks' | 'blockers'>('general')
  const [editingRule, setEditingRule] = useState<string | null>(null)
  const [showAddRule, setShowAddRule] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // All hooks must be declared before any conditional returns
  useEffect(() => {
    if (hasRole('admin')) {
      loadConfig()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // RBAC: Only admins can access automation management
  // Check after all hooks are declared
  if (!hasRole('admin')) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
        <p className="text-gray-600">You need admin privileges to access Automation Management.</p>
      </div>
    )
  }

  const loadConfig = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`${apiUrl}/automation/config`)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data = await response.json()
      if (data.success && data.config) {
        // Ensure all required fields are present
        const config = {
          ...data.config,
          statusBasedAssignRules: data.config.statusBasedAssignRules || []
        }
        setConfig(config)
      } else if (data.config) {
        // Even if success is false, use the config if provided
        const config = {
          ...data.config,
          statusBasedAssignRules: data.config.statusBasedAssignRules || []
        }
        setConfig(config)
      } else {
        setError(data.error || 'Failed to load automation configuration')
        setLoading(false)
      }
    } catch (error: any) {
      console.error('Error loading automation config:', error)
      setError('Failed to load automation configuration: ' + error.message)
      // Try to use default config structure
      setConfig({
        enabled: true,
        autoLinkPRToJira: true,
        autoAssign: true,
        statusSync: true,
        webhooks: {
          github: { enabled: false, secret: '' },
          jira: { enabled: false, secret: '' }
        },
        autoAssignRules: [],
        statusSyncRules: [],
        statusBasedAssignRules: [],
        customRules: [],
        scheduledReports: [],
        blockerDetection: {
          enabled: true,
          keywords: ['blocked', 'blocker', 'blocking', 'cannot proceed', 'stuck'],
          notificationChannels: []
        }
      })
    } finally {
      setLoading(false)
    }
  }

  const saveConfig = async (updates: Partial<AutomationConfig>) => {
    try {
      setSaving(true)
      setError(null)
      const response = await fetch(`${apiUrl}/automation/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      const data = await response.json()
      if (data.success) {
        setConfig(data.config)
        setSuccess('Configuration saved successfully!')
        setTimeout(() => setSuccess(null), 3000)
      } else {
        setError('Failed to save configuration')
      }
    } catch (error: any) {
      setError('Failed to save configuration: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  const addAutoAssignRule = async (rule: any) => {
    try {
      const response = await fetch(`${apiUrl}/automation/auto-assign-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule)
      })
      const data = await response.json()
      if (data.success) {
        await loadConfig()
        setShowAddRule(false)
        setSuccess('Auto-assignment rule added!')
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (error: any) {
      setError('Failed to add rule: ' + error.message)
    }
  }

  const addCustomRule = async (rule: any) => {
    try {
      const response = await fetch(`${apiUrl}/automation/custom-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule)
      })
      const data = await response.json()
      if (data.success) {
        await loadConfig()
        setShowAddRule(false)
        setSuccess('Custom rule added!')
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (error: any) {
      setError('Failed to add rule: ' + error.message)
    }
  }

  const addStatusBasedAssignRule = async (rule: any) => {
    try {
      const response = await fetch(`${apiUrl}/automation/status-based-assign-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule)
      })
      const data = await response.json()
      if (data.success) {
        await loadConfig()
        setShowAddRule(false)
        setSuccess('Status-based assignment rule added!')
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (error: any) {
      setError('Failed to add rule: ' + error.message)
    }
  }

  const addScheduledReport = async (report: any) => {
    try {
      const response = await fetch(`${apiUrl}/automation/scheduled-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report)
      })
      const data = await response.json()
      if (data.success) {
        await loadConfig()
        setShowAddRule(false)
        setSuccess('Scheduled report added!')
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (error: any) {
      setError('Failed to add report: ' + error.message)
    }
  }

  const deleteRule = async (type: 'auto-assign' | 'status-assign' | 'custom' | 'report', id: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return

    try {
      const updates = { ...config }
      if (type === 'auto-assign') {
        updates.autoAssignRules = (updates.autoAssignRules || []).filter((r: any) => r.id !== id)
      } else if (type === 'status-assign') {
        updates.statusBasedAssignRules = (updates.statusBasedAssignRules || []).filter((r: any) => r.id !== id)
      } else if (type === 'custom') {
        updates.customRules = (updates.customRules || []).filter((r: any) => r.id !== id)
      } else if (type === 'report') {
        updates.scheduledReports = (updates.scheduledReports || []).filter((r: any) => r.id !== id)
      }
      await saveConfig(updates)
      setSuccess('Rule deleted successfully!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (error: any) {
      setError('Failed to delete rule: ' + error.message)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading automation configuration...</div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-red-500">Failed to load automation configuration</div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Automation & Workflows</h2>
            <p className="text-sm text-gray-500 mt-1">Automate PR linking, assignments, status sync, and more</p>
          </div>
          <div className="flex items-center gap-3">
            {success && (
              <div className="px-4 py-2 bg-green-100 text-green-800 rounded-md text-sm">
                {success}
              </div>
            )}
            {error && (
              <div className="px-4 py-2 bg-red-100 text-red-800 rounded-md text-sm">
                {error}
              </div>
            )}
            <button
              onClick={() => {
                const helpWindow = window.open('', '_blank', 'width=800,height=600')
                if (helpWindow) {
                  helpWindow.document.write(getHelpDocumentation())
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors text-sm"
              title="View Documentation"
            >
              <BookOpen className="w-4 h-4" />
              Documentation
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex -mb-px">
          {[
            { id: 'general', label: 'General', icon: Settings },
            { id: 'auto-assign', label: 'Auto-Assign', icon: UserCheck },
            { id: 'status-assign', label: 'Status-Based Assign', icon: UserCheck },
            { id: 'custom-rules', label: 'Custom Rules', icon: RefreshCw },
            { id: 'reports', label: 'Scheduled Reports', icon: Calendar },
            { id: 'webhooks', label: 'Webhooks', icon: LinkIcon },
            { id: 'blockers', label: 'Blocker Detection', icon: AlertTriangle },
          ].map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-6 py-3 flex items-center gap-2 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="p-6">
        {/* Help Banner */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start gap-3">
            <HelpCircle className="w-5 h-5 text-blue-600 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-blue-900 mb-1">Quick Start Guide</div>
              <div className="text-sm text-blue-700 space-y-1">
                <p>• <strong>Auto-link PR to Jira:</strong> Automatically links PRs to Jira issues when PR title contains issue keys (e.g., &quot;PROJ-123&quot;)</p>
                <p>• <strong>Auto-assign:</strong> Create rules to automatically assign PRs based on repository, labels, author, or title patterns</p>
                <p>• <strong>Status-Based Assign:</strong> When Jira issue status changes to a specific status (e.g., &quot;QA&quot;), automatically assign to a user</p>
                <p>• <strong>Status Sync:</strong> When a PR is merged, automatically updates the linked Jira issue to &quot;Done&quot;</p>
                <p>• <strong>Webhooks:</strong> Configure GitHub/Jira webhooks at <code className="bg-blue-100 px-1 rounded">{typeof window !== 'undefined' ? window.location.origin.replace(':3000', ':8000') : 'localhost:8000'}/api/webhooks/github</code></p>
                <p>• <strong>Blocker Detection:</strong> Automatically detects blockers in PR/Jira descriptions and sends notifications</p>
              </div>
            </div>
          </div>
        </div>

        {activeTab === 'general' && (
          <GeneralSettings config={config} onSave={saveConfig} saving={saving} />
        )}
        {activeTab === 'auto-assign' && (
          <>
            <AutoAssignRules
              rules={config.autoAssignRules || []}
              onAdd={addAutoAssignRule}
              onDelete={(id: string) => deleteRule('auto-assign', id)}
              showAdd={showAddRule}
              onShowAdd={() => setShowAddRule(true)}
              onHideAdd={() => setShowAddRule(false)}
            />
          </>
        )}
        {activeTab === 'status-assign' && (
          <>
            <StatusBasedAssignRules
              rules={config.statusBasedAssignRules || []}
              onAdd={addStatusBasedAssignRule}
              onDelete={(id: string) => deleteRule('status-assign', id)}
              showAdd={showAddRule}
              onShowAdd={() => setShowAddRule(true)}
              onHideAdd={() => setShowAddRule(false)}
            />
          </>
        )}
        {activeTab === 'custom-rules' && (
          <CustomRules
            rules={config.customRules || []}
            onAdd={addCustomRule}
            onDelete={(id: string) => deleteRule('custom', id)}
            showAdd={showAddRule}
            onShowAdd={() => setShowAddRule(true)}
            onHideAdd={() => setShowAddRule(false)}
          />
        )}
        {activeTab === 'reports' && (
          <ScheduledReports
            reports={config.scheduledReports || []}
            onAdd={addScheduledReport}
            onDelete={(id: string) => deleteRule('report', id)}
            apiUrl={apiUrl}
            showAdd={showAddRule}
            onShowAdd={() => setShowAddRule(true)}
            onHideAdd={() => setShowAddRule(false)}
          />
        )}
        {activeTab === 'webhooks' && (
          <>
            <WebhookSettings config={config} onSave={saveConfig} saving={saving} />
            <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="font-medium text-gray-900 mb-2">🔗 How to Configure Webhooks:</div>
              <div className="text-sm text-gray-700 space-y-3">
                <div>
                  <strong>GitHub Webhook Setup:</strong>
                  <ol className="list-decimal list-inside ml-4 mt-1 space-y-1">
                    <li>Go to your GitHub repository → Settings → Webhooks</li>
                    <li>Click &quot;Add webhook&quot;</li>
                    <li>Payload URL: <code className="bg-gray-100 px-1 rounded">{typeof window !== 'undefined' ? window.location.origin.replace(':3000', ':8000') : 'http://localhost:8000'}/api/webhooks/github</code></li>
                    <li>Content type: <code className="bg-gray-100 px-1 rounded">application/json</code></li>
                    <li>Events: Select &quot;Pull requests&quot;</li>
                    <li>Click &quot;Add webhook&quot;</li>
                  </ol>
                </div>
                <div>
                  <strong>Jira Webhook Setup:</strong>
                  <ol className="list-decimal list-inside ml-4 mt-1 space-y-1">
                    <li>Go to Jira → Settings → System → Webhooks</li>
                    <li>Click &quot;Create a webhook&quot;</li>
                    <li>Name: &quot;QA Dashboard Automation&quot;</li>
                    <li>URL: <code className="bg-gray-100 px-1 rounded">{typeof window !== 'undefined' ? window.location.origin.replace(':3000', ':8000') : 'http://localhost:8000'}/api/webhooks/jira</code></li>
                    <li>Events: Select &quot;Issue created&quot; and &quot;Issue updated&quot;</li>
                    <li>Click &quot;Create&quot;</li>
                  </ol>
                </div>
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
                  <strong>⚠️ Note:</strong> For production, use HTTPS URLs and configure webhook secrets for security.
                </div>
              </div>
            </div>
          </>
        )}
        {activeTab === 'blockers' && (
          <>
            <BlockerDetection config={config} onSave={saveConfig} saving={saving} />
            <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="font-medium text-gray-900 mb-2">🚨 How Blocker Detection Works:</div>
              <div className="text-sm text-gray-700 space-y-2">
                <p>• The system scans PR descriptions and Jira issue descriptions for blocking keywords</p>
                <p>• When a blocker is detected, notifications are sent to all configured channels</p>
                <p>• <strong>Default keywords:</strong> blocked, blocker, blocking, cannot proceed, stuck</p>
                <p>• You can add custom keywords specific to your team&apos;s terminology</p>
                <p>• <strong>Example:</strong> If a PR description contains &quot;This PR is blocked by API changes&quot;, a notification will be sent</p>
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                  <strong>💡 Tip:</strong> Add team-specific terms like &quot;dependency issue&quot;, &quot;needs approval&quot;, or &quot;waiting on&quot; to catch more blockers.
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// General Settings Component
function GeneralSettings({ config, onSave, saving }: { config: AutomationConfig; onSave: (updates: Partial<AutomationConfig>) => Promise<void>; saving: boolean }) {
  const [localConfig, setLocalConfig] = useState(config)

  useEffect(() => {
    setLocalConfig(config)
  }, [config])

  const handleToggle = (key: keyof AutomationConfig) => {
    const updates = { [key]: !localConfig[key] }
    setLocalConfig({ ...localConfig, ...updates })
    onSave(updates)
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">General Automation Settings</h3>
        <div className="space-y-4">
          <ToggleSetting
            label="Enable Automation"
            description="Master switch for all automation features"
            enabled={localConfig.enabled}
            onToggle={() => handleToggle('enabled')}
          />
          <ToggleSetting
            label="Auto-link PR to Jira"
            description="Automatically link PRs to Jira issues based on issue keys in PR title/description"
            enabled={localConfig.autoLinkPRToJira}
            onToggle={() => handleToggle('autoLinkPRToJira')}
          />
          <ToggleSetting
            label="Auto-assign PRs"
            description="Automatically assign PRs based on configured rules"
            enabled={localConfig.autoAssign}
            onToggle={() => handleToggle('autoAssign')}
          />
          <ToggleSetting
            label="Status Sync"
            description="Automatically sync PR merge status to Jira (PR merged → Jira Done)"
            enabled={localConfig.statusSync}
            onToggle={() => handleToggle('statusSync')}
          />
        </div>
      </div>
    </div>
  )
}

// Toggle Setting Component
function ToggleSetting({ label, description, enabled, onToggle }: { label: string; description: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
      <div className="flex-1">
        <div className="font-medium text-gray-900">{label}</div>
        <div className="text-sm text-gray-500 mt-1">{description}</div>
      </div>
      <button
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          enabled ? 'bg-blue-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

// Auto-Assign Rules Component
function AutoAssignRules({ rules, onAdd, onDelete, showAdd, onShowAdd, onHideAdd }: any) {
  const [newRule, setNewRule] = useState({
    name: '',
    enabled: true,
    repository: '',
    label: '',
    author: '',
    titlePattern: '',
    assignTo: ''
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onAdd(newRule)
    setNewRule({
      name: '',
      enabled: true,
      repository: '',
      label: '',
      author: '',
      titlePattern: '',
      assignTo: ''
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">Auto-Assignment Rules</h3>
        <button
          onClick={onShowAdd}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Save Rule
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleSubmit} className="p-4 border border-gray-200 rounded-lg space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name</label>
              <input
                type="text"
                value={newRule.name}
                onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assign To</label>
              <input
                type="text"
                value={newRule.assignTo}
                onChange={(e) => setNewRule({ ...newRule, assignTo: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="username"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Repository (optional)</label>
              <input
                type="text"
                value={newRule.repository}
                onChange={(e) => setNewRule({ ...newRule, repository: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="repo-name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label (optional)</label>
              <input
                type="text"
                value={newRule.label}
                onChange={(e) => setNewRule({ ...newRule, label: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="bug"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Author (optional)</label>
              <input
                type="text"
                value={newRule.author}
                onChange={(e) => setNewRule({ ...newRule, author: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title Pattern (optional)</label>
              <input
                type="text"
                value={newRule.titlePattern}
                onChange={(e) => setNewRule({ ...newRule, titlePattern: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="regex pattern"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Save Rule
            </button>
            <button
              type="button"
              onClick={onHideAdd}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {rules.map((rule: any) => (
          <div key={rule.id} className="p-4 border border-gray-200 rounded-lg flex items-center justify-between">
            <div className="flex-1">
              <div className="font-medium text-gray-900">{rule.name}</div>
              <div className="text-sm text-gray-500 mt-1">
                Assign to: {rule.assignTo}
                {rule.repository && ` | Repo: ${rule.repository}`}
                {rule.label && ` | Label: ${rule.label}`}
                {rule.author && ` | Author: ${rule.author}`}
                {rule.titlePattern && ` | Pattern: ${rule.titlePattern}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 text-xs rounded-full ${rule.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                {rule.enabled ? 'Enabled' : 'Disabled'}
              </span>
              <button
                onClick={() => onDelete(rule.id)}
                className="p-2 text-red-600 hover:bg-red-50 rounded"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {rules.length === 0 && (
          <div className="text-center py-8 text-gray-500">No auto-assignment rules configured</div>
        )}
      </div>
    </div>
  )
}

// Status-Based Assign Rules Component
function StatusBasedAssignRules({ rules, onAdd, onDelete, showAdd, onShowAdd, onHideAdd }: any) {
  const [newRule, setNewRule] = useState({
    name: '',
    enabled: true,
    status: '',
    assignTo: '',
    label: '',
    projectKey: ''
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onAdd(newRule)
    setNewRule({
      name: '',
      enabled: true,
      status: '',
      assignTo: '',
      label: '',
      projectKey: ''
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">Status-Based Assignment Rules</h3>
        <button
          onClick={onShowAdd}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Save Rule
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleSubmit} className="p-4 border border-gray-200 rounded-lg space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name</label>
              <input
                type="text"
                value={newRule.name}
                onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
              <input
                type="text"
                value={newRule.status}
                onChange={(e) => setNewRule({ ...newRule, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="QA"
                required
              />
              <p className="text-xs text-gray-500 mt-1">Jira status that triggers assignment</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assign To (Email) *</label>
              <input
                type="email"
                value={newRule.assignTo}
                onChange={(e) => setNewRule({ ...newRule, assignTo: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="user@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Project Key (optional)</label>
              <input
                type="text"
                value={newRule.projectKey}
                onChange={(e) => setNewRule({ ...newRule, projectKey: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="PROJ"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label (optional)</label>
              <input
                type="text"
                value={newRule.label}
                onChange={(e) => setNewRule({ ...newRule, label: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="bug"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Save Rule
            </button>
            <button
              type="button"
              onClick={onHideAdd}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {rules.map((rule: any) => (
          <div key={rule.id} className="p-4 border border-gray-200 rounded-lg flex items-center justify-between">
            <div className="flex-1">
              <div className="font-medium text-gray-900">{rule.name}</div>
              <div className="text-sm text-gray-500 mt-1">
                When status = <span className="font-semibold">{rule.status}</span> → Assign to: <span className="font-semibold">{rule.assignTo}</span>
                {rule.projectKey && ` | Project: ${rule.projectKey}`}
                {rule.label && ` | Label: ${rule.label}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 text-xs rounded-full ${rule.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                {rule.enabled ? 'Enabled' : 'Disabled'}
              </span>
              <button
                onClick={() => onDelete(rule.id)}
                className="p-2 text-red-600 hover:bg-red-50 rounded"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {rules.length === 0 && (
          <div className="text-center py-8 text-gray-500">No status-based assignment rules configured</div>
        )}
      </div>
      <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <div className="font-medium text-gray-900 mb-2">📝 How It Works:</div>
        <div className="text-sm text-gray-700 space-y-2">
          <p>• When a Jira issue status changes to the specified status, it will automatically assign to the specified user</p>
          <p>• <strong>Example:</strong> Status = &quot;QA&quot; → Automatically assigns to &quot;amit.nigam@coredge.io&quot;</p>
          <p>• Works with Jira webhooks (configure webhook in the Webhooks tab)</p>
          <p>• Optional filters: Project Key and Label can narrow down which issues get assigned</p>
        </div>
      </div>
    </div>
  )
}

// Custom Rules Component
function CustomRules({ rules, onAdd, onDelete, showAdd, onShowAdd, onHideAdd }: any) {
  const [newRule, setNewRule] = useState({
    name: '',
    enabled: true,
    eventType: 'pr_created',
    conditions: [{ field: 'repo', operator: 'equals', value: '' }],
    actions: [{ type: 'assign', value: '' }]
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onAdd(newRule)
    setNewRule({
      name: '',
      enabled: true,
      eventType: 'pr_created',
      conditions: [{ field: 'repo', operator: 'equals', value: '' }],
      actions: [{ type: 'assign', value: '' }]
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">Custom Automation Rules</h3>
        <button
          onClick={onShowAdd}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Save Rule
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleSubmit} className="p-4 border border-gray-200 rounded-lg space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name</label>
              <input
                type="text"
                value={newRule.name}
                onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
              <select
                value={newRule.eventType}
                onChange={(e) => setNewRule({ ...newRule, eventType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="pr_created">PR Created</option>
                <option value="pr_updated">PR Updated</option>
                <option value="pr_merged">PR Merged</option>
                <option value="manual_trigger">Manual Trigger</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newRule.actions[0].type}
                onChange={(e) => setNewRule({
                  ...newRule,
                  actions: [{ ...newRule.actions[0], type: e.target.value }]
                })}
                className="px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="assign">Assign</option>
                <option value="add_label">Add Label</option>
                <option value="update_jira_status">Update Jira Status</option>
                <option value="notify">Notify</option>
              </select>
              <input
                type="text"
                value={newRule.actions[0].value}
                onChange={(e) => setNewRule({
                  ...newRule,
                  actions: [{ ...newRule.actions[0], value: e.target.value }]
                })}
                className="px-3 py-2 border border-gray-300 rounded-md"
                placeholder="value"
                required
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Save Rule
            </button>
            <button
              type="button"
              onClick={onHideAdd}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {rules.map((rule: any) => (
          <div key={rule.id} className="p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="font-medium text-gray-900">{rule.name}</div>
                <div className="text-sm text-gray-500 mt-1">
                  Event: {rule.eventType || 'Any'} | Actions: {rule.actions?.map((a: any) => `${a.type}(${a.value})`).join(', ')}
                </div>
              </div>
              <button
                onClick={() => onDelete(rule.id)}
                className="p-2 text-red-600 hover:bg-red-50 rounded"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {rules.length === 0 && (
          <div className="text-center py-8 text-gray-500">No custom rules configured</div>
        )}
      </div>
    </div>
  )
}

// Scheduled Reports Component
function ScheduledReports({ reports, onAdd, onDelete, apiUrl, showAdd, onShowAdd, onHideAdd }: any) {
  const [newReport, setNewReport] = useState({
    name: '',
    enabled: true,
    type: 'pr',
    schedule: 'daily',
    filters: {},
    recipients: [{ email: '' }],
    format: 'json'
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onAdd(newReport)
    setNewReport({
      name: '',
      enabled: true,
      type: 'pr',
      schedule: 'daily',
      filters: {},
      recipients: [{ email: '' }],
      format: 'json'
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">Scheduled Reports</h3>
        <button
          onClick={onShowAdd}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Add Report
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleSubmit} className="p-4 border border-gray-200 rounded-lg space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Report Name</label>
              <input
                type="text"
                value={newReport.name}
                onChange={(e) => setNewReport({ ...newReport, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={newReport.type}
                onChange={(e) => setNewReport({ ...newReport, type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="pr">Pull Requests</option>
                <option value="jira">Jira Issues</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Schedule</label>
              <select
                value={newReport.schedule}
                onChange={(e) => setNewReport({ ...newReport, schedule: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Format</label>
              <select
                value={newReport.format}
                onChange={(e) => setNewReport({ ...newReport, format: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
                <option value="excel">Excel</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Recipients (email)</label>
              <input
                type="email"
                value={newReport.recipients[0].email}
                onChange={(e) => setNewReport({
                  ...newReport,
                  recipients: [{ email: e.target.value }]
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="email@example.com"
                required
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Add Report
            </button>
            <button
              type="button"
              onClick={onHideAdd}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {reports.map((report: any) => (
          <div key={report.id} className="p-4 border border-gray-200 rounded-lg flex items-center justify-between">
            <div className="flex-1">
              <div className="font-medium text-gray-900">{report.name}</div>
              <div className="text-sm text-gray-500 mt-1">
                Type: {report.type} | Schedule: {report.schedule} | Format: {report.format}
              </div>
            </div>
            <button
              onClick={() => onDelete(report.id)}
              className="p-2 text-red-600 hover:bg-red-50 rounded"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {reports.length === 0 && (
          <div className="text-center py-8 text-gray-500">No scheduled reports configured</div>
        )}
      </div>
    </div>
  )
}

// Webhook Settings Component
function WebhookSettings({ config, onSave, saving }: { config: AutomationConfig; onSave: (updates: Partial<AutomationConfig>) => Promise<void>; saving: boolean }) {
  const [webhookUrl, setWebhookUrl] = useState({
    github: '',
    jira: ''
  })

  const webhookBaseUrl = typeof window !== 'undefined' ? `${window.location.origin.replace(':3000', ':8000')}/api/webhooks` : 'http://localhost:8000/api/webhooks'

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Webhook Configuration</h3>
        <div className="space-y-4">
          <div className="p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="font-medium text-gray-900">GitHub Webhook</div>
                <div className="text-sm text-gray-500 mt-1">
                  Webhook URL: <code className="bg-gray-100 px-2 py-1 rounded">{webhookBaseUrl}/github</code>
                </div>
              </div>
              <button
                onClick={() => onSave({
                  webhooks: {
                    ...config.webhooks,
                    github: { ...config.webhooks.github, enabled: !config.webhooks.github.enabled }
                  }
                })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  config.webhooks.github.enabled ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    config.webhooks.github.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
          <div className="p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="font-medium text-gray-900">Jira Webhook</div>
                <div className="text-sm text-gray-500 mt-1">
                  Webhook URL: <code className="bg-gray-100 px-2 py-1 rounded">{webhookBaseUrl}/jira</code>
                </div>
              </div>
              <button
                onClick={() => onSave({
                  webhooks: {
                    ...config.webhooks,
                    jira: { ...config.webhooks.jira, enabled: !config.webhooks.jira.enabled }
                  }
                })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  config.webhooks.jira.enabled ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    config.webhooks.jira.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Blocker Detection Component
function BlockerDetection({ config, onSave, saving }: { config: AutomationConfig; onSave: (updates: Partial<AutomationConfig>) => Promise<void>; saving: boolean }) {
  const [keyword, setKeyword] = useState('')
  const [notificationChannel, setNotificationChannel] = useState({ type: 'slack', webhookUrl: '', enabled: true })

  const handleAddKeyword = () => {
    if (keyword.trim()) {
      const keywords = [...(config.blockerDetection.keywords || []), keyword.trim()]
      onSave({
        blockerDetection: {
          ...config.blockerDetection,
          keywords
        }
      })
      setKeyword('')
    }
  }

  const handleRemoveKeyword = (keywordToRemove: string) => {
    const keywords = (config.blockerDetection.keywords || []).filter(k => k !== keywordToRemove)
    onSave({
      blockerDetection: {
        ...config.blockerDetection,
        keywords
      }
    })
  }

  const handleAddNotificationChannel = () => {
    if (notificationChannel.webhookUrl.trim()) {
      // Create channel object matching the expected type
      const newChannel: { type: 'slack' | 'teams' | 'email'; enabled: boolean; webhookUrl?: string; email?: string } = {
        type: notificationChannel.type as 'slack' | 'teams' | 'email',
        enabled: notificationChannel.enabled
      }
      if (notificationChannel.webhookUrl) {
        newChannel.webhookUrl = notificationChannel.webhookUrl
      }
      const channels = [...(config.blockerDetection.notificationChannels || []), newChannel]
      onSave({
        blockerDetection: {
          ...config.blockerDetection,
          notificationChannels: channels
        }
      })
      setNotificationChannel({ type: 'slack', webhookUrl: '', enabled: true })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Blocker Detection Settings</h3>
        <div className="space-y-4">
          <ToggleSetting
            label="Enable Blocker Detection"
            description="Automatically detect blockers in PR and Jira issue descriptions"
            enabled={config.blockerDetection.enabled}
            onToggle={() => onSave({
              blockerDetection: {
                ...config.blockerDetection,
                enabled: !config.blockerDetection.enabled
              }
            })}
          />
          
          <div className="p-4 border border-gray-200 rounded-lg">
            <div className="font-medium text-gray-900 mb-2">Blocking Keywords</div>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddKeyword()}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Enter keyword (e.g., blocked, blocker)"
              />
              <button
                onClick={handleAddKeyword}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {(config.blockerDetection.keywords || []).map((kw, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm flex items-center gap-2"
                >
                  {kw}
                  <button
                    onClick={() => handleRemoveKeyword(kw)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="p-4 border border-gray-200 rounded-lg">
            <div className="font-medium text-gray-900 mb-2">Notification Channels</div>
            <div className="space-y-2 mb-2">
              <select
                value={notificationChannel.type}
                onChange={(e) => setNotificationChannel({ ...notificationChannel, type: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="slack">Slack</option>
                <option value="teams">Microsoft Teams</option>
                <option value="email">Email</option>
              </select>
              <input
                type="text"
                value={notificationChannel.webhookUrl}
                onChange={(e) => setNotificationChannel({ ...notificationChannel, webhookUrl: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Webhook URL"
              />
            </div>
            <button
              onClick={handleAddNotificationChannel}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Add Channel
            </button>
            <div className="mt-4 space-y-2">
              {(config.blockerDetection.notificationChannels || []).map((channel: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                  <div className="text-sm">
                    <span className="font-medium">{channel.type}</span>
                    {channel.webhookUrl && <span className="text-gray-500 ml-2">{channel.webhookUrl.substring(0, 50)}...</span>}
                  </div>
                  <button
                    onClick={() => {
                      const channels = (config.blockerDetection.notificationChannels || []).filter((_: any, i: number) => i !== idx)
                      onSave({
                        blockerDetection: {
                          ...config.blockerDetection,
                          notificationChannels: channels
                        }
                      })
                    }}
                    className="text-red-600 hover:text-red-800"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}



// Help Documentation Function
function getHelpDocumentation() {
  const webhookBaseUrl = typeof window !== 'undefined' ? window.location.origin.replace(':3000', ':8000') : 'http://localhost:8000'
  return `<!DOCTYPE html><html><head><title>Automation Documentation</title><style>body{font-family:system-ui;padding:40px;max-width:900px;margin:0 auto;line-height:1.6}h1{color:#2563eb;border-bottom:2px solid #2563eb;padding-bottom:10px}h2{color:#1e40af;margin-top:30px}code{background:#f3f4f6;padding:2px 6px;border-radius:3px;font-family:monospace}.example{background:#eff6ff;border-left:4px solid #3b82f6;padding:15px;margin:15px 0}</style></head><body><h1>🚀 Automation & Workflows Guide</h1><h2>Features</h2><ul><li><strong>Auto-link PR to Jira:</strong> Links PRs when titles contain issue keys (e.g., PROJ-123)</li><li><strong>Auto-assign:</strong> Assign PRs by repo, label, author, or title pattern</li><li><strong>Status Sync:</strong> PR merged → Jira Done automatically</li><li><strong>Blocker Detection:</strong> Detects blockers and sends notifications</li></ul><h2>Webhook URLs</h2><div class="example"><strong>GitHub:</strong> <code>${webhookBaseUrl}/api/webhooks/github</code><br><strong>Jira:</strong> <code>${webhookBaseUrl}/api/webhooks/jira</code></div><h2>Examples</h2><div class="example"><strong>Auto-assign frontend PRs:</strong><br>Repository: frontend | Assign To: frontend-team</div><div class="example"><strong>Auto-assign security PRs:</strong><br>Label: security | Assign To: security-team</div></body></html>`
}

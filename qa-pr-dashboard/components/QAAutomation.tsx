'use client'

import { useState, useEffect } from 'react'
import { 
  Play, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  TrendingUp, 
  FileText, 
  Settings, 
  RefreshCw,
  Filter,
  Download,
  Link as LinkIcon,
  GitBranch,
  Calendar,
  BarChart3,
  TestTube,
  Zap,
  AlertCircle,
  PlayCircle,
  PauseCircle,
  Square
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

interface TestRun {
  id: string
  name: string
  status: 'running' | 'passed' | 'failed' | 'skipped' | 'cancelled'
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  duration: number
  startedAt: string
  completedAt?: string
  triggeredBy: string
  environment: string
  framework: 'playwright' | 'selenium' | 'cypress' | 'jest'
  linkedPR?: string
  linkedJira?: string
  reportUrl?: string
  videoUrl?: string
  traceUrl?: string
}

interface TestStats {
  totalRuns: number
  passedRuns: number
  failedRuns: number
  skippedRuns: number
  averageDuration: number
  passRate: number
  totalTests: number
  flakyTests: number
  lastRunAt?: string
}

interface QAAutomationProps {
  apiUrl?: string
}

export default function QAAutomation({ apiUrl = 'http://localhost:8000/api' }: QAAutomationProps) {
  const { hasRole } = useAuth()
  const [activeTab, setActiveTab] = useState<'dashboard' | 'test-runs' | 'test-management' | 'settings'>('dashboard')
  const [testRuns, setTestRuns] = useState<TestRun[]>([])
  const [stats, setStats] = useState<TestStats>({
    totalRuns: 0,
    passedRuns: 0,
    failedRuns: 0,
    skippedRuns: 0,
    averageDuration: 0,
    passRate: 0,
    totalTests: 0,
    flakyTests: 0,
  })
  const [loading, setLoading] = useState(true)
  const [runningTests, setRunningTests] = useState<Set<string>>(new Set())
  const [filterStatus, setFilterStatus] = useState<'all' | 'passed' | 'failed' | 'running'>('all')
  const [filterFramework, setFilterFramework] = useState<'all' | 'playwright' | 'selenium' | 'cypress' | 'jest'>('all')

  useEffect(() => {
    loadTestRuns()
    loadStats()
    // Poll for running tests
    const interval = setInterval(() => {
      if (runningTests.size > 0) {
        loadTestRuns()
      }
    }, 5000) // Poll every 5 seconds if tests are running
    return () => clearInterval(interval)
  }, [runningTests.size])

  const loadTestRuns = async () => {
    try {
      setLoading(true)
      const response = await fetch(`${apiUrl}/qa/test-runs`)
      if (response.ok) {
        const data = await response.json()
        setTestRuns(data.testRuns || [])
        // Update running tests set
        const running = new Set<string>()
        data.testRuns?.forEach((run: TestRun) => {
          if (run.status === 'running') {
            running.add(run.id)
          }
        })
        setRunningTests(running)
      }
    } catch (error) {
      console.error('Error loading test runs:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      const response = await fetch(`${apiUrl}/qa/stats`)
      if (response.ok) {
        const data = await response.json()
        setStats(data.stats || stats)
      }
    } catch (error) {
      console.error('Error loading stats:', error)
    }
  }

  const triggerTestRun = async (testSuite: string, environment: string, framework: string = 'playwright') => {
    try {
      const response = await fetch(`${apiUrl}/qa/test-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testSuite,
          environment,
          framework,
        }),
      })
      if (response.ok) {
        const data = await response.json()
        setRunningTests(prev => new Set([...prev, data.testRun.id]))
        await loadTestRuns()
        await loadStats()
      }
    } catch (error) {
      console.error('Error triggering test run:', error)
      alert('Failed to trigger test run: ' + (error as Error).message)
    }
  }

  const cancelTestRun = async (runId: string) => {
    try {
      const response = await fetch(`${apiUrl}/qa/test-runs/${runId}/cancel`, {
        method: 'POST',
      })
      if (response.ok) {
        setRunningTests(prev => {
          const next = new Set(prev)
          next.delete(runId)
          return next
        })
        await loadTestRuns()
      }
    } catch (error) {
      console.error('Error cancelling test run:', error)
    }
  }

  const filteredRuns = testRuns.filter(run => {
    if (filterStatus !== 'all' && run.status !== filterStatus) return false
    if (filterFramework !== 'all' && run.framework !== filterFramework) return false
    return true
  })

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <TestTube className="w-8 h-8 text-blue-600" />
              QA Automation
            </h2>
            <p className="text-sm text-gray-600 mt-1">Manage test execution, track results, and monitor test coverage</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                loadTestRuns()
                loadStats()
              }}
              className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 rounded-md hover:bg-gray-50 border border-gray-300"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex -mb-px">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
            { id: 'test-runs', label: 'Test Runs', icon: PlayCircle },
            { id: 'test-management', label: 'Test Management', icon: FileText },
            { id: 'settings', label: 'Settings', icon: Settings },
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
        {activeTab === 'dashboard' && (
          <DashboardView 
            stats={stats} 
            testRuns={testRuns.slice(0, 10)} 
            onTriggerTest={triggerTestRun}
            hasRole={hasRole}
          />
        )}
        {activeTab === 'test-runs' && (
          <TestRunsView
            testRuns={filteredRuns}
            loading={loading}
            filterStatus={filterStatus}
            filterFramework={filterFramework}
            onFilterStatusChange={(status) => setFilterStatus(status as 'all' | 'passed' | 'failed' | 'running')}
            onFilterFrameworkChange={(framework) => setFilterFramework(framework as 'all' | 'playwright' | 'selenium' | 'cypress' | 'jest')}
            onCancel={cancelTestRun}
            runningTests={runningTests}
            apiUrl={apiUrl}
          />
        )}
        {activeTab === 'test-management' && (
          <TestManagementView apiUrl={apiUrl} />
        )}
        {activeTab === 'settings' && (
          <QASettingsView apiUrl={apiUrl} hasRole={hasRole} />
        )}
      </div>
    </div>
  )
}

// Dashboard View Component
function DashboardView({ 
  stats, 
  testRuns, 
  onTriggerTest,
  hasRole 
}: { 
  stats: TestStats
  testRuns: TestRun[]
  onTriggerTest: (suite: string, env: string, framework: string) => void
  hasRole: (role: string) => boolean
}) {
  const [showTriggerModal, setShowTriggerModal] = useState(false)
  const [testSuite, setTestSuite] = useState('')
  const [environment, setEnvironment] = useState('staging')
  const [framework, setFramework] = useState('playwright')

  const handleTrigger = () => {
    if (testSuite) {
      onTriggerTest(testSuite, environment, framework)
      setShowTriggerModal(false)
      setTestSuite('')
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Test Runs"
          value={stats.totalRuns}
          icon={BarChart3}
          color="blue"
        />
        <StatCard
          title="Pass Rate"
          value={`${stats.passRate.toFixed(1)}%`}
          icon={TrendingUp}
          color="green"
        />
        <StatCard
          title="Total Tests"
          value={stats.totalTests}
          icon={TestTube}
          color="purple"
        />
        <StatCard
          title="Flaky Tests"
          value={stats.flakyTests}
          icon={AlertCircle}
          color="orange"
        />
      </div>

      {/* Quick Actions */}
      {hasRole('admin') || hasRole('manager') ? (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6 border border-blue-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setShowTriggerModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              <Play className="w-4 h-4" />
              Trigger Test Run
            </button>
            <button
              onClick={() => onTriggerTest('all', 'staging', 'playwright')}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              <Zap className="w-4 h-4" />
              Run All Tests (Staging)
            </button>
          </div>
        </div>
      ) : null}

      {/* Recent Test Runs */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Test Runs</h3>
        <div className="space-y-2">
          {testRuns.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No test runs yet</div>
          ) : (
            testRuns.map((run) => (
              <TestRunCard key={run.id} run={run} />
            ))
          )}
        </div>
      </div>

      {/* Trigger Modal */}
      {showTriggerModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Trigger Test Run</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Test Suite</label>
                <input
                  type="text"
                  value={testSuite}
                  onChange={(e) => setTestSuite(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="e.g., tests/vm.spec.ts"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Environment</label>
                <select
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                  <option value="development">Development</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Framework</label>
                <select
                  value={framework}
                  onChange={(e) => setFramework(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="playwright">Playwright</option>
                  <option value="selenium">Selenium</option>
                  <option value="cypress">Cypress</option>
                  <option value="jest">Jest</option>
                </select>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleTrigger}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Trigger
                </button>
                <button
                  onClick={() => setShowTriggerModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Stat Card Component
function StatCard({ title, value, icon: Icon, color }: { title: string; value: string | number; icon: any; color: string }) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600',
    orange: 'bg-orange-100 text-orange-600',
  }
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`p-3 rounded-lg ${colorClasses[color as keyof typeof colorClasses]}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  )
}

// Test Run Card Component
function TestRunCard({ run }: { run: TestRun }) {
  const statusColors = {
    running: 'bg-blue-100 text-blue-800',
    passed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    skipped: 'bg-gray-100 text-gray-800',
    cancelled: 'bg-yellow-100 text-yellow-800',
  }
  const statusIcons = {
    running: Clock,
    passed: CheckCircle2,
    failed: XCircle,
    skipped: Clock,
    cancelled: XCircle,
  }
  const StatusIcon = statusIcons[run.status]

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <StatusIcon className={`w-5 h-5 ${statusColors[run.status].split(' ')[1]}`} />
            <div>
              <h4 className="font-medium text-gray-900">{run.name}</h4>
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                <span>{run.framework}</span>
                <span>•</span>
                <span>{run.environment}</span>
                <span>•</span>
                <span>{run.duration}s</span>
                {run.linkedPR && (
                  <>
                    <span>•</span>
                    <a href={run.linkedPR} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                      <GitBranch className="w-3 h-3" />
                      PR
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-sm font-medium text-gray-900">
              {run.passedTests}/{run.totalTests} passed
            </div>
            {run.failedTests > 0 && (
              <div className="text-sm text-red-600">{run.failedTests} failed</div>
            )}
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[run.status]}`}>
            {run.status}
          </span>
        </div>
      </div>
    </div>
  )
}

// Test Runs View Component
function TestRunsView({
  testRuns,
  loading,
  filterStatus,
  filterFramework,
  onFilterStatusChange,
  onFilterFrameworkChange,
  onCancel,
  runningTests,
  apiUrl,
}: {
  testRuns: TestRun[]
  loading: boolean
  filterStatus: string
  filterFramework: string
  onFilterStatusChange: (status: string) => void
  onFilterFrameworkChange: (framework: string) => void
  onCancel: (id: string) => void
  runningTests: Set<string>
  apiUrl: string
}) {
  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-lg">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filters:</span>
        </div>
        <select
          value={filterStatus}
          onChange={(e) => onFilterStatusChange(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="all">All Status</option>
          <option value="running">Running</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={filterFramework}
          onChange={(e) => onFilterFrameworkChange(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="all">All Frameworks</option>
          <option value="playwright">Playwright</option>
          <option value="selenium">Selenium</option>
          <option value="cypress">Cypress</option>
          <option value="jest">Jest</option>
        </select>
      </div>

      {/* Test Runs Table */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading test runs...</div>
      ) : testRuns.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No test runs found</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Test Run</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Results</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Started</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {testRuns.map((run) => (
                <tr key={run.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{run.name}</div>
                      <div className="text-sm text-gray-500">{run.framework} • {run.environment}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      run.status === 'passed' ? 'bg-green-100 text-green-800' :
                      run.status === 'failed' ? 'bg-red-100 text-red-800' :
                      run.status === 'running' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="flex items-center gap-2">
                      <span className="text-green-600">{run.passedTests} passed</span>
                      {run.failedTests > 0 && <span className="text-red-600">{run.failedTests} failed</span>}
                      {run.skippedTests > 0 && <span className="text-gray-600">{run.skippedTests} skipped</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {run.duration}s
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(run.startedAt).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex items-center gap-2">
                      {run.status === 'running' && (
                        <button
                          onClick={() => onCancel(run.id)}
                          className="text-red-600 hover:text-red-900"
                          title="Cancel test run"
                        >
                          <Square className="w-4 h-4" />
                        </button>
                      )}
                      {run.reportUrl && (
                        <a
                          href={run.reportUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-900"
                          title="View report"
                        >
                          <FileText className="w-4 h-4" />
                        </a>
                      )}
                      {run.videoUrl && (
                        <a
                          href={run.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-600 hover:text-purple-900"
                          title="View video"
                        >
                          <PlayCircle className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Test Management View Component
function TestManagementView({ apiUrl }: { apiUrl: string }) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">Test Management</h3>
        <p className="text-sm text-blue-700">
          Organize and manage your test cases, test suites, and test configurations.
        </p>
      </div>
      <div className="text-center py-8 text-gray-500">
        Test Management features coming soon...
      </div>
    </div>
  )
}

// QA Settings View Component
function QASettingsView({ apiUrl, hasRole }: { apiUrl: string; hasRole: (role: string) => boolean }) {
  if (!hasRole('admin')) {
    return (
      <div className="text-center py-8 text-gray-500">
        You need admin privileges to access QA Settings.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">QA Automation Settings</h3>
        <p className="text-sm text-blue-700">
          Configure test frameworks, environments, and automation settings.
        </p>
      </div>
      <div className="text-center py-8 text-gray-500">
        Settings configuration coming soon...
      </div>
    </div>
  )
}


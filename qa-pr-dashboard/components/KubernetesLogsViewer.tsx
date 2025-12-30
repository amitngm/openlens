'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  FileText, 
  RefreshCw, 
  Search, 
  Filter, 
  Clock, 
  Server, 
  AlertCircle,
  CheckCircle,
  XCircle,
  Info,
  Download,
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
  ChevronRight
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

interface LogEntry {
  timestamp: string
  podName: string
  serviceName: string
  namespace: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  raw: string
}

interface ServiceLogs {
  serviceName: string
  pods: Array<{
    podName: string
    logs: LogEntry[]
  }>
  totalLogs: number
  errorCount: number
  warningCount: number
}

interface KubernetesLogsViewerProps {
  apiUrl: string
  namespace: string
  autoRefresh?: boolean
}

export default function KubernetesLogsViewer({ 
  apiUrl, 
  namespace,
  autoRefresh = false 
}: KubernetesLogsViewerProps) {
  const { token } = useAuth()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [serviceLogs, setServiceLogs] = useState<Map<string, ServiceLogs>>(new Map())
  const [pods, setPods] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterLevel, setFilterLevel] = useState<'all' | 'info' | 'warn' | 'error' | 'debug'>('all')
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(autoRefresh)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [collapsedServices, setCollapsedServices] = useState<Set<string>>(new Set())
  const [servicesSectionCollapsed, setServicesSectionCollapsed] = useState(false)
  const [logsSectionCollapsed, setLogsSectionCollapsed] = useState(false)

  // Fetch pods in the namespace
  const fetchPods = useCallback(async () => {
    if (!token || !namespace || namespace === 'all') return []

    try {
      const response = await fetch(`${apiUrl}/k8s/pods/${namespace}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        return data.pods || []
      }
      return []
    } catch (err) {
      console.error('Error fetching pods:', err)
      return []
    }
  }, [apiUrl, token, namespace])

  // Fetch logs for a specific pod
  const fetchPodLogs = useCallback(async (podName: string, namespace: string, containers?: string[]) => {
    if (!token) return []

    try {
      // If containers are specified, try each one; otherwise try without container parameter
      const containersToTry = containers && containers.length > 0 ? containers : [undefined]
      let allLogLines: string[] = []

      for (const container of containersToTry) {
        try {
          const containerParam = container ? `&container=${encodeURIComponent(container)}` : ''
          // Fetch all logs (pod lifetime) - tailLines=all means all logs
          const response = await fetch(`${apiUrl}/k8s/pods/${namespace}/${podName}/logs?tailLines=all${containerParam}`, {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          })

          if (response.ok) {
            const data = await response.json()
            // API returns logs as a string, split by newlines
            let logLines: string[] = []
            if (data.logs && typeof data.logs === 'string') {
              logLines = data.logs.split('\n').filter((line: string) => line.trim())
            } else if (typeof data === 'string') {
              logLines = data.split('\n').filter((line: string) => line.trim())
            } else if (Array.isArray(data.logs)) {
              logLines = data.logs.filter((line: any) => line && String(line).trim())
            } else if (Array.isArray(data)) {
              logLines = data.filter((line: any) => line && String(line).trim())
            }
            
            if (logLines.length > 0) {
              allLogLines = allLogLines.concat(logLines)
            }
          } else {
            // Log non-OK responses for debugging
            const errorText = await response.text().catch(() => '')
            console.warn(`Failed to fetch logs for pod ${podName}${container ? ` container ${container}` : ''}: ${response.status} ${response.statusText}`, errorText.substring(0, 200))
          }
        } catch (containerErr) {
          console.warn(`Error fetching logs for pod ${podName}${container ? ` container ${container}` : ''}:`, containerErr)
        }
      }

      return allLogLines
    } catch (err) {
      console.error(`Error fetching logs for pod ${podName}:`, err)
      return []
    }
  }, [apiUrl, token])

  // Extract service name from pod labels or name
  const extractServiceName = (pod: any): string => {
    // Try to get service name from labels
    if (pod.labels) {
      // Common label patterns for service names
      const serviceLabel = pod.labels['app.kubernetes.io/name'] || 
                          pod.labels.app || 
                          pod.labels.service ||
                          pod.labels['service.name']
      if (serviceLabel) return serviceLabel
      
      // Try to extract from pod name (e.g., "user-service-abc123" -> "user-service")
      const nameParts = pod.name.split('-')
      if (nameParts.length > 1) {
        // Remove hash/suffix and return service name
        return nameParts.slice(0, -1).join('-')
      }
    }
    
    // Fallback to pod name
    return pod.name.split('-').slice(0, -1).join('-') || pod.name
  }

  // Parse log line to extract structured information
  const parseLogLine = (logLine: string, podName: string, serviceName: string, namespace: string): LogEntry | null => {
    if (!logLine || !logLine.trim()) return null

    // Try to parse JSON logs
    try {
      const jsonLog = JSON.parse(logLine)
      return {
        timestamp: jsonLog.timestamp || jsonLog.time || jsonLog['@timestamp'] || new Date().toISOString(),
        podName,
        serviceName,
        namespace,
        level: (jsonLog.level || jsonLog.severity || 'info').toLowerCase() as LogEntry['level'],
        message: jsonLog.message || jsonLog.msg || jsonLog.log || JSON.stringify(jsonLog),
        raw: logLine,
      }
    } catch {
      // Not JSON, parse as text log
      const timestampMatch = logLine.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*[Z]?)/)
      const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString()
      
      // Detect log level from text
      let level: LogEntry['level'] = 'info'
      const lowerLog = logLine.toLowerCase()
      if (lowerLog.includes('error') || lowerLog.includes('err') || lowerLog.includes('fatal')) {
        level = 'error'
      } else if (lowerLog.includes('warn') || lowerLog.includes('warning')) {
        level = 'warn'
      } else if (lowerLog.includes('debug') || lowerLog.includes('trace')) {
        level = 'debug'
      }

      // Extract message (remove timestamp if present)
      const message = timestampMatch ? logLine.substring(timestampMatch[0].length).trim() : logLine.trim()

      return {
        timestamp,
        podName,
        serviceName,
        namespace,
        level,
        message,
        raw: logLine,
      }
    }
  }

  // Fetch all logs for the namespace
  const fetchLogs = useCallback(async () => {
    if (!token || !namespace || namespace === 'all') {
      setLogs([])
      setServiceLogs(new Map())
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Fetch all pods in the namespace
      const fetchedPods = await fetchPods()
      setPods(fetchedPods) // Store pods for display even if no logs
      
      if (fetchedPods.length === 0) {
        setLogs([])
        setServiceLogs(new Map())
        setLoading(false)
        setError('No pods found in this namespace')
        return
      }

      // Fetch logs for each pod
      const allLogs: LogEntry[] = []
      const serviceLogsMap = new Map<string, ServiceLogs>()

      await Promise.all(
        fetchedPods.map(async (pod: any) => {
          try {
            // Get container names from pod spec to fetch logs from all containers
            const containers = pod.spec?.containers?.map((c: any) => c.name) || []
            const podLogs: string[] = await fetchPodLogs(pod.name, namespace, containers)
            const serviceName = extractServiceName(pod)

            // fetchPodLogs always returns string[], so use it directly
            const logLines = podLogs
            
            // Always create service entry for pod, even if no logs
            if (!serviceLogsMap.has(serviceName)) {
              serviceLogsMap.set(serviceName, {
                serviceName,
                pods: [],
                totalLogs: 0,
                errorCount: 0,
                warningCount: 0,
              })
            }

            const serviceLog = serviceLogsMap.get(serviceName)!
            let podLogEntry = serviceLog.pods.find(p => p.podName === pod.name)
            if (!podLogEntry) {
              podLogEntry = { podName: pod.name, logs: [] }
              serviceLog.pods.push(podLogEntry)
            }

            // Process log lines
            logLines.forEach((logLine: string) => {
              if (!logLine || !logLine.trim()) return
              
              const logEntry = parseLogLine(logLine.trim(), pod.name, serviceName, namespace)
              if (logEntry) {
                allLogs.push(logEntry)
                podLogEntry.logs.push(logEntry)
                serviceLog.totalLogs++
                if (logEntry.level === 'error') serviceLog.errorCount++
                if (logEntry.level === 'warn') serviceLog.warningCount++
              }
            })
          } catch (err) {
            console.error(`Error processing logs for pod ${pod.name}:`, err)
          }
        })
      )

      // Sort logs by timestamp (newest first)
      allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

      setLogs(allLogs)
      setServiceLogs(serviceLogsMap)
      setLastRefresh(new Date())
    } catch (err: any) {
      setError(err.message || 'Failed to fetch logs')
      console.error('Error fetching logs:', err)
    } finally {
      setLoading(false)
    }
  }, [token, namespace, fetchPods, fetchPodLogs])

  // Auto-refresh logs
  useEffect(() => {
    if (isAutoRefreshing && namespace && namespace !== 'all') {
      fetchLogs()
      const interval = setInterval(() => {
        fetchLogs()
      }, 10000) // Refresh every 10 seconds

      return () => clearInterval(interval)
    }
  }, [isAutoRefreshing, namespace, fetchLogs])

  // Initial fetch
  useEffect(() => {
    if (namespace && namespace !== 'all') {
      fetchLogs()
    } else {
      setLogs([])
      setServiceLogs(new Map())
    }
  }, [namespace, fetchLogs])

  // Filter logs
  const filteredLogs = logs.filter(log => {
    // Filter by search term
    if (searchTerm && !log.message.toLowerCase().includes(searchTerm.toLowerCase()) && 
        !log.podName.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !log.serviceName.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false
    }

    // Filter by level
    if (filterLevel !== 'all' && log.level !== filterLevel) {
      return false
    }

    // Filter by selected service
    if (selectedService && log.serviceName !== selectedService) {
      return false
    }

    return true
  })

  // Get log level icon and color
  const getLogLevelStyle = (level: LogEntry['level']) => {
    switch (level) {
      case 'error':
        return { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' }
      case 'warn':
        return { icon: AlertCircle, color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200' }
      case 'debug':
        return { icon: Info, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' }
      default:
        return { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' }
    }
  }

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp)
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return timestamp
    }
  }

  const services = Array.from(serviceLogs.values())

  // Toggle service collapse
  const toggleServiceCollapse = (serviceName: string) => {
    setCollapsedServices(prev => {
      const newSet = new Set(prev)
      if (newSet.has(serviceName)) {
        newSet.delete(serviceName)
      } else {
        newSet.add(serviceName)
      }
      return newSet
    })
  }

  // Expand/collapse all services
  const toggleAllServices = () => {
    if (collapsedServices.size === services.length) {
      setCollapsedServices(new Set())
    } else {
      setCollapsedServices(new Set(services.map(s => s.serviceName)))
    }
  }

  // Group filtered logs by service
  const logsByService = filteredLogs.reduce((acc, log) => {
    if (!acc.has(log.serviceName)) {
      acc.set(log.serviceName, [])
    }
    acc.get(log.serviceName)!.push(log)
    return acc
  }, new Map<string, LogEntry[]>())

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Kubernetes Logs Viewer
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Real-time logs from services in namespace: <span className="font-semibold">{namespace}</span>
            <span className="ml-2 text-xs text-blue-600">(showing all pod lifetime logs, minimum 500)</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAutoRefreshing(!isAutoRefreshing)}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              isAutoRefreshing
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-gray-600 text-white hover:bg-gray-700'
            }`}
          >
            {isAutoRefreshing ? (
              <>
                <Pause className="w-4 h-4" />
                Pause Auto-Refresh
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Start Auto-Refresh
              </>
            )}
          </button>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Services Summary - Show if we have pods, even if no logs */}
      {(services.length > 0 || pods.length > 0) && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setServicesSectionCollapsed(!servicesSectionCollapsed)}
              className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900"
              disabled={loading}
            >
              {servicesSectionCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
              <span className="flex items-center gap-2">
                Services Summary ({services.length || 0}) | Pods ({pods.length})
                {loading && (
                  <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />
                )}
              </span>
            </button>
            {!servicesSectionCollapsed && (
              <button
                onClick={toggleAllServices}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                {collapsedServices.size === services.length ? 'Expand All' : 'Collapse All'}
              </button>
            )}
          </div>
          {!servicesSectionCollapsed && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {services.map((service) => {
                const isCollapsed = collapsedServices.has(service.serviceName)
                return (
                  <div
                    key={service.serviceName}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      selectedService === service.serviceName
                        ? 'border-blue-500 bg-blue-50 shadow-md'
                        : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <button
                          onClick={() => toggleServiceCollapse(service.serviceName)}
                          className="flex-shrink-0"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="w-4 h-4 text-gray-500" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-gray-500" />
                          )}
                        </button>
                        <h4 
                          className="font-semibold text-sm text-gray-900 truncate flex-1 cursor-pointer" 
                          title={service.serviceName}
                          onClick={() => setSelectedService(selectedService === service.serviceName ? null : service.serviceName)}
                        >
                          {service.serviceName}
                        </h4>
                      </div>
                      <Server className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    </div>
                    {!isCollapsed && (
                      <div className="space-y-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Pods:</span>
                          <span className="font-semibold text-gray-900">{service.pods.length}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Logs:</span>
                          <span className="font-semibold text-gray-900">{service.totalLogs}</span>
                        </div>
                        {service.errorCount > 0 && (
                          <div className="flex items-center justify-between text-red-600">
                            <span>Errors:</span>
                            <span className="font-semibold">{service.errorCount}</span>
                          </div>
                        )}
                        {service.warningCount > 0 && (
                          <div className="flex items-center justify-between text-yellow-600">
                            <span>Warnings:</span>
                            <span className="font-semibold">{service.warningCount}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search logs, pods, or services..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value as any)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Levels</option>
          <option value="error">Errors Only</option>
          <option value="warn">Warnings Only</option>
          <option value="info">Info Only</option>
          <option value="debug">Debug Only</option>
        </select>
        {selectedService && (
          <button
            onClick={() => setSelectedService(null)}
            className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2"
          >
            <XCircle className="w-4 h-4" />
            Clear Service Filter
          </button>
        )}
        <div className="text-xs text-gray-500 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Last refresh: {lastRefresh.toLocaleTimeString()}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {/* Loading State - Only show on initial load */}
      {loading && logs.length === 0 && (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-4" />
          <p className="text-gray-600">Loading logs from Kubernetes...</p>
        </div>
      )}

      {/* Logs Display - Show even when refreshing if we have logs */}
      {(!loading || logs.length > 0) && filteredLogs.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setLogsSectionCollapsed(!logsSectionCollapsed)}
              className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900"
              disabled={loading}
            >
              {logsSectionCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
              <span className="flex items-center gap-2">
                Logs ({filteredLogs.length})
                {loading && logs.length > 0 && (
                  <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />
                )}
              </span>
            </button>
          </div>
          {!logsSectionCollapsed && (
            <div className="space-y-4 max-h-[600px] overflow-y-auto">
              {Array.from(logsByService.entries()).map(([serviceName, serviceLogs]) => {
                const isServiceCollapsed = collapsedServices.has(serviceName)
                return (
                  <div key={serviceName} className="border border-gray-200 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleServiceCollapse(serviceName)}
                      className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {isServiceCollapsed ? (
                          <ChevronRight className="w-4 h-4 text-gray-500" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-500" />
                        )}
                        <span className="font-semibold text-gray-900">{serviceName}</span>
                        <span className="text-xs text-gray-500">({serviceLogs.length} logs)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {serviceLogs.filter(l => l.level === 'error').length > 0 && (
                          <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded">
                            {serviceLogs.filter(l => l.level === 'error').length} errors
                          </span>
                        )}
                        {serviceLogs.filter(l => l.level === 'warn').length > 0 && (
                          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                            {serviceLogs.filter(l => l.level === 'warn').length} warnings
                          </span>
                        )}
                      </div>
                    </button>
                    {!isServiceCollapsed && (
                      <div className="p-2 space-y-2">
                        {serviceLogs.map((log, index) => {
                          const levelStyle = getLogLevelStyle(log.level)
                          const Icon = levelStyle.icon

                          return (
                            <div
                              key={`${log.podName}-${log.timestamp}-${index}`}
                              className={`p-3 rounded-lg border ${levelStyle.border} ${levelStyle.bg} hover:shadow-sm transition-shadow`}
                            >
                              <div className="flex items-start gap-3">
                                <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${levelStyle.color}`} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <span className="text-xs text-gray-600 bg-white px-2 py-0.5 rounded">
                                      {log.podName}
                                    </span>
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                                      log.level === 'error' ? 'bg-red-100 text-red-800' :
                                      log.level === 'warn' ? 'bg-yellow-100 text-yellow-800' :
                                      log.level === 'debug' ? 'bg-blue-100 text-blue-800' :
                                      'bg-green-100 text-green-800'
                                    }`}>
                                      {log.level.toUpperCase()}
                                    </span>
                                    <span className="text-xs text-gray-500 flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      {formatTimestamp(log.timestamp)}
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-800 font-mono whitespace-pre-wrap break-words">
                                    {log.message}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredLogs.length === 0 && namespace && namespace !== 'all' && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <FileText className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600 mb-2">
            {searchTerm || filterLevel !== 'all' || selectedService
              ? 'No logs match your filters'
              : pods.length === 0
              ? 'No pods found in this namespace'
              : 'No logs found'}
          </p>
          {searchTerm || filterLevel !== 'all' || selectedService ? (
            <button
              onClick={() => {
                setSearchTerm('')
                setFilterLevel('all')
                setSelectedService(null)
              }}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800 underline"
            >
              Clear filters
            </button>
          ) : pods.length > 0 ? (
            <p className="text-sm text-gray-500">
              Found {pods.length} pod{pods.length !== 1 ? 's' : ''} but no logs available. Pods may be starting up or logs may not be generated yet.
            </p>
          ) : (
            <p className="text-sm text-gray-500">
              No pods found in namespace &quot;{namespace}&quot;. Please check if the namespace exists and contains running pods.
            </p>
          )}
        </div>
      )}

      {/* No Namespace Selected */}
      {(!namespace || namespace === 'all') && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Server className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600">Please select a namespace to view logs</p>
        </div>
      )}
    </div>
  )
}




'use client'

import { useState, useEffect, useRef } from 'react'
import { X, RefreshCw, Loader2, FileText, AlertCircle } from 'lucide-react'

interface TraceLogsModalProps {
  isOpen: boolean
  onClose: () => void
  traceId: string
  pods: Array<{ name: string; namespace: string; serviceName?: string }>
  startTime: number // nanoseconds
  endTime: number // nanoseconds
  apiUrl: string
}

interface PodLogs {
  podName: string
  namespace: string
  serviceName?: string
  logs: string[]
  errorCount: number
  hasTraceId: boolean
}

export default function TraceLogsModal({
  isOpen,
  onClose,
  traceId,
  pods,
  startTime,
  endTime,
  apiUrl,
}: TraceLogsModalProps) {
  const [podLogsData, setPodLogsData] = useState<Map<string, PodLogs>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPod, setSelectedPod] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const logEndRef = useRef<HTMLDivElement>(null)

  // Convert nanoseconds to milliseconds for date operations
  const startTimeMs = startTime / 1000000
  const endTimeMs = endTime / 1000000
  const timeWindowMs = endTimeMs - startTimeMs
  // Add buffer: 5 seconds before and after trace
  const bufferMs = 5000
  const searchStartTime = new Date(startTimeMs - bufferMs)
  const searchEndTime = new Date(endTimeMs + bufferMs)

  // Detect error lines
  const isErrorLine = (line: string): boolean => {
    const lowerLine = line.toLowerCase()
    return (
      lowerLine.includes('error') ||
      lowerLine.includes('err') ||
      lowerLine.includes('failed') ||
      lowerLine.includes('failure') ||
      lowerLine.includes('exception') ||
      lowerLine.includes('fatal') ||
      /5\d{2}/.test(line) || // HTTP 5xx errors
      /\[error\]/i.test(line) ||
      /\[err\]/i.test(line) ||
      /\[fatal\]/i.test(line)
    )
  }

  // Parse log line to extract timestamp
  const extractTimestamp = (line: string): Date | null => {
    // Try ISO format: 2024-01-01T12:00:00.123Z or 2024-01-01 12:00:00
    const isoMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*[Z]?)/)
    if (isoMatch) {
      const date = new Date(isoMatch[1])
      if (!isNaN(date.getTime())) return date
    }
    
    // Try RFC3339 format
    const rfcMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/)
    if (rfcMatch) {
      const date = new Date(rfcMatch[1])
      if (!isNaN(date.getTime())) return date
    }
    
    return null
  }

  // Filter logs by time range
  const filterLogsByTime = (logs: string[]): string[] => {
    return logs.filter(line => {
      const timestamp = extractTimestamp(line)
      if (!timestamp) return true // Include logs without timestamps
      return timestamp >= searchStartTime && timestamp <= searchEndTime
    })
  }

  // Fetch logs for all pods
  const fetchTraceLogs = async () => {
    if (pods.length === 0) return

    setIsLoading(true)
    setError(null)
    const logsMap = new Map<string, PodLogs>()

    try {
      const logPromises = pods.map(async (pod) => {
        try {
          // Fetch logs from all containers in the pod
          const podResponse = await fetch(`${apiUrl}/k8s/pods/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}`)
          if (!podResponse.ok) {
            console.warn(`Failed to fetch pod info for ${pod.name}`)
            return
          }

          const podData = await podResponse.json()
          const containers = podData.pod?.spec?.containers || []
          
          if (containers.length === 0) {
            // Try fetching logs without container specification
            const url = `${apiUrl}/k8s/pods/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}/logs?tailLines=2000`
            const response = await fetch(url)
            if (response.ok) {
              const data = await response.json()
              if (data.success && data.logs) {
                const allLogs = typeof data.logs === 'string' ? data.logs.split('\n') : []
                const filteredLogs = filterLogsByTime(allLogs)
                const errorCount = filteredLogs.filter(line => isErrorLine(line)).length
                const hasTraceId = filteredLogs.some(line => 
                  line.toLowerCase().includes(traceId.toLowerCase()) ||
                  line.includes(traceId.substring(0, 16))
                )

                logsMap.set(pod.name, {
                  podName: pod.name,
                  namespace: pod.namespace,
                  serviceName: pod.serviceName,
                  logs: filteredLogs,
                  errorCount,
                  hasTraceId,
                })
              }
            }
          } else {
            // Fetch logs from each container
            const containerLogPromises = containers.map(async (container: any) => {
              const containerName = container.name || ''
              if (!containerName) return []

              const url = `${apiUrl}/k8s/pods/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}/logs?tailLines=2000&container=${encodeURIComponent(containerName)}`
              const response = await fetch(url)
              
              if (response.ok) {
                const data = await response.json()
                if (data.success && data.logs) {
                  const logs = typeof data.logs === 'string' ? data.logs.split('\n') : []
                  // Prefix with container name
                  return logs.map((line: string) => `[${containerName}] ${line}`)
                }
              }
              return []
            })

            const containerLogs = await Promise.all(containerLogPromises)
            const allLogs = containerLogs.flat()
            const filteredLogs = filterLogsByTime(allLogs)
            const errorCount = filteredLogs.filter(line => isErrorLine(line)).length
            const hasTraceId = filteredLogs.some(line => 
              line.toLowerCase().includes(traceId.toLowerCase()) ||
              line.includes(traceId.substring(0, 16))
            )

            logsMap.set(pod.name, {
              podName: pod.name,
              namespace: pod.namespace,
              serviceName: pod.serviceName,
              logs: filteredLogs,
              errorCount,
              hasTraceId,
            })
          }
        } catch (err) {
          console.error(`Error fetching logs for pod ${pod.name}:`, err)
        }
      })

      await Promise.all(logPromises)
      setPodLogsData(logsMap)
      
      // Auto-select first pod with logs
      if (logsMap.size > 0) {
        setSelectedPod(Array.from(logsMap.keys())[0])
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch trace logs')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen && pods.length > 0) {
      fetchTraceLogs()
    }
  }, [isOpen, traceId, pods.length])

  // Scroll to bottom when logs update
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [podLogsData, selectedPod])

  if (!isOpen) return null

  const selectedPodLogs = selectedPod ? podLogsData.get(selectedPod) : null
  const filteredLogs = selectedPodLogs?.logs.filter(line => {
    if (!searchTerm.trim()) return true
    const searchLower = searchTerm.toLowerCase()
    return line.toLowerCase().includes(searchLower)
  }) || []

  const totalErrorCount = Array.from(podLogsData.values()).reduce((sum, pod) => sum + pod.errorCount, 0)
  const podsWithTraceId = Array.from(podLogsData.values()).filter(pod => pod.hasTraceId).length

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-blue-600" />
            <div>
              <h3 className="text-xl font-bold text-gray-900">Trace Logs</h3>
              <p className="text-sm text-gray-600 mt-1">
                Trace ID: <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">{traceId.substring(0, 32)}...</code>
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Time Range: {new Date(startTimeMs).toLocaleString()} - {new Date(endTimeMs).toLocaleString()}
                {' '}({timeWindowMs.toFixed(0)}ms duration)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchTraceLogs}
              disabled={isLoading}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title="Refresh logs"
            >
              <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-600">Pods:</span>
            <span className="font-semibold">{podLogsData.size}/{pods.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <span className="text-gray-600">Errors:</span>
            <span className="font-semibold text-red-600">{totalErrorCount}</span>
          </div>
          {podsWithTraceId > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-gray-600">Pods with Trace ID:</span>
              <span className="font-semibold text-blue-600">{podsWithTraceId}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Pod List Sidebar */}
          <div className="w-64 border-r border-gray-200 overflow-y-auto bg-gray-50">
            <div className="p-4">
              <h4 className="font-semibold text-gray-900 mb-3">Pods in Trace</h4>
              <div className="space-y-2">
                {pods.map((pod) => {
                  const podData = podLogsData.get(pod.name)
                  const hasLogs = podData && podData.logs.length > 0
                  const isSelected = selectedPod === pod.name

                  return (
                    <button
                      key={`${pod.namespace}-${pod.name}`}
                      onClick={() => setSelectedPod(pod.name)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-blue-100 border-2 border-blue-500'
                          : 'bg-white border border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-sm font-semibold truncate">{pod.name}</span>
                        {podData?.hasTraceId && (
                          <span className="text-blue-600 text-xs" title="Contains trace ID">🔗</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-600 mb-1">{pod.namespace}</div>
                      {podData && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-gray-500">{podData.logs.length} lines</span>
                          {podData.errorCount > 0 && (
                            <span className="text-red-600 font-semibold">
                              {podData.errorCount} errors
                            </span>
                          )}
                        </div>
                      )}
                      {!hasLogs && (
                        <div className="text-xs text-gray-400 italic">No logs in time range</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Logs Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {isLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <span className="ml-3 text-gray-600">Loading logs...</span>
              </div>
            ) : error ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="text-center">
                  <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
                  <p className="text-red-600 font-semibold">{error}</p>
                </div>
              </div>
            ) : !selectedPodLogs ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <p className="text-gray-500">Select a pod to view logs</p>
              </div>
            ) : (
              <>
                {/* Search Bar */}
                <div className="p-4 border-b border-gray-200">
                  <input
                    type="text"
                    placeholder="Search logs..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Logs Display */}
                <div className="flex-1 overflow-y-auto bg-gray-900 p-4">
                  {filteredLogs.length === 0 ? (
                    <div className="text-gray-400 text-center py-8">
                      {searchTerm ? 'No logs match your search' : 'No logs found in time range'}
                    </div>
                  ) : (
                    <div className="font-mono text-sm space-y-1">
                      {filteredLogs.map((line, idx) => {
                        const isError = isErrorLine(line)
                        const hasTraceId = line.toLowerCase().includes(traceId.toLowerCase()) ||
                                         line.includes(traceId.substring(0, 16))
                        
                        return (
                          <div
                            key={idx}
                            className={`px-2 py-1 rounded ${
                              isError
                                ? 'bg-red-950/30 text-red-400'
                                : hasTraceId
                                ? 'bg-blue-950/30 text-blue-300'
                                : 'text-gray-300 hover:bg-gray-800'
                            }`}
                          >
                            {line || ' '}
                          </div>
                        )
                      })}
                      <div ref={logEndRef} />
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-sm">
                  <div className="text-gray-600">
                    Showing {filteredLogs.length} of {selectedPodLogs.logs.length} log lines
                    {searchTerm && ` (filtered by "${searchTerm}")`}
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded bg-red-500"></div>
                      <span>Error</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded bg-blue-500"></div>
                      <span>Contains Trace ID</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}




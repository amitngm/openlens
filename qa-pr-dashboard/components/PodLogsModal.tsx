'use client'

import { useState, useEffect, useRef } from 'react'
import { X, RefreshCw, Loader2, Download, Play, Pause } from 'lucide-react'

interface PodLogsModalProps {
  isOpen: boolean
  onClose: () => void
  podName: string
  namespace: string
  container?: string
  apiUrl: string
}

export default function PodLogsModal({
  isOpen,
  onClose,
  podName,
  namespace,
  container,
  apiUrl,
}: PodLogsModalProps) {
  const [logs, setLogs] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFollowing, setIsFollowing] = useState(false)
  const [tailLines, setTailLines] = useState<number | 'all'>(100)
  const [selectedContainer, setSelectedContainer] = useState<string>(container || '')
  const [containers, setContainers] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)
  const followIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastLogTimestampRef = useRef<string>('')

  // Fetch containers list
  useEffect(() => {
    if (!isOpen || !podName || !namespace) return

    const fetchContainers = async () => {
      try {
        const response = await fetch(`${apiUrl}/k8s/pods/${namespace}/${podName}`)
        
        if (!response.ok) {
          const errorText = await response.text()
          console.error('Failed to fetch containers:', response.status, errorText)
          return
        }
        
        const contentType = response.headers.get('content-type')
        if (!contentType || !contentType.includes('application/json')) {
          console.error('Expected JSON but got:', contentType)
          return
        }
        
        const data = await response.json()
        if (data.success && data.pod) {
          const podContainers = data.pod.spec?.containers?.map((c: any) => c.name) || []
          setContainers(podContainers)
          if (podContainers.length > 0 && !selectedContainer) {
            setSelectedContainer(podContainers[0])
          }
        }
      } catch (err) {
        console.error('Failed to fetch containers:', err)
      }
    }

    fetchContainers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, podName, namespace, apiUrl])

  // Fetch logs
  const fetchLogs = async (isInitial = false) => {
    if (!podName || !namespace || !selectedContainer) {
      console.warn('Missing required parameters:', { podName, namespace, selectedContainer })
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const tailLinesParam = tailLines === 'all' ? '' : `&tailLines=${tailLines}`
      const url = `${apiUrl}/k8s/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(podName)}/logs?container=${encodeURIComponent(selectedContainer)}${tailLinesParam}`
      console.log('Fetching logs from:', url)
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`
        try {
          const errorJson = JSON.parse(errorText)
          errorMessage = errorJson.error || errorJson.message || errorMessage
        } catch {
          // If it's not JSON, use the text as is (might be HTML error page)
          if (errorText.includes('<!DOCTYPE')) {
            errorMessage = `Server returned an HTML error page. Please check if the API endpoint exists and the server is running correctly.`
          } else {
            errorMessage = errorText || errorMessage
          }
        }
        throw new Error(errorMessage)
      }
      
      const data = await response.json()

      if (data.success) {
        const newLogs = data.logs || ''
        
        if (isFollowing && !isInitial) {
          // Append only new lines when following
          const currentLines = logs.split('\n')
          const newLines = newLogs.split('\n')
          
          // Find new lines by comparing with last known timestamp
          const lastTimestamp = lastLogTimestampRef.current
          if (lastTimestamp) {
            const newLogLines = newLines.filter((line: string) => {
              // Extract timestamp if present (format: 2024-01-01T12:00:00.000000000Z)
              const timestampMatch = line.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
              if (timestampMatch && timestampMatch[0] > lastTimestamp) {
                return true
              }
              return false
            })
            
            if (newLogLines.length > 0) {
              setLogs(prev => prev + '\n' + newLogLines.join('\n'))
            }
          } else {
            // First follow, just set the logs
            setLogs(newLogs)
          }
          
          // Update last timestamp from the last line
          const lastLine = newLines[newLines.length - 1]
          const timestampMatch = lastLine?.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
          if (timestampMatch) {
            lastLogTimestampRef.current = timestampMatch[0]
          }
        } else {
          // Not following or initial load, replace logs
          setLogs(newLogs)
          lastLogTimestampRef.current = ''
        }
      } else {
        // API returned success: false or no success field
        const errorMsg = data.error || data.message || 'Failed to fetch logs'
        setError(errorMsg)
        console.error('API error response:', data)
      }
    } catch (err: any) {
      console.error('Error fetching logs:', err)
      // Extract more detailed error message
      let errorMessage = 'Failed to fetch logs'
      if (err.message) {
        errorMessage = err.message
      } else if (typeof err === 'string') {
        errorMessage = err
      } else if (err.toString && err.toString() !== '[object Object]') {
        errorMessage = err.toString()
      }
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  // Initial load - wait for container to be selected
  useEffect(() => {
    if (isOpen && selectedContainer && containers.length > 0) {
      fetchLogs(true)
    } else {
      setLogs('')
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedContainer, containers.length])

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (logEndRef.current && isFollowing) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, isFollowing])

  // Polling for live logs
  useEffect(() => {
    if (isFollowing && selectedContainer) {
      followIntervalRef.current = setInterval(() => {
        fetchLogs(false)
      }, 2000) // Poll every 2 seconds
    } else {
      if (followIntervalRef.current) {
        clearInterval(followIntervalRef.current)
        followIntervalRef.current = null
      }
    }

    return () => {
      if (followIntervalRef.current) {
        clearInterval(followIntervalRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFollowing, selectedContainer])

  // Cleanup on close
  useEffect(() => {
    if (!isOpen) {
      setIsFollowing(false)
      setLogs('')
      setError(null)
      lastLogTimestampRef.current = ''
      if (followIntervalRef.current) {
        clearInterval(followIntervalRef.current)
        followIntervalRef.current = null
      }
    }
  }, [isOpen])

  const handleDownload = () => {
    const blob = new Blob([logs], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${podName}-${selectedContainer || 'logs'}-${new Date().toISOString()}.log`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleToggleFollow = () => {
    if (isFollowing) {
      setIsFollowing(false)
    } else {
      // Start following from current logs
      const lastLine = logs.split('\n').filter(Boolean).pop() || ''
      const timestampMatch = lastLine.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      if (timestampMatch) {
        lastLogTimestampRef.current = timestampMatch[0]
      }
      setIsFollowing(true)
    }
  }

  // Check if a log line contains an error
  const isErrorLine = (line: string): boolean => {
    if (!line || line.trim().length === 0) return false
    
    // Common error patterns (case-insensitive matching)
    const errorPatterns = [
      /\berror\b/i,
      /\berrors\b/i,
      /\bfailed\b/i,
      /\bfailure\b/i,
      /\bexception\b/i,
      /\bfatal\b/i,
      /\bpanic\b/i,
      /\bcrash\b/i,
      /\btimeout\b/i,
      /\brejected\b/i,
      /\bdenied\b/i,
      /\bunauthorized\b/i,
      /\bforbidden\b/i,
      /\bnot found\b/i,
      /\bnotfound\b/i,
      /\b500\b/,  // HTTP 500
      /\b502\b/,  // HTTP 502
      /\b503\b/,  // HTTP 503
      /\b504\b/,  // HTTP 504
      /\[error\]/i,
      /\[err\]/i,
      /\[fatal\]/i,
      /\[panic\]/i,
      /error:/i,
      /exception:/i,
      /failed:/i,
      /traceback/i,
      /stack trace/i,
      /e\s+rr\s+or/i,  // Sometimes errors are split across characters
    ]
    
    return errorPatterns.some(pattern => pattern.test(line))
  }

  // Render logs with error highlighting
  const renderLogs = () => {
    if (!logs) return null
    
    const lines = logs.split('\n')
    
    return (
      <div className="space-y-0">
        {lines.map((line, index) => {
          const isError = isErrorLine(line)
          return (
            <div
              key={index}
              className={`whitespace-pre-wrap break-words ${
                isError 
                  ? 'text-red-400 bg-red-950/30 px-1 py-0.5 rounded' 
                  : 'text-green-400'
              }`}
            >
              {line || '\u00A0'} {/* Non-breaking space for empty lines */}
            </div>
          )
        })}
        {isFollowing && (
          <span className="inline-block ml-2 animate-pulse text-green-400">▋</span>
        )}
        <div ref={logEndRef} />
      </div>
    )
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={onClose}></div>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-6xl sm:w-full h-[90vh] flex flex-col">
          {/* Header */}
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                Pod Logs: {podName}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Namespace: {namespace}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Controls */}
          <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 flex items-center gap-4 flex-wrap">
            {containers.length > 1 && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Container:</label>
                <select
                  value={selectedContainer}
                  onChange={(e) => {
                    setSelectedContainer(e.target.value)
                    setIsFollowing(false)
                  }}
                  className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {containers.map((cont) => (
                    <option key={cont} value={cont}>
                      {cont}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Lines:</label>
              <select
                value={tailLines}
                onChange={(e) => {
                  const value = e.target.value
                  setTailLines(value === 'all' ? 'all' : Number(value))
                  setIsFollowing(false)
                }}
                className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={1000}>1000</option>
                <option value="all">All</option>
              </select>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={handleToggleFollow}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isFollowing
                    ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                    : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                }`}
              >
                {isFollowing ? (
                  <>
                    <Pause className="w-4 h-4" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Follow
                  </>
                )}
              </button>
              <button
                onClick={() => fetchLogs(true)}
                disabled={isLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={handleDownload}
                disabled={!logs}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Download
              </button>
            </div>
          </div>

          {/* Logs Content */}
          <div className="flex-1 overflow-auto bg-black text-green-400 font-mono text-sm p-4 relative">
            {error && (
              <div className="bg-red-900 text-red-200 p-4 mb-4 rounded">
                <strong>Error:</strong> {error}
              </div>
            )}
            {isLoading && logs === '' && (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <span className="ml-3 text-gray-400">Loading logs...</span>
              </div>
            )}
            {logs ? (
              renderLogs()
            ) : (
              !isLoading && !error && (
                <div className="text-gray-500 text-center mt-8">
                  No logs available
                </div>
              )
            )}
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 flex items-center justify-between text-sm text-gray-600">
            <div>
              {isFollowing && (
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  Following logs... (updates every 2s)
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              {logs && (
                <>
                  <span>
                    {logs.split('\n').filter(Boolean).length} lines
                    {tailLines !== 'all' && ` (showing last ${tailLines})`}
                    {tailLines === 'all' && ' (all logs)'}
                  </span>
                  {(() => {
                    const errorCount = logs.split('\n').filter(line => isErrorLine(line)).length
                    if (errorCount > 0) {
                      return (
                        <span className="text-red-600 font-medium">
                          {errorCount} error{errorCount !== 1 ? 's' : ''} found
                        </span>
                      )
                    }
                    return null
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


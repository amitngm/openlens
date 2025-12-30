'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Network, Activity, AlertCircle, TrendingUp, Clock, Filter, Shield, CheckCircle, XCircle, Info, FileText } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import PodLogsModal from './PodLogsModal'

interface FlowNode {
  id: string
  service: {
    name: string
    namespace: string
    pod: string
    version?: string
  }
  metrics: {
    requestCount: number
    errorCount: number
    avgLatency: number
    p50Latency: number
    p95Latency: number
    p99Latency: number
  }
  status: 'healthy' | 'degraded' | 'down'
}

interface FlowEdge {
  from: string
  to: string
  callCount: number
  errorRate: number
  avgLatency: number
}

interface SpanSequenceItem {
  spanId: string
  operationName: string
  startTime: number
  duration: number
  endTime: number
  podName: string
  serviceName: string
  namespace: string
  parentSpanId: string | null
  status: 'success' | 'error'
}

interface FlowGraph {
  flowId: string
  traceId: string
  operationName: string
  uiEvent?: string
  startTime: number
  endTime: number
  duration: number
  nodes: FlowNode[]
  edges: FlowEdge[]
  spanSequence?: SpanSequenceItem[] // Timeline sequence of spans
  metadata: {
    namespace: string
    totalSpans: number
    serviceCount: number
    errorCount: number
    namespaces?: string[]
    servicesByNamespace?: Record<string, string[]>
  }
}

interface FlowVisualizationProps {
  apiUrl: string
  namespace?: string  // Optional: Selected Kubernetes namespace
}

export default function FlowVisualization({ apiUrl, namespace }: FlowVisualizationProps) {
  const { hasRole } = useAuth()
  
  // All hooks must be declared before any conditional returns
  const [flows, setFlows] = useState<FlowGraph[]>([])
  const [selectedFlow, setSelectedFlow] = useState<FlowGraph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPrerequisites, setShowPrerequisites] = useState(true)
  const [prerequisites, setPrerequisites] = useState({
    tracingBackend: '', // jaeger, tempo, or none
    jaegerUrl: 'http://localhost:16686',
    tempoUrl: 'http://localhost:3200',
    tracingEnabled: false,
    collectorEnabled: false,
    serviceName: 'qa-pr-dashboard-api',
  })
  const [prerequisitesChecked, setPrerequisitesChecked] = useState(false)
  const [filters, setFilters] = useState({
    operation: '',
    namespace: namespace || 'ccs',  // Default to ccs namespace, or use provided namespace
    startTime: '',
    endTime: '',
  })
  const [operations, setOperations] = useState<string[]>([])
  const [dependencies, setDependencies] = useState<{ nodes: any[], edges: any[] } | null>(null)
  const [pods, setPods] = useState<any[]>([])
  const [deployments, setDeployments] = useState<any[]>([])
  const [loadingResources, setLoadingResources] = useState(false)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [podLogs, setPodLogs] = useState<Map<string, string>>(new Map()) // Map of podName -> log content
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [selectedPodForLogs, setSelectedPodForLogs] = useState<{ namespace: string; name: string; container?: string } | null>(null)

  // Fetch operations list
  const fetchOperations = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/flows/operations`)
      if (response.ok) {
        const data = await response.json()
        setOperations(data.operations?.map((op: any) => op.name) || [])
      }
    } catch (err) {
      console.error('Error fetching operations:', err)
    }
  }, [apiUrl])

  // Fetch flows
  const fetchFlows = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const params = new URLSearchParams()
      if (filters.operation) params.append('operation', filters.operation)
      // Add namespace filter if available
      const targetNamespace = filters.namespace || namespace
      if (targetNamespace) {
        params.append('namespace', targetNamespace)
      }
      if (filters.startTime) params.append('startTime', filters.startTime)
      if (filters.endTime) params.append('endTime', filters.endTime)
      params.append('limit', '50')

      const response = await fetch(`${apiUrl}/flows?${params.toString()}`)
      
      if (response.ok) {
        const data = await response.json()
        setFlows(data.flows || [])
      } else if (response.status === 503) {
        setError('Flow Analyzer service is not available. This is an optional feature.')
      } else {
        const errorData = await response.json().catch(() => ({}))
        setError(errorData.message || 'Failed to fetch flows')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch flows')
    } finally {
      setLoading(false)
    }
  }, [apiUrl, filters.operation, filters.namespace, filters.startTime, filters.endTime, namespace])

  // Fetch service dependencies
  const fetchDependencies = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      // Use namespace from filters (which can be set from props or user selection)
      const targetNamespace = filters.namespace || namespace
      if (targetNamespace) {
        params.append('namespace', targetNamespace)
      }

      const response = await fetch(`${apiUrl}/flows/dependencies?${params.toString()}`)
      
      if (response.ok) {
        const data = await response.json()
        setDependencies(data)
      }
    } catch (err) {
      console.error('Error fetching dependencies:', err)
    }
  }, [apiUrl, filters.namespace, namespace])

  // Check prerequisites (Flow Analyzer and Tracing Backend)
  const checkPrerequisites = useCallback(async () => {
    try {
      // Check Flow Analyzer availability
      let tracingEnabled = false
      try {
        const response = await fetch(`${apiUrl}/flows/operations`)
        if (response.ok) {
          tracingEnabled = true
        }
      } catch (err) {
        console.log('Flow Analyzer not available:', err)
      }

      // Check Tracing Backend connectivity
      let collectorEnabled = false
      if (prerequisites.tracingBackend === 'jaeger' && prerequisites.jaegerUrl) {
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
          // Use the API server as a proxy to avoid CORS issues
          const response = await fetch(`${apiUrl}/jaeger/health?url=${encodeURIComponent(prerequisites.jaegerUrl)}`, {
            method: 'GET',
            signal: controller.signal,
          })
          clearTimeout(timeoutId)
          if (response.ok) {
            const data = await response.json().catch(() => ({}))
            if (data.status === 'ready' || data.ready === true) {
              collectorEnabled = true
            }
          }
        } catch (err) {
          console.log('Jaeger not reachable via proxy:', err)
          // If jaegerUrl is localhost, assume it might be running (CORS blocking verification)
          if (prerequisites.jaegerUrl.includes('localhost') || prerequisites.jaegerUrl.includes('127.0.0.1')) {
            console.log('Assuming Jaeger is running on localhost (may be CORS issue)')
            collectorEnabled = true
          }
        }
      } else if (prerequisites.tracingBackend === 'tempo' && prerequisites.tempoUrl) {
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
          // Use the API server as a proxy to avoid CORS issues
          const response = await fetch(`${apiUrl}/tempo/health?url=${encodeURIComponent(prerequisites.tempoUrl)}`, {
            method: 'GET',
            signal: controller.signal,
          })
          clearTimeout(timeoutId)
          if (response.ok) {
            const data = await response.json().catch(() => ({}))
            if (data.status === 'ready' || data.ready === true) {
              collectorEnabled = true
            }
          }
        } catch (err) {
          console.log('Tempo not reachable via proxy:', err)
          // If tempoUrl is localhost, assume it might be running (CORS blocking verification)
          if (prerequisites.tempoUrl.includes('localhost') || prerequisites.tempoUrl.includes('127.0.0.1')) {
            console.log('Assuming Tempo is running on localhost (may be CORS issue)')
            collectorEnabled = true // Assume it's running if URL is localhost
          }
        }
      } else if (prerequisites.tracingBackend === 'none') {
        collectorEnabled = true // No backend needed
      }

      setPrerequisites(prev => ({
        ...prev,
        tracingEnabled,
        collectorEnabled,
      }))
      setPrerequisitesChecked(true)
    } catch (err) {
      console.error('Error checking prerequisites:', err)
      setPrerequisitesChecked(true) // Still show results even if check fails
    }
  }, [apiUrl, prerequisites.tracingBackend, prerequisites.jaegerUrl, prerequisites.tempoUrl])

  // Filter flows based on search term - enhanced to search all pods in namespace
  const displayedFlows = useMemo(() => {
    if (!searchTerm.trim()) {
      return flows;
    }

    const searchLower = searchTerm.toLowerCase().trim();
    const targetNamespace = (filters.namespace || namespace || '').toLowerCase();

    // First, check if search matches any pod in the namespace (from fetched pods list)
    // Search in pod name, deployment, container names, labels, and IP
    const matchingPodNames = new Set<string>();
    if (targetNamespace && pods.length > 0) {
      pods.forEach(pod => {
        const podName = (pod.name || '').toLowerCase();
        const podNamespace = (pod.namespace || '').toLowerCase();
        const deployment = (pod.deployment || '').toLowerCase();
        const podIP = (pod.podIP || '').toLowerCase();
        
        if (podNamespace !== targetNamespace) return;
        
        // Check if search matches pod name, deployment, IP, containers, or labels
        const matches = podName.includes(searchLower) ||
                       (deployment && deployment.includes(searchLower)) ||
                       (podIP && podIP.includes(searchLower)) ||
                       (pod.containers && Array.isArray(pod.containers) && pod.containers.some((c: any) => 
                         String(c.name || '').toLowerCase().includes(searchLower) ||
                         String(c.image || '').toLowerCase().includes(searchLower)
                       )) ||
                       (pod.labels && Object.entries(pod.labels).some(([k, v]: [string, any]) =>
                         k.toLowerCase().includes(searchLower) ||
                         String(v || '').toLowerCase().includes(searchLower)
                       ));
        
        if (matches) {
          matchingPodNames.add(pod.name);
        }
      });
    }

    return flows.filter(flow => {
      // Search in operation name
      if (flow.operationName?.toLowerCase().includes(searchLower)) return true;
      
      // Search in trace ID
      if (flow.traceId?.toLowerCase().includes(searchLower)) return true;
      
      // Search in UI event
      if (flow.uiEvent?.toLowerCase().includes(searchLower)) return true;
      
      // Search in pod names from flow nodes
      const matchingPods = flow.nodes.filter(node => {
        const podName = (node.service.pod || '').toLowerCase();
        const serviceName = (node.service.name || '').toLowerCase();
        const namespace = (node.service.namespace || '').toLowerCase();
        
        // Only search in target namespace pods if namespace is selected
        if (targetNamespace && namespace !== targetNamespace) return false;
        
        // Check if pod name matches search
        const podMatches = podName.includes(searchLower) || 
                          serviceName.includes(searchLower) ||
                          (podName !== 'unknown-pod' && podName.includes(searchLower));
        
        // Also check if this pod is in our matching pod names set
        const podInMatchingSet = matchingPodNames.has(node.service.pod);
        
        return podMatches || podInMatchingSet;
      });
      
      if (matchingPods.length > 0) return true;
      
      // Search in span sequence (pod names, service names, operations)
      if (flow.spanSequence && flow.spanSequence.length > 0) {
        const matchingSpans = flow.spanSequence.filter(span => {
          const podName = (span.podName || '').toLowerCase();
          const serviceName = (span.serviceName || '').toLowerCase();
          const operationName = (span.operationName || '').toLowerCase();
          const namespace = (span.namespace || '').toLowerCase();
          
          // Only search in target namespace if namespace is selected
          if (targetNamespace && namespace !== targetNamespace) return false;
          
          // Check if span matches search
          const spanMatches = podName.includes(searchLower) ||
                             serviceName.includes(searchLower) ||
                             operationName.includes(searchLower);
          
          // Also check if this pod is in our matching pod names set
          const podInMatchingSet = matchingPodNames.has(span.podName);
          
          return spanMatches || podInMatchingSet;
        });
        
        if (matchingSpans.length > 0) return true;
      }
      
      return false;
    });
  }, [flows, searchTerm, filters.namespace, namespace, pods, podLogs]);

  // Update filters when namespace prop changes and trigger collection
  useEffect(() => {
    if (namespace && namespace !== filters.namespace) {
      setFilters(prev => ({ ...prev, namespace }))
      // Trigger trace collection for this namespace
      if (namespace && namespace !== 'all') {
        fetch(`${apiUrl}/flows/collect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ namespace }),
        }).catch(err => console.error('Error triggering collection:', err))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace])

  // Auto-refresh flows every 10 seconds when namespace is selected
  useEffect(() => {
    if (!filters.namespace || filters.namespace === 'all') return
    
    const interval = setInterval(() => {
      fetchFlows()
    }, 10000) // Refresh every 10 seconds
    
    return () => clearInterval(interval)
  }, [filters.namespace, fetchFlows])

  // Fetch pods and deployments from selected namespace
  const fetchNamespaceResources = useCallback(async () => {
    const targetNamespace = filters.namespace || namespace
    if (!targetNamespace || targetNamespace === 'all') {
      setPods([])
      setDeployments([])
      return
    }

    setLoadingResources(true)
    try {
      // Fetch pods from selected namespace (using query parameter to match working code)
      const podsResponse = await fetch(`${apiUrl}/k8s/pods?namespace=${encodeURIComponent(targetNamespace)}`)
      if (podsResponse.ok) {
        const podsData = await podsResponse.json()
        setPods(podsData.pods || [])
      } else {
        console.error('Failed to fetch pods:', podsResponse.status, podsResponse.statusText)
        setPods([])
      }

      // Fetch deployments from selected namespace
      const deploymentsResponse = await fetch(`${apiUrl}/k8s/deployments?namespace=${encodeURIComponent(targetNamespace)}`)
      if (!deploymentsResponse.ok) {
        console.error('Failed to fetch deployments:', deploymentsResponse.status, deploymentsResponse.statusText)
      }
      if (deploymentsResponse.ok) {
        const deploymentsData = await deploymentsResponse.json()
        setDeployments(deploymentsData.deployments || [])
      }
    } catch (err) {
      console.error('Error fetching namespace resources:', err)
    } finally {
      setLoadingResources(false)
    }
  }, [apiUrl, filters.namespace, namespace])

  useEffect(() => {
    fetchOperations()
  }, [fetchOperations])

  // Fetch namespace resources when namespace filter changes or when searching
  useEffect(() => {
    fetchNamespaceResources()
  }, [fetchNamespaceResources])
  
  // Fetch logs from pods when searching (to search through log content)
  // Fetches logs from ALL containers in each pod
  const fetchPodLogsForSearch = useCallback(async (targetPods: any[], searchText: string) => {
    if (!searchText.trim() || targetPods.length === 0) {
      setPodLogs(new Map())
      return
    }

    setLoadingLogs(true)
    const logsMap = new Map<string, string>()
    const searchLower = searchText.toLowerCase().trim()

    try {
      // Prioritize pods that match search term in name/metadata first
      // Then fetch logs from prioritized pods + remaining pods (up to 30 total)
      const prioritizedPods: any[] = []
      const otherPods: any[] = []
      
      targetPods.forEach(pod => {
        const podName = (pod.name || '').toLowerCase()
        const deployment = (pod.deployment || '').toLowerCase()
        const podIP = (pod.podIP || '').toLowerCase()
        const hasContainers = pod.containers && Array.isArray(pod.containers) && pod.containers.length > 0
        const containerMatch = hasContainers && pod.containers.some((c: any) => 
          String(c.name || '').toLowerCase().includes(searchLower) ||
          String(c.image || '').toLowerCase().includes(searchLower)
        )
        
        // Prioritize if name, deployment, IP, or container matches
        if (podName.includes(searchLower) || 
            (deployment && deployment.includes(searchLower)) ||
            (podIP && podIP.includes(searchLower)) ||
            containerMatch) {
          prioritizedPods.push(pod)
        } else {
          otherPods.push(pod)
        }
      })
      
      // Search ALL pods in the namespace - no limit to ensure comprehensive search
      // Prioritize pods that match by name, but search all pods
      const podsToSearch = [...prioritizedPods, ...otherPods]
      
      console.log(`🔍 Searching ALL logs from ALL ${podsToSearch.length} pods in namespace (${prioritizedPods.length} prioritized, ${otherPods.length} others)`)
      
      // If searching for a specific term and no pods match by name, log a warning
      if (prioritizedPods.length === 0 && searchLower.length > 2) {
        console.log(`⚠️ No pods match "${searchText}" in name/metadata. Searching through ALL logs from ALL ${podsToSearch.length} pods...`)
      }
      
      // Fetch recent logs (last 500 lines) from each pod to search through
      const logPromises = podsToSearch.map(async (pod) => {
        try {
          const containers = pod.containers || []
          const allLogs: string[] = []

          // If pod has containers, fetch logs from each container
          if (containers.length > 0) {
            // Fetch logs from all containers in parallel
            const containerLogPromises = containers.map(async (container: any) => {
              try {
                const containerName = container.name || ''
                if (!containerName) return ''
                
                // Fetch more lines (2000) or all logs to ensure comprehensive search
                const url = `${apiUrl}/k8s/pods/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}/logs?tailLines=2000&container=${encodeURIComponent(containerName)}`
                
                const response = await fetch(url)
                if (response.ok) {
                  const data = await response.json()
                  if (data.success && data.logs) {
                    // Prefix log lines with container name for clarity
                    const containerLogs = typeof data.logs === 'string' 
                      ? data.logs.split('\n').map((line: string) => `[${containerName}] ${line}`).join('\n')
                      : String(data.logs)
                    return containerLogs
                  }
                }
              } catch (err) {
                console.error(`Error fetching logs for pod ${pod.name}, container ${container.name}:`, err)
                return ''
              }
              return ''
            })

            // Wait for all container logs to be fetched
            const containerLogs = await Promise.all(containerLogPromises)
            allLogs.push(...containerLogs.filter(log => log.trim().length > 0))
          } else {
            // If no containers specified, try fetching without container parameter (default container)
            // Fetch more lines (2000) to ensure comprehensive search
            try {
              const url = `${apiUrl}/k8s/pods/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}/logs?tailLines=2000`
              const response = await fetch(url)
              if (response.ok) {
                const data = await response.json()
                if (data.success && data.logs) {
                  allLogs.push(typeof data.logs === 'string' ? data.logs : String(data.logs))
                }
              }
            } catch (err) {
              console.error(`Error fetching logs for pod ${pod.name} (no container):`, err)
            }
          }

          // Combine all container logs into a single string for the pod
          if (allLogs.length > 0) {
            const combinedLogs = allLogs.join('\n')
            logsMap.set(pod.name, combinedLogs)
            // Check if search term is in the logs for debugging
            const hasMatch = combinedLogs.toLowerCase().includes(searchLower)
            if (hasMatch) {
              console.log(`✅ Found "${searchText}" in logs for pod ${pod.name} (${allLogs.length} container${allLogs.length !== 1 ? 's' : ''}, ${combinedLogs.length} chars)`)
            } else {
              console.log(`📋 Fetched logs for pod ${pod.name} (${allLogs.length} container${allLogs.length !== 1 ? 's' : ''}, ${combinedLogs.length} chars) - no match`)
            }
          } else {
            console.log(`⚠️ No logs found for pod ${pod.name}`)
          }
        } catch (err) {
          console.error(`Error processing logs for pod ${pod.name}:`, err)
          // Continue with other pods even if one fails
        }
      })

      await Promise.all(logPromises)
      setPodLogs(logsMap)
    } catch (err) {
      console.error('Error fetching pod logs for search:', err)
    } finally {
      setLoadingLogs(false)
    }
  }, [apiUrl])

  // Refresh pods when search term changes (to catch newly created pods)
  useEffect(() => {
    if (searchTerm.trim() && (filters.namespace || namespace)) {
      // Debounce: only refresh after user stops typing for 800ms
      const timeoutId = setTimeout(() => {
        fetchNamespaceResources()
      }, 800)
      
      return () => clearTimeout(timeoutId)
    }
  }, [searchTerm, filters.namespace, namespace, fetchNamespaceResources])

  // Fetch logs from pods when search term changes
  useEffect(() => {
    if (searchTerm.trim() && pods.length > 0 && (filters.namespace || namespace)) {
      // Debounce: fetch logs after user stops typing for 1000ms
      const timeoutId = setTimeout(() => {
        fetchPodLogsForSearch(pods, searchTerm)
      }, 1000)
      
      return () => clearTimeout(timeoutId)
    } else {
      setPodLogs(new Map())
    }
  }, [searchTerm, pods, filters.namespace, namespace, fetchPodLogsForSearch])

  useEffect(() => {
    fetchFlows()
  }, [fetchFlows])

  useEffect(() => {
    fetchDependencies()
  }, [fetchDependencies])

  const formatDuration = (ns: number) => {
    if (ns < 1000) return `${ns}ns`
    if (ns < 1000000) return `${(ns / 1000).toFixed(2)}μs`
    if (ns < 1000000000) return `${(ns / 1000000).toFixed(2)}ms`
    return `${(ns / 1000000000).toFixed(2)}s`
  }

  const formatTimestamp = (ts: number) => {
    return new Date(ts / 1000000).toLocaleString()
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500'
      case 'degraded': return 'bg-yellow-500'
      case 'down': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  // Render component - use conditional rendering instead of early return
  // RBAC: Only admins and managers can access flow visualization
  if (!hasRole('admin') && !hasRole('manager')) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
        <p className="text-gray-600">You need admin or manager privileges to access Flow Tracing.</p>
      </div>
    )
  }

  return (
    <>
      {showPrerequisites ? (
        <div className="space-y-6">
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Network className="w-6 h-6" />
                Flow Tracing Setup
              </h2>
              <p className="text-gray-600 mt-1">Configure prerequisites for flow tracing</p>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Prerequisites
            </h3>
            <ul className="list-disc list-inside text-sm text-blue-800 space-y-1">
              <li>Docker installed and running (for Jaeger/Tempo)</li>
              <li>Tracing backend (Jaeger or Tempo) running</li>
              <li>OpenTelemetry tracing enabled in API server</li>
              <li>Trace collector service enabled</li>
              <li>Services instrumented with OpenTelemetry</li>
            </ul>
          </div>

          <form onSubmit={(e) => {
            e.preventDefault()
            checkPrerequisites()
          }} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tracing Backend
              </label>
              <select
                value={prerequisites.tracingBackend}
                onChange={(e) => setPrerequisites(prev => ({ ...prev, tracingBackend: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select backend...</option>
                <option value="jaeger">Jaeger</option>
                <option value="tempo">Tempo</option>
                <option value="none">None (Manual trace analysis only)</option>
              </select>
            </div>

            {prerequisites.tracingBackend === 'jaeger' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Jaeger API URL
                </label>
                <input
                  type="text"
                  value={prerequisites.jaegerUrl}
                  onChange={(e) => setPrerequisites(prev => ({ ...prev, jaegerUrl: e.target.value }))}
                  placeholder="http://localhost:16686"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Default: http://localhost:16686</p>
              </div>
            )}

            {prerequisites.tracingBackend === 'tempo' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tempo API URL
                </label>
                <input
                  type="text"
                  value={prerequisites.tempoUrl}
                  onChange={(e) => setPrerequisites(prev => ({ ...prev, tempoUrl: e.target.value }))}
                  placeholder="http://localhost:3200"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Default: http://localhost:3200</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Primary Service Name (Optional)
              </label>
              <input
                type="text"
                value={prerequisites.serviceName}
                onChange={(e) => setPrerequisites(prev => ({ ...prev, serviceName: e.target.value }))}
                placeholder="qa-pr-dashboard-api"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Reference service name. Service names are automatically extracted from trace attributes:
                <code className="bg-gray-100 px-1 rounded ml-1">service.name</code> or 
                <code className="bg-gray-100 px-1 rounded ml-1">k8s.deployment.name</code>
              </p>
              <p className="text-xs text-blue-600 mt-1">
                💡 Tip: This field is for reference only. All services in traces will be automatically discovered.
              </p>
            </div>

            {namespace && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Info className="w-5 h-5 text-blue-600" />
                  <span className="font-semibold text-blue-900">Namespace Alignment</span>
                </div>
                <p className="text-sm text-blue-800">
                  Flow Tracing is aligned with namespace: <strong>{namespace}</strong>
                </p>
                <p className="text-xs text-blue-700 mt-1">
                  Traces will be filtered to show only services from this namespace. You can override this in the filters after setup.
                </p>
              </div>
            )}

            {prerequisitesChecked && (
              <div className="space-y-2">
                <div className={`p-3 rounded-lg ${prerequisites.tracingEnabled ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  <div className="flex items-center gap-2">
                    {prerequisites.tracingEnabled ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600" />
                    )}
                    <span className={`font-medium ${prerequisites.tracingEnabled ? 'text-green-800' : 'text-red-800'}`}>
                      Flow Analyzer: {prerequisites.tracingEnabled ? 'Available' : 'Not Available'}
                    </span>
                  </div>
                  {!prerequisites.tracingEnabled && (
                    <p className="text-sm text-red-700 mt-1 ml-7">
                      Ensure Flow Analyzer service is loaded in API server
                    </p>
                  )}
                </div>

                {prerequisites.tracingBackend && prerequisites.tracingBackend !== 'none' && (
                  <div className={`p-3 rounded-lg ${prerequisites.collectorEnabled ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                    <div className="flex items-center gap-2">
                      {prerequisites.collectorEnabled ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-yellow-600" />
                      )}
                      <span className={`font-medium ${prerequisites.collectorEnabled ? 'text-green-800' : 'text-yellow-800'}`}>
                        Tracing Backend ({prerequisites.tracingBackend}): {prerequisites.collectorEnabled ? 'Connected' : 'Not Connected'}
                      </span>
                    </div>
                    {!prerequisites.collectorEnabled && (
                      <p className="text-sm text-yellow-700 mt-1 ml-7">
                        {prerequisites.tracingBackend === 'jaeger' 
                          ? `Start Jaeger: docker compose -f docker-compose.tracing.yml up -d jaeger`
                          : `Start Tempo: docker compose -f docker-compose.tracing.yml up -d tempo`}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Check Prerequisites
              </button>
              {prerequisites.tracingEnabled && (prerequisites.tracingBackend === 'none' || prerequisites.collectorEnabled) && (
                <button
                  type="button"
                  onClick={() => setShowPrerequisites(false)}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                >
                  Continue to Flow Visualization
                </button>
              )}
            </div>
          </form>

          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-semibold text-gray-900 mb-2">Quick Start Guide</h4>
            <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
              <li>Start Docker services: <code className="bg-gray-200 px-1 rounded">docker compose -f docker-compose.tracing.yml up -d</code></li>
              <li>Configure API server with tracing enabled in <code className="bg-gray-200 px-1 rounded">api-server/.env</code></li>
              <li>Restart API server to load Flow Analyzer service</li>
              <li>Select your tracing backend above and click &quot;Check Prerequisites&quot;</li>
              <li>Once all checks pass, click &quot;Continue to Flow Visualization&quot;</li>
            </ol>
          </div>
        </div>
      </div>
      ) : (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Network className="w-6 h-6" />
              Service Flow Visualization
            </h2>
            <p className="text-gray-600 mt-1">Track and visualize microservice request flows</p>
          </div>
          <button
            onClick={() => setShowPrerequisites(true)}
            className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
          >
            Settings
          </button>
        </div>

        {error && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-600" />
            <p className="text-yellow-800 text-sm">{error}</p>
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Namespace
            </label>
            <select
              value={filters.namespace || namespace || 'ccs'}
              onChange={(e) => setFilters(prev => ({ ...prev, namespace: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ccs">ccs</option>
              <option value="dbaas">dbaas</option>
              <option value="default">default (development)</option>
              {namespace && namespace !== 'ccs' && namespace !== 'dbaas' && namespace !== 'default' && (
                <option value={namespace}>{namespace}</option>
              )}
            </select>
            {namespace && (
              <p className="text-xs text-blue-600 mt-1">
                From K8s: <strong>{namespace}</strong> (flows filtered to ccs/dbaas)
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Only traces from <strong>ccs</strong> or <strong>dbaas</strong> namespaces are collected
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Operation
            </label>
            <select
              value={filters.operation}
              onChange={(e) => setFilters(prev => ({ ...prev, operation: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Operations</option>
              {operations.map(op => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Time
            </label>
            <input
              type="datetime-local"
              value={filters.startTime}
              onChange={(e) => setFilters(prev => ({ ...prev, startTime: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              End Time
            </label>
            <input
              type="datetime-local"
              value={filters.endTime}
              onChange={(e) => setFilters(prev => ({ ...prev, endTime: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Namespace Resources (Pods & Deployments) */}
        {(filters.namespace || namespace) && (filters.namespace !== 'all') && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Namespace Resources: <span className="text-blue-600">{filters.namespace || namespace}</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-gray-700 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Pods
                  </h4>
                  <span className="text-sm font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">
                    {pods.length} {pods.length === 1 ? 'pod' : 'pods'}
                  </span>
                </div>
                {loadingResources ? (
                  <div className="text-center py-4">
                    <p className="text-sm text-gray-500">Loading pods...</p>
                  </div>
                ) : pods.length > 0 ? (
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                    {pods.map((pod: any) => (
                      <div key={pod.name} className="text-sm bg-white p-3 rounded border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all">
                        <div className="font-medium text-gray-900 flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${
                            pod.status === 'Running' && pod.ready ? 'bg-green-500' : 
                            pod.status === 'Running' ? 'bg-yellow-500' : 'bg-red-500'
                          }`}></div>
                          {pod.name}
                        </div>
                        <div className="text-xs text-gray-600 mt-2 space-y-1">
                          <div className="flex items-center gap-2">
                            <span>Status:</span>
                            <span className={`font-medium ${
                              pod.status === 'Running' ? 'text-green-600' : 
                              pod.status === 'Pending' ? 'text-yellow-600' : 'text-red-600'
                            }`}>
                              {pod.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span>Ready:</span>
                            {pod.ready ? (
                              <span className="text-green-600 font-medium">✓ Ready</span>
                            ) : (
                              <span className="text-red-600 font-medium">✗ Not Ready</span>
                            )}
                          </div>
                          {pod.restarts !== undefined && (
                            <div className="flex items-center gap-2">
                              <span>Restarts:</span>
                              <span className={pod.restarts > 0 ? 'text-yellow-600 font-medium' : 'text-gray-600'}>
                                {pod.restarts}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-gray-500">No pods found in this namespace</p>
                  </div>
                )}
              </div>
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-gray-700">Deployments</h4>
                  <span className="text-sm text-gray-500">{deployments.length} {deployments.length === 1 ? 'deployment' : 'deployments'}</span>
                </div>
                {loadingResources ? (
                  <p className="text-sm text-gray-500">Loading deployments...</p>
                ) : deployments.length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {deployments.map((deployment: any) => (
                      <div key={deployment.name} className="text-sm bg-white p-2 rounded border border-gray-200 hover:bg-gray-50">
                        <div className="font-medium text-gray-900">{deployment.name}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          Ready: <span className="text-green-600">{deployment.readyReplicas || 0}</span>/{deployment.replicas || 0} | 
                          Available: <span className="text-blue-600">{deployment.availableReplicas || 0}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No deployments found in this namespace</p>
                )}
              </div>
            </div>
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-800">
                <strong>💡 Tip:</strong> Make requests to services in the <strong>{filters.namespace || namespace}</strong> namespace to see them tracked here in real-time. 
                Flows are automatically collected every 30 seconds. {pods.length > 0 && `Found ${pods.length} pods ready to track.`}
              </p>
            </div>
          </div>
        )}

        {/* Service Dependency Graph */}
        {dependencies && dependencies.nodes.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Service Dependencies
            </h3>
            <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {dependencies.nodes.map((node: any) => {
                  const outgoingEdges = dependencies.edges.filter((e: any) => e.from === node.id)
                  const incomingEdges = dependencies.edges.filter((e: any) => e.to === node.id)
                  
                  return (
                    <div
                      key={node.id}
                      className="bg-white rounded-lg p-4 border border-gray-200 hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                        <span className="font-semibold text-sm">{node.service.name}</span>
                      </div>
                      <div className="text-xs text-gray-500 mb-1">
                        {node.service.namespace}
                      </div>
                      <div className="text-xs text-gray-600 mt-2">
                        <div>→ {outgoingEdges.length} downstream</div>
                        <div>← {incomingEdges.length} upstream</div>
                      </div>
                    </div>
                  )
                })}
              </div>
              
              {dependencies.edges.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Service Calls</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {dependencies.edges.slice(0, 10).map((edge: any, idx: number) => (
                      <div key={idx} className="text-xs text-gray-600 flex items-center gap-2">
                        <span className="font-medium">{edge.from.split('/')[1]}</span>
                        <span>→</span>
                        <span className="font-medium">{edge.to.split('/')[1]}</span>
                        <span className="text-gray-400">
                          ({edge.callCount} calls, {formatDuration(edge.avgLatency)} avg)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Flows List */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Recent Flows {loading && <span className="text-sm text-gray-500">(Loading...)</span>}
            </h3>
          </div>

          {/* Search Input */}
          <div className="mb-4">
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={`Search all pods, services, operations, trace IDs, and log content in ${filters.namespace || namespace || 'all'} namespace...`}
                className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Filter className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              )}
            </div>
            {searchTerm && (
              <p className="text-xs text-gray-500 mt-1">
                🔍 Searching ALL logs from ALL {pods.length > 0 ? `${pods.length} pods` : 'pods'} in {filters.namespace || namespace || 'all'} namespace, services, operations, trace entries, and log content from all containers...
                {loadingLogs && (
                  <span className="text-blue-600 ml-2 font-medium">
                    (Fetching logs from all containers...)
                  </span>
                )}
                {!loadingLogs && podLogs.size > 0 && (
                  <span className="text-green-600 ml-2 font-medium">
                    (Searched {podLogs.size} pods with logs)
                  </span>
                )}
              </p>
            )}
          </div>
          
          {/* Show matching pods when searching, even if no flows - consolidated logic */}
          {searchTerm.trim() && displayedFlows.length === 0 && !loading && (() => {
            const searchLower = searchTerm.toLowerCase().trim();
            const targetNamespace = (filters.namespace || namespace || '').toLowerCase();
            
            // Find matching pods (search in name, deployment, labels, container names, IP, AND log content)
            const matchingPods = pods.filter(pod => {
              const podName = (pod.name || '').toLowerCase();
              const podNamespace = (pod.namespace || '').toLowerCase();
              const deployment = (pod.deployment || '').toLowerCase();
              const podIP = (pod.podIP || '').toLowerCase();
              
              if (targetNamespace && podNamespace !== targetNamespace) return false;
              
              // Search in pod name (partial match - so "tcpwave" matches "tcpwave-ff59cddf-shvff")
              if (podName.includes(searchLower)) return true;
              
              // Also check if search term might be part of pod name pattern
              // This helps when searching for resource names that might be in pod names
              if (searchLower.length > 3 && podName.includes(searchLower.substring(0, 3))) return true;
              
              // Search in deployment name
              if (deployment && deployment.includes(searchLower)) return true;
              
              // Search in pod IP
              if (podIP && podIP.includes(searchLower)) return true;
              
              // Search in container names
              if (pod.containers && Array.isArray(pod.containers)) {
                const containerMatches = pod.containers.some((container: any) => {
                  const containerName = String(container.name || '').toLowerCase();
                  const containerImage = String(container.image || '').toLowerCase();
                  return containerName.includes(searchLower) || containerImage.includes(searchLower);
                });
                if (containerMatches) return true;
              }
              
              // Search in labels (both keys and values)
              if (pod.labels) {
                const labelMatches = Object.entries(pod.labels).some(([key, value]: [string, any]) => {
                  const keyLower = key.toLowerCase();
                  const valueLower = String(value || '').toLowerCase();
                  return keyLower.includes(searchLower) || valueLower.includes(searchLower);
                });
                if (labelMatches) return true;
              }
              
              // Search in log content (if logs have been fetched)
              const podLogContent = podLogs.get(pod.name);
              if (podLogContent && typeof podLogContent === 'string') {
                const logContentLower = podLogContent.toLowerCase();
                if (logContentLower.includes(searchLower)) {
                  return true;
                }
              }
              
              return false;
            });

            // If pods match, show them
            if (matchingPods.length > 0) {
              // Find first request timestamp for each pod from flows
              const getFirstRequestTimeForPod = (podName: string): number | null => {
                let earliestTime: number | null = null
                flows.forEach(flow => {
                  if (flow.spanSequence && flow.spanSequence.length > 0) {
                    flow.spanSequence.forEach(span => {
                      // Match exact pod name or partial match (for cases where pod names might have suffixes)
                      const spanPodName = (span.podName || '').toLowerCase()
                      const searchPodName = podName.toLowerCase()
                      if ((spanPodName === searchPodName || 
                           spanPodName.includes(searchPodName) || 
                           searchPodName.includes(spanPodName.split('-')[0])) && span.startTime) {
                        if (!earliestTime || span.startTime < earliestTime) {
                          earliestTime = span.startTime
                        }
                      }
                    })
                  } else if (flow.nodes) {
                    flow.nodes.forEach(node => {
                      const nodePodName = (node.service.pod || '').toLowerCase()
                      const searchPodName = podName.toLowerCase()
                      if ((nodePodName === searchPodName || 
                           nodePodName.includes(searchPodName) || 
                           searchPodName.includes(nodePodName.split('-')[0])) && flow.startTime) {
                        if (!earliestTime || flow.startTime < earliestTime) {
                          earliestTime = flow.startTime
                        }
                      }
                    })
                  }
                })
                return earliestTime
              }

              // Sort pods by first request time (if available) or by name
              const sortedMatchingPods = [...matchingPods].sort((a, b) => {
                const timeA = getFirstRequestTimeForPod(a.name)
                const timeB = getFirstRequestTimeForPod(b.name)
                if (timeA && timeB) return timeA - timeB
                if (timeA) return -1
                if (timeB) return 1
                return a.name.localeCompare(b.name)
              })

              return (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                  <h4 className="text-lg font-semibold text-blue-900 mb-4 flex items-center gap-2">
                    <Filter className="w-5 h-5" />
                    Found {matchingPods.length} matching pod{matchingPods.length !== 1 ? 's' : ''} in {filters.namespace || namespace || 'all'} namespace
                    {pods.length > 0 && (
                      <span className="text-sm font-normal text-blue-700 ml-2">
                        (Searched all {pods.length} pods, {podLogs.size} with logs fetched)
                      </span>
                    )}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {sortedMatchingPods.map((pod, podIndex) => {
                      const firstRequestTime = getFirstRequestTimeForPod(pod.name)
                      
                      // Extract timestamp from logs where search term appears
                      const getLogTimestamp = (): { timestamp: Date | null, line: string | null } => {
                        const podLogContent = podLogs.get(pod.name)
                        if (!podLogContent || typeof podLogContent !== 'string') {
                          return { timestamp: null, line: null }
                        }
                        
                        const searchLower = searchTerm.toLowerCase().trim()
                        const logLines = podLogContent.split('\n')
                        
                        // Find first line containing search term
                        for (const line of logLines) {
                          if (line.toLowerCase().includes(searchLower)) {
                            // Try to extract timestamp from log line
                            // Common formats: ISO 8601, RFC3339, or custom formats
                            const isoMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*[Z]?)/)
                            if (isoMatch) {
                              const date = new Date(isoMatch[1])
                              if (!isNaN(date.getTime())) {
                                return { timestamp: date, line: line.substring(0, 100) }
                              }
                            }
                            
                            // Try RFC3339 format
                            const rfcMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/)
                            if (rfcMatch) {
                              const date = new Date(rfcMatch[1])
                              if (!isNaN(date.getTime())) {
                                return { timestamp: date, line: line.substring(0, 100) }
                              }
                            }
                            
                            // Return the line even if we can't parse timestamp
                            return { timestamp: null, line: line.substring(0, 100) }
                          }
                        }
                        
                        return { timestamp: null, line: null }
                      }
                      
                      const logTimestamp = getLogTimestamp()
                      const foundInLogs = podLogs.has(pod.name) && logTimestamp.line
                      
                      return (
                      <div 
                        key={pod.name} 
                        className="relative bg-white rounded-lg p-4 border-2 border-blue-200 hover:shadow-md transition-shadow cursor-pointer"
                        onClick={() => {
                          setSelectedPodForLogs({
                            namespace: pod.namespace,
                            name: pod.name,
                            container: pod.containers?.[0]?.name
                          })
                        }}
                      >
                        {/* Pod Number Badge */}
                        <div className={`absolute -top-3 -left-3 w-10 h-10 rounded-full flex items-center justify-center font-bold text-base shadow-lg z-10 ${
                          podIndex === 0 ? 'bg-green-600 text-white' :
                          podIndex === 1 ? 'bg-blue-600 text-white' :
                          podIndex === 2 ? 'bg-purple-600 text-white' :
                          podIndex === 3 ? 'bg-orange-600 text-white' :
                          podIndex === 4 ? 'bg-pink-600 text-white' :
                          'bg-gray-600 text-white'
                        }`}>
                          {podIndex + 1}
                        </div>
                        
                        <div className="flex items-center gap-2 mb-2 mt-2">
                          <div className={`w-3 h-3 rounded-full ${
                            pod.status === 'Running' ? 'bg-green-500' :
                            pod.status === 'Pending' ? 'bg-yellow-500' :
                            pod.status === 'Failed' || pod.status === 'Error' ? 'bg-red-500' :
                            'bg-gray-400'
                          }`}></div>
                          <span className="font-mono font-semibold text-sm text-gray-900">{pod.name}</span>
                        </div>
                        <div className="text-xs text-gray-600 space-y-1">
                          <div>Status: <span className="font-medium">{pod.status}</span></div>
                          <div>Ready: {pod.ready ? <span className="text-green-600 font-medium">✓ Ready</span> : <span className="text-red-600">✗ Not Ready</span>}</div>
                          {pod.deployment && (
                            <div>Deployment: <span className="font-medium">{pod.deployment}</span></div>
                          )}
                          <div>Namespace: <span className="font-medium">{pod.namespace}</span></div>
                          {pod.podIP && (
                            <div>IP: <span className="font-mono text-xs">{pod.podIP}</span></div>
                          )}
                        </div>
                        
                        {/* Timestamp Section - Show log timestamp first if found in logs, then flow timestamp */}
                        {foundInLogs && logTimestamp.timestamp ? (
                          <div className="mt-3 pt-3 border-t-2 border-green-400 bg-green-100 rounded px-3 py-2 shadow-sm">
                            <div className="text-xs text-green-900 font-bold mb-1.5 flex items-center gap-1">
                              📝 <span className="text-sm">Found in Logs At:</span>
                            </div>
                            <div className="text-base text-green-950 font-mono font-bold">
                              {logTimestamp.timestamp.toLocaleString()}
                            </div>
                            <div className="text-[10px] text-green-700 mt-1">
                              ✓ &quot;{searchTerm}&quot; found in pod logs
                            </div>
                            {firstRequestTime && (
                              <div className="mt-2 pt-2 border-t border-green-300">
                                <div className="text-[10px] text-green-800 font-semibold mb-1">
                                  🕐 Request in Flow Trace:
                                </div>
                                <div className="text-xs text-green-900 font-mono">
                                  {formatTimestamp(firstRequestTime)}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : firstRequestTime ? (
                          <div className="mt-3 pt-3 border-t-2 border-blue-400 bg-blue-100 rounded px-3 py-2 shadow-sm">
                            <div className="text-xs text-blue-900 font-bold mb-1.5 flex items-center gap-1">
                              🕐 <span className="text-sm">Request Received At:</span>
                            </div>
                            <div className="text-base text-blue-950 font-mono font-bold">
                              {formatTimestamp(firstRequestTime)}
                            </div>
                            <div className="text-[10px] text-blue-700 mt-1">
                              ✓ This pod received a request in the flow trace
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 pt-3 border-t-2 border-orange-300 bg-orange-50 rounded px-3 py-2">
                            <div className="text-xs text-orange-800 font-bold mb-1.5 flex items-center gap-1">
                              🕐 <span>Pod Started:</span>
                            </div>
                            <div className="text-sm text-orange-900 font-mono font-semibold">
                              {pod.startTime ? new Date(pod.startTime).toLocaleString() : 'N/A'}
                            </div>
                            <div className="text-[10px] text-orange-700 mt-1 italic">
                              ⚠️ No request flow data found - pod may not have received traced requests yet
                            </div>
                          </div>
                        )}
                        
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          {podLogs.has(pod.name) ? (
                            <div>
                              <p className="text-xs text-green-700 font-medium mb-1">
                                ✅ Logs found - This pod contains matching log entries in {pod.containers?.length > 0 ? `all ${pod.containers.length} container${pod.containers.length !== 1 ? 's' : ''}` : 'containers'}
                              </p>
                              <p className="text-xs text-blue-700 flex items-center gap-1">
                                <FileText className="w-3 h-3" />
                                Click to view logs
                              </p>
                            </div>
                          ) : loadingLogs ? (
                            <p className="text-xs text-gray-600">
                              🔍 Searching logs from all containers...
                            </p>
                          ) : (
                            <p className="text-xs text-blue-700 flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              Click to view logs
                            </p>
                          )}
                        </div>
                      </div>
                      )
                    })}
                  </div>
                </div>
              );
            }
            
            // If no pods match, show "no results" message
            return (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                <p className="text-yellow-800 font-medium">
                  No pods or flows found matching &quot;{searchTerm}&quot; in {filters.namespace || namespace || 'all'} namespace.
                </p>
                <p className="text-sm text-yellow-700 mt-2">
                  Try searching for a different pod name, service name, or operation.
                </p>
                {pods.length > 0 && (
                  <p className="text-xs text-yellow-600 mt-2">
                    Found {pods.length} total pods in this namespace. Make sure your search term matches a pod name.
                  </p>
                )}
              </div>
            );
          })()}

          {/* Show empty state only when not searching */}
          {flows.length === 0 && !loading && !searchTerm.trim() && (
            <div className="bg-gray-50 rounded-lg p-8 text-center">
              <p className="text-gray-600">No flows found. Flows will appear here as requests are traced.</p>
              <p className="text-sm text-gray-500 mt-2">
                Make sure tracing is enabled and services are sending trace data.
              </p>
            </div>
          )}

          {/* Display filtered flows - sorted by startTime (oldest first) */}
          <div className="space-y-4">
            {displayedFlows
              .sort((a, b) => (a.startTime || 0) - (b.startTime || 0)) // Sort chronologically (oldest first)
              .map((flow, flowIndex) => {
                const flowNumber = flowIndex + 1 // Flow number in sequence (1, 2, 3...)
              // Find impacted pods and deployments based on search
              const targetNamespace = (filters.namespace || namespace || '').toLowerCase();
              const searchLower = searchTerm.toLowerCase().trim();
            
            const impactedPods = flow.nodes
              .filter(node => {
                const namespace = (node.service.namespace || '').toLowerCase();
                if (targetNamespace && namespace !== targetNamespace) return false;
                
                if (!searchTerm.trim()) return true;
                
                const podName = (node.service.pod || '').toLowerCase();
                const serviceName = (node.service.name || '').toLowerCase();
                return podName.includes(searchLower) || serviceName.includes(searchLower);
              })
              .map(node => ({
                podName: node.service.pod || 'unknown-pod',
                serviceName: node.service.name,
                namespace: node.service.namespace,
              }));

            // Match pods to deployments
            const impactedDeployments = new Set<string>();
            impactedPods.forEach(pod => {
              // Try to extract deployment name from pod name (usually deployment-name-<hash>)
              if (pod.podName && pod.podName !== 'unknown-pod') {
                const deploymentMatch = pod.podName.match(/^(.+?)-[a-z0-9]{5,10}$/);
                if (deploymentMatch) {
                  impactedDeployments.add(deploymentMatch[1]);
                }
                // Also try service name as deployment name
                if (pod.serviceName) {
                  impactedDeployments.add(pod.serviceName);
                }
              }
            });

            return (
              <div
                key={flow.flowId}
                className="bg-white border-2 border-gray-300 rounded-lg p-4 hover:shadow-lg transition-shadow cursor-pointer relative"
                onClick={() => setSelectedFlow(flow)}
              >
                {/* Flow Number Badge - Top Left */}
                <div className="absolute top-3 left-3 bg-blue-600 text-white rounded-lg w-10 h-10 flex items-center justify-center font-bold text-lg shadow-lg z-10" title={`Flow #${flowNumber} - ${flowNumber === 1 ? 'First' : flowNumber === 2 ? 'Second' : flowNumber === 3 ? 'Third' : `${flowNumber}th`} request in sequence`}>
                  {flowNumber}
                </div>
                
                <div className="flex items-center justify-between ml-14">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-gray-900">{flow.operationName}</span>
                      {flow.uiEvent && (
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          {flow.uiEvent}
                        </span>
                      )}
                      <span className={`text-xs px-2 py-1 rounded ${
                        flow.metadata.errorCount > 0 
                          ? 'bg-red-100 text-red-800' 
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {flow.metadata.errorCount > 0 ? 'Errors' : 'Success'}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <div>Trace ID: <code className="text-xs bg-gray-100 px-1 rounded">{flow.traceId.substring(0, 16)}...</code></div>
                      <div>Duration: {formatDuration(flow.duration)}</div>
                      <div>
                        Target Namespace: <strong>{filters.namespace || namespace || 'all'}</strong>
                        {flow.metadata?.namespaces && flow.metadata.namespaces.length > 0 && (
                          <span className="text-xs text-gray-500 ml-2">
                            (services in: {flow.metadata.namespaces.join(', ')})
                          </span>
                        )}
                      </div>
                      <div>
                        Services: {flow.metadata.serviceCount} | 
                        Pods: {flow.nodes.filter(n => n.service.pod && n.service.pod !== 'unknown-pod').length} | 
                        Spans: {flow.metadata.totalSpans}
                      </div>
                      {/* Enhanced Pod Flow Display - Show all pods in sequence */}
                      {(flow.nodes.length > 0 || (flow.spanSequence && flow.spanSequence.length > 0)) && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <div className="text-xs text-gray-500 mb-3 flex items-center gap-2">
                            <strong>Request Flow Sequence ({filters.namespace || namespace || 'all'} namespace):</strong>
                            {searchTerm.trim() && (
                              <span className="text-blue-600 text-xs">🔍 Filtered by: &quot;{searchTerm}&quot;</span>
                            )}
                          </div>
                          
                          {/* Use spanSequence if available (chronological), otherwise use nodes */}
                          {flow.spanSequence && flow.spanSequence.length > 0 ? (
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                              {(() => {
                                // Get the first span (earliest timestamp) for the header
                                const sortedSpans = [...flow.spanSequence].sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
                                const firstRequestSpan = sortedSpans[0]
                                const firstRequestTime = firstRequestSpan?.startTime ? formatTimestamp(firstRequestSpan.startTime) : formatTimestamp(flow.startTime)
                                
                                return (
                                  <>
                                    <div className="mb-3 pb-2 border-b border-gray-300 bg-blue-50 rounded p-2">
                                      <div className="text-xs font-semibold text-gray-700">
                                        🕐 First Request Received: <span className="font-mono text-blue-700">{firstRequestTime}</span>
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      {flow.spanSequence
                                        .filter(span => {
                                          const targetNamespace = (filters.namespace || namespace || '').toLowerCase()
                                          const spanNamespace = (span.namespace || 'default').toLowerCase()
                                          if (targetNamespace && spanNamespace !== targetNamespace) return false
                                          
                                          // If searching, only show matching spans
                                          if (searchTerm.trim()) {
                                            const searchLower = searchTerm.toLowerCase().trim()
                                            const podName = (span.podName || '').toLowerCase()
                                            const serviceName = (span.serviceName || '').toLowerCase()
                                            return podName.includes(searchLower) || serviceName.includes(searchLower)
                                          }
                                          return true
                                        })
                                        .sort((a, b) => {
                                          // Sort by startTime to maintain chronological order (first pod that receives request appears first)
                                          return (a.startTime || 0) - (b.startTime || 0)
                                        })
                                        .map((span, idx, filteredArray) => {
                                          const podName = span.podName && span.podName !== 'unknown-pod'
                                            ? span.podName
                                            : 'unknown-pod'
                                          const isInTargetNamespace = (span.namespace || 'default').toLowerCase() === (filters.namespace || namespace || '').toLowerCase()
                                          const isMatchingSearch = searchTerm.trim() && (
                                            podName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                            span.serviceName.toLowerCase().includes(searchTerm.toLowerCase())
                                          )
                                          
                                          // Calculate relative time from first pod (when request reaches first pod = 0ms)
                                          const firstSpan = filteredArray[0]
                                          const relativeStartTime = firstSpan && firstSpan.startTime
                                            ? ((span.startTime - firstSpan.startTime) / 1000000).toFixed(0) // Convert nanoseconds to milliseconds
                                            : '0'
                                          
                                          return (
                                            <div 
                                              key={`${span.spanId}-${idx}`} 
                                              className={`relative flex flex-col items-center p-3 rounded-lg border-2 min-w-[140px] ${
                                                isMatchingSearch ? 'bg-blue-100 border-blue-400 shadow-md' : 
                                                isInTargetNamespace ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-300'
                                              }`}
                                            >
                                              {/* Numbered Box Badge - More Prominent */}
                                              <div className={`absolute -top-4 -left-4 w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shadow-xl z-20 border-2 border-white ${
                                                idx === 0 ? 'bg-green-600 text-white' :
                                                idx === 1 ? 'bg-blue-600 text-white' :
                                                idx === 2 ? 'bg-purple-600 text-white' :
                                                idx === 3 ? 'bg-orange-600 text-white' :
                                                idx === 4 ? 'bg-pink-600 text-white' :
                                                'bg-gray-600 text-white'
                                              }`} title={`Pod #${idx + 1} in request sequence`}>
                                                {idx + 1}
                                              </div>
                                              
                                              {/* Request Timestamp - Prominent at top */}
                                              {span.startTime && (
                                                <div className={`w-full mb-2 pb-2 border-b ${isMatchingSearch ? 'border-blue-300' : 'border-gray-200'} ${isMatchingSearch ? 'bg-blue-50' : 'bg-gray-50'} rounded px-2 py-1`}>
                                                  <div className="text-[10px] text-gray-600 mb-0.5">
                                                    🕐 Request Received:
                                                  </div>
                                                  <div className={`text-xs font-mono font-semibold ${isMatchingSearch ? 'text-blue-800' : 'text-gray-700'}`}>
                                                    {formatTimestamp(span.startTime)}
                                                  </div>
                                                  {idx > 0 && (
                                                    <div className="text-[10px] text-blue-600 mt-0.5">
                                                      +{relativeStartTime}ms from start
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                              
                                              {/* Pod Name */}
                                              <div className="text-center">
                                                <div className={`font-mono text-sm font-semibold mb-1 ${
                                                  isMatchingSearch ? 'text-blue-900' :
                                                  isInTargetNamespace ? 'text-blue-700' : 'text-gray-700'
                                                }`}>
                                                  {podName.length > 20 ? `${podName.substring(0, 17)}...` : podName}
                                                </div>
                                                <div className="text-xs text-gray-600">{span.serviceName}</div>
                                                <div className="text-xs text-gray-400">[{span.namespace}]</div>
                                              </div>
                                              
                                              {/* Timing Info */}
                                              <div className="mt-2 pt-2 border-t border-gray-200 w-full text-center">
                                                <div className="text-xs text-gray-600 mb-1">
                                                  {idx === 0 ? (
                                                    <span className="text-green-600 font-semibold">Start</span>
                                                  ) : (
                                                    <span className="text-blue-600">+{relativeStartTime}ms</span>
                                                  )}
                                                </div>
                                                <div className="text-xs text-gray-400 mt-1">
                                                  Duration: {formatDuration(span.duration)}
                                                </div>
                                              </div>
                                              
                                              {/* Indicators */}
                                              <div className="absolute top-2 right-2 flex gap-1">
                                                {isInTargetNamespace && <span className="text-blue-600 text-xs">⭐</span>}
                                                {isMatchingSearch && <span className="text-blue-600 text-xs">🔍</span>}
                                              </div>
                                            </div>
                                          )
                                        })}
                                    </div>
                                  </>
                                )
                              })()}
                              {flow.spanSequence.length > 0 && flow.spanSequence.filter(s => {
                                const targetNamespace = (filters.namespace || namespace || '').toLowerCase()
                                const spanNamespace = (s.namespace || 'default').toLowerCase()
                                return !targetNamespace || spanNamespace === targetNamespace
                              }).length === 0 && (
                                <div className="text-gray-400 italic text-xs p-2">No pods found in selected namespace</div>
                              )}
                            </div>
                          ) : (
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                              <div className="mb-3 pb-2 border-b border-gray-300 bg-blue-50 rounded p-2">
                                <div className="text-xs font-semibold text-gray-700">
                                  🕐 First Request Received: <span className="font-mono text-blue-700">{formatTimestamp(flow.startTime)}</span>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {flow.nodes
                                  .filter(node => {
                                    const targetNamespace = (filters.namespace || namespace || '').toLowerCase()
                                    const nodeNamespace = (node.service.namespace || 'default').toLowerCase()
                                    if (targetNamespace && nodeNamespace !== targetNamespace) return false
                                    
                                    // If searching, only show matching nodes
                                    if (searchTerm.trim()) {
                                      const searchLower = searchTerm.toLowerCase().trim()
                                      const podName = (node.service.pod || '').toLowerCase()
                                      const serviceName = (node.service.name || '').toLowerCase()
                                      return podName.includes(searchLower) || serviceName.includes(searchLower)
                                    }
                                    return true
                                  })
                                  .map((node, idx) => {
                                    const podName = node.service.pod && node.service.pod !== 'unknown-pod'
                                      ? node.service.pod
                                      : 'unknown-pod'
                                    const isInTargetNamespace = (node.service.namespace || 'default').toLowerCase() === (filters.namespace || namespace || '').toLowerCase()
                                    const isMatchingSearch = searchTerm.trim() && (
                                      podName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                      node.service.name.toLowerCase().includes(searchTerm.toLowerCase())
                                    )
                                    
                                    return (
                                      <div 
                                        key={node.id} 
                                        className={`relative flex flex-col items-center p-3 rounded-lg border-2 min-w-[140px] ${
                                          isMatchingSearch ? 'bg-blue-100 border-blue-400 shadow-md' : 
                                          isInTargetNamespace ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-300'
                                        }`}
                                      >
                                        {/* Numbered Box Badge - More Prominent */}
                                        <div className={`absolute -top-4 -left-4 w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shadow-xl z-20 border-2 border-white ${
                                          idx === 0 ? 'bg-green-600 text-white' :
                                          idx === 1 ? 'bg-blue-600 text-white' :
                                          idx === 2 ? 'bg-purple-600 text-white' :
                                          idx === 3 ? 'bg-orange-600 text-white' :
                                          idx === 4 ? 'bg-pink-600 text-white' :
                                          'bg-gray-600 text-white'
                                        }`} title={`Pod #${idx + 1} in request sequence`}>
                                          {idx + 1}
                                        </div>
                                        
                                        {/* Pod Name */}
                                        <div className="mt-2 text-center">
                                          <div className={`font-mono text-sm font-semibold mb-1 ${
                                            isMatchingSearch ? 'text-blue-900' :
                                            isInTargetNamespace ? 'text-blue-700' : 'text-gray-700'
                                          }`}>
                                            {podName.length > 20 ? `${podName.substring(0, 17)}...` : podName}
                                          </div>
                                          <div className="text-xs text-gray-600">{node.service.name}</div>
                                          <div className="text-xs text-gray-400">[{node.service.namespace}]</div>
                                        </div>
                                        
                                        {/* Timing Info */}
                                        {flow.startTime && (
                                          <div className="mt-2 pt-2 border-t border-gray-200 w-full text-center">
                                            <div className="text-xs text-gray-500 font-mono">
                                              🕐 {formatTimestamp(flow.startTime)}
                                            </div>
                                          </div>
                                        )}
                                        
                                        {/* Indicators */}
                                        <div className="absolute top-2 right-2 flex gap-1">
                                          {isInTargetNamespace && <span className="text-blue-600 text-xs">⭐</span>}
                                          {isMatchingSearch && <span className="text-blue-600 text-xs">🔍</span>}
                                        </div>
                                      </div>
                                    )
                                  })}
                                {flow.nodes.filter(n => {
                                  const targetNamespace = (filters.namespace || namespace || '').toLowerCase()
                                  const nodeNamespace = (n.service.namespace || 'default').toLowerCase()
                                  return !targetNamespace || nodeNamespace === targetNamespace
                                }).length === 0 && (
                                  <div className="text-gray-400 italic text-xs p-2">No pods found in selected namespace</div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="text-xs text-gray-500">Time: {formatTimestamp(flow.startTime)}</div>
                      
                      {/* Show impacted pods and deployments when searching */}
                      {searchTerm.trim() && (impactedPods.length > 0 || impactedDeployments.size > 0) && (
                        <div className="mt-3 pt-3 border-t border-blue-200 bg-blue-50 rounded p-3">
                          <div className="text-xs font-semibold text-blue-900 mb-2">
                            🔍 Search Results in {filters.namespace || namespace || 'all'} namespace:
                          </div>
                          {impactedPods.length > 0 && (
                            <div className="mb-2">
                              <div className="text-xs font-medium text-blue-800 mb-1">
                                Impacted Pods ({impactedPods.length}):
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {impactedPods.map((pod, idx) => (
                                  <span 
                                    key={idx}
                                    className="text-xs bg-blue-200 text-blue-900 px-2 py-1 rounded font-mono"
                                  >
                                    {pod.podName}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {impactedDeployments.size > 0 && (
                            <div>
                              <div className="text-xs font-medium text-blue-800 mb-1">
                                Impacted Deployments ({impactedDeployments.size}):
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {Array.from(impactedDeployments).map((deployment, idx) => (
                                  <span 
                                    key={idx}
                                    className="text-xs bg-green-200 text-green-900 px-2 py-1 rounded font-semibold"
                                  >
                                    {deployment}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="ml-4">
                    <div className="flex items-center gap-4 text-sm">
                      <div className="text-center">
                        <div className="text-gray-500">Services</div>
                        <div className="font-semibold">{flow.metadata.serviceCount}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-gray-500">Duration</div>
                        <div className="font-semibold">{formatDuration(flow.duration)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
            })}
          </div>
          
          {searchTerm.trim() && displayedFlows.length === 0 && flows.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
              <p className="text-yellow-800">
                No flows found matching &quot;{searchTerm}&quot; in {filters.namespace || namespace || 'all'} namespace.
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                Try searching for pod names, service names, operation names, or trace IDs.
              </p>
            </div>
          )}
          
          {searchTerm.trim() && displayedFlows.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
              <p className="text-sm text-blue-800">
                Found <strong>{displayedFlows.length}</strong> flow{displayedFlows.length !== 1 ? 's' : ''} matching &quot;{searchTerm}&quot; in {filters.namespace || namespace || 'all'} namespace
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Flow Detail Modal */}
      {selectedFlow && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">
                Flow Details: {selectedFlow.operationName}
              </h3>
              <button
                onClick={() => setSelectedFlow(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* Flow Info */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Trace ID:</span>
                    <code className="ml-2 text-xs bg-white px-2 py-1 rounded">{selectedFlow.traceId}</code>
                  </div>
                  <div>
                    <span className="text-gray-500">Duration:</span>
                    <span className="ml-2 font-semibold">{formatDuration(selectedFlow.duration)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Target Namespace:</span>
                    <span className="ml-2 font-semibold">
                      {filters.namespace || namespace || 'all'}
                      {selectedFlow.metadata?.namespaces && selectedFlow.metadata.namespaces.length > 0 && (
                        <span className="text-xs text-gray-500 ml-2">
                          ({selectedFlow.metadata.namespaces.join(', ')})
                        </span>
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Status:</span>
                    <span className={`ml-2 px-2 py-1 rounded text-xs ${
                      selectedFlow.metadata.errorCount > 0 
                        ? 'bg-red-100 text-red-800' 
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {selectedFlow.metadata.errorCount > 0 ? 'Has Errors' : 'Success'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Services:</span>
                    <span className="ml-2">{selectedFlow.metadata.serviceCount || selectedFlow.nodes.length}</span>
                    {selectedFlow.metadata?.servicesByNamespace && (
                      <span className="text-xs text-gray-500 ml-2">
                        ({Object.entries(selectedFlow.metadata.servicesByNamespace).map(([ns, services]: [string, any]) => 
                          `${ns}: ${services.length}`
                        ).join(', ')})
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-gray-500">Pods:</span>
                    <span className="ml-2">
                      {selectedFlow.nodes.filter(n => n.service.pod && n.service.pod !== 'unknown-pod').length}
                    </span>
                  </div>
                </div>
              </div>

              {/* Service Flow */}
              <div>
                <h4 className="font-semibold text-gray-900 mb-3">
                  Service Flow with Pod Connections
                  {filters.namespace && (
                    <span className="text-sm font-normal text-gray-500 ml-2">
                      (Highlighting services in <strong>{filters.namespace}</strong> namespace)
                    </span>
                  )}
                </h4>
                <div className="space-y-3">
                  {selectedFlow.nodes.map((node, idx) => {
                    const incomingEdges = selectedFlow.edges.filter(e => e.to === node.id)
                    const outgoingEdges = selectedFlow.edges.filter(e => e.from === node.id)
                    const targetNamespace = (filters.namespace || namespace || '').toLowerCase()
                    const isInTargetNamespace = (node.service.namespace || 'default').toLowerCase() === targetNamespace
                    const podName = node.service.pod && node.service.pod !== 'unknown-pod' 
                      ? node.service.pod 
                      : 'unknown-pod'
                    
                    return (
                      <div 
                        key={node.id} 
                        className={`border rounded-lg p-4 ${
                          isInTargetNamespace 
                            ? 'border-blue-400 bg-blue-50' 
                            : 'border-gray-200 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${getStatusColor(node.status)}`}></div>
                            <span className="font-semibold">{node.service.name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              isInTargetNamespace 
                                ? 'bg-blue-200 text-blue-800 font-semibold' 
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {node.service.namespace}
                              {isInTargetNamespace && ' ⭐'}
                            </span>
                          </div>
                          <div className="text-xs">
                            <span className="text-gray-500">Pod: </span>
                            <span className={`font-mono ${
                              podName === 'unknown-pod' ? 'text-gray-400 italic' : 'text-gray-700 font-semibold'
                            }`}>
                              {podName}
                            </span>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-4 gap-4 mt-3 text-sm">
                          <div>
                            <div className="text-gray-500">Requests</div>
                            <div className="font-semibold">{node.metrics.requestCount}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">Errors</div>
                            <div className={`font-semibold ${node.metrics.errorCount > 0 ? 'text-red-600' : ''}`}>
                              {node.metrics.errorCount}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Avg Latency</div>
                            <div className="font-semibold">{formatDuration(node.metrics.avgLatency)}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">P95 Latency</div>
                            <div className="font-semibold">{formatDuration(node.metrics.p95Latency)}</div>
                          </div>
                        </div>

                        {outgoingEdges.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-200">
                            <div className="text-xs text-gray-600 mb-1">
                              <strong>Calls to:</strong>
                            </div>
                            <div className="space-y-1">
                              {outgoingEdges.map(e => {
                                const targetNode = selectedFlow.nodes.find(n => n.id === e.to)
                                if (!targetNode) return null
                                const targetIsInNamespace = (targetNode.service.namespace || 'default').toLowerCase() === targetNamespace
                                const targetPodName = targetNode.service.pod && targetNode.service.pod !== 'unknown-pod'
                                  ? targetNode.service.pod
                                  : 'unknown-pod'
                                
                                return (
                                  <div key={e.to} className="flex items-center gap-2 text-xs">
                                    <span className="text-gray-400">→</span>
                                    <span className={`font-semibold ${
                                      targetIsInNamespace ? 'text-blue-700' : 'text-gray-700'
                                    }`}>
                                      {targetNode.service.name}
                                    </span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                                      targetIsInNamespace 
                                        ? 'bg-blue-200 text-blue-800' 
                                        : 'bg-gray-100 text-gray-600'
                                    }`}>
                                      {targetNode.service.namespace}
                                      {targetIsInNamespace && ' ⭐'}
                                    </span>
                                    <span className="text-gray-500 font-mono">
                                      ({targetPodName})
                                    </span>
                                    <span className="text-gray-400">
                                      [{formatDuration(e.avgLatency)}]
                                    </span>
                                  </div>
                                )
                              }).filter(Boolean)}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Pod Call Timeline - Sequential View Based on Epoch */}
              {selectedFlow.spanSequence && Array.isArray(selectedFlow.spanSequence) && selectedFlow.spanSequence.length > 0 && (
                <div className="mt-6">
                  <h4 className="font-semibold text-gray-900 mb-3">
                    📊 Pod Call Timeline (Sequential by Epoch)
                    {filters.namespace && (
                      <span className="text-sm font-normal text-gray-500 ml-2">
                        ({filters.namespace} namespace pods highlighted)
                      </span>
                    )}
                  </h4>
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    {(() => {
                      // Get the first span (earliest timestamp) for the header
                      const sortedSpans = [...selectedFlow.spanSequence].sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
                      const firstRequestSpan = sortedSpans[0]
                      const firstRequestTime = firstRequestSpan?.startTime ? formatTimestamp(firstRequestSpan.startTime) : formatTimestamp(selectedFlow.startTime)
                      
                      return (
                        <>
                          <div className="mb-4 pb-3 border-b border-gray-300 bg-blue-50 rounded p-2">
                            <div className="text-sm font-semibold text-gray-800">
                              🕐 First Request Received: <span className="font-mono text-blue-700">{firstRequestTime}</span>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-3">
                            {selectedFlow.spanSequence
                              .sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
                              .map((span, idx) => {
                                const targetNamespace = (filters.namespace || namespace || '').toLowerCase()
                                const isInTargetNamespace = (span.namespace || 'default').toLowerCase() === targetNamespace
                                const podName = span.podName && span.podName !== 'unknown-pod' 
                                  ? span.podName 
                                  : 'unknown-pod'
                                const firstSpan = selectedFlow.spanSequence?.[0]
                                const relativeStartTime = idx === 0 || !firstSpan
                                  ? 0 
                                  : (span.startTime - (firstSpan.startTime || 0)) / 1000000 // Convert to milliseconds
                                
                                return (
                                  <div 
                                    key={span.spanId} 
                                    className={`relative flex flex-col items-center p-4 rounded-lg border-2 min-w-[160px] ${
                                      isInTargetNamespace 
                                        ? 'border-blue-400 bg-blue-50' 
                                        : 'border-gray-300 bg-white'
                                    } ${span.status === 'error' ? 'border-red-500 bg-red-50' : ''}`}
                                  >
                                    {/* Numbered Box Badge - More Prominent */}
                                    <div className={`absolute -top-4 -left-4 w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shadow-xl z-20 border-2 border-white ${
                                      idx === 0 ? 'bg-green-600 text-white' :
                                      idx === 1 ? 'bg-blue-600 text-white' :
                                      idx === 2 ? 'bg-purple-600 text-white' :
                                      idx === 3 ? 'bg-orange-600 text-white' :
                                      idx === 4 ? 'bg-pink-600 text-white' :
                                      'bg-gray-600 text-white'
                                    }`} title={`Pod #${idx + 1} in request sequence`}>
                                      {idx + 1}
                                    </div>
                                    
                                    {/* Request Timestamp - Prominent at top */}
                                    {span.startTime && (
                                      <div className={`w-full mb-3 pb-2 border-b ${isInTargetNamespace ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'} rounded px-2 py-1.5`}>
                                        <div className="text-[10px] text-gray-600 mb-0.5">
                                          🕐 Request Received:
                                        </div>
                                        <div className={`text-xs font-mono font-semibold ${isInTargetNamespace ? 'text-blue-800' : 'text-gray-700'}`}>
                                          {formatTimestamp(span.startTime)}
                                        </div>
                                        {idx > 0 && (
                                          <div className="text-[10px] text-blue-600 mt-0.5">
                                            +{relativeStartTime.toFixed(0)}ms from start
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    
                                    <div className="flex items-center gap-3 flex-1 w-full">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                          <div className={`w-3 h-3 rounded-full ${
                                            span.status === 'error' ? 'bg-red-500' : 
                                            isInTargetNamespace ? 'bg-blue-500' : 'bg-gray-400'
                                          }`}></div>
                                          <span className={`font-mono font-semibold text-sm ${
                                            podName === 'unknown-pod' 
                                              ? 'text-gray-400 italic' 
                                              : isInTargetNamespace 
                                                ? 'text-blue-700' 
                                                : 'text-gray-700'
                                          }`}>
                                            {podName.length > 18 ? `${podName.substring(0, 15)}...` : podName}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className={`text-xs px-2 py-0.5 rounded ${
                                            isInTargetNamespace 
                                              ? 'bg-blue-200 text-blue-800 font-semibold' 
                                              : 'bg-gray-100 text-gray-600'
                                          }`}>
                                            {span.namespace}
                                            {isInTargetNamespace && ' ⭐'}
                                          </span>
                                          <span className="text-xs text-gray-500">
                                            ({span.serviceName})
                                          </span>
                                        </div>
                                        <div className="text-xs text-gray-600 mt-1">
                                          <span className="font-mono">{span.operationName}</span>
                                          {span.status === 'error' && (
                                            <span className="ml-2 text-red-600 font-semibold">⚠️ Error</span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="text-right text-xs text-gray-600 min-w-[80px]">
                                        <div className="font-mono font-semibold mb-1">
                                          {idx === 0 ? (
                                            <span className="text-green-600">Start</span>
                                          ) : (
                                            <span className="text-blue-600">+{relativeStartTime.toFixed(0)}ms</span>
                                          )}
                                        </div>
                                        <div className="text-gray-400 text-[10px] mt-1">
                                          Duration: {formatDuration(span.duration)}
                                        </div>
                                      </div>
                                    </div>
                                    {span.parentSpanId && (
                                      <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500 w-full text-center">
                                        Parent: {span.parentSpanId.substring(0, 16)}...
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                          </div>
                        </>
                      )
                    })()}
                    <div className="mt-4 pt-4 border-t border-gray-300 text-xs text-gray-600">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                          <span>Target namespace ({filters.namespace || namespace || 'all'})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-gray-400"></div>
                          <span>Other namespace</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-red-500"></div>
                          <span>Error</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Pod Call Chain Visualization (Tree View) */}
              {selectedFlow.nodes.length > 0 && (
                <div className="mt-6">
                  <h4 className="font-semibold text-gray-900 mb-3">
                    🌳 Pod Call Chain (Tree View)
                    {filters.namespace && (
                      <span className="text-sm font-normal text-gray-500 ml-2">
                        ({filters.namespace} namespace pods highlighted)
                      </span>
                    )}
                  </h4>
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div className="space-y-2 font-mono text-xs">
                      {selectedFlow.nodes.map((node, idx) => {
                        const outgoingEdges = selectedFlow.edges.filter(e => e.from === node.id)
                        const targetNamespace = (filters.namespace || namespace || '').toLowerCase()
                        const isInTargetNamespace = (node.service.namespace || 'default').toLowerCase() === targetNamespace
                        const podName = node.service.pod && node.service.pod !== 'unknown-pod'
                          ? node.service.pod
                          : 'unknown-pod'
                        
                        if (outgoingEdges.length === 0 && idx > 0) return null
                        
                        return (
                          <div key={node.id} className="space-y-1">
                            <div className={`flex items-center gap-2 ${
                              isInTargetNamespace ? 'text-blue-700 font-semibold' : 'text-gray-700'
                            }`}>
                              <span>{podName}</span>
                              <span className="text-gray-400">({node.service.namespace})</span>
                              {isInTargetNamespace && <span className="text-blue-600">⭐</span>}
                            </div>
                            {outgoingEdges.map(e => {
                              const targetNode = selectedFlow.nodes.find(n => n.id === e.to)
                              if (!targetNode) return null
                              const targetIsInNamespace = (targetNode.service.namespace || 'default').toLowerCase() === targetNamespace
                              const targetPodName = targetNode.service.pod && targetNode.service.pod !== 'unknown-pod'
                                ? targetNode.service.pod
                                : 'unknown-pod'
                              
                              return (
                                <div key={e.to} className="ml-4 flex items-center gap-2">
                                  <span className="text-gray-400">└─[{formatDuration(e.avgLatency)}]→</span>
                                  <span className={targetIsInNamespace ? 'text-blue-700 font-semibold' : 'text-gray-700'}>
                                    {targetPodName}
                                  </span>
                                  <span className="text-gray-400">({targetNode.service.namespace})</span>
                                  {targetIsInNamespace && <span className="text-blue-600">⭐</span>}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
      )}
      
      {/* Pod Logs Modal */}
      {selectedPodForLogs && (
        <PodLogsModal
          isOpen={!!selectedPodForLogs}
          onClose={() => setSelectedPodForLogs(null)}
          podName={selectedPodForLogs.name}
          namespace={selectedPodForLogs.namespace}
          container={selectedPodForLogs.container}
          apiUrl={apiUrl}
        />
      )}
    </>
  )
}


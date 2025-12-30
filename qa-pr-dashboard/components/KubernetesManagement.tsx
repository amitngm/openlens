'use client'

import { useState, useEffect } from 'react'
import { storage, STORAGE_KEYS } from '@/utils/storage'
import { Upload, RefreshCw, CheckCircle, XCircle, Save, Server, Loader2, Edit, Eye, Trash2, FileText, Minus, Plus, RotateCw, AlertTriangle, Network, Shield } from 'lucide-react'
import ResourceDetailModal from './ResourceDetailModal'
import PodLogsModal from './PodLogsModal'
import FlowVisualization from './FlowVisualization'
import { useAuth } from '@/contexts/AuthContext'

interface Container {
  name: string
  image: string
  imagePullPolicy: string
}

interface Deployment {
  name: string
  namespace: string
  replicas: number
  readyReplicas: number
  containers: Container[]
  labels: Record<string, string>
  creationTimestamp: string
}

interface Service {
  name: string
  namespace: string
  type: string
  ports: Array<{
    port: number
    targetPort: number | string
    protocol: string
    name?: string
  }>
  selector: Record<string, string>
  clusterIP: string
  labels: Record<string, string>
  creationTimestamp: string
}

interface NodeInfo {
  name: string
  status: string
  roles: string[]
  kubeletVersion?: string
  containerRuntime?: string
  cpu?: string
  memory?: string
  podCapacity?: string
  creationTimestamp?: string
}

interface Namespace {
  name: string
  status: string
  creationTimestamp: string
  labels?: Record<string, string>
}

interface Pod {
  name: string
  namespace: string
  status: string
  nodeName?: string
  hostIP?: string
  podIP?: string
  restartCount: number
  ready: boolean
  containers: Array<{
    name: string
    image: string
    imagePullPolicy?: string
    ready: boolean
    restartCount: number
  }>
  initContainers?: Array<{
    name: string
    image: string
  }>
  labels: Record<string, string>
  creationTimestamp?: string
  startTime?: string
}

interface CronJob {
  name: string
  namespace: string
  schedule: string
  suspend: boolean
  active: number
  lastScheduleTime: string
  lastSuccessfulTime: string
  containers: Container[]
  labels: Record<string, string>
  creationTimestamp: string
}

interface Job {
  name: string
  namespace: string
  completions: number
  parallelism: number
  active: number
  succeeded: number
  failed: number
  startTime: string
  completionTime: string
  conditions: Array<{
    type: string
    status: string
    lastProbeTime?: string
    lastTransitionTime?: string
    reason?: string
    message?: string
  }>
  containers: Container[]
  labels: Record<string, string>
  creationTimestamp: string
}


interface ImageUpdate {
  namespace: string
  deployment: string
  container: string
  image: string
  originalImage: string
}

interface ValidationResult {
  valid: boolean
  issues?: string[]
  suggestions?: string[]
  info?: {
    clustersCount: number
    contextsCount: number
    usersCount: number
    currentContext: string
    clusters: string[]
    contexts: string[]
    users: string[]
  }
}

interface KubernetesManagementProps {
  apiUrl: string
  managerKubeconfig?: string  // Manager's personal kubeconfig
}

export default function KubernetesManagement({ apiUrl, managerKubeconfig }: KubernetesManagementProps) {
  const { token, hasRole, hasAccessGrant } = useAuth()
  const [kubeconfig, setKubeconfig] = useState('')
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)
  const [isCheckingAccess, setIsCheckingAccess] = useState(true)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [isResolving, setIsResolving] = useState(false)

  const getAuthHeaders = () => {
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [resolutionResult, setResolutionResult] = useState<{
    resolved: boolean
    fixes: string[]
    remainingIssues: string[]
    resolvedKubeconfig: string
    hasChanges: boolean
  } | null>(null)
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [pods, setPods] = useState<Pod[]>([])
  const [nodes, setNodes] = useState<any[]>([])
  const [configmaps, setConfigmaps] = useState<any[]>([])
  const [events, setEvents] = useState<any[]>([])
  const [cronjobs, setCronjobs] = useState<CronJob[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [namespaces, setNamespaces] = useState<Namespace[]>([])
  const [selectedNamespace, setSelectedNamespace] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedDeployments, setSelectedDeployments] = useState<Set<string>>(new Set())
  const [imageUpdates, setImageUpdates] = useState<Map<string, ImageUpdate>>(new Map())
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateMode, setUpdateMode] = useState<'bulk' | 'selective'>('selective')
  const [showDeployments, setShowDeployments] = useState(true)
  const [showServices, setShowServices] = useState(true)
  const [showPods, setShowPods] = useState(true)
  const [showNamespaces, setShowNamespaces] = useState(true)
  const [activeResourceTab, setActiveResourceTab] = useState<'deployments' | 'pods' | 'services' | 'configmaps' | 'events' | 'cronjobs' | 'jobs' | 'flow-tracing'>('deployments')
  const [selectedResource, setSelectedResource] = useState<{
    type: 'deployment' | 'service' | 'pod' | 'configmap' | 'cronjob' | 'job' | null
    namespace: string
    name: string
  } | null>(null)
  const [actionModal, setActionModal] = useState<{
    type: 'scale' | 'restart' | 'delete' | null
    resourceType: string
    namespace: string
    name: string
    currentReplicas?: number
  } | null>(null)
  const [isActioning, setIsActioning] = useState(false)
  const [scaleReplicas, setScaleReplicas] = useState<number>(1)
  const [selectedLogPod, setSelectedLogPod] = useState<{
    namespace: string
    name: string
    container?: string
  } | null>(null)
  const [showImageComparison, setShowImageComparison] = useState(false)
  const [showBulkUpdateWizard, setShowBulkUpdateWizard] = useState(false)
  const [bulkUpdateSelections, setBulkUpdateSelections] = useState<Set<string>>(new Set())
  const [bulkUpdateImage, setBulkUpdateImage] = useState('')
  const [bulkUpdateStep, setBulkUpdateStep] = useState<'select' | 'preview'>('select')
  const [bulkUpdateTagOnly, setBulkUpdateTagOnly] = useState(false)
  const [kubeconfigs, setKubeconfigs] = useState<Array<{
    id: string
    name: string
    kubeconfig: string
    isActive: boolean
    createdAt: string
    updatedAt: string
  }>>([])
  const [showKubeconfigManager, setShowKubeconfigManager] = useState(false)
  const [newKubeconfigName, setNewKubeconfigName] = useState('')
  const [newKubeconfigContent, setNewKubeconfigContent] = useState('')
  const [isSavingKubeconfig, setIsSavingKubeconfig] = useState(false)

  // Load kubeconfig from manager settings or MongoDB (MongoDB is source of truth)
  useEffect(() => {
    // Priority: manager's personal kubeconfig > MongoDB active kubeconfig
    if (managerKubeconfig) {
      setKubeconfig(managerKubeconfig)
    }
    // MongoDB kubeconfigs will be loaded via loadSavedKubeconfigs
  }, [managerKubeconfig])

  // Load saved kubeconfigs from MongoDB (source of truth)
  useEffect(() => {
    if (hasAccess !== false) { // Only load if access is granted
      loadSavedKubeconfigs()
    }
  }, [hasAccess])
  
  // Periodically check if access is still valid (for time-based grants)
  useEffect(() => {
    const checkAccess = async () => {
      if (!token) {
        setHasAccess(false)
        setIsCheckingAccess(false)
        return
      }
      
      // Check role-based access first
      if (hasRole('admin') || hasRole('manager')) {
        setHasAccess(true)
        setIsCheckingAccess(false)
        return
      }
      
      // Check time-based access grant
      try {
        const hasGrant = await hasAccessGrant('kubernetes', apiUrl)
        setHasAccess(hasGrant)
      } catch (error) {
        console.error('Error checking access:', error)
        setHasAccess(false)
      } finally {
        setIsCheckingAccess(false)
      }
    }
    
    checkAccess()
    
    // Re-check access every 30 seconds to catch expired grants
    const interval = setInterval(() => {
      if (!hasRole('admin') && !hasRole('manager')) {
        checkAccess()
      }
    }, 30000)
    
    return () => clearInterval(interval)
  }, [token, hasRole, hasAccessGrant, apiUrl])

  const loadSavedKubeconfigs = async () => {
    try {
      const response = await fetch(`${apiUrl}/k8s/kubeconfigs`, {
        headers: getAuthHeaders()
      })
      const data = await response.json()
      if (data.success) {
        setKubeconfigs(data.kubeconfigs || [])
        // Set active kubeconfig from MongoDB if available (MongoDB is source of truth)
        const active = data.kubeconfigs?.find((kc: any) => kc.isActive)
        if (active && !managerKubeconfig) {
          setKubeconfig(active.kubeconfig)
        }
        
        // Migrate any localStorage kubeconfig to MongoDB if it exists and isn't already saved
        const localKubeconfig = storage.getLocal<string>(STORAGE_KEYS.KUBECONFIG)
        if (localKubeconfig && data.kubeconfigs && data.kubeconfigs.length === 0) {
          // Only migrate if no kubeconfigs exist in MongoDB yet
          console.log('🔄 Migrating localStorage kubeconfig to MongoDB...')
          try {
            const migrateResponse = await fetch(`${apiUrl}/k8s/kubeconfigs`, {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({
                name: 'Migrated Kubeconfig',
                kubeconfig: localKubeconfig,
                isActive: true
              })
            })
            const migrateData = await migrateResponse.json()
            if (migrateData.success) {
              console.log('✅ Successfully migrated kubeconfig to MongoDB')
              // Reload kubeconfigs after migration
              await loadSavedKubeconfigs()
              // Clear localStorage after successful migration
              storage.removeLocal(STORAGE_KEYS.KUBECONFIG)
            }
          } catch (migrateError) {
            console.error('Failed to migrate kubeconfig to MongoDB:', migrateError)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load kubeconfigs from MongoDB:', error)
    }
  }

  const handleSaveKubeconfig = async () => {
    if (!newKubeconfigName.trim() || !newKubeconfigContent.trim()) {
      setErrorMessage('Name and kubeconfig content are required')
      return
    }

    setIsSavingKubeconfig(true)
    setErrorMessage(null)

    try {
      const response = await fetch(`${apiUrl}/k8s/kubeconfigs`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: newKubeconfigName.trim(),
          kubeconfig: newKubeconfigContent.trim(),
          isActive: false
        })
      })

      const data = await response.json()
      if (data.success) {
        await loadSavedKubeconfigs()
        setNewKubeconfigName('')
        setNewKubeconfigContent('')
        setShowKubeconfigManager(false)
        setErrorMessage('✅ Kubeconfig saved successfully!')
        setTimeout(() => setErrorMessage(null), 3000)
      } else {
        setErrorMessage(data.error || 'Failed to save kubeconfig')
      }
    } catch (error: any) {
      setErrorMessage('Failed to save kubeconfig: ' + error.message)
    } finally {
      setIsSavingKubeconfig(false)
    }
  }

  const handleActivateKubeconfig = async (id: string) => {
    setIsConnecting(true)
    setErrorMessage(null)

    try {
      const response = await fetch(`${apiUrl}/k8s/kubeconfigs/${id}/activate`, {
        method: 'POST',
        headers: getAuthHeaders()
      })

      const data = await response.json()
      if (data.success) {
        setIsConnected(true)
        setKubeconfig(data.kubeconfig.kubeconfig)
        await loadSavedKubeconfigs()
        setErrorMessage('✅ Successfully connected to cluster. Loading namespaces...')
        try {
          await loadNamespaces(true)
          await loadData()
        } catch (err) {
          console.error('Error loading namespaces:', err)
        }
        setTimeout(() => {
          setErrorMessage('✅ Successfully connected and loaded namespaces')
          setTimeout(() => setErrorMessage(null), 3000)
        }, 1000)
      } else {
        setErrorMessage(data.error || 'Failed to activate kubeconfig')
        setIsConnected(false)
      }
    } catch (error: any) {
      setErrorMessage('Failed to activate kubeconfig: ' + error.message)
      setIsConnected(false)
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDeleteKubeconfig = async (id: string) => {
    if (!confirm('Are you sure you want to delete this kubeconfig?')) {
      return
    }

    try {
      const response = await fetch(`${apiUrl}/k8s/kubeconfigs/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })

      const data = await response.json()
      if (data.success) {
        await loadSavedKubeconfigs()
        // If deleted kubeconfig was active, clear connection
        const wasActive = kubeconfigs.find(kc => kc.id === id)?.isActive
        if (wasActive) {
          setIsConnected(false)
          setKubeconfig('')
        }
      }
    } catch (error: any) {
      setErrorMessage('Failed to delete kubeconfig: ' + error.message)
    }
  }

  // Clear validation/resolution results when kubeconfig changes
  useEffect(() => {
    if (validationResult) {
      setValidationResult(null)
    }
    if (resolutionResult) {
      setResolutionResult(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kubeconfig])

  const handleResolve = async () => {
    if (!kubeconfig.trim()) {
      setErrorMessage('Please paste or upload a kubeconfig file')
      setResolutionResult(null)
      return
    }

    setIsResolving(true)
    setErrorMessage(null)
    setResolutionResult(null)

    try {
      const response = await fetch(`${apiUrl}/k8s/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ kubeconfig }),
      })

      const data = await response.json()

      if (data.success) {
        setResolutionResult({
          resolved: data.resolved,
          fixes: data.fixes || [],
          remainingIssues: data.remainingIssues || [],
          resolvedKubeconfig: data.resolvedKubeconfig,
          hasChanges: data.hasChanges,
        })

        if (data.resolved && data.hasChanges) {
          setErrorMessage(
            `✅ Resolved ${data.fixes.length} issue(s). Review the changes below and click "Apply Fixes" to update.`
          )
        } else if (data.resolved) {
          setErrorMessage('✅ No issues found to resolve')
        } else {
          setErrorMessage('⚠️ Some issues could not be auto-resolved')
        }

        // Auto-validate the resolved config
        if (data.resolvedKubeconfig) {
          const validateResponse = await fetch(`${apiUrl}/k8s/validate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ kubeconfig: data.resolvedKubeconfig }),
          })

          const validateData = await validateResponse.json()
          if (validateData.valid) {
            setValidationResult({
              valid: true,
              info: validateData.info,
            })
          } else {
            setValidationResult({
              valid: false,
              issues: validateData.issues,
              suggestions: validateData.suggestions,
              info: validateData.info,
            })
          }
        }
      } else {
        setErrorMessage(data.message || 'Failed to resolve kubeconfig issues')
      }
    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to resolve kubeconfig')
    } finally {
      setIsResolving(false)
    }
  }

  const handleApplyFixes = () => {
    if (resolutionResult && resolutionResult.resolvedKubeconfig) {
      setKubeconfig(resolutionResult.resolvedKubeconfig)
      setResolutionResult(null)
      setErrorMessage('✅ Fixed kubeconfig applied. You can now validate or connect.')
      setTimeout(() => setErrorMessage(null), 5000)
    }
  }

  const handleValidate = async () => {
    if (!kubeconfig.trim()) {
      setErrorMessage('Please paste or upload a kubeconfig file')
      setValidationResult(null)
      return
    }

    setIsValidating(true)
    setErrorMessage(null)
    setValidationResult(null)

    try {
      const response = await fetch(`${apiUrl}/k8s/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ kubeconfig }),
      })

      const data = await response.json()

      if (data.valid) {
        setValidationResult({
          valid: true,
          info: data.info,
        })
        setErrorMessage('✅ Kubeconfig is valid and ready to connect')
        setTimeout(() => setErrorMessage(null), 5000)
      } else {
        setValidationResult({
          valid: false,
          issues: data.issues || [],
          suggestions: data.suggestions || [],
          info: data.info,
        })
      }
    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to validate kubeconfig')
      setValidationResult({
        valid: false,
        issues: ['Validation request failed'],
        suggestions: ['Check your connection to the API server'],
      })
    } finally {
      setIsValidating(false)
    }
  }

  const handleConnect = async () => {
    if (!kubeconfig.trim()) {
      setErrorMessage('Please paste or upload a kubeconfig file')
      return
    }

    setIsConnecting(true)
    setErrorMessage(null)

    try {
      const response = await fetch(`${apiUrl}/k8s/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ kubeconfig }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setIsConnected(true)
        setValidationResult({
          valid: true,
          info: data.info,
        })
        
        // Save kubeconfig to MongoDB for retention (MongoDB is source of truth)
        try {
          const saveResponse = await fetch(`${apiUrl}/k8s/kubeconfigs`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
              name: `Kubeconfig ${new Date().toLocaleString()}`,
              kubeconfig: kubeconfig,
              isActive: true // Set as active since user just connected with it
            })
          })
          const saveData = await saveResponse.json()
          if (saveData.success) {
            console.log('✅ Kubeconfig saved to MongoDB for retention')
            // Reload kubeconfigs list to show the newly saved one
            await loadSavedKubeconfigs()
            // Clear localStorage since MongoDB is now the source of truth
            storage.removeLocal(STORAGE_KEYS.KUBECONFIG)
          }
        } catch (saveError) {
          console.error('Failed to save kubeconfig to MongoDB:', saveError)
          // Fallback to localStorage only if MongoDB save fails
          storage.setLocal(STORAGE_KEYS.KUBECONFIG, kubeconfig)
        }
        
        setErrorMessage('✅ Successfully connected to cluster. Kubeconfig saved to MongoDB. Loading namespaces...')
        // Load namespaces immediately after connection (skip connection check since we just connected)
        try {
          await loadNamespaces(true)
          // Always load data after namespaces are loaded (defaults to 'all' to show all resources)
          await loadData()
        } catch (err) {
          console.error('Error loading namespaces after connection:', err)
          setErrorMessage('✅ Connected, but failed to load namespaces. Click "Load Namespaces" to retry.')
        }
        setTimeout(() => {
          if (namespaces.length > 0) {
            setErrorMessage('✅ Successfully connected and loaded namespaces')
          } else {
            setErrorMessage('✅ Connected. Click "Load Namespaces" to fetch namespaces.')
          }
          setTimeout(() => setErrorMessage(null), 5000)
        }, 1000)
      } else {
        // Handle validation errors or connection errors
        if (data.issues && data.suggestions) {
          setValidationResult({
            valid: data.valid || false,
            issues: data.issues,
            suggestions: data.suggestions,
            info: data.info,
          })
        }
        setErrorMessage(data.message || 'Failed to connect to cluster')
        setIsConnected(false)
      }
    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to connect to cluster')
      setIsConnected(false)
    } finally {
      setIsConnecting(false)
    }
  }

  const loadNamespaces = async (skipConnectionCheck = false) => {
    if (!skipConnectionCheck && !isConnected) {
      setErrorMessage('Please connect to a Kubernetes cluster first')
      return
    }
    
    setIsLoading(true)
    setErrorMessage(null)
    
    try {
      console.log('📋 Loading namespaces from:', `${apiUrl}/k8s/namespaces`)
      const response = await fetch(`${apiUrl}/k8s/namespaces`)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }))
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      console.log('📋 Namespaces response:', data)
      
      if (data.success && data.namespaces) {
        setNamespaces(data.namespaces)
        // Don't auto-select a namespace - user must select one to see resources
        if (data.namespaces.length === 0) {
          setErrorMessage('⚠️ No namespaces found in the cluster')
        } else {
          // Don't auto-load resources - wait for user to select a namespace
        }
      } else {
        setErrorMessage(data.message || data.error || 'Failed to load namespaces')
      }
    } catch (error: any) {
      console.error('❌ Failed to load namespaces:', error)
      setErrorMessage(error.message || 'Failed to load namespaces. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const loadNodes = async () => {
    if (!isConnected) return
    try {
      const response = await fetch(`${apiUrl}/k8s/nodes`)
      const data = await response.json()
      if (response.ok && data?.nodes) {
        setNodes(data.nodes)
      } else {
        console.warn('⚠️ Failed to load nodes:', data?.message || data?.error)
        setNodes([])
      }
    } catch (error: any) {
      console.error('❌ Failed to load nodes:', error)
      setNodes([])
    }
  }

  const loadData = async () => {
    if (!isConnected) return
    
    // Only load resources if a specific namespace is selected (not 'all')
    if (!selectedNamespace || selectedNamespace === 'all') {
      console.log('⚠️ No specific namespace selected, clearing resources')
      setDeployments([])
      setPods([])
      setServices([])
      setCronjobs([])
      setJobs([])
      return
    }

    setIsLoading(true)
    setErrorMessage(null)

    try {
      // Use the selected namespace (not 'all')
      const namespaceParam = selectedNamespace
      console.log('📦 Loading resources for namespace:', namespaceParam)
      
      const [deploymentsRes, servicesRes, podsRes, configmapsRes, eventsRes, cronjobsRes, jobsRes] = await Promise.all([
        fetch(`${apiUrl}/k8s/deployments?namespace=${namespaceParam}`),
        fetch(`${apiUrl}/k8s/services?namespace=${namespaceParam}`),
        fetch(`${apiUrl}/k8s/pods?namespace=${namespaceParam}`),
        fetch(`${apiUrl}/k8s/configmaps?namespace=${namespaceParam}`).catch((err) => {
          console.warn('⚠️ ConfigMaps fetch failed:', err);
          return { ok: false, status: 500, json: async () => ({ success: false, configmaps: [], error: err.message }) };
        }),
        fetch(`${apiUrl}/k8s/events?namespace=${namespaceParam}`).catch((err) => {
          console.warn('⚠️ Events fetch failed:', err);
          return { ok: false, status: 500, json: async () => ({ success: false, events: [], error: err.message }) };
        }),
        fetch(`${apiUrl}/k8s/cronjobs?namespace=${namespaceParam}`).catch((err) => {
          console.warn('⚠️ CronJobs fetch failed:', err);
          return { ok: false, status: 500, json: async () => ({ success: false, cronjobs: [], error: err.message }) };
        }),
        fetch(`${apiUrl}/k8s/jobs?namespace=${namespaceParam}`).catch((err) => {
          console.warn('⚠️ Jobs fetch failed:', err);
          return { ok: false, status: 500, json: async () => ({ success: false, jobs: [], error: err.message }) };
        }),
      ])

      const deploymentsData = await deploymentsRes.json()
      const servicesData = await servicesRes.json()
      const podsData = await podsRes.json()

      console.log('📦 Deployments response:', deploymentsData)
      console.log('📦 Services response:', servicesData)
      console.log('📦 Pods response:', podsData)

      if (deploymentsData.success) {
        console.log('✅ Setting deployments:', deploymentsData.deployments?.length || 0)
        setDeployments(deploymentsData.deployments || [])
      } else {
        console.error('❌ Deployments API error:', deploymentsData.error || deploymentsData.message)
        setDeployments([])
      }
      
      if (servicesData.success) {
        console.log('✅ Setting services:', servicesData.services?.length || 0)
        setServices(servicesData.services || [])
      } else {
        console.error('❌ Services API error:', servicesData.error || servicesData.message)
        setServices([])
      }
      
      if (podsData.success) {
        const podsArray = podsData.pods || []
        
        // Remove duplicates based on namespace + name
        const uniquePods = podsArray.reduce((acc: Map<string, Pod>, pod: Pod) => {
          const key = `${pod.namespace}/${pod.name}`
          if (!acc.has(key)) {
            acc.set(key, pod)
          } else {
            console.warn(`⚠️ Duplicate pod found: ${key}`)
          }
          return acc
        }, new Map<string, Pod>())
        
        const deduplicatedPods: Pod[] = Array.from(uniquePods.values())
        
        // Filter by namespace if a specific namespace is selected (not 'all')
        const filteredPods: Pod[] = selectedNamespace && selectedNamespace !== 'all' 
          ? deduplicatedPods.filter((pod: Pod) => pod.namespace === selectedNamespace)
          : deduplicatedPods
        
        console.log('✅ Setting pods:', {
          original: podsArray.length,
          afterDedup: deduplicatedPods.length,
          afterFilter: filteredPods.length,
          namespace: namespaceParam,
          selectedNamespace: selectedNamespace
        })
        
        if (podsArray.length !== filteredPods.length) {
          console.warn(`⚠️ Pod count mismatch: API returned ${podsArray.length}, displaying ${filteredPods.length}`)
        }
        
        setPods(filteredPods)
      } else {
        console.error('❌ Pods API error:', podsData.error || podsData.message)
        setPods([])
      }

      const configmapsData = await configmapsRes.json()
      if (configmapsData.success) {
        console.log('✅ Setting configmaps:', configmapsData.configmaps?.length || 0)
        setConfigmaps(configmapsData.configmaps || [])
      } else {
        console.error('❌ ConfigMaps API error:', configmapsData.error || configmapsData.message)
        setConfigmaps([])
      }

      const eventsData = await eventsRes.json()
      if (eventsData.success) {
        console.log('✅ Setting events:', eventsData.events?.length || 0)
        setEvents(eventsData.events || [])
      } else {
        console.error('❌ Events API error:', eventsData.error || eventsData.message)
        setEvents([])
      }

      // Handle CronJobs
      try {
        const cronjobsData = await cronjobsRes.json()
        if (cronjobsData.success) {
          console.log('✅ Setting cronjobs:', cronjobsData.cronjobs?.length || 0)
          setCronjobs(cronjobsData.cronjobs || [])
        } else {
          console.error('❌ CronJobs API error:', cronjobsData.error || cronjobsData.message, cronjobsData.details)
          // Don't show error if it's just that there are no cronjobs (404 or empty list)
          if (cronjobsRes.status !== 404 && !cronjobsData.message?.includes('not found')) {
            console.warn('⚠️ CronJobs fetch warning:', cronjobsData.message)
          }
          setCronjobs([])
        }
      } catch (cronjobsError: any) {
        console.error('❌ Failed to parse CronJobs response:', cronjobsError)
        setCronjobs([])
      }

      // Handle Jobs
      try {
        const jobsData = await jobsRes.json()
        if (jobsData.success) {
          console.log('✅ Setting jobs:', jobsData.jobs?.length || 0)
          setJobs(jobsData.jobs || [])
        } else {
          console.error('❌ Jobs API error:', jobsData.error || jobsData.message, jobsData.details)
          // Don't show error if it's just that there are no jobs (404 or empty list)
          if (jobsRes.status !== 404 && !jobsData.message?.includes('not found')) {
            console.warn('⚠️ Jobs fetch warning:', jobsData.message)
          }
          setJobs([])
        }
      } catch (jobsError: any) {
        console.error('❌ Failed to parse Jobs response:', jobsError)
        setJobs([])
      }

      // Check for HTTP errors
      if (!deploymentsRes.ok) {
        console.error('❌ Deployments HTTP error:', deploymentsRes.status, deploymentsRes.statusText)
        setErrorMessage(`Failed to fetch deployments: ${deploymentsRes.status} ${deploymentsRes.statusText}`)
      }
      if (!servicesRes.ok) {
        console.error('❌ Services HTTP error:', servicesRes.status, servicesRes.statusText)
        setErrorMessage(`Failed to fetch services: ${servicesRes.status} ${servicesRes.statusText}`)
      }
      if (!podsRes.ok) {
        console.error('❌ Pods HTTP error:', podsRes.status, podsRes.statusText)
        setErrorMessage(`Failed to fetch pods: ${podsRes.status} ${podsRes.statusText}`)
      }
    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to load cluster data')
    } finally {
      setIsLoading(false)
    }
  }


  useEffect(() => {
    if (isConnected && selectedNamespace) {
      console.log('🔄 Namespace changed to:', selectedNamespace, '- Loading resources...')
      // Clear previous data when namespace changes
      setDeployments([])
      setPods([])
      setNodes([])
      setServices([])
      setConfigmaps([])
      setEvents([])
      setCronjobs([])
      setJobs([])
      // Load new data for the selected namespace
      loadData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNamespace, isConnected])

  useEffect(() => {
    if (isConnected) {
      loadNodes()
    } else {
      setNodes([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected])

  const handleImageChange = (
    namespace: string,
    deploymentName: string,
    containerName: string,
    newImage: string,
    originalImage: string
  ) => {
    const key = `${namespace}/${deploymentName}/${containerName}`
    const newUpdates = new Map(imageUpdates)
    
    if (newImage === originalImage) {
      newUpdates.delete(key)
    } else {
      newUpdates.set(key, {
        namespace: namespace,
        deployment: deploymentName,
        container: containerName,
        image: newImage,
        originalImage,
      })
    }
    
    setImageUpdates(newUpdates)
  }

  // Helper function to extract base image (without tag)
  const getBaseImage = (image: string): string => {
    // Remove tag if present (format: image:tag)
    if (image.includes(':')) {
      // Check if it's a port number (registry:port/image:tag)
      const parts = image.split(':')
      if (parts.length > 2) {
        // Has port, get everything before the last colon
        const lastColonIndex = image.lastIndexOf(':')
        return image.substring(0, lastColonIndex)
      } else {
        // Simple format: image:tag
        return parts[0]
      }
    }
    // Remove digest if present (format: image@sha256:...)
    if (image.includes('@')) {
      return image.split('@')[0]
    }
    return image
  }

  // Helper function to apply tag-only update
  const applyTagOnlyUpdate = (originalImage: string, newTag: string): string => {
    const baseImage = getBaseImage(originalImage)
    return `${baseImage}:${newTag}`
  }

  const handleBulkImageUpdate = (newImage: string) => {
    const newUpdates = new Map<string, ImageUpdate>()
    
    deployments.forEach((deployment) => {
      deployment.containers.forEach((container) => {
        const key = `${selectedNamespace}/${deployment.name}/${container.name}`
        newUpdates.set(key, {
          namespace: selectedNamespace,
          deployment: deployment.name,
          container: container.name,
          image: newImage,
          originalImage: container.image,
        })
      })
    })
    
    setImageUpdates(newUpdates)
  }

  const handleSaveSingleImage = async (namespace: string, deployment: string, container: string, newImage: string, originalImage: string) => {
    if (newImage === originalImage) {
      setErrorMessage('Image unchanged')
      setTimeout(() => setErrorMessage(null), 2000)
      return
    }

    if (!newImage || newImage.trim() === '') {
      setErrorMessage('Please enter a valid image name')
      setTimeout(() => setErrorMessage(null), 2000)
      return
    }

    // Validate required fields
    const trimmedNamespace = namespace?.trim()
    const trimmedDeployment = deployment?.trim()
    const trimmedContainer = container?.trim()
    const trimmedImage = newImage.trim()

    if (!trimmedNamespace || !trimmedDeployment || !trimmedContainer) {
      setErrorMessage('Missing required fields: namespace, deployment, or container name')
      setTimeout(() => setErrorMessage(null), 3000)
      return
    }

    // Ensure deployment name doesn't contain namespace (some APIs return it as namespace/name)
    let deploymentName = trimmedDeployment
    if (trimmedDeployment.includes('/')) {
      const parts = trimmedDeployment.split('/').filter(p => p && p.trim() !== '')
      deploymentName = parts.length > 0 ? parts[parts.length - 1] : trimmedDeployment
      console.log('Extracted deployment name:', { original: trimmedDeployment, extracted: deploymentName, parts })
    }

    // Final validation after extraction
    if (!deploymentName || deploymentName.trim() === '') {
      setErrorMessage('Invalid deployment name after processing')
      setTimeout(() => setErrorMessage(null), 3000)
      return
    }

    setIsUpdating(true)
    setErrorMessage(null)

    try {
      const updatePayload = {
        namespace: String(trimmedNamespace),
        deployment: String(deploymentName),
        container: String(trimmedContainer),
        image: String(trimmedImage)
      }
      
      console.log('Saving image update:', { 
        namespace: trimmedNamespace, 
        deployment: deploymentName, 
        container: trimmedContainer, 
        image: trimmedImage,
        originalDeployment: deployment,
        payload: updatePayload
      })
      
      const response = await fetch(`${apiUrl}/k8s/update-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          updates: [updatePayload]
        }),
      })

      // Check if response is ok before parsing JSON
      if (!response.ok) {
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { message: errorText || `HTTP ${response.status}: ${response.statusText}` }
        }
        throw new Error(errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (data.success || (data.updated && data.updated > 0)) {
        setErrorMessage(`✅ Successfully updated ${container} image in ${deployment}`)
        // Remove from pending updates
        const key = `${namespace}/${deployment}/${container}`
        const newUpdates = new Map(imageUpdates)
        newUpdates.delete(key)
        setImageUpdates(newUpdates)
        await loadData()
        setTimeout(() => setErrorMessage(null), 5000)
      } else {
        // Check if there are errors in the response
        const errorMsg = data.errors && data.errors.length > 0
          ? data.errors[0].error || data.errors[0].message
          : data.error || data.message
        const errorDetails = data.errors && data.errors.length > 0 && data.errors[0].deployment
          ? ` (${data.errors[0].deployment}/${data.errors[0].container})`
          : ''
        setErrorMessage(
          `❌ Failed to update image${errorDetails}: ${errorMsg || 'Unknown error'}`
        )
        setTimeout(() => setErrorMessage(null), 10000)
      }
    } catch (error: any) {
      console.error('Error updating image:', error)
      setErrorMessage(`❌ Failed to update image: ${error.message || 'Network error. Please check if the API server is running and you are connected to the cluster.'}`)
      setTimeout(() => setErrorMessage(null), 10000)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleUpdateImages = async () => {
    if (imageUpdates.size === 0) {
      setErrorMessage('No image updates to apply')
      return
    }

    setIsUpdating(true)
    setErrorMessage(null)

    try {
      const updates = Array.from(imageUpdates.values())
      
      // If selective mode, only update selected deployments
      let updatesToApply = updates
      if (updateMode === 'selective') {
        updatesToApply = updates.filter((update) => {
          const key = `${update.namespace}/${update.deployment}`
          return selectedDeployments.has(key)
        })
      }

      if (updatesToApply.length === 0) {
        setErrorMessage('Please select deployments to update or switch to bulk mode')
        setIsUpdating(false)
        return
      }

      const response = await fetch(`${apiUrl}/k8s/update-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates: updatesToApply }),
      })

      // Check if response is ok before parsing JSON
      if (!response.ok) {
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { message: errorText || `HTTP ${response.status}: ${response.statusText}` }
        }
        throw new Error(errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (data.success) {
        // All updates succeeded
        setErrorMessage(`✅ Successfully updated ${data.updated || updatesToApply.length} container(s)`)
        setImageUpdates(new Map())
        setSelectedDeployments(new Set())
        await loadData()
        setTimeout(() => setErrorMessage(null), 5000)
      } else if (data.updated && data.updated > 0) {
        // Partial success - some succeeded, some failed
        const errorDetails = data.errors && data.errors.length > 0
          ? data.errors.map((e: any) => `${e.deployment}/${e.container}: ${e.error}`).join('; ')
          : 'See details above'
        setErrorMessage(
          `⚠️ Partial update: ${data.updated} succeeded, ${data.failed || 0} failed. ${errorDetails}`
        )
        // Clear successful updates from the pending list
        if (data.results && Array.isArray(data.results)) {
          const newUpdates = new Map(imageUpdates)
          data.results.forEach((result: any) => {
            const key = `${result.namespace}/${result.deployment}/${result.container}`
            newUpdates.delete(key)
          })
          setImageUpdates(newUpdates)
        }
        await loadData()
        setTimeout(() => setErrorMessage(null), 8000)
      } else {
        // All updates failed
        const errorMsg = data.errors && data.errors.length > 0
          ? data.errors.map((e: any) => `${e.deployment}/${e.container}: ${e.error}`).join('; ')
          : data.error || data.message || 'Unknown error'
        setErrorMessage(`❌ Failed to update images: ${errorMsg}`)
        setTimeout(() => setErrorMessage(null), 10000)
      }
    } catch (error: any) {
      console.error('Error updating images:', error)
      setErrorMessage(`❌ Failed to update images: ${error.message || 'Network error. Please check if the API server is running and you are connected to the cluster.'}`)
      setTimeout(() => setErrorMessage(null), 10000)
    } finally {
      setIsUpdating(false)
    }
  }

  const toggleDeploymentSelection = (namespace: string, deploymentName: string) => {
    const key = `${namespace}/${deploymentName}`
    const newSelected = new Set(selectedDeployments)
    
    if (newSelected.has(key)) {
      newSelected.delete(key)
    } else {
      newSelected.add(key)
    }
    
    setSelectedDeployments(newSelected)
  }

  // Bulk Update Wizard Functions
  const handleSelectAllBulkUpdate = () => {
    if (bulkUpdateSelections.size === deployments.length) {
      setBulkUpdateSelections(new Set())
    } else {
      const allKeys = new Set(deployments.map(d => `${d.namespace}/${d.name}`))
      setBulkUpdateSelections(allKeys)
    }
  }

  const toggleBulkUpdateSelection = (namespace: string, name: string) => {
    const key = `${namespace}/${name}`
    const newSelected = new Set(bulkUpdateSelections)
    
    if (newSelected.has(key)) {
      newSelected.delete(key)
    } else {
      newSelected.add(key)
    }
    
    setBulkUpdateSelections(newSelected)
  }

  const handleBulkUpdateApply = async () => {
    if (bulkUpdateSelections.size === 0) {
      setErrorMessage('Please select at least one deployment')
      return
    }

    if (!bulkUpdateImage.trim()) {
      setErrorMessage('Please enter a new image' + (bulkUpdateTagOnly ? ' tag' : ''))
      return
    }

    setIsUpdating(true)
    setErrorMessage(null)

    try {
      // Build updates for all selected deployments and their containers
      const updates: ImageUpdate[] = []
      
      deployments.forEach((deployment) => {
        const key = `${deployment.namespace}/${deployment.name}`
        if (bulkUpdateSelections.has(key)) {
          deployment.containers.forEach((container) => {
            // If tag-only mode, apply the tag to the base image
            const finalImage = bulkUpdateTagOnly 
              ? applyTagOnlyUpdate(container.image, bulkUpdateImage.trim())
              : bulkUpdateImage.trim()
            
            updates.push({
              namespace: deployment.namespace,
              deployment: deployment.name,
              container: container.name,
              image: finalImage,
              originalImage: container.image,
            })
          })
        }
      })

      const response = await fetch(`${apiUrl}/k8s/update-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates }),
      })

      // Check if response is ok before parsing JSON
      if (!response.ok) {
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { message: errorText || `HTTP ${response.status}: ${response.statusText}` }
        }
        throw new Error(errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (data.success) {
        // All updates succeeded
        setErrorMessage(`✅ Successfully updated ${data.updated || updates.length} container(s)`)
        setShowBulkUpdateWizard(false)
        setBulkUpdateSelections(new Set())
        setBulkUpdateImage('')
        setBulkUpdateTagOnly(false)
        setBulkUpdateStep('select')
        await loadData()
        setTimeout(() => setErrorMessage(null), 5000)
      } else if (data.updated && data.updated > 0) {
        // Partial success - some succeeded, some failed
        const errorDetails = data.errors && data.errors.length > 0
          ? data.errors.map((e: any) => `${e.deployment}/${e.container}: ${e.error}`).join('; ')
          : 'See details above'
        setErrorMessage(
          `⚠️ Partial update: ${data.updated} succeeded, ${data.failed || 0} failed. ${errorDetails}`
        )
        setShowBulkUpdateWizard(false)
        setBulkUpdateSelections(new Set())
        setBulkUpdateImage('')
        setBulkUpdateTagOnly(false)
        setBulkUpdateStep('select')
        await loadData()
        setTimeout(() => setErrorMessage(null), 8000)
      } else {
        // All updates failed
        const errorMsg = data.errors && data.errors.length > 0
          ? data.errors.map((e: any) => `${e.deployment}/${e.container}: ${e.error}`).join('; ')
          : data.error || data.message || 'Unknown error'
        setErrorMessage(`❌ Failed to update images: ${errorMsg}`)
        setTimeout(() => setErrorMessage(null), 10000)
      }
    } catch (error: any) {
      console.error('Error updating images:', error)
      setErrorMessage(`❌ Failed to update images: ${error.message || 'Network error. Please check if the API server is running and you are connected to the cluster.'}`)
      setTimeout(() => setErrorMessage(null), 10000)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleScaleDeployment = async (namespace: string, name: string, replicas: number) => {
    setIsActioning(true)
    setErrorMessage(null)
    
    try {
      const response = await fetch(`${apiUrl}/k8s/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/scale`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ replicas }),
      })

      const data = await response.json()

      if (data.success) {
        setErrorMessage(`✅ ${data.message}`)
        setTimeout(() => setErrorMessage(null), 5000)
        setActionModal(null)
        // Reload deployments to reflect the change
        await loadData()
      } else {
        setErrorMessage(`❌ ${data.error || data.message || 'Failed to scale deployment'}`)
      }
    } catch (error: any) {
      setErrorMessage(`❌ Failed to scale deployment: ${error.message}`)
    } finally {
      setIsActioning(false)
    }
  }

  const handleRestartDeployment = async (namespace: string, name: string) => {
    setIsActioning(true)
    setErrorMessage(null)
    
    try {
      const response = await fetch(`${apiUrl}/k8s/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/restart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json()

      if (data.success) {
        setErrorMessage(`✅ ${data.message}`)
        setTimeout(() => setErrorMessage(null), 5000)
        setActionModal(null)
        // Reload deployments to reflect the change
        await loadData()
      } else {
        setErrorMessage(`❌ ${data.error || data.message || 'Failed to restart deployment'}`)
      }
    } catch (error: any) {
      setErrorMessage(`❌ Failed to restart deployment: ${error.message}`)
    } finally {
      setIsActioning(false)
    }
  }

  const handleDeleteResource = async (resourceType: string, namespace: string, name: string) => {
    setIsActioning(true)
    setErrorMessage(null)
    
    try {
      const response = await fetch(`${apiUrl}/k8s/${resourceType}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json()

      if (data.success) {
        setErrorMessage(`✅ ${data.message}`)
        setTimeout(() => setErrorMessage(null), 5000)
        setActionModal(null)
        // Reload data to reflect the deletion
        await loadData()
      } else {
        setErrorMessage(`❌ ${data.error || data.message || 'Failed to delete resource'}`)
      }
    } catch (error: any) {
      setErrorMessage(`❌ Failed to delete resource: ${error.message}`)
    } finally {
      setIsActioning(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Kubeconfig Input Section */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Server className="w-6 h-6" />
          Kubernetes Cluster Connection
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Kubeconfig Content
            </label>
            <textarea
              value={kubeconfig}
              onChange={(e) => setKubeconfig(e.target.value)}
              placeholder="Paste your kubeconfig YAML content here..."
              className="w-full h-48 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              disabled={isConnecting || isValidating}
            />
            <p className="mt-2 text-sm text-gray-500">
              Paste your kubeconfig YAML content above and click Connect
            </p>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={handleResolve}
              disabled={isResolving || !kubeconfig.trim()}
              className="flex items-center gap-2 px-6 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isResolving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Resolving...
                </>
              ) : (
                <>
                  <RefreshCw className="w-5 h-5" />
                  Resolve Issues
                </>
              )}
            </button>

            <button
              onClick={handleValidate}
              disabled={isValidating || !kubeconfig.trim()}
              className="flex items-center gap-2 px-6 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isValidating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  <Server className="w-5 h-5" />
                  Validate Config
                </>
              )}
            </button>

            <button
              onClick={handleConnect}
              disabled={isConnecting || !kubeconfig.trim()}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5" />
                  Connect to Cluster
                </>
              )}
            </button>

            {isConnected && (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">Connected</span>
              </div>
            )}
          </div>

          {/* Kubeconfig Management */}
          <div className="mt-4">
            <button
              onClick={() => setShowKubeconfigManager(!showKubeconfigManager)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
            >
              <Server className="w-4 h-4" />
              Manage Kubeconfigs ({kubeconfigs.length})
            </button>
          </div>

          {showKubeconfigManager && (
            <div className="mt-4 p-4 border border-gray-200 rounded-lg bg-gray-50">
              <h4 className="font-semibold text-gray-900 mb-4">Saved Kubeconfigs</h4>
              
              {/* Saved Kubeconfigs List */}
              <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
                {kubeconfigs.map((kc) => (
                  <div
                    key={kc.id}
                    className={`p-3 border rounded-lg flex items-center justify-between ${
                      kc.isActive ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{kc.name}</span>
                        {kc.isActive && (
                          <span className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded-full">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Created: {new Date(kc.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!kc.isActive && (
                        <button
                          onClick={() => handleActivateKubeconfig(kc.id)}
                          disabled={isConnecting}
                          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          Activate
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setKubeconfig(kc.kubeconfig)
                          setShowKubeconfigManager(false)
                        }}
                        className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeleteKubeconfig(kc.id)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {kubeconfigs.length === 0 && (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    No saved kubeconfigs. Add one below.
                  </div>
                )}
              </div>

              {/* Add New Kubeconfig */}
              <div className="border-t pt-4">
                <h5 className="font-medium text-gray-900 mb-2">Save New Kubeconfig</h5>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Enter kubeconfig name (e.g., Production Cluster)"
                    value={newKubeconfigName}
                    onChange={(e) => setNewKubeconfigName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                  <textarea
                    placeholder="Paste kubeconfig content here..."
                    value={newKubeconfigContent}
                    onChange={(e) => setNewKubeconfigContent(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono text-xs"
                    rows={6}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveKubeconfig}
                      disabled={isSavingKubeconfig || !newKubeconfigName.trim() || !newKubeconfigContent.trim()}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      {isSavingKubeconfig ? 'Saving...' : 'Save Kubeconfig'}
                    </button>
                    <button
                      onClick={() => {
                        setNewKubeconfigName('')
                        setNewKubeconfigContent('')
                      }}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Resolution Results */}
        {resolutionResult && resolutionResult.hasChanges && (
          <div className="mt-4 p-4 rounded-lg bg-purple-50 border border-purple-200">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-purple-800">
                    Kubeconfig Issues Resolved
                  </h4>
                  <button
                    onClick={handleApplyFixes}
                    className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors text-sm"
                  >
                    Apply Fixes
                  </button>
                </div>

                {resolutionResult.fixes.length > 0 && (
                  <div className="mb-3">
                    <h5 className="font-medium text-purple-800 mb-2">
                      Applied Fixes ({resolutionResult.fixes.length}):
                    </h5>
                    <ul className="list-disc list-inside space-y-1 text-sm text-purple-700">
                      {resolutionResult.fixes.map((fix, idx) => (
                        <li key={idx}>{fix}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {resolutionResult.remainingIssues.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-purple-200">
                    <h5 className="font-medium text-yellow-800 mb-2">
                      Issues That Could Not Be Auto-Resolved:
                    </h5>
                    <ul className="list-disc list-inside space-y-1 text-sm text-yellow-700">
                      {resolutionResult.remainingIssues.map((issue, idx) => (
                        <li key={idx}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-purple-200">
                  <p className="text-sm text-purple-700">
                    Click &quot;Apply Fixes&quot; to update your kubeconfig with the resolved version,
                    or review the changes and apply manually.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Validation Results */}
        {validationResult && (
          <div
            className={`mt-4 p-4 rounded-lg border ${
              validationResult.valid
                ? 'bg-green-50 border-green-200'
                : 'bg-yellow-50 border-yellow-200'
            }`}
          >
            <div className="flex items-start gap-3">
              {validationResult.valid ? (
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1">
                <h4
                  className={`font-semibold mb-2 ${
                    validationResult.valid ? 'text-green-800' : 'text-yellow-800'
                  }`}
                >
                  {validationResult.valid
                    ? 'Kubeconfig is Valid'
                    : 'Kubeconfig Validation Issues Found'}
                </h4>

                {validationResult.info && (
                  <div className="mb-3 text-sm text-gray-700">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <span className="font-medium">Clusters:</span>{' '}
                        {validationResult.info.clustersCount}
                      </div>
                      <div>
                        <span className="font-medium">Contexts:</span>{' '}
                        {validationResult.info.contextsCount}
                      </div>
                      <div>
                        <span className="font-medium">Users:</span>{' '}
                        {validationResult.info.usersCount}
                      </div>
                      <div>
                        <span className="font-medium">Current Context:</span>{' '}
                        {validationResult.info.currentContext || 'none'}
                      </div>
                    </div>
                  </div>
                )}

                {validationResult.issues && validationResult.issues.length > 0 && (
                  <div className="mb-3">
                    <h5 className="font-medium text-yellow-800 mb-2">Issues:</h5>
                    <ul className="list-disc list-inside space-y-1 text-sm text-yellow-700">
                      {validationResult.issues.map((issue, idx) => (
                        <li key={idx}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {validationResult.suggestions &&
                  validationResult.suggestions.length > 0 && (
                    <div>
                      <h5 className="font-medium text-yellow-800 mb-2">
                        Suggestions to Resolve:
                      </h5>
                      <ul className="list-disc list-inside space-y-1 text-sm text-yellow-700">
                        {validationResult.suggestions.map((suggestion, idx) => (
                          <li key={idx}>{suggestion}</li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>
            </div>
          </div>
        )}

        {errorMessage && (
          <div
            className={`mt-4 p-4 rounded-lg ${
              errorMessage.startsWith('✅')
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}
          >
            {errorMessage}
          </div>
        )}
      </div>

      {/* Namespace Dropdown Selector */}
      {isConnected && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-1 min-w-[200px]">
              <label htmlFor="namespace-select" className="text-sm font-medium text-gray-700 whitespace-nowrap">
                Select Namespace:
              </label>
              {namespaces.length > 0 ? (
                <select
                  id="namespace-select"
                  value={selectedNamespace || ''}
                  onChange={(e) => {
                    const newNamespace = e.target.value
                    setSelectedNamespace(newNamespace)
                    setImageUpdates(new Map())
                    // Load resources immediately when namespace changes
                    if (isConnected) {
                      setTimeout(() => loadData(), 100)
                    }
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                >
                  <option value="">Select a namespace...</option>
                  {namespaces.map((ns) => (
                    <option key={ns.name} value={ns.name}>
                      {ns.name} ({ns.status})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex-1 px-4 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500 text-sm">
                  No namespaces found. Click &quot;Load Namespaces&quot; to refresh.
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadNamespaces()}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
                title="Load namespaces list"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                {namespaces.length > 0 ? 'Refresh' : 'Load'} Namespaces
              </button>
              {namespaces.length > 0 && (
                <button
                  onClick={async () => {
                    // Preserve current tab and connection state
                    const currentTab = activeResourceTab
                    await loadData()
                    // Restore tab after refresh
                    setActiveResourceTab(currentTab)
                  }}
                  disabled={isLoading || !isConnected}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 text-sm"
                  title={selectedNamespace === 'all' ? 'Refresh all resources' : `Refresh resources in ${selectedNamespace} (keeps current tab and connection)`}
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                  {selectedNamespace === 'all' ? 'Refresh All Resources' : 'Refresh Resources'}
                </button>
              )}
            </div>
          </div>
          {namespaces.length === 0 && !isLoading && (
            <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded-md">
              <span className="text-sm text-yellow-800">
                No namespaces loaded. Click &quot;Load Namespaces&quot; to fetch namespaces from the cluster.
              </span>
            </div>
          )}
          {selectedNamespace && namespaces.length > 0 && (
            <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded-md flex items-center justify-between">
              <span className="text-sm text-blue-900">
                <span className="font-medium">Viewing resources in:</span>{' '}
                <span className="font-bold">{selectedNamespace === 'all' ? 'All Namespaces' : selectedNamespace}</span>
                {selectedNamespace !== 'all' && namespaces.find(ns => ns.name === selectedNamespace) && (
                  <span className="ml-2 text-xs">
                    ({namespaces.find(ns => ns.name === selectedNamespace)?.status})
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      )}


      {/* Resources Section - Show when connected */}
      {isConnected && (
        <>
      {/* Update Mode Selection */}
      {isConnected && deployments.length > 0 && (
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center gap-6">
            <span className="text-sm font-medium text-gray-700">Update Mode:</span>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="updateMode"
                value="selective"
                checked={updateMode === 'selective'}
                onChange={(e) => setUpdateMode(e.target.value as 'selective' | 'bulk')}
                className="w-4 h-4"
              />
              <span>Selective (choose deployments)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="updateMode"
                value="bulk"
                checked={updateMode === 'bulk'}
                onChange={(e) => setUpdateMode(e.target.value as 'selective' | 'bulk')}
                className="w-4 h-4"
              />
              <span>Bulk (all deployments)</span>
            </label>
          </div>

          {updateMode === 'bulk' && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Bulk Image Update Wizard:
              </label>
              <button
                onClick={() => {
                  setShowBulkUpdateWizard(true)
                  setBulkUpdateStep('select')
                  // Pre-select all if none selected
                  if (bulkUpdateSelections.size === 0) {
                    const allKeys = new Set(deployments.map(d => `${d.namespace}/${d.name}`))
                    setBulkUpdateSelections(allKeys)
                  }
                }}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Open Bulk Update Wizard
              </button>
            </div>
          )}
        </div>
      )}

          {/* Deployments and Pods Tabbed Pane - Only show when a specific namespace is selected */}
          {isConnected && selectedNamespace && selectedNamespace !== 'all' && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-6">
              {/* Tab Headers */}
              <div className="border-b border-gray-200 bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center overflow-x-auto flex-1">
                  <button
                    onClick={() => setActiveResourceTab('deployments')}
                    className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                      activeResourceTab === 'deployments'
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    Deployments ({deployments.length})
                  </button>
                  <button
                    onClick={() => setActiveResourceTab('pods')}
                    className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                      activeResourceTab === 'pods'
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    Pods ({pods.length})
                  </button>
                  <button
                    onClick={() => setActiveResourceTab('services')}
                    className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                      activeResourceTab === 'services'
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    Services ({services.length})
                  </button>
                  <button
                    onClick={() => setActiveResourceTab('configmaps')}
                    className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                      activeResourceTab === 'configmaps'
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    ConfigMaps ({configmaps.length})
                  </button>
                  <button
                    onClick={() => setActiveResourceTab('events')}
                    className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                      activeResourceTab === 'events'
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    Events ({events.length})
                  </button>
                  <button
                    onClick={() => setActiveResourceTab('cronjobs')}
                    className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                      activeResourceTab === 'cronjobs'
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    CronJobs ({cronjobs.length})
                  </button>
                  <button
                    onClick={() => setActiveResourceTab('jobs')}
                    className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                      activeResourceTab === 'jobs'
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    Jobs ({jobs.length})
                  </button>
                  <button
                    onClick={() => setActiveResourceTab('flow-tracing')}
                    className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                      activeResourceTab === 'flow-tracing'
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Network className="w-4 h-4" />
                      Flow Tracing
                    </div>
                  </button>
                </div>
                {/* Refresh Button */}
                <div className="px-4 py-2 border-l border-gray-200">
                  <button
                    onClick={async () => {
                      // Preserve current tab and connection state
                      const currentTab = activeResourceTab
                      await loadData()
                      // Restore tab after refresh
                      setActiveResourceTab(currentTab)
                    }}
                    disabled={isLoading || !isConnected}
                    className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    title="Refresh resources (keeps current tab and connection)"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
              </div>
                <div className="px-4 py-2 flex items-center gap-3">
                  <div className="text-sm text-gray-500 whitespace-nowrap">
                    Namespace: {selectedNamespace}
                  </div>
                </div>
              </div>

              {/* Tab Content */}
              <div className="p-0">
                {/* Deployments Tab Content */}
                {activeResourceTab === 'deployments' && (
                  <div>
                    {isLoading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
              <p className="mt-4 text-gray-500">Loading deployments...</p>
            </div>
          ) : deployments.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              No deployments found {selectedNamespace === 'all' ? 'in any namespace' : `in namespace "${selectedNamespace}"`}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {updateMode === 'selective' && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        <input
                          type="checkbox"
                          checked={
                            deployments.length > 0 &&
                            deployments.every((d) =>
                              selectedDeployments.has(`${d.namespace}/${d.name}`)
                            )
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedDeployments(
                                new Set(
                                  deployments.map((d) => `${d.namespace}/${d.name}`)
                                )
                              )
                            } else {
                              setSelectedDeployments(new Set())
                            }
                          }}
                          className="w-4 h-4"
                        />
                      </th>
                    )}
                    {selectedNamespace === 'all' && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Namespace
                      </th>
                    )}
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Deployment
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Replicas
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Container
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Current Image
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      New Image
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {deployments.map((deployment) =>
                    deployment.containers.map((container, idx) => {
                      const key = `${deployment.namespace}/${deployment.name}/${container.name}`
                      const update = imageUpdates.get(key)
                      const isSelected = selectedDeployments.has(
                        `${deployment.namespace}/${deployment.name}`
                      )

                      const handleDeploymentRowClick = (e: React.MouseEvent) => {
                        // Avoid opening the modal when interacting with inputs/buttons inside the row
                        const interactive = (e.target as HTMLElement)?.closest('input, button, select, textarea')
                        if (interactive) return
                        setSelectedResource({ type: 'deployment', namespace: deployment.namespace, name: deployment.name })
                      }

                      return (
                        <tr
                          key={`${deployment.name}-${container.name}-${idx}`}
                          className={`${update ? 'bg-blue-50' : ''} ${idx === 0 ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                          onClick={idx === 0 ? handleDeploymentRowClick : undefined}
                        >
                          {updateMode === 'selective' && idx === 0 && (
                            <td
                              rowSpan={deployment.containers.length}
                              className="px-6 py-4 align-top"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() =>
                                  toggleDeploymentSelection(deployment.namespace, deployment.name)
                                }
                                className="w-4 h-4"
                              />
                            </td>
                          )}
                          {selectedNamespace === 'all' && idx === 0 && (
                            <td
                              rowSpan={deployment.containers.length}
                              className="px-6 py-4 align-top text-sm font-medium text-gray-700"
                            >
                              {deployment.namespace}
                            </td>
                          )}
                          {idx === 0 && (
                            <td
                              rowSpan={deployment.containers.length}
                              className="px-6 py-4 align-top text-sm font-medium text-gray-900"
                            >
                              {deployment.name}
                              <div className="text-xs text-gray-500 mt-1">
                                {deployment.readyReplicas}/{deployment.replicas} ready
                              </div>
                            </td>
                          )}
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {container.name}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-600 font-mono text-xs">
                            {container.image}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                key={`${deployment.name}-${container.name}-${container.image}`}
                                value={update ? update.image : container.image}
                                onChange={(e) =>
                                  handleImageChange(
                                    deployment.namespace,
                                    deployment.name,
                                    container.name,
                                    e.target.value,
                                    container.image
                                  )
                                }
                                placeholder={container.image}
                                className="flex-1 px-3 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                              />
                              {update && update.image !== container.image && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    // Get the current value from the update state (more reliable than DOM query)
                                    const newImage = update?.image || container.image
                                    if (!newImage || newImage.trim() === '') {
                                      setErrorMessage('Please enter a valid image name')
                                      setTimeout(() => setErrorMessage(null), 2000)
                                      return
                                    }
                                    handleSaveSingleImage(
                                      deployment.namespace,
                                      deployment.name,
                                      container.name,
                                      newImage,
                                      container.image
                                    )
                                  }}
                                  disabled={isUpdating}
                                  className="px-3 py-1 bg-green-600 text-white text-xs rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 whitespace-nowrap"
                                  title="Save this image"
                                >
                                  {isUpdating ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Save className="w-3 h-3" />
                                  )}
                                  Save
                                </button>
                              )}
                            </div>
                            {update && update.image !== container.image && (
                              <span className="text-xs text-blue-600 mt-1 block">
                                Changed from: {container.image}
                              </span>
                            )}
                          </td>
                          {idx === 0 && (
                            <td
                              rowSpan={deployment.containers.length}
                              className="px-6 py-4 align-top"
                            >
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setActionModal({
                                      type: 'scale',
                                      resourceType: 'deployment',
                                      namespace: deployment.namespace,
                                      name: deployment.name,
                                      currentReplicas: deployment.replicas
                                    })
                                    setScaleReplicas(deployment.replicas)
                                  }}
                                  className="p-2 text-green-600 hover:text-green-800 hover:bg-green-50 rounded transition-colors"
                                  title="Scale deployment"
                                >
                                  <Plus className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setActionModal({
                                      type: 'restart',
                                      resourceType: 'deployment',
                                      namespace: deployment.namespace,
                                      name: deployment.name
                                    })
                                  }}
                                  className="p-2 text-orange-600 hover:text-orange-800 hover:bg-orange-50 rounded transition-colors"
                                  title="Restart deployment"
                                >
                                  <RotateCw className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setActionModal({
                                      type: 'delete',
                                      resourceType: 'deployments',
                                      namespace: deployment.namespace,
                                      name: deployment.name
                                    })
                                  }}
                                  className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                                  title="Delete deployment"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    // Focus on first container image input for this deployment
                                    const firstInput = document.querySelector(
                                      `input[placeholder="${deployment.containers[0]?.image}"]`
                                    ) as HTMLInputElement
                                    firstInput?.focus()
                                  }}
                                  className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                                  title="Edit deployment images"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    // View deployment details
                                    setErrorMessage(
                                      `Viewing deployment: ${deployment.name} (${deployment.readyReplicas}/${deployment.replicas} replicas)`
                                    )
                                    setTimeout(() => setErrorMessage(null), 3000)
                                  }}
                                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded transition-colors"
                                  title="View deployment details"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Cluster Nodes - independent of namespace selection */}
          {isConnected && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-gray-900">Cluster Nodes</h3>
                  <p className="text-xs text-gray-500">Node health and capacity (cluster-wide)</p>
                </div>
                <span className="text-xs text-gray-500">Nodes: {nodes.length}</span>
              </div>
              {nodes.length === 0 ? (
                <div className="p-8 text-center text-gray-500">No nodes found in the cluster.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Roles</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kubelet</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Runtime</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">CPU</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Memory</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pods</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {nodes.map((node: NodeInfo) => {
                        const isReady = node.status === 'Ready'
                        return (
                          <tr key={node.name} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {node.name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                  isReady ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {node.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                              {node.roles && node.roles.length > 0 ? node.roles.join(', ') : '—'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                              {node.kubeletVersion || '—'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                              {node.containerRuntime || '—'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                              {node.cpu || '—'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                              {node.memory || '—'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                              {node.podCapacity || '—'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                              {node.creationTimestamp ? new Date(node.creationTimestamp).toLocaleString() : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

                    {imageUpdates.size > 0 && (
                      <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">
                            {imageUpdates.size} container image(s) pending update
                          </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setShowImageComparison(true)}
                            className="flex items-center gap-2 px-4 py-2 border border-blue-200 text-blue-700 rounded-md hover:bg-blue-50 transition-colors text-sm"
                          >
                            <Eye className="w-4 h-4" />
                            Review changes
                          </button>
                          <button
                            onClick={handleUpdateImages}
                            disabled={isUpdating}
                            className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50"
                          >
                            {isUpdating ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Updating...
                              </>
                            ) : (
                              <>
                                <Save className="w-4 h-4" />
                                Apply Updates ({imageUpdates.size})
                              </>
                            )}
                          </button>
                        </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Pods Tab Content */}
                {activeResourceTab === 'pods' && (
                  <div>
                    {isLoading ? (
                      <div className="p-12 text-center">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                        <p className="mt-4 text-gray-500">Loading pods...</p>
                      </div>
                    ) : pods.length === 0 ? (
                      <div className="p-12 text-center text-gray-500">
                        No pods found {selectedNamespace === 'all' ? 'in any namespace' : `in namespace "${selectedNamespace}"`}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              {selectedNamespace === 'all' && (
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                  Namespace
                                </th>
                              )}
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                Pod Name
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                Status
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                Node
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                Pod IP
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                Containers
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                Restarts
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {pods.map((pod) => (
                              <tr 
                                key={`${pod.namespace}-${pod.name}`} 
                                className="hover:bg-gray-50 cursor-pointer"
                                onClick={() => setSelectedResource({ type: 'pod', namespace: pod.namespace, name: pod.name })}
                              >
                                {selectedNamespace === 'all' && (
                                  <td className="px-6 py-4 text-sm font-medium text-gray-700">
                                    {pod.namespace}
                                  </td>
                                )}
                                <td className="px-6 py-4 text-sm font-medium text-gray-900">
                                  {pod.name}
                                </td>
                                <td className="px-6 py-4 text-sm">
                                  <span
                                    className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                      pod.status === 'Running' && pod.ready
                                        ? 'bg-green-100 text-green-800'
                                        : pod.status === 'Pending'
                                        ? 'bg-yellow-100 text-yellow-800'
                                        : pod.status === 'Failed' || pod.status === 'Error'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-gray-100 text-gray-800'
                                    }`}
                                  >
                                    {pod.status}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600 font-mono text-xs">
                                  {pod.nodeName || '-'}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600 font-mono text-xs">
                                  {pod.podIP || '-'}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                  <div className="space-y-1">
                                    {pod.containers.map((container, idx) => (
                                      <div key={idx} className="text-xs">
                                        <span className="font-medium">{container.name}:</span>{' '}
                                        <span className="font-mono">{container.image}</span>
                                        {container.ready !== undefined && (
                                          <span
                                            className={`ml-2 px-1 py-0.5 rounded text-xs ${
                                              container.ready
                                                ? 'bg-green-100 text-green-700'
                                                : 'bg-red-100 text-red-700'
                                            }`}
                                          >
                                            {container.ready ? '✓' : '✗'}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                  {pod.restartCount || 0}
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setSelectedResource({ type: 'pod', namespace: pod.namespace, name: pod.name })
                                      }}
                                      className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded transition-colors"
                                      title="View pod details"
                                    >
                                      <Eye className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setSelectedLogPod({ namespace: pod.namespace, name: pod.name, container: pod.containers?.[0]?.name })
                                      }}
                                      className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                                      title="View pod logs"
                                    >
                                      <FileText className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (confirm(`Are you sure you want to delete pod "${pod.name}" in namespace "${pod.namespace}"?`)) {
                                          handleDeleteResource('pods', pod.namespace, pod.name)
                                        }
                                      }}
                                      disabled={isActioning}
                                      className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Delete pod"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Services Tab Content */}
                {activeResourceTab === 'services' && (
                  <div>
                    {isLoading ? (
                      <div className="p-12 text-center">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                        <p className="mt-4 text-gray-500">Loading services...</p>
                      </div>
                    ) : services.length === 0 ? (
                      <div className="p-12 text-center text-gray-500">
                        No services found in namespace &quot;{selectedNamespace}&quot;
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Service Name</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cluster IP</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ports</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {services.map((service) => (
                              <tr 
                                key={service.name} 
                                className="hover:bg-gray-50 cursor-pointer"
                                onClick={() => setSelectedResource({ type: 'service', namespace: service.namespace, name: service.name })}
                              >
                                <td className="px-6 py-4 text-sm font-medium text-gray-900">{service.name}</td>
                                <td className="px-6 py-4 text-sm text-gray-600">{service.type}</td>
                                <td className="px-6 py-4 text-sm text-gray-600 font-mono text-xs">{service.clusterIP || '-'}</td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                  {service.ports.map((port, idx) => (
                                    <div key={idx} className="text-xs">
                                      {port.port}/{port.protocol}
                                    </div>
                                  ))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ConfigMaps Tab Content */}
                {activeResourceTab === 'configmaps' && (
                  <div>
                    {isLoading ? (
                      <div className="p-12 text-center">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                        <p className="mt-4 text-gray-500">Loading configmaps...</p>
                      </div>
                    ) : configmaps.length === 0 ? (
                      <div className="p-12 text-center text-gray-500">
                        No configmaps found in namespace &quot;{selectedNamespace}&quot;
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ConfigMap Name</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Data Keys</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {configmaps.map((cm) => (
                              <tr 
                                key={cm.name} 
                                className="hover:bg-gray-50 cursor-pointer"
                                onClick={() => setSelectedResource({ type: 'configmap', namespace: cm.namespace, name: cm.name })}
                              >
                                <td className="px-6 py-4 text-sm font-medium text-gray-900">{cm.name}</td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                  <div className="flex flex-wrap gap-1">
                                    {Object.keys(cm.data || {}).map((key) => (
                                      <span key={key} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                                        {key}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                  {cm.creationTimestamp ? new Date(cm.creationTimestamp).toLocaleDateString() : '-'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Events Tab Content */}
                {activeResourceTab === 'events' && (
                  <div>
                    {isLoading ? (
                      <div className="p-12 text-center">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                        <p className="mt-4 text-gray-500">Loading events...</p>
                      </div>
                    ) : events.length === 0 ? (
                      <div className="p-12 text-center text-gray-500">
                        No events found in namespace &quot;{selectedNamespace}&quot;
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Object</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Count</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Seen</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {events.map((event) => (
                              <tr key={event.name} className="hover:bg-gray-50">
                                <td className="px-6 py-4 text-sm font-medium text-gray-900">
                                  {event.involvedObject?.kind}/{event.involvedObject?.name}
                                </td>
                                <td className="px-6 py-4 text-sm">
                                  <span
                                    className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                      event.type === 'Warning'
                                        ? 'bg-yellow-100 text-yellow-800'
                                        : 'bg-green-100 text-green-800'
                                    }`}
                                  >
                                    {event.type}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600">{event.reason}</td>
                                <td className="px-6 py-4 text-sm text-gray-600 max-w-md truncate">{event.message}</td>
                                <td className="px-6 py-4 text-sm text-gray-600">{event.count || 0}</td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                  {event.lastTimestamp ? new Date(event.lastTimestamp).toLocaleString() : '-'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* CronJobs Tab Content */}
                {activeResourceTab === 'cronjobs' && (
                  <div>
                    {isLoading ? (
                      <div className="p-12 text-center">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                        <p className="mt-4 text-gray-500">Loading cronjobs...</p>
                      </div>
                    ) : cronjobs.length === 0 ? (
                      <div className="p-12 text-center text-gray-500">
                        No cronjobs found in namespace &quot;{selectedNamespace}&quot;
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Schedule</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Suspend</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Schedule</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Containers</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {cronjobs.map((cronjob) => (
                              <tr
                                key={`${cronjob.namespace}/${cronjob.name}`}
                                className="hover:bg-gray-50 cursor-pointer"
                                onClick={() => setSelectedResource({ type: 'cronjob', namespace: cronjob.namespace, name: cronjob.name })}
                              >
                                <td className="px-6 py-4 text-sm font-medium text-gray-900">{cronjob.name}</td>
                                <td className="px-6 py-4 text-sm text-gray-600 font-mono">{cronjob.schedule || '-'}</td>
                                <td className="px-6 py-4 text-sm">
                                  <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${cronjob.suspend ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                    {cronjob.suspend ? 'Yes' : 'No'}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600">{cronjob.active}</td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                  {cronjob.lastScheduleTime ? new Date(cronjob.lastScheduleTime).toLocaleString() : '-'}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                  <div className="flex flex-col gap-1">
                                    {cronjob.containers.map((container) => (
                                      <span key={container.name} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                                        {container.name}: {container.image.split(':')[0]}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                  {cronjob.creationTimestamp ? new Date(cronjob.creationTimestamp).toLocaleDateString() : '-'}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSelectedResource({ type: 'cronjob', namespace: cronjob.namespace, name: cronjob.name })
                                    }}
                                    className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                  >
                                    <Eye className="w-4 h-4" />
                                    View Details
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Jobs Tab Content */}
                {activeResourceTab === 'flow-tracing' && (
                  <div className="mt-4">
                    <FlowVisualization 
                      apiUrl={apiUrl} 
                      namespace={selectedNamespace && selectedNamespace !== 'all' ? selectedNamespace : undefined}
                    />
                  </div>
                )}

                {activeResourceTab === 'jobs' && (
                  <div>
                    {isLoading ? (
                      <div className="p-12 text-center">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                        <p className="mt-4 text-gray-500">Loading jobs...</p>
                      </div>
                    ) : jobs.length === 0 ? (
                      <div className="p-12 text-center text-gray-500">
                        No jobs found in namespace &quot;{selectedNamespace}&quot;
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Completions</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Succeeded</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Failed</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Age</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Containers</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {jobs.map((job) => {
                              const jobAge = job.startTime ? new Date(job.startTime) : null
                              const ageString = jobAge ? `${Math.floor((Date.now() - jobAge.getTime()) / (1000 * 60))}m` : '-'
                              return (
                                <tr
                                  key={`${job.namespace}/${job.name}`}
                                  className="hover:bg-gray-50 cursor-pointer"
                                  onClick={() => setSelectedResource({ type: 'job', namespace: job.namespace, name: job.name })}
                                >
                                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{job.name}</td>
                                  <td className="px-6 py-4 text-sm text-gray-600">{job.succeeded}/{job.completions}</td>
                                  <td className="px-6 py-4 text-sm">
                                    <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                                      {job.succeeded}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 text-sm">
                                    {job.failed > 0 ? (
                                      <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                                        {job.failed}
                                      </span>
                                    ) : (
                                      <span className="text-gray-600">0</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 text-sm">
                                    {job.active > 0 ? (
                                      <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                                        {job.active}
                                      </span>
                                    ) : (
                                      <span className="text-gray-600">0</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 text-sm text-gray-600">{ageString}</td>
                                  <td className="px-6 py-4 text-sm text-gray-600">
                                    <div className="flex flex-col gap-1">
                                      {job.containers.map((container) => (
                                        <span key={container.name} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                                          {container.name}: {container.image.split(':')[0]}
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-sm text-gray-600">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setSelectedResource({ type: 'job', namespace: job.namespace, name: job.name })
                                      }}
                                      className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                    >
                                      <Eye className="w-4 h-4" />
                                      View Details
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Old Pods Table - Removed (now in tabbed pane) */}
      {false && isConnected && selectedNamespace && showPods && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-orange-50 to-amber-50 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-800">
              Pods ({pods.length}) {selectedNamespace === 'all' ? '- All Namespaces' : `- Namespace: ${selectedNamespace}`}
            </h3>
            <button
              onClick={() => setShowPods(false)}
              className="text-gray-500 hover:text-gray-700 px-3 py-1 text-sm"
            >
              Hide
            </button>
          </div>

          {isLoading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
              <p className="mt-4 text-gray-500">Loading pods...</p>
            </div>
          ) : pods.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              No pods found {selectedNamespace === 'all' ? 'in any namespace' : `in namespace "${selectedNamespace}"`}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {selectedNamespace === 'all' && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Namespace
                      </th>
                    )}
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Pod Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Node
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Pod IP
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Containers
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Restarts
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {pods.map((pod) => (
                    <tr key={`${pod.namespace}-${pod.name}`} className="hover:bg-gray-50">
                      {selectedNamespace === 'all' && (
                        <td className="px-6 py-4 text-sm font-medium text-gray-700">
                          {pod.namespace}
                        </td>
                      )}
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {pod.name}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            pod.status === 'Running' && pod.ready
                              ? 'bg-green-100 text-green-800'
                              : pod.status === 'Pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : pod.status === 'Failed' || pod.status === 'Error'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {pod.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 font-mono text-xs">
                        {pod.nodeName || '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 font-mono text-xs">
                        {pod.podIP || '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        <div className="space-y-1">
                          {pod.containers.map((container, idx) => (
                            <div key={idx} className="text-xs">
                              <span className="font-medium">{container.name}:</span>{' '}
                              <span className="font-mono">{container.image}</span>
                              {container.ready !== undefined && (
                                <span
                                  className={`ml-2 px-1 py-0.5 rounded text-xs ${
                                    container.ready
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-red-100 text-red-700'
                                  }`}
                                >
                                  {container.ready ? '✓' : '✗'}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {pod.restartCount || 0}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setErrorMessage(`Viewing pod: ${pod.name} - Status: ${pod.status}`)
                              setTimeout(() => setErrorMessage(null), 3000)
                            }}
                            className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded transition-colors"
                            title="View pod details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}


      {/* Services Table with Edit */}
      {/* Old Services Table - Removed (now in tabbed pane) */}
      {false && isConnected && selectedNamespace && showServices && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-800">
              Services ({services.length}) {selectedNamespace === 'all' ? '- All Namespaces' : `- Namespace: ${selectedNamespace}`}
            </h3>
            <button
              onClick={() => setShowServices(false)}
              className="text-gray-500 hover:text-gray-700 px-3 py-1 text-sm"
            >
              Hide
            </button>
          </div>

          {isLoading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
              <p className="mt-4 text-gray-500">Loading services...</p>
            </div>
          ) : services.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              No services found {selectedNamespace === 'all' ? 'in any namespace' : `in namespace "${selectedNamespace}"`}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {selectedNamespace === 'all' && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Namespace
                      </th>
                    )}
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Service
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Cluster IP
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Ports
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Selector
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {services.map((service) => (
                    <tr key={`${service.namespace}-${service.name}`} className="hover:bg-gray-50">
                      {selectedNamespace === 'all' && (
                        <td className="px-6 py-4 text-sm font-medium text-gray-700">
                          {service.namespace}
                        </td>
                      )}
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {service.name}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                          {service.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 font-mono text-xs">
                        {service.clusterIP || '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {service.ports.map((port, idx) => (
                          <div key={idx} className="text-xs">
                            {port.port}:{port.targetPort}/{port.protocol}
                            {port.name && ` (${port.name})`}
                          </div>
                        ))}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(service.selector).map(([key, value]) => (
                            <span
                              key={key}
                              className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs"
                            >
                              {key}={value}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Resource Detail Modal */}
      <ResourceDetailModal
        isOpen={selectedResource !== null}
        onClose={() => setSelectedResource(null)}
        resourceType={selectedResource?.type || null}
        namespace={selectedResource?.namespace || ''}
        name={selectedResource?.name || ''}
        apiUrl={apiUrl}
      />

      {selectedLogPod && (
        <PodLogsModal
          isOpen={!!selectedLogPod}
          onClose={() => setSelectedLogPod(null)}
          podName={selectedLogPod.name}
          namespace={selectedLogPod.namespace}
          container={selectedLogPod.container}
          apiUrl={apiUrl}
        />
      )}

      {/* Bulk Update Image Wizard Modal */}
      {showBulkUpdateWizard && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-[90vw] max-h-[85vh] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Bulk Image Update Wizard</h3>
                <p className="text-sm text-gray-500">
                  {bulkUpdateStep === 'select' 
                    ? 'Step 1: Select deployments to update' 
                    : 'Step 2: Review and apply updates'}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowBulkUpdateWizard(false)
                  setBulkUpdateSelections(new Set())
                  setBulkUpdateImage('')
                  setBulkUpdateTagOnly(false)
                  setBulkUpdateStep('select')
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-auto max-h-[65vh]">
              {bulkUpdateStep === 'select' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bulkUpdateSelections.size === deployments.length && deployments.length > 0}
                        onChange={handleSelectAllBulkUpdate}
                        className="w-4 h-4"
                      />
                      <span className="font-medium text-gray-700">
                        Select All ({bulkUpdateSelections.size}/{deployments.length} selected)
                      </span>
                    </label>
                    <div className="text-sm text-gray-500">
                      {bulkUpdateSelections.size} deployment(s) selected
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12"></th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Deployment</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Containers</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current Images</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {deployments.map((deployment) => {
                          const key = `${deployment.namespace}/${deployment.name}`
                          const isSelected = bulkUpdateSelections.has(key)
                          return (
                            <tr key={key} className={isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                              <td className="px-4 py-3">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleBulkUpdateSelection(deployment.namespace, deployment.name)}
                                  className="w-4 h-4"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium text-gray-900">{deployment.name}</div>
                                <div className="text-xs text-gray-500">{deployment.namespace}</div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="space-y-1">
                                  {deployment.containers.map((container, idx) => (
                                    <div key={idx} className="text-xs text-gray-600">
                                      {container.name}
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="space-y-1">
                                  {deployment.containers.map((container, idx) => (
                                    <div key={idx} className="text-xs font-mono text-gray-600">
                                      {container.image}
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="bulkUpdateTagOnly"
                        checked={bulkUpdateTagOnly}
                        onChange={(e) => setBulkUpdateTagOnly(e.target.checked)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <label htmlFor="bulkUpdateTagOnly" className="text-sm font-medium text-gray-700 cursor-pointer">
                        Update tag only (keep base image/service name)
                      </label>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {bulkUpdateTagOnly ? 'New Tag (applies to all selected containers):' : 'New Image (applies to all selected containers):'}
                      </label>
                      <input
                        type="text"
                        value={bulkUpdateImage}
                        onChange={(e) => setBulkUpdateImage(e.target.value)}
                        placeholder={bulkUpdateTagOnly ? "e.g., 1.12.0-rc5 or latest" : "e.g., nginx:1.25 or myregistry.io/app:v2.0"}
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                      />
                      {bulkUpdateTagOnly && (
                        <p className="mt-1 text-xs text-gray-500">
                          Only the tag portion will be updated. Base image will remain unchanged.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="font-medium text-blue-900 mb-2">Update Summary</h4>
                    <div className="text-sm text-blue-800">
                      <p>• {bulkUpdateSelections.size} deployment(s) selected</p>
                      <p>• New image: <span className="font-mono">{bulkUpdateImage}</span></p>
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Deployment</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Container</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current Image</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">New Image</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {deployments
                          .filter(d => bulkUpdateSelections.has(`${d.namespace}/${d.name}`))
                          .map((deployment) => (
                            deployment.containers.map((container, idx) => {
                              const newImage = bulkUpdateTagOnly 
                                ? applyTagOnlyUpdate(container.image, bulkUpdateImage.trim())
                                : bulkUpdateImage.trim()
                              return (
                                <tr key={`${deployment.name}-${container.name}-${idx}`} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 text-gray-900">{deployment.name}</td>
                                  <td className="px-4 py-3 text-gray-900">{container.name}</td>
                                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{container.image}</td>
                                  <td className="px-4 py-3 font-mono text-xs text-blue-700 font-medium">{newImage}</td>
                                </tr>
                              )
                            })
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <button
                onClick={() => {
                  if (bulkUpdateStep === 'preview') {
                    setBulkUpdateStep('select')
                  } else {
                    setShowBulkUpdateWizard(false)
                    setBulkUpdateSelections(new Set())
                    setBulkUpdateImage('')
                    setBulkUpdateTagOnly(false)
                  }
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
              >
                {bulkUpdateStep === 'preview' ? 'Back' : 'Cancel'}
              </button>
              <div className="flex items-center gap-2">
                {bulkUpdateStep === 'select' ? (
                  <button
                    onClick={() => {
                      if (bulkUpdateSelections.size === 0) {
                        setErrorMessage('Please select at least one deployment')
                        return
                      }
                      if (!bulkUpdateImage.trim()) {
                        setErrorMessage('Please enter a new ' + (bulkUpdateTagOnly ? 'tag' : 'image'))
                        return
                      }
                      setBulkUpdateStep('preview')
                    }}
                    disabled={bulkUpdateSelections.size === 0 || !bulkUpdateImage.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next: Review
                  </button>
                ) : (
                  <button
                    onClick={handleBulkUpdateApply}
                    disabled={isUpdating}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isUpdating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        Apply Updates
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image comparison modal */}
      {showImageComparison && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black bg-opacity-40"
            onClick={() => setShowImageComparison(false)}
          />
          <div className="relative bg-white rounded-lg shadow-xl max-w-5xl w-[90vw] max-h-[80vh] overflow-hidden z-50">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Image update review</h3>
                <p className="text-sm text-gray-500">
                  Compare current vs new images before applying updates
                </p>
              </div>
              <button
                onClick={() => setShowImageComparison(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-auto max-h-[70vh]">
              {imageUpdates.size === 0 ? (
                <p className="text-sm text-gray-500">No pending image updates.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Namespace</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Deployment</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Container</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current Image</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">New Image</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {Array.from(imageUpdates.values()).map((update, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900">{update.namespace}</td>
                        <td className="px-4 py-3 text-gray-900">{update.deployment}</td>
                        <td className="px-4 py-3 text-gray-900">{update.container}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">{update.originalImage}</td>
                        <td className="px-4 py-3 font-mono text-xs text-blue-700">{update.image}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm text-gray-600">
                {imageUpdates.size} change(s) ready to apply
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowImageComparison(false)}
                  className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    setShowImageComparison(false)
                    handleUpdateImages()
                  }}
                  disabled={isUpdating || imageUpdates.size === 0}
                  className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {isUpdating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Applying...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Apply now
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action Confirmation Modals */}
      {actionModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={() => setActionModal(null)}></div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">
                    {actionModal.type === 'scale' && 'Scale Deployment'}
                    {actionModal.type === 'restart' && 'Restart Deployment'}
                    {actionModal.type === 'delete' && 'Delete Resource'}
                  </h3>
                  <button
                    onClick={() => setActionModal(null)}
                    className="text-gray-400 hover:text-gray-500"
                  >
                    <XCircle className="h-6 w-6" />
                  </button>
                </div>

                {actionModal.type === 'scale' && (
                  <div>
                    <p className="text-sm text-gray-500 mb-4">
                      Scale deployment <strong>{actionModal.name}</strong> in namespace <strong>{actionModal.namespace}</strong>
                    </p>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setScaleReplicas(Math.max(0, scaleReplicas - 1))}
                        className="p-2 border border-gray-300 rounded-md hover:bg-gray-50"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={scaleReplicas}
                        onChange={(e) => setScaleReplicas(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-20 px-3 py-2 border border-gray-300 rounded-md text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => setScaleReplicas(scaleReplicas + 1)}
                        className="p-2 border border-gray-300 rounded-md hover:bg-gray-50"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <span className="text-sm text-gray-600">replicas</span>
                    </div>
                    {actionModal.currentReplicas !== undefined && (
                      <p className="text-xs text-gray-500 mt-2">
                        Current: {actionModal.currentReplicas} replicas
                      </p>
                    )}
                  </div>
                )}

                {actionModal.type === 'restart' && (
                  <div>
                    <p className="text-sm text-gray-500 mb-4">
                      Are you sure you want to restart deployment <strong>{actionModal.name}</strong> in namespace <strong>{actionModal.namespace}</strong>?
                    </p>
                    <p className="text-xs text-gray-400">
                      This will trigger a rolling restart of all pods in the deployment.
                    </p>
                  </div>
                )}

                {actionModal.type === 'delete' && (
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                      <AlertTriangle className="w-6 h-6 text-red-600" />
                      <p className="text-sm text-gray-700">
                        Are you sure you want to delete <strong>{actionModal.resourceType}</strong> <strong>{actionModal.name}</strong> in namespace <strong>{actionModal.namespace}</strong>?
                      </p>
                    </div>
                    <p className="text-xs text-red-600 font-medium">
                      This action cannot be undone!
                    </p>
                  </div>
                )}

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={() => setActionModal(null)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                    disabled={isActioning}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      if (!actionModal) return
                      
                      if (actionModal.type === 'scale') {
                        await handleScaleDeployment(actionModal.namespace, actionModal.name, scaleReplicas)
                      } else if (actionModal.type === 'restart') {
                        await handleRestartDeployment(actionModal.namespace, actionModal.name)
                      } else if (actionModal.type === 'delete') {
                        await handleDeleteResource(actionModal.resourceType, actionModal.namespace, actionModal.name)
                      }
                    }}
                    disabled={isActioning}
                    className={`px-4 py-2 rounded-md text-sm font-medium text-white ${
                      actionModal.type === 'delete'
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {isActioning ? (
                      <>
                        <Loader2 className="w-4 h-4 inline animate-spin mr-2" />
                        Processing...
                      </>
                    ) : (
                      <>
                        {actionModal.type === 'scale' && 'Scale'}
                        {actionModal.type === 'restart' && 'Restart'}
                        {actionModal.type === 'delete' && 'Delete'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



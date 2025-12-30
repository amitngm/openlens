'use client'

import { useState, useEffect } from 'react'
import ReactFlow, { 
  Node, 
  Edge, 
  Background, 
  Controls, 
  MiniMap, 
  MarkerType
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Globe, Server, Network, Box, Search, Loader2, AlertCircle, RefreshCw, Play, Activity, Eye, Shield, LogIn, Monitor, X, Circle } from 'lucide-react'

interface UIApplicationFlowProps {
  apiUrl: string
  token?: string
  namespace?: string  // Optional namespace to filter by
}

interface FlowData {
  url: string
  ingress: {
    name: string
    namespace: string
  }
  service: {
    name: string
    namespace: string
    selector: Record<string, string>
  }
  deployments: Array<{
    name: string
    namespace: string
  }>
  keycloak?: {
    ingress: {
      name: string
      namespace: string
      host: string
    }
    service?: {
      name: string
      namespace: string
    } | null
    deployment?: {
      name: string
      namespace: string
      readyReplicas?: number
      replicas?: number
      pods?: Array<{
        name: string
        status: string
        ready: boolean
        restartCount?: number
      }>
    } | null
  } | null
  authenticationFlow?: boolean
  debug?: {
    serviceSelector?: Record<string, string>
    availableDeployments?: Array<{ name: string; namespace: string }>
    namespaceMatch?: boolean
    preferredNamespace?: string
    matchedNamespace?: string
  }
}

interface ServiceDependency {
  name: string
  namespace: string
  found: boolean
}

interface ServiceInvocation {
  serviceName: string
  podName: string
  namespace: string
  resourceType: 'compute' | 'k8s' | 'nat-gateway' | 'public-ip' | 'security' | 'infrastructure' | 'storage' | 'network' | 'unknown'
  timestamp: number
  events: number
  impactData?: any
}

interface Pod {
  name: string
  namespace: string
  status: string
  deployment?: string
  impactData?: {
    isImpacted: boolean
    impactIndicators: string[]
    recentEventCount: number
    warningEvents: number
    normalEvents: number
    computeEvents: number
    k8sEvents: number
    infrastructureEvents: number
    natGatewayEvents: number
    publicIpEvents: number
    resourceCreationEvents: number
    hasRecentActivity: boolean
    events?: Array<{
      type: string
      reason: string
      message: string
      lastTimestamp?: string
      firstTimestamp?: string
    }>
  }
}

interface RequestFlow {
  step: number
  nodeId: string
  timestamp: number
  color: string
}

export default function UIApplicationFlow({ apiUrl, token, namespace }: UIApplicationFlowProps) {
  const [url, setUrl] = useState('https://n1devcmp-user.airteldev.com/')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flowData, setFlowData] = useState<FlowData | null>(null)
  const [serviceDependencies, setServiceDependencies] = useState<ServiceDependency[]>([])
  const [selectedDeployment, setSelectedDeployment] = useState<{ name: string; namespace: string } | null>(null)
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [requestFlow, setRequestFlow] = useState<RequestFlow[]>([])
  const [hitCount, setHitCount] = useState(0)
  const [activeStep, setActiveStep] = useState<number | null>(null)
  
  // Login and authentication state
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [showApplication, setShowApplication] = useState(false)
  const [actionHistory, setActionHistory] = useState<Array<{ action: string; timestamp: number; resource?: string; deployment?: string }>>([])
  const [iframeError, setIframeError] = useState(false)
  const [iframeLoading, setIframeLoading] = useState(true)
  const [iframeLoadTimeout, setIframeLoadTimeout] = useState<NodeJS.Timeout | null>(null)
  const [cspError, setCspError] = useState(false)
  const [invokedDeployment, setInvokedDeployment] = useState<{ name: string; namespace: string } | null>(null)
  const [pods, setPods] = useState<Pod[]>([])
  const [invokedPods, setInvokedPods] = useState<string[]>([])
  const [availableIngresses, setAvailableIngresses] = useState<Array<{ name: string; namespace: string; hosts: string[] }>>([])
  const [showAvailableIngresses, setShowAvailableIngresses] = useState(false)
  const [deploymentDebugInfo, setDeploymentDebugInfo] = useState<any>(null)
  const [showDeploymentDebug, setShowDeploymentDebug] = useState(false)
  const [keycloakStatus, setKeycloakStatus] = useState<{ accessible: boolean; error?: string } | null>(null)
  const [serviceInvocationChain, setServiceInvocationChain] = useState<ServiceInvocation[]>([])
  
  // Sequential flow colors for each step
  const flowColors = [
    '#9333EA', // Step 1: Customer/URL - Purple
    '#EF4444', // Step 2: Keycloak/Auth - Red
    '#F97316', // Step 3: Ingress - Orange
    '#22C55E', // Step 4: Service - Green
    '#3B82F6', // Step 5: Deployment - Blue
    '#6366F1', // Step 6: Backend Services - Indigo
  ]

  const getAuthHeaders = () => {
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }

  const findApplication = async () => {
    if (!url.trim()) {
      setError('Please enter a URL')
      return
    }

    setIsLoading(true)
    setError(null)
    setFlowData(null)
    setServiceDependencies([])
    setSelectedDeployment(null)
    setDeploymentDebugInfo(null)
    setShowDeploymentDebug(false)
    setAvailableIngresses([])
    setShowAvailableIngresses(false)
    setKeycloakStatus(null)

    try {
      // Add namespace parameter if provided
      const urlParams = new URLSearchParams({ url })
      if (namespace && namespace !== 'all') {
        urlParams.append('namespace', namespace)
      }
      
      const response = await fetch(`${apiUrl}/k8s/find-by-url?${urlParams.toString()}`, {
        headers: getAuthHeaders()
      })

      const data = await response.json()

      if (!response.ok) {
        // If 404, check if we have available hosts in the error response
        if (response.status === 404 && data.availableHosts && Array.isArray(data.availableHosts)) {
          // Group by ingress name to combine multiple hosts
          const ingressMap = new Map<string, { name: string; namespace: string; hosts: string[] }>()
          data.availableHosts.forEach((h: any) => {
            const key = `${h.namespace}/${h.ingress}`
            if (!ingressMap.has(key)) {
              ingressMap.set(key, {
                name: h.ingress,
                namespace: h.namespace,
                hosts: []
              })
            }
            if (h.host && !ingressMap.get(key)!.hosts.includes(h.host)) {
              ingressMap.get(key)!.hosts.push(h.host)
            }
          })
          setAvailableIngresses(Array.from(ingressMap.values()))
          setShowAvailableIngresses(true)
        }
        throw new Error(data.message || data.error || 'Failed to find application')
      }

      // Debug: Log the response to see what we're getting
      console.log('API Response:', data)
      console.log('Deployments:', data.deployments)
      
      // Clear available ingresses and debug info on success
      setAvailableIngresses([])
      setShowAvailableIngresses(false)
      setDeploymentDebugInfo(null)
      setShowDeploymentDebug(false)

      setFlowData(data)
      
      // Check Keycloak accessibility if found
      if (data.keycloak && data.keycloak.ingress && data.keycloak.ingress.host) {
        // Show deployment status immediately if available
        if (data.keycloak.deployment) {
          const hasReadyPods = data.keycloak.deployment.pods?.some((p: any) => p.ready) || false
          const allPodsRunning = data.keycloak.deployment.pods?.every((p: any) => p.status === 'Running') || false
          
          if (!hasReadyPods || !allPodsRunning) {
            setKeycloakStatus({ 
              accessible: false, 
              error: `Keycloak deployment has issues: ${data.keycloak.deployment.readyReplicas || 0}/${data.keycloak.deployment.replicas || 0} ready replicas` 
            })
          }
        }
        
        // Try to check connectivity (but don't block on it)
        checkKeycloakAccessibility(data.keycloak.ingress.host).catch(err => {
          console.warn('Keycloak accessibility check failed:', err)
        })
      } else {
        setKeycloakStatus(null)
      }
      
      // If we found deployments, automatically fetch dependencies for the first one
      if (data.deployments && Array.isArray(data.deployments) && data.deployments.length > 0) {
        const firstDeployment = data.deployments[0]
        await fetchServiceDependencies(firstDeployment.namespace, firstDeployment.name)
        setSelectedDeployment(firstDeployment)
        setInvokedDeployment(firstDeployment)
        // Fetch pods, prioritize "ccs" namespace
        const targetNamespace = firstDeployment.namespace === 'ccs' ? 'ccs' : firstDeployment.namespace
        await fetchPods(targetNamespace, firstDeployment.name)
        
        console.log(`✅ Auto-selected deployment: ${firstDeployment.name} in ${firstDeployment.namespace}`)
      } else {
        // If no deployments found, show a helpful message with debugging info
        console.warn('No deployments found in response:', data)
        if (data.ingress && data.service) {
          setError('Application found but no deployments matched the service selector.')
          
          // Store debug info for display
          if (data.debug && (data.debug.serviceSelector || data.debug.availableDeployments)) {
            setDeploymentDebugInfo(data.debug)
            setShowDeploymentDebug(true)
          } else {
            setDeploymentDebugInfo(null)
            setShowDeploymentDebug(false)
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to find application')
      console.error('Error finding application:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchServiceDependencies = async (namespace: string, deploymentName: string) => {
    try {
      const response = await fetch(
        `${apiUrl}/k8s/deployments/${namespace}/${deploymentName}/service-dependencies`,
        { headers: getAuthHeaders() }
      )

      const data = await response.json()

      if (response.ok && data.serviceDependencies) {
        setServiceDependencies(data.serviceDependencies)
      }
    } catch (err) {
      console.error('Error fetching service dependencies:', err)
    }
  }

  // Fetch pods for a deployment in namespace "ccs" or specified namespace
  // Check if Keycloak service is accessible
  const checkKeycloakAccessibility = async (keycloakHost: string) => {
    try {
      const keycloakUrl = keycloakHost.startsWith('http') ? keycloakHost : `https://${keycloakHost}`
      console.log(`🔍 Checking Keycloak accessibility: ${keycloakUrl}`)
      
      // Try to fetch the Keycloak health endpoint or root
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
      
      try {
        const response = await fetch(keycloakUrl, {
          method: 'GET',
          mode: 'no-cors', // Use no-cors to avoid CORS errors, we just want to know if it's reachable
          signal: controller.signal,
          credentials: 'omit'
        })
        clearTimeout(timeoutId)
        console.log(`✅ Keycloak is accessible: ${keycloakHost}`)
        setKeycloakStatus({ accessible: true })
      } catch (error: any) {
        clearTimeout(timeoutId)
        // If it's a network error, the service is not accessible
        const errorMsg = error.message || error.toString() || ''
        if (error.name === 'AbortError' || 
            errorMsg.includes('Failed to fetch') || 
            errorMsg.includes('NetworkError') ||
            errorMsg.includes('refused to connect') ||
            errorMsg.includes('ERR_CONNECTION_REFUSED') ||
            errorMsg.includes('ERR_NAME_NOT_RESOLVED') ||
            errorMsg.includes('ERR_CONNECTION_TIMED_OUT') ||
            errorMsg.includes('timeout')) {
          console.warn(`⚠️ Keycloak is not accessible: ${keycloakHost}`, errorMsg)
          setKeycloakStatus({ 
            accessible: false, 
            error: `${keycloakHost} refused to connect or is not accessible. Authentication may not work, but you can still use the application.` 
          })
        } else {
          // Other errors might mean it's reachable but returned an error (which is still "accessible")
          console.log(`✅ Keycloak appears accessible (got response): ${keycloakHost}`)
          setKeycloakStatus({ accessible: true })
        }
      }
    } catch (error: any) {
      console.error(`❌ Error checking Keycloak accessibility: ${keycloakHost}`, error)
      setKeycloakStatus({ 
        accessible: false, 
        error: `${keycloakHost} is not accessible. This is OK - you can still use the application without Keycloak authentication.` 
      })
    }
  }

  const fetchPods = async (namespace: string, deploymentName?: string, includeAllPods: boolean = false) => {
    try {
      // Prioritize "ccs" namespace if deployment is in ccs, otherwise use the deployment's namespace
      const targetNamespace = namespace === 'ccs' ? 'ccs' : namespace
      console.log(`Fetching pods for namespace: ${targetNamespace}, deployment: ${deploymentName || 'all'}, includeAll: ${includeAllPods}`)
      
      const url = deploymentName 
        ? `${apiUrl}/k8s/pods/${targetNamespace}?deployment=${encodeURIComponent(deploymentName)}`
        : `${apiUrl}/k8s/pods/${targetNamespace}`
      
      const response = await fetch(url, { headers: getAuthHeaders() })
      const data = await response.json()

      console.log('Pods API response:', data)

      if (response.ok && data.pods) {
        // Filter pods to only include those in the target namespace (especially ccs)
        // If includeAllPods is true, include all pods in the namespace regardless of deployment match
        const filteredPods = data.pods.filter((pod: Pod) => {
          const podNamespace = pod.namespace === 'ccs' ? 'ccs' : pod.namespace
          if (includeAllPods) {
            return podNamespace === targetNamespace
          }
          if (deploymentName) {
            return podNamespace === targetNamespace && 
                   (pod.deployment === deploymentName || 
                    pod.name.includes(deploymentName) ||
                    pod.name.includes(deploymentName.toLowerCase()))
          }
          return podNamespace === targetNamespace
        })
        
        // Merge with existing pods to include newly created ones
        if (includeAllPods && pods.length > 0) {
          const existingPodNames = new Set(pods.map((p: Pod) => `${p.namespace}/${p.name}`))
          const newPods = filteredPods.filter((p: Pod) => !existingPodNames.has(`${p.namespace}/${p.name}`))
          if (newPods.length > 0) {
            console.log(`Found ${newPods.length} new pods:`, newPods.map((p: Pod) => p.name))
            setPods(prev => [...prev, ...newPods])
          } else {
            // Update existing pods with latest data
            setPods(filteredPods)
          }
        } else {
          setPods(filteredPods)
        }
        console.log(`Set ${filteredPods.length} pods for namespace ${targetNamespace}`)
        
        // If a deployment is invoked, mark its pods as invoked
        if (deploymentName && (invokedDeployment?.name === deploymentName || selectedDeployment?.name === deploymentName)) {
          const deploymentPods = filteredPods.filter((pod: Pod) => 
            pod.deployment === deploymentName || 
            pod.name.includes(deploymentName) ||
            pod.name.includes(deploymentName.toLowerCase())
          )
          setInvokedPods(deploymentPods.map((p: Pod) => p.name))
          console.log(`Marked ${deploymentPods.length} pods as invoked:`, deploymentPods.map((p: Pod) => p.name))
        }
      } else {
        console.warn('Failed to fetch pods:', data)
      }
    } catch (err) {
      console.error('Error fetching pods:', err)
    }
  }
  
  // Check pod logs and events to determine which pods are impacted
  const checkPodImpact = async (pod: Pod) => {
    try {
      const namespace = pod.namespace === 'ccs' ? 'ccs' : pod.namespace
      
      // Fetch recent logs (last 100 lines for better detection)
      const logsResponse = await fetch(
        `${apiUrl}/k8s/pods/${namespace}/${pod.name}/logs?tailLines=100`,
        { headers: getAuthHeaders() }
      )
      const logsData = await logsResponse.ok ? await logsResponse.text() : ''
      
      // Fetch recent events
      const eventsResponse = await fetch(
        `${apiUrl}/k8s/pods/${namespace}/${pod.name}/events`,
        { headers: getAuthHeaders() }
      )
      const eventsData = await eventsResponse.ok ? await eventsResponse.json() : { events: [] }
      
      // Analyze logs and events for impact indicators
      const impactIndicators = []
      const recentEvents = eventsData.events || []
      
      // Check for recent events (within last 10 minutes for VM creation)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
      const recentEventCount = recentEvents.filter((e: any) => {
        const eventTime = new Date(e.lastTimestamp || e.firstTimestamp || 0)
        return eventTime > tenMinutesAgo
      }).length
      
      // Check for specific event reasons that indicate resource creation
      const resourceCreationEvents = recentEvents.filter((e: any) => {
        const eventTime = new Date(e.lastTimestamp || e.firstTimestamp || 0)
        if (eventTime <= tenMinutesAgo) return false
        
        const reason = (e.reason || '').toLowerCase()
        const message = (e.message || '').toLowerCase()
        
        // Look for compute/VM related events
        return reason.includes('created') || 
               reason.includes('started') || 
               reason.includes('scheduled') ||
               reason.includes('pulled') ||
               reason.includes('started') ||
               message.includes('vm') ||
               message.includes('compute') ||
               message.includes('instance') ||
               message.includes('created') ||
               message.includes('provisioning')
      })
      
      if (resourceCreationEvents.length > 0) {
        impactIndicators.push(`${resourceCreationEvents.length} resource creation event(s)`)
      }
      
      if (recentEventCount > 0) {
        impactIndicators.push(`${recentEventCount} recent event(s)`)
      }
      
      // Check logs for common impact patterns - expanded for compute/K8s/infrastructure resources
      const logLower = logsData.toLowerCase()
      const impactPatterns = [
        { pattern: /error|exception|failed|failure/i, label: 'errors' },
        { pattern: /created|provisioning|starting|initializing/i, label: 'activity' },
        { pattern: /vm|virtual.?machine|compute|instance|node/i, label: 'compute activity' },
        { pattern: /resource|deployment|pod|container/i, label: 'k8s activity' },
        { pattern: /request|api call|http|rest/i, label: 'api activity' },
        { pattern: /storage|volume|pvc|pv/i, label: 'storage activity' },
        { pattern: /network|service|ingress|loadbalancer/i, label: 'network activity' },
        { pattern: /configmap|secret|credential/i, label: 'config activity' },
        { pattern: /nat|gateway|natgateway|nat-gateway/i, label: 'NAT Gateway activity' },
        { pattern: /public.?ip|publicip|elastic.?ip|eip|floating.?ip/i, label: 'Public IP activity' },
        { pattern: /security|firewall|acl|security.?group/i, label: 'security activity' },
        { pattern: /infrastructure|infra|cloud.?resource/i, label: 'infrastructure activity' }
      ]
      
      impactPatterns.forEach(({ pattern, label }) => {
        if (pattern.test(logLower)) {
          impactIndicators.push(label)
        }
      })
      
      // Check for specific event types and reasons
      const warningEvents = recentEvents.filter((e: any) => {
        const eventTime = new Date(e.lastTimestamp || e.firstTimestamp || 0)
        return e.type === 'Warning' && eventTime > tenMinutesAgo
      })
      
      const normalEvents = recentEvents.filter((e: any) => {
        const eventTime = new Date(e.lastTimestamp || e.firstTimestamp || 0)
        return e.type === 'Normal' && eventTime > tenMinutesAgo
      })
      
      // Check event reasons for compute/K8s activity
      const computeEvents = recentEvents.filter((e: any) => {
        const eventTime = new Date(e.lastTimestamp || e.firstTimestamp || 0)
        if (eventTime <= tenMinutesAgo) return false
        const reason = (e.reason || '').toLowerCase()
        const message = (e.message || '').toLowerCase()
        return reason.includes('compute') || 
               reason.includes('vm') ||
               reason.includes('node') ||
               message.includes('compute') ||
               message.includes('vm') ||
               message.includes('virtual machine')
      })
      
      const k8sEvents = recentEvents.filter((e: any) => {
        const eventTime = new Date(e.lastTimestamp || e.firstTimestamp || 0)
        if (eventTime <= tenMinutesAgo) return false
        const reason = (e.reason || '').toLowerCase()
        const message = (e.message || '').toLowerCase()
        return reason.includes('deployment') ||
               reason.includes('pod') ||
               reason.includes('service') ||
               reason.includes('replica') ||
               message.includes('deployment') ||
               message.includes('replicaset') ||
               message.includes('scaling')
      })
      
      // Check for infrastructure/security events (NAT Gateway, Public IP, etc.)
      const infrastructureEvents = recentEvents.filter((e: any) => {
        const eventTime = new Date(e.lastTimestamp || e.firstTimestamp || 0)
        if (eventTime <= tenMinutesAgo) return false
        const reason = (e.reason || '').toLowerCase()
        const message = (e.message || '').toLowerCase()
        return reason.includes('nat') ||
               reason.includes('gateway') ||
               reason.includes('public') ||
               reason.includes('ip') ||
               reason.includes('security') ||
               reason.includes('network') ||
               reason.includes('infrastructure') ||
               message.includes('nat') ||
               message.includes('gateway') ||
               message.includes('public ip') ||
               message.includes('publicip') ||
               message.includes('elastic ip') ||
               message.includes('eip') ||
               message.includes('security') ||
               message.includes('network') ||
               message.includes('infrastructure')
      })
      
      // Check for NAT Gateway specific events
      const natGatewayEvents = recentEvents.filter((e: any) => {
        const eventTime = new Date(e.lastTimestamp || e.firstTimestamp || 0)
        if (eventTime <= tenMinutesAgo) return false
        const reason = (e.reason || '').toLowerCase()
        const message = (e.message || '').toLowerCase()
        return (reason.includes('nat') && reason.includes('gateway')) ||
               (message.includes('nat') && message.includes('gateway')) ||
               message.includes('natgateway') ||
               message.includes('nat-gateway')
      })
      
      // Check for Public IP specific events
      const publicIpEvents = recentEvents.filter((e: any) => {
        const eventTime = new Date(e.lastTimestamp || e.firstTimestamp || 0)
        if (eventTime <= tenMinutesAgo) return false
        const reason = (e.reason || '').toLowerCase()
        const message = (e.message || '').toLowerCase()
        return (reason.includes('public') && reason.includes('ip')) ||
               (message.includes('public') && message.includes('ip')) ||
               message.includes('publicip') ||
               message.includes('public-ip') ||
               message.includes('elastic ip') ||
               message.includes('eip')
      })
      
      if (computeEvents.length > 0) {
        impactIndicators.push(`${computeEvents.length} compute event(s)`)
      }
      
      if (k8sEvents.length > 0) {
        impactIndicators.push(`${k8sEvents.length} k8s event(s)`)
      }
      
      if (infrastructureEvents.length > 0) {
        impactIndicators.push(`${infrastructureEvents.length} infrastructure event(s)`)
      }
      
      if (natGatewayEvents.length > 0) {
        impactIndicators.push(`🌐 ${natGatewayEvents.length} NAT Gateway event(s)`)
      }
      
      if (publicIpEvents.length > 0) {
        impactIndicators.push(`🌍 ${publicIpEvents.length} Public IP event(s)`)
      }
      
      const isImpacted = impactIndicators.length > 0 || recentEventCount > 0 || resourceCreationEvents.length > 0 || infrastructureEvents.length > 0
      
      return {
        isImpacted,
        impactIndicators,
        recentEventCount,
        warningEvents: warningEvents.length,
        normalEvents: normalEvents.length,
        computeEvents: computeEvents.length,
        k8sEvents: k8sEvents.length,
        infrastructureEvents: infrastructureEvents.length,
        natGatewayEvents: natGatewayEvents.length,
        publicIpEvents: publicIpEvents.length,
        resourceCreationEvents: resourceCreationEvents.length,
        hasRecentActivity: recentEventCount > 0 || impactIndicators.length > 0 || resourceCreationEvents.length > 0 || infrastructureEvents.length > 0,
        events: recentEvents.slice(0, 20), // Last 20 events
        logSnippet: logsData.slice(-1000) // Last 1000 chars of logs
      }
    } catch (error) {
      console.error(`Error checking impact for pod ${pod.name}:`, error)
      return {
        isImpacted: false,
        impactIndicators: [],
        recentEventCount: 0,
        warningEvents: 0,
        normalEvents: 0,
        computeEvents: 0,
        k8sEvents: 0,
        infrastructureEvents: 0,
        natGatewayEvents: 0,
        publicIpEvents: 0,
        resourceCreationEvents: 0,
        hasRecentActivity: false,
        events: [],
        logSnippet: ''
      }
    }
  }
  
  // Detect service type from pod impact data
  const detectServiceType = (impact: any): ServiceInvocation['resourceType'] => {
    if (impact.natGatewayEvents > 0) return 'nat-gateway'
    if (impact.publicIpEvents > 0) return 'public-ip'
    if (impact.infrastructureEvents > 0) return 'infrastructure'
    if (impact.computeEvents > 0) return 'compute'
    if (impact.k8sEvents > 0) return 'k8s'
    if (impact.impactIndicators.some((ind: string) => ind.includes('security'))) return 'security'
    if (impact.impactIndicators.some((ind: string) => ind.includes('storage'))) return 'storage'
    if (impact.impactIndicators.some((ind: string) => ind.includes('network'))) return 'network'
    return 'unknown'
  }
  
  // Refresh all resources (pods, deployments, service dependencies) after resource creation
  const refreshResources = async () => {
    if (!flowData) {
      return
    }
    
    // Even without deployment, try to refresh if we have service
    if (flowData.service?.namespace) {
      const serviceNamespace = flowData.service.namespace === 'ccs' ? 'ccs' : flowData.service.namespace
      await fetchPods(serviceNamespace, undefined, true)
      return
    }
    
    const deployment = selectedDeployment || invokedDeployment
    const targetNamespace = deployment 
      ? (deployment.namespace === 'ccs' ? 'ccs' : deployment.namespace)
      : (flowData.service?.namespace === 'ccs' ? 'ccs' : (flowData.service?.namespace || 'default'))
    
    if (!targetNamespace) return
    
    console.log('🔄 Refreshing resources after resource creation...')
    
    try {
      // Refresh pods - include all pods in the namespace to catch newly created ones
      await fetchPods(targetNamespace, undefined, true) // includeAllPods = true
      
      // Wait a bit for pods to load
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Re-fetch pods to get latest state
      const podsResponse = await fetch(
        `${apiUrl}/k8s/pods/${targetNamespace}`,
        { headers: getAuthHeaders() }
      )
      const podsData = await podsResponse.ok ? await podsResponse.json() : { pods: [] }
      const currentPods = (podsData.pods || []).filter((p: Pod) => p.namespace === targetNamespace)
      
      if (currentPods.length > 0) {
        setPods(currentPods)
        
        // Check which pods are impacted by analyzing logs and events
        console.log(`📊 Checking ${currentPods.length} pods for service invocations...`)
        const impactChecks = await Promise.all(
          currentPods.slice(0, 15).map(async (pod: Pod) => { // Check first 15 pods
            const impact = await checkPodImpact(pod)
            return { pod, impact }
          })
        )
        
        // Build service invocation chain based on impact data
        const invocationChain: ServiceInvocation[] = []
        
        impactChecks.forEach(({ pod, impact }) => {
          if (impact.isImpacted || impact.hasRecentActivity) {
            const serviceType = detectServiceType(impact)
            const serviceName = pod.deployment || pod.name.split('-').slice(0, -2).join('-') || pod.name
            
            invocationChain.push({
              serviceName,
              podName: pod.name,
              namespace: pod.namespace,
              resourceType: serviceType,
              timestamp: Date.now(),
              events: impact.recentEventCount,
              impactData: impact
            })
          }
        })
        
        // Sort by resource type priority: security/infrastructure first, then compute, then k8s
        const typePriority: Record<ServiceInvocation['resourceType'], number> = {
          'security': 1,
          'nat-gateway': 2,
          'public-ip': 3,
          'infrastructure': 4,
          'network': 5,
          'storage': 6,
          'compute': 7,
          'k8s': 8,
          'unknown': 9
        }
        
        invocationChain.sort((a, b) => {
          const priorityDiff = typePriority[a.resourceType] - typePriority[b.resourceType]
          if (priorityDiff !== 0) return priorityDiff
          return b.events - a.events // Then by event count
        })
        
        setServiceInvocationChain(invocationChain)
        console.log(`🔗 Service invocation chain (${invocationChain.length} services):`, invocationChain.map(s => `${s.serviceName} (${s.resourceType})`))
        
        // Mark pods as impacted if they show activity
        const impactedPodNames = impactChecks
          .filter(({ impact }) => impact.isImpacted || impact.hasRecentActivity)
          .map(({ pod }) => pod.name)
        
        if (impactedPodNames.length > 0) {
          console.log(`🎯 Found ${impactedPodNames.length} impacted pods:`, impactedPodNames)
          setInvokedPods(impactedPodNames)
          
          // Update pods with impact data
          setPods(prevPods => 
            prevPods.map(pod => {
              const impactCheck = impactChecks.find(({ pod: p }) => p.name === pod.name && p.namespace === pod.namespace)
              if (impactCheck && (impactCheck.impact.isImpacted || impactCheck.impact.hasRecentActivity)) {
                return {
                  ...pod,
                  impactData: impactCheck.impact
                }
              }
              return pod
            })
          )
        }
      }
      
      // Refresh service dependencies (if we have a deployment)
      if (deployment) {
        await fetchServiceDependencies(deployment.namespace, deployment.name)
      }
      
      // Optionally refresh deployment info from the API
      if (flowData.ingress?.namespace) {
        // Re-fetch application data to get updated deployment info
        const namespace = flowData.ingress.namespace
        const urlToSearch = url
        if (urlToSearch) {
          const findResponse = await fetch(
            `${apiUrl}/k8s/find-by-url?url=${encodeURIComponent(urlToSearch)}&namespace=${encodeURIComponent(namespace)}`,
            { headers: getAuthHeaders() }
          )
          const findData = await findResponse.json()
          
          if (findResponse.ok && findData.deployments) {
            // Update flowData with new deployments
            setFlowData(prev => prev ? ({
              ...prev,
              deployments: findData.deployments
            }) : null)
            
            // Update selected deployment if it still exists, or select first one
            if (deployment) {
              const updatedDeployment = findData.deployments.find(
                (d: any) => d.name === deployment.name && d.namespace === deployment.namespace
              ) || findData.deployments[0]
              
              if (updatedDeployment) {
                setSelectedDeployment(updatedDeployment)
                setInvokedDeployment(updatedDeployment)
              }
            }
          }
        }
      }
      
      console.log('✅ Resources refreshed successfully')
    } catch (error) {
      console.error('Error refreshing resources:', error)
    }
  }

  const handleDeploymentClick = async (deployment: { name: string; namespace: string }) => {
    setSelectedDeployment(deployment)
    await fetchServiceDependencies(deployment.namespace, deployment.name)
    // Fetch pods for this deployment, prioritize "ccs" namespace
    await fetchPods(deployment.namespace === 'ccs' ? 'ccs' : deployment.namespace, deployment.name)
  }

  // Handle login to the application
  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password')
      return
    }

    setIsLoggingIn(true)
    setError(null)

    try {
      // First, find the application to get Keycloak info if needed
      if (!flowData) {
        await findApplication()
      }

      // Validate credentials - require non-empty username and password
      // In a real scenario, this would authenticate against Keycloak or the application's auth service
      if (!username.trim() || !password.trim()) {
        setError('Username and password are required')
        setIsLoggingIn(false)
        return
      }

      // Basic validation - password should be at least 3 characters
      // In production, this would call the actual authentication API
      if (password.length < 3) {
        setError('Invalid credentials. Please check your username and password.')
        setIsLoggingIn(false)
        return
      }

      // Try to authenticate with Keycloak if available and accessible
      if (flowData?.keycloak?.ingress?.host && keycloakStatus?.accessible) {
        try {
          // In a real implementation, you would make an actual authentication request
          // For now, we'll simulate it with a timeout
          const authUrl = `https://${flowData.keycloak.ingress.host}/auth/realms/master/protocol/openid-connect/token`
          
          // Simulate authentication delay
          await new Promise(resolve => setTimeout(resolve, 1500))
          
          // For demo purposes, accept any username/password combination with length >= 3
          // In production, replace this with actual Keycloak authentication
          // const authResponse = await fetch(authUrl, {
          //   method: 'POST',
          //   headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          //   body: new URLSearchParams({
          //     grant_type: 'password',
          //     client_id: 'your-client-id',
          //     username: username,
          //     password: password
          //   })
          // })
          // 
          // if (!authResponse.ok) {
          //   throw new Error('Invalid credentials')
          // }
        } catch (authError: any) {
          setError('Authentication failed. Please check your credentials.')
          setIsLoggingIn(false)
          return
        }
      } else if (flowData?.keycloak?.ingress?.host && !keycloakStatus?.accessible) {
        // Keycloak is not accessible, but we'll still allow login (simulated)
        console.log('⚠️ Keycloak is not accessible, using simulated authentication')
        await new Promise(resolve => setTimeout(resolve, 1000)) // Simulate auth delay
      }
      
      // If we get here, authentication succeeded
      setIsAuthenticated(true)
      setShowApplication(true)
      
      // After login, fetch pods and check for logs/events
      if (flowData?.service?.namespace) {
        const serviceNamespace = flowData.service.namespace === 'ccs' ? 'ccs' : flowData.service.namespace
        console.log('🔍 After login, fetching pods in namespace:', serviceNamespace)
        
        // Fetch all pods in the service namespace
        await fetchPods(serviceNamespace, undefined, true) // includeAllPods = true
        
        // Wait a bit for pods to load, then check for impact
        setTimeout(async () => {
          // Re-fetch pods to get the latest state
          try {
            const podsResponse = await fetch(
              `${apiUrl}/k8s/pods/${serviceNamespace}`,
              { headers: getAuthHeaders() }
            )
            const podsData = await podsResponse.ok ? await podsResponse.json() : { pods: [] }
            
            if (podsData.pods && podsData.pods.length > 0) {
              const namespacePods = podsData.pods.filter((p: Pod) => p.namespace === serviceNamespace)
              setPods(namespacePods)
              
              console.log(`📊 Checking ${namespacePods.length} pods for logs/events after login...`)
              
              // Check which pods are impacted by analyzing logs and events (check first 10 to avoid too many API calls)
              const podsToCheck = namespacePods.slice(0, 10)
              const impactChecks = await Promise.all(
                podsToCheck.map(async (pod: Pod) => {
                  const impact = await checkPodImpact(pod)
                  return { pod, impact }
                })
              )
              
              // Mark pods as impacted if they show activity
              const impactedPodNames = impactChecks
                .filter(({ impact }) => impact.isImpacted || impact.hasRecentActivity)
                .map(({ pod }) => pod.name)
              
              if (impactedPodNames.length > 0) {
                console.log(`🎯 Found ${impactedPodNames.length} impacted pods after login:`, impactedPodNames)
                setInvokedPods(impactedPodNames)
                
                // Update pods with impact data
                setPods(prevPods => 
                  prevPods.map(pod => {
                    const impactCheck = impactChecks.find(({ pod: p }) => p.name === pod.name && p.namespace === pod.namespace)
                    if (impactCheck && (impactCheck.impact.isImpacted || impactCheck.impact.hasRecentActivity)) {
                      return {
                        ...pod,
                        impactData: impactCheck.impact
                      }
                    }
                    return pod
                  })
                )
              } else {
                // Even if no impact detected, mark all pods as active after login
                console.log('📝 Marking all pods as active after login')
                setInvokedPods(namespacePods.map((p: Pod) => p.name))
              }
            } else {
              console.warn(`⚠️ No pods found in namespace ${serviceNamespace} after login`)
            }
          } catch (err) {
            console.error('Error fetching pods after login:', err)
          }
        }, 1500)
      }
      
      // Track login action (only if we have deployments)
      if (flowData?.deployments && flowData.deployments.length > 0) {
        trackAction('Login', 'User authenticated successfully')
        
        // Simulate request flow after login
        setTimeout(() => {
          simulateRequest()
        }, 2000) // Wait longer to allow pods to be checked
      } else {
        // Even without deployments, simulate request to show pods
        setTimeout(() => {
          simulateRequest()
        }, 2000)
      }
      
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.')
      setIsAuthenticated(false)
      setShowApplication(false)
    } finally {
      setIsLoggingIn(false)
    }
  }

  // Track user actions on the application
  const trackAction = (action: string, resource?: string) => {
    // Determine which deployment handles this action
    // If no deployment is selected, auto-select the first one or pick one based on action
    let deploymentToInvoke = selectedDeployment || invokedDeployment
    
    // If still no deployment, try to get from flowData
    if (!deploymentToInvoke && flowData?.deployments && flowData.deployments.length > 0) {
      // Auto-select first deployment or use round-robin based on action count
      const deploymentIndex = actionHistory.length % flowData.deployments.length
      deploymentToInvoke = flowData.deployments[deploymentIndex]
      setSelectedDeployment(deploymentToInvoke)
      setInvokedDeployment(deploymentToInvoke)
    }
    
    // Set the invoked deployment (only if we have one)
    if (deploymentToInvoke) {
      setInvokedDeployment(deploymentToInvoke)
      // Fetch dependencies for this deployment if not already fetched
      if (!selectedDeployment || 
          (selectedDeployment.name !== deploymentToInvoke.name || 
           selectedDeployment.namespace !== deploymentToInvoke.namespace)) {
        fetchServiceDependencies(deploymentToInvoke.namespace, deploymentToInvoke.name)
      }
      // Fetch pods for this deployment, prioritize "ccs" namespace
      const targetNamespace = deploymentToInvoke.namespace === 'ccs' ? 'ccs' : deploymentToInvoke.namespace
      fetchPods(targetNamespace, deploymentToInvoke.name)
    } else {
      // Don't clear invoked deployment if we just don't have flowData yet
      // Only clear if we explicitly know there are no deployments
      if (flowData && (!flowData.deployments || flowData.deployments.length === 0)) {
        setInvokedDeployment(null)
        setInvokedPods([])
      }
    }
    
    const newAction = {
      action,
      timestamp: Date.now(),
      resource,
      deployment: deploymentToInvoke 
        ? `${deploymentToInvoke.namespace}/${deploymentToInvoke.name}` 
        : (flowData?.deployments && flowData.deployments.length > 0 
            ? 'Deployment not yet selected' 
            : 'No deployment found')
    }
    setActionHistory(prev => [...prev, newAction])
    
    // Trigger service flow visualization when actions are performed (only if we have a deployment)
    if (flowData && action !== 'Login' && deploymentToInvoke) {
      setTimeout(() => {
        simulateRequest()
      }, 300)
    }
  }

  // Handle logout
  const handleLogout = () => {
    setIsAuthenticated(false)
    setShowApplication(false)
    setActionHistory([])
    setRequestFlow([])
    setHitCount(0)
    setActiveStep(null)
    // Reset iframe state only if Keycloak is accessible and no CSP error
    if ((!keycloakStatus || keycloakStatus.accessible) && !cspError) {
      setIframeError(false)
      setIframeLoading(true)
      setCspError(false)
    } else {
      // Keep error state if Keycloak is not accessible or CSP error exists
      setIframeError(true)
      setIframeLoading(false)
    }
  }

  // Monitor console for CSP errors
  useEffect(() => {
    const originalError = console.error
    const originalWarn = console.warn
    
    const handleConsoleError = (...args: any[]) => {
      const message = args.join(' ')
      if (message.includes('Content Security Policy') || 
          message.includes('frame-ancestors') ||
          message.includes('CSP') ||
          (message.includes('violates') && message.includes('frame'))) {
        console.log('🔒 CSP error detected in console:', message)
        setCspError(true)
        setIframeError(true)
        setIframeLoading(false)
      }
      originalError.apply(console, args)
    }
    
    const handleConsoleWarn = (...args: any[]) => {
      const message = args.join(' ')
      if (message.includes('Content Security Policy') || 
          message.includes('frame-ancestors') ||
          message.includes('CSP') ||
          (message.includes('violates') && message.includes('frame'))) {
        console.log('🔒 CSP warning detected in console:', message)
        setCspError(true)
        setIframeError(true)
        setIframeLoading(false)
      }
      originalWarn.apply(console, args)
    }
    
    console.error = handleConsoleError
    console.warn = handleConsoleWarn
    
    return () => {
      console.error = originalError
      console.warn = originalWarn
    }
  }, [])

  // Detect iframe load timeout and Keycloak accessibility
  useEffect(() => {
    // If Keycloak is not accessible, immediately show error UI
    if (keycloakStatus && !keycloakStatus.accessible && showApplication && flowData) {
      console.log('⚠️ Keycloak not accessible - showing error UI immediately')
      setIframeError(true)
      setIframeLoading(false)
      setCspError(false) // Not a CSP error, it's a connection error
      return
    }
    
    // Auto-detect iframe load failure after 8 seconds
    if (showApplication && iframeLoading && !iframeError && !cspError && (!keycloakStatus || keycloakStatus.accessible)) {
      const timeout = setTimeout(() => {
        if (iframeLoading) {
          console.warn('⚠️ Iframe load timeout - setting error state')
          setIframeError(true)
          setIframeLoading(false)
          // Check if it might be a connection error (Keycloak not accessible)
          if (url.includes('n1devcmp-auth.airteldev.com') || url.includes('auth')) {
            // This is likely a connection refused error, not CSP
            setCspError(false)
            if (!keycloakStatus || keycloakStatus.accessible) {
              setKeycloakStatus({ accessible: false, error: 'Connection timeout' })
            }
          }
        }
      }, 8000) // 8 second timeout

      return () => clearTimeout(timeout)
    }
  }, [showApplication, iframeLoading, iframeError, keycloakStatus, flowData, url, cspError])

  // Simulate/monitor a customer request hitting the URL
  const simulateRequest = async () => {
    if (!flowData) {
      setError('Please find the application first')
      return
    }

    setHitCount(prev => prev + 1)
    setRequestFlow([])
    setActiveStep(null)

    // Ensure pods are loaded before simulating
    if (flowData?.service?.namespace && pods.length === 0) {
      const serviceNamespace = flowData.service.namespace === 'ccs' ? 'ccs' : flowData.service.namespace
      console.log('📦 Fetching pods before simulating request...')
      await fetchPods(serviceNamespace, undefined, true)
    }
    
    // Refresh resources to detect service invocations if not already done
    if (serviceInvocationChain.length === 0) {
      console.log('🔄 Refreshing resources to detect service invocations...')
      await refreshResources()
      // Wait a bit for service chain to be built
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    
    console.log(`🔗 Service invocation chain for simulation: ${serviceInvocationChain.length} services`)
    if (serviceInvocationChain.length > 0) {
      console.log('Services in chain:', serviceInvocationChain.map(s => `${s.serviceName} (${s.resourceType})`).join(' → '))
    }

    // Sequential flow: Frontend → Keycloak (if exists) → Ingress → Service → Pods (Logs) → Backend Services
    const flowSequence = [
      { nodeId: 'app', step: 1, label: isAuthenticated ? 'Frontend (Authenticated)' : 'Frontend Request' },
    ]

    // Add Keycloak step if authentication flow exists
    if (flowData.keycloak) {
      flowSequence.push({
        nodeId: 'keycloak',
        step: 2,
        label: 'Keycloak Authentication'
      })
    }

    // Continue with normal flow (only if ingress and service exist)
    if (flowData.ingress && flowData.service) {
      flowSequence.push(
        { nodeId: 'ingress', step: flowData.keycloak ? 3 : 2, label: 'Ingress Routing' },
        { nodeId: 'service', step: flowData.keycloak ? 4 : 3, label: 'Service Load Balancing' }
      )
    }

    // Add deployment step
    if (selectedDeployment || invokedDeployment) {
      const deployment = selectedDeployment || invokedDeployment
      if (deployment) {
        flowSequence.push({
          nodeId: `deployment-${deployment.namespace}-${deployment.name}`,
          step: flowData.keycloak ? 5 : 4,
          label: 'Deployment Processing'
        })
        
        // Add pod steps for pods in ccs namespace or deployment namespace
        // Include ALL pods in the namespace, not just those matching the deployment name
        // This ensures newly created pods are shown
        const targetNamespace = deployment.namespace === 'ccs' ? 'ccs' : deployment.namespace
        const namespacePods = pods.filter(pod => pod.namespace === targetNamespace)
        
        // Prioritize pods that match the deployment, but include all pods
        const deploymentPods = namespacePods.filter(pod => 
          pod.deployment === deployment.name || 
          pod.name.includes(deployment.name) ||
          pod.name.includes(deployment.name.toLowerCase())
        )
        
        // Include all pods in the namespace (newly created ones might not have deployment label yet)
        const allPodsToShow = deploymentPods.length > 0 ? deploymentPods : namespacePods
        
        if (allPodsToShow.length > 0) {
          allPodsToShow.forEach((pod, index) => {
            flowSequence.push({
              nodeId: `pod-${pod.namespace}-${pod.name}`,
              step: (flowData.keycloak ? 6 : 5) + index,
              label: `Pod: ${pod.name}${pod.deployment !== deployment.name ? ' (new)' : ''}`
            })
          })
          
          // Add service invocation chain steps (Security → NAT Gateway → Public IP → Infrastructure, etc.)
          if (serviceInvocationChain.length > 0) {
            const baseStep = flowData.keycloak 
              ? (6 + allPodsToShow.length) 
              : (5 + allPodsToShow.length)
            
            serviceInvocationChain.forEach((service, index) => {
              flowSequence.push({
                nodeId: `service-invocation-${service.namespace}-${service.podName}`,
                step: baseStep + index,
                label: `${service.resourceType.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())} Service: ${service.serviceName}`
              })
            })
          }
        } else {
          // Even if no pods, add service invocation chain if available
          if (serviceInvocationChain.length > 0) {
            const baseStep = flowData.keycloak ? 6 : 5
            serviceInvocationChain.forEach((service, index) => {
              flowSequence.push({
                nodeId: `service-invocation-${service.namespace}-${service.podName}`,
                step: baseStep + index,
                label: `${service.resourceType.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())} Service: ${service.serviceName}`
              })
            })
          }
        }
      }
    } else {
      // No deployment, but still show service invocation chain if available
      if (serviceInvocationChain.length > 0) {
        const baseStep = flowData.keycloak ? 4 : 3
        serviceInvocationChain.forEach((service, index) => {
          flowSequence.push({
            nodeId: `service-invocation-${service.namespace}-${service.podName}`,
            step: baseStep + index,
            label: `${service.resourceType.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())} Service: ${service.serviceName}`
          })
        })
      }
    }

    // Add backend service steps (after service invocation chain)
    const podsCount = (selectedDeployment || invokedDeployment) 
      ? (pods.filter(pod => {
          const deployment = selectedDeployment || invokedDeployment
          if (!deployment) return false
          const targetNamespace = deployment.namespace === 'ccs' ? 'ccs' : deployment.namespace
          return pod.namespace === targetNamespace
        }).length)
      : 0
    
    const serviceDepsBaseStep = flowData.keycloak 
      ? (6 + podsCount + serviceInvocationChain.length)
      : (5 + podsCount + serviceInvocationChain.length)
    
    serviceDependencies.forEach((dep, index) => {
      flowSequence.push({
        nodeId: `dep-service-${dep.namespace}-${dep.name}`,
        step: serviceDepsBaseStep + index,
        label: `Backend Service: ${dep.name}`
      })
    })

    // Log the full flow sequence for debugging
    console.log(`📊 Simulating request flow with ${flowSequence.length} steps:`)
    flowSequence.forEach((item, idx) => {
      console.log(`  Step ${item.step}: ${item.label} (${item.nodeId})`)
    })
    
    // Animate through the flow sequence
    for (let i = 0; i < flowSequence.length; i++) {
      const flowItem = flowSequence[i]
      setActiveStep(flowItem.step)
      
      console.log(`▶️ Step ${flowItem.step}: ${flowItem.label}`)
      
      setRequestFlow(prev => [
        ...prev,
        {
          step: flowItem.step,
          nodeId: flowItem.nodeId,
          timestamp: Date.now(),
          color: flowColors[Math.min(flowItem.step - 1, flowColors.length - 1)]
        }
      ])

      // Wait before next step (simulate network latency)
      // Longer delay for service invocations to make them more visible
      const delay = flowItem.nodeId.includes('service-invocation') ? 1200 : 800
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    // Keep the flow visible for a moment, then reset active step
    setTimeout(() => {
      setActiveStep(null)
    }, 2000)
  }

  // Auto-monitor mode (simulate requests periodically)
  useEffect(() => {
    if (!isMonitoring || !flowData) return

    const performRequest = async () => {
      setHitCount(prev => prev + 1)
      setRequestFlow([])
      setActiveStep(null)

      // Sequential flow: Customer → Keycloak (if exists) → Ingress → Service → Deployment → Backend Services
      const flowSequence = [
        { nodeId: 'app', step: 1, label: 'Customer Request' },
      ]

      // Add Keycloak step if authentication flow exists
      if (flowData.keycloak) {
        flowSequence.push({
          nodeId: 'keycloak',
          step: 2,
          label: 'Keycloak Authentication'
        })
      }

      // Continue with normal flow (only if ingress and service exist)
      if (flowData.ingress && flowData.service) {
        flowSequence.push(
          { nodeId: 'ingress', step: flowData.keycloak ? 3 : 2, label: 'Ingress Routing' },
          { nodeId: 'service', step: flowData.keycloak ? 4 : 3, label: 'Service Load Balancing' }
        )
      }

      // Add deployment step
      if (selectedDeployment || invokedDeployment) {
        const deployment = selectedDeployment || invokedDeployment
        if (deployment) {
          flowSequence.push({
            nodeId: `deployment-${deployment.namespace}-${deployment.name}`,
            step: flowData.keycloak ? 5 : 4,
            label: 'Deployment Processing'
          })
          
          // Add pod steps for pods in ccs namespace or deployment namespace
          // Include ALL pods in the namespace, not just those matching the deployment name
          // This ensures newly created pods are shown
          const targetNamespace = deployment.namespace === 'ccs' ? 'ccs' : deployment.namespace
          const namespacePods = pods.filter(pod => pod.namespace === targetNamespace)
          
          // Prioritize pods that match the deployment, but include all pods
          const deploymentPods = namespacePods.filter(pod => 
            pod.deployment === deployment.name || 
            pod.name.includes(deployment.name) ||
            pod.name.includes(deployment.name.toLowerCase())
          )
          
          // Include all pods in the namespace (newly created ones might not have deployment label yet)
          const allPodsToShow = deploymentPods.length > 0 ? deploymentPods : namespacePods
          
          if (allPodsToShow.length > 0) {
            allPodsToShow.forEach((pod, index) => {
              flowSequence.push({
                nodeId: `pod-${pod.namespace}-${pod.name}`,
                step: (flowData.keycloak ? 6 : 5) + index,
                label: `Pod: ${pod.name}${pod.deployment !== deployment.name ? ' (new)' : ''}`
              })
            })
          }
        }
      }

      // Add backend service steps
      serviceDependencies.forEach((dep, index) => {
        flowSequence.push({
          nodeId: `dep-service-${dep.namespace}-${dep.name}`,
          step: (flowData.keycloak ? 6 : 5) + index,
          label: `Backend Service: ${dep.name}`
        })
      })

      // Animate through the flow sequence
      for (let i = 0; i < flowSequence.length; i++) {
        const flowItem = flowSequence[i]
        setActiveStep(flowItem.step)
        
        setRequestFlow(prev => [
          ...prev,
          {
            step: flowItem.step,
            nodeId: flowItem.nodeId,
            timestamp: Date.now(),
            color: flowColors[Math.min(flowItem.step - 1, flowColors.length - 1)]
          }
        ])

        // Wait before next step (simulate network latency)
        await new Promise(resolve => setTimeout(resolve, 800))
      }

      // Keep the flow visible for a moment, then reset active step
      setTimeout(() => {
        setActiveStep(null)
      }, 2000)
    }

    const interval = setInterval(() => {
      performRequest()
    }, 10000) // Simulate a request every 10 seconds

    return () => clearInterval(interval)
  }, [isMonitoring, flowData, selectedDeployment, serviceDependencies])

  // Build flow diagram nodes and edges
  const { nodes, edges } = (() => {
    if (!flowData) return { nodes: [], edges: [] }
    
    // Always show full flow - don't return early even if only Keycloak is found
    // We'll show Keycloak but continue to show ingress/service/deployments if they exist
    if (!flowData.ingress || !flowData.service) {
      // If no ingress/service, show at least Customer UI and Keycloak if available
      if (flowData.keycloak) {
        const flowNodes: Node[] = []
        const flowEdges: Edge[] = []
        let x = 100
        const yStart = 200

        // Customer UI node
        flowNodes.push({
          id: 'app',
          type: 'default',
          position: { x, y: yStart },
          data: {
            label: (
              <div className="px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <Globe className="w-4 h-4 text-purple-600" />
                  <span className="font-semibold text-sm">Customer UI</span>
                </div>
                <div className="text-xs text-gray-600 break-all">
                  {flowData.url}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  🔒 Requires Login
                </div>
              </div>
            ),
          },
          style: {
            background: '#F3E8FF',
            border: '2px solid #9333EA',
            borderRadius: '8px',
            minWidth: 250,
          },
        })

        x += 350

        // Keycloak node
        flowNodes.push({
          id: 'keycloak',
          type: 'default',
          position: { x, y: yStart },
          data: {
            label: (
              <div className="px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-4 h-4 text-red-600" />
                  <span className="font-semibold text-sm">Keycloak</span>
                </div>
                <div className="text-xs text-gray-600">
                  <div>{flowData.keycloak?.ingress?.name || 'N/A'}</div>
                  <div className="text-gray-500">ns: {flowData.keycloak?.ingress?.namespace || 'N/A'}</div>
                  <div className="text-gray-500 mt-1">🔐 Authentication</div>
                </div>
              </div>
            ),
          },
          style: {
            background: '#FEE2E2',
            border: '2px solid #EF4444',
            borderRadius: '8px',
            minWidth: 200,
          },
        })

        flowEdges.push({
          id: 'app-keycloak',
          source: 'app',
          target: 'keycloak',
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#9333EA', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#9333EA' },
          label: 'Redirects to Login',
          labelStyle: { fill: '#EF4444', fontWeight: 600, fontSize: 11 },
        })

        // If we have deployments, add them to the flow even without ingress/service
        if (flowData.deployments && flowData.deployments.length > 0) {
          x += 350
          flowData.deployments.forEach((deployment, index) => {
            const deploymentNodeId = `deployment-${deployment.namespace}-${deployment.name}`
            flowNodes.push({
              id: deploymentNodeId,
              type: 'default',
              position: { x, y: yStart + (index * 200) },
              data: {
                label: (
                  <div className="px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <Box className="w-4 h-4 text-blue-600" />
                      <span className="font-semibold text-sm">{deployment.name}</span>
                    </div>
                    <div className="text-xs text-gray-600">
                      <div>Namespace: {deployment.namespace}</div>
                    </div>
                  </div>
                ),
              },
              style: {
                background: '#EFF6FF',
                border: '2px solid #3B82F6',
                borderRadius: '8px',
                minWidth: 200,
              },
            })
            
            // Connect from Keycloak to deployment (or from app if no keycloak)
            const sourceNode = flowData.keycloak ? 'keycloak' : 'app'
            flowEdges.push({
              id: `${sourceNode}-deployment-${deployment.namespace}-${deployment.name}`,
              source: sourceNode,
              target: deploymentNodeId,
              type: 'smoothstep',
              animated: true,
              style: { stroke: '#3B82F6', strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#3B82F6' },
              label: 'Deployment',
              labelStyle: { fill: '#3B82F6', fontWeight: 600, fontSize: 11 },
            })
          })
        }
        return { nodes: flowNodes, edges: flowEdges }
      }
      return { nodes: [], edges: [] }
    }

    const flowNodes: Node[] = []
    const flowEdges: Edge[] = []
    let x = 100
    const yStart = 200

    // Check if this node is in the active request flow
    const getNodeStyle = (nodeId: string, baseStyle: any) => {
      const flowItem = requestFlow.find(f => f.nodeId === nodeId)
      const isActive = activeStep !== null && flowItem && flowItem.step === activeStep
      const hasFlow = flowItem !== undefined
      
      if (isActive) {
        return {
          ...baseStyle,
          border: `4px solid ${flowItem.color}`,
          boxShadow: `0 0 20px ${flowItem.color}80`,
          transform: 'scale(1.05)',
          transition: 'all 0.3s ease',
        }
      } else if (hasFlow) {
        return {
          ...baseStyle,
          border: `3px solid ${flowItem.color}`,
          boxShadow: `0 0 10px ${flowItem.color}40`,
        }
      }
      return baseStyle
    }

    // 1. URL/Application node (Customer-facing)
    const appNodeId = 'app'
    const appStep = 1
    flowNodes.push({
      id: appNodeId,
      type: 'default',
      position: { x, y: yStart },
      data: {
        label: (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs font-bold">
                1
              </span>
              <Globe className="w-4 h-4 text-purple-600" />
              <span className="font-semibold text-sm">Frontend / Customer UI</span>
              {isAuthenticated && (
                <span className="ml-auto px-2 py-0.5 bg-green-500 text-white rounded-full text-xs font-bold">
                  ✓ Authenticated
                </span>
              )}
              {hitCount > 0 && (
                <span className="ml-auto px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-bold">
                  {hitCount} hits
                </span>
              )}
            </div>
            <div className="text-xs text-gray-600 break-all">
              {flowData.url}
            </div>
            {isAuthenticated ? (
              <div className="text-xs text-green-600 mt-1 font-semibold">
                ✓ User logged in - Frontend active
              </div>
            ) : (
              <div className="text-xs text-gray-500 mt-1">
                🔒 Requires Login
              </div>
            )}
          </div>
        ),
      },
      style: getNodeStyle(appNodeId, {
        background: '#F3E8FF',
        border: '2px solid #9333EA',
        borderRadius: '8px',
        minWidth: 250,
      }),
    })

    x += 350

    // 2. Keycloak Authentication node (if authentication flow exists)
    if (flowData.keycloak) {
      const keycloakNodeId = 'keycloak'
      const keycloakStep = 2
      flowNodes.push({
        id: keycloakNodeId,
        type: 'default',
        position: { x, y: yStart },
        data: {
          label: (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold">
                  2
                </span>
                <Shield className="w-4 h-4 text-red-600" />
                <span className="font-semibold text-sm">Keycloak</span>
                {activeStep === keycloakStep && (
                  <span className="ml-auto animate-pulse text-red-600">Active</span>
                )}
              </div>
              <div className="text-xs text-gray-600">
                <div>{flowData.keycloak?.ingress?.name || 'N/A'}</div>
                <div className="text-gray-500">ns: {flowData.keycloak?.ingress?.namespace || 'N/A'}</div>
                <div className="text-gray-500 mt-1">🔐 Authentication</div>
                {flowData.keycloak?.ingress?.host && (
                  <div className="text-gray-500 mt-1 font-mono text-xs break-all">
                    {flowData.keycloak.ingress.host}
                  </div>
                )}
                {keycloakStatus && !keycloakStatus.accessible && (
                  <div className="text-red-600 mt-1 font-semibold text-xs">
                    ⚠️ Not Accessible
                  </div>
                )}
                {keycloakStatus && keycloakStatus.accessible && (
                  <div className="text-green-600 mt-1 font-semibold text-xs">
                    ✅ Accessible
                  </div>
                )}
              </div>
            </div>
          ),
        },
        style: getNodeStyle(keycloakNodeId, {
          background: '#FEE2E2',
          border: '2px solid #EF4444',
          borderRadius: '8px',
          minWidth: 200,
        }),
      })

      const appKeycloakEdge = requestFlow.find(f => f.nodeId === 'app' || f.nodeId === 'keycloak')
      flowEdges.push({
        id: 'app-keycloak',
        source: 'app',
        target: 'keycloak',
        type: 'smoothstep',
        animated: true,
        style: { 
          stroke: appKeycloakEdge ? appKeycloakEdge.color : '#9333EA', 
          strokeWidth: activeStep === 2 ? 4 : 2 
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: appKeycloakEdge ? appKeycloakEdge.color : '#9333EA' },
        label: activeStep === 2 ? 'Redirecting to Login...' : 'Login Required',
        labelStyle: { fill: '#EF4444', fontWeight: 600, fontSize: 11 },
      })

      x += 350

      // Edge from Keycloak back to Ingress (after authentication) - only if ingress exists
      if (flowData.ingress) {
        const keycloakIngressEdge = requestFlow.find(f => f.nodeId === 'keycloak' || f.nodeId === 'ingress')
        flowEdges.push({
          id: 'keycloak-ingress',
          source: 'keycloak',
          target: 'ingress',
        type: 'smoothstep',
        animated: true,
        style: { 
          stroke: keycloakIngressEdge ? keycloakIngressEdge.color : '#EF4444', 
          strokeWidth: activeStep === 3 ? 4 : 2,
          strokeDasharray: '5,5'
        },
          markerEnd: { type: MarkerType.ArrowClosed, color: keycloakIngressEdge ? keycloakIngressEdge.color : '#EF4444' },
          label: activeStep === 3 ? 'Authenticated → Portal' : 'After Login',
          labelStyle: { fill: '#F97316', fontWeight: 600, fontSize: 11 },
        })
      }
    }

    // 3. Ingress node
    if (!flowData.ingress) {
      return { nodes: flowNodes, edges: flowEdges }
    }
    
    const ingressNodeId = 'ingress'
    const ingressStep = flowData.keycloak ? 3 : 2
    flowNodes.push({
      id: ingressNodeId,
      type: 'default',
      position: { x, y: yStart },
      data: {
        label: (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-orange-600 text-white text-xs font-bold">
                {ingressStep}
              </span>
              <Network className="w-4 h-4 text-orange-600" />
              <span className="font-semibold text-sm">Ingress</span>
              {activeStep === ingressStep && (
                <span className="ml-auto animate-pulse text-orange-600">Active</span>
              )}
            </div>
            <div className="text-xs text-gray-600">
              <div>{flowData.ingress?.name || 'N/A'}</div>
              <div className="text-gray-500">ns: {flowData.ingress?.namespace || 'N/A'}</div>
            </div>
          </div>
        ),
      },
      style: getNodeStyle(ingressNodeId, {
        background: '#FFF7ED',
        border: '2px solid #F97316',
        borderRadius: '8px',
        minWidth: 200,
      }),
    })

    // Only add direct app-ingress edge if no Keycloak
    if (!flowData.keycloak) {
      const appIngressEdge = requestFlow.find(f => f.nodeId === 'app' || f.nodeId === 'ingress')
      flowEdges.push({
        id: 'app-ingress',
        source: 'app',
        target: 'ingress',
        type: 'smoothstep',
        animated: true,
        style: { 
          stroke: appIngressEdge ? appIngressEdge.color : '#9333EA', 
          strokeWidth: activeStep === ingressStep ? 4 : 2 
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: appIngressEdge ? appIngressEdge.color : '#9333EA' },
        label: activeStep === ingressStep ? 'Routing...' : undefined,
        labelStyle: { fill: '#F97316', fontWeight: 600, fontSize: 11 },
      })
    }

    x += 350

    // 4. Service node
    if (!flowData.service) {
      return { nodes: flowNodes, edges: flowEdges }
    }
    
    const serviceNodeId = 'service'
    const serviceStep = flowData.keycloak ? 4 : 3
    flowNodes.push({
      id: serviceNodeId,
      type: 'default',
      position: { x, y: yStart },
      data: {
        label: (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-green-600 text-white text-xs font-bold">
                {serviceStep}
              </span>
              <Network className="w-4 h-4 text-green-600" />
              <span className="font-semibold text-sm">Service</span>
              {activeStep === serviceStep && (
                <span className="ml-auto animate-pulse text-green-600">Active</span>
              )}
            </div>
            <div className="text-xs text-gray-600">
              <div>{flowData.service?.name || 'N/A'}</div>
              <div className="text-gray-500">ns: {flowData.service?.namespace || 'N/A'}</div>
            </div>
          </div>
        ),
      },
      style: getNodeStyle(serviceNodeId, {
        background: '#F0FDF4',
        border: '2px solid #22C55E',
        borderRadius: '8px',
        minWidth: 200,
      }),
    })

    const ingressServiceEdge = requestFlow.find(f => f.nodeId === 'ingress' || f.nodeId === 'service')
    flowEdges.push({
      id: 'ingress-service',
      source: 'ingress',
      target: 'service',
      type: 'smoothstep',
      animated: true,
      style: { 
        stroke: ingressServiceEdge ? ingressServiceEdge.color : '#F97316', 
        strokeWidth: activeStep === serviceStep ? 4 : 2 
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: ingressServiceEdge ? ingressServiceEdge.color : '#F97316' },
      label: activeStep === serviceStep ? 'Load Balancing...' : undefined,
      labelStyle: { fill: '#22C55E', fontWeight: 600, fontSize: 11 },
    })

    x += 350

    // 5. Pod nodes (show pods directly instead of deployments - logs appear in pods)
    // Skip deployment nodes and go straight to pods
    const podStep = flowData.keycloak ? 5 : 4
    
    // Get pods that match the service selector, or all pods in the namespace
    const serviceNamespace = flowData.service?.namespace === 'ccs' ? 'ccs' : (flowData.service?.namespace || 'default')
    
    const servicePods = pods.filter(pod => {
      // If we have a service selector, try to match pods by labels
      if (flowData.service?.selector) {
        // For now, show all pods in the namespace - in production you'd match labels
        return pod.namespace === serviceNamespace
      }
      return pod.namespace === serviceNamespace
    })
    
    console.log(`📊 Flow diagram: Found ${servicePods.length} pods in namespace ${serviceNamespace} (total pods in state: ${pods.length})`)
    
    // If no pods but we're authenticated, show a message that we're checking
    if (servicePods.length === 0 && isAuthenticated && flowData.service) {
      console.log(`⚠️ No pods found in flow diagram. Namespace: ${serviceNamespace}, Service: ${flowData.service.name}`)
    }
    
    // If we have deployments, also include pods from those deployments
    let deploymentPods: Pod[] = []
    if (flowData.deployments && flowData.deployments.length > 0) {
      flowData.deployments.forEach(deployment => {
        const depPods = pods.filter(pod => 
          pod.namespace === deployment.namespace &&
          (pod.deployment === deployment.name || pod.name.includes(deployment.name))
        )
        deploymentPods = [...deploymentPods, ...depPods]
      })
    }
    
    // Combine service pods and deployment pods, removing duplicates
    const allPodsToShow = Array.from(new Map<string, Pod>([
      ...servicePods.map((p: Pod) => [p.name, p] as [string, Pod]),
      ...deploymentPods.map((p: Pod) => [p.name, p] as [string, Pod])
    ]).values())
    
    if (allPodsToShow.length > 0) {
      // Show pods directly from service
      allPodsToShow.forEach((pod, index) => {
        const podNodeId = `pod-${pod.namespace}-${pod.name}`
        const isInvokedPod = invokedPods.includes(pod.name)
        const podSequenceNumber = podStep + index
        const isActiveInFlow = activeStep === podSequenceNumber && isInvokedPod
        const isImpactedPod = pod.impactData && (pod.impactData.isImpacted || pod.impactData.hasRecentActivity)
        
        flowNodes.push({
          id: podNodeId,
          type: 'default',
          position: { x, y: yStart + (index * 180) },
          data: {
            label: (
              <div className="px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs font-bold">
                    {podSequenceNumber}
                  </span>
                  <Circle className="w-4 h-4 text-purple-600" />
                  <span className="font-semibold text-sm">{pod.name}</span>
                  {isImpactedPod && (
                    <span className="ml-auto px-2 py-0.5 bg-orange-500 text-white rounded-full text-xs font-bold animate-pulse">
                      🎯 IMPACTED
                    </span>
                  )}
                  {isInvokedPod && !isImpactedPod && (
                    <span className="ml-auto px-2 py-0.5 bg-purple-500 text-white rounded-full text-xs font-bold animate-pulse">
                      ACTIVE
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-600">
                  <div>Namespace: {pod.namespace}</div>
                  {pod.deployment && (
                    <div className="text-gray-500">Deployment: {pod.deployment}</div>
                  )}
                  <div className={`mt-1 font-medium ${
                    pod.status === 'Running' ? 'text-green-600' : 
                    pod.status === 'Pending' ? 'text-yellow-600' : 
                    'text-red-600'
                  }`}>
                    Status: {pod.status}
                  </div>
                  {isImpactedPod && pod.impactData && (
                    <div className="mt-1 text-xs text-orange-600 font-semibold">
                      {pod.impactData.computeEvents > 0 && <span className="mr-2">💻 {pod.impactData.computeEvents}</span>}
                      {pod.impactData.k8sEvents > 0 && <span className="mr-2">☸️ {pod.impactData.k8sEvents}</span>}
                      {pod.impactData.natGatewayEvents > 0 && <span className="mr-2">🌐 {pod.impactData.natGatewayEvents} NAT</span>}
                      {pod.impactData.publicIpEvents > 0 && <span className="mr-2">🌍 {pod.impactData.publicIpEvents} PublicIP</span>}
                      {pod.impactData.infrastructureEvents > 0 && <span className="mr-2">🏗️ {pod.impactData.infrastructureEvents}</span>}
                      {pod.impactData.resourceCreationEvents > 0 && <span className="mr-2">✨ {pod.impactData.resourceCreationEvents}</span>}
                      {pod.impactData.recentEventCount > 0 && <span className="mr-2">📊 {pod.impactData.recentEventCount}</span>}
                    </div>
                  )}
                  {isImpactedPod && pod.impactData && pod.impactData.impactIndicators.length > 0 && (
                    <div className="mt-1 text-xs text-gray-500 italic">
                      {pod.impactData.impactIndicators.slice(0, 3).join(', ')}
                    </div>
                  )}
                  {isImpactedPod && pod.impactData && (pod.impactData.natGatewayEvents > 0 || pod.impactData.publicIpEvents > 0) && (
                    <div className="mt-1 text-xs text-cyan-700 font-bold bg-cyan-50 p-1 rounded border border-cyan-200">
                      🔒 Security/Infrastructure Service: This pod handles NAT Gateway and Public IP operations
                    </div>
                  )}
                </div>
              </div>
            ),
          },
          style: getNodeStyle(podNodeId, {
            background: isImpactedPod 
              ? '#FFF7ED' 
              : (isInvokedPod ? '#F3E8FF' : '#FAF5FF'),
            border: isImpactedPod
              ? '3px solid #F97316'
              : (isInvokedPod ? '3px solid #9333EA' : '2px solid #A855F7'),
            borderRadius: '8px',
            minWidth: 200,
            boxShadow: isImpactedPod
              ? '0 0 15px rgba(249, 115, 22, 0.5)'
              : (isInvokedPod ? '0 0 15px rgba(147, 51, 234, 0.5)' : undefined),
          }),
        })
        
        // Connect from service directly to pod
        flowEdges.push({
          id: `service-pod-${pod.namespace}-${pod.name}`,
          source: 'service',
          target: podNodeId,
          type: 'smoothstep',
          animated: isImpactedPod || isInvokedPod || isActiveInFlow,
          style: { 
            stroke: isImpactedPod 
              ? '#F97316' 
              : (isInvokedPod ? '#9333EA' : '#A855F7'), 
            strokeWidth: isImpactedPod || isInvokedPod ? 3 : 2,
          },
          markerEnd: { 
            type: MarkerType.ArrowClosed, 
            color: isImpactedPod 
              ? '#F97316' 
              : (isInvokedPod ? '#9333EA' : '#A855F7') 
          },
          label: isImpactedPod 
            ? `🎯 Step ${podSequenceNumber}: Logs/Events` 
            : (isInvokedPod ? `Step ${podSequenceNumber}: Active` : `Step ${podSequenceNumber}: Pods (Logs)`),
          labelStyle: { 
            fill: isImpactedPod 
              ? '#F97316' 
              : (isInvokedPod ? '#9333EA' : '#A855F7'), 
            fontWeight: isImpactedPod || isInvokedPod ? 700 : 600, 
            fontSize: isImpactedPod || isInvokedPod ? 12 : 11 
          },
        })
      })
      
      x += 350 // Move x for next section
    } else {
      // If no pods found, show a message but don't block the flow
      const noPodsNodeId = 'no-pods'
      flowNodes.push({
        id: noPodsNodeId,
        type: 'default',
        position: { x: x + 350, y: yStart },
        data: {
          label: (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-4 h-4 text-yellow-600" />
                <span className="font-semibold text-sm text-yellow-600">No Pods Found</span>
              </div>
              <div className="text-xs text-gray-600">
                <div>No pods found in namespace: {serviceNamespace}</div>
                <div className="text-gray-500 mt-1">
                  Pods are where logs and events appear
                </div>
                {flowData.service?.selector && (
                  <div className="text-gray-500 mt-1">
                    Service selector: {JSON.stringify(flowData.service.selector)}
                  </div>
                )}
              </div>
            </div>
          ),
        },
        style: {
          background: '#FEF3C7',
          border: '2px dashed #F59E0B',
          borderRadius: '8px',
          minWidth: 250,
        },
      })
      
      flowEdges.push({
        id: 'service-no-pods',
        source: 'service',
        target: noPodsNodeId,
        type: 'smoothstep',
        animated: false,
        style: { 
          stroke: '#F59E0B', 
          strokeWidth: 2,
          strokeDasharray: '5,5'
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#F59E0B' },
        label: 'No Pods',
        labelStyle: { fill: '#F59E0B', fontWeight: 600, fontSize: 11 },
      })
    }
    
    // Skip deployment nodes - we're showing pods directly
    // Continue to backend services if needed
    
    if (flowData.deployments && flowData.deployments.length > 0) {
      const deploymentStep = flowData.keycloak ? 5 : 4
      flowData.deployments.forEach((deployment, index) => {
      const isSelected = selectedDeployment?.name === deployment.name && 
                        selectedDeployment?.namespace === deployment.namespace
      const isInvoked = invokedDeployment?.name === deployment.name && 
                        invokedDeployment?.namespace === deployment.namespace
      const deploymentNodeId = `deployment-${deployment.namespace}-${deployment.name}`
      const deploymentSequenceNumber = deploymentStep + index
      const isActiveInFlow = activeStep === deploymentSequenceNumber && (isSelected || isInvoked)
      
      flowNodes.push({
        id: deploymentNodeId,
        type: 'default',
        position: { x, y: yStart + (index * 200) },
        data: {
          label: (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold">
                  {deploymentSequenceNumber}
                </span>
                <Box className="w-4 h-4 text-blue-600" />
                <span className="font-semibold text-sm">{deployment.name}</span>
                {isInvoked && (
                  <span className="ml-auto px-2 py-0.5 bg-orange-500 text-white rounded-full text-xs font-bold animate-pulse">
                    INVOKED
                  </span>
                )}
                {isActiveInFlow && !isInvoked && (
                  <span className="ml-auto animate-pulse text-blue-600 text-xs">Step {deploymentStep}</span>
                )}
              </div>
              <div className="text-xs text-gray-600">
                <div>Namespace: {deployment.namespace}</div>
                {isSelected && !isInvoked && (
                  <div className="text-green-600 mt-1 font-semibold">✓ Selected</div>
                )}
                {isInvoked && (
                  <div className="text-orange-600 mt-1 font-bold flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    Handling Request
                  </div>
                )}
              </div>
            </div>
          ),
        },
        style: getNodeStyle(deploymentNodeId, {
          background: isInvoked ? '#FED7AA' : (isSelected ? '#DBEAFE' : '#EFF6FF'),
          border: isInvoked ? '3px solid #F97316' : (isSelected ? '3px solid #2563EB' : '2px solid #3B82F6'),
          borderRadius: '8px',
          minWidth: 200,
          cursor: 'pointer',
          boxShadow: isInvoked ? '0 0 15px rgba(249, 115, 22, 0.5)' : undefined,
        }),
      })

      const serviceDeploymentEdge = requestFlow.find(f => 
        (f.nodeId === 'service' || f.nodeId === deploymentNodeId) && (isSelected || isInvoked)
      )
      flowEdges.push({
        id: `service-deployment-${deployment.namespace}-${deployment.name}`,
        source: 'service',
        target: deploymentNodeId,
        type: 'smoothstep',
        animated: isInvoked || isActiveInFlow,
        style: { 
          stroke: isInvoked ? '#F97316' : (serviceDeploymentEdge ? serviceDeploymentEdge.color : '#22C55E'), 
          strokeWidth: isInvoked ? 4 : (isActiveInFlow ? 4 : 2),
          strokeDasharray: isInvoked ? '0' : undefined
        },
        markerEnd: { 
          type: MarkerType.ArrowClosed, 
          color: isInvoked ? '#F97316' : (serviceDeploymentEdge ? serviceDeploymentEdge.color : '#22C55E') 
        },
        label: isInvoked ? 'INVOKED' : (isActiveInFlow ? 'Processing...' : undefined),
        labelStyle: { 
          fill: isInvoked ? '#F97316' : '#3B82F6', 
          fontWeight: isInvoked ? 700 : 600, 
          fontSize: isInvoked ? 12 : 11 
        },
      })
      })
    }

    // Skip this section - pods are already shown directly from service above
    // This was the old deployment-based pod rendering, now removed
    // Disabled section - pods are shown directly from service
    if (false && (invokedDeployment || selectedDeployment) && pods.length > 0) {
      const targetNamespace = invokedDeployment?.namespace === 'ccs' ? 'ccs' : (invokedDeployment?.namespace || selectedDeployment?.namespace || 'default')
      x += 350
      const podStep = flowData?.keycloak ? 6 : 5
      const deployment = invokedDeployment || selectedDeployment
      if (!deployment) return { nodes: flowNodes, edges: flowEdges }
      
      // Get all pods in the target namespace (not just those matching deployment)
      // This ensures newly created pods are shown even if they don't have the deployment label yet
      const namespacePods = pods.filter(pod => pod.namespace === targetNamespace)
      
      // Prioritize pods that match the deployment, but include all pods
      const deploymentPods = namespacePods.filter(pod => 
        deployment && (pod.deployment === deployment.name || 
        pod.name.includes(deployment.name) ||
        pod.name.includes(deployment.name?.toLowerCase() || ''))
      )
      
      // Use all namespace pods to show newly created resources
      // Newly created pods might not have deployment labels yet
      const podsToShow = namespacePods.length > 0 ? namespacePods : deploymentPods
      
      console.log(`Found ${podsToShow.length} pods in namespace ${targetNamespace} (${deploymentPods.length} match deployment ${deployment?.name || 'N/A'})`)
      
      if (podsToShow.length > 0) {
        podsToShow.forEach((pod, index) => {
          // Mark as "new" if it doesn't match the deployment (likely newly created)
          const isNewPod = deployment ? !deploymentPods.some(dp => dp.name === pod.name) : false
          const podNodeId = `pod-${pod.namespace}-${pod.name}`
          const isInvokedPod = invokedPods.includes(pod.name)
          const isActiveInFlow = activeStep === podStep && isInvokedPod
          
          flowNodes.push({
            id: podNodeId,
            type: 'default',
            position: { x, y: yStart + (index * 150) },
            data: {
              label: (
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <Circle className="w-4 h-4 text-purple-600" />
                    <span className="font-semibold text-sm">{pod.name}</span>
                    {pod.impactData && (pod.impactData.isImpacted || pod.impactData.hasRecentActivity) && (
                      <span className="ml-auto px-2 py-0.5 bg-orange-500 text-white rounded-full text-xs font-bold animate-pulse">
                        🎯 IMPACTED
                      </span>
                    )}
                    {isNewPod && !pod.impactData && (
                      <span className="ml-auto px-2 py-0.5 bg-green-500 text-white rounded-full text-xs font-bold">
                        NEW
                      </span>
                    )}
                    {isInvokedPod && !pod.impactData && (
                      <span className="ml-auto px-2 py-0.5 bg-purple-500 text-white rounded-full text-xs font-bold animate-pulse">
                        IMPACTED
                      </span>
                    )}
                    {isActiveInFlow && !isInvokedPod && !pod.impactData && (
                      <span className="ml-auto animate-pulse text-purple-600 text-xs">Step {podStep}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-600">
                    <div>Namespace: {pod.namespace}</div>
                    {pod.deployment && (
                      <div className="text-gray-500">Deployment: {pod.deployment}</div>
                    )}
                    {isNewPod && (
                      <div className="text-green-600 font-semibold mt-1">✨ Newly Created Resource</div>
                    )}
                    <div className={`mt-1 font-medium ${
                      pod.status === 'Running' ? 'text-green-600' : 
                      pod.status === 'Pending' ? 'text-yellow-600' : 
                      'text-red-600'
                    }`}>
                      Status: {pod.status}
                    </div>
                    {pod.impactData && (pod.impactData.isImpacted || pod.impactData.hasRecentActivity) && (
                      <div className="mt-1 p-1.5 bg-orange-50 border border-orange-200 rounded">
                        <div className="text-orange-700 font-bold flex items-center gap-1 mb-1">
                          <Activity className="w-3 h-3" />
                          🎯 IMPACTED POD
                        </div>
                        {pod.impactData.resourceCreationEvents > 0 && (
                          <div className="text-orange-600 text-xs font-semibold mb-1">
                            ✨ {pod.impactData.resourceCreationEvents} resource creation event(s) detected
                          </div>
                        )}
                        {pod.impactData.computeEvents > 0 && (
                          <div className="text-blue-600 text-xs font-semibold mb-1">
                            💻 {pod.impactData.computeEvents} compute event(s) (VM/compute activity)
                          </div>
                        )}
                        {pod.impactData.k8sEvents > 0 && (
                          <div className="text-purple-600 text-xs font-semibold mb-1">
                            ☸️ {pod.impactData.k8sEvents} K8s event(s) (deployment/pod activity)
                          </div>
                        )}
                        {pod.impactData.natGatewayEvents > 0 && (
                          <div className="text-cyan-600 text-xs font-semibold mb-1">
                            🌐 {pod.impactData.natGatewayEvents} NAT Gateway event(s) - This pod handles NAT Gateway operations
                          </div>
                        )}
                        {pod.impactData.publicIpEvents > 0 && (
                          <div className="text-teal-600 text-xs font-semibold mb-1">
                            🌍 {pod.impactData.publicIpEvents} Public IP event(s) - This pod handles Public IP creation
                          </div>
                        )}
                        {pod.impactData.infrastructureEvents > 0 && (
                          <div className="text-indigo-600 text-xs font-semibold mb-1">
                            🏗️ {pod.impactData.infrastructureEvents} infrastructure event(s) (NAT Gateway, Public IP, Security)
                          </div>
                        )}
                        {pod.impactData.impactIndicators.length > 0 && (
                          <div className="text-orange-600 text-xs mt-1">
                            <strong>Activity:</strong> {pod.impactData.impactIndicators.join(', ')}
                          </div>
                        )}
                        {pod.impactData.recentEventCount > 0 && (
                          <div className="text-orange-600 text-xs mt-1">
                            {pod.impactData.recentEventCount} total recent event(s)
                            {pod.impactData.warningEvents > 0 && (
                              <span className="ml-1 text-red-600">({pod.impactData.warningEvents} warning)</span>
                            )}
                            {pod.impactData.normalEvents > 0 && (
                              <span className="ml-1 text-green-600">({pod.impactData.normalEvents} normal)</span>
                            )}
                          </div>
                        )}
                        {pod.impactData.events && pod.impactData.events.length > 0 && (
                          <details className="mt-2 text-xs">
                            <summary className="text-orange-700 cursor-pointer font-semibold">
                              View {pod.impactData.events.length} event(s)
                            </summary>
                            <div className="mt-1 max-h-32 overflow-y-auto space-y-1">
                              {pod.impactData.events.slice(0, 5).map((event: any, idx: number) => (
                                <div key={idx} className="p-1 bg-white rounded border border-orange-200">
                                  <div className="font-semibold text-orange-700">
                                    {event.type === 'Warning' ? '⚠️' : 'ℹ️'} {event.reason}
                                  </div>
                                  <div className="text-gray-600 text-xs mt-0.5">{event.message}</div>
                                  <div className="text-gray-400 text-xs mt-0.5">
                                    {new Date(event.lastTimestamp || event.firstTimestamp).toLocaleString()}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                    {isInvokedPod && !pod.impactData && (
                      <div className="text-purple-600 mt-1 font-bold flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        Handling Request
                      </div>
                    )}
                  </div>
                </div>
              ),
            },
            style: getNodeStyle(podNodeId, {
              background: pod.impactData && (pod.impactData.isImpacted || pod.impactData.hasRecentActivity) 
                ? '#FFF7ED' 
                : (isInvokedPod ? '#F3E8FF' : (isNewPod ? '#F0FDF4' : '#FAF5FF')),
              border: pod.impactData && (pod.impactData.isImpacted || pod.impactData.hasRecentActivity)
                ? '3px solid #F97316'
                : (isInvokedPod ? '3px solid #9333EA' : (isNewPod ? '3px solid #22C55E' : '2px solid #A855F7')),
              borderRadius: '8px',
              minWidth: 200,
              cursor: 'pointer',
              boxShadow: pod.impactData && (pod.impactData.isImpacted || pod.impactData.hasRecentActivity)
                ? '0 0 15px rgba(249, 115, 22, 0.5)'
                : (isNewPod ? '0 0 10px rgba(34, 197, 94, 0.3)' : (isInvokedPod ? '0 0 15px rgba(147, 51, 234, 0.5)' : undefined)),
            }),
          })
          
          // Add edge from deployment to pod
          const deploymentNodeId = deployment ? `deployment-${deployment.namespace}-${deployment.name}` : 'deployment-unknown'
          const deploymentPodEdge = requestFlow.find(f => 
            (f.nodeId === deploymentNodeId || f.nodeId === podNodeId) && (isInvokedPod || isActiveInFlow)
          )
          const isImpactedPod = pod.impactData && (pod.impactData.isImpacted || pod.impactData.hasRecentActivity)
          flowEdges.push({
            id: `deployment-pod-${pod.namespace}-${pod.name}`,
            source: deploymentNodeId,
            target: podNodeId,
            type: 'smoothstep',
            animated: isImpactedPod || isInvokedPod || isActiveInFlow,
            style: { 
              stroke: isImpactedPod 
                ? '#F97316' 
                : (isInvokedPod ? '#9333EA' : (isNewPod ? '#22C55E' : (deploymentPodEdge ? deploymentPodEdge.color : '#A855F7'))), 
              strokeWidth: isImpactedPod || isInvokedPod || isNewPod ? 3 : (isActiveInFlow ? 3 : 2),
              strokeDasharray: isNewPod ? '5,5' : undefined
            },
            markerEnd: { 
              type: MarkerType.ArrowClosed, 
              color: isImpactedPod 
                ? '#F97316' 
                : (isInvokedPod ? '#9333EA' : (isNewPod ? '#22C55E' : (deploymentPodEdge ? deploymentPodEdge.color : '#A855F7'))) 
            },
            label: isImpactedPod 
              ? '🎯 IMPACTED' 
              : (isNewPod ? 'NEW' : (isInvokedPod ? 'IMPACTED' : (isActiveInFlow ? 'Processing...' : undefined))),
            labelStyle: { 
              fill: isImpactedPod 
                ? '#F97316' 
                : (isNewPod ? '#22C55E' : (isInvokedPod ? '#9333EA' : '#A855F7')), 
              fontWeight: isImpactedPod || isNewPod || isInvokedPod ? 700 : 600, 
              fontSize: isImpactedPod || isNewPod || isInvokedPod ? 12 : 11 
            },
          })
        })
      }
    }

    // 7. Service Invocation Chain (infrastructure services like NAT Gateway, Public IP, etc.)
    if (serviceInvocationChain.length > 0) {
      x += 350
      const baseStep = flowData.keycloak ? 7 : 6
      
      serviceInvocationChain.forEach((service, index) => {
        const serviceNodeId = `service-invocation-${service.namespace}-${service.podName}`
        const stepNumber = baseStep + index
        const isActiveInFlow = activeStep === stepNumber
        
        // Get color based on resource type
        const getServiceColor = (type: ServiceInvocation['resourceType']) => {
          switch (type) {
            case 'nat-gateway': return { bg: '#ECFEFF', border: '#06B6D4', text: '#0891B2' } // Cyan
            case 'public-ip': return { bg: '#F0FDFA', border: '#14B8A6', text: '#0D9488' } // Teal
            case 'security': return { bg: '#FEF3C7', border: '#F59E0B', text: '#D97706' } // Amber
            case 'infrastructure': return { bg: '#EEF2FF', border: '#6366F1', text: '#4F46E5' } // Indigo
            case 'network': return { bg: '#F3E8FF', border: '#A855F7', text: '#9333EA' } // Purple
            case 'storage': return { bg: '#FEF2F2', border: '#EF4444', text: '#DC2626' } // Red
            case 'compute': return { bg: '#EFF6FF', border: '#3B82F6', text: '#2563EB' } // Blue
            case 'k8s': return { bg: '#F0FDF4', border: '#22C55E', text: '#16A34A' } // Green
            default: return { bg: '#F9FAFB', border: '#6B7280', text: '#4B5563' } // Gray
          }
        }
        
        const colors = getServiceColor(service.resourceType)
        const iconMap: Record<ServiceInvocation['resourceType'], string> = {
          'nat-gateway': '🌐',
          'public-ip': '🌍',
          'security': '🔒',
          'infrastructure': '🏗️',
          'network': '🌐',
          'storage': '💾',
          'compute': '💻',
          'k8s': '☸️',
          'unknown': '📦'
        }
        
        flowNodes.push({
          id: serviceNodeId,
          type: 'default',
          position: { x, y: yStart + (index * 180) },
          data: {
            label: (
              <div className="px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold" style={{ backgroundColor: colors.border }}>
                    {stepNumber}
                  </span>
                  <span className="text-lg">{iconMap[service.resourceType]}</span>
                  <span className="font-semibold text-sm">{service.serviceName}</span>
                  {isActiveInFlow && (
                    <span className="ml-auto animate-pulse text-xs" style={{ color: colors.text }}>
                      Active
                    </span>
                  )}
                </div>
                <div className="text-xs" style={{ color: colors.text }}>
                  <div className="font-medium capitalize">{service.resourceType.replace('-', ' ')} Service</div>
                  <div className="text-gray-600">Pod: {service.podName}</div>
                  <div className="text-gray-500">Namespace: {service.namespace}</div>
                  {service.impactData && (
                    <div className="mt-1 space-y-0.5">
                      {service.impactData.natGatewayEvents > 0 && (
                        <div className="text-cyan-600 font-semibold">🌐 {service.impactData.natGatewayEvents} NAT Gateway</div>
                      )}
                      {service.impactData.publicIpEvents > 0 && (
                        <div className="text-teal-600 font-semibold">🌍 {service.impactData.publicIpEvents} Public IP</div>
                      )}
                      {service.impactData.infrastructureEvents > 0 && (
                        <div className="text-indigo-600 font-semibold">🏗️ {service.impactData.infrastructureEvents} Infrastructure</div>
                      )}
                      {service.events > 0 && (
                        <div className="text-gray-600">📊 {service.events} events</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ),
          },
          style: {
            background: colors.bg,
            border: `3px solid ${colors.border}`,
            borderRadius: '8px',
            minWidth: 220,
            boxShadow: isActiveInFlow ? `0 0 15px ${colors.border}80` : undefined,
          },
        })
        
        // Connect from previous pod or service to this service
        const sourceNode = allPodsToShow.length > 0 
          ? `pod-${allPodsToShow[allPodsToShow.length - 1].namespace}-${allPodsToShow[allPodsToShow.length - 1].name}`
          : (index === 0 ? 'service' : `service-invocation-${serviceInvocationChain[index - 1].namespace}-${serviceInvocationChain[index - 1].podName}`)
        
        flowEdges.push({
          id: `${sourceNode}-to-${serviceNodeId}`,
          source: sourceNode,
          target: serviceNodeId,
          type: 'smoothstep',
          animated: isActiveInFlow,
          style: { 
            stroke: colors.border, 
            strokeWidth: isActiveInFlow ? 4 : 2,
          },
          markerEnd: { 
            type: MarkerType.ArrowClosed, 
            color: colors.border 
          },
          label: isActiveInFlow ? 'Invoking...' : service.resourceType.replace('-', ' '),
          labelStyle: { 
            fill: colors.text, 
            fontWeight: 600, 
            fontSize: 11 
          },
        })
      })
      
      x += 350 // Move x for next section
    }
    
    // 8. Service dependencies (if any)
    if (serviceDependencies.length > 0) {
      x += 200
      const baseStep = flowData.keycloak ? (7 + serviceInvocationChain.length) : (6 + serviceInvocationChain.length)
      serviceDependencies.forEach((dep, index) => {
        const depNodeId = `dep-service-${dep.namespace}-${dep.name}`
        const stepNumber = baseStep + index
        const isActiveInFlow = activeStep === stepNumber
        
        flowNodes.push({
          id: depNodeId,
          type: 'default',
          position: { x, y: yStart + (index * 180) },
          data: {
            label: (
              <div className="px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold">
                    {stepNumber}
                  </span>
                  <Server className="w-4 h-4 text-indigo-600" />
                  <span className="font-semibold text-sm">{dep.name}</span>
                  {isActiveInFlow && (
                    <span className="ml-auto animate-pulse text-indigo-600">Active</span>
                  )}
                  {!dep.found && (
                    <span className="text-xs text-red-600">(not found)</span>
                  )}
                </div>
                <div className="text-xs text-gray-600">
                  <div>Namespace: {dep.namespace}</div>
                </div>
              </div>
            ),
          },
          style: getNodeStyle(depNodeId, {
            background: dep.found ? '#EEF2FF' : '#FEE2E2',
            border: dep.found ? '2px solid #6366F1' : '2px solid #EF4444',
            borderRadius: '8px',
            minWidth: 200,
          }),
        })

        // Connect from selected deployment to dependency service
        if (selectedDeployment) {
          const deploymentNodeId = `deployment-${selectedDeployment.namespace}-${selectedDeployment.name}`
          const depEdge = requestFlow.find(f => 
            (f.nodeId === deploymentNodeId || f.nodeId === depNodeId) && isActiveInFlow
          )
          flowEdges.push({
            id: `deployment-${selectedDeployment.namespace}-${selectedDeployment.name}-to-${dep.name}`,
            source: deploymentNodeId,
            target: depNodeId,
            type: 'smoothstep',
            animated: true,
            style: { 
              stroke: depEdge ? depEdge.color : (dep.found ? '#6366F1' : '#EF4444'), 
              strokeWidth: isActiveInFlow ? 4 : 2, 
              strokeDasharray: dep.found ? '0' : '5,5' 
            },
            markerEnd: { type: MarkerType.ArrowClosed, color: depEdge ? depEdge.color : (dep.found ? '#6366F1' : '#EF4444') },
            label: isActiveInFlow ? 'Calling...' : 'uses',
            labelStyle: { fill: depEdge ? depEdge.color : (dep.found ? '#6366F1' : '#EF4444'), fontWeight: 600, fontSize: 11 },
          })
        }
      })
    }

    return { nodes: flowNodes, edges: flowEdges }
  })()

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="mb-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-2">
            <Globe className="w-5 h-5" />
            UI Application Service Flow
          </h3>
          {namespace && (
            <div className="mb-3">
              <p className="text-sm text-gray-600 flex items-center gap-2 mb-2">
                <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                  Filtering by namespace: {namespace}
                </span>
              </p>
              {flowData && flowData.debug && flowData.debug.namespaceMatch === false && (
                <div className="p-2 bg-yellow-50 border border-yellow-200 rounded-md">
                  <p className="text-xs text-yellow-800 font-semibold mb-1">
                    ⚠️ Namespace Mismatch
                  </p>
                  <p className="text-xs text-yellow-700">
                    You selected namespace <strong>{namespace}</strong>, but the ingress was found in namespace <strong>{flowData.ingress?.namespace}</strong>.
                    {flowData.keycloak && flowData.keycloak.ingress && flowData.keycloak.ingress.namespace !== namespace && (
                      <span className="block mt-1">
                        Keycloak is also in namespace <strong>{flowData.keycloak.ingress.namespace}</strong>.
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-yellow-600 mt-1">
                    💡 Tip: Select namespace <strong>{flowData.ingress?.namespace}</strong> to see resources in the correct namespace.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        
        <div className="flex gap-3 items-start">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Customer-Facing Application URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              onKeyPress={(e) => e.key === 'Enter' && findApplication()}
            />
            <p className="text-xs text-gray-500 mt-1">
              Enter the customer-facing URL (requires login) to trace request flow and monitor hits
            </p>
          </div>
          <div className="flex flex-col gap-2 mt-6">
            <button
              onClick={findApplication}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Find Application
                </>
              )}
            </button>
            {flowData && (
              <>
                <button
                  onClick={simulateRequest}
                  disabled={isMonitoring}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isMonitoring ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Monitoring...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Simulate Request
                    </>
                  )}
                </button>
                <button
                  onClick={() => setIsMonitoring(!isMonitoring)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
                    isMonitoring 
                      ? 'bg-red-600 text-white hover:bg-red-700' 
                      : 'bg-gray-600 text-white hover:bg-gray-700'
                  }`}
                >
                  <Activity className="w-4 h-4" />
                  {isMonitoring ? 'Stop Monitoring' : 'Start Auto-Monitor'}
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">Error</p>
              <p className="text-sm text-red-600 whitespace-pre-line">{error}</p>
              
              {/* Available Ingresses */}
              {showAvailableIngresses && availableIngresses.length > 0 && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowAvailableIngresses(!showAvailableIngresses)}
                    className="text-sm text-blue-600 hover:text-blue-800 underline"
                  >
                    {showAvailableIngresses ? 'Hide' : 'Show'} Available Ingresses ({availableIngresses.length})
                  </button>
                  {showAvailableIngresses && (
                    <div className="mt-2 p-3 bg-white border border-gray-200 rounded-md max-h-60 overflow-y-auto">
                      <p className="text-xs font-semibold text-gray-700 mb-2">Available Ingress Hosts:</p>
                      <div className="space-y-1">
                        {availableIngresses.map((ingress, idx) => (
                          <div key={idx} className="text-xs text-gray-600 p-2 bg-gray-50 rounded border border-gray-200">
                            <div className="font-medium">{ingress.name} ({ingress.namespace})</div>
                            <div className="text-gray-500 mt-1">
                              {ingress.hosts.map((host, hIdx) => (
                                <div key={hIdx} className="font-mono">{host}</div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        💡 Tip: Try using one of these hostnames, or check if your URL hostname matches exactly
                      </p>
                    </div>
                  )}
                </div>
              )}
              
              {/* Deployment Debug Info */}
              {deploymentDebugInfo && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowDeploymentDebug(!showDeploymentDebug)}
                    className="text-sm text-blue-600 hover:text-blue-800 underline"
                  >
                    {showDeploymentDebug ? 'Hide' : 'Show'} Deployment Matching Details
                  </button>
                  {showDeploymentDebug && (
                    <div className="mt-2 p-3 bg-white border border-gray-200 rounded-md max-h-96 overflow-y-auto">
                      <p className="text-xs font-semibold text-gray-700 mb-2">Service Selector:</p>
                      <pre className="text-xs bg-gray-50 p-2 rounded border border-gray-200 mb-3 overflow-x-auto">
                        {JSON.stringify(deploymentDebugInfo.serviceSelector, null, 2)}
                      </pre>
                      
                      {deploymentDebugInfo.availableDeployments && deploymentDebugInfo.availableDeployments.length > 0 ? (
                        <>
                          <p className="text-xs font-semibold text-gray-700 mb-2">
                            Found {deploymentDebugInfo.availableDeployments.length} deployment(s) in namespace, but none match:
                          </p>
                          <div className="space-y-2">
                            {deploymentDebugInfo.availableDeployments.map((dep: any, idx: number) => {
                              const mismatches = dep.selectorMatch?.filter((m: any) => !m.matches) || [];
                              return (
                                <div key={idx} className="text-xs p-2 bg-gray-50 rounded border border-gray-200">
                                  <div className="font-medium text-gray-900 mb-1">{dep.name}</div>
                                  <div className="text-gray-600 mb-1">
                                    <span className="font-semibold">Labels:</span>
                                    <pre className="mt-1 text-xs bg-white p-1 rounded border border-gray-200 overflow-x-auto">
                                      {JSON.stringify(dep.labels, null, 2)}
                                    </pre>
                                  </div>
                                  {mismatches.length > 0 && (
                                    <div className="text-red-600 mt-1">
                                      <span className="font-semibold">Missing/Mismatched:</span>
                                      <ul className="list-disc list-inside mt-1">
                                        {mismatches.map((m: any, mIdx: number) => (
                                          <li key={mIdx}>
                                            {m.key} = {m.required} (found: {m.actual})
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-gray-600">
                          No deployments found in namespace {flowData?.service?.namespace || 'unknown'}
                        </p>
                      )}
                      
                      <p className="text-xs text-gray-500 mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded">
                        💡 <strong>Tip:</strong> Ensure deployment labels match the service selector exactly. All keys in the selector must exist in the deployment labels with matching values.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Keycloak Status Warning */}
        {flowData?.keycloak && (
          <div className={`mt-4 p-3 rounded-md flex items-start gap-2 ${
            keycloakStatus && !keycloakStatus.accessible 
              ? 'bg-yellow-50 border border-yellow-200' 
              : keycloakStatus && keycloakStatus.accessible
              ? 'bg-green-50 border border-green-200'
              : 'bg-blue-50 border border-blue-200'
          }`}>
            <AlertCircle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
              keycloakStatus && !keycloakStatus.accessible 
                ? 'text-yellow-600' 
                : keycloakStatus && keycloakStatus.accessible
                ? 'text-green-600'
                : 'text-blue-600'
            }`} />
            <div className="flex-1">
              <p className={`text-sm font-medium ${
                keycloakStatus && !keycloakStatus.accessible 
                  ? 'text-yellow-800' 
                  : keycloakStatus && keycloakStatus.accessible
                  ? 'text-green-800'
                  : 'text-blue-800'
              }`}>
                {keycloakStatus && !keycloakStatus.accessible 
                  ? 'Keycloak Service Not Accessible' 
                  : keycloakStatus && keycloakStatus.accessible
                  ? 'Keycloak Service Accessible'
                  : 'Keycloak Authentication Service'}
              </p>
              {keycloakStatus && !keycloakStatus.accessible && (
                <>
                  <p className="text-sm text-yellow-700 mt-1 font-semibold">
                    ⚠️ Keycloak Service Not Accessible
                  </p>
                  <p className="text-sm text-yellow-700 mt-1">
                    {keycloakStatus.error || `Cannot connect to ${flowData.keycloak.ingress?.host}`}
                  </p>
                  <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                    <p className="text-blue-800 font-semibold mb-1">💡 Good News:</p>
                    <p className="text-blue-700">
                      The application will still work! You can:
                    </p>
                    <ul className="text-blue-700 mt-1 ml-4 list-disc">
                      <li>Continue using the application without Keycloak authentication</li>
                      <li>View the service flow and pods</li>
                      <li>Simulate requests and track service invocations</li>
                      <li>Create resources and see their impact</li>
                    </ul>
                  </div>
                  <p className="text-xs text-yellow-600 mt-2">
                    If you need authentication, check:
                  </p>
                  <ul className="text-xs text-yellow-600 mt-1 ml-4 list-disc">
                    <li>VPN connection to the cluster network</li>
                    <li>DNS resolution for {flowData.keycloak.ingress?.host}</li>
                    <li>Keycloak service status in Kubernetes</li>
                    <li>Ingress configuration and routing</li>
                    <li>Network firewall rules</li>
                  </ul>
                  {flowData.keycloak.deployment && (
                    <div className="mt-3 p-2 bg-white border border-yellow-300 rounded text-xs">
                      <p className="font-semibold text-yellow-800 mb-1">Keycloak Deployment Status:</p>
                      <div className="text-yellow-700 space-y-1">
                        <div>Deployment: {flowData.keycloak.deployment.name}</div>
                        <div>Namespace: {flowData.keycloak.deployment.namespace}
                          {namespace && flowData.keycloak.deployment.namespace !== namespace && (
                            <span className="ml-1 text-red-600 font-semibold">
                              ⚠️ (Different from selected: {namespace})
                            </span>
                          )}
                        </div>
                        {flowData.keycloak.deployment.readyReplicas !== undefined && (
                          <div>
                            Ready Replicas: {flowData.keycloak.deployment.readyReplicas}/{flowData.keycloak.deployment.replicas}
                            {flowData.keycloak.deployment.readyReplicas === 0 && (
                              <span className="ml-1 text-red-600 font-semibold">⚠️ No ready replicas!</span>
                            )}
                          </div>
                        )}
                        {flowData.keycloak.deployment.pods && flowData.keycloak.deployment.pods.length > 0 && (
                          <div className="mt-2">
                            <p className="font-semibold">Pods:</p>
                            {flowData.keycloak.deployment.pods.map((pod: any, idx: number) => (
                              <div key={idx} className="ml-2">
                                {pod.name}: {pod.status} {pod.ready ? '✅' : '❌'} 
                                {pod.restartCount > 0 && ` (${pod.restartCount} restarts)`}
                                {pod.status !== 'Running' && (
                                  <span className="ml-1 text-red-600">⚠️ Not Running</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {(!flowData.keycloak.deployment.pods || flowData.keycloak.deployment.pods.length === 0) && (
                          <div className="text-red-600 mt-1">
                            ⚠️ No pods found for Keycloak deployment
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {flowData.keycloak.ingress?.host && (
                    <div className="mt-2 p-2 bg-white border border-yellow-300 rounded text-xs">
                      <p className="font-semibold text-yellow-800 mb-1">Connection Issue:</p>
                      <p className="text-yellow-700">
                        The service at <span className="font-mono">{flowData.keycloak.ingress.host}</span> is refusing connections.
                        This could mean:
                      </p>
                      <ul className="text-yellow-600 mt-1 ml-4 list-disc space-y-1">
                        <li>Keycloak pods are not running (check pod status above)</li>
                        <li>Service is not accessible from your network/VPN</li>
                        <li>Ingress controller is not routing correctly</li>
                        <li>DNS is not resolving the hostname</li>
                        {namespace && flowData.keycloak.ingress.namespace !== namespace && (
                          <li className="font-semibold text-red-600">
                            Keycloak is in namespace <strong>{flowData.keycloak.ingress.namespace}</strong>, but you selected <strong>{namespace}</strong>
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </>
              )}
              {keycloakStatus && keycloakStatus.accessible && (
                <p className="text-sm text-green-700 mt-1">
                  ✅ Keycloak service is accessible at {flowData.keycloak.ingress?.host}
                </p>
              )}
              {!keycloakStatus && flowData.keycloak.ingress?.host && (
                <p className="text-sm text-blue-700 mt-1">
                  Keycloak URL: <span className="font-mono">{flowData.keycloak.ingress.host}</span>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Login Form - Show when application is found but not authenticated */}
        {flowData && !isAuthenticated && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-blue-600" />
              <h4 className="text-sm font-semibold text-blue-900">Authentication Required</h4>
            </div>
            {keycloakStatus && !keycloakStatus.accessible && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
                <p className="text-yellow-800 font-semibold mb-1">⚠️ Keycloak Not Accessible</p>
                <p className="text-yellow-700">
                  Keycloak authentication service is not reachable, but you can still proceed with simulated authentication.
                  The application will work normally without Keycloak.
                </p>
              </div>
            )}
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                ⚠️ {error}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value)
                    setError(null) // Clear error when user types
                  }}
                  placeholder="Enter username"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError(null) // Clear error when user types
                  }}
                  placeholder="Enter password (min 3 characters)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Password must be at least 3 characters long
                </p>
              </div>
            </div>
            <button
              onClick={handleLogin}
              disabled={isLoggingIn || !username.trim() || !password.trim()}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Logging in...
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Login to Application
                </>
              )}
            </button>
          </div>
        )}

        {/* Authenticated Application View */}
        {/* Show application view if we have flowData (so user can always see the browser) */}
        {flowData ? (
          <div className="mt-6 border border-gray-300 rounded-lg overflow-hidden shadow-lg">
            <div className="bg-gray-100 px-4 py-3 flex items-center justify-between border-b border-gray-300">
              <div className="flex items-center gap-2">
                <Monitor className="w-5 h-5 text-gray-700" />
                <h4 className="text-sm font-semibold text-gray-900">Application View</h4>
                {isAuthenticated && (
                  <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                    Authenticated
                  </span>
                )}
                {!isAuthenticated && (
                  <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
                    Not Authenticated
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    window.open(url, '_blank', 'noopener,noreferrer')
                    if (selectedDeployment || invokedDeployment || (flowData?.deployments && flowData.deployments.length > 0)) {
                      trackAction('Open in New Window', 'Application')
                    }
                  }}
                  className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors flex items-center gap-1"
                >
                  <Monitor className="w-3 h-3" />
                  Open in New Tab
                </button>
                <button
                  onClick={handleLogout}
                  className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Logout
                </button>
              </div>
            </div>
            <div className="bg-white" style={{ height: '600px', position: 'relative' }}>
              {(iframeError || (keycloakStatus && !keycloakStatus.accessible) || cspError) ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-gray-50">
                  <AlertCircle className="w-16 h-16 text-orange-500 mb-4" />
                  <h4 className="text-lg font-semibold text-gray-900 mb-2">Unable to Load Application in Frame</h4>
                  {cspError ? (
                    <>
                      <p className="text-sm text-gray-600 text-center mb-4 max-w-md">
                        The application cannot be displayed in an embedded frame due to <span className="font-semibold text-orange-600">Content Security Policy (CSP)</span> restrictions.
                      </p>
                      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg mb-4 max-w-md">
                        <p className="text-sm text-yellow-800 font-semibold mb-2">🔒 Security Policy:</p>
                        <p className="text-sm text-yellow-700 mb-2">
                          The server has set <code className="bg-yellow-100 px-1 rounded">frame-ancestors &apos;self&apos;</code> which prevents embedding from other origins.
                        </p>
                        <p className="text-sm text-yellow-700">
                          This is a security feature to prevent clickjacking attacks.
                        </p>
                      </div>
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-6 max-w-md">
                        <p className="text-sm text-blue-800 font-semibold mb-2">💡 Solution:</p>
                        <p className="text-sm text-blue-700">
                          Click &quot;Open in New Window&quot; below to access the application directly. All other features (flow diagram, service tracking, resource creation) will continue to work normally.
                        </p>
                      </div>
                    </>
                  ) : keycloakStatus && !keycloakStatus.accessible ? (
                    <>
                      <p className="text-sm text-gray-600 text-center mb-4 max-w-md">
                        The application is trying to redirect to Keycloak authentication, but <span className="font-semibold text-orange-600">n1devcmp-auth.airteldev.com</span> refused to connect.
                      </p>
                      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg mb-4 max-w-md">
                        <p className="text-sm text-yellow-800 font-semibold mb-2">⚠️ Connection Issue:</p>
                        <p className="text-sm text-yellow-700 mb-2">
                          Possible causes:
                        </p>
                        <ul className="text-sm text-yellow-700 list-disc list-inside space-y-1">
                          <li>Keycloak service is down or not accessible</li>
                          <li>Network/firewall blocking the connection</li>
                          <li>VPN or network configuration issue</li>
                          <li>Service needs to be started or restarted</li>
                        </ul>
                      </div>
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-6 max-w-md">
                        <p className="text-sm text-blue-800 font-semibold mb-2">💡 What You Can Do:</p>
                        <ul className="text-sm text-blue-700 list-disc list-inside space-y-1 mb-2">
                          <li>Click &quot;Open in New Window&quot; to try opening directly</li>
                          <li>Check the service flow diagram and tracking features below</li>
                          <li>Verify Keycloak service is running and accessible</li>
                          <li>Check network connectivity to n1devcmp-auth.airteldev.com</li>
                        </ul>
                        <p className="text-sm text-blue-700">
                          <strong>Note:</strong> The application window here is just for preview. All core features (flow tracking, resource management, service visualization) work without it.
                        </p>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-600 text-center mb-6 max-w-md">
                      The application cannot be displayed in an embedded frame due to security restrictions (X-Frame-Options or CORS).
                      Please open it in a new window to interact with the application.
                    </p>
                  )}
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        window.open(url, '_blank', 'noopener,noreferrer')
                        trackAction('Open in New Window', 'Application')
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center gap-2"
                    >
                      <Monitor className="w-4 h-4" />
                      Open in New Window
                    </button>
                    {!cspError && (
                      <button
                        onClick={() => {
                          setIframeError(false)
                          setCspError(false)
                          setIframeLoading(true)
                        }}
                        className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors flex items-center gap-2"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Retry
                      </button>
                    )}
                  </div>
                  <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg max-w-md">
                    <p className="text-xs text-blue-800 mb-2 font-semibold">Note:</p>
                    <p className="text-xs text-blue-700">
                      After opening in a new window, you can still track actions using the buttons below.
                      The service flow will update as you perform actions on the application.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {iframeLoading && (
                    <div className="absolute inset-0 bg-white flex items-center justify-center z-10">
                      <div className="text-center">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
                        <p className="text-sm text-gray-600">Loading application...</p>
                      </div>
                    </div>
                  )}
                  <iframe
                    src={url}
                    className="w-full h-full border-0"
                    title="Application View"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation allow-presentation"
                    allow="fullscreen"
                    style={{ 
                      display: (iframeLoading || iframeError || (keycloakStatus && !keycloakStatus.accessible)) ? 'none' : 'block', 
                      minHeight: '600px' 
                    }}
                    onLoad={() => {
                      // Clear any pending timeout
                      if (iframeLoadTimeout) {
                        clearTimeout(iframeLoadTimeout)
                        setIframeLoadTimeout(null)
                      }
                      setIframeLoading(false)
                      setIframeError(false)
                      setCspError(false)
                      console.log('✅ Iframe loaded successfully:', url)
                      
                      // Check for CSP errors by trying to access iframe content
                      // Note: This will fail silently if CSP blocks it, but we can check console errors
                      try {
                        const iframe = document.querySelector('iframe[title="Application View"]') as HTMLIFrameElement
                        if (iframe && iframe.contentWindow) {
                          // Try to access iframe location (will throw if CSP blocks it)
                          try {
                            const iframeUrl = iframe.contentWindow.location.href
                            console.log('✅ Iframe content accessible:', iframeUrl)
                          } catch (cspErr: any) {
                            // CSP error detected
                            if (cspErr.message && cspErr.message.includes('frame-ancestors')) {
                              console.warn('⚠️ CSP error detected:', cspErr.message)
                              setCspError(true)
                              setIframeError(true)
                              setIframeLoading(false)
                            }
                          }
                        }
                      } catch (e) {
                        console.log('⚠️ Cannot access iframe content (CORS/CSP restriction):', e)
                      }
                      
                      // Check if iframe actually loaded content by checking if it's accessible
                      // Note: Due to CORS, we can't directly check iframe content, but we can check if it loaded
                      try {
                        const iframe = document.querySelector('iframe[title="Application View"]') as HTMLIFrameElement
                        if (iframe && iframe.contentWindow) {
                          // Iframe loaded, but check if Keycloak redirect might have failed
                          if (keycloakStatus && !keycloakStatus.accessible) {
                            // Wait a bit to see if error appears
                            setTimeout(() => {
                              // Check if iframe is showing an error page
                              // Since we can't access content due to CORS, we'll rely on the timeout mechanism
                            }, 3000)
                          }
                        }
                      } catch (e) {
                        console.log('⚠️ Cannot access iframe content (CORS restriction):', e)
                      }
                      
                      // Wait a bit for deployment to be set, then track page load
                      setTimeout(() => {
                        // Check if we have deployments now
                        const currentDeployment = selectedDeployment || invokedDeployment
                        if (currentDeployment) {
                          trackAction('Page Loaded', 'Application Homepage')
                        } else if (flowData?.deployments && flowData.deployments.length > 0) {
                          // Auto-select first deployment if available
                          const firstDeployment = flowData.deployments[0]
                          setSelectedDeployment(firstDeployment)
                          setInvokedDeployment(firstDeployment)
                          trackAction('Page Loaded', 'Application Homepage')
                        } else {
                          // No deployments available - show informative message
                          setActionHistory(prev => [...prev, {
                            action: 'Page Loaded',
                            timestamp: Date.now(),
                            resource: 'Application Homepage',
                            deployment: flowData?.service 
                              ? 'No deployments match service selector - check deployment labels' 
                              : 'Waiting for application discovery...'
                          }])
                        }
                      }, 500) // Wait 500ms for deployment to be set
                    }}
                    onError={(e) => {
                      console.error('❌ Iframe error:', e)
                      // Clear timeout if error occurs
                      if (iframeLoadTimeout) {
                        clearTimeout(iframeLoadTimeout)
                        setIframeLoadTimeout(null)
                      }
                      setIframeLoading(false)
                      setIframeError(true)
                      
                      // Check if it's a connection refused error (Keycloak not accessible)
                      // Note: iframe error events don't provide detailed error messages
                      const errorMessage = String(e?.target || e || '')
                      if (errorMessage.includes('refused to connect') || 
                          errorMessage.includes('ERR_CONNECTION_REFUSED') ||
                          url.includes('n1devcmp-auth.airteldev.com') ||
                          url.includes('auth')) {
                        // This is a connection error, not CSP
                        setCspError(false)
                        // Ensure Keycloak status is set to not accessible
                        if (!keycloakStatus || keycloakStatus.accessible) {
                          setKeycloakStatus({ accessible: false, error: 'Connection refused' })
                        }
                      } else {
                        // Might be a CSP error
                        setCspError(true)
                      }
                    }}
                  />
                </>
              )}
              
            </div>
          </div>
        ) : null}
      </div>

      {/* Service Flow Diagram - Show when authenticated and actions are performed */}
      {/* Always show flow diagram if we have flowData, even if Keycloak is not accessible */}
      {flowData && (isAuthenticated || hitCount > 0 || (keycloakStatus && !keycloakStatus.accessible)) && (
        <div className="mt-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h4 className="text-md font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <Network className="w-5 h-5 text-blue-600" />
                Service Flow Visualization
                {isAuthenticated && (
                  <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                    Live Monitoring
                  </span>
                )}
                {keycloakStatus && !keycloakStatus.accessible && (
                  <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
                    ⚠️ Keycloak Not Accessible (Flow Still Works)
                  </span>
                )}
              </h4>
              <p className="text-sm text-gray-600">
                {flowData.deployments && flowData.deployments.length > 0 ? (
                  <>
                    Found {flowData.deployments.length} deployment{flowData.deployments.length !== 1 ? 's' : ''}
                    {serviceDependencies.length > 0 && (
                      <span className="ml-2">
                        • {serviceDependencies.length} service dependenc{serviceDependencies.length !== 1 ? 'ies' : 'y'}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-orange-600 font-semibold">
                    ⚠️ No deployments found matching the service selector
                  </span>
                )}
                {hitCount > 0 && (
                  <span className="ml-2 text-purple-600 font-semibold">
                    • {hitCount} request{hitCount !== 1 ? 's' : ''} monitored
                  </span>
                )}
              </p>
              {(!flowData.deployments || flowData.deployments.length === 0) && flowData.service && (
                <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                  <p className="text-xs text-yellow-800 font-semibold mb-1">⚠️ Deployment Matching Issue</p>
                  <p className="text-xs text-yellow-700">
                    Service <strong>{flowData.service.name}</strong> was found, but no deployments match its selector.
                    This could mean:
                  </p>
                  <ul className="text-xs text-yellow-700 mt-1 ml-4 list-disc">
                    <li>Deployments exist but labels don&apos;t match the service selector</li>
                    <li>Deployments are in a different namespace</li>
                    <li>Service selector configuration needs to be checked</li>
                  </ul>
                  <p className="text-xs text-yellow-700 mt-2">
                    <strong>Service Selector:</strong> {JSON.stringify(flowData.service.selector || {})}
                  </p>
                </div>
              )}
              {isMonitoring && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <Activity className="w-3 h-3 animate-pulse" />
                  Auto-monitoring active - simulating requests every 10 seconds
                </p>
              )}
              
              {/* Show Service Invocation Chain */}
              {serviceInvocationChain.length > 0 && (
                <div className="mt-3 p-3 bg-gradient-to-r from-cyan-50 to-indigo-50 border border-cyan-200 rounded-md">
                  <p className="text-sm font-semibold text-cyan-800 flex items-center gap-2 mb-2">
                    <Network className="w-4 h-4" />
                    🔗 Service Invocation Chain ({serviceInvocationChain.length} services):
                  </p>
                  <div className="space-y-2">
                    {serviceInvocationChain.map((service, idx) => {
                      const iconMap: Record<ServiceInvocation['resourceType'], string> = {
                        'nat-gateway': '🌐',
                        'public-ip': '🌍',
                        'security': '🔒',
                        'infrastructure': '🏗️',
                        'network': '🌐',
                        'storage': '💾',
                        'compute': '💻',
                        'k8s': '☸️',
                        'unknown': '📦'
                      }
                      const colors: Record<ServiceInvocation['resourceType'], string> = {
                        'nat-gateway': 'text-cyan-700',
                        'public-ip': 'text-teal-700',
                        'security': 'text-amber-700',
                        'infrastructure': 'text-indigo-700',
                        'network': 'text-purple-700',
                        'storage': 'text-red-700',
                        'compute': 'text-blue-700',
                        'k8s': 'text-green-700',
                        'unknown': 'text-gray-700'
                      }
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          {idx > 0 && <span className="text-gray-400">→</span>}
                          <div className={`px-3 py-2 rounded-md border-2 flex-1 ${
                            service.resourceType === 'nat-gateway' ? 'bg-cyan-100 border-cyan-300' :
                            service.resourceType === 'public-ip' ? 'bg-teal-100 border-teal-300' :
                            service.resourceType === 'security' ? 'bg-amber-100 border-amber-300' :
                            service.resourceType === 'infrastructure' ? 'bg-indigo-100 border-indigo-300' :
                            'bg-gray-100 border-gray-300'
                          }`}>
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{iconMap[service.resourceType]}</span>
                              <div className="flex-1">
                                <div className={`font-bold text-sm ${colors[service.resourceType]}`}>
                                  {service.serviceName}
                                </div>
                                <div className="text-xs text-gray-600">
                                  {service.podName} • {service.resourceType.replace('-', ' ')}
                                  {service.impactData && (
                                    <span className="ml-2">
                                      {service.impactData.natGatewayEvents > 0 && `🌐${service.impactData.natGatewayEvents} `}
                                      {service.impactData.publicIpEvents > 0 && `🌍${service.impactData.publicIpEvents} `}
                                      {service.impactData.infrastructureEvents > 0 && `🏗️${service.impactData.infrastructureEvents} `}
                                      {service.events > 0 && `📊${service.events}`}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-xs text-cyan-700 mt-2 italic">
                    💡 This shows the chain of services invoked when creating resources (e.g., Public IP from NAT Gateway).
                    Services are ordered by resource type priority.
                  </p>
                </div>
              )}
              
              {/* Show impacted pods summary */}
              {invokedPods.length > 0 && (
                <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-md">
                  <p className="text-sm font-semibold text-orange-800 flex items-center gap-2 mb-2">
                    <Activity className="w-4 h-4" />
                    🎯 Impacted Pods ({invokedPods.length}):
                  </p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {invokedPods.map((podName, idx) => {
                      const pod = pods.find(p => p.name === podName)
                      const hasImpactData = pod?.impactData && (pod.impactData.isImpacted || pod.impactData.hasRecentActivity)
                      return (
                        <div 
                          key={idx} 
                          className={`px-3 py-1.5 rounded-md text-xs font-medium border-2 ${
                            hasImpactData 
                              ? 'bg-orange-200 text-orange-900 border-orange-400' 
                              : 'bg-purple-200 text-purple-900 border-purple-400'
                          }`}
                        >
                          <div className="font-bold">{podName}</div>
                          {hasImpactData && pod.impactData && (
                            <div className="mt-1 text-xs">
                              {pod.impactData.computeEvents > 0 && <span className="mr-2">💻 {pod.impactData.computeEvents} compute</span>}
                              {pod.impactData.k8sEvents > 0 && <span className="mr-2">☸️ {pod.impactData.k8sEvents} k8s</span>}
                              {pod.impactData.natGatewayEvents > 0 && <span className="mr-2">🌐 {pod.impactData.natGatewayEvents} NAT</span>}
                              {pod.impactData.publicIpEvents > 0 && <span className="mr-2">🌍 {pod.impactData.publicIpEvents} PublicIP</span>}
                              {pod.impactData.infrastructureEvents > 0 && <span className="mr-2">🏗️ {pod.impactData.infrastructureEvents} infra</span>}
                              {pod.impactData.resourceCreationEvents > 0 && <span className="mr-2">✨ {pod.impactData.resourceCreationEvents} created</span>}
                              {pod.impactData.recentEventCount > 0 && <span className="mr-2">📊 {pod.impactData.recentEventCount} events</span>}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {pods.filter(p => invokedPods.includes(p.name) && p.impactData).length > 0 && (
                    <p className="text-xs text-orange-700 mt-2 italic">
                      💡 These pods show recent activity (events/logs) indicating they were called or impacted by your actions.
                    </p>
                  )}
                </div>
              )}
              
              {invokedDeployment && (
                <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded-md">
                  <p className="text-xs font-semibold text-orange-800 flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    Currently Invoked Deployment:
                  </p>
                  <p className="text-sm text-orange-700 font-medium mt-1">
                    {invokedDeployment.name} ({invokedDeployment.namespace})
                  </p>
                  <p className="text-xs text-orange-600 mt-1">
                    This deployment is handling the current requests and actions
                  </p>
                </div>
              )}
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              {flowData.deployments && flowData.deployments.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-50 border border-blue-200 rounded-md">
                  <span className="text-gray-700 font-medium">Deployment:</span>
                  <select
                    value={selectedDeployment ? `${selectedDeployment.namespace}/${selectedDeployment.name}` : ''}
                    onChange={(e) => {
                      const [namespace, ...nameParts] = e.target.value.split('/')
                      const name = nameParts.join('/')
                      if (namespace && name) {
                        handleDeploymentClick({ namespace, name })
                        setInvokedDeployment({ namespace, name })
                      }
                    }}
                    className="text-sm border border-blue-300 rounded px-2 py-1 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {flowData.deployments.map((dep) => (
                      <option key={`${dep.namespace}/${dep.name}`} value={`${dep.namespace}/${dep.name}`}>
                        {dep.name} ({dep.namespace})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {selectedDeployment && (
                <button
                  onClick={() => handleDeploymentClick(selectedDeployment)}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh Dependencies
                </button>
              )}
              {invokedDeployment && (
                <div className="px-3 py-1.5 text-sm bg-orange-100 border border-orange-300 rounded-md flex items-center gap-2">
                  <Activity className="w-4 h-4 text-orange-600" />
                  <span className="text-orange-700 font-medium">
                    Invoked: {invokedDeployment.name}
                  </span>
                </div>
              )}
              {hitCount > 0 && (
                <button
                  onClick={() => {
                    setHitCount(0)
                    setRequestFlow([])
                    setActiveStep(null)
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                >
                  <Eye className="w-4 h-4" />
                  Clear History
                </button>
              )}
            </div>
          </div>

          {nodes.length > 0 ? (
            <div>
              {/* Sequential Flow Legend */}
              <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-xs font-semibold text-gray-700">Request Flow Sequence:</span>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: flowColors[0] }}></div>
                    <span className="text-xs text-gray-600">1. Customer UI</span>
                  </div>
                  {flowData.keycloak && (
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: flowColors[1] }}></div>
                      <span className="text-xs text-gray-600">2. Keycloak Auth</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: flowColors[flowData.keycloak ? 2 : 1] }}></div>
                    <span className="text-xs text-gray-600">{flowData.keycloak ? '3' : '2'}. Ingress</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: flowColors[flowData.keycloak ? 3 : 2] }}></div>
                    <span className="text-xs text-gray-600">{flowData.keycloak ? '4' : '3'}. Service</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: flowColors[flowData.keycloak ? 4 : 3] }}></div>
                    <span className="text-xs text-gray-600">{flowData.keycloak ? '5' : '4'}. Deployment</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: flowColors[flowData.keycloak ? 5 : 4] }}></div>
                    <span className="text-xs text-gray-600">{flowData.keycloak ? '6' : '5'}. Pods (ccs namespace)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: flowColors[flowData.keycloak ? 5 : 4] }}></div>
                    <span className="text-xs text-gray-600">{flowData.keycloak ? '7' : '6'}+. Backend Services</span>
                  </div>
                  {activeStep !== null && (
                    <span className="ml-auto text-xs font-semibold text-green-600 animate-pulse">
                      Active: Step {activeStep}
                    </span>
                  )}
                </div>
              </div>
              
              <div style={{ height: '600px', width: '100%', overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  fitView
                  minZoom={0.1}
                  maxZoom={2}
                  onNodeClick={(event, node) => {
                    if (node.id.startsWith('deployment-')) {
                      const parts = node.id.replace('deployment-', '').split('-')
                      const namespace = parts[0]
                      const name = parts.slice(1).join('-')
                      handleDeploymentClick({ name, namespace })
                    }
                  }}
                  attributionPosition="bottom-left"
                >
                  <Background color="#aaa" gap={16} />
                  <Controls />
                  <MiniMap 
                    nodeColor={(node) => {
                      if (node.id === 'app') return '#9333EA'
                      if (node.id === 'ingress') return '#F97316'
                      if (node.id === 'service') return '#22C55E'
                      if (node.id.startsWith('deployment-')) return '#3B82F6'
                      if (node.id.startsWith('dep-service-')) return '#6366F1'
                      if (node.id.startsWith('pod-')) return '#A855F7'
                      if (node.id.startsWith('service-invocation-')) return '#06B6D4'
                      return '#gray'
                    }}
                    maskColor="rgba(0, 0, 0, 0.1)"
                  />
                </ReactFlow>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-gray-500">
              No flow data to display
            </div>
          )}
        </div>
      )}

      {!flowData && !isLoading && !error && (
        <div className="p-12 text-center text-gray-500">
          <Globe className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-lg mb-2">Enter a URL to trace service dependencies</p>
          <p className="text-sm">The system will find the Ingress, Service, and Deployment for your application</p>
        </div>
      )}
    </div>
  )
}







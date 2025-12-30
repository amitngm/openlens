'use client'

import { useMemo, useEffect, useState } from 'react'
import ReactFlow, { 
  Node, 
  Edge, 
  Background, 
  Controls, 
  MiniMap, 
  MarkerType,
  type NodeTypes,
  type EdgeTypes
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Server, Network, Box, X, Sparkles, RefreshCw } from 'lucide-react'

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
  creationTimestamp?: string
}

interface Deployment {
  name: string
  namespace: string
  replicas: number
  readyReplicas: number
  containers: Array<{
    name: string
    image: string
  }>
  labels: Record<string, string>
  creationTimestamp?: string
}

interface ServiceFlowDiagramProps {
  services: Service[]
  deployments: Deployment[]
  namespace: string
  isFullScreen?: boolean
  onRefresh?: () => void
  autoRefresh?: boolean
}

export default function ServiceFlowDiagram({ services, deployments, namespace, isFullScreen = false, onRefresh, autoRefresh = true }: ServiceFlowDiagramProps) {
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  
  // Auto-refresh every 30 seconds if enabled
  useEffect(() => {
    if (!autoRefresh || !onRefresh) return
    
    const interval = setInterval(() => {
      onRefresh()
      setLastRefresh(new Date())
    }, 30000) // Refresh every 30 seconds
    
    return () => clearInterval(interval)
  }, [autoRefresh, onRefresh])
  
  // Helper function to check if a resource was created recently (within last 10 minutes)
  const isRecentlyCreated = (creationTimestamp?: string): boolean => {
    if (!creationTimestamp) return false
    const created = new Date(creationTimestamp)
    const now = new Date()
    const diffMinutes = (now.getTime() - created.getTime()) / (1000 * 60)
    return diffMinutes <= 10 // Consider "new" if created within last 10 minutes
  }

  const { nodes, edges } = useMemo(() => {
    const flowNodes: Node[] = []
    const flowEdges: Edge[] = []
    const nodePositions = new Map<string, { x: number; y: number }>()
    
    // Filter resources by namespace
    const filteredServices = services.filter(s => namespace === 'all' || s.namespace === namespace)
    const filteredDeployments = deployments.filter(d => namespace === 'all' || d.namespace === namespace)
    
    // Create deployment nodes with better layout
    const deploymentsPerColumn = Math.ceil(Math.sqrt(filteredDeployments.length)) || 1
    filteredDeployments.forEach((deployment, index) => {
      const nodeId = `deployment-${deployment.namespace}-${deployment.name}`
      const col = index % deploymentsPerColumn
      const row = Math.floor(index / deploymentsPerColumn)
      const x = 100 + (col * 350)
      const y = 150 + (row * 250)
      
      nodePositions.set(nodeId, { x, y })
      
      const isNew = isRecentlyCreated(deployment.creationTimestamp)
      
      flowNodes.push({
        id: nodeId,
        type: 'default',
        position: { x, y },
        data: {
          label: (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <Box className="w-4 h-4 text-blue-600" />
                <span className="font-semibold text-sm">{deployment.name}</span>
                {isNew && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-yellow-400 text-yellow-900 rounded-full text-xs font-bold animate-pulse">
                    <Sparkles className="w-3 h-3" />
                    NEW
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-600">
                <div>Namespace: {deployment.namespace}</div>
                <div>Replicas: {deployment.readyReplicas}/{deployment.replicas}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {deployment.containers.length} container{deployment.containers.length !== 1 ? 's' : ''}
                </div>
                {deployment.creationTimestamp && (
                  <div className="text-xs text-gray-400 mt-1">
                    Created: {new Date(deployment.creationTimestamp).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          ),
        },
        style: {
          background: isNew ? '#FEF3C7' : '#EFF6FF',
          border: isNew ? '3px solid #F59E0B' : '2px solid #3B82F6',
          borderRadius: '8px',
          minWidth: 200,
          boxShadow: isNew ? '0 0 10px rgba(245, 158, 11, 0.5)' : 'none',
        },
      })
    })
    
    // Create service nodes and connect to deployments with better layout
    const servicesPerColumn = Math.ceil(Math.sqrt(filteredServices.length)) || 1
    filteredServices.forEach((service, index) => {
      const nodeId = `service-${service.namespace}-${service.name}`
      const col = index % servicesPerColumn
      const row = Math.floor(index / servicesPerColumn)
      // Position services to the right of deployments
      const maxDeploymentX = filteredDeployments.length > 0 
        ? 100 + ((deploymentsPerColumn - 1) * 350) + 250
        : 100
      const x = maxDeploymentX + 200 + (col * 350)
      const y = 150 + (row * 250)
      
      nodePositions.set(nodeId, { x, y })
      
      const isNew = isRecentlyCreated(service.creationTimestamp)
      
      // Find deployments that match this service's selector
      const matchingDeployments = filteredDeployments.filter(deployment => {
        if (deployment.namespace !== service.namespace) return false
        
        // Check if deployment labels match service selector
        const selectorKeys = Object.keys(service.selector)
        if (selectorKeys.length === 0) return false
        
        return selectorKeys.every(key => 
          deployment.labels && deployment.labels[key] === service.selector[key]
        )
      })
      
      flowNodes.push({
        id: nodeId,
        type: 'default',
        position: { x, y },
        data: {
          label: (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <Network className="w-4 h-4 text-green-600" />
                <span className="font-semibold text-sm">{service.name}</span>
                {isNew && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-yellow-400 text-yellow-900 rounded-full text-xs font-bold animate-pulse">
                    <Sparkles className="w-3 h-3" />
                    NEW
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-600">
                <div>Namespace: {service.namespace}</div>
                <div>Type: {service.type}</div>
                <div>Ports: {service.ports.map(p => p.port).join(', ')}</div>
                {matchingDeployments.length > 0 && (
                  <div className="text-xs text-green-600 mt-1">
                    → {matchingDeployments.length} deployment{matchingDeployments.length !== 1 ? 's' : ''}
                  </div>
                )}
                {service.creationTimestamp && (
                  <div className="text-xs text-gray-400 mt-1">
                    Created: {new Date(service.creationTimestamp).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          ),
        },
        style: {
          background: isNew ? '#FEF3C7' : '#F0FDF4',
          border: isNew ? '3px solid #F59E0B' : '2px solid #22C55E',
          borderRadius: '8px',
          minWidth: 200,
          boxShadow: isNew ? '0 0 10px rgba(245, 158, 11, 0.5)' : 'none',
        },
      })
      
      // Create edges from service to matching deployments
      matchingDeployments.forEach(deployment => {
        const deploymentNodeId = `deployment-${deployment.namespace}-${deployment.name}`
        flowEdges.push({
          id: `edge-${nodeId}-${deploymentNodeId}`,
          source: nodeId,
          target: deploymentNodeId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#22C55E', strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#22C55E',
          },
          label: service.ports.map(p => `${p.port}→${p.targetPort}`).join(', '),
          labelStyle: { fill: '#22C55E', fontWeight: 600, fontSize: 10 },
        })
      })
    })
    
    // Check for service-to-service connections (via selectors or labels)
    filteredServices.forEach(service => {
      // Check if this service's labels match another service's selector
      filteredServices.forEach(targetService => {
        if (service.name === targetService.name || service.namespace !== targetService.namespace) return
        
        const selectorKeys = Object.keys(targetService.selector)
        if (selectorKeys.length === 0) return
        
        const matches = selectorKeys.every(key => 
          service.labels && service.labels[key] === targetService.selector[key]
        )
        
        if (matches) {
          const sourceId = `service-${service.namespace}-${service.name}`
          const targetId = `service-${targetService.namespace}-${targetService.name}`
          
          // Only add edge if nodes exist
          if (nodePositions.has(sourceId) && nodePositions.has(targetId)) {
            flowEdges.push({
              id: `edge-${sourceId}-${targetId}`,
              source: sourceId,
              target: targetId,
              type: 'smoothstep',
              animated: true,
              style: { stroke: '#8B5CF6', strokeWidth: 2 },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: '#8B5CF6',
              },
              label: 'Service → Service',
              labelStyle: { fill: '#8B5CF6', fontWeight: 600, fontSize: 10 },
            })
          }
        }
      })
    })
    
    return { nodes: flowNodes, edges: flowEdges }
  }, [services, deployments, namespace])
  
  if (nodes.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
        <Server className="w-16 h-16 mx-auto text-gray-400 mb-4" />
        <p className="text-gray-600 text-lg mb-2">No services or deployments found</p>
        <p className="text-gray-500 text-sm">
          {namespace === 'all' 
            ? 'No resources available in any namespace'
            : `No resources found in namespace: ${namespace}`
          }
        </p>
      </div>
    )
  }
  
  const containerHeight = isFullScreen ? 'calc(100vh - 120px)' : '800px'
  
  return (
    <div 
      className={`${isFullScreen ? 'h-full' : 'bg-white rounded-lg shadow-sm border border-gray-200'} p-4`} 
      style={{ height: isFullScreen ? '100%' : containerHeight }}
    >
      {!isFullScreen && (
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Network className="w-5 h-5" />
            Service Flow Diagram
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Showing {nodes.length} node{nodes.length !== 1 ? 's' : ''} and {edges.length} connection{edges.length !== 1 ? 's' : ''}
            {nodes.some(n => n.style?.boxShadow) && (
              <span className="ml-2 text-yellow-600 font-semibold">
                • {nodes.filter(n => n.style?.boxShadow).length} newly created
              </span>
            )}
            {autoRefresh && onRefresh && (
              <span className="ml-2 text-xs text-gray-500">
                • Auto-refreshing every 30s
              </span>
            )}
          </p>
        </div>
        {onRefresh && (
          <button
            onClick={() => {
              onRefresh()
              setLastRefresh(new Date())
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            title="Refresh diagram"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        )}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-100 border-2 border-green-600 rounded"></div>
            <span>Service</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-100 border-2 border-blue-600 rounded"></div>
            <span>Deployment</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-yellow-400 border-2 border-yellow-600 rounded animate-pulse"></div>
            <span className="font-semibold">New (last 10 min)</span>
          </div>
        </div>
        </div>
      )}
      
      <div style={{ height: isFullScreen ? 'calc(100% - 20px)' : 'calc(100% - 80px)', width: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          attributionPosition="bottom-left"
          style={{ width: '100%', height: '100%' }}
        >
          <Background color="#aaa" gap={16} />
          <Controls />
          <MiniMap 
            nodeColor={(node) => {
              if (node.id.startsWith('service-')) return '#22C55E'
              if (node.id.startsWith('deployment-')) return '#3B82F6'
              return '#gray'
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
            pannable
            zoomable
          />
        </ReactFlow>
      </div>
    </div>
  )
}






'use client'

import { useState, useEffect } from 'react'
import { X, Loader2, Copy, Check } from 'lucide-react'

interface ResourceDetailModalProps {
  isOpen: boolean
  onClose: () => void
  resourceType: 'deployment' | 'service' | 'pod' | 'configmap' | 'cronjob' | 'job' | 'node' | null
  namespace: string
  name: string
  apiUrl: string
}

export default function ResourceDetailModal({
  isOpen,
  onClose,
  resourceType,
  namespace,
  name,
  apiUrl,
}: ResourceDetailModalProps) {
  const [resource, setResource] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'yaml' | 'events'>('overview')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (isOpen && resourceType && namespace && name) {
      fetchResourceDetails()
    }
  }, [isOpen, resourceType, namespace, name])

  const fetchResourceDetails = async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      // Handle special cases for resource type endpoints
      let endpoint = ''
      if (resourceType === 'cronjob') {
        endpoint = `${apiUrl}/k8s/cronjobs/${namespace}/${name}`
      } else if (resourceType === 'job') {
        endpoint = `${apiUrl}/k8s/jobs/${namespace}/${name}`
      } else if (resourceType === 'node') {
        // Nodes are cluster-scoped; fetch all and pick by name
        endpoint = `${apiUrl}/k8s/nodes`
      } else {
        endpoint = `${apiUrl}/k8s/${resourceType}s/${namespace}/${name}`
      }
      
      const response = await fetch(endpoint)
      const data = await response.json()
      
      if (data.success) {
        if (resourceType === 'node') {
          const node = (data.nodes || []).find((n: any) => n.name === name)
          setResource(node || null)
        } else {
          setResource(data[resourceType!])
        }
      } else {
        setError(data.message || 'Failed to fetch resource details')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch resource details')
    } finally {
      setIsLoading(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatYAML = (obj: any): string => {
    // Simple YAML formatter - in production, use a proper YAML library
    return JSON.stringify(obj, null, 2)
  }

  const getServiceName = (): string => {
    if (!resource) return name
    // For services, use the service name
    if (resourceType === 'service') {
      return resource.metadata?.name || name
    }
    // For deployments, try to get service name from labels or use deployment name
    if (resourceType === 'deployment') {
      const labels = resource.metadata?.labels || {}
      // Common label patterns: app, app.kubernetes.io/name, service
      return labels['app.kubernetes.io/name'] || labels.app || labels.service || name
    }
    // For pods, try to get service name from labels
    if (resourceType === 'pod') {
      const labels = resource.metadata?.labels || {}
      return labels['app.kubernetes.io/name'] || labels.app || labels.service || name
    }
    return name
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={onClose}></div>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-6xl sm:w-full">
          <div className="bg-white">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {resourceType ? resourceType.charAt(0).toUpperCase() + resourceType.slice(1) : ''}: {name}
                </h3>
                <p className="text-sm text-gray-500 mt-1">Namespace: {namespace}</p>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200">
              <nav className="flex -mb-px">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`px-6 py-3 text-sm font-medium ${
                    activeTab === 'overview'
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveTab('yaml')}
                  className={`px-6 py-3 text-sm font-medium ${
                    activeTab === 'yaml'
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  YAML
                </button>
                <button
                  onClick={() => setActiveTab('events')}
                  className={`px-6 py-3 text-sm font-medium ${
                    activeTab === 'events'
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Events
                </button>
              </nav>
            </div>

            {/* Content */}
            <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                  <span className="ml-3 text-gray-500">Loading resource details...</span>
                </div>
              ) : error ? (
                <div className="py-12 text-center">
                  <p className="text-red-600">{error}</p>
                </div>
              ) : resource ? (
                <>
                  {activeTab === 'overview' && (
                    <div className="space-y-6">
                      {/* Metadata */}
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 mb-3">Metadata</h4>
                        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <span className="text-sm font-medium text-gray-500">Name:</span>
                              <p className="text-sm text-gray-900">{resource.metadata?.name}</p>
                            </div>
                            <div>
                              <span className="text-sm font-medium text-gray-500">Namespace:</span>
                              <p className="text-sm text-gray-900">{resource.metadata?.namespace}</p>
                            </div>
                            <div>
                              <span className="text-sm font-medium text-gray-500">UID:</span>
                              <p className="text-sm text-gray-900 font-mono text-xs">{resource.metadata?.uid}</p>
                            </div>
                            <div>
                              <span className="text-sm font-medium text-gray-500">Created:</span>
                              <p className="text-sm text-gray-900">
                                {resource.metadata?.creationTimestamp
                                  ? new Date(resource.metadata.creationTimestamp).toLocaleString()
                                  : 'N/A'}
                              </p>
                            </div>
                          </div>
                          {resource.metadata?.labels && Object.keys(resource.metadata.labels).length > 0 && (
                            <div className="mt-4">
                              <span className="text-sm font-medium text-gray-500">Labels:</span>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {Object.entries(resource.metadata.labels).map(([key, value]) => (
                                  <span
                                    key={key}
                                    className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded"
                                  >
                                    {key}={value as string}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {resource.metadata?.annotations && Object.keys(resource.metadata.annotations).length > 0 && (
                            <div className="mt-4">
                              <span className="text-sm font-medium text-gray-500">Annotations:</span>
                              <div className="mt-2 space-y-1">
                                {Object.entries(resource.metadata.annotations).map(([key, value]) => (
                                  <div key={key} className="text-xs">
                                    <span className="font-medium text-gray-700">{key}:</span>
                                    <span className="ml-2 text-gray-600">{value as string}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Resource-specific details */}
                      {resourceType === 'deployment' && resource.spec && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-3">Deployment Spec</h4>
                          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <span className="text-sm font-medium text-gray-500">Replicas:</span>
                                <p className="text-sm text-gray-900">
                                  {resource.status?.readyReplicas || 0} / {resource.spec.replicas || 0}
                                </p>
                              </div>
                              <div>
                                <span className="text-sm font-medium text-gray-500">Strategy:</span>
                                <p className="text-sm text-gray-900">{resource.spec.strategy?.type || 'RollingUpdate'}</p>
                              </div>
                            </div>
                            {resource.spec.template?.spec?.containers && (
                              <div className="mt-4">
                                <span className="text-sm font-medium text-gray-500">Containers:</span>
                                <div className="mt-2 space-y-3">
                                  {resource.spec.template.spec.containers.map((container: any, idx: number) => (
                                    <div key={idx} className="bg-white p-3 rounded border border-gray-200">
                                      <div className="font-medium text-sm text-gray-900">{container.name}</div>
                                      <div className="mt-1 text-xs text-gray-600 font-mono">{container.image}</div>
                                      {container.resources && (
                                        <div className="mt-2 text-xs text-gray-500">
                                          Resources: {JSON.stringify(container.resources)}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {resourceType === 'service' && resource.spec && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-3">Service Spec</h4>
                          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <span className="text-sm font-medium text-gray-500">Type:</span>
                                <p className="text-sm text-gray-900">{resource.spec.type || 'ClusterIP'}</p>
                              </div>
                              <div>
                                <span className="text-sm font-medium text-gray-500">Cluster IP:</span>
                                <p className="text-sm text-gray-900 font-mono">{resource.spec.clusterIP || 'N/A'}</p>
                              </div>
                            </div>
                            {resource.spec.ports && resource.spec.ports.length > 0 && (
                              <div className="mt-4">
                                <span className="text-sm font-medium text-gray-500">Ports:</span>
                                <div className="mt-2 space-y-2">
                                  {resource.spec.ports.map((port: any, idx: number) => (
                                    <div key={idx} className="bg-white p-2 rounded border border-gray-200 text-sm">
                                      {port.name && <span className="font-medium">{port.name}: </span>}
                                      {port.port} → {port.targetPort} ({port.protocol || 'TCP'})
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {resource.spec.selector && (
                              <div className="mt-4">
                                <span className="text-sm font-medium text-gray-500">Selector:</span>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {Object.entries(resource.spec.selector).map(([key, value]) => (
                                    <span
                                      key={key}
                                      className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded"
                                    >
                                      {key}={value as string}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {resourceType === 'pod' && resource.spec && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-3">Pod Spec</h4>
                          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <span className="text-sm font-medium text-gray-500">Status:</span>
                                <p className="text-sm text-gray-900">{resource.status?.phase || 'Unknown'}</p>
                              </div>
                              <div>
                                <span className="text-sm font-medium text-gray-500">Node:</span>
                                <p className="text-sm text-gray-900">{resource.spec.nodeName || 'N/A'}</p>
                              </div>
                            </div>
                            {resource.spec.containers && (
                              <div className="mt-4">
                                <span className="text-sm font-medium text-gray-500">Containers:</span>
                                <div className="mt-2 space-y-3">
                                  {resource.spec.containers.map((container: any, idx: number) => {
                                    const containerStatus = resource.status?.containerStatuses?.find(
                                      (cs: any) => cs.name === container.name
                                    )
                                    return (
                                      <div key={idx} className="bg-white p-3 rounded border border-gray-200">
                                        <div className="flex items-center justify-between">
                                          <div className="font-medium text-sm text-gray-900">{container.name}</div>
                                          <div className={`text-xs px-2 py-1 rounded ${
                                            containerStatus?.ready
                                              ? 'bg-green-100 text-green-800'
                                              : 'bg-red-100 text-red-800'
                                          }`}>
                                            {containerStatus?.ready ? 'Ready' : 'Not Ready'}
                                          </div>
                                        </div>
                                        <div className="mt-1 text-xs text-gray-600 font-mono">{container.image}</div>
                                        {containerStatus && (
                                          <div className="mt-2 text-xs text-gray-500">
                                            Restarts: {containerStatus.restartCount || 0}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {resourceType === 'configmap' && resource.data && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-3">ConfigMap Data</h4>
                          <div className="bg-gray-50 rounded-lg p-4">
                            <div className="space-y-3">
                              {Object.entries(resource.data).map(([key, value]) => (
                                <div key={key} className="bg-white p-3 rounded border border-gray-200">
                                  <div className="font-medium text-sm text-gray-900 mb-1">{key}</div>
                                  <pre className="text-xs text-gray-600 whitespace-pre-wrap break-words">
                                    {value as string}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'yaml' && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-gray-900">YAML Definition</h4>
                        <button
                          onClick={() => copyToClipboard(formatYAML(resource))}
                          className="flex items-center gap-2 px-3 py-1 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded hover:bg-gray-50"
                        >
                          {copied ? (
                            <>
                              <Check className="w-4 h-4" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" />
                              Copy
                            </>
                          )}
                        </button>
                      </div>
                      <pre className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto text-xs font-mono">
                        {formatYAML(resource)}
                      </pre>
                    </div>
                  )}

                  {activeTab === 'events' && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Events</h4>
                      <p className="text-gray-500 text-sm">Events will be loaded here...</p>
                    </div>
                  )}

                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


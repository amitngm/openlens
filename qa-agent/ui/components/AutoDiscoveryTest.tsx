'use client';

import { useState } from 'react';
import { 
  Scan,
  Globe,
  Server,
  Box,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  ExternalLink
} from 'lucide-react';
import clsx from 'clsx';

interface DiscoveryResult {
  url: string;
  connected: boolean;
  page_title?: string;
  ui_elements: Record<string, number>;
  detected_elements: Array<{ type: string; label: string; confidence: string }>;
  api_endpoints: string[];
  k8s_pods: Array<{ name: string; namespace: string; status: string; ready: boolean }>;
  k8s_services: Array<{ name: string; namespace: string; type: string; cluster_ip: string }>;
  error?: string;
}

// Get API base URL dynamically
const getApiBase = (): string => {
  if (typeof window === 'undefined') return '';
  if (window.location.port === '3000') return 'http://localhost:8080';
  return '';
};

export default function AutoDiscoveryTest() {
  const [url, setUrl] = useState('');
  const [namespaces, setNamespaces] = useState('default');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runDiscovery = async () => {
    if (!url) {
      setError('Please enter a URL');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`${getApiBase()}/live/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          namespaces: namespaces.split(',').map(n => n.trim()).filter(Boolean),
        }),
      });

      const data = await response.json();
      
      if (data.result) {
        setResult(data.result);
      } else {
        setError('Failed to get discovery results');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to QA Agent API');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-hub-text">Auto-Discovery</h1>
        <p className="text-sm text-hub-text-muted mt-1">
          Automatically discover UI elements, API endpoints, and Kubernetes resources
        </p>
      </div>

      {/* Input Section */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-hub-text mb-2">
              <Globe className="w-4 h-4 text-hub-blue" />
              Application URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-app.example.com"
              className="input"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-hub-text mb-2">
              <Server className="w-4 h-4 text-hub-blue" />
              Kubernetes Namespaces
            </label>
            <input
              type="text"
              value={namespaces}
              onChange={(e) => setNamespaces(e.target.value)}
              placeholder="default, production, staging"
              className="input"
            />
            <p className="text-xs text-hub-text-muted mt-1">Comma-separated list</p>
          </div>
        </div>

        <button
          onClick={runDiscovery}
          disabled={isLoading || !url}
          className={clsx(
            'btn btn-primary',
            (!url || isLoading) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Discovering...
            </>
          ) : (
            <>
              <Scan className="w-4 h-4" />
              Run Discovery
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="card bg-red-50 border-red-200 mb-6">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">Error</span>
          </div>
          <p className="text-sm text-red-600 mt-2">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Connection Status */}
          <div className={clsx(
            'card',
            result.connected ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
          )}>
            <div className="flex items-center gap-3">
              {result.connected ? (
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              ) : (
                <XCircle className="w-6 h-6 text-red-600" />
              )}
              <div>
                <p className={clsx(
                  'font-medium',
                  result.connected ? 'text-green-800' : 'text-red-800'
                )}>
                  {result.connected ? 'Connected Successfully' : 'Connection Failed'}
                </p>
                <p className="text-sm text-hub-text-muted">{result.url}</p>
                {result.page_title && (
                  <p className="text-sm text-hub-text mt-1">Title: {result.page_title}</p>
                )}
                {result.error && (
                  <p className="text-sm text-red-600 mt-1">{result.error}</p>
                )}
              </div>
            </div>
          </div>

          {/* UI Elements */}
          {result.connected && Object.keys(result.ui_elements).length > 0 && (
            <div className="card">
              <h3 className="text-sm font-medium text-hub-text mb-4">UI Elements Detected</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {Object.entries(result.ui_elements).map(([key, count]) => (
                  <div key={key} className="p-3 rounded-lg bg-gray-50 text-center">
                    <p className="text-2xl font-bold text-hub-blue">{count}</p>
                    <p className="text-xs text-hub-text-muted capitalize">{key}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detected Elements */}
          {result.detected_elements.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-medium text-hub-text mb-4">Detected Components</h3>
              <div className="space-y-2">
                {result.detected_elements.map((el, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-hub-text">{el.label}</span>
                    </div>
                    <span className={clsx(
                      'text-xs px-2 py-1 rounded',
                      el.confidence === 'high' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    )}>
                      {el.confidence} confidence
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* API Endpoints */}
          {result.api_endpoints.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-medium text-hub-text mb-4">API Endpoints Found</h3>
              <div className="space-y-2">
                {result.api_endpoints.map((endpoint, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 rounded bg-gray-50">
                    <ExternalLink className="w-4 h-4 text-hub-blue" />
                    <code className="text-sm text-hub-text">{endpoint}</code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Kubernetes Resources */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pods */}
            <div className="card">
              <h3 className="text-sm font-medium text-hub-text mb-4 flex items-center gap-2">
                <Box className="w-4 h-4 text-hub-blue" />
                Kubernetes Pods ({result.k8s_pods.length})
              </h3>
              {result.k8s_pods.length === 0 ? (
                <p className="text-sm text-hub-text-muted py-4 text-center">
                  No pods found (K8s access may not be configured)
                </p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {result.k8s_pods.map((pod, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded bg-gray-50">
                      <div>
                        <p className="text-sm font-medium text-hub-text">{pod.name}</p>
                        <p className="text-xs text-hub-text-muted">{pod.namespace}</p>
                      </div>
                      <span className={clsx(
                        'text-xs px-2 py-1 rounded',
                        pod.ready ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      )}>
                        {pod.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Services */}
            <div className="card">
              <h3 className="text-sm font-medium text-hub-text mb-4 flex items-center gap-2">
                <Server className="w-4 h-4 text-hub-blue" />
                Kubernetes Services ({result.k8s_services.length})
              </h3>
              {result.k8s_services.length === 0 ? (
                <p className="text-sm text-hub-text-muted py-4 text-center">
                  No services found (K8s access may not be configured)
                </p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {result.k8s_services.map((svc, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded bg-gray-50">
                      <div>
                        <p className="text-sm font-medium text-hub-text">{svc.name}</p>
                        <p className="text-xs text-hub-text-muted">{svc.namespace} • {svc.cluster_ip}</p>
                      </div>
                      <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">
                        {svc.type}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

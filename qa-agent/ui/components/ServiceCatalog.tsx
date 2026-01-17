'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Server, Globe, Database, Loader2, AlertCircle } from 'lucide-react';
import { api, ServiceCatalog as ServiceCatalogType } from '@/lib/api';
import clsx from 'clsx';

export default function ServiceCatalog() {
  const [catalog, setCatalog] = useState<ServiceCatalogType | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCatalog = async () => {
    try {
      const data = await api.getCatalog();
      setCatalog(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await api.triggerDiscovery();
      setCatalog(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh catalog');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, []);

  const getServiceIcon = (type: string) => {
    switch (type) {
      case 'ingress': return <Globe className="w-5 h-5" />;
      case 'database': return <Database className="w-5 h-5" />;
      default: return <Server className="w-5 h-5" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-electric animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Service Catalog</h2>
          <p className="text-sm text-zinc-500 mt-1">
            {catalog?.namespace ? `Namespace: ${catalog.namespace}` : 'Discovered services in the cluster'}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg',
            'bg-electric/10 text-electric border border-electric/30',
            'hover:bg-electric/20 transition-all',
            refreshing && 'opacity-50 cursor-not-allowed'
          )}
        >
          <RefreshCw className={clsx('w-4 h-4', refreshing && 'animate-spin')} />
          {refreshing ? 'Discovering...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="card border-danger/30 bg-danger/5">
          <div className="flex items-center gap-3 text-danger">
            <AlertCircle className="w-5 h-5" />
            <p>{error}</p>
          </div>
          <p className="text-sm text-zinc-500 mt-2">
            Make sure the QA Agent is running inside a Kubernetes cluster with proper RBAC permissions.
          </p>
        </div>
      ) : catalog?.services && catalog.services.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {catalog.services.map((service, idx) => (
            <div key={idx} className="card hover:border-electric/50 transition-all">
              <div className="flex items-start gap-3">
                <div className={clsx(
                  'p-2 rounded-lg',
                  service.type === 'ingress' && 'bg-purple-500/20 text-purple-400',
                  service.type === 'database' && 'bg-blue-500/20 text-blue-400',
                  service.type === 'service' && 'bg-neon/20 text-neon'
                )}>
                  {getServiceIcon(service.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-white truncate">{service.name}</h3>
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mt-0.5">
                    {service.type}
                  </p>
                </div>
              </div>

              {service.endpoints && service.endpoints.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate/30">
                  <p className="text-xs text-zinc-500 mb-2">Endpoints</p>
                  <div className="space-y-1">
                    {service.endpoints.slice(0, 3).map((ep, epIdx) => (
                      <p key={epIdx} className="text-xs font-mono text-zinc-400 truncate">
                        {ep}
                      </p>
                    ))}
                    {service.endpoints.length > 3 && (
                      <p className="text-xs text-zinc-600">
                        +{service.endpoints.length - 3} more
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <Server className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-zinc-400">No Services Discovered</h3>
          <p className="text-sm text-zinc-600 mt-1">
            Click refresh to discover services in the namespace
          </p>
        </div>
      )}

      {catalog?.discovered_at && (
        <p className="text-xs text-zinc-600 mt-4 text-right">
          Last updated: {new Date(catalog.discovered_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}

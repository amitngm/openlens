'use client';

import { useState, useEffect } from 'react';
import { 
  Server, 
  Check, 
  RefreshCw, 
  ChevronDown,
  Search,
  Loader2,
  AlertCircle
} from 'lucide-react';
import clsx from 'clsx';

interface Namespace {
  name: string;
  status: string;
}

interface NamespaceSelectorProps {
  selectedNamespaces: string[];
  onSelectionChange: (namespaces: string[]) => void;
}

// Get API base URL dynamically
const getApiBase = (): string => {
  if (typeof window === 'undefined') return '';
  if (window.location.port === '3000') return 'http://localhost:8080';
  return '';
};

export default function NamespaceSelector({ 
  selectedNamespaces, 
  onSelectionChange 
}: NamespaceSelectorProps) {
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const fetchNamespaces = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${getApiBase()}/namespaces`);
      if (response.ok) {
        const data = await response.json();
        setNamespaces(data.namespaces || []);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      setError('Failed to fetch namespaces. Make sure QA Agent API is running.');
      console.error('Namespace fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNamespaces();
  }, []);

  const toggleNamespace = (name: string) => {
    if (selectedNamespaces.includes(name)) {
      onSelectionChange(selectedNamespaces.filter(n => n !== name));
    } else {
      onSelectionChange([...selectedNamespaces, name]);
    }
  };

  const selectAll = () => {
    onSelectionChange(namespaces.map(n => n.name));
  };

  const clearAll = () => {
    onSelectionChange([]);
  };

  const filteredNamespaces = namespaces.filter(ns =>
    ns.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <label className="flex items-center gap-2 text-sm font-medium text-hub-text">
          <Server className="w-4 h-4 text-hub-blue" />
          Kubernetes Namespaces
        </label>
        <button
          onClick={fetchNamespaces}
          disabled={loading}
          className="p-1.5 rounded-lg text-hub-text-muted hover:text-hub-blue hover:bg-hub-blue-light transition-colors"
          title="Refresh namespaces"
        >
          <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Dropdown trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-lg
                 bg-white border border-hub-border hover:border-hub-blue transition-colors"
      >
        <span className="text-sm">
          {selectedNamespaces.length === 0 ? (
            <span className="text-hub-text-muted">Select namespaces...</span>
          ) : (
            <span className="text-hub-text font-medium">
              {selectedNamespaces.length} namespace{selectedNamespaces.length !== 1 ? 's' : ''} selected
            </span>
          )}
        </span>
        <ChevronDown className={clsx(
          'w-4 h-4 text-hub-text-muted transition-transform',
          isOpen && 'rotate-180'
        )} />
      </button>

      {/* Selected tags */}
      {selectedNamespaces.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {selectedNamespaces.map((ns) => (
            <span
              key={ns}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
                       bg-hub-blue-light text-hub-blue border border-hub-blue/30"
            >
              {ns}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleNamespace(ns);
                }}
                className="hover:text-hub-blue-dark ml-1"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown content */}
      {isOpen && (
        <div className="mt-2 rounded-lg border border-hub-border bg-white overflow-hidden shadow-lg">
          {/* Search */}
          <div className="p-2 border-b border-hub-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-hub-text-muted" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search namespaces..."
                className="input pl-9"
              />
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 p-2 border-b border-hub-border bg-gray-50">
            <button
              onClick={selectAll}
              className="px-3 py-1 text-xs rounded bg-white border border-hub-border text-hub-text-muted 
                       hover:text-hub-text hover:border-hub-blue transition-colors"
            >
              Select All
            </button>
            <button
              onClick={clearAll}
              className="px-3 py-1 text-xs rounded bg-white border border-hub-border text-hub-text-muted 
                       hover:text-hub-text hover:border-hub-blue transition-colors"
            >
              Clear All
            </button>
            <span className="ml-auto text-xs text-hub-text-muted py-1">
              {namespaces.length} total
            </span>
          </div>

          {/* Namespace list */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-hub-blue animate-spin" />
                <span className="ml-2 text-sm text-hub-text-muted">Loading namespaces...</span>
              </div>
            ) : filteredNamespaces.length === 0 ? (
              <div className="py-8 text-center text-hub-text-muted text-sm">
                {namespaces.length === 0 ? 'No namespaces found in cluster' : 'No matching namespaces'}
              </div>
            ) : (
              filteredNamespaces.map((ns) => (
                <button
                  key={ns.name}
                  onClick={() => toggleNamespace(ns.name)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                    selectedNamespaces.includes(ns.name)
                      ? 'bg-hub-blue-light text-hub-blue'
                      : 'text-hub-text hover:bg-gray-50'
                  )}
                >
                  <div className={clsx(
                    'w-4 h-4 rounded border flex items-center justify-center',
                    selectedNamespaces.includes(ns.name)
                      ? 'bg-hub-blue border-hub-blue'
                      : 'border-hub-border'
                  )}>
                    {selectedNamespaces.includes(ns.name) && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </div>
                  <span className="flex-1 text-sm font-medium">{ns.name}</span>
                  <span className={clsx(
                    'text-xs px-2 py-0.5 rounded',
                    ns.status === 'active' 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-yellow-100 text-yellow-700'
                  )}>
                    {ns.status}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-hub-text-muted mt-3">
        These namespaces will be used for service discovery and testing
      </p>
    </div>
  );
}

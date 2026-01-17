'use client';

import { useState, useEffect } from 'react';
import { 
  Server, 
  Check, 
  RefreshCw, 
  ChevronDown,
  Search,
  Loader2
} from 'lucide-react';
import clsx from 'clsx';

interface Namespace {
  name: string;
  status: 'active' | 'terminating';
  labels?: Record<string, string>;
}

interface NamespaceSelectorProps {
  selectedNamespaces: string[];
  onSelectionChange: (namespaces: string[]) => void;
}

export default function NamespaceSelector({ 
  selectedNamespaces, 
  onSelectionChange 
}: NamespaceSelectorProps) {
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const fetchNamespaces = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8080/namespaces');
      if (response.ok) {
        const data = await response.json();
        setNamespaces(data.namespaces || []);
      } else {
        // Demo mode - show sample namespaces
        setNamespaces([
          { name: 'default', status: 'active' },
          { name: 'kube-system', status: 'active' },
          { name: 'qa-agent', status: 'active' },
          { name: 'production', status: 'active' },
          { name: 'staging', status: 'active' },
          { name: 'development', status: 'active' },
          { name: 'monitoring', status: 'active' },
          { name: 'logging', status: 'active' },
        ]);
      }
    } catch {
      // Demo namespaces
      setNamespaces([
        { name: 'default', status: 'active' },
        { name: 'kube-system', status: 'active' },
        { name: 'qa-agent', status: 'active' },
        { name: 'production', status: 'active' },
        { name: 'staging', status: 'active' },
        { name: 'development', status: 'active' },
      ]);
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
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-400">
          <Server className="w-4 h-4" />
          Target Namespaces
        </label>
        <button
          onClick={fetchNamespaces}
          disabled={loading}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-slate/50 transition-colors"
        >
          <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Dropdown trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-lg
                 bg-slate/30 border border-slate/50 hover:border-electric/50 transition-colors"
      >
        <span className="text-sm">
          {selectedNamespaces.length === 0 ? (
            <span className="text-zinc-500">Select namespaces...</span>
          ) : (
            <span className="text-white">
              {selectedNamespaces.length} namespace{selectedNamespaces.length !== 1 ? 's' : ''} selected
            </span>
          )}
        </span>
        <ChevronDown className={clsx(
          'w-4 h-4 text-zinc-500 transition-transform',
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
                       bg-electric/20 text-electric border border-electric/30"
            >
              {ns}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleNamespace(ns);
                }}
                className="hover:text-white"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown content */}
      {isOpen && (
        <div className="mt-2 rounded-lg border border-slate/50 bg-obsidian overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-slate/30">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search namespaces..."
                className="w-full pl-9 pr-3 py-2 rounded bg-slate/30 border border-slate/50
                         text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-electric"
              />
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 p-2 border-b border-slate/30">
            <button
              onClick={selectAll}
              className="px-3 py-1 text-xs rounded bg-slate/30 text-zinc-400 
                       hover:text-white hover:bg-slate/50 transition-colors"
            >
              Select All
            </button>
            <button
              onClick={clearAll}
              className="px-3 py-1 text-xs rounded bg-slate/30 text-zinc-400 
                       hover:text-white hover:bg-slate/50 transition-colors"
            >
              Clear All
            </button>
          </div>

          {/* Namespace list */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-electric animate-spin" />
              </div>
            ) : filteredNamespaces.length === 0 ? (
              <div className="py-8 text-center text-zinc-500 text-sm">
                No namespaces found
              </div>
            ) : (
              filteredNamespaces.map((ns) => (
                <button
                  key={ns.name}
                  onClick={() => toggleNamespace(ns.name)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                    selectedNamespaces.includes(ns.name)
                      ? 'bg-electric/10 text-electric'
                      : 'text-zinc-400 hover:bg-slate/30 hover:text-white'
                  )}
                >
                  <div className={clsx(
                    'w-4 h-4 rounded border flex items-center justify-center',
                    selectedNamespaces.includes(ns.name)
                      ? 'bg-electric border-electric'
                      : 'border-zinc-600'
                  )}>
                    {selectedNamespaces.includes(ns.name) && (
                      <Check className="w-3 h-3 text-midnight" />
                    )}
                  </div>
                  <span className="flex-1 text-sm">{ns.name}</span>
                  <span className={clsx(
                    'text-xs px-2 py-0.5 rounded',
                    ns.status === 'active' 
                      ? 'bg-neon/20 text-neon' 
                      : 'bg-warning/20 text-warning'
                  )}>
                    {ns.status}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-600 mt-3">
        Select which Kubernetes namespaces to monitor and test
      </p>
    </div>
  );
}

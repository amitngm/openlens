'use client';

import { useState } from 'react';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Loader2,
  ChevronRight,
  Search,
  Filter
} from 'lucide-react';
import clsx from 'clsx';

interface Run {
  id: string;
  flow_name: string;
  status: string;
  env: string;
  tenant: string;
  started_at: string;
  duration_ms?: number;
}

interface RunHistoryProps {
  onSelectRun: (runId: string) => void;
}

// Mock data - in real app this would come from API
const mockRuns: Run[] = [
  {
    id: 'run-001-abc',
    flow_name: 'health-check',
    status: 'completed',
    env: 'dev',
    tenant: 'test-tenant',
    started_at: new Date(Date.now() - 3600000).toISOString(),
    duration_ms: 4523,
  },
  {
    id: 'run-002-def',
    flow_name: 'public-ip-allocation',
    status: 'failed',
    env: 'staging',
    tenant: 'qa-tenant',
    started_at: new Date(Date.now() - 7200000).toISOString(),
    duration_ms: 12340,
  },
  {
    id: 'run-003-ghi',
    flow_name: 'health-check',
    status: 'running',
    env: 'dev',
    tenant: 'test-tenant',
    started_at: new Date(Date.now() - 60000).toISOString(),
  },
];

export default function RunHistory({ onSelectRun }: RunHistoryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-neon" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-danger" />;
      case 'running':
        return <Loader2 className="w-4 h-4 text-electric animate-spin" />;
      default:
        return <Clock className="w-4 h-4 text-warning" />;
    }
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '...';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  const filteredRuns = mockRuns.filter(run => {
    const matchesSearch = run.flow_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         run.tenant.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || run.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Run History</h2>
          <p className="text-sm text-zinc-500 mt-1">View past test executions and results</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by flow or tenant..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate/30 border border-slate/50
                     text-white placeholder-zinc-600 focus:outline-none focus:border-electric
                     transition-colors"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-zinc-500" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate/30 border border-slate/50
                     text-white focus:outline-none focus:border-electric transition-colors"
          >
            <option value="all">All Status</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
          </select>
        </div>
      </div>

      {/* Run List */}
      {filteredRuns.length > 0 ? (
        <div className="space-y-2">
          {filteredRuns.map((run) => (
            <button
              key={run.id}
              onClick={() => onSelectRun(run.id)}
              className="w-full card flex items-center gap-4 hover:border-electric/50 transition-all group"
            >
              {getStatusIcon(run.status)}
              
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white group-hover:text-electric transition-colors">
                    {run.flow_name}
                  </span>
                  <span className={clsx(
                    'px-2 py-0.5 rounded text-xs font-medium uppercase',
                    run.env === 'prod' && 'bg-danger/20 text-danger',
                    run.env === 'staging' && 'bg-warning/20 text-warning',
                    run.env === 'dev' && 'bg-neon/20 text-neon'
                  )}>
                    {run.env}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {run.tenant} · {formatTime(run.started_at)}
                </p>
              </div>

              <div className="text-right">
                <p className={clsx(
                  'text-sm font-medium capitalize',
                  run.status === 'completed' && 'text-neon',
                  run.status === 'failed' && 'text-danger',
                  run.status === 'running' && 'text-electric'
                )}>
                  {run.status}
                </p>
                <p className="text-xs text-zinc-500">{formatDuration(run.duration_ms)}</p>
              </div>

              <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-electric group-hover:translate-x-1 transition-all" />
            </button>
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <Clock className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-zinc-400">No Runs Found</h3>
          <p className="text-sm text-zinc-600 mt-1">
            {searchTerm || statusFilter !== 'all' 
              ? 'Try adjusting your filters'
              : 'Start a test flow to see run history'}
          </p>
        </div>
      )}
    </div>
  );
}

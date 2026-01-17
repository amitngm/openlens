'use client';

import { useState } from 'react';
import { X, Play, AlertTriangle, CheckCircle } from 'lucide-react';
import type { Flow, RunRequest } from '@/lib/api';
import { api } from '@/lib/api';
import clsx from 'clsx';

interface RunModalProps {
  flow: Flow;
  onClose: () => void;
  onRunStarted: (runId: string) => void;
}

export default function RunModal({ flow, onClose, onRunStarted }: RunModalProps) {
  const [env, setEnv] = useState('dev');
  const [tenant, setTenant] = useState('');
  const [project, setProject] = useState('');
  const [testTenant, setTestTenant] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!tenant.trim()) {
      setError('Tenant is required');
      return;
    }

    if (!testTenant) {
      setError('Test tenant flag must be enabled for safety');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const request: RunRequest = {
        flow_name: flow.name,
        env,
        tenant: tenant.trim(),
        project: project.trim() || undefined,
        variables: {
          testTenant: true,
        },
      };

      const response = await api.startRun(request);
      onRunStarted(response.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start run');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-midnight/80 backdrop-blur-sm">
      <div className="w-full max-w-lg card border-electric/30 glow-electric">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-white">Run Test Flow</h2>
            <p className="text-sm text-zinc-500 mt-1">{flow.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-slate/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Environment */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              Environment
            </label>
            <div className="flex gap-2">
              {['dev', 'staging', 'prod'].map((e) => (
                <button
                  key={e}
                  onClick={() => setEnv(e)}
                  className={clsx(
                    'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all',
                    env === e
                      ? e === 'prod'
                        ? 'bg-danger/20 text-danger border border-danger/50'
                        : 'bg-electric/20 text-electric border border-electric/50'
                      : 'bg-slate/30 text-zinc-400 border border-slate/50 hover:border-zinc-500'
                  )}
                >
                  {e.toUpperCase()}
                </button>
              ))}
            </div>
            {env === 'prod' && (
              <p className="mt-2 text-xs text-danger flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Production environment requires allowlist flag
              </p>
            )}
          </div>

          {/* Tenant */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              Tenant <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              placeholder="e.g., test-tenant-001"
              className="w-full px-4 py-2 rounded-lg bg-slate/30 border border-slate/50
                       text-white placeholder-zinc-600 focus:outline-none focus:border-electric
                       transition-colors"
            />
          </div>

          {/* Project (optional) */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              Project <span className="text-zinc-600">(optional)</span>
            </label>
            <input
              type="text"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="e.g., my-project"
              className="w-full px-4 py-2 rounded-lg bg-slate/30 border border-slate/50
                       text-white placeholder-zinc-600 focus:outline-none focus:border-electric
                       transition-colors"
            />
          </div>

          {/* Test Tenant Guard */}
          <div className="flex items-center gap-3 p-4 rounded-lg bg-neon/10 border border-neon/30">
            <input
              type="checkbox"
              id="testTenant"
              checked={testTenant}
              onChange={(e) => setTestTenant(e.target.checked)}
              className="w-4 h-4 rounded border-neon/50 text-neon focus:ring-neon"
            />
            <label htmlFor="testTenant" className="flex-1">
              <span className="block text-sm font-medium text-neon">Test Tenant Mode</span>
              <span className="block text-xs text-zinc-400 mt-0.5">
                Confirms this is a test account (required for safety)
              </span>
            </label>
            <CheckCircle className="w-5 h-5 text-neon" />
          </div>

          {/* Error */}
          {error && (
            <div className="p-4 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-lg border border-slate/50 text-zinc-400
                     hover:text-white hover:border-zinc-500 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleRun}
            disabled={loading || !testTenant}
            className={clsx(
              'flex-1 py-3 px-4 rounded-lg font-semibold flex items-center justify-center gap-2',
              'bg-gradient-to-r from-electric to-neon text-midnight',
              'hover:shadow-lg hover:shadow-electric/30 transition-all duration-200',
              (loading || !testTenant) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-midnight/30 border-t-midnight rounded-full animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run Test
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

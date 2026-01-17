'use client';

import { useEffect, useState } from 'react';
import { 
  X, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Loader2, 
  Download,
  Image,
  FileText,
  FileJson
} from 'lucide-react';
import { api, RunResponse, Artifact } from '@/lib/api';
import clsx from 'clsx';

interface RunStatusProps {
  runId: string;
  onClose: () => void;
}

export default function RunStatus({ runId, onClose }: RunStatusProps) {
  const [run, setRun] = useState<RunResponse | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    const fetchStatus = async () => {
      try {
        const runData = await api.getRun(runId);
        setRun(runData);
        setError(null);

        // Fetch artifacts if run is completed
        if (runData.status === 'completed' || runData.status === 'failed') {
          try {
            const artifactData = await api.getArtifacts(runId);
            setArtifacts(artifactData);
          } catch {
            // Artifacts may not exist
          }
        }

        // Stop polling if run is complete
        if (runData.status === 'completed' || runData.status === 'failed') {
          clearInterval(interval);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch run status');
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
    interval = setInterval(fetchStatus, 2000);

    return () => clearInterval(interval);
  }, [runId]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'passed':
        return <CheckCircle className="w-5 h-5 text-neon" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-danger" />;
      case 'running':
        return <Loader2 className="w-5 h-5 text-electric animate-spin" />;
      default:
        return <Clock className="w-5 h-5 text-warning" />;
    }
  };

  const getArtifactIcon = (type: string) => {
    if (type.includes('image') || type.includes('screenshot')) {
      return <Image className="w-4 h-4" />;
    }
    if (type.includes('json')) {
      return <FileJson className="w-4 h-4" />;
    }
    return <FileText className="w-4 h-4" />;
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-midnight/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[80vh] overflow-hidden card border-electric/30">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {run && getStatusIcon(run.status)}
            <div>
              <h2 className="text-xl font-semibold text-white">Run Status</h2>
              <p className="text-sm text-zinc-500 font-mono">{runId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-slate/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading && !run ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-electric animate-spin" />
          </div>
        ) : error ? (
          <div className="p-4 rounded-lg bg-danger/10 border border-danger/30 text-danger">
            {error}
          </div>
        ) : run ? (
          <div className="space-y-6 overflow-y-auto max-h-[60vh] pr-2">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-slate/30 border border-slate/50">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">Status</p>
                <p className={clsx(
                  'text-lg font-semibold capitalize mt-1',
                  run.status === 'completed' && 'text-neon',
                  run.status === 'failed' && 'text-danger',
                  run.status === 'running' && 'text-electric'
                )}>
                  {run.status}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-slate/30 border border-slate/50">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">Flow</p>
                <p className="text-lg font-semibold text-white mt-1">{run.flow_name}</p>
              </div>
              <div className="p-4 rounded-lg bg-slate/30 border border-slate/50">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">Duration</p>
                <p className="text-lg font-semibold text-white mt-1">
                  {run.result ? formatDuration(run.result.duration_ms) : '...'}
                </p>
              </div>
            </div>

            {/* Progress */}
            {run.result && (
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-zinc-400">Progress</span>
                  <span className="text-zinc-400">
                    {run.result.passed_steps}/{run.result.total_steps} steps passed
                  </span>
                </div>
                <div className="h-2 bg-slate/50 rounded-full overflow-hidden">
                  <div
                    className={clsx(
                      'h-full transition-all duration-500',
                      run.result.failed_steps > 0 
                        ? 'bg-gradient-to-r from-neon to-danger'
                        : 'bg-gradient-to-r from-electric to-neon'
                    )}
                    style={{
                      width: `${(run.result.passed_steps / run.result.total_steps) * 100}%`
                    }}
                  />
                </div>
              </div>
            )}

            {/* Stage Results */}
            {run.result?.stages && (
              <div>
                <h3 className="text-sm font-medium text-zinc-400 mb-3">Stages</h3>
                <div className="space-y-2">
                  {run.result.stages.map((stage, idx) => (
                    <div
                      key={idx}
                      className={clsx(
                        'p-3 rounded-lg border',
                        stage.status === 'passed' && 'bg-neon/5 border-neon/30',
                        stage.status === 'failed' && 'bg-danger/5 border-danger/30',
                        stage.status === 'running' && 'bg-electric/5 border-electric/30',
                        stage.status === 'pending' && 'bg-slate/30 border-slate/50'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(stage.status)}
                          <span className="font-medium text-white">{stage.name}</span>
                        </div>
                        <span className="text-xs text-zinc-500">
                          {stage.steps?.length || 0} steps
                        </span>
                      </div>
                      
                      {/* Step details on failure */}
                      {stage.status === 'failed' && stage.steps && (
                        <div className="mt-2 pl-7 space-y-1">
                          {stage.steps.filter(s => s.status === 'failed').map((step, stepIdx) => (
                            <div key={stepIdx} className="text-sm text-danger">
                              <span className="font-mono">{step.name}</span>
                              {step.error && (
                                <p className="text-xs text-zinc-500 mt-0.5">{step.error}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Artifacts */}
            {artifacts.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-zinc-400 mb-3">Artifacts</h3>
                <div className="grid grid-cols-2 gap-2">
                  {artifacts.map((artifact, idx) => (
                    <a
                      key={idx}
                      href={artifact.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg bg-slate/30 border border-slate/50
                               hover:border-electric/50 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-electric/10 text-electric">
                        {getArtifactIcon(artifact.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate group-hover:text-electric">
                          {artifact.name}
                        </p>
                        <p className="text-xs text-zinc-500">{artifact.type}</p>
                      </div>
                      <Download className="w-4 h-4 text-zinc-500 group-hover:text-electric" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Close button */}
        <div className="mt-6 pt-4 border-t border-slate/30">
          <button
            onClick={onClose}
            className="w-full py-3 px-4 rounded-lg border border-slate/50 text-zinc-400
                     hover:text-white hover:border-zinc-500 transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

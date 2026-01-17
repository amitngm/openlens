'use client';

import { Play, Code, Globe, Server, ChevronRight } from 'lucide-react';
import type { Flow } from '@/lib/api';

interface FlowCardProps {
  flow: Flow;
  onRun: (flow: Flow) => void;
}

function countStepTypes(flow: Flow) {
  const counts = { ui: 0, api: 0, k8s: 0 };
  flow.stages?.forEach(stage => {
    stage.steps?.forEach(step => {
      if (step.type in counts) {
        counts[step.type as keyof typeof counts]++;
      }
    });
  });
  return counts;
}

export default function FlowCard({ flow, onRun }: FlowCardProps) {
  const stepCounts = countStepTypes(flow);
  const totalSteps = stepCounts.ui + stepCounts.api + stepCounts.k8s;
  
  return (
    <div className="card group hover:shadow-lg transition-all duration-200">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-hub-blue-light rounded-lg flex items-center justify-center">
            <span className="text-hub-blue font-semibold">
              {flow.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h3 className="text-base font-semibold text-hub-text group-hover:text-hub-blue transition-colors">
              {flow.name}
            </h3>
            <p className="text-xs text-hub-text-muted">v{flow.version}</p>
          </div>
        </div>
        <button
          onClick={() => onRun(flow)}
          className="btn btn-primary py-1.5 px-3 text-sm"
        >
          <Play className="w-4 h-4" />
          Run
        </button>
      </div>
      
      <p className="text-sm text-hub-text-muted mb-4 line-clamp-2">
        {flow.description || 'No description provided'}
      </p>

      {/* Step type badges */}
      <div className="flex items-center gap-2 mb-4">
        {stepCounts.ui > 0 && (
          <span className="badge badge-info">
            <Globe className="w-3 h-3 mr-1" />
            {stepCounts.ui} UI
          </span>
        )}
        {stepCounts.api > 0 && (
          <span className="badge badge-warning">
            <Code className="w-3 h-3 mr-1" />
            {stepCounts.api} API
          </span>
        )}
        {stepCounts.k8s > 0 && (
          <span className="badge badge-neutral">
            <Server className="w-3 h-3 mr-1" />
            {stepCounts.k8s} K8s
          </span>
        )}
      </div>

      {/* Stages preview */}
      <div className="border-t border-hub-border pt-4">
        <div className="flex items-center justify-between text-xs text-hub-text-muted">
          <span>{flow.stages?.length || 0} stages · {totalSteps} steps</span>
          <ChevronRight className="w-4 h-4 group-hover:text-hub-blue group-hover:translate-x-1 transition-all" />
        </div>
      </div>
    </div>
  );
}

'use client';

import { Play, Code, Globe, Server, ChevronRight } from 'lucide-react';
import type { Flow } from '@/lib/api';

interface FlowCardProps {
  flow: Flow;
  onRun: (flow: Flow) => void;
}

function getStepTypeIcon(type: string) {
  switch (type) {
    case 'ui': return <Globe className="w-3 h-3" />;
    case 'api': return <Code className="w-3 h-3" />;
    case 'k8s': return <Server className="w-3 h-3" />;
    default: return <Code className="w-3 h-3" />;
  }
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
    <div className="card group hover:border-electric/50 transition-all duration-300">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white group-hover:text-electric transition-colors">
            {flow.name}
          </h3>
          <p className="text-sm text-zinc-500 mt-1">v{flow.version}</p>
        </div>
        <button
          onClick={() => onRun(flow)}
          className="p-2 rounded-lg bg-electric/10 text-electric border border-electric/30
                     hover:bg-electric hover:text-midnight transition-all duration-200
                     group-hover:glow-electric"
        >
          <Play className="w-5 h-5" />
        </button>
      </div>
      
      <p className="text-sm text-zinc-400 mb-4 line-clamp-2">
        {flow.description || 'No description provided'}
      </p>

      {/* Step type badges */}
      <div className="flex items-center gap-2 mb-4">
        {stepCounts.ui > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium
                         bg-purple-500/20 text-purple-400 border border-purple-500/30">
            <Globe className="w-3 h-3" />
            {stepCounts.ui} UI
          </span>
        )}
        {stepCounts.api > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium
                         bg-blue-500/20 text-blue-400 border border-blue-500/30">
            <Code className="w-3 h-3" />
            {stepCounts.api} API
          </span>
        )}
        {stepCounts.k8s > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium
                         bg-orange-500/20 text-orange-400 border border-orange-500/30">
            <Server className="w-3 h-3" />
            {stepCounts.k8s} K8s
          </span>
        )}
      </div>

      {/* Stages preview */}
      <div className="border-t border-slate/30 pt-4">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>{flow.stages?.length || 0} stages · {totalSteps} steps</span>
          <ChevronRight className="w-4 h-4 group-hover:text-electric group-hover:translate-x-1 transition-all" />
        </div>
      </div>
    </div>
  );
}

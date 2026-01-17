'use client';

import { 
  Play, 
  FileCode, 
  Server, 
  History, 
  Settings,
  Zap,
  Activity,
  Wand2,
  Layers,
  Scan,
  Eye
} from 'lucide-react';
import clsx from 'clsx';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  apiStatus: 'healthy' | 'unhealthy' | 'loading';
}

const navItems = [
  { id: 'live', label: 'Live Testing', icon: Eye, highlight: true },
  { id: 'autodiscover', label: 'Auto-Discover', icon: Scan },
  { id: 'smart', label: 'Smart Test', icon: Wand2 },
  { id: 'flows', label: 'Test Flows', icon: FileCode },
  { id: 'runs', label: 'Run History', icon: History },
  { id: 'catalog', label: 'Service Catalog', icon: Server },
  { id: 'namespaces', label: 'Namespaces', icon: Layers },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ activeTab, onTabChange, apiStatus }: SidebarProps) {
  return (
    <aside className="w-64 bg-obsidian/60 backdrop-blur-md border-r border-slate/30 flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-slate/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-electric to-neon flex items-center justify-center">
            <Zap className="w-6 h-6 text-midnight" />
          </div>
          <div>
            <h1 className="text-lg font-display font-bold text-white">QA Agent</h1>
            <p className="text-xs text-zinc-500">Test Automation</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          
          const isHighlight = 'highlight' in item && item.highlight;
          
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={clsx(
                'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
                'font-medium text-sm',
                isActive
                  ? isHighlight
                    ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-400 border border-purple-500/30'
                    : 'bg-electric/10 text-electric border border-electric/30 glow-electric'
                  : isHighlight
                    ? 'text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 border border-transparent hover:border-purple-500/20'
                    : 'text-zinc-400 hover:text-white hover:bg-slate/30'
              )}
            >
              <Icon className="w-5 h-5" />
              {item.label}
              {isHighlight && !isActive && (
                <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                  AI
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Quick Run Button */}
      <div className="p-4 border-t border-slate/30">
        <button
          onClick={() => onTabChange('flows')}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg
                     bg-gradient-to-r from-electric to-neon text-midnight font-semibold
                     hover:shadow-lg hover:shadow-electric/30 transition-all duration-200"
        >
          <Play className="w-5 h-5" />
          Run Test
        </button>
      </div>

      {/* API Status */}
      <div className="p-4 border-t border-slate/30">
        <div className="flex items-center gap-2 text-sm">
          <Activity className={clsx(
            'w-4 h-4',
            apiStatus === 'healthy' && 'text-neon',
            apiStatus === 'unhealthy' && 'text-danger',
            apiStatus === 'loading' && 'text-warning animate-pulse'
          )} />
          <span className="text-zinc-500">API Status:</span>
          <span className={clsx(
            'font-medium',
            apiStatus === 'healthy' && 'text-neon',
            apiStatus === 'unhealthy' && 'text-danger',
            apiStatus === 'loading' && 'text-warning'
          )}>
            {apiStatus === 'healthy' ? 'Connected' : apiStatus === 'unhealthy' ? 'Disconnected' : 'Checking...'}
          </span>
        </div>
      </div>
    </aside>
  );
}

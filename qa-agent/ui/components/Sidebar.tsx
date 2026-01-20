'use client';

import { 
  Play, 
  FileCode, 
  Server, 
  History, 
  Settings,
  Activity,
  Wand2,
  Layers,
  Scan,
  Eye,
  Box,
  ChevronDown,
  Search,
  Bell,
  HelpCircle,
  User,
  FileText
} from 'lucide-react';
import clsx from 'clsx';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  apiStatus: 'healthy' | 'unhealthy' | 'loading';
}

const navItems = [
  { id: 'live', label: 'Live Testing', icon: Eye },
  { id: 'autodiscover', label: 'Auto-Discover', icon: Scan },
  { id: 'smart', label: 'Smart Test', icon: Wand2 },
  { id: 'flows', label: 'Test Flows', icon: FileCode },
  { id: 'runs', label: 'Run History', icon: History },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'catalog', label: 'Service Catalog', icon: Server },
  { id: 'namespaces', label: 'Namespaces', icon: Layers },
];

export default function Sidebar({ activeTab, onTabChange, apiStatus }: SidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Top Navigation Bar */}
      <header className="bg-hub-nav h-14 flex items-center justify-between px-4 fixed top-0 left-0 right-0 z-50">
        <div className="flex items-center gap-6">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-hub-blue rounded flex items-center justify-center">
              <Box className="w-5 h-5 text-white" />
            </div>
            <span className="text-white font-semibold text-lg">QA Agent</span>
          </div>
          
          {/* Main Nav */}
          <nav className="hidden md:flex items-center gap-1">
            <button className="px-3 py-1.5 text-white/80 hover:text-white text-sm font-medium rounded hover:bg-white/10 transition-colors">
              Explore
            </button>
            <button className="px-3 py-1.5 text-white text-sm font-medium bg-white/10 rounded">
              My Hub
            </button>
          </nav>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="hidden md:flex items-center bg-white/10 rounded px-3 py-1.5 gap-2">
            <Search className="w-4 h-4 text-white/60" />
            <input 
              type="text" 
              placeholder="Search..." 
              className="bg-transparent border-none text-white text-sm placeholder:text-white/60 focus:outline-none w-48"
            />
            <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white/10 rounded text-[10px] text-white/60">
              ⌘K
            </kbd>
          </div>
          
          <button className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors">
            <HelpCircle className="w-5 h-5" />
          </button>
          <button className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors">
            <Bell className="w-5 h-5" />
          </button>
          
          {/* User menu */}
          <button className="flex items-center gap-2 p-1 hover:bg-white/10 rounded transition-colors">
            <div className="w-8 h-8 bg-hub-blue rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-white" />
            </div>
          </button>
        </div>
      </header>

      {/* Sidebar */}
      <aside className="w-60 bg-hub-sidebar border-r border-hub-border flex flex-col fixed left-0 top-14 bottom-0 overflow-y-auto z-40">
        {/* User/Org Selector */}
        <div className="p-4 border-b border-hub-border">
          <button className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <div className="w-8 h-8 bg-hub-blue rounded flex items-center justify-center">
              <span className="text-white font-semibold text-sm">QA</span>
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-medium text-hub-text">QA Agent</div>
              <div className="text-xs text-hub-text-muted">Personal</div>
            </div>
            <ChevronDown className="w-4 h-4 text-hub-text-muted" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === 'reports' 
                ? pathname === '/reports'
                : activeTab === item.id;
              
              const content = (
                <>
                  <Icon className="w-4 h-4" />
                  {item.label}
                </>
              );
              
              if (item.id === 'reports') {
                return (
                  <Link
                    key={item.id}
                    href="/reports"
                    className={clsx(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm',
                      isActive
                        ? 'bg-hub-blue text-white font-medium'
                        : 'text-hub-text hover:bg-gray-100'
                    )}
                  >
                    {content}
                  </Link>
                );
              }
              
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm',
                    isActive
                      ? 'bg-hub-blue text-white font-medium'
                      : 'text-hub-text hover:bg-gray-100'
                  )}
                >
                  {content}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="border-t border-hub-border my-4" />

          {/* Settings Section */}
          <div className="space-y-1">
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm',
                activeTab === 'settings'
                  ? 'bg-hub-blue text-white font-medium'
                  : 'text-hub-text hover:bg-gray-100'
              )}
            >
              <Settings className="w-4 h-4" />
              <span className="flex-1 text-left">Settings</span>
              <ChevronDown className={clsx(
                'w-4 h-4 transition-transform',
                settingsOpen && 'rotate-180'
              )} />
            </button>
            
            {settingsOpen && (
              <div className="ml-7 space-y-1">
                <button 
                  onClick={() => onTabChange('settings')}
                  className="w-full text-left px-3 py-1.5 text-sm text-hub-text-muted hover:text-hub-text rounded hover:bg-gray-50"
                >
                  General
                </button>
                <button className="w-full text-left px-3 py-1.5 text-sm text-hub-text-muted hover:text-hub-text rounded hover:bg-gray-50">
                  Notifications
                </button>
              </div>
            )}
          </div>
        </nav>

        {/* API Status - Bottom */}
        <div className="p-4 border-t border-hub-border bg-white">
          <div className="flex items-center gap-2 text-sm">
            <Activity className={clsx(
              'w-4 h-4',
              apiStatus === 'healthy' && 'text-hub-success',
              apiStatus === 'unhealthy' && 'text-hub-danger',
              apiStatus === 'loading' && 'text-hub-warning animate-pulse'
            )} />
            <span className="text-hub-text-muted">API:</span>
            <span className={clsx(
              'font-medium',
              apiStatus === 'healthy' && 'text-hub-success',
              apiStatus === 'unhealthy' && 'text-hub-danger',
              apiStatus === 'loading' && 'text-hub-warning'
            )}>
              {apiStatus === 'healthy' ? 'Connected' : apiStatus === 'unhealthy' ? 'Offline' : 'Checking...'}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}

'use client'

import { useState, useEffect } from 'react'
import { 
  LayoutDashboard, 
  GitPullRequest, 
  Settings, 
  Shield, 
  Package, 
  Zap,
  ChevronDown,
  ChevronRight,
  Activity,
  FileText,
  Server,
  X,
  Menu,
  TestTube
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

interface SidebarProps {
  activeTab: 'jira' | 'k8s' | 'admin' | 'automation' | 'github' | 'releases' | 'qa-automation'
  onTabChange: (tab: 'jira' | 'k8s' | 'admin' | 'automation' | 'github' | 'releases' | 'qa-automation') => void
  isMobileOpen?: boolean
  onMobileToggle?: () => void
}

export default function Sidebar({ activeTab, onTabChange, isMobileOpen, onMobileToggle }: SidebarProps) {
  const { hasRole } = useAuth()
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    resources: true,
    management: false,
  })
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  const handleTabClick = (tab: 'jira' | 'k8s' | 'admin' | 'automation' | 'github' | 'releases' | 'qa-automation') => {
    onTabChange(tab)
    if (isMobile && onMobileToggle) {
      onMobileToggle()
    }
  }

  const isViewer = !hasRole('admin') && !hasRole('manager')
  const isManager = hasRole('manager') && !hasRole('admin')
  const isAdmin = hasRole('admin')

  const menuItems = [
    {
      id: 'jira',
      label: 'Jira Issues',
      icon: GitPullRequest,
      section: 'resources',
      roles: ['admin', 'manager', 'user']
    },
    {
      id: 'github',
      label: 'GitHub PRs',
      icon: GitPullRequest,
      section: 'resources',
      roles: ['admin', 'manager', 'user']
    },
    {
      id: 'releases',
      label: 'Release Notes',
      icon: FileText,
      section: 'resources',
      roles: ['admin', 'manager', 'user']
    },
    {
      id: 'qa-automation',
      label: 'QA Automation',
      icon: TestTube,
      section: 'resources',
      roles: ['admin', 'manager', 'user']
    },
    {
      id: 'k8s',
      label: 'Kubernetes',
      icon: Server,
      section: 'management',
      roles: ['admin', 'manager']
    },
    {
      id: 'automation',
      label: 'Automation',
      icon: Zap,
      section: 'management',
      roles: ['admin']
    },
    {
      id: 'admin',
      label: 'Admin Panel',
      icon: Shield,
      section: 'management',
      roles: ['admin']
    },
  ]

  const canAccess = (roles: string[]) => {
    if (isAdmin) return true
    if (isManager) return roles.includes('manager') || roles.includes('user')
    return roles.includes('user')
  }

  const resourcesItems = menuItems.filter(item => item.section === 'resources' && canAccess(item.roles))
  const managementItems = menuItems.filter(item => item.section === 'management' && canAccess(item.roles))

  return (
    <>
      {/* Mobile Overlay */}
      {isMobile && isMobileOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={onMobileToggle}
        />
      )}
      
      {/* Sidebar */}
      <div className={`
        h-screen w-64 bg-gradient-to-b from-gray-900 via-gray-900 to-gray-950 text-white flex flex-col fixed left-0 top-0 z-50
        transform transition-transform duration-300 ease-in-out shadow-2xl
        ${isMobile && !isMobileOpen ? '-translate-x-full' : 'translate-x-0'}
        lg:translate-x-0
        border-r border-gray-800/50
      `}>
        {/* Logo Section */}
        <div className="p-4 lg:p-6 border-b border-gray-800/50 flex items-center justify-between bg-gray-900/50 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-500 via-primary-600 to-primary-700 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-primary-500/20">
              <span className="text-white font-bold text-sm">FL</span>
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-base lg:text-lg truncate leading-tight">FlowLens</span>
              <span className="text-xs text-gray-400 font-medium">v1.0.0</span>
            </div>
          </div>
          {isMobile && (
            <button
              onClick={onMobileToggle}
              className="lg:hidden p-1.5 hover:bg-gray-800/50 rounded-lg transition-all duration-200 hover:scale-110"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-4">
        {/* Resources Section */}
        {resourcesItems.length > 0 && (
          <div className="mb-2">
            <button
              onClick={() => toggleSection('resources')}
              className="w-full px-6 py-2.5 flex items-center justify-between text-gray-400 hover:text-white hover:bg-gray-800/50 transition-all duration-200 rounded-lg mx-2"
            >
              <span className="text-xs font-bold uppercase tracking-widest">RESOURCES</span>
              <div className="transition-transform duration-200">
                {expandedSections.resources ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </div>
            </button>
            {expandedSections.resources && (
              <div className="mt-1 space-y-1 px-2">
                {resourcesItems.map((item) => {
                  const Icon = item.icon
                  const isActive = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleTabClick(item.id as any)}
                      className={`sidebar-item rounded-lg ${
                        isActive
                          ? 'bg-gradient-to-r from-primary-600/20 to-primary-500/10 text-white border-l-4 border-primary-400 shadow-lg shadow-primary-500/10'
                          : 'text-gray-300 hover:bg-gray-800/50 hover:text-white'
                      }`}
                    >
                      <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-primary-400' : ''}`} />
                      <span className="truncate font-medium">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Management Section */}
        {managementItems.length > 0 && (
          <div className="mb-2">
            <button
              onClick={() => toggleSection('management')}
              className="w-full px-6 py-2.5 flex items-center justify-between text-gray-400 hover:text-white hover:bg-gray-800/50 transition-all duration-200 rounded-lg mx-2"
            >
              <span className="text-xs font-bold uppercase tracking-widest">MANAGEMENT</span>
              <div className="transition-transform duration-200">
                {expandedSections.management ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </div>
            </button>
            {expandedSections.management && (
              <div className="mt-1 space-y-1 px-2">
                {managementItems.map((item) => {
                  const Icon = item.icon
                  const isActive = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleTabClick(item.id as any)}
                      className={`sidebar-item rounded-lg ${
                        isActive
                          ? 'bg-gradient-to-r from-primary-600/20 to-primary-500/10 text-white border-l-4 border-primary-400 shadow-lg shadow-primary-500/10'
                          : 'text-gray-300 hover:bg-gray-800/50 hover:text-white'
                      }`}
                    >
                      <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-primary-400' : ''}`} />
                      <span className="truncate font-medium">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Build Version */}
      <div className="p-4 border-t border-gray-800/50 mt-auto bg-gray-900/30 backdrop-blur-sm">
        <div className="flex items-center justify-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <p className="text-xs text-gray-400 font-medium">System Online</p>
        </div>
        <p className="text-xs text-gray-500 text-center mt-1">FlowLens v1.0.0</p>
      </div>
    </div>
    </>
  )
}


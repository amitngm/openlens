'use client'

import { useState } from 'react'
import { Bell, ChevronDown, Menu, Settings } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

interface AppHeaderProps {
  onMenuClick?: () => void
  onSettingsClick?: () => void
}

export default function AppHeader({ onMenuClick, onSettingsClick }: AppHeaderProps) {
  const { user, logout, hasRole } = useAuth()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const isAdmin = hasRole('admin')

  return (
    <header className="h-14 lg:h-16 bg-white/95 backdrop-blur-md border-b border-gray-200/80 flex items-center justify-between px-4 lg:px-6 fixed top-0 left-0 lg:left-64 right-0 z-30 shadow-sm">
      {/* Left Section - Menu Button (Mobile) and Welcome */}
      <div className="flex items-center gap-3 lg:gap-6">
        {/* Mobile Menu Button */}
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95"
          aria-label="Toggle menu"
        >
          <Menu className="w-5 h-5 text-gray-700" />
        </button>
        <div className="flex items-center gap-2 lg:gap-3">
          <div className="flex flex-col">
            <span className="text-sm lg:text-base font-medium text-gray-600 leading-tight">
              Welcome back,
            </span>
            <span className="text-base lg:text-xl font-bold text-gray-900 truncate">
              {user?.username || 'User'}
            </span>
          </div>
        </div>
      </div>

      {/* Right Section - Actions */}
      <div className="flex items-center gap-2 lg:gap-3">
        {/* Settings Button - Only for Admin */}
        {isAdmin && onSettingsClick && (
          <button 
            onClick={onSettingsClick}
            className="p-2 lg:p-2.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95 relative group"
            aria-label="Settings"
            title="Integration Settings"
          >
            <Settings className="w-4 h-4 lg:w-5 lg:h-5" />
            <span className="absolute inset-0 rounded-lg bg-primary-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></span>
          </button>
        )}
        
        {/* Notifications */}
        <button 
          className="p-2 lg:p-2.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95 relative group"
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4 lg:w-5 lg:h-5" />
          <span className="absolute top-1 right-1 lg:top-1.5 lg:right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white"></span>
          <span className="absolute inset-0 rounded-lg bg-primary-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></span>
        </button>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 p-1 lg:p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 group"
            aria-label="User menu"
          >
            <div className="w-8 h-8 lg:w-9 lg:h-9 bg-gradient-to-br from-primary-500 to-primary-600 rounded-full flex items-center justify-center text-white text-xs lg:text-sm font-bold flex-shrink-0 shadow-md shadow-primary-500/20 ring-2 ring-white">
              {user?.username?.charAt(0).toUpperCase() || 'U'}
            </div>
            <ChevronDown className={`w-3 h-3 lg:w-4 lg:h-4 hidden sm:inline transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`} />
          </button>
          {showUserMenu && (
            <>
              <div 
                className="fixed inset-0 z-40"
                onClick={() => setShowUserMenu(false)}
              />
              <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-xl border border-gray-200/80 py-2 z-50 animate-scale-in backdrop-blur-sm">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-900 truncate">{user?.username || 'User'}</p>
                  <p className="text-xs text-gray-500 mt-0.5 capitalize">{user?.role || 'User'}</p>
                </div>
                <button
                  onClick={() => {
                    logout()
                    setShowUserMenu(false)
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors duration-150 font-medium"
                >
                  Logout
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}


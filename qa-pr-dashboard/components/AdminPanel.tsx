'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { User, UserRole } from '@/types'
import { X, Plus, Edit2, Trash2, Save, Loader2, Shield, UserCircle, Eye, Info, AlertCircle, Server, Copy, CheckCircle2 } from 'lucide-react'
import RoleManagement from './RoleManagement'
import { Role, ROLE_PERMISSIONS } from '@/types/permissions'

interface AdminPanelProps {
  apiUrl: string
}

type TabType = 'users' | 'roles' | 'kubeconfigs' | 'settings' | 'search-history' | 'activities' | 'access-grants'

export default function AdminPanel({ apiUrl }: AdminPanelProps) {
  const { user: currentUser, token, hasRole } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newUser, setNewUser] = useState({
    username: '',
    email: '',
    password: '',
    role: 'viewer' as UserRole,
  })
  const [activeTab, setActiveTab] = useState<TabType>('users')
  const [allKubeconfigs, setAllKubeconfigs] = useState<any[]>([])
  const [allSettings, setAllSettings] = useState<any[]>([])
  const [allSearchHistory, setAllSearchHistory] = useState<any[]>([])
  const [allActivities, setAllActivities] = useState<any[]>([])
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [copied, setCopied] = useState(false)
  const [accessGrants, setAccessGrants] = useState<any[]>([])
  const [showGrantModal, setShowGrantModal] = useState(false)
  const [newGrant, setNewGrant] = useState({
    userId: '',
    resource: 'kubernetes' as 'kubernetes' | 'admin' | 'automation' | 'flows',
    startTime: '',
    endTime: '',
    reason: '',
  })

  // Define role flags early (before RBAC check)
  const isAdmin = hasRole('admin')
  const isManager = hasRole('manager') && !hasRole('admin')

  const handleCopyApiUrl = () => {
    navigator.clipboard.writeText(apiUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Define loadUsers with useCallback to make it stable for useEffect dependency
  const loadUsers = useCallback(async () => {
    // Don't attempt to load users if user is not admin
    if (!isAdmin) {
      setError(null)
      setIsLoading(false)
      setUsers([])
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      if (!token) {
        throw new Error('Authentication token is missing. Please log in again.')
      }

      const response = await fetch(`${apiUrl}/users`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        
        if (response.status === 401) {
          throw new Error('Authentication failed. Please log in again.')
        } else if (response.status === 403) {
          // If we get 403, it means the user doesn't have admin role
          // This shouldn't happen if isAdmin check worked, but handle it gracefully
          console.warn('Received 403 when loading users - user may not have admin role')
          setError(null) // Don't show error for permission issues - UI will show access restricted message
          setUsers([])
          setIsLoading(false)
          return
        } else if (response.status === 404) {
          throw new Error('Users endpoint not found. Please check API server configuration.')
        } else {
          throw new Error(errorData.message || errorData.error || `Failed to load users (${response.status})`)
        }
      }

      const data = await response.json()
      
      if (!data.success) {
        throw new Error(data.error || data.message || 'Failed to load users')
      }
      
      setUsers(data.users || [])
    } catch (err: any) {
      console.error('Error loading users:', err)
      // Only set error if it's not a permission issue
      if (!err.message?.includes('Access denied') && !err.message?.includes('Admin role required')) {
        setError(err.message || 'Failed to load users')
      } else {
        setError(null) // Clear error for permission issues
      }
    } finally {
      setIsLoading(false)
    }
  }, [apiUrl, isAdmin, token])

  useEffect(() => {
    // Only load users if user is admin and has token
    // Managers should not see users tab content, so don't attempt to load
    if (isAdmin && token) {
      loadUsers()
    } else {
      // Clear any previous errors and set loading to false
      setError(null)
      setIsLoading(false)
      setUsers([]) // Clear users array for non-admins
    }
  }, [isAdmin, token, loadUsers])

  const loadAllKubeconfigs = async () => {
    setIsLoadingData(true)
    try {
      const response = await fetch(`${apiUrl}/admin/kubeconfigs`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setAllKubeconfigs(data.kubeconfigs || [])
      }
    } catch (err: any) {
      setError('Failed to load kubeconfigs')
    } finally {
      setIsLoadingData(false)
    }
  }

  const loadAllSettings = async () => {
    setIsLoadingData(true)
    try {
      const response = await fetch(`${apiUrl}/admin/user-settings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setAllSettings(data.allSettings || [])
      }
    } catch (err: any) {
      setError('Failed to load user settings')
    } finally {
      setIsLoadingData(false)
    }
  }

  const loadAllSearchHistory = async () => {
    setIsLoadingData(true)
    try {
      const response = await fetch(`${apiUrl}/admin/search-history`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setAllSearchHistory(data.allHistory || [])
      }
    } catch (err: any) {
      setError('Failed to load search history')
    } finally {
      setIsLoadingData(false)
    }
  }

  const loadAllActivities = async () => {
    setIsLoadingData(true)
    try {
      const response = await fetch(`${apiUrl}/admin/activities`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setAllActivities(data.allActivities || [])
      }
    } catch (err: any) {
      setError('Failed to load activities')
    } finally {
      setIsLoadingData(false)
    }
  }

  const loadAccessGrants = async () => {
    if (!isAdmin || !token) return
    setIsLoadingData(true)
    setError(null)
    try {
      const response = await fetch(`${apiUrl}/access-grants`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setAccessGrants(data.grants || [])
        }
      }
    } catch (err: any) {
      setError('Failed to load access grants')
    } finally {
      setIsLoadingData(false)
    }
  }

  const createAccessGrant = async () => {
    if (!token) return
    setIsLoadingData(true)
    setError(null)
    try {
      const response = await fetch(`${apiUrl}/access-grants`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newGrant),
      })
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setSuccess('Access grant created successfully')
          setShowGrantModal(false)
          setNewGrant({ userId: '', resource: 'kubernetes', startTime: '', endTime: '', reason: '' })
          loadAccessGrants()
        }
      } else {
        const error = await response.json()
        setError(error.error || 'Failed to create access grant')
      }
    } catch (err: any) {
      setError('Failed to create access grant')
    } finally {
      setIsLoadingData(false)
    }
  }

  const revokeAccessGrant = async (grantId: string) => {
    if (!token) return
    if (!confirm('Are you sure you want to revoke this access grant?')) return
    setIsLoadingData(true)
    setError(null)
    try {
      const response = await fetch(`${apiUrl}/access-grants/${grantId}/revoke`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Revoked by admin' }),
      })
      if (response.ok) {
        setSuccess('Access grant revoked successfully')
        loadAccessGrants()
      } else {
        const error = await response.json()
        setError(error.error || 'Failed to revoke access grant')
      }
    } catch (err: any) {
      setError('Failed to revoke access grant')
    } finally {
      setIsLoadingData(false)
    }
  }

  const deleteAccessGrant = async (grantId: string) => {
    if (!token) return
    if (!confirm('Are you sure you want to delete this access grant? This action cannot be undone.')) return
    setIsLoadingData(true)
    setError(null)
    try {
      const response = await fetch(`${apiUrl}/access-grants/${grantId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      if (response.ok) {
        setSuccess('Access grant deleted successfully')
        loadAccessGrants()
      } else {
        const error = await response.json()
        setError(error.error || 'Failed to delete access grant')
      }
    } catch (err: any) {
      setError('Failed to delete access grant')
    } finally {
      setIsLoadingData(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'kubeconfigs') loadAllKubeconfigs()
    if (activeTab === 'settings') loadAllSettings()
    if (activeTab === 'search-history') loadAllSearchHistory()
    if (activeTab === 'activities') loadAllActivities()
    if (activeTab === 'access-grants') loadAccessGrants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  const handleCreateUser = async () => {
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch(`${apiUrl}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(newUser),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create user')
      }

      setSuccess('User created successfully')
      setShowCreateModal(false)
      setNewUser({ username: '', email: '', password: '', role: 'viewer' })
      await loadUsers()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to create user')
    }
  }

  const handleUpdateUser = async (userId: string, updates: Partial<User>) => {
    if (!isAdmin) {
      setError('Only admins can update users')
      return
    }
    
    // Protect default admin user from role changes
    const userToUpdate = users.find(u => u.id === userId)
    if (userToUpdate && userToUpdate.username === 'admin' && updates.role && updates.role !== 'admin') {
      setError('Cannot change role of the default admin user. The admin user must always maintain admin privileges.')
      return
    }
    
    // Prevent non-admins from creating/updating admin users
    if (updates.role === 'admin' && !isAdmin) {
      setError('Only admins can assign admin role')
      return
    }
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch(`${apiUrl}/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update user')
      }

      setSuccess('User updated successfully')
      setEditingUser(null)
      await loadUsers()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to update user')
    }
  }

  const handleDeleteUser = async (userId: string) => {
    if (!isAdmin) {
      setError('Only admins can delete users')
      return
    }
    
    // Protect default admin user from deletion
    const userToDelete = users.find(u => u.id === userId)
    if (userToDelete && userToDelete.username === 'admin') {
      setError('Cannot delete the default admin user. The admin user is required for system access.')
      return
    }
    if (!confirm('Are you sure you want to delete this user?')) return

    setError(null)
    setSuccess(null)
    try {
      const response = await fetch(`${apiUrl}/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete user')
      }

      setSuccess('User deleted successfully')
      await loadUsers()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to delete user')
    }
  }

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return <Shield className="w-4 h-4 text-red-600" />
      case 'manager':
        return <UserCircle className="w-4 h-4 text-blue-600" />
      case 'viewer':
        return <Eye className="w-4 h-4 text-gray-600" />
      default:
        return null
    }
  }

  const getRoleBadgeColor = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return 'bg-red-100 text-red-800'
      case 'manager':
        return 'bg-blue-100 text-blue-800'
      case 'viewer':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  // RBAC: Only admins and managers can access admin panel
  if (!hasRole('admin') && !hasRole('manager')) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
        <p className="text-gray-600">You need admin or manager privileges to access this panel.</p>
      </div>
    )
  }

  // All tabs are visible, but with role-based restrictions
  const allTabs: TabType[] = isAdmin 
    ? ['users', 'roles', 'kubeconfigs', 'settings', 'search-history', 'activities', 'access-grants']
    : ['kubeconfigs', 'settings', 'search-history', 'activities']
  
  // Tab labels
  const tabLabels: Record<TabType, string> = {
    'users': 'Users',
    'roles': 'Roles & Permissions',
    'kubeconfigs': 'All Kubeconfigs',
    'settings': 'All Settings',
    'search-history': 'Search History',
    'activities': 'All Activities',
    'access-grants': 'Access Grants',
  }
  
  // Role descriptions for each tab
  const roleDescriptions: Record<TabType, { admin: string; manager: string }> = {
    'users': {
      admin: 'Full user management - Create, edit, delete users',
      manager: 'Admin only - User management restricted'
    },
    'roles': {
      admin: 'Manage roles and permissions - Industry-standard RBAC',
      manager: 'Admin only - Role management restricted'
    },
    'kubeconfigs': {
      admin: 'View all kubeconfigs across all users',
      manager: 'View all kubeconfigs (read-only)'
    },
    'settings': {
      admin: 'View all user settings and configurations',
      manager: 'View all user settings (read-only)'
    },
    'search-history': {
      admin: 'View all user search history',
      manager: 'View all user search history (read-only)'
    },
    'activities': {
      admin: 'View all user activities and actions',
      manager: 'View all user activities (read-only)'
    },
    'access-grants': {
      admin: 'Manage time-based access grants - Grant temporary access to resources',
      manager: 'Admin only - Access grant management restricted'
    },
  }
  
  // Get tab permissions
  const getTabPermission = (tab: TabType) => {
    switch (tab) {
      case 'users':
        return { canView: isAdmin, canEdit: isAdmin, description: isAdmin ? 'Full user management' : 'Admin only - View access denied' }
      case 'roles':
        return { canView: isAdmin, canEdit: isAdmin, description: isAdmin ? 'Role and permission management' : 'Admin only - Role management restricted' }
      case 'kubeconfigs':
        return { canView: true, canEdit: false, description: 'View all kubeconfigs (read-only)' }
      case 'settings':
        return { canView: true, canEdit: false, description: 'View all user settings (read-only)' }
      case 'search-history':
        return { canView: true, canEdit: false, description: 'View all search history (read-only)' }
      case 'activities':
        return { canView: true, canEdit: false, description: 'View all user activities (read-only)' }
      case 'access-grants':
        return { canView: isAdmin, canEdit: isAdmin, description: isAdmin ? 'Manage time-based access grants' : 'Admin only - Access grant management restricted' }
      default:
        return { canView: false, canEdit: false, description: 'No access' }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-gray-900">Admin Panel</h2>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
              isAdmin 
                ? 'bg-red-100 text-red-800' 
                : 'bg-blue-100 text-blue-800'
            }`}>
              {isAdmin ? 'Full Access' : 'View Only'}
            </span>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            {isAdmin 
              ? 'Manage users and view all user data' 
              : 'View user data and settings (read-only)'}
          </p>
          
          {/* API URL Display */}
          <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-50 to-primary-100/50 border border-primary-200 rounded-lg shadow-sm">
            <Server className="w-4 h-4 text-primary-600 flex-shrink-0" />
            <span className="text-xs font-semibold text-gray-700">API URL:</span>
            <code className="text-sm font-mono text-primary-700 bg-white/60 px-2 py-1 rounded border border-primary-200/50">
              {apiUrl}
            </code>
            <button
              onClick={handleCopyApiUrl}
              className="p-1.5 hover:bg-primary-200/50 rounded-md transition-all duration-200 hover:scale-110 active:scale-95"
              title="Copy API URL"
              aria-label="Copy API URL"
            >
              {copied ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4 text-primary-600" />
              )}
            </button>
          </div>
        </div>
        {activeTab === 'users' && isAdmin && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add User
          </button>
        )}
      </div>

      {/* Tabs - All tabs visible with role-based indicators */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {allTabs.map((tab) => {
            const permission = getTabPermission(tab)
            const isDisabled = !permission.canView
            const tabLabel = tabLabels[tab] || tab
            const roleDesc = roleDescriptions[tab]
            const tooltipText = roleDesc 
              ? (isAdmin ? roleDesc.admin : roleDesc.manager)
              : ''
            
            return (
              <button
                key={tab}
                onClick={() => {
                  // Allow clicking even if restricted - will show access denied message
                  if (typeof setActiveTab === 'function') {
                    setActiveTab(tab)
                  }
                }}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : isDisabled
                    ? 'border-transparent text-gray-400 hover:text-gray-500'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
                title={tooltipText}
              >
                <span className="flex items-center gap-2">
                  {tabLabel}
                  {(tab === 'users' || tab === 'roles') && !isAdmin && (
                    <span title="Admin Only" aria-label="Admin only access">
                      <Shield className="w-3 h-3 text-red-500" aria-hidden="true" />
                    </span>
                  )}
                  {tab !== 'users' && tab !== 'roles' && isManager && (
                    <span title="Read Only" aria-label="Read only access">
                      <Eye className="w-3 h-3 text-blue-500" aria-hidden="true" />
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </nav>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-md">
          {success}
        </div>
      )}

      {/* Role-based info banner */}
      {isManager && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-md flex items-center gap-2">
          <Shield className="w-5 h-5" />
          <span className="text-sm">
            <strong>Manager Access:</strong> You have read-only access to user data. User management (create, edit, delete) requires admin privileges.
          </span>
        </div>
      )}

      {/* Users Tab - All roles can see tab, but content is restricted */}
      {activeTab === 'users' && (
        <>
          {!isAdmin ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
              <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Restricted</h3>
              <p className="text-gray-600 mb-4">
                User management is restricted to administrators only.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left max-w-2xl mx-auto">
                <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                  <Info className="w-5 h-5" />
                  Manager Permissions
                </h4>
                <p className="text-sm text-blue-800 mb-2">
                  As a <strong>Manager</strong>, you can:
                </p>
                <ul className="list-disc list-inside text-sm text-blue-700 space-y-1 mb-2">
                  <li>View all kubeconfigs across all users</li>
                  <li>View all user settings and configurations</li>
                  <li>View all search history</li>
                  <li>View all user activities</li>
                </ul>
                <p className="text-sm text-blue-800">
                  <strong>Restricted:</strong> User management (create, edit, delete) requires <strong>Admin</strong> privileges.
                </p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              <span className="ml-3 text-gray-500">Loading users...</span>
            </div>
          ) : error && isAdmin ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center">
              <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-red-900 mb-2">Failed to Load Users</h3>
              <p className="text-red-700 mb-4">{error}</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => loadUsers()}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                >
                  Retry
                </button>
                <button
                  onClick={() => {
                    setError(null)
                    window.location.reload()
                  }}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                >
                  Reload Page
                </button>
              </div>
            </div>
          ) : users.length === 0 && isAdmin ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
              <UserCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Users Found</h3>
              <p className="text-gray-600 mb-4">No users have been created yet.</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Create First User
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Login
                </th>
                {isAdmin && (
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {Array.isArray(users) && users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center">
                        <UserCircle className="w-6 h-6 text-gray-600" />
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{user.username}</div>
                        {user.id === currentUser?.id && (
                          <div className="text-xs text-blue-600">(You)</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{user.email}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(user.role)}`}>
                      {getRoleIcon(user.role)}
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditingUser(user)}
                          className="text-blue-600 hover:text-blue-900"
                          title="Edit user"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {user.id !== currentUser?.id && user.username !== 'admin' && (
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            className="text-red-600 hover:text-red-900"
                            title="Delete user"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        {user.username === 'admin' && (
                          <span className="text-xs text-gray-400" title="Default admin user cannot be deleted">
                            <Shield className="w-4 h-4" />
                          </span>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          )}
        </>
      )}

      {/* Roles & Permissions Tab - Admin only */}
      {activeTab === 'roles' && (
        <>
          {!isAdmin ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
              <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Restricted</h3>
              <p className="text-gray-600">
                Role and permission management is restricted to administrators only.
              </p>
            </div>
          ) : (
            <RoleManagement 
              apiUrl={apiUrl}
              users={users}
              onUserUpdate={loadUsers}
            />
          )}
        </>
      )}

      {/* All Kubeconfigs Tab - Admin and Manager (Read-only) */}
      {activeTab === 'kubeconfigs' && (
        <div className="space-y-4">
          {isManager && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-600" />
              <span className="text-sm text-blue-800">
                <strong>Read-only access:</strong> You can view all kubeconfigs but cannot modify them.
              </span>
            </div>
          )}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {isLoadingData ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <span className="ml-3 text-gray-500">Loading kubeconfigs...</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {Array.isArray(allKubeconfigs) && allKubeconfigs.map((kc) => (
                      <tr key={kc.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {kc.user?.username || kc.userId}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{kc.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            kc.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {kc.isActive ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(kc.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {allKubeconfigs.length === 0 && (
                  <div className="text-center py-12 text-gray-500">No kubeconfigs found</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* All Settings Tab - Admin and Manager (Read-only) */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          {isManager && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-600" />
              <span className="text-sm text-blue-800">
                <strong>Read-only access:</strong> You can view all user settings but cannot modify them.
              </span>
            </div>
          )}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {isLoadingData ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              <span className="ml-3 text-gray-500">Loading settings...</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Jira Label</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Jira Project</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kubeconfig</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Array.isArray(allSettings) && allSettings.map((s) => {
                    const settings = s.settings || {}
                    const userRole = s.user?.role || 'unknown'
                    const isManager = userRole === 'manager'
                    return (
                      <tr key={s.userId} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div className="flex items-center">
                            {getRoleIcon(userRole as UserRole)}
                            <span className="ml-2">{s.user?.username || s.userId}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded-full text-xs ${getRoleBadgeColor(userRole as UserRole)}`}>
                            {userRole}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {settings.jiraLabel ? (
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                              {settings.jiraLabel}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {settings.jiraProjectKey ? (
                            <span className="font-mono text-xs">{settings.jiraProjectKey}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {settings.kubeconfig ? (
                            <div className="max-w-xs">
                              <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                                Configured
                              </span>
                              <details className="mt-1">
                                <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800">
                                  View kubeconfig
                                </summary>
                                <pre className="mt-2 text-xs bg-gray-50 p-2 rounded overflow-auto max-h-40 border">
                                  {settings.kubeconfig.substring(0, 500)}
                                  {settings.kubeconfig.length > 500 ? '...' : ''}
                                </pre>
                              </details>
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {allSettings.length === 0 && (
                <div className="text-center py-12 text-gray-500">No user settings found</div>
              )}
            </div>
          )}
          </div>
        </div>
      )}

      {/* Search History Tab - Admin and Manager (Read-only) */}
      {activeTab === 'search-history' && (
        <div className="space-y-4">
          {isManager && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-600" />
              <span className="text-sm text-blue-800">
                <strong>Read-only access:</strong> You can view all search history but cannot modify it.
              </span>
            </div>
          )}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {isLoadingData ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              <span className="ml-3 text-gray-500">Loading search history...</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Query</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Array.isArray(allSearchHistory) && allSearchHistory.map((h, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {h.user?.username || h.userId}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{h.query}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{h.type}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(h.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {allSearchHistory.length === 0 && (
                <div className="text-center py-12 text-gray-500">No search history found</div>
              )}
            </div>
          )}
          </div>
        </div>
      )}

      {/* All Activities Tab - Admin and Manager (Read-only) */}
      {activeTab === 'access-grants' && isAdmin && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Time-Based Access Grants</h2>
              <p className="text-sm text-gray-600 mt-1">Grant temporary access to Kubernetes Management and other resources</p>
            </div>
            <button
              onClick={() => setShowGrantModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Grant Access
            </button>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {isLoadingData ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <span className="ml-3 text-gray-500">Loading access grants...</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resource</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Start Time</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">End Time</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Granted By</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {accessGrants.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                          No access grants found
                        </td>
                      </tr>
                    ) : (
                      accessGrants.map((grant) => {
                        const now = new Date()
                        const start = new Date(grant.startTime)
                        const end = new Date(grant.endTime)
                        const isActive = grant.isActive && !grant.revokedAt && start <= now && end >= now
                        const isExpired = end < now
                        const isUpcoming = start > now
                        
                        return (
                          <tr key={grant.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{grant.username}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">{grant.resource}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{new Date(grant.startTime).toLocaleString()}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{new Date(grant.endTime).toLocaleString()}</td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {grant.revokedAt ? (
                                <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded">Revoked</span>
                              ) : isExpired ? (
                                <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded">Expired</span>
                              ) : isUpcoming ? (
                                <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded">Upcoming</span>
                              ) : isActive ? (
                                <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">Active</span>
                              ) : (
                                <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded">Inactive</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{grant.grantedByUsername}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              {!grant.revokedAt && isActive && (
                                <button
                                  onClick={() => revokeAccessGrant(grant.id)}
                                  className="text-red-600 hover:text-red-800 mr-3"
                                  title="Revoke access"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => deleteAccessGrant(grant.id)}
                                className="text-red-600 hover:text-red-800"
                                title="Delete grant"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {showGrantModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Grant Temporary Access</h3>
              <button onClick={() => setShowGrantModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">User</label>
                <select
                  value={newGrant.userId}
                  onChange={(e) => setNewGrant({ ...newGrant, userId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="">Select a user</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.username} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Resource</label>
                <select
                  value={newGrant.resource}
                  onChange={(e) => setNewGrant({ ...newGrant, resource: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="kubernetes">Kubernetes Management</option>
                  <option value="admin">Admin Panel</option>
                  <option value="automation">Automation</option>
                  <option value="flows">Flow Tracing</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                <input
                  type="datetime-local"
                  value={newGrant.startTime}
                  onChange={(e) => setNewGrant({ ...newGrant, startTime: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                <input
                  type="datetime-local"
                  value={newGrant.endTime}
                  onChange={(e) => setNewGrant({ ...newGrant, endTime: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
                <input
                  type="text"
                  value={newGrant.reason}
                  onChange={(e) => setNewGrant({ ...newGrant, reason: e.target.value })}
                  placeholder="e.g., Temporary access for deployment"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={createAccessGrant}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Grant Access
                </button>
                <button
                  onClick={() => setShowGrantModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'activities' && (
        <div className="space-y-4">
          {isManager && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-600" />
              <span className="text-sm text-blue-800">
                <strong>Read-only access:</strong> You can view all user activities but cannot modify them.
              </span>
            </div>
          )}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {isLoadingData ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              <span className="ml-3 text-gray-500">Loading activities...</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resource</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Array.isArray(allActivities) && allActivities.map((a, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {a.user?.username || a.userId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">{a.action}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{a.resource}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-w-md">
                          {JSON.stringify(a.details, null, 2)}
                        </pre>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(a.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {allActivities.length === 0 && (
                <div className="text-center py-12 text-gray-500">No activities found</div>
              )}
            </div>
          )}
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={() => setShowCreateModal(false)}></div>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-6 py-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Create New User</h3>
                  <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-500">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                    <input
                      type="text"
                      value={newUser.username}
                      onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                    <input
                      type="password"
                      value={newUser.password}
                      onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                    <div className="space-y-2 max-h-96 overflow-y-auto border border-gray-200 rounded-lg p-2">
                      {[
                        { value: 'admin' as UserRole, label: 'Administrator', description: 'Full administrative access to all features and settings', icon: '👑', color: 'bg-orange-50 border-orange-200 text-orange-800' },
                        { value: 'manager' as UserRole, label: 'Manager', description: 'Management access for operational tasks and team coordination', icon: '👔', color: 'bg-blue-50 border-blue-200 text-blue-800' },
                        { value: 'viewer' as UserRole, label: 'Viewer', description: 'Read-only access to view resources and reports', icon: '👁️', color: 'bg-gray-50 border-gray-200 text-gray-800' },
                      ].map((roleOption) => (
                        <label
                          key={roleOption.value}
                          className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                            newUser.role === roleOption.value
                              ? `${roleOption.color} border-current shadow-md`
                              : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="userRole"
                            value={roleOption.value}
                            checked={newUser.role === roleOption.value}
                            onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                            className="mt-1 w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                            aria-label={`Select ${roleOption.label} role`}
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg" aria-hidden="true">{roleOption.icon}</span>
                              <span className="font-semibold text-sm">{roleOption.label}</span>
                            </div>
                            <p className="text-xs text-gray-600">{roleOption.description}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs text-blue-800 flex items-start gap-2">
                        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                        <span>
                          <strong>Note:</strong> These are the primary roles. Additional industry-standard roles (Super Admin, Developer, QA Engineer, Guest) can be assigned and managed via the <strong>Roles & Permissions</strong> tab after user creation.
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateUser}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Create User
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={() => setEditingUser(null)}></div>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-6 py-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Edit User</h3>
                  <button onClick={() => setEditingUser(null)} className="text-gray-400 hover:text-gray-500">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <EditUserForm
                  user={editingUser}
                  onSave={(updates) => {
                    handleUpdateUser(editingUser.id, updates)
                  }}
                  onCancel={() => setEditingUser(null)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EditUserForm({ user, onSave, onCancel }: { user: User; onSave: (updates: Partial<User>) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    username: user.username,
    email: user.email,
    password: '',
    role: user.role,
    isActive: user.isActive,
  })

  const isDefaultAdmin = user.username === 'admin'
  const roleOptions = [
    { value: 'admin' as UserRole, label: 'Administrator', description: 'Full administrative access to all features', icon: '👑', color: 'bg-orange-50 border-orange-200 text-orange-800' },
    { value: 'manager' as UserRole, label: 'Manager', description: 'Management access for operational tasks', icon: '👔', color: 'bg-blue-50 border-blue-200 text-blue-800' },
    { value: 'viewer' as UserRole, label: 'Viewer', description: 'Read-only access to resources', icon: '👁️', color: 'bg-gray-50 border-gray-200 text-gray-800' },
  ]

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Protect default admin user from role changes
    if (isDefaultAdmin && formData.role !== 'admin') {
      alert('Cannot change role of the default admin user. The admin user must always maintain admin privileges.')
      return
    }
    
    const updates: any = {
      username: formData.username,
      email: formData.email,
      role: formData.role,
      isActive: formData.isActive,
    }
    if (formData.password) {
      updates.password = formData.password
    }
    onSave(updates)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
        <input
          type="text"
          value={formData.username}
          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">New Password (leave blank to keep current)</label>
        <input
          type="password"
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Role
          {isDefaultAdmin && (
            <span className="ml-2 px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700 rounded-full">
              Protected
            </span>
          )}
        </label>
        {isDefaultAdmin && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs text-red-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                <strong>Default Admin User:</strong> This user must always maintain admin privileges. Role cannot be changed to ensure system access.
              </span>
            </p>
          </div>
        )}
        <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-2">
          {roleOptions.map((roleOption) => {
            const isSelected = formData.role === roleOption.value
            const isDisabled = isDefaultAdmin && roleOption.value !== 'admin'
            
            return (
              <label
                key={roleOption.value}
                className={`flex items-start gap-3 p-3 rounded-lg border-2 transition-all ${
                  isSelected
                    ? `${roleOption.color} border-current shadow-md`
                    : isDisabled
                    ? 'bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed'
                    : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50 cursor-pointer'
                }`}
              >
                <input
                  type="radio"
                  name="editUserRole"
                  value={roleOption.value}
                  checked={isSelected}
                  onChange={(e) => {
                    if (isDefaultAdmin && e.target.value !== 'admin') {
                      alert('Cannot change role of the default admin user. The admin user must always maintain admin privileges.')
                      return
                    }
                    setFormData({ ...formData, role: e.target.value as UserRole })
                  }}
                  disabled={isDisabled}
                  className="mt-1 w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={`Select ${roleOption.label} role`}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg" aria-hidden="true">{roleOption.icon}</span>
                    <span className="font-semibold text-sm">{roleOption.label}</span>
                    {isDefaultAdmin && roleOption.value === 'admin' && (
                      <span className="ml-auto px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded">
                        Super Admin
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600">{roleOption.description}</p>
                </div>
              </label>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          <Info className="w-3 h-3 inline mr-1" aria-hidden="true" />
          Note: Additional roles (Developer, QA Engineer, etc.) can be assigned via the Roles & Permissions tab.
        </p>
      </div>
      <div>
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={formData.isActive}
            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
            className="mr-2"
          />
          <span className="text-sm font-medium text-gray-700">Active</span>
        </label>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Save className="w-4 h-4 inline mr-2" />
          Save Changes
        </button>
      </div>
    </form>
  )
}


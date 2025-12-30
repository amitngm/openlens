'use client'

/**
 * Role Management Component
 * 
 * W3C Compliant, Production-Ready Role Management Interface
 * Provides comprehensive role and permission management
 */

import { useState, useEffect } from 'react'
import { 
  Shield, 
  UserCheck, 
  Lock, 
  Unlock, 
  Save, 
  X, 
  Info, 
  CheckCircle2, 
  AlertCircle,
  Users,
  Key,
  Eye,
  EyeOff,
  ChevronDown
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Role, Resource, Action, ROLE_PERMISSIONS, mapLegacyRole as mapLegacyRoleUtil } from '@/types/permissions'
import { User, UserRole } from '@/types'

interface RoleManagementProps {
  apiUrl: string
  users: User[]
  onUserUpdate?: () => void
}

export default function RoleManagement({ apiUrl, users, onUserUpdate }: RoleManagementProps) {
  const { token, hasPermission, getCurrentRole } = useAuth()
  const [selectedRole, setSelectedRole] = useState<Role>('viewer')
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [showPermissions, setShowPermissions] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [userRoleSelections, setUserRoleSelections] = useState<Record<string, Role>>({})

  const currentUserRole = getCurrentRole()
  const canManageRoles = hasPermission('roles', 'manage') || hasPermission('users', 'update')

  // Role display information
  const roleInfo: Record<Role, { label: string; description: string; color: string }> = {
    'super-admin': {
      label: 'Super Admin',
      description: 'Full system access with all permissions',
      color: 'bg-red-100 text-red-800 border-red-300'
    },
    'admin': {
      label: 'Administrator',
      description: 'Administrative access to most features',
      color: 'bg-orange-100 text-orange-800 border-orange-300'
    },
    'manager': {
      label: 'Manager',
      description: 'Management access for operational tasks',
      color: 'bg-blue-100 text-blue-800 border-blue-300'
    },
    'developer': {
      label: 'Developer',
      description: 'Development-focused permissions',
      color: 'bg-green-100 text-green-800 border-green-300'
    },
    'qa-engineer': {
      label: 'QA Engineer',
      description: 'Testing and QA-focused permissions',
      color: 'bg-purple-100 text-purple-800 border-purple-300'
    },
    'viewer': {
      label: 'Viewer',
      description: 'Read-only access to resources',
      color: 'bg-gray-100 text-gray-800 border-gray-300'
    },
    'guest': {
      label: 'Guest',
      description: 'Limited guest access',
      color: 'bg-slate-100 text-slate-800 border-slate-300'
    },
  }

  // Map industry roles to backend roles
  const mapRoleToBackend = (role: Role): UserRole => {
    const roleMap: Record<Role, UserRole> = {
      'super-admin': 'admin',      // Super Admin maps to admin
      'admin': 'admin',
      'manager': 'manager',
      'developer': 'manager',      // Developer maps to manager
      'qa-engineer': 'viewer',     // QA Engineer maps to viewer
      'viewer': 'viewer',
      'guest': 'viewer',           // Guest maps to viewer
    }
    return roleMap[role] || 'viewer'
  }

  // Map backend role to industry role for display
  const mapBackendToRole = (backendRole: UserRole): Role => {
    // For now, we'll use the legacy mapping
    // In production, you might store the actual role separately
    return mapLegacyRoleUtil(backendRole)
  }

  const handleRoleChange = async (userId: string, newRole: Role) => {
    if (!canManageRoles) {
      setError('You do not have permission to change user roles')
      return
    }

    // Protect default admin user from role changes
    const userToUpdate = users.find(u => u.id === userId)
    if (userToUpdate && userToUpdate.username === 'admin') {
      setError('Cannot change role of the default admin user. The admin user must always maintain admin privileges.')
      return
    }

    setIsUpdating(true)
    setError(null)
    setSuccess(null)

    // Map the selected role to backend-compatible role
    const backendRole = mapRoleToBackend(newRole)

    try {
      const response = await fetch(`${apiUrl}/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ role: backendRole }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || errorData.message || 'Failed to update user role')
      }

      const updatedRoleInfo = roleInfo[newRole]
      setSuccess(`User role updated to ${updatedRoleInfo.label} successfully`)
      if (onUserUpdate) {
        onUserUpdate()
      }
      
      // Clear the selection state for this user
      setUserRoleSelections(prev => {
        const updated = { ...prev }
        delete updated[userId]
        return updated
      })
      
      setTimeout(() => {
        setSuccess(null)
        setSelectedUser(null)
      }, 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to update user role')
    } finally {
      setIsUpdating(false)
    }
  }

  if (!canManageRoles) {
    return (
      <div 
        className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-6"
        role="alert"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold text-yellow-800 mb-1">
              Access Restricted
            </h3>
            <p className="text-sm text-yellow-700">
              You do not have permission to manage roles. Contact your administrator for access.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const permissions = ROLE_PERMISSIONS[selectedRole] || []

  return (
    <div className="space-y-6" role="region" aria-label="Role Management">
      {/* Error/Success Messages */}
      {error && (
        <div 
          className="bg-red-50 border-2 border-red-200 rounded-xl p-4 flex items-start gap-3"
          role="alert"
          aria-live="assertive"
        >
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-600 hover:text-red-800"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div 
          className="bg-green-50 border-2 border-green-200 rounded-xl p-4 flex items-start gap-3"
          role="alert"
          aria-live="polite"
        >
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm font-medium text-green-800">{success}</p>
        </div>
      )}

      {/* Role Selection */}
      <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary-600" aria-hidden="true" />
            Select Role to View Permissions
          </h3>
          <button
            onClick={() => setShowPermissions(!showPermissions)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            aria-expanded={showPermissions}
            aria-controls="permissions-details"
          >
            {showPermissions ? (
              <>
                <EyeOff className="w-4 h-4" aria-hidden="true" />
                Hide Permissions
              </>
            ) : (
              <>
                <Eye className="w-4 h-4" aria-hidden="true" />
                Show Permissions
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {(Object.keys(roleInfo) as Role[]).map((role) => {
            const info = roleInfo[role]
            const isSelected = selectedRole === role
            return (
              <button
                key={role}
                onClick={() => {
                  setSelectedRole(role)
                  setShowPermissions(true)
                }}
                className={`p-4 rounded-lg border-2 transition-all duration-200 text-left ${
                  isSelected
                    ? `${info.color} border-current shadow-md scale-105`
                    : 'bg-gray-50 border-gray-200 hover:border-gray-300 hover:shadow-sm'
                }`}
                aria-pressed={isSelected}
                aria-label={`Select ${info.label} role`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Shield className={`w-4 h-4 ${isSelected ? 'text-current' : 'text-gray-500'}`} aria-hidden="true" />
                  <span className="font-semibold text-sm">{info.label}</span>
                </div>
                <p className="text-xs text-gray-600 line-clamp-2">{info.description}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Permissions Details */}
      {showPermissions && (
        <div 
          id="permissions-details"
          className="bg-white rounded-xl shadow-md border border-gray-200 p-6"
          role="region"
          aria-label={`Permissions for ${roleInfo[selectedRole].label}`}
        >
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Key className="w-5 h-5 text-primary-600" aria-hidden="true" />
            Permissions for {roleInfo[selectedRole].label}
          </h3>

          <div className="space-y-4">
            {permissions.length === 0 ? (
              <p className="text-sm text-gray-500">No permissions assigned to this role.</p>
            ) : (
              permissions.map((permission, index) => {
                const actions = permission.actions
                const hasManage = actions.includes('manage')
                
                return (
                  <div
                    key={`${permission.resource}-${index}`}
                    className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-gray-900 capitalize">
                        {permission.resource.replace(/-/g, ' ')}
                      </h4>
                      {hasManage && (
                        <span className="px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded">
                          Full Access
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {hasManage ? (
                        <span className="text-sm text-gray-600">All actions allowed</span>
                      ) : (
                        actions.map((action) => (
                          <span
                            key={action}
                            className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded capitalize"
                          >
                            {action}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* User Role Assignment */}
      <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Users className="w-5 h-5 text-primary-600" aria-hidden="true" />
          Assign Roles to Users
        </h3>

        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-xs text-blue-800 flex items-start gap-2">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              <strong>Note:</strong> The system supports 7 industry-standard roles. Users are initially created with primary roles (Admin, Manager, Viewer). Extended roles (Super Admin, Developer, QA Engineer, Guest) can be configured via custom role mapping in production environments.
            </span>
          </p>
        </div>

        <div className="space-y-3">
          {users.map((user) => {
            const userRole = mapLegacyRoleUtil(user.role) as Role
            const currentSelection = userRoleSelections[user.id] || userRole
            const isDefaultAdmin = user.username === 'admin'
            // Default admin should always show as Super Admin
            const displayRole = isDefaultAdmin ? 'super-admin' : userRole
            const displayRoleInfo = roleInfo[displayRole]
            
            return (
              <div
                key={user.id}
                className={`flex items-center justify-between p-4 border-2 rounded-lg transition-colors ${
                  isDefaultAdmin 
                    ? 'bg-red-50 border-red-200' 
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-600 rounded-full flex items-center justify-center text-white font-semibold">
                    {user.username.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900">{user.username}</p>
                      {isDefaultAdmin && (
                        <span className="px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700 rounded-full">
                          Protected
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 text-xs font-medium rounded-full ${displayRoleInfo.color}`}>
                    {displayRoleInfo.label}
                  </span>
                  <div className="relative min-w-[200px]">
                    <select
                      value={isDefaultAdmin ? 'super-admin' : currentSelection}
                      onChange={(e) => {
                        if (isDefaultAdmin) {
                          setError('Cannot change role of the default admin user. The admin user must always maintain super-admin privileges.')
                          return
                        }
                        const newRole = e.target.value as Role
                        setUserRoleSelections(prev => ({ ...prev, [user.id]: newRole }))
                        handleRoleChange(user.id, newRole)
                      }}
                      disabled={isUpdating || isDefaultAdmin}
                      className={`w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed appearance-none bg-white pr-8 ${
                        isDefaultAdmin ? 'bg-gray-100 cursor-not-allowed' : ''
                      }`}
                      aria-label={`Change role for ${user.username}`}
                      title={isDefaultAdmin ? 'Default admin user role cannot be changed' : ''}
                    >
                      {(Object.keys(roleInfo) as Role[]).map((role) => {
                        const info = roleInfo[role]
                        return (
                          <option key={role} value={role}>
                            {info.label}
                          </option>
                        )
                      })}
                    </select>
                    <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                      <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />
                    </div>
                    {isDefaultAdmin && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gray-100/80 rounded-lg pointer-events-none">
                        <Lock className="w-4 h-4 text-gray-500" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* All Available Roles Display */}
        <div className="mt-6 pt-6 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary-600" aria-hidden="true" />
            All Available Roles in System
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(Object.keys(roleInfo) as Role[]).map((role) => {
              const info = roleInfo[role]
              const rolePermissions = ROLE_PERMISSIONS[role] || []
              const permissionCount = rolePermissions.length
              const actionCount = rolePermissions.reduce((acc, p) => acc + p.actions.length, 0)
              
              return (
                <div
                  key={role}
                  className={`p-3 rounded-lg border-2 ${info.color} transition-all hover:shadow-md`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">{info.label}</span>
                    <span className="text-xs bg-white/60 px-2 py-0.5 rounded">
                      {permissionCount} resources
                    </span>
                  </div>
                  <p className="text-xs mb-2 opacity-90">{info.description}</p>
                  <div className="flex items-center gap-2 text-xs opacity-75">
                    <Key className="w-3 h-3" aria-hidden="true" />
                    <span>{actionCount} total permissions</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}


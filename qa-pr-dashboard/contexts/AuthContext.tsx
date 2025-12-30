'use client'

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react'
import { User, LoginCredentials } from '@/types'
import { storage, STORAGE_KEYS } from '@/utils/storage'
import { 
  Role, 
  Resource, 
  Action, 
  hasPermission, 
  getAccessibleResources, 
  getResourceActions,
  mapLegacyRole as mapLegacyRoleUtil
} from '@/types/permissions'

interface AuthContextType {
  user: User | null
  token: string | null
  login: (credentials: LoginCredentials, apiUrl: string) => Promise<void>
  logout: () => void
  isAuthenticated: boolean
  hasRole: (role: string) => boolean
  canEdit: () => boolean
  canDelete: () => boolean
  isLoading: boolean
  // New permission-based methods
  hasPermission: (resource: Resource, action: Action) => boolean
  getAccessibleResources: () => Resource[]
  getResourceActions: (resource: Resource) => Action[]
  getCurrentRole: () => Role
  // Access grant methods
  hasAccessGrant: (resource: string, apiUrl: string) => Promise<boolean>
  accessGrants: any[]
  refreshAccessGrants: (apiUrl: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [accessGrants, setAccessGrants] = useState<any[]>([])

  // Load auth state from localStorage and validate session on mount
  useEffect(() => {
    const loadAuthState = async () => {
      try {
        // Ensure storage is available
        if (typeof storage === 'undefined' || !storage || typeof storage.getLocal !== 'function') {
          console.warn('Storage utility not available, skipping auth state load')
          setIsLoading(false)
          return
        }

        const savedSessionId = storage.getLocal<string>(STORAGE_KEYS.SESSION_ID)
        const savedToken = storage.getLocal<string>(STORAGE_KEYS.AUTH_TOKEN)
        const savedUser = storage.getLocal<User>(STORAGE_KEYS.AUTH_USER)
        
        // If we have a sessionId, validate it with the server
        if (savedSessionId) {
          const apiUrl = typeof window !== 'undefined' 
            ? (localStorage.getItem('apiUrl') || 'http://localhost:8000/api')
            : 'http://localhost:8000/api'
          
          try {
            const response = await fetch(`${apiUrl}/auth/validate-session`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ sessionId: savedSessionId }),
            })

            if (response.ok) {
              const data = await response.json()
              if (data.success && data.user && data.token) {
                setToken(data.token)
                setUser(data.user)
                setSessionId(data.session.sessionId)
                // Update stored values in case token was refreshed
                storage.setLocal(STORAGE_KEYS.AUTH_TOKEN, data.token)
                storage.setLocal(STORAGE_KEYS.AUTH_USER, data.user)
                storage.setLocal(STORAGE_KEYS.SESSION_ID, data.session.sessionId)
                console.log('✅ Validated and loaded auth state from session')
              } else {
                // Invalid session, clear storage
                clearAuthStorage()
                console.log('ℹ️ Session validation failed, cleared auth state')
              }
            } else {
              // Session invalid or expired, clear storage
              clearAuthStorage()
              console.log('ℹ️ Session validation failed, cleared auth state')
            }
          } catch (error) {
            console.error('Error validating session:', error)
            // If validation fails but we have saved data, use it (offline mode)
            if (savedToken && savedUser) {
              setToken(savedToken)
              setUser(savedUser)
              setSessionId(savedSessionId)
              console.log('⚠️ Session validation failed, using cached auth state (offline mode)')
            } else {
              clearAuthStorage()
            }
          }
        } else if (savedToken && savedUser) {
          // Fallback: if no sessionId but we have token/user, use them (backward compatibility)
          setToken(savedToken)
          setUser(savedUser)
          console.log('✅ Loaded auth state from storage (legacy mode)')
        } else {
          console.log('ℹ️ No saved auth state found')
        }
      } catch (error) {
        console.error('Error loading auth state from storage:', error)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadAuthState()
  }, [])

  // Helper to clear auth storage
  const clearAuthStorage = () => {
    storage.removeLocal(STORAGE_KEYS.AUTH_TOKEN)
    storage.removeLocal(STORAGE_KEYS.AUTH_USER)
    storage.removeLocal(STORAGE_KEYS.SESSION_ID)
  }

  const login = async (credentials: LoginCredentials, apiUrl: string) => {
    try {
      // Ensure credentials are valid
      if (!credentials.username || !credentials.password) {
        throw new Error('Username and password are required')
      }

      const response = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: credentials.username.trim(),
          password: credentials.password,
        }),
      })

      if (!response.ok) {
        let errorMessage = 'Login failed'
        try {
          const error = await response.json()
          errorMessage = error.error || error.message || errorMessage
        } catch (parseError) {
          // If response is not JSON, use status text
          errorMessage = response.statusText || `HTTP ${response.status}`
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()
      
      if (!data.token || !data.user) {
        throw new Error('Invalid response from server')
      }

      setToken(data.token)
      setUser(data.user)
      
      // Store sessionId if provided (new MongoDB session system)
      if (data.sessionId) {
        setSessionId(data.sessionId)
        storage.setLocal(STORAGE_KEYS.SESSION_ID, data.sessionId)
      }
      
      // Store in localStorage (persists across tabs)
      if (typeof storage !== 'undefined' && storage && typeof storage.setLocal === 'function') {
        storage.setLocal(STORAGE_KEYS.AUTH_TOKEN, data.token)
        storage.setLocal(STORAGE_KEYS.AUTH_USER, data.user)
      }
    } catch (error: any) {
      // Handle network errors
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Unable to connect to server. Please check if the API server is running.')
      }
      throw error
    }
  }

  const logout = useCallback(async () => {
    // Call logout endpoint to remove session from MongoDB
    if (sessionId) {
      const apiUrl = typeof window !== 'undefined' 
        ? (localStorage.getItem('apiUrl') || 'http://localhost:8000/api')
        : 'http://localhost:8000/api'
      
      try {
        await fetch(`${apiUrl}/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionId }),
        })
      } catch (error) {
        console.error('Error calling logout endpoint:', error)
        // Continue with logout even if endpoint fails
      }
    }
    
    setToken(null)
    setUser(null)
    setSessionId(null)
    
    // Clear localStorage
    storage.removeLocal(STORAGE_KEYS.AUTH_TOKEN)
    storage.removeLocal(STORAGE_KEYS.AUTH_USER)
    storage.removeLocal(STORAGE_KEYS.SESSION_ID)
  }, [sessionId])

  const isAuthenticated = !!user && !!token

  const hasRole = useCallback((role: string): boolean => {
    if (!user) return false
    // Admin role is treated as super-admin (has all roles)
    if (user.role === 'admin') return true // Admin has all roles, including super-admin
    if (user.role === 'manager' && role !== 'admin') return true // Manager has all roles except admin
    return user.role === role
  }, [user])
  
  const canEdit = useCallback((): boolean => {
    if (!user) return false
    return user.role === 'admin' || user.role === 'manager'
  }, [user])
  
  const canDelete = useCallback((): boolean => {
    if (!user) return false
    return user.role === 'admin'
  }, [user])

  // New permission-based methods
  const getCurrentRole = useCallback((): Role => {
    if (!user) return 'guest'
    // Admin role is always treated as super-admin for permissions
    if (user.role === 'admin') return 'super-admin'
    return mapLegacyRoleUtil(user.role)
  }, [user])

  const hasPermissionCheck = useCallback((resource: Resource, action: Action): boolean => {
    if (!user) return false
    const role = getCurrentRole()
    return hasPermission(role, resource, action)
  }, [user, getCurrentRole])

  const getAccessibleResourcesList = useCallback((): Resource[] => {
    if (!user) return []
    const role = getCurrentRole()
    return getAccessibleResources(role)
  }, [user, getCurrentRole])

  const getResourceActionsList = useCallback((resource: Resource): Action[] => {
    if (!user) return []
    const role = getCurrentRole()
    return getResourceActions(role, resource)
  }, [user, getCurrentRole])

  // Access grant methods
  const refreshAccessGrants = useCallback(async (apiUrl: string) => {
    if (!token || !user) {
      setAccessGrants([])
      return
    }
    
    try {
      const response = await fetch(`${apiUrl}/access-grants/my-grants`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      
      if (response.ok) {
        const data = await response.json()
        setAccessGrants(data.grants || [])
      } else {
        setAccessGrants([])
      }
    } catch (error) {
      console.error('Error fetching access grants:', error)
      setAccessGrants([])
    }
  }, [token, user])

  const hasAccessGrant = useCallback(async (resource: string, apiUrl: string): Promise<boolean> => {
    if (!token || !user) return false
    
    try {
      const response = await fetch(`${apiUrl}/access-grants/check/${resource}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      
      if (response.ok) {
        const data = await response.json()
        return data.hasAccess === true
      }
      return false
    } catch (error) {
      console.error('Error checking access grant:', error)
      return false
    }
  }, [token, user])

  // Refresh access grants when user logs in
  useEffect(() => {
    if (user && token) {
      const apiUrl = typeof window !== 'undefined' 
        ? (localStorage.getItem('apiUrl') || 'http://localhost:8000/api')
        : 'http://localhost:8000/api'
      refreshAccessGrants(apiUrl)
    } else {
      setAccessGrants([])
    }
  }, [user, token, refreshAccessGrants])

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        isAuthenticated,
        hasRole,
        canEdit,
        canDelete,
        isLoading,
        hasPermission: hasPermissionCheck,
        getAccessibleResources: getAccessibleResourcesList,
        getResourceActions: getResourceActionsList,
        getCurrentRole,
        hasAccessGrant,
        accessGrants,
        refreshAccessGrants,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}


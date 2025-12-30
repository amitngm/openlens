/**
 * Centralized storage utility for managing localStorage and sessionStorage
 * Provides type-safe storage operations with error handling
 */

// Storage keys constants
export const STORAGE_KEYS = {
  // Session storage (cleared on tab close)
  ACTIVE_TAB: 'activeTab',
  SELECTED_STATUS: 'selectedStatus',
  JIRA_TABLE_PAGE: 'jiraTablePage',
  
  // Local storage (persistent across sessions)
  AUTH_TOKEN: 'authToken',
  AUTH_USER: 'authUser',
  SESSION_ID: 'sessionId',
  API_URL: 'apiUrl',
  GITHUB_CONFIG: 'githubConfig',
  JIRA_CONFIG: 'jiraConfig',
  KUBECONFIG: 'kubeconfig',
} as const

type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS]

/**
 * Storage utility class with error handling
 */
class Storage {
  private isAvailable(type: 'localStorage' | 'sessionStorage'): boolean {
    if (typeof window === 'undefined') return false
    
    try {
      const storageApi = type === 'localStorage' ? window.localStorage : window.sessionStorage
      if (!storageApi || typeof storageApi !== 'object') return false
      
      const testKey = '__storage_test__'
      if (typeof storageApi.setItem !== 'function' || typeof storageApi.removeItem !== 'function') {
        return false
      }
      
      storageApi.setItem(testKey, testKey)
      storageApi.removeItem(testKey)
      return true
    } catch (e) {
      return false
    }
  }

  /**
   * Get item from sessionStorage (session-specific data)
   */
  getSession<T>(key: StorageKey): T | null {
    if (typeof window === 'undefined') return null
    if (!this.isAvailable('sessionStorage')) return null

    try {
      const sessionStorage = window.sessionStorage
      if (!sessionStorage || typeof sessionStorage.getItem !== 'function') return null
      
      const item = sessionStorage.getItem(key)
      if (!item) return null
      return JSON.parse(item) as T
    } catch (error) {
      // Silently fail during SSR or if storage is unavailable
      return null
    }
  }

  /**
   * Set item in sessionStorage (session-specific data)
   */
  setSession<T>(key: StorageKey, value: T): boolean {
    if (typeof window === 'undefined') return false
    if (!this.isAvailable('sessionStorage')) return false

    try {
      const sessionStorage = window.sessionStorage
      if (!sessionStorage || typeof sessionStorage.setItem !== 'function') return false
      
      sessionStorage.setItem(key, JSON.stringify(value))
      return true
    } catch (error) {
      // Silently fail during SSR or if storage is unavailable
      return false
    }
  }

  /**
   * Remove item from sessionStorage
   */
  removeSession(key: StorageKey): boolean {
    if (typeof window === 'undefined') return false
    if (!this.isAvailable('sessionStorage')) return false

    try {
      const sessionStorage = window.sessionStorage
      if (!sessionStorage || typeof sessionStorage.removeItem !== 'function') return false
      
      sessionStorage.removeItem(key)
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Get item from localStorage (persistent data)
   */
  getLocal<T>(key: StorageKey): T | null {
    if (typeof window === 'undefined') return null
    if (!this.isAvailable('localStorage')) return null

    try {
      const localStorage = window.localStorage
      if (!localStorage || typeof localStorage.getItem !== 'function') return null
      
      const item = localStorage.getItem(key)
      if (!item) return null
      
      // Handle string values (like API URL)
      if (key === STORAGE_KEYS.API_URL) {
        return item as T
      }
      
      return JSON.parse(item) as T
    } catch (error) {
      return null
    }
  }

  /**
   * Set item in localStorage (persistent data)
   */
  setLocal<T>(key: StorageKey, value: T): boolean {
    if (typeof window === 'undefined') return false
    if (!this.isAvailable('localStorage')) return false

    try {
      const localStorage = window.localStorage
      if (!localStorage || typeof localStorage.setItem !== 'function') return false
      
      // Handle string values directly
      if (typeof value === 'string' && key === STORAGE_KEYS.API_URL) {
        localStorage.setItem(key, value)
      } else {
        localStorage.setItem(key, JSON.stringify(value))
      }
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Remove item from localStorage
   */
  removeLocal(key: StorageKey): boolean {
    if (typeof window === 'undefined') return false
    if (!this.isAvailable('localStorage')) return false

    try {
      const localStorage = window.localStorage
      if (!localStorage || typeof localStorage.removeItem !== 'function') return false
      
      localStorage.removeItem(key)
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Clear all session storage
   */
  clearSession(): void {
    if (typeof window === 'undefined') return
    if (!this.isAvailable('sessionStorage')) return
    
    try {
      const sessionStorage = window.sessionStorage
      if (!sessionStorage || typeof sessionStorage.removeItem !== 'function') return
      
      Object.values(STORAGE_KEYS).forEach(key => {
        try {
          sessionStorage.removeItem(key)
        } catch (e) {
          // Ignore individual removal errors
        }
      })
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Clear all local storage
   */
  clearLocal(): void {
    if (typeof window === 'undefined') return
    if (!this.isAvailable('localStorage')) return
    
    try {
      const localStorage = window.localStorage
      if (!localStorage || typeof localStorage.removeItem !== 'function') return
      
      Object.values(STORAGE_KEYS).forEach(key => {
        try {
          localStorage.removeItem(key)
        } catch (e) {
          // Ignore individual removal errors
        }
      })
    } catch (error) {
      // Silently fail
    }
  }
}

// Export singleton instance
// Storage methods handle SSR internally with window checks
let storageInstance: Storage | null = null

function getStorageInstance(): Storage {
  try {
    if (!storageInstance) {
      storageInstance = new Storage()
    }
    // Verify the instance has required methods
    if (!storageInstance || 
        typeof storageInstance.getSession !== 'function' ||
        typeof storageInstance.setSession !== 'function' ||
        typeof storageInstance.getLocal !== 'function' ||
        typeof storageInstance.setLocal !== 'function') {
      console.error('Storage instance is invalid or missing methods')
      // Create a new instance if the current one is invalid
      storageInstance = new Storage()
    }
    return storageInstance
  } catch (error) {
    console.error('Error creating storage instance:', error)
    // Return a new instance as fallback
    storageInstance = new Storage()
    return storageInstance
  }
}

// Export storage object with safe method access
// Using function declarations to ensure methods are properly bound
function safeGetSession<T>(key: StorageKey): T | null {
  try {
    const instance = getStorageInstance()
    if (!instance || typeof instance.getSession !== 'function') {
      console.error('Storage instance or getSession method not available')
      return null
    }
    return instance.getSession<T>(key)
  } catch (error) {
    console.error('Storage getSession error:', error)
    return null
  }
}

function safeSetSession<T>(key: StorageKey, value: T): boolean {
  try {
    const instance = getStorageInstance()
    if (!instance || typeof instance.setSession !== 'function') {
      console.error('Storage instance or setSession method not available')
      return false
    }
    return instance.setSession(key, value)
  } catch (error) {
    console.error('Storage setSession error:', error)
    return false
  }
}

function safeRemoveSession(key: StorageKey): boolean {
  try {
    const instance = getStorageInstance()
    if (!instance || typeof instance.removeSession !== 'function') {
      return false
    }
    return instance.removeSession(key)
  } catch (error) {
    console.error('Storage removeSession error:', error)
    return false
  }
}

function safeGetLocal<T>(key: StorageKey): T | null {
  try {
    const instance = getStorageInstance()
    if (!instance || typeof instance.getLocal !== 'function') {
      console.error('Storage instance or getLocal method not available')
      return null
    }
    return instance.getLocal<T>(key)
  } catch (error) {
    console.error('Storage getLocal error:', error)
    return null
  }
}

function safeSetLocal<T>(key: StorageKey, value: T): boolean {
  try {
    const instance = getStorageInstance()
    if (!instance || typeof instance.setLocal !== 'function') {
      console.error('Storage instance or setLocal method not available')
      return false
    }
    return instance.setLocal(key, value)
  } catch (error) {
    console.error('Storage setLocal error:', error)
    return false
  }
}

function safeRemoveLocal(key: StorageKey): boolean {
  try {
    const instance = getStorageInstance()
    if (!instance || typeof instance.removeLocal !== 'function') {
      return false
    }
    return instance.removeLocal(key)
  } catch (error) {
    console.error('Storage removeLocal error:', error)
    return false
  }
}

function safeClearSession(): void {
  try {
    const instance = getStorageInstance()
    if (!instance || typeof instance.clearSession !== 'function') {
      return
    }
    instance.clearSession()
  } catch (error) {
    console.error('Storage clearSession error:', error)
  }
}

function safeClearLocal(): void {
  try {
    const instance = getStorageInstance()
    if (!instance || typeof instance.clearLocal !== 'function') {
      return
    }
    instance.clearLocal()
  } catch (error) {
    console.error('Storage clearLocal error:', error)
  }
}

export const storage = {
  getSession: safeGetSession,
  setSession: safeSetSession,
  removeSession: safeRemoveSession,
  getLocal: safeGetLocal,
  setLocal: safeSetLocal,
  removeLocal: safeRemoveLocal,
  clearSession: safeClearSession,
  clearLocal: safeClearLocal,
}

// Convenience functions for backward compatibility with safe access
export const getSession = <T>(key: StorageKey): T | null => {
  try {
    return storage?.getSession ? storage.getSession<T>(key) : null
  } catch (error) {
    console.error('getSession error:', error)
    return null
  }
}

export const setSession = <T>(key: StorageKey, value: T): boolean => {
  try {
    return storage?.setSession ? storage.setSession(key, value) : false
  } catch (error) {
    console.error('setSession error:', error)
    return false
  }
}

export const removeSession = (key: StorageKey): boolean => {
  try {
    return storage?.removeSession ? storage.removeSession(key) : false
  } catch (error) {
    console.error('removeSession error:', error)
    return false
  }
}

export const getLocal = <T>(key: StorageKey): T | null => {
  try {
    return storage?.getLocal ? storage.getLocal<T>(key) : null
  } catch (error) {
    console.error('getLocal error:', error)
    return null
  }
}

export const setLocal = <T>(key: StorageKey, value: T): boolean => {
  try {
    return storage?.setLocal ? storage.setLocal(key, value) : false
  } catch (error) {
    console.error('setLocal error:', error)
    return false
  }
}

export const removeLocal = (key: StorageKey): boolean => {
  try {
    return storage?.removeLocal ? storage.removeLocal(key) : false
  } catch (error) {
    console.error('removeLocal error:', error)
    return false
  }
}

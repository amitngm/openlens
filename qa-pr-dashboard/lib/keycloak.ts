/**
 * Keycloak Integration Support
 * 
 * Optional Keycloak integration for production environments.
 * This module provides a seamless way to integrate with Keycloak
 * while maintaining backward compatibility with the existing auth system.
 */

import { Role, mapLegacyRole } from '@/types/permissions'
import { User } from '@/types'

export interface KeycloakConfig {
  url: string
  realm: string
  clientId: string
  enabled: boolean
}

export interface KeycloakUser {
  sub: string
  email?: string
  preferred_username?: string
  given_name?: string
  family_name?: string
  roles?: string[]
  groups?: string[]
}

/**
 * Map Keycloak roles to application roles
 */
export function mapKeycloakRole(keycloakRoles: string[]): Role {
  // Priority order: super-admin > admin > manager > developer > qa-engineer > viewer > guest
  if (keycloakRoles.includes('super-admin') || keycloakRoles.includes('super_admin')) {
    return 'super-admin'
  }
  if (keycloakRoles.includes('admin') || keycloakRoles.includes('administrator')) {
    return 'admin'
  }
  if (keycloakRoles.includes('manager') || keycloakRoles.includes('team-lead')) {
    return 'manager'
  }
  if (keycloakRoles.includes('developer') || keycloakRoles.includes('dev')) {
    return 'developer'
  }
  if (keycloakRoles.includes('qa-engineer') || keycloakRoles.includes('qa') || keycloakRoles.includes('tester')) {
    return 'qa-engineer'
  }
  if (keycloakRoles.includes('viewer') || keycloakRoles.includes('read-only')) {
    return 'viewer'
  }
  
  // Default to guest if no matching role
  return 'guest'
}

/**
 * Convert Keycloak user to application User format
 */
export function convertKeycloakUser(keycloakUser: KeycloakUser, token: string): User {
  const roles = keycloakUser.roles || []
  const appRole = mapKeycloakRole(roles)
  
  // Map to legacy role format for backward compatibility
  const legacyRoleMap: Record<Role, 'admin' | 'manager' | 'viewer'> = {
    'super-admin': 'admin',
    'admin': 'admin',
    'manager': 'manager',
    'developer': 'manager', // Developer gets manager-level access
    'qa-engineer': 'viewer', // QA gets viewer-level access
    'viewer': 'viewer',
    'guest': 'viewer',
  }
  
  return {
    id: keycloakUser.sub,
    username: keycloakUser.preferred_username || keycloakUser.email || 'user',
    email: keycloakUser.email || '',
    role: legacyRoleMap[appRole] || 'viewer',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isActive: true,
  }
}

/**
 * Check if Keycloak is enabled
 */
export function isKeycloakEnabled(): boolean {
  if (typeof window === 'undefined') return false
  
  const config = getKeycloakConfig()
  return config.enabled && !!config.url && !!config.realm && !!config.clientId
}

/**
 * Get Keycloak configuration from environment or localStorage
 */
export function getKeycloakConfig(): KeycloakConfig {
  if (typeof window === 'undefined') {
    return {
      url: '',
      realm: '',
      clientId: '',
      enabled: false,
    }
  }

  // Check environment variables first
  const envUrl = process.env.NEXT_PUBLIC_KEYCLOAK_URL
  const envRealm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM
  const envClientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID

  // Check localStorage for runtime configuration
  const storedConfig = localStorage.getItem('keycloak_config')
  let config: Partial<KeycloakConfig> = {}

  if (storedConfig) {
    try {
      config = JSON.parse(storedConfig)
    } catch (e) {
      console.error('Failed to parse Keycloak config from localStorage', e)
    }
  }

  return {
    url: envUrl || config.url || '',
    realm: envRealm || config.realm || '',
    clientId: envClientId || config.clientId || '',
    enabled: Boolean((envUrl || config.url) && (envRealm || config.realm) && (envClientId || config.clientId)),
  }
}

/**
 * Initialize Keycloak (if enabled)
 * This should be called during app initialization
 */
export async function initializeKeycloak(): Promise<boolean> {
  if (!isKeycloakEnabled()) {
    return false
  }

  try {
    // Dynamic import to avoid bundling Keycloak JS if not used
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error - keycloak-js is an optional dependency
    const Keycloak = (await import('keycloak-js')).default
    const config = getKeycloakConfig()
    
    const keycloak = new Keycloak({
      url: config.url,
      realm: config.realm,
      clientId: config.clientId,
    })

    // Store Keycloak instance globally (you may want to use a context instead)
    ;(window as any).keycloak = keycloak

    // Initialize Keycloak
    const authenticated = await keycloak.init({
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
      pkceMethod: 'S256',
    })

    return authenticated
  } catch (error) {
    console.error('Failed to initialize Keycloak:', error)
    return false
  }
}

/**
 * Login with Keycloak
 */
export async function loginWithKeycloak(): Promise<{ user: User; token: string } | null> {
  if (!isKeycloakEnabled()) {
    return null
  }

  try {
    const keycloak = (window as any).keycloak
    if (!keycloak) {
      await initializeKeycloak()
      return null
    }

    // Attempt to login
    await keycloak.login()

    // Get user info
    const userInfo = await keycloak.loadUserInfo()
    const token = keycloak.token || ''

    // Convert to application format
    const user = convertKeycloakUser(userInfo as KeycloakUser, token)

    return { user, token }
  } catch (error) {
    console.error('Keycloak login failed:', error)
    return null
  }
}

/**
 * Logout from Keycloak
 */
export async function logoutFromKeycloak(): Promise<void> {
  if (!isKeycloakEnabled()) {
    return
  }

  try {
    const keycloak = (window as any).keycloak
    if (keycloak) {
      await keycloak.logout()
    }
  } catch (error) {
    console.error('Keycloak logout failed:', error)
  }
}

/**
 * Get current Keycloak token
 */
export function getKeycloakToken(): string | null {
  if (!isKeycloakEnabled()) {
    return null
  }

  try {
    const keycloak = (window as any).keycloak
    return keycloak?.token || null
  } catch (error) {
    console.error('Failed to get Keycloak token:', error)
    return null
  }
}


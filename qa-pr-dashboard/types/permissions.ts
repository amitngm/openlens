/**
 * Industry-Standard Role-Based Access Control (RBAC) System
 * 
 * This file defines roles, permissions, and resources following industry best practices.
 * Compatible with Keycloak and other identity providers.
 */

/**
 * Industry-Standard Roles
 * Based on common enterprise role patterns
 */
export type Role = 
  | 'super-admin'      // Full system access (highest privilege)
  | 'admin'            // Administrative access
  | 'manager'          // Management access
  | 'developer'        // Development access
  | 'qa-engineer'      // QA/Testing access
  | 'viewer'           // Read-only access
  | 'guest'            // Limited guest access

/**
 * Resources in the system
 */
export type Resource = 
  | 'users'                    // User management
  | 'roles'                    // Role management
  | 'permissions'              // Permission management
  | 'jira'                     // Jira integration
  | 'github'                    // GitHub integration
  | 'kubernetes'                // Kubernetes management
  | 'deployments'              // Deployment management
  | 'services'                 // Service management
  | 'pods'                     // Pod management
  | 'automation'                // Automation management
  | 'releases'                  // Release management
  | 'settings'                  // System settings
  | 'audit-logs'                // Audit logs
  | 'search-history'            // Search history
  | 'activities'                // User activities
  | 'kubeconfigs'              // Kubeconfig management
  | 'integrations'              // Integration management

/**
 * Actions that can be performed on resources
 */
export type Action = 
  | 'create'                    // Create new resource
  | 'read'                      // Read/view resource
  | 'update'                    // Update/modify resource
  | 'delete'                    // Delete resource
  | 'execute'                   // Execute action (e.g., deploy, sync)
  | 'manage'                    // Full management (all actions)

/**
 * Permission definition
 */
export interface Permission {
  resource: Resource
  actions: Action[]
  conditions?: PermissionCondition[]  // Optional conditions (e.g., own resources only)
}

/**
 * Permission conditions for fine-grained access control
 */
export interface PermissionCondition {
  type: 'own' | 'team' | 'namespace' | 'label' | 'custom'
  value?: string
}

/**
 * Role-Permission mapping
 * Defines what each role can do
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  'super-admin': [
    // Super Admin has all permissions
    { resource: 'users', actions: ['manage'] },
    { resource: 'roles', actions: ['manage'] },
    { resource: 'permissions', actions: ['manage'] },
    { resource: 'jira', actions: ['manage'] },
    { resource: 'github', actions: ['manage'] },
    { resource: 'kubernetes', actions: ['manage'] },
    { resource: 'deployments', actions: ['manage'] },
    { resource: 'services', actions: ['manage'] },
    { resource: 'pods', actions: ['manage'] },
    { resource: 'automation', actions: ['manage'] },
    { resource: 'releases', actions: ['manage'] },
    { resource: 'settings', actions: ['manage'] },
    { resource: 'audit-logs', actions: ['read'] },
    { resource: 'search-history', actions: ['read'] },
    { resource: 'activities', actions: ['read'] },
    { resource: 'kubeconfigs', actions: ['manage'] },
    { resource: 'integrations', actions: ['manage'] },
  ],
  'admin': [
    // Admin has most permissions except super-admin functions
    { resource: 'users', actions: ['create', 'read', 'update'] },  // Cannot delete users
    { resource: 'jira', actions: ['manage'] },
    { resource: 'github', actions: ['manage'] },
    { resource: 'kubernetes', actions: ['read', 'execute'] },
    { resource: 'deployments', actions: ['read', 'execute'] },
    { resource: 'services', actions: ['read', 'execute'] },
    { resource: 'pods', actions: ['read', 'execute'] },
    { resource: 'automation', actions: ['manage'] },
    { resource: 'releases', actions: ['manage'] },
    { resource: 'settings', actions: ['read', 'update'] },
    { resource: 'audit-logs', actions: ['read'] },
    { resource: 'search-history', actions: ['read'] },
    { resource: 'activities', actions: ['read'] },
    { resource: 'kubeconfigs', actions: ['read', 'update'] },
    { resource: 'integrations', actions: ['read', 'update'] },
  ],
  'manager': [
    // Manager has operational permissions
    { resource: 'jira', actions: ['read', 'execute'] },
    { resource: 'github', actions: ['read', 'execute'] },
    { resource: 'kubernetes', actions: ['read', 'execute'] },
    { resource: 'deployments', actions: ['read', 'execute'] },
    { resource: 'services', actions: ['read'] },
    { resource: 'pods', actions: ['read'] },
    { resource: 'releases', actions: ['read', 'update'] },
    { resource: 'settings', actions: ['read'] },
    { resource: 'search-history', actions: ['read'] },
    { resource: 'activities', actions: ['read'] },
    { resource: 'kubeconfigs', actions: ['read'] },
  ],
  'developer': [
    // Developer has development-focused permissions
    { resource: 'jira', actions: ['read', 'update'] },
    { resource: 'github', actions: ['read', 'update', 'execute'] },
    { resource: 'deployments', actions: ['read', 'execute'] },
    { resource: 'services', actions: ['read'] },
    { resource: 'pods', actions: ['read'] },
    { resource: 'releases', actions: ['read', 'update'] },
  ],
  'qa-engineer': [
    // QA Engineer has testing-focused permissions
    { resource: 'jira', actions: ['read', 'update'] },
    { resource: 'github', actions: ['read'] },
    { resource: 'deployments', actions: ['read'] },
    { resource: 'services', actions: ['read'] },
    { resource: 'pods', actions: ['read'] },
    { resource: 'releases', actions: ['read'] },
  ],
  'viewer': [
    // Viewer has read-only access
    { resource: 'jira', actions: ['read'] },
    { resource: 'github', actions: ['read'] },
    { resource: 'deployments', actions: ['read'] },
    { resource: 'services', actions: ['read'] },
    { resource: 'pods', actions: ['read'] },
    { resource: 'releases', actions: ['read'] },
  ],
  'guest': [
    // Guest has very limited access
    { resource: 'releases', actions: ['read'] },
  ],
}

/**
 * Check if a role has permission for a resource and action
 */
export function hasPermission(
  role: Role,
  resource: Resource,
  action: Action
): boolean {
  const permissions = ROLE_PERMISSIONS[role] || []
  
  for (const permission of permissions) {
    if (permission.resource === resource) {
      // Check if action is explicitly allowed
      if (permission.actions.includes(action)) {
        return true
      }
      // Check if 'manage' action is allowed (implies all actions)
      if (permission.actions.includes('manage')) {
        return true
      }
    }
  }
  
  return false
}

/**
 * Get all resources a role can access
 */
export function getAccessibleResources(role: Role): Resource[] {
  const permissions = ROLE_PERMISSIONS[role] || []
  return permissions.map(p => p.resource)
}

/**
 * Get all actions a role can perform on a resource
 */
export function getResourceActions(role: Role, resource: Resource): Action[] {
  const permissions = ROLE_PERMISSIONS[role] || []
  const permission = permissions.find(p => p.resource === resource)
  
  if (!permission) {
    return []
  }
  
  // If 'manage' is included, return all actions
  if (permission.actions.includes('manage')) {
    return ['create', 'read', 'update', 'delete', 'execute', 'manage']
  }
  
  return permission.actions
}

/**
 * Legacy role mapping for backward compatibility
 * Maps old roles to new industry-standard roles
 */
export const LEGACY_ROLE_MAP: Record<string, Role> = {
  'admin': 'admin',
  'manager': 'manager',
  'viewer': 'viewer',
}

/**
 * Convert legacy role to new role system
 */
export function mapLegacyRole(legacyRole: string): Role {
  return LEGACY_ROLE_MAP[legacyRole] || 'viewer'
}




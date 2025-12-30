# Production-Ready RBAC System Guide

## Overview

This application now includes a comprehensive, industry-standard Role-Based Access Control (RBAC) system that is production-ready and follows W3C accessibility standards.

## Features

### ✅ Industry-Standard Roles

The system supports the following roles:

1. **Super Admin** - Full system access (highest privilege)
2. **Admin** - Administrative access
3. **Manager** - Management access for operational tasks
4. **Developer** - Development-focused permissions
5. **QA Engineer** - Testing and QA-focused permissions
6. **Viewer** - Read-only access
7. **Guest** - Limited guest access

### ✅ Permission-Based Access Control

- **Resources**: Users, Roles, Jira, GitHub, Kubernetes, Deployments, Services, Pods, Automation, Releases, Settings, Audit Logs, etc.
- **Actions**: Create, Read, Update, Delete, Execute, Manage
- **Fine-grained Control**: Each role has specific permissions for each resource

### ✅ Keycloak Integration (Optional)

The system supports optional Keycloak integration for enterprise SSO:

```typescript
// Enable Keycloak by setting environment variables:
NEXT_PUBLIC_KEYCLOAK_URL=https://keycloak.example.com
NEXT_PUBLIC_KEYCLOAK_REALM=your-realm
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=your-client-id
```

### ✅ W3C Accessibility Compliance

- ARIA labels and roles
- Keyboard navigation support
- Screen reader compatibility
- Focus management
- Semantic HTML

## Usage

### Checking Permissions

```typescript
import { useAuth } from '@/contexts/AuthContext'

function MyComponent() {
  const { hasPermission, getCurrentRole } = useAuth()
  
  // Check if user can perform an action on a resource
  const canManageUsers = hasPermission('users', 'manage')
  const canReadJira = hasPermission('jira', 'read')
  
  // Get current role
  const role = getCurrentRole()
  
  // Get accessible resources
  const resources = getAccessibleResources()
}
```

### Role Management

Access the Role Management interface from the Admin Panel:

1. Navigate to **Admin Panel** → **Roles & Permissions** tab
2. View permissions for each role
3. Assign roles to users
4. See detailed permission breakdown

## Backward Compatibility

The system maintains full backward compatibility with existing roles:
- `admin` → Maps to `admin` role
- `manager` → Maps to `manager` role  
- `viewer` → Maps to `viewer` role

## Production Deployment

### Environment Variables

```bash
# Optional: Keycloak Integration
NEXT_PUBLIC_KEYCLOAK_URL=https://keycloak.example.com
NEXT_PUBLIC_KEYCLOAK_REALM=your-realm
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=your-client-id

# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

### Security Best Practices

1. **Never trust client-side checks alone** - Always validate permissions on the backend
2. **Use HTTPS** in production
3. **Implement rate limiting** on authentication endpoints
4. **Enable audit logging** for sensitive operations
5. **Regular security audits** of role assignments

## Migration Guide

### From Legacy Roles

The system automatically maps legacy roles to the new system. No code changes required for basic functionality.

### To Keycloak

1. Set up Keycloak server
2. Configure realm and client
3. Set environment variables
4. The system will automatically use Keycloak if enabled

## Support

For issues or questions, please refer to:
- `RBAC_IMPLEMENTATION.md` - Detailed RBAC documentation
- `ADMIN_PANEL_RBAC_IMPROVEMENTS.md` - Admin panel specific docs
- `types/permissions.ts` - Permission definitions




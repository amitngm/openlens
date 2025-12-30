# RBAC (Role-Based Access Control) Implementation

This document describes the complete RBAC implementation for all tabs and components in the application.

## Role Hierarchy

The application has three roles with the following hierarchy:

1. **Admin** - Full access to all features
2. **Manager** - Access to most features except admin-only functions
3. **Viewer** - Read-only access to basic features

## Tab Access Matrix

| Tab | Viewer | Manager | Admin |
|-----|--------|---------|-------|
| Jira Management | ✅ | ✅ | ✅ |
| GitHub PRs | ✅ | ✅ | ✅ |
| Releases | ✅ | ✅ | ✅ |
| Kubernetes Management | ❌ | ✅ | ✅ |
| Flow Tracing | ❌ | ✅ | ✅ |
| Admin Panel | ❌ | ❌ | ✅ |
| Automation | ❌ | ❌ | ✅ |

## Implementation Details

### 1. Tab Visibility Control

Tabs are conditionally rendered based on user roles in `app/page.tsx`:

```typescript
// Kubernetes Management - Admin and Manager only
{(hasRole('admin') || hasRole('manager')) && (
  <button onClick={() => setActiveTab('k8s')}>...</button>
)}

// Admin Panel - Admin only
{hasRole('admin') && (
  <button onClick={() => setActiveTab('admin')}>...</button>
)}

// Automation - Admin only
{hasRole('admin') && (
  <button onClick={() => setActiveTab('automation')}>...</button>
)}

// Flow Tracing - Admin and Manager only
{(hasRole('admin') || hasRole('manager')) && (
  <button onClick={() => setActiveTab('flows')}>...</button>
)}
```

### 2. Tab Access Validation

Two layers of validation ensure users can't access unauthorized tabs:

#### Layer 1: Session Storage Validation
When loading saved tab from session storage, validate against role:

```typescript
const viewerTabs = ['jira', 'github', 'releases']
const managerTabs = ['jira', 'k8s', 'github', 'releases', 'flows']
const adminTabs = ['jira', 'k8s', 'admin', 'automation', 'github', 'releases', 'flows']

// Check if saved tab is allowed for current role
if (allowedTabs.includes(savedTab)) {
  setActiveTabState(savedTab)
} else {
  // Redirect to first allowed tab
  setActiveTabState(allowedTabs[0])
}
```

#### Layer 2: Active Tab Validation
Continuous validation when active tab changes:

```typescript
useEffect(() => {
  if (!user) return
  
  const allowedTabs = isAdmin ? adminTabs : (isManager ? managerTabs : viewerTabs)
  
  // If current tab is not allowed, redirect to first allowed tab
  if (!allowedTabs.includes(activeTab)) {
    setActiveTab(allowedTabs[0])
  }
}, [activeTab, user])
```

### 3. Component-Level RBAC

Each protected component has its own RBAC check:

#### AdminPanel Component
```typescript
if (!hasRole('admin')) {
  return (
    <div className="...">
      <Shield className="..." />
      <h3>Access Denied</h3>
      <p>You need admin privileges to access this panel.</p>
    </div>
  )
}
```

#### AutomationManagement Component
```typescript
if (!hasRole('admin')) {
  return (
    <div className="...">
      <Shield className="..." />
      <h3>Access Denied</h3>
      <p>You need admin privileges to access Automation Management.</p>
    </div>
  )
}
```

#### FlowVisualization Component
```typescript
if (!hasRole('admin') && !hasRole('manager')) {
  return (
    <div className="...">
      <Shield className="..." />
      <h3>Access Denied</h3>
      <p>You need admin or manager privileges to access Flow Tracing.</p>
    </div>
  )
}
```

#### Tab Content Protection
Even if a user somehow navigates to a protected tab, the content is protected:

```typescript
{activeTab === 'k8s' ? (
  (hasRole('admin') || hasRole('manager')) ? (
    <KubernetesManagement ... />
  ) : (
    <AccessDeniedMessage />
  )
) : activeTab === 'admin' ? (
  hasRole('admin') ? (
    <AdminPanel ... />
  ) : (
    <AccessDeniedMessage />
  )
) : ...}
```

### 4. Backend API RBAC

Backend endpoints are protected with middleware:

```javascript
// Authentication middleware
function authenticateToken(req, res, next) {
  // Verify JWT token
  // Attach user to req.user
}

// Role-based authorization middleware
function authorizeRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' })
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    next()
  }
}

// Usage
app.post('/api/github/build-tag', 
  authenticateToken, 
  authorizeRole('admin', 'manager'), 
  asyncHandler(async (req, res) => { ... })
)
```

## RBAC Helper Functions

### hasRole(role: string): boolean
Located in `contexts/AuthContext.tsx`:

```typescript
const hasRole = useCallback((role: string): boolean => {
  if (!user) return false
  if (user.role === 'admin') return true // Admin has all roles
  if (user.role === 'manager' && role !== 'admin') return true // Manager has all roles except admin
  return user.role === role
}, [user])
```

**Logic:**
- Admin has all roles (returns true for any role check)
- Manager has all roles except 'admin'
- Viewer only has 'viewer' role

### canEdit(): boolean
```typescript
const canEdit = useCallback((): boolean => {
  if (!user) return false
  return user.role === 'admin' || user.role === 'manager'
}, [user])
```

### canDelete(): boolean
```typescript
const canDelete = useCallback((): boolean => {
  if (!user) return false
  return user.role === 'admin'
}, [user])
```

## Security Best Practices

### 1. Defense in Depth
- **Frontend**: Tab visibility, tab validation, component-level checks
- **Backend**: Authentication middleware, role-based authorization
- **Both**: Never trust client-side checks alone

### 2. Fail Secure
- If role check fails, deny access
- Redirect to safe default (first allowed tab)
- Show clear "Access Denied" message

### 3. Consistent Validation
- Validate on mount (session storage load)
- Validate on tab change
- Validate in component render
- Validate in API endpoints

### 4. User Experience
- Hide unauthorized tabs (don't show then deny)
- Clear error messages
- Graceful fallback to allowed tab

## Testing RBAC

### Test Cases

1. **Viewer User**
   - ✅ Can access: Jira, GitHub PRs, Releases
   - ❌ Cannot access: K8s, Admin, Automation, Flows
   - ✅ Redirected to Jira if trying to access restricted tab

2. **Manager User**
   - ✅ Can access: Jira, GitHub PRs, Releases, K8s, Flows
   - ❌ Cannot access: Admin, Automation
   - ✅ Redirected to Jira if trying to access Admin/Automation

3. **Admin User**
   - ✅ Can access: All tabs
   - ✅ No restrictions

### Manual Testing Steps

1. **Test Tab Visibility**
   - Log in as viewer → Should see 3 tabs (Jira, GitHub, Releases)
   - Log in as manager → Should see 5 tabs (Jira, K8s, GitHub, Releases, Flows)
   - Log in as admin → Should see 7 tabs (all)

2. **Test Tab Access**
   - Try navigating to restricted tab via URL manipulation
   - Should be redirected to allowed tab
   - Should see "Access Denied" if component is accessed directly

3. **Test API Endpoints**
   - Try accessing protected endpoints without proper role
   - Should receive 403 Forbidden

## Common Issues and Solutions

### Issue: User can see tab but gets "Access Denied"
**Solution**: Component-level RBAC check is working correctly. This is expected behavior for defense in depth.

### Issue: Tab not visible but user can access via URL
**Solution**: Tab validation useEffect should catch this. Check that validation logic is correct.

### Issue: Session storage saves unauthorized tab
**Solution**: Validation on mount should redirect. Check session storage validation logic.

## Future Enhancements

1. **Granular Permissions**: More fine-grained permissions beyond roles
2. **Permission Groups**: Custom permission groups
3. **Resource-Level RBAC**: Control access to specific resources
4. **Audit Logging**: Log all access attempts and denials
5. **Dynamic Permissions**: Load permissions from backend

## Related Files

- `app/page.tsx` - Main page with tab navigation and RBAC
- `contexts/AuthContext.tsx` - Auth context with hasRole, canEdit, canDelete
- `components/AdminPanel.tsx` - Admin panel with RBAC check
- `components/AutomationManagement.tsx` - Automation with RBAC check
- `components/FlowVisualization.tsx` - Flow tracing with RBAC check
- `api-server/server.js` - Backend authentication and authorization middleware


# Admin Panel RBAC Improvements

This document describes the role-based access control improvements made to the Admin Panel.

## Overview

The Admin Panel now has comprehensive role-based access control that differentiates between Admin and Manager roles, providing appropriate permissions and visibility for each role.

## Role-Based Features

### Admin Role
**Full Access:**
- ✅ View all tabs (Users, Kubeconfigs, Settings, Search History, Activities)
- ✅ Create, edit, and delete users
- ✅ Assign any role (viewer, manager, admin)
- ✅ View all user data
- ✅ Manage all kubeconfigs
- ✅ View all settings
- ✅ View all search history
- ✅ View all activities

### Manager Role
**Read-Only Access:**
- ✅ View limited tabs (Kubeconfigs, Settings, Search History, Activities)
- ❌ Cannot access Users tab
- ❌ Cannot create, edit, or delete users
- ✅ View all user data (read-only)
- ✅ View all kubeconfigs
- ✅ View all settings
- ✅ View all search history
- ✅ View all activities

### Viewer Role
- ❌ Cannot access Admin Panel at all

## Implementation Details

### 1. Access Control

```typescript
// Only admins and managers can access
if (!hasRole('admin') && !hasRole('manager')) {
  return <AccessDenied />
}

const isAdmin = hasRole('admin')
const isManager = hasRole('manager') && !hasRole('admin')
```

### 2. Tab Visibility

Tabs are conditionally rendered based on role:

```typescript
const availableTabs = isAdmin 
  ? ['users', 'kubeconfigs', 'settings', 'search-history', 'activities']
  : ['kubeconfigs', 'settings', 'search-history', 'activities'] // Managers can't manage users
```

### 3. Action Permissions

**Users Tab:**
- **Admin**: Can see Actions column with Edit/Delete buttons
- **Manager**: Cannot access Users tab at all

**Other Tabs:**
- **Admin & Manager**: Read-only access (view data only)

### 4. User Management Functions

All user management functions check permissions:

```typescript
const handleCreateUser = async () => {
  if (!isAdmin) {
    setError('Only admins can create users')
    return
  }
  // ... create user logic
}

const handleUpdateUser = async (userId: string, updates: Partial<User>) => {
  if (!isAdmin) {
    setError('Only admins can update users')
    return
  }
  // Prevent non-admins from creating/updating admin users
  if (updates.role === 'admin' && !isAdmin) {
    setError('Only admins can assign admin role')
    return
  }
  // ... update user logic
}

const handleDeleteUser = async (userId: string) => {
  if (!isAdmin) {
    setError('Only admins can delete users')
    return
  }
  // ... delete user logic
}
```

### 5. Role Assignment Restrictions

**Create User Form:**
- Admins can assign any role
- Warning message: "Only admins can create other admin users"

**Edit User Form:**
- Admins can change any role
- Non-admins cannot change role to 'admin' (field disabled with explanation)

### 6. UI Indicators

**Role Badge:**
- Shows "Full Access" for admins (red badge)
- Shows "View Only" for managers (blue badge)

**Info Banner:**
- Managers see a blue info banner explaining their read-only access

**Tab Labels:**
- Users tab shows "(Admin Only)" indicator

**Action Column:**
- Admins see Edit/Delete buttons
- Managers see Eye icon with tooltip "View only - Admin access required for actions"

## Tab Access Matrix

| Tab | Admin | Manager | Viewer |
|-----|-------|---------|--------|
| Users | ✅ Full | ❌ No Access | ❌ No Access |
| All Kubeconfigs | ✅ View | ✅ View | ❌ No Access |
| All Settings | ✅ View | ✅ View | ❌ No Access |
| Search History | ✅ View | ✅ View | ❌ No Access |
| All Activities | ✅ View | ✅ View | ❌ No Access |

## Action Permissions Matrix

| Action | Admin | Manager |
|--------|-------|---------|
| Create User | ✅ | ❌ |
| Edit User | ✅ | ❌ |
| Delete User | ✅ | ❌ |
| Assign Admin Role | ✅ | ❌ |
| View Users | ✅ | ❌ (Tab hidden) |
| View Kubeconfigs | ✅ | ✅ |
| View Settings | ✅ | ✅ |
| View Search History | ✅ | ✅ |
| View Activities | ✅ | ✅ |

## Security Features

### 1. Frontend Validation
- All actions check `isAdmin` before executing
- UI elements hidden/disabled based on role
- Clear error messages for unauthorized actions

### 2. Backend Validation (Recommended)
Backend endpoints should also validate permissions:
```javascript
app.post('/api/users', authenticateToken, authorizeRole('admin'), ...)
app.put('/api/users/:id', authenticateToken, authorizeRole('admin'), ...)
app.delete('/api/users/:id', authenticateToken, authorizeRole('admin'), ...)
```

### 3. Role Assignment Protection
- Non-admins cannot assign 'admin' role
- UI prevents and backend should reject admin role assignment by non-admins

## User Experience Improvements

### 1. Clear Role Indicators
- Role badge in header shows access level
- Info banners explain permissions
- Tab labels indicate restrictions

### 2. Graceful Degradation
- Managers see appropriate tabs for their role
- No confusing "Access Denied" messages for hidden features
- Clear messaging about what they can/cannot do

### 3. Helpful Tooltips
- Action buttons have tooltips
- Disabled fields show explanations
- Info banners provide context

## Testing Checklist

- [ ] Admin can access all tabs
- [ ] Admin can create users with any role
- [ ] Admin can edit users
- [ ] Admin can delete users
- [ ] Manager cannot see Users tab
- [ ] Manager can view other tabs (read-only)
- [ ] Manager cannot create/edit/delete users (if somehow accessed)
- [ ] Viewer cannot access Admin Panel
- [ ] Role assignment restrictions work correctly
- [ ] UI indicators show correct role status

## Future Enhancements

1. **Granular Permissions**: More fine-grained permissions (e.g., managers can edit their team's users)
2. **Audit Logging**: Log all admin actions with user and timestamp
3. **Role Templates**: Predefined permission sets
4. **Delegation**: Allow admins to delegate specific permissions
5. **Activity Filtering**: Managers see only their team's activities

## Related Files

- `components/AdminPanel.tsx` - Main admin panel component
- `contexts/AuthContext.tsx` - Authentication and role checking
- `RBAC_IMPLEMENTATION.md` - Overall RBAC documentation


# Data Storage Summary - What is Stored?

This document explains what user data, sessions, logging history, and role-based authentication information is stored in the application.

## 📊 Storage Overview

The application uses **two storage mechanisms**:
1. **Browser Storage** (sessionStorage/localStorage) - Client-side, temporary
2. **MongoDB** - Server-side, persistent database

---

## 🔐 User Sessions

### Browser (sessionStorage)
**Stored in:** Browser sessionStorage (cleared when tab closes)

**What's stored:**
- ✅ **Auth Token** (JWT) - `authToken`
- ✅ **User Object** - `authUser` (username, email, role, id)
- ✅ **Active Tab** - Current selected tab
- ✅ **Selected Status** - Jira status filter
- ✅ **Jira Table Page** - Current page number

**Location:** `utils/storage.ts` - Uses sessionStorage API

**Security:** 
- Tokens expire after 24 hours
- Cleared on logout or tab close
- Not sent to server except in API requests

---

## 👥 User Details & Accounts

### MongoDB Collection: `users`

**Stored in:** MongoDB database (persistent)

**What's stored per user:**
```javascript
{
  id: "user-1234567890",
  username: "john.doe",
  email: "john@example.com",
  password: "hashed_password", // bcrypt hashed
  role: "admin" | "manager" | "viewer",
  isActive: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  lastLogin: "2024-01-15T10:30:00.000Z" // Updated on each login
}
```

**Features:**
- ✅ Password hashing (bcrypt)
- ✅ Role-based access (admin/manager/viewer)
- ✅ User activation/deactivation
- ✅ Last login tracking
- ✅ Default admin user (username: `admin`, password: `admin123`)

**API Endpoints:**
- `POST /api/users` - Create user (admin only)
- `GET /api/users` - List users (admin only)
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user (admin only)

---

## 🔑 Role-Based Authentication

### Roles Available:
1. **admin** - Full access to all features
2. **manager** - Limited access (can't manage users)
3. **viewer** - Read-only access

### What's Stored:
- ✅ **User Role** - Stored in MongoDB `users` collection
- ✅ **JWT Token** - Contains role in payload: `{ id, username, role, email }`
- ✅ **Role Permissions** - Defined in `types/permissions.ts`

### Role-Based Access Control (RBAC):
- ✅ **17 Resources** with different permissions per role
- ✅ Resources: Users, Roles, Jira, GitHub, Kubernetes, Deployments, Services, Pods, Automation, Releases, Settings, Audit Logs, Search History, Activities, Kubeconfigs, Integrations, Permissions

**Location:** `types/permissions.ts` - Defines all permissions

---

## 📝 Logging History

### MongoDB Collection: `user_activity_log`

**Stored in:** MongoDB database (persistent)

**What's logged:**
```javascript
{
  userId: "user-1234567890",
  action: "view", "create", "update", "delete", "login", "logout", etc.
  resource: "jira", "github", "kubernetes", "deployment", etc.
  details: {
    // Action-specific details
    ip: "192.168.1.1", // Optional
    // ... other details
  },
  timestamp: "2024-01-15T10:30:00.000Z"
}
```

**Features:**
- ✅ All user actions are logged
- ✅ Includes IP address (if available)
- ✅ Timestamp for each action
- ✅ Users can view their own activity
- ✅ Admins can view all users' activities

**API Endpoints:**
- `GET /api/user/activity` - Get own activity log
- `GET /api/admin/activities` - Get all users' activities (admin only)

**Location:** `api-server/server.js` - `logUserActivity()` function

---

## 🔍 Search History

### MongoDB Collection: `user_search_history`

**Stored in:** MongoDB database (persistent)

**What's stored:**
```javascript
{
  userId: "user-1234567890",
  query: "search term",
  type: "general" | "jira" | "github" | "kubernetes",
  filters: {
    // Search filters applied
  },
  timestamp: "2024-01-15T10:30:00.000Z"
}
```

**Features:**
- ✅ Search queries are saved
- ✅ Search filters are stored
- ✅ Users can view their own search history
- ✅ Admins can view all users' search history
- ✅ Users can clear their own history

**API Endpoints:**
- `GET /api/user/search-history` - Get own search history
- `POST /api/user/search-history` - Save search to history
- `DELETE /api/user/search-history` - Clear own history
- `GET /api/admin/search-history` - Get all users' search history (admin only)

---

## ⚙️ User Settings

### MongoDB Collection: `user_settings`

**Stored in:** MongoDB database (persistent)

**What's stored:**
```javascript
{
  userId: "user-1234567890",
  githubToken: "encrypted_token", // Optional
  jiraEmail: "user@example.com", // Optional
  jiraToken: "encrypted_token", // Optional
  jiraUrl: "https://company.atlassian.net", // Optional
  jiraProjectKey: "PROJ", // Optional
  defaultNamespace: "default", // Optional
  // ... other user preferences
}
```

**Features:**
- ✅ Per-user settings
- ✅ GitHub/Jira credentials (encrypted)
- ✅ User preferences
- ✅ Default namespace for Kubernetes

**API Endpoints:**
- `GET /api/user/settings` - Get own settings
- `PUT /api/user/settings` - Update own settings

---

## 🔐 Kubeconfigs

### MongoDB Collection: `kubeconfigs` and `user_kubeconfigs`

**Stored in:** MongoDB database (persistent)

**What's stored:**
```javascript
{
  id: "kubeconfig-123",
  userId: "user-1234567890", // For user-specific kubeconfigs
  name: "Production Cluster",
  kubeconfig: "full_kubeconfig_yaml_content",
  isActive: true,
  createdAt: "2024-01-15T10:30:00.000Z",
  updatedAt: "2024-01-15T10:30:00.000Z"
}
```

**Features:**
- ✅ Multiple kubeconfigs per user
- ✅ Active kubeconfig tracking
- ✅ Admin can view all kubeconfigs
- ✅ Users can manage their own kubeconfigs

---

## 🎫 Access Grants

### MongoDB Collection: `access_grants`

**Stored in:** MongoDB database (persistent)

**What's stored:**
```javascript
{
  id: "grant-123",
  userId: "user-1234567890",
  resource: "kubernetes",
  grantedBy: "admin-user-id",
  expiresAt: "2024-01-20T10:30:00.000Z", // Time-based access
  createdAt: "2024-01-15T10:30:00.000Z"
}
```

**Features:**
- ✅ Time-based access grants
- ✅ Resource-specific permissions
- ✅ Automatic expiration
- ✅ Grant tracking

---

## 📦 Other Data Stored in MongoDB

### Collections:
1. **`prs`** - GitHub Pull Requests
2. **`jira_issues`** - Jira Issues
3. **`automation_config`** - Automation rules and configurations
4. **`user_kubeconfigs`** - User-specific Kubernetes configs

---

## 🌐 Browser Storage (localStorage)

**Stored in:** Browser localStorage (persistent across sessions)

**What's stored:**
- ✅ **API URL** - `apiUrl` (user preference)
- ✅ **GitHub Config** - `githubConfig` (token, organization, etc.)
- ✅ **Jira Config** - `jiraConfig` (baseUrl, email, token, etc.)
- ✅ **Kubeconfig** - `kubeconfig` (deprecated, now in MongoDB)

**Note:** These are user preferences, not sensitive data (except tokens which should be in MongoDB)

---

## 🔒 Security Features

### Password Security:
- ✅ Passwords are **hashed** using bcrypt (never stored in plain text)
- ✅ Default admin password: `admin123` (should be changed in production)

### Token Security:
- ✅ JWT tokens expire after **24 hours**
- ✅ Tokens stored in sessionStorage (cleared on tab close)
- ✅ Tokens include user role for authorization

### Data Protection:
- ✅ Passwords never sent in API responses
- ✅ User data sanitized before sending to client
- ✅ Role-based access control on all endpoints
- ✅ Activity logging for audit trail

---

## 📋 Summary Table

| Data Type | Storage Location | Persistence | Access |
|-----------|-----------------|-------------|---------|
| **User Accounts** | MongoDB `users` | ✅ Persistent | Admin manages all |
| **User Sessions** | Browser sessionStorage | ❌ Temporary | User's browser |
| **Activity Logs** | MongoDB `user_activity_log` | ✅ Persistent | User sees own, Admin sees all |
| **Search History** | MongoDB `user_search_history` | ✅ Persistent | User sees own, Admin sees all |
| **User Settings** | MongoDB `user_settings` | ✅ Persistent | User manages own |
| **Kubeconfigs** | MongoDB `kubeconfigs` | ✅ Persistent | User manages own, Admin sees all |
| **Access Grants** | MongoDB `access_grants` | ✅ Persistent | Admin manages |
| **Roles** | MongoDB `users.role` | ✅ Persistent | Admin manages |
| **JWT Tokens** | Browser sessionStorage | ❌ Temporary | User's browser |
| **Preferences** | Browser localStorage | ✅ Persistent | User's browser |

---

## ✅ Yes, the application stores:

1. ✅ **User Sessions** - In browser sessionStorage (temporary)
2. ✅ **User Details** - In MongoDB (username, email, role, password hash)
3. ✅ **Logging History** - In MongoDB (all user activities)
4. ✅ **Role-Based Login** - Yes, with admin/manager/viewer roles
5. ✅ **Search History** - In MongoDB (user search queries)
6. ✅ **User Settings** - In MongoDB (per-user preferences)
7. ✅ **Access Grants** - In MongoDB (time-based permissions)
8. ✅ **Kubeconfigs** - In MongoDB (Kubernetes cluster configs)

---

## 🔍 How to View Stored Data

### As Admin:
- Go to **Admin Panel** → **Users** tab - View all users
- Go to **Admin Panel** → **Activities** tab - View all activity logs
- Go to **Admin Panel** → **Search History** tab - View all search history
- Go to **Admin Panel** → **Access Grants** tab - View all grants

### As User:
- View your own activity: API endpoint `/api/user/activity`
- View your own search history: API endpoint `/api/user/search-history`
- View your own settings: API endpoint `/api/user/settings`

---

## 🛡️ Privacy & Compliance Notes

- All sensitive data (passwords) are hashed
- Activity logs include IP addresses (if available)
- Search history is stored per-user
- Admins have access to view all user data
- Users can view their own data
- Data persists in MongoDB until manually deleted



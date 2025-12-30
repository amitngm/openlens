# Production Readiness Checklist

This document outlines all the information and configurations needed before deploying FlowOps to production.

## 🔐 Required Credentials & Secrets

### 1. MongoDB Connection
- [ ] **MongoDB Connection String**
  - Format: `mongodb+srv://username:password@cluster.mongodb.net/dbname?retryWrites=true&w=majority`
  - Or: `mongodb://username:password@host:port/dbname`
  - **Where to get:** MongoDB Atlas dashboard or your MongoDB admin
  - **Storage:** Kubernetes Secret (recommended) or ConfigMap
  - **File:** `k8s/secret-mongodb.yaml`

### 2. Kubernetes Cluster Access
- [ ] **Kubeconfig File**
  - Cluster endpoint URL
  - Authentication credentials (certificate, token, or service account)
  - **Storage:** Each manager will configure their own in the UI
  - **Note:** Admins can view all manager kubeconfigs

### 3. Jira Integration (Global - for Admins)
- [ ] **Jira Base URL**
  - Example: `https://yourcompany.atlassian.net`
- [ ] **Jira Email**
  - Email address associated with Jira account
- [ ] **Jira API Token**
  - Generate at: Jira → Account Settings → Security → API tokens
- [ ] **Jira Project Key**
  - Example: `PROJ`, `QA`, `TEST`
- [ ] **Jira Labels (optional)**
  - Comma-separated labels for filtering issues

### 4. GitHub Integration (Global - for Admins)
- [ ] **GitHub Personal Access Token**
  - Generate at: GitHub → Settings → Developer settings → Personal access tokens
  - Required scopes: `repo`, `read:org` (if using organization)
- [ ] **GitHub Organization (optional)**
  - Organization name if syncing from specific org
- [ ] **GitHub Username (optional)**
  - Your GitHub username
- [ ] **Repository List (optional)**
  - Comma-separated list of repositories to sync

### 5. JWT Secret (for Authentication)
- [ ] **JWT Secret Key**
  - Strong random string for signing JWT tokens
  - **Recommendation:** Generate with: `openssl rand -base64 32`
  - **Storage:** Kubernetes Secret
  - **Default:** `your-secret-key-change-in-production` (⚠️ MUST CHANGE)

## 🌐 Infrastructure Configuration

### 6. Domain & Ingress
- [ ] **Domain Name**
  - Example: `qa-dashboard.yourcompany.com`
  - Update in: `k8s/ingress.yaml` or Helm values
- [ ] **SSL/TLS Certificate**
  - Option A: Let's Encrypt (automatic via cert-manager)
  - Option B: Your own certificate
  - **Storage:** Kubernetes Secret
- [ ] **Ingress Controller**
  - Type: nginx, traefik, or your cluster's default
  - Update annotation in `k8s/ingress.yaml`

### 7. Kubernetes Cluster Details
- [ ] **Cluster Name**
- [ ] **Namespace** (default: `qa-pr-dashboard`)
- [ ] **Resource Limits**
  - CPU/Memory limits for frontend and API pods
  - Update in: `k8s/deployment-frontend.yaml` and `k8s/deployment-api.yaml`
- [ ] **Replica Count**
  - Number of replicas for high availability
  - Recommended: 2-3 for production

### 8. Image Registry
- [ ] **Docker Registry Credentials**
  - Registry URL (Docker Hub, ECR, GCR, ACR, etc.)
  - Username and password/token
  - **Storage:** Kubernetes Secret (imagePullSecrets)
- [ ] **Image Tags**
  - Frontend image: `amitngm/qa-pr-dashboard-frontend:tag`
  - API image: `amitngm/qa-pr-dashboard-api:tag`
  - Update in deployment files

## 👥 User Management

### 9. Initial Admin User
- [ ] **Admin Username**
  - Default: `admin` (can be changed)
- [ ] **Admin Password**
  - Default: `admin123` (⚠️ MUST CHANGE in production)
- [ ] **Admin Email**
  - For notifications and account recovery

### 10. Manager Users (Optional - can be created in UI)
- [ ] List of manager usernames/emails
- [ ] Initial passwords (users can change after first login)
- **Note:** Managers will configure their own Jira and Kubernetes settings

## 🔧 Environment Variables

### 11. API Server Environment Variables
```bash
# Required
MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/qa_pr_dashboard"
DB_NAME="qa_pr_dashboard"
NODE_ENV="production"
PORT="8000"
JWT_SECRET="your-strong-random-secret-key"

# Optional
SKIP_MONGO="false"
MONGODB_MAX_POOL_SIZE=10
MONGODB_MIN_POOL_SIZE=2
```

### 12. Frontend Environment Variables
```bash
# Required
NODE_ENV="production"
PORT="3000"
API_URL="http://qa-pr-dashboard-api:8000/api"
NEXT_PUBLIC_API_URL="https://qa-dashboard.yourcompany.com/api"
```

## 📊 Monitoring & Logging

### 13. Monitoring Setup (Optional but Recommended)
- [ ] **Monitoring Solution**
  - Prometheus, Datadog, New Relic, etc.
- [ ] **Metrics Endpoint**
  - Health check: `/api/health`
- [ ] **Alert Configuration**
  - CPU/Memory thresholds
  - Error rate thresholds
  - Database connection alerts

### 14. Logging Setup (Optional but Recommended)
- [ ] **Log Aggregation**
  - ELK Stack, Splunk, CloudWatch, etc.
- [ ] **Log Retention Policy**
  - How long to keep logs
- [ ] **Log Level**
  - Production: `error` or `warn`

## 💾 Backup & Recovery

### 15. Backup Strategy
- [ ] **MongoDB Backup**
  - Automated backup schedule
  - Backup retention policy
  - Recovery testing procedure
- [ ] **Kubernetes Resource Backups**
  - ConfigMaps, Secrets, Deployments
  - Use Velero or similar tool

## 🔒 Security Checklist

### 16. Security Hardening
- [ ] **Change Default Passwords**
  - Admin password
  - JWT secret
- [ ] **Enable HTTPS**
  - SSL/TLS certificates configured
  - HTTP to HTTPS redirect
- [ ] **Network Policies**
  - Restrict pod-to-pod communication
  - Limit external access
- [ ] **RBAC Configuration**
  - Service account permissions
  - ClusterRole/Role bindings
- [ ] **Secrets Management**
  - All secrets stored in Kubernetes Secrets (not ConfigMaps)
  - Secrets encrypted at rest
- [ ] **Image Security**
  - Scan images for vulnerabilities
  - Use specific image tags (not `latest`)

## 📝 Pre-Deployment Checklist

### 17. Testing
- [ ] **Load Testing**
  - Test with expected user load
  - Verify resource limits are adequate
- [ ] **Integration Testing**
  - Jira connection works
  - GitHub connection works (if used)
  - Kubernetes operations work
- [ ] **Security Testing**
  - Penetration testing
  - Vulnerability scanning

### 18. Documentation
- [ ] **Runbook Created**
  - Common issues and solutions
  - Escalation procedures
- [ ] **User Documentation**
  - How to use the application
  - How to configure manager settings
- [ ] **API Documentation**
  - Endpoint documentation
  - Authentication flow

## 🚀 Deployment Steps

### 19. Pre-Deployment
```bash
# 1. Create namespace
kubectl create namespace qa-pr-dashboard

# 2. Create MongoDB secret
kubectl create secret generic mongodb-secret \
  --namespace qa-pr-dashboard \
  --from-literal=mongodb-uri='your-connection-string'

# 3. Create JWT secret
kubectl create secret generic jwt-secret \
  --namespace qa-pr-dashboard \
  --from-literal=jwt-secret='your-strong-random-key'

# 4. Create image pull secret (if using private registry)
kubectl create secret docker-registry regcred \
  --namespace qa-pr-dashboard \
  --docker-server=your-registry.com \
  --docker-username=your-username \
  --docker-password=your-password
```

### 20. Deployment
```bash
# 1. Apply ConfigMaps
kubectl apply -f k8s/configmap-frontend.yaml
kubectl apply -f k8s/configmap-api.yaml

# 2. Apply Services
kubectl apply -f k8s/service-frontend.yaml
kubectl apply -f k8s/service-api.yaml

# 3. Apply Deployments
kubectl apply -f k8s/deployment-frontend.yaml
kubectl apply -f k8s/deployment-api.yaml

# 4. Apply Ingress
kubectl apply -f k8s/ingress.yaml

# 5. Verify deployment
kubectl get pods -n qa-pr-dashboard
kubectl get svc -n qa-pr-dashboard
kubectl get ingress -n qa-pr-dashboard
```

## 📋 Quick Reference: Information Needed

**Before going to production, provide:**

1. ✅ MongoDB connection string
2. ✅ JWT secret (strong random key)
3. ✅ Domain name for the application
4. ✅ SSL/TLS certificate (or use Let's Encrypt)
5. ✅ Docker registry credentials (if using private registry)
6. ✅ Initial admin credentials (change from defaults)
7. ✅ Jira credentials (if using global config)
8. ✅ GitHub token (if using global config)
9. ✅ Kubernetes cluster access details
10. ✅ Resource limits and replica counts
11. ✅ Monitoring/logging setup preferences
12. ✅ Backup strategy requirements

## 🔄 Post-Deployment

### 21. Verification
- [ ] Application is accessible via domain
- [ ] MongoDB connection successful
- [ ] Admin user can login
- [ ] Jira sync works (if configured)
- [ ] Kubernetes operations work
- [ ] Manager settings can be configured
- [ ] All endpoints respond correctly

### 22. Monitoring
- [ ] Set up alerts
- [ ] Monitor resource usage
- [ ] Check error logs
- [ ] Verify backup jobs are running

## 📞 Support Contacts

- **MongoDB Support:** [Your MongoDB support contact]
- **Kubernetes Admin:** [Your K8s admin contact]
- **Application Owner:** [Your contact]
- **On-Call Rotation:** [On-call schedule]

---

**⚠️ IMPORTANT:** Never commit secrets or credentials to git. Always use Kubernetes Secrets or secure secret management systems.

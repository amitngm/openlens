# MongoDB Production Setup Guide

## Production MongoDB Options

### Option 1: MongoDB Atlas (Recommended for Production)

**MongoDB Atlas** is the official cloud-hosted MongoDB service with a free tier available.

#### Setup Steps:

1. **Sign up for MongoDB Atlas:**
   - Go to: https://www.mongodb.com/cloud/atlas/register
   - Create a free account (M0 cluster is free forever)

2. **Create a Cluster:**
   - Choose your cloud provider (AWS, GCP, Azure)
   - Select a region closest to your deployment
   - Choose M0 (Free) tier for development/testing
   - Click "Create Cluster"

3. **Configure Database Access:**
   - Go to "Database Access" → "Add New Database User"
   - Create a username and password (save these!)
   - Set user privileges: "Read and write to any database"

4. **Configure Network Access:**
   - Go to "Network Access" → "Add IP Address"
   - For production: Add your Kubernetes cluster IP ranges
   - For testing: Click "Allow Access from Anywhere" (0.0.0.0/0)

5. **Get Connection String:**
   - Click "Connect" on your cluster
   - Choose "Connect your application"
   - Copy the connection string
   - Replace `<password>` with your database user password
   - Example: `mongodb+srv://username:password@cluster.mongodb.net/qa_pr_dashboard?retryWrites=true&w=majority`

6. **Set Environment Variable:**
   ```bash
   export MONGODB_URI="mongodb+srv://username:password@cluster.mongodb.net/qa_pr_dashboard?retryWrites=true&w=majority"
   ```

### Option 2: Managed MongoDB Service (AWS DocumentDB, Azure Cosmos DB)

#### AWS DocumentDB:
```bash
# Connection string format
mongodb://username:password@docdb-cluster-endpoint:27017/qa_pr_dashboard?ssl=true&ssl_ca_certs=rds-combined-ca-bundle.pem
```

#### Azure Cosmos DB:
```bash
# Connection string format
mongodb://username:password@cluster.mongo.cosmos.azure.com:10255/qa_pr_dashboard?ssl=true&replicaSet=globaldb
```

### Option 3: Self-Hosted MongoDB in Kubernetes

#### Using MongoDB Helm Chart:

```bash
# Add MongoDB Helm repository
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# Install MongoDB
helm install mongodb bitnami/mongodb \
  --namespace qa-pr-dashboard \
  --create-namespace \
  --set auth.rootPassword=your-root-password \
  --set auth.username=qa-pr-user \
  --set auth.password=your-user-password \
  --set auth.database=qa_pr_dashboard

# Get connection string
kubectl get secret mongodb -n qa-pr-dashboard -o jsonpath='{.data.mongodb-uri}' | base64 -d
```

#### Update ConfigMap:

```yaml
# k8s/configmap-api.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: qa-pr-dashboard-api-config
  namespace: qa-pr-dashboard
data:
  MONGODB_URI: "mongodb://qa-pr-user:your-user-password@mongodb:27017/qa_pr_dashboard?authSource=qa_pr_dashboard"
```

### Option 4: External MongoDB Server

If you have a dedicated MongoDB server:

```bash
# Connection string format
mongodb://username:password@mongodb-server.example.com:27017/qa_pr_dashboard?authSource=admin
```

## Production Configuration

### Environment Variables

Set these in your Kubernetes deployment or environment:

```bash
# Required
MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/qa_pr_dashboard?retryWrites=true&w=majority"
DB_NAME="qa_pr_dashboard"

# Optional (for connection pooling)
MONGODB_MAX_POOL_SIZE=10
MONGODB_MIN_POOL_SIZE=2
```

### Kubernetes Secret (Recommended)

Create a secret for MongoDB credentials:

```bash
kubectl create secret generic mongodb-secret \
  --namespace qa-pr-dashboard \
  --from-literal=mongodb-uri='mongodb+srv://user:pass@cluster.mongodb.net/qa_pr_dashboard'
```

Update deployment to use secret:

```yaml
env:
  - name: MONGODB_URI
    valueFrom:
      secretKeyRef:
        name: mongodb-secret
        key: mongodb-uri
```

### Helm Values Configuration

Update `helm/qa-pr-dashboard/values-production.yaml`:

```yaml
env:
  api:
    MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net/qa_pr_dashboard"
    DB_NAME: "qa_pr_dashboard"
    SKIP_MONGO: "false"
```

## Verification

After setting up MongoDB:

1. **Check connection in logs:**
   ```
   ✅ Connected to MongoDB
   📊 Loaded X PRs, Y Jira issues, and Z users from MongoDB
   ```

2. **Test connection:**
   ```bash
   # From API server pod
   kubectl exec -it qa-pr-dashboard-api-xxx -n qa-pr-dashboard -- node -e "
   const { MongoClient } = require('mongodb');
   const client = new MongoClient(process.env.MONGODB_URI);
   client.connect().then(() => {
     console.log('✅ MongoDB connection successful');
     client.close();
   }).catch(err => {
     console.error('❌ MongoDB connection failed:', err.message);
     process.exit(1);
   });
   "
   ```

## Security Best Practices

1. **Use Secrets:** Never hardcode MongoDB credentials in code or configmaps
2. **Network Security:** Restrict MongoDB access to specific IP ranges
3. **Authentication:** Always use username/password authentication
4. **SSL/TLS:** Enable SSL for all MongoDB connections (Atlas does this by default)
5. **Backup:** Set up regular backups for production data
6. **Monitoring:** Monitor MongoDB performance and connection health

## Troubleshooting

### Connection Timeout
- Check network access rules (firewall, security groups)
- Verify connection string is correct
- Check if MongoDB server is accessible from your cluster

### Authentication Failed
- Verify username and password
- Check database user permissions
- Ensure `authSource` is correct in connection string

### SSL/TLS Errors
- For Atlas: SSL is required, ensure connection string includes `?ssl=true`
- For self-hosted: May need to disable SSL or provide certificates

## Migration from In-Memory to MongoDB

1. **Export current data (if any):**
   - Data in in-memory storage will be lost
   - Export any important data before switching

2. **Set MONGODB_URI:**
   ```bash
   export MONGODB_URI="your-connection-string"
   ```

3. **Restart API server:**
   - The server will automatically connect and create collections
   - Default admin user will be created if no users exist

4. **Verify data persistence:**
   - Create test data
   - Restart server
   - Verify data still exists

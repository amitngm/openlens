import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import https from 'https';
import { MongoClient } from 'mongodb';
import * as k8s from '@kubernetes/client-node';
import yaml from 'js-yaml';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { correlationIdMiddleware, propagateTraceHeaders, setupAxiosTracing, getTraceContext } from './middleware/tracing.js';
import { initializeTracing, getTracer } from './middleware/opentelemetry.js';

dotenv.config();

// Initialize OpenTelemetry tracing (must be done before importing other modules)
initializeTracing();

// Setup axios to automatically propagate trace headers
setupAxiosTracing(axios);

const app = express();
const PORT = process.env.PORT || 8000;

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'qa_pr_dashboard';
const PRS_COLLECTION = 'prs';
const JIRA_ISSUES_COLLECTION = 'jira_issues';
const USERS_COLLECTION = 'users';
const AUTOMATION_COLLECTION = 'automation_config';
const KUBECONFIGS_COLLECTION = 'kubeconfigs';
const USER_SETTINGS_COLLECTION = 'user_settings';
const USER_SEARCH_HISTORY_COLLECTION = 'user_search_history';
const USER_KUBECONFIGS_COLLECTION = 'user_kubeconfigs';
const USER_ACTIVITY_LOG_COLLECTION = 'user_activity_log';
const ACCESS_GRANTS_COLLECTION = 'access_grants';
const USER_SESSIONS_COLLECTION = 'user_sessions';

let mongoClient = null;
let db = null;

// In-memory storage (loaded from MongoDB)
let prsData = [];
let jiraIssuesData = [];
let usersData = [];
let kubeconfigsData = []; // Array of { id, name, kubeconfig, isActive, createdAt, updatedAt }
let accessGrantsData = []; // Array of access grants for time-based access
let sessionsData = []; // Array of active user sessions
let automationConfig = {
  enabled: true,
  autoLinkPRToJira: true,
  autoAssign: true,
  statusSync: true,
  webhooks: {
    github: { enabled: false, secret: '' },
    jira: { enabled: false, secret: '' }
  },
  autoAssignRules: [],
  statusSyncRules: [],
  statusBasedAssignRules: [], // Rules for assigning based on Jira status changes
  customRules: [],
  scheduledReports: [],
  blockerDetection: {
    enabled: true,
    keywords: ['blocked', 'blocker', 'blocking', 'cannot proceed', 'stuck'],
    notificationChannels: []
  }
};

// JWT secret (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Connect to MongoDB
async function connectMongoDB() {
  try {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    db = mongoClient.db(DB_NAME);
    console.log('✅ Connected to MongoDB');
    
    // Load existing data from MongoDB
    await loadDataFromMongoDB();
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    console.log('⚠️  Continuing without MongoDB (using in-memory storage)');
    console.log('📖 To enable MongoDB persistence:');
    console.log('   1. Install MongoDB: brew install mongodb-community (macOS)');
    console.log('   2. Start MongoDB: brew services start mongodb-community');
    console.log('   3. Or use Docker: docker run -d -p 27017:27017 --name mongodb mongo:latest');
    console.log('   4. See MONGODB_SETUP.md for detailed instructions');
    // Initialize default admin even if MongoDB connection fails
    await initializeDefaultAdmin();
  }
  
  // Ensure default admin exists regardless of MongoDB status
  if (usersData.length === 0) {
    console.log('⚠️  No users found, initializing default admin...');
    await initializeDefaultAdmin();
  }
}

// Initialize default admin user (for in-memory storage)
async function initializeDefaultAdmin() {
  if (usersData.length === 0) {
    try {
      const defaultPassword = await bcrypt.hash('admin123', 10);
      const defaultAdmin = {
        id: `user-${Date.now()}`,
        username: 'admin',
        email: 'admin@example.com',
        password: defaultPassword,
        role: 'admin',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true
      };
      usersData.push(defaultAdmin);
      console.log('✅ Created default admin user (username: admin, password: admin123)');
      console.log(`✅ usersData length after initialization: ${usersData.length}`);
      return true;
    } catch (error) {
      console.error('❌ Error initializing default admin:', error);
      return false;
    }
  }
  return true;
}

// Load data from MongoDB
async function loadDataFromMongoDB() {
  if (!db) {
    // Initialize default admin for in-memory storage
    await initializeDefaultAdmin();
    return;
  }
  
  try {
    const prsCollection = db.collection(PRS_COLLECTION);
    const jiraCollection = db.collection(JIRA_ISSUES_COLLECTION);
    const usersCollection = db.collection(USERS_COLLECTION);
    const accessGrantsCollection = db.collection(ACCESS_GRANTS_COLLECTION);
    
    prsData = await prsCollection.find({}).toArray();
    jiraIssuesData = await jiraCollection.find({}).toArray();
    usersData = await usersCollection.find({}).toArray();
    accessGrantsData = await accessGrantsCollection.find({}).toArray();
    
    // Load kubeconfigs (legacy - will be migrated to user-specific collection)
    await loadKubeconfigsFromMongoDB();
    
    // Load automation config
    await loadAutomationConfig();
    
    console.log(`📊 Loaded ${prsData.length} PRs, ${jiraIssuesData.length} Jira issues, ${usersData.length} users, and ${accessGrantsData.length} access grants from MongoDB`);
    
    // Initialize default admin user if no users exist
    if (usersData.length === 0) {
      console.log('⚠️  No users found in database, creating default admin...');
      const defaultPassword = await bcrypt.hash('admin123', 10);
      const defaultAdmin = {
        id: `user-${Date.now()}`,
        username: 'admin',
        email: 'admin@example.com',
        password: defaultPassword,
        role: 'admin',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true
      };
      try {
        await usersCollection.insertOne(defaultAdmin);
        usersData = [defaultAdmin];
        console.log('✅ Created default admin user in MongoDB (username: admin, password: admin123)');
      } catch (insertError) {
        console.error('❌ Error inserting default admin to MongoDB:', insertError.message);
        // Fall back to in-memory
        usersData = [defaultAdmin];
        console.log('✅ Created default admin user in memory (username: admin, password: admin123)');
      }
    }
  } catch (error) {
    console.error('❌ Error loading data from MongoDB:', error.message);
    // Initialize default admin even if MongoDB fails
    await initializeDefaultAdmin();
  }
  
  // Final safety check - ensure we have at least one user
  if (usersData.length === 0) {
    console.log('⚠️  Final safety check: No users found, initializing default admin...');
    await initializeDefaultAdmin();
  }
}

// Save PRs to MongoDB
async function savePRsToMongoDB() {
  if (!db || !prsData.length) return;
  
  try {
    const collection = db.collection(PRS_COLLECTION);
    // Clear existing data and insert new
    await collection.deleteMany({});
    if (prsData.length > 0) {
      await collection.insertMany(prsData);
      console.log(`💾 Saved ${prsData.length} PRs to MongoDB`);
    }
  } catch (error) {
    console.error('❌ Error saving PRs to MongoDB:', error.message);
  }
}

// Save Jira issues to MongoDB
async function saveJiraIssuesToMongoDB() {
  if (!db || !jiraIssuesData.length) return;
  
  try {
    const collection = db.collection(JIRA_ISSUES_COLLECTION);
    // Clear existing data and insert new
    await collection.deleteMany({});
    if (jiraIssuesData.length > 0) {
      await collection.insertMany(jiraIssuesData);
      console.log(`💾 Saved ${jiraIssuesData.length} Jira issues to MongoDB`);
    }
  } catch (error) {
    console.error('❌ Error saving Jira issues to MongoDB:', error.message);
  }
}

// Save users to MongoDB
async function saveUsersToMongoDB() {
  if (!db) {
    console.warn('⚠️ MongoDB not connected, users not persisted');
    return;
  }
  
  try {
    const collection = db.collection(USERS_COLLECTION);
    // Update or insert users
    let savedCount = 0;
    for (const user of usersData) {
      const result = await collection.updateOne(
        { id: user.id },
        { $set: user },
        { upsert: true }
      );
      if (result.upsertedCount > 0 || result.modifiedCount > 0) {
        savedCount++;
      }
    }
    if (savedCount > 0) {
      console.log(`💾 Saved ${savedCount}/${usersData.length} users to MongoDB`);
    }
  } catch (error) {
    console.error('❌ Error saving users to MongoDB:', error);
    throw error; // Re-throw to allow callers to handle
  }
}

// Save access grants to MongoDB
async function saveAccessGrantsToMongoDB() {
  if (!db) {
    console.warn('⚠️ MongoDB not connected, access grants not persisted');
    return;
  }
  
  try {
    const collection = db.collection(ACCESS_GRANTS_COLLECTION);
    // Update or insert access grants
    let savedCount = 0;
    for (const grant of accessGrantsData) {
      const result = await collection.updateOne(
        { id: grant.id },
        { $set: grant },
        { upsert: true }
      );
      if (result.upsertedCount > 0 || result.modifiedCount > 0) {
        savedCount++;
      }
    }
    if (savedCount > 0) {
      console.log(`💾 Saved ${savedCount}/${accessGrantsData.length} access grants to MongoDB`);
    }
  } catch (error) {
    console.error('❌ Error saving access grants to MongoDB:', error);
    throw error;
  }
}

// Check if user has active access grant for a resource
function hasActiveAccessGrant(userId, resource) {
  const now = new Date();
  return accessGrantsData.some(grant => 
    grant.userId === userId &&
    grant.resource === resource &&
    grant.isActive &&
    new Date(grant.startTime) <= now &&
    new Date(grant.endTime) >= now &&
    !grant.revokedAt
  );
}

// ==================== SESSION MANAGEMENT ====================

// Generate unique session ID
function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Create user session
async function createUserSession(userId, token, ipAddress = null, userAgent = null) {
  const sessionId = generateSessionId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
  
  const session = {
    sessionId,
    userId,
    token,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastActivity: now.toISOString(),
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
    isActive: true
  };
  
  // Add to in-memory storage
  sessionsData.push(session);
  
  // Save to MongoDB if available
  if (db) {
    try {
      const collection = db.collection(USER_SESSIONS_COLLECTION);
      await collection.insertOne(session);
      console.log(`✅ Created session ${sessionId} for user ${userId}`);
    } catch (error) {
      console.error('❌ Error saving session to MongoDB:', error);
    }
  }
  
  return session;
}

// Validate session
async function validateSession(sessionId) {
  if (!sessionId) return null;
  
  const now = new Date();
  
  // Check in-memory first
  let session = sessionsData.find(s => 
    s.sessionId === sessionId && 
    s.isActive && 
    new Date(s.expiresAt) > now
  );
  
  // If not in memory, check MongoDB
  if (!session && db) {
    try {
      const collection = db.collection(USER_SESSIONS_COLLECTION);
      session = await collection.findOne({
        sessionId,
        isActive: true,
        expiresAt: { $gt: now.toISOString() }
      });
      
      if (session) {
        // Update last activity
        await collection.updateOne(
          { sessionId },
          { $set: { lastActivity: now.toISOString() } }
        );
        session.lastActivity = now.toISOString();
        
        // Add to in-memory cache
        const existingIndex = sessionsData.findIndex(s => s.sessionId === sessionId);
        if (existingIndex >= 0) {
          sessionsData[existingIndex] = session;
        } else {
          sessionsData.push(session);
        }
      }
    } catch (error) {
      console.error('❌ Error validating session in MongoDB:', error);
    }
  }
  
  if (session) {
    // Update last activity
    session.lastActivity = now.toISOString();
    if (db) {
      try {
        const collection = db.collection(USER_SESSIONS_COLLECTION);
        await collection.updateOne(
          { sessionId },
          { $set: { lastActivity: now.toISOString() } }
        );
      } catch (error) {
        console.error('❌ Error updating session activity:', error);
      }
    }
  }
  
  return session;
}

// Delete session (logout)
async function deleteSession(sessionId) {
  if (!sessionId) return;
  
  // Remove from in-memory
  const index = sessionsData.findIndex(s => s.sessionId === sessionId);
  if (index >= 0) {
    sessionsData.splice(index, 1);
  }
  
  // Remove from MongoDB
  if (db) {
    try {
      const collection = db.collection(USER_SESSIONS_COLLECTION);
      await collection.updateOne(
        { sessionId },
        { $set: { isActive: false, deletedAt: new Date().toISOString() } }
      );
      console.log(`✅ Deleted session ${sessionId}`);
    } catch (error) {
      console.error('❌ Error deleting session from MongoDB:', error);
    }
  }
}

// Delete all sessions for a user
async function deleteUserSessions(userId) {
  // Remove from in-memory
  sessionsData = sessionsData.filter(s => s.userId !== userId);
  
  // Remove from MongoDB
  if (db) {
    try {
      const collection = db.collection(USER_SESSIONS_COLLECTION);
      await collection.updateMany(
        { userId, isActive: true },
        { $set: { isActive: false, deletedAt: new Date().toISOString() } }
      );
      console.log(`✅ Deleted all sessions for user ${userId}`);
    } catch (error) {
      console.error('❌ Error deleting user sessions from MongoDB:', error);
    }
  }
}

// Cleanup expired sessions
async function cleanupExpiredSessions() {
  const now = new Date();
  
  // Clean in-memory
  const beforeCount = sessionsData.length;
  sessionsData = sessionsData.filter(s => new Date(s.expiresAt) > now);
  const removedCount = beforeCount - sessionsData.length;
  
  // Clean MongoDB
  if (db) {
    try {
      const collection = db.collection(USER_SESSIONS_COLLECTION);
      const result = await collection.deleteMany({
        expiresAt: { $lt: now.toISOString() },
        isActive: true
      });
      if (result.deletedCount > 0) {
        console.log(`🧹 Cleaned up ${result.deletedCount} expired sessions from MongoDB`);
      }
    } catch (error) {
      console.error('❌ Error cleaning up expired sessions:', error);
    }
  }
  
  if (removedCount > 0) {
    console.log(`🧹 Cleaned up ${removedCount} expired sessions from memory`);
  }
}

// Run cleanup every hour
setInterval(() => {
  cleanupExpiredSessions().catch(err => console.error('Session cleanup error:', err));
}, 60 * 60 * 1000); // 1 hour

// ==================== END SESSION MANAGEMENT ====================

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Distributed tracing middleware (must be early in the chain)
app.use(correlationIdMiddleware);

// Async error wrapper to catch unhandled promise rejections in async route handlers
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Helper function to check if a PR is linked to a Jira issue
function isPRLinkedToJira(pr, jiraIssues) {
  if (!jiraIssues || jiraIssues.length === 0) return false;
  if (!pr.jira) return false;
  
  const prJira = (pr.jira || '').trim().toUpperCase();
  
  return jiraIssues.some(issue => {
    const issueKey = (issue.key || '').trim().toUpperCase();
    // Exact match
    if (prJira === issueKey) return true;
    // PR.jira contains the full key
    if (prJira.includes(issueKey)) return true;
    // Extract ticket numbers and compare
    const prNumber = prJira.replace(/^[A-Z]+-/, '');
    const issueNumber = issueKey.replace(/^[A-Z]+-/, '');
    if (prNumber && issueNumber && prNumber === issueNumber) {
      return true;
    }
    return false;
  });
}

// Helper function to calculate stats from PRs linked to Jira tickets
function calculateStats(prs, jiraIssues) {
  // Only count PRs that are linked to Jira tickets
  const linkedPRs = jiraIssues && jiraIssues.length > 0
    ? prs.filter(pr => isPRLinkedToJira(pr, jiraIssues))
    : [];
  
  // Calculate stats from linked PRs only
  return {
    totalActive: linkedPRs.length, // Total PRs raised (linked to Jira tickets)
    pending: linkedPRs.filter(pr => pr.qaStatus === 'Pending').length,
    inReview: linkedPRs.filter(pr => pr.qaStatus === 'In Review').length,
    approved: linkedPRs.filter(pr => pr.qaStatus === 'Approved').length,
    rejected: linkedPRs.filter(pr => pr.qaStatus === 'Rejected').length,
    merged: linkedPRs.filter(pr => pr.mergeStatus === 'Merged').length,
  };
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'API server is running' });
});

// Get detailed deployment information
app.get('/api/k8s/deployments/:namespace/:name', async (req, res) => {
  try {
    if (!k8sAppsApi) {
      return res.status(400).json({ error: 'Not connected', message: 'Please connect to a Kubernetes cluster first' });
    }

    const { namespace, name } = req.params;
    
    if (!namespace || !name) {
      return res.status(400).json({ error: 'Invalid parameters', message: 'Namespace and name are required' });
    }

    let response;
    try {
      response = await k8sAppsApi.readNamespacedDeployment(name, namespace);
    } catch (libraryError) {
      console.log('⚠️ Library method failed, using direct HTTP call...');
      response = await makeK8sDirectHttpCall(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`, null);
    }

    const deployment = response?.body || response;
    
    res.json({ success: true, deployment });
  } catch (error) {
    console.error('❌ Error fetching deployment details:', error);
    res.status(500).json({ error: 'Failed to fetch deployment details', message: error.message || 'Error fetching deployment from Kubernetes' });
  }
});

// Get detailed service information
app.get('/api/k8s/services/:namespace/:name', async (req, res) => {
  try {
    if (!k8sApi) {
      return res.status(400).json({ error: 'Not connected', message: 'Please connect to a Kubernetes cluster first' });
    }

    const { namespace, name } = req.params;
    
    if (!namespace || !name) {
      return res.status(400).json({ error: 'Invalid parameters', message: 'Namespace and name are required' });
    }

    let response;
    try {
      response = await k8sApi.readNamespacedService(name, namespace);
    } catch (libraryError) {
      console.log('⚠️ Library method failed, using direct HTTP call...');
      response = await makeK8sDirectHttpCall(`/api/v1/namespaces/${encodeURIComponent(namespace)}/services/${encodeURIComponent(name)}`, null);
    }

    const service = response?.body || response;
    
    res.json({ success: true, service });
  } catch (error) {
    console.error('❌ Error fetching service details:', error);
    res.status(500).json({ error: 'Failed to fetch service details', message: error.message || 'Error fetching service from Kubernetes' });
  }
});

// Get pods by namespace (MUST come before /api/k8s/pods/:namespace/:name to avoid route conflicts)
app.get('/api/k8s/pods/:namespace', async (req, res) => {
  try {
    if (!k8sApi) {
      return res.status(400).json({
        success: false,
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const { namespace } = req.params;
    const deploymentName = req.query.deployment; // Optional deployment filter
    
    if (!namespace || namespace.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Invalid namespace',
        message: 'Namespace parameter is required and cannot be empty'
      });
    }
    
    const namespaceParam = namespace.trim();
    console.log('📦 Fetching pods from namespace (path param):', namespaceParam, 'Deployment filter:', deploymentName);
    
    if (!k8sApi || typeof k8sApi.listNamespacedPod !== 'function') {
      throw new Error('k8sApi is not properly initialized');
    }
    
    let response;
    try {
      response = await k8sApi.listNamespacedPod(namespaceParam);
    } catch (libraryError) {
      console.log('⚠️ Library method failed, using direct HTTP call...');
      response = await makeK8sDirectHttpCall(`/api/v1/namespaces/${encodeURIComponent(namespaceParam)}/pods`, null);
    }

    const items = response?.body?.items || response?.items || [];
    
    let pods = items.map((pod) => {
      const containers = pod.spec.containers || [];
      const initContainers = pod.spec.initContainers || [];
      const labels = pod.metadata.labels || {};
      
      // Try to determine deployment from labels
      let deployment = labels['app'] || labels['app.kubernetes.io/name'] || labels['k8s-app'];
      if (!deployment && pod.metadata.ownerReferences) {
        const ownerRef = pod.metadata.ownerReferences.find(ref => ref.kind === 'ReplicaSet');
        if (ownerRef) {
          // Extract deployment name from ReplicaSet name (usually deployment-<hash>)
          deployment = ownerRef.name.replace(/-[a-z0-9]{5,10}$/, '');
        }
      }
      
      return {
        name: pod.metadata.name,
        namespace: pod.metadata.namespace,
        status: pod.status.phase,
        nodeName: pod.spec.nodeName,
        hostIP: pod.status.hostIP,
        podIP: pod.status.podIP,
        restartCount: pod.status.containerStatuses?.[0]?.restartCount || 0,
        ready: pod.status.containerStatuses?.every((cs) => cs.ready) || false,
        deployment: deployment,
        containers: containers.map((container) => ({
          name: container.name,
          image: container.image,
          imagePullPolicy: container.imagePullPolicy,
          ready: pod.status.containerStatuses?.find((cs) => cs.name === container.name)?.ready || false,
          restartCount: pod.status.containerStatuses?.find((cs) => cs.name === container.name)?.restartCount || 0
        })),
        initContainers: initContainers.map((container) => ({
          name: container.name,
          image: container.image
        })),
        labels: labels,
        creationTimestamp: pod.metadata.creationTimestamp,
        startTime: pod.status.startTime
      };
    });
    
    // Filter by deployment if specified
    if (deploymentName) {
      pods = pods.filter(pod => 
        pod.deployment === deploymentName || 
        pod.name.includes(deploymentName) ||
        pod.name.includes(deploymentName.toLowerCase())
      );
    }
    
    console.log(`✅ Found ${pods.length} pods in namespace ${namespaceParam}${deploymentName ? ` (filtered by deployment: ${deploymentName})` : ''}`);
    
    res.json({ success: true, pods });
  } catch (error) {
    console.error('❌ Error fetching pods by namespace:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pods',
      message: error.message || 'Error fetching pods from Kubernetes'
    });
  }
});

// Get pod events (MUST come before /api/k8s/pods/:namespace/:name to avoid route conflicts)
app.get('/api/k8s/pods/:namespace/:name/events', async (req, res) => {
  try {
    if (!k8sApi || !currentKubeConfig) {
      return res.status(400).json({ success: false, error: 'Not connected', message: 'Please connect to a Kubernetes cluster first' });
    }

    const { namespace, name } = req.params;
    
    if (!namespace || !name) {
      return res.status(400).json({ success: false, error: 'Invalid parameters', message: 'Namespace and name are required' });
    }

    try {
      // Use k8sApi (CoreV1Api) to get events
      const eventsResponse = await k8sApi.listNamespacedEvent(
        namespace,
        undefined,
        undefined,
        undefined,
        `involvedObject.name=${name},involvedObject.kind=Pod`
      );
      
      const events = (eventsResponse?.body?.items || eventsResponse?.items || []).map(event => ({
        type: event.type,
        reason: event.reason,
        message: event.message,
        firstTimestamp: event.firstTimestamp,
        lastTimestamp: event.lastTimestamp,
        count: event.count,
        involvedObject: {
          kind: event.involvedObject?.kind,
          name: event.involvedObject?.name,
          namespace: event.involvedObject?.namespace
        }
      }));

      res.json({ success: true, events });
    } catch (error) {
      console.error('Error fetching pod events:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch pod events' });
    }
  } catch (error) {
    console.error('Error in pod events endpoint:', error);
    res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
});

// Get pod logs (MUST come before /api/k8s/pods/:namespace/:name to avoid route conflicts)
app.get('/api/k8s/pods/:namespace/:name/logs', async (req, res) => {
  try {
    if (!k8sApi || !currentKubeConfig) {
      return res.status(400).json({ success: false, error: 'Not connected', message: 'Please connect to a Kubernetes cluster first' });
    }

    const { namespace, name } = req.params;
    const { container, tailLines } = req.query;
    
    if (!namespace || !name) {
      return res.status(400).json({ success: false, error: 'Invalid parameters', message: 'Namespace and name are required' });
    }

    try {
      // Use direct HTTP call as the library method may have issues
      const logPath = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}/log`;
      const logParams = new URLSearchParams();
      if (container) logParams.append('container', container);
      // Only add tailLines if it's specified and not 'all' - omitting it will fetch all logs from pod lifetime
      // Default behavior: fetch all logs (pod lifetime) to ensure minimum 500+ logs
      if (tailLines && tailLines !== 'all') {
        const lines = parseInt(tailLines.toString());
        // Ensure minimum of 500 logs if a number is specified
        logParams.append('tailLines', Math.max(lines, 500).toString());
      }
      // If tailLines is 'all' or not specified, don't add tailLines parameter - this fetches all logs
      logParams.append('timestamps', 'true');
      
      // Use the same method as makeK8sDirectHttpCall for consistency
      const cluster = currentKubeConfig.getCurrentCluster();
      if (!cluster || !cluster.server) {
        throw new Error('Unable to determine cluster server URL');
      }
      
      const https = await import('https');
      const opts = {};
      currentKubeConfig.applyToHTTPSOptions(opts);
      
      // Create HTTPS agent with certificates if available (same as makeK8sDirectHttpCall)
      let httpsAgent = null;
      
      // Check if cluster has insecure-skip-tls-verify set
      const skipTLSVerify = cluster.skipTLSVerify === true;
      
      if (opts.ca || opts.cert || opts.key) {
        httpsAgent = new https.Agent({
          ca: opts.ca,
          cert: opts.cert,
          key: opts.key,
          rejectUnauthorized: !skipTLSVerify && opts.rejectUnauthorized !== false
        });
      } else if (opts.httpsAgent) {
        // Use the agent from opts if it exists, but override rejectUnauthorized if needed
        if (skipTLSVerify && opts.httpsAgent.options) {
          opts.httpsAgent.options.rejectUnauthorized = false;
        }
        httpsAgent = opts.httpsAgent;
      } else if (skipTLSVerify) {
        // Create a new agent with rejectUnauthorized: false for insecure clusters
        httpsAgent = new https.Agent({
          rejectUnauthorized: false
        });
      }
      
      // Prepare headers
      const headers = {};
      if (opts.headers) {
        Object.assign(headers, opts.headers);
      }
      if (opts.auth) {
        headers['Authorization'] = opts.auth;
      }
      
      // Build the full URL
      const url = cluster.server + logPath + '?' + logParams.toString();
      
      const axiosResponse = await axios.get(url, {
        httpsAgent: httpsAgent,
        headers: headers,
        validateStatus: () => true, // Don't throw on HTTP errors
      });
      
      if (axiosResponse.status >= 200 && axiosResponse.status < 300) {
        const logs = axiosResponse.data || '';
        
        res.json({ 
          success: true, 
          logs: logs,
          container: container || null
        });
      } else {
        // Handle HTTP error responses
        throw new Error(`HTTP ${axiosResponse.status}: ${axiosResponse.statusText || 'Failed to fetch logs'}`);
      }
    } catch (error) {
      console.error('❌ Error fetching pod logs:', error);
      
      // Provide helpful error messages
      if (error.response?.status === 404) {
        return res.status(404).json({ 
          success: false,
          error: 'Pod or container not found', 
          message: `Pod ${name} or container ${container || 'default'} not found in namespace ${namespace}` 
        });
      } else if (error.response?.status === 400) {
        return res.status(400).json({ 
          success: false,
          error: 'Invalid request', 
          message: error.response?.data?.message || 'Invalid parameters for log request' 
        });
      }
      
      // More detailed error response
      const errorMessage = error.message || 'Error fetching logs from Kubernetes';
      const errorDetails = error.response?.data ? 
        (typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)) :
        null;
      
      return res.status(500).json({ 
        success: false,
        error: 'Failed to fetch pod logs', 
        message: errorMessage,
        details: errorDetails
      });
    }
  } catch (error) {
    console.error('❌ Error in pod logs endpoint:', error);
    const errorMessage = error.message || 'Error fetching logs from Kubernetes';
    
    return res.status(500).json({ 
      success: false,
      error: 'Failed to fetch pod logs', 
      message: errorMessage
    });
  }
});

// Get detailed pod information (MUST come after /logs route to avoid route conflicts)
app.get('/api/k8s/pods/:namespace/:name', async (req, res) => {
  try {
    if (!k8sApi) {
      return res.status(400).json({ error: 'Not connected', message: 'Please connect to a Kubernetes cluster first' });
    }

    const { namespace, name } = req.params;
    
    if (!namespace || !name) {
      return res.status(400).json({ error: 'Invalid parameters', message: 'Namespace and name are required' });
    }

    let response;
    try {
      response = await k8sApi.readNamespacedPod(name, namespace);
    } catch (libraryError) {
      console.log('⚠️ Library method failed, using direct HTTP call...');
      response = await makeK8sDirectHttpCall(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}`, null);
    }

    const pod = response?.body || response;
    
    res.json({ success: true, pod });
  } catch (error) {
    console.error('❌ Error fetching pod details:', error);
    res.status(500).json({ error: 'Failed to fetch pod details', message: error.message || 'Error fetching pod from Kubernetes' });
  }
});

// Get detailed configmap information
app.get('/api/k8s/configmaps/:namespace/:name', async (req, res) => {
  try {
    if (!k8sApi) {
      return res.status(400).json({ error: 'Not connected', message: 'Please connect to a Kubernetes cluster first' });
    }

    const { namespace, name } = req.params;
    
    if (!namespace || !name) {
      return res.status(400).json({ error: 'Invalid parameters', message: 'Namespace and name are required' });
    }

    let response;
    try {
      response = await k8sApi.readNamespacedConfigMap(name, namespace);
    } catch (libraryError) {
      console.log('⚠️ Library method failed, using direct HTTP call...');
      response = await makeK8sDirectHttpCall(`/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${encodeURIComponent(name)}`, null);
    }

    const configmap = response?.body || response;
    
    res.json({ success: true, configmap });
  } catch (error) {
    console.error('❌ Error fetching configmap details:', error);
    res.status(500).json({ error: 'Failed to fetch configmap details', message: error.message || 'Error fetching configmap from Kubernetes' });
  }
});

// Get Jira issues list endpoint
app.get('/api/jira/issues', (req, res) => {
  res.json({
    issues: jiraIssuesData || [],
    count: jiraIssuesData?.length || 0,
  });
});

// List Jira projects endpoint - helps find correct project key
app.post('/api/jira/projects', async (req, res) => {
  try {
    const { baseUrl, email, apiToken } = req.body;
    
    if (!baseUrl || !email || !apiToken) {
      return res.status(400).json({
        error: 'Missing required Jira credentials',
        message: 'Please provide baseUrl, email, and apiToken',
      });
    }
    
    console.log('\n========== LIST JIRA PROJECTS ==========');
    console.log('Base URL:', baseUrl);
    console.log('Email:', email);
    console.log('API Token Length:', apiToken ? apiToken.length : 'NOT PROVIDED');
    console.log('API Token (masked):', apiToken ? `${apiToken.substring(0, 4)}...${apiToken.substring(apiToken.length - 4)}` : 'NOT PROVIDED');
    console.log('Full API Token:', apiToken);
    
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    console.log('Cleaned Base URL:', cleanBaseUrl);
    
    // Validate baseUrl format
    if (!cleanBaseUrl.startsWith('http://') && !cleanBaseUrl.startsWith('https://')) {
      return res.status(400).json({
        error: 'Invalid base URL',
        message: 'Base URL must start with http:// or https://',
      });
    }
    
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    console.log('Auth String:', `${email}:${apiToken.substring(0, 4)}...`);
    console.log('Full Auth Header:', `Basic ${auth}`);
    
    const headers = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    console.log('Request Headers:', {
      'Authorization': `Basic ${auth.substring(0, 20)}...`,
      'Accept': headers.Accept,
      'Content-Type': headers['Content-Type']
    });
    
    // Test connection first
    try {
      const myselfUrl = `${cleanBaseUrl}/rest/api/3/myself`;
      console.log('Testing connection with URL:', myselfUrl);
      const myselfResponse = await axios.get(myselfUrl, { headers });
      console.log(`✓ Connected as: ${myselfResponse.data.displayName} (${myselfResponse.data.emailAddress})`);
      console.log('Response Status:', myselfResponse.status);
    } catch (testError) {
      if (testError.response?.status === 401) {
        return res.status(401).json({
          error: 'Invalid Jira credentials',
          message: 'Please check your email and API token',
        });
      } else if (testError.response?.status === 403) {
        return res.status(403).json({
          error: 'Access forbidden',
          message: 'Your account may not have permission to access this Jira instance',
        });
      } else if (testError.code === 'ENOTFOUND' || testError.code === 'ECONNREFUSED') {
        return res.status(500).json({
          error: 'Connection failed',
          message: `Cannot connect to Jira server at ${cleanBaseUrl}. Please check the base URL.`,
        });
      }
      throw testError;
    }
    
    // Fetch all projects - try API v3 first, fallback to v2 if needed
    let projects = [];
    try {
      const projectsUrl = `${cleanBaseUrl}/rest/api/3/project`;
      console.log('Fetching projects from:', projectsUrl);
      const response = await axios.get(projectsUrl, {
        headers,
        params: {
          expand: 'description,lead,url,projectKeys',
        },
      });
      console.log('Response Status:', response.status);
      console.log('Number of projects received:', response.data.length);
      
      projects = response.data.map(project => ({
        key: project.key,
        name: project.name,
        projectType: project.projectTypeKey || 'software',
        archived: project.archived || false,
        lead: project.lead?.displayName || 'N/A',
      }));
      
      console.log('Project Keys:', projects.map(p => p.key).join(', '));
    } catch (api3Error) {
      // Fallback to API v2 if v3 fails
      console.log('API v3 failed, trying API v2...');
      try {
        const projectsUrl = `${cleanBaseUrl}/rest/api/2/project`;
        const response = await axios.get(projectsUrl, { headers });
        
        projects = response.data.map(project => ({
          key: project.key,
          name: project.name,
          projectType: project.projectTypeKey || 'software',
          archived: false, // v2 doesn't always have archived flag
          lead: project.lead?.displayName || 'N/A',
        }));
      } catch (api2Error) {
        throw new Error(`Failed to fetch projects: ${api3Error.message}`);
      }
    }
    
    // Sort projects by key
    projects.sort((a, b) => a.key.localeCompare(b.key));
    
    res.json({
      success: true,
      projects: projects,
      count: projects.length,
    });
  } catch (error) {
    console.error('Error fetching Jira projects:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    
    const statusCode = error.response?.status || 500;
    const errorDetails = error.response?.data?.errorMessages || error.response?.data?.errors || [];
    
    res.status(statusCode).json({
      error: error.message || 'Failed to fetch Jira projects',
      message: Array.isArray(errorDetails) ? errorDetails.join(', ') : (errorDetails || error.message),
    });
  }
});

// Get PRs endpoint
app.post('/api/prs', async (req, res) => {
  try {
    const filters = req.body;
    
    // Check if GitHub config is provided (for on-demand fetching)
    if (filters.githubToken && filters.githubConfig) {
      const { 
        githubToken, 
        githubConfig, 
        page = 1, 
        pageSize = 100, 
        state = 'all', 
        repository = 'all',
        author,
        reviewer,
        label,
        dateRange,
        customDateStart,
        customDateEnd,
        jiraLinked,
        search
      } = filters;
      
      console.log('📡 Fetching PRs directly from GitHub API (on-demand pagination)...', { 
        page, pageSize, state, repository, author, reviewer, label, dateRange, jiraLinked, search 
      });
      
      // First, fetch all PRs (or enough to apply filters accurately)
      // We need to fetch more PRs to apply filters before pagination
      const fetchAllForFiltering = author || reviewer || label || dateRange || jiraLinked || search;
      const fetchPage = fetchAllForFiltering ? 1 : parseInt(page);
      // When additional filters are applied, fetch a large number of PRs (10000) to get accurate filtered count
      // This ensures we can calculate the correct filtered total across all pages
      const fetchPageSize = fetchAllForFiltering ? 10000 : parseInt(pageSize) * 3; // Fetch many more if filtering
      console.log(`🔍 Filter mode: fetchAllForFiltering=${fetchAllForFiltering}, fetchPageSize=${fetchPageSize}`);
      
      const result = await fetchGitHubPRsPaginated(
        githubToken,
        githubConfig.organization,
        githubConfig.username,
        githubConfig.repositories || [],
        fetchPage,
        fetchPageSize,
        state,
        repository !== 'all' ? repository : null
      );
      
      console.log(`📦 Processing ${result.prs.length} PRs from GitHub API...`);
      
      // Process automation rules for fetched PRs
      let processedPRs = await Promise.all(result.prs.map(async (pr) => {
        return await processAutomationRules(pr);
      }));
      
      console.log(`✅ Processed ${processedPRs.length} PRs after automation rules`);
      
      // Apply additional filters
      let filteredPRs = [...processedPRs];
      const originalCount = filteredPRs.length;
      
      if (author) {
        filteredPRs = filteredPRs.filter(pr => pr.author === author);
      }
      if (reviewer) {
        filteredPRs = filteredPRs.filter(pr => 
          pr.reviewers && pr.reviewers.includes(reviewer)
        );
      }
      if (label) {
        filteredPRs = filteredPRs.filter(pr => 
          pr.labels && pr.labels.includes(label)
        );
      }
      if (dateRange && dateRange !== 'all') {
        const now = new Date();
        filteredPRs = filteredPRs.filter(pr => {
          if (!pr.created) return false;
          const createdDate = new Date(pr.created);
          
          if (dateRange === 'today') {
            return createdDate.toDateString() === now.toDateString();
          } else if (dateRange === 'week') {
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            return createdDate >= weekAgo;
          } else if (dateRange === 'month') {
            const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            return createdDate >= monthAgo;
          } else if (dateRange === 'custom' && customDateStart && customDateEnd) {
            const start = new Date(customDateStart);
            const end = new Date(customDateEnd);
            end.setHours(23, 59, 59, 999);
            return createdDate >= start && createdDate <= end;
          }
          return true;
        });
      }
      if (jiraLinked) {
        filteredPRs = filteredPRs.filter(pr => {
          const defaultJiraPattern = `PROJ-${pr.prNumber}`;
          const hasJiraStatus = !!pr.jiraStatus;
          const hasRealJiraKey = pr.jira && pr.jira.trim() !== '' && pr.jira !== defaultJiraPattern;
          return hasJiraStatus || hasRealJiraKey;
        });
      }
      if (search) {
        const searchLower = search.toLowerCase();
        filteredPRs = filteredPRs.filter(pr => {
          return (
            pr.title.toLowerCase().includes(searchLower) ||
            pr.author.toLowerCase().includes(searchLower) ||
            pr.prNumber.toString().includes(search) ||
            (pr.jira && pr.jira.toLowerCase().includes(searchLower)) ||
            (pr.repo && pr.repo.toLowerCase().includes(searchLower)) ||
            (pr.reviewers && pr.reviewers.some((reviewer) => 
              reviewer.toLowerCase().includes(searchLower)
            ))
          );
        });
      }
      
      const filteredCount = filteredPRs.length;
      console.log(`🔍 Applied filters: ${originalCount} → ${filteredCount} PRs (${author || reviewer || label || dateRange || jiraLinked || search ? 'filtered' : 'no filters'})`);
      
      // Apply pagination to filtered results
      const pageNum = parseInt(page);
      const pageSizeNum = parseInt(pageSize);
      const startIndex = (pageNum - 1) * pageSizeNum;
      const endIndex = startIndex + pageSizeNum;
      const paginatedPRs = filteredPRs.slice(startIndex, endIndex);
      
      // Calculate stats from filtered PRs
      const stats = calculateStats(paginatedPRs, jiraIssuesData);
      
      // Get all repositories from config
      const allRepositories = githubConfig.repositories || [];
      
      // Calculate pagination info
      // Note: result.total from fetchGitHubPRsPaginated is already filtered by state/repo
      // So it represents the total after state/repo filtering, not the true overall total
      const stateRepoFilteredTotal = result.total; // Total after state/repo filtering
      
      // If additional filters were applied, use the filtered count
      // Otherwise, use the state/repo filtered total (which is already filtered)
      const hasAdditionalFilters = author || reviewer || label || dateRange || jiraLinked || search;
      const filteredTotal = hasAdditionalFilters ? filteredCount : stateRepoFilteredTotal;
      const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSizeNum));
      const hasNextPage = endIndex < filteredTotal;
      
      console.log(`📊 Final pagination: page=${pageNum}, pageSize=${pageSizeNum}, stateRepoFilteredTotal=${stateRepoFilteredTotal}, filteredCount=${filteredCount}, filteredTotal=${filteredTotal}, totalPages=${totalPages}, hasNext=${hasNextPage}, hasAdditionalFilters=${hasAdditionalFilters}`);
      
      return res.json({
        prs: paginatedPRs,
        stats: stats,
        allRepositories: allRepositories,
        allJiraLabels: [],
        allPRs: paginatedPRs, // For stats, use current page
        pagination: {
          page: pageNum,
          pageSize: pageSizeNum,
          total: stateRepoFilteredTotal, // Total after state/repo filtering (from GitHub API)
          filteredTotal: filteredTotal, // Filtered total (after all filters) - always included
          totalPages: totalPages,
          hasNextPage: hasNextPage,
          hasPreviousPage: pageNum > 1,
        },
      });
    }
    
    // Fallback to stored data (existing behavior)
    // Return actual synced data only (no dummy/sample data)
    
    // Filter PRs based on request
    let filteredPRs = [...prsData];
  
  if (filters.repository && filters.repository !== 'All Repositories') {
    filteredPRs = filteredPRs.filter(pr => pr.repo === filters.repository);
  }
  
  if (filters.status && filters.status !== 'All Status') {
    filteredPRs = filteredPRs.filter(pr => pr.qaStatus === filters.status);
  }
  
  if (filters.view === 'Active PRs') {
    filteredPRs = filteredPRs.filter(pr => pr.mergeStatus === 'Open');
  } else if (filters.view === 'Merged PRs') {
    filteredPRs = filteredPRs.filter(pr => pr.mergeStatus === 'Merged');
  } else if (filters.view === 'Closed PRs') {
    filteredPRs = filteredPRs.filter(pr => pr.mergeStatus === 'Closed');
  }
  
  // Support state filter directly (for GitHub PR Dashboard)
  if (filters.state && filters.state !== 'all') {
    if (filters.state === 'open') {
      filteredPRs = filteredPRs.filter(pr => pr.mergeStatus === 'Open');
    } else if (filters.state === 'merged') {
      filteredPRs = filteredPRs.filter(pr => pr.mergeStatus === 'Merged');
    } else if (filters.state === 'closed') {
      filteredPRs = filteredPRs.filter(pr => pr.mergeStatus === 'Closed');
    }
  }
  
  if (filters.jira && filters.jira !== 'All JIRA') {
    filteredPRs = filteredPRs.filter(pr => 
      pr.jira && pr.jira.toLowerCase().includes(filters.jira.toLowerCase())
    );
  }
  
  // Filter by JIRA label
  if (filters.jiraLabel && filters.jiraLabel !== 'All Labels') {
    filteredPRs = filteredPRs.filter(pr => 
      pr.jiraLabels && Array.isArray(pr.jiraLabels) && pr.jiraLabels.includes(filters.jiraLabel)
    );
  }
  
  // Filter by created date (month-year)
  if (filters.createdDate && filters.createdDate !== 'All Dates') {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formatMonthYear = (date) => {
      const month = monthNames[date.getMonth()];
      const year = date.getFullYear();
      return `${month} ${year}`;
    };
    
    filteredPRs = filteredPRs.filter(pr => {
      if (!pr.created) return false;
      const prDate = new Date(pr.created);
      if (isNaN(prDate.getTime())) return false;
      
      const prMonthYear = formatMonthYear(prDate);
      return prMonthYear === filters.createdDate;
    });
  }
  
  // Calculate stats from Jira issues and linked PRs (always show real numbers, even if 0)
  const stats = calculateStats(filteredPRs, jiraIssuesData);
  
  // Extract all unique repositories from ALL PRs (before filtering) for dropdown
  const allRepositories = Array.from(new Set(prsData.map(pr => pr.repo).filter(Boolean))).sort();
  
  // Extract all unique JIRA labels from ALL PRs (before filtering) for dropdown
  const allJiraLabels = Array.from(
    new Set(
      prsData
        .filter(pr => pr.jiraLabels && Array.isArray(pr.jiraLabels) && pr.jiraLabels.length > 0)
        .flatMap(pr => pr.jiraLabels)
    )
  ).sort();
  
  // Pagination: 10 items per page (only if page is specified, otherwise return all)
  // If 'all' flag is explicitly set, return all PRs without pagination
  const returnAll = filters.all === true || filters.all === 'true';
  
  let paginatedPRs;
  let pagination;
  
  if (returnAll) {
    // Return all PRs without pagination
    paginatedPRs = filteredPRs;
    pagination = {
      page: 1,
      pageSize: filteredPRs.length,
      total: filteredPRs.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    };
  } else {
    // Apply pagination (100 items per page)
    const pageSize = parseInt(filters.pageSize) || 100;
    const page = parseInt(filters.page) || 1;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    paginatedPRs = filteredPRs.slice(startIndex, endIndex);
    const totalPages = Math.ceil(filteredPRs.length / pageSize);
    
    pagination = {
      page: page,
      pageSize: pageSize,
      total: filteredPRs.length,
      totalPages: totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }
  
    res.json({
      prs: paginatedPRs,
      stats: stats, // Always return calculated stats, never dummy data
      allRepositories: allRepositories, // All repos for dropdown (unfiltered)
      allJiraLabels: allJiraLabels, // All JIRA labels for dropdown (unfiltered)
      allPRs: filteredPRs, // All filtered PRs (for stats calculation on frontend)
      pagination: pagination,
    });
  } catch (error) {
    console.error('Error in /api/prs:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch PRs',
      prs: [],
      stats: {},
      allRepositories: [],
      allJiraLabels: [],
      allPRs: [],
      pagination: {
        page: 1,
        pageSize: 100,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
  }
});

// GitHub sync endpoint
app.post('/api/sync/github', async (req, res) => {
  try {
    const { token, organization, username, repositories } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        error: 'GitHub token is required',
        message: 'Please provide a GitHub personal access token'
      });
    }
    
    console.log('Syncing GitHub...');
    console.log('Organization:', organization || 'Not specified');
    console.log('Username:', username || 'Not specified');
    console.log('Repositories:', repositories?.join(', ') || 'All');
    
    // Fetch PRs from GitHub
    const githubPRs = await fetchGitHubPRs(token, organization, username, repositories);
    
    // Process automation rules for each PR
    console.log('🤖 Processing automation rules for PRs...');
    const processedPRs = await Promise.all(githubPRs.map(async (pr) => {
      return await processAutomationRules(pr);
    }));
    
    // Update stored data
    prsData = processedPRs;
    const openCount = prsData.filter(pr => pr.mergeStatus === 'Open').length;
    const mergedCount = prsData.filter(pr => pr.mergeStatus === 'Merged').length;
    const closedCount = prsData.filter(pr => pr.mergeStatus === 'Closed').length;
    console.log(`💾 Stored ${prsData.length} PRs in memory:`);
    console.log(`   - Open: ${openCount}`);
    console.log(`   - Merged: ${mergedCount}`);
    console.log(`   - Closed: ${closedCount}`);
    
    // If Jira issues have already been synced, link PRs to Jira issues
    if (jiraIssuesData && jiraIssuesData.length > 0) {
      console.log('🔗 Re-linking PRs with existing Jira issues...');
      prsData = prsData.map(pr => {
        // Extract Jira key from PR (format: PROJ-123 or similar)
        const prJiraKey = pr.jira || '';
        
        // Find matching Jira issue with improved matching
        const matchingIssue = jiraIssuesData.find(issue => {
          if (!issue.key || !prJiraKey) return false;
          
          const prKeyUpper = prJiraKey.trim().toUpperCase();
          const issueKeyUpper = issue.key.trim().toUpperCase();
          
          // Exact match
          if (prKeyUpper === issueKeyUpper) return true;
          
          // PR.jira contains the full key
          if (prKeyUpper.includes(issueKeyUpper)) return true;
          
          // Extract ticket numbers and compare
          const prNumber = prKeyUpper.replace(/^[A-Z]+-/, '');
          const issueNumber = issueKeyUpper.replace(/^[A-Z]+-/, '');
          if (prNumber && issueNumber && prNumber === issueNumber) {
            return true;
          }
          
          return false;
        });
        
        if (matchingIssue) {
          // Update PR with Jira issue details
          console.log(`🔗 Re-linking PR #${pr.prNumber} (${pr.repo}) to Jira ${matchingIssue.key} - Status: ${matchingIssue.status}`);
          return {
            ...pr,
            jira: matchingIssue.key,
            jiraStatus: matchingIssue.status,
            jiraAssignee: matchingIssue.assignee,
            jiraUrl: matchingIssue.url,
            jiraLabels: matchingIssue.labels || [],
          };
        }
        
        return pr;
      });
      const linkedCount = prsData.filter(pr => pr.jiraStatus).length;
      console.log(`✅ Linked ${linkedCount} PRs with Jira issues`);
      console.log(`📊 Sample linked PRs:`, prsData.filter(pr => pr.jiraStatus).slice(0, 3).map(pr => ({
        repo: pr.repo,
        prNumber: pr.prNumber,
        jira: pr.jira,
        jiraStatus: pr.jiraStatus
      })));
      
      // Save updated PRs to MongoDB
      await savePRsToMongoDB();
    }
    
    // Stats are now calculated dynamically from prsData and Jira issues, no need to store separately
    const stats = calculateStats(prsData, jiraIssuesData);
    console.log(`✅ Stored ${prsData.length} PRs. Stats:`, stats);
    
    // Save to MongoDB
    await savePRsToMongoDB();
    
    res.json({
      success: true,
      message: `Successfully synced ${prsData.length} pull requests from GitHub (Open: ${openCount}, Merged: ${mergedCount}, Closed: ${closedCount})`,
      count: prsData.length,
      totalPRs: prsData.length,
      open: openCount,
      merged: mergedCount,
      closed: closedCount
    });
  } catch (error) {
    console.error('GitHub sync error:', error);
    res.status(500).json({
      error: error.message || 'Failed to sync GitHub',
      message: error.response?.data?.message || 'Error fetching data from GitHub API',
    });
  }
});

// Jira sync endpoint
app.post('/api/sync/jira', async (req, res) => {
  try {
    console.log('\n========== RAW REQUEST BODY ==========');
    console.log('Full request body:', JSON.stringify(req.body, null, 2));
    console.log('======================================\n');
    
    let { baseUrl, email, apiToken, projectKey, labels } = req.body;
    
    // Store Jira config for automation use
    currentJiraConfig = { baseUrl, email, apiToken };
    
    // Normalize labels - handle both string and array formats
    if (labels) {
      if (typeof labels === 'string') {
        // If labels is a string, split by comma
        labels = labels.split(',').map(l => l.trim()).filter(l => l.length > 0);
      } else if (!Array.isArray(labels)) {
        labels = [];
      }
    } else {
      labels = [];
    }
    
    // Validate all required fields
    const missingFields = [];
    if (!baseUrl || (typeof baseUrl === 'string' && baseUrl.trim().length === 0)) missingFields.push('baseUrl');
    if (!email || (typeof email === 'string' && email.trim().length === 0)) missingFields.push('email');
    if (!apiToken || (typeof apiToken === 'string' && apiToken.trim().length === 0)) missingFields.push('apiToken');
    if (!projectKey || (typeof projectKey === 'string' && projectKey.trim().length === 0)) missingFields.push('projectKey');
    
    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields);
      return res.status(400).json({
        error: 'Missing required Jira credentials',
        message: `Please provide: ${missingFields.join(', ')}`,
        missingFields: missingFields,
      });
    }
    
    // Trim projectKey
    const trimmedProjectKey = typeof projectKey === 'string' ? projectKey.trim() : projectKey;
    
    console.log('\n========== JIRA SYNC REQUEST ==========');
    console.log('Base URL:', baseUrl);
    console.log('Email:', email);
    console.log('API Token:', apiToken ? `${apiToken.substring(0, 4)}...${apiToken.substring(apiToken.length - 4)} (${apiToken.length} chars)` : 'NOT PROVIDED');
    console.log('Full API Token:', apiToken);
    console.log('Project Key (raw):', projectKey);
    console.log('Project Key (trimmed):', trimmedProjectKey);
    console.log('Project Key type:', typeof projectKey);
    console.log('Project Key length:', typeof projectKey === 'string' ? projectKey.length : 'N/A');
    console.log('Labels:', labels && labels.length > 0 ? labels.join(', ') : 'None specified');
    console.log('Labels Array:', JSON.stringify(labels));
    console.log('Labels type:', Array.isArray(labels) ? 'Array' : typeof labels);
    console.log('========================================\n');
    
    // Fetch issues from Jira with label filtering (use trimmed projectKey)
    const jiraIssues = await fetchJiraIssues(baseUrl, email, apiToken, trimmedProjectKey, labels);
    
    // Transform Jira issues to a more usable format
    const transformedIssues = jiraIssues.map(issue => {
      const issueKey = issue.key || '';
      const fields = issue.fields || {};
      const status = fields.status?.name || 'Unknown';
      const assignee = fields.assignee?.displayName || 'Unassigned';
      const labels = fields.labels || [];
      const created = fields.created || '';
      const summary = fields.summary || '';
      const issueType = fields.issuetype?.name || 'Unknown';
      
      return {
        key: issueKey,
        summary,
        status,
        assignee,
        labels,
        created,
        issueType,
        url: `${baseUrl.replace(/\/$/, '')}/browse/${issueKey}`,
      };
    });
    
    // Store Jira issues
    jiraIssuesData = transformedIssues;
    
    // Save Jira issues to MongoDB immediately
    await saveJiraIssuesToMongoDB();
    
    // Link Jira issues to PRs based on Jira key matching
    // Update PRs that have matching Jira keys
    prsData = prsData.map(pr => {
      // Extract Jira key from PR (format: PROJ-123 or similar)
      const prJiraKey = pr.jira || '';
      
      // Find matching Jira issue with improved matching logic
      const matchingIssue = transformedIssues.find(issue => {
        if (!issue.key || !prJiraKey) return false;
        
        const prKeyUpper = prJiraKey.trim().toUpperCase();
        const issueKeyUpper = issue.key.trim().toUpperCase();
        
        // Exact match
        if (prKeyUpper === issueKeyUpper) {
          console.log(`✅ Exact match: PR ${pr.prNumber} (${prJiraKey}) <-> Jira ${issue.key}`);
          return true;
        }
        
        // PR.jira contains the full key (e.g., "APC-616 description" contains "APC-616")
        if (prKeyUpper.includes(issueKeyUpper)) {
          console.log(`✅ Contains match: PR ${pr.prNumber} (${prJiraKey}) contains ${issue.key}`);
          return true;
        }
        
        // Extract ticket numbers and compare (e.g., "APC-616" matches "APC-616")
        const prNumber = prKeyUpper.replace(/^[A-Z]+-/, '');
        const issueNumber = issueKeyUpper.replace(/^[A-Z]+-/, '');
        if (prNumber && issueNumber && prNumber === issueNumber) {
          console.log(`✅ Number match: PR ${pr.prNumber} (${prNumber}) === Jira ${issueNumber}`);
          return true;
        }
        
        return false;
      });
      
      if (matchingIssue) {
        // Update PR with Jira issue details
        console.log(`🔗 Linking PR #${pr.prNumber} (${pr.repo}) to Jira ${matchingIssue.key} - Status: ${matchingIssue.status}`);
        return {
          ...pr,
          jira: matchingIssue.key,
          jiraStatus: matchingIssue.status,
          jiraAssignee: matchingIssue.assignee,
          jiraUrl: matchingIssue.url,
          jiraLabels: matchingIssue.labels || [],
        };
      }
      
      return pr;
    });
    
    const linkedCount = prsData.filter(pr => pr.jiraStatus).length;
    console.log(`\n✅ Stored ${transformedIssues.length} Jira issues`);
    console.log(`✅ Linked ${linkedCount} PRs with Jira issues`);
    console.log(`📊 Sample linked PRs:`, prsData.filter(pr => pr.jiraStatus).slice(0, 3).map(pr => ({
      repo: pr.repo,
      prNumber: pr.prNumber,
      jira: pr.jira,
      jiraStatus: pr.jiraStatus
    })));
    console.log('');
    
    // Save Jira issues and updated PRs to MongoDB
    await saveJiraIssuesToMongoDB();
    await savePRsToMongoDB();
    
    res.json({
      success: true,
      message: `Successfully synced ${jiraIssues.length} issues from Jira${labels && labels.length > 0 ? ` (filtered by labels: ${labels.join(', ')})` : ''}`,
      count: jiraIssues.length,
      linkedPRs: prsData.filter(pr => pr.jiraStatus).length,
    });
  } catch (error) {
    console.error('Jira sync error:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      code: error.code,
    });
    
    const statusCode = error.response?.status || 500;
    const errorDetails = error.response?.data?.errorMessages || error.response?.data?.errors || [];
    const errorMessage = error.message || 'Error fetching data from Jira API';
    
    res.status(statusCode).json({
      error: errorMessage,
      message: errorMessage,
      details: errorDetails,
      troubleshooting: {
        statusCode: error.response?.status,
        statusText: error.response?.statusText,
        suggestion: getJiraErrorSuggestion(error.response?.status, error.message),
      },
    });
  }
});

// Add Jira issues to a release/version
app.post('/api/jira/release/add-issues', async (req, res) => {
  try {
    const { baseUrl, email, apiToken, projectKey, releaseName, issueKeys } = req.body;

    // Validate required fields
    if (!baseUrl || !email || !apiToken || !projectKey || !releaseName || !issueKeys) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Please provide: baseUrl, email, apiToken, projectKey, releaseName, and issueKeys',
      });
    }

    if (!Array.isArray(issueKeys) || issueKeys.length === 0) {
      return res.status(400).json({
        error: 'Invalid issue keys',
        message: 'issueKeys must be a non-empty array',
      });
    }

    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    const headers = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    console.log('\n========== ADD ISSUES TO RELEASE ==========');
    console.log('Project Key:', projectKey);
    console.log('Release Name:', releaseName);
    console.log('Issue Keys:', issueKeys);
    console.log('===========================================\n');

    // Step 1: Get project details to find the project ID
    const projectUrl = `${cleanBaseUrl}/rest/api/3/project/${projectKey}`;
    const projectResponse = await axios.get(projectUrl, { headers });
    const projectId = projectResponse.data.id;
    console.log(`✓ Project ID: ${projectId}`);

    // Step 2: Get or create the version/release
    const versionsUrl = `${cleanBaseUrl}/rest/api/3/project/${projectKey}/versions`;
    const versionsResponse = await axios.get(versionsUrl, { headers });
    let version = versionsResponse.data.find(v => v.name === releaseName);

    if (!version) {
      // Create the version if it doesn't exist
      console.log(`Creating new version: ${releaseName}`);
      const createVersionUrl = `${cleanBaseUrl}/rest/api/3/version`;
      const createVersionResponse = await axios.post(createVersionUrl, {
        name: releaseName,
        projectId: projectId,
        released: false,
        archived: false,
      }, { headers });
      version = createVersionResponse.data;
      console.log(`✓ Created version: ${version.name} (ID: ${version.id})`);
    } else {
      console.log(`✓ Found existing version: ${version.name} (ID: ${version.id})`);
    }

    // Step 3: Add issues to the version
    const results = [];
    const errors = [];

    for (const issueKey of issueKeys) {
      try {
        // Get the issue to verify it exists
        const issueUrl = `${cleanBaseUrl}/rest/api/3/issue/${issueKey}`;
        const issueResponse = await axios.get(issueUrl, { headers });
        const issueId = issueResponse.data.id;

        // Update the issue to add it to the version
        const updateUrl = `${cleanBaseUrl}/rest/api/3/issue/${issueKey}`;
        const updateResponse = await axios.put(updateUrl, {
          fields: {
            fixVersions: [
              {
                id: version.id,
                name: version.name,
              },
            ],
          },
        }, { headers });

        results.push({
          issueKey,
          success: true,
          message: `Added ${issueKey} to release ${releaseName}`,
        });
        console.log(`✓ Added ${issueKey} to release ${releaseName}`);
      } catch (issueError) {
        const errorMessage = issueError.response?.data?.errorMessages?.[0] || 
                           issueError.response?.data?.errors?.[Object.keys(issueError.response?.data?.errors || {})[0]] ||
                           issueError.message || 'Unknown error';
        errors.push({
          issueKey,
          success: false,
          error: errorMessage,
        });
        console.error(`✗ Failed to add ${issueKey}: ${errorMessage}`);
      }
    }

    const successCount = results.length;
    const errorCount = errors.length;

    res.json({
      success: successCount > 0,
      message: `Added ${successCount} issue(s) to release "${releaseName}"${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
      releaseName,
      versionId: version.id,
      results,
      errors: errorCount > 0 ? errors : undefined,
      summary: {
        total: issueKeys.length,
        successful: successCount,
        failed: errorCount,
      },
    });
  } catch (error) {
    console.error('❌ Error adding issues to release:', error);
    const statusCode = error.response?.status || 500;
    const errorMessage = error.response?.data?.errorMessages?.[0] || 
                        error.response?.data?.errors?.[Object.keys(error.response?.data?.errors || {})[0]] ||
                        error.message || 'Failed to add issues to release';

    res.status(statusCode).json({
      error: errorMessage,
      message: errorMessage,
      details: error.response?.data,
    });
  }
});

// ==================== AUTOMATION & WORKFLOWS ====================

// Load automation config from MongoDB
async function loadAutomationConfig() {
  if (!db) {
    // If no MongoDB, use default config (already initialized)
    console.log('📋 Using default automation config (MongoDB not connected)');
    return;
  }
  try {
    const collection = db.collection(AUTOMATION_COLLECTION);
    const config = await collection.findOne({ _id: 'main' });
    if (config) {
      // Merge with defaults, preserving structure
      const { _id, ...configWithoutId } = config;
      automationConfig = {
        enabled: configWithoutId.enabled !== undefined ? configWithoutId.enabled : automationConfig.enabled,
        autoLinkPRToJira: configWithoutId.autoLinkPRToJira !== undefined ? configWithoutId.autoLinkPRToJira : automationConfig.autoLinkPRToJira,
        autoAssign: configWithoutId.autoAssign !== undefined ? configWithoutId.autoAssign : automationConfig.autoAssign,
        statusSync: configWithoutId.statusSync !== undefined ? configWithoutId.statusSync : automationConfig.statusSync,
        webhooks: {
          github: configWithoutId.webhooks?.github || automationConfig.webhooks.github,
          jira: configWithoutId.webhooks?.jira || automationConfig.webhooks.jira
        },
        autoAssignRules: configWithoutId.autoAssignRules || automationConfig.autoAssignRules,
        statusSyncRules: configWithoutId.statusSyncRules || automationConfig.statusSyncRules,
        statusBasedAssignRules: configWithoutId.statusBasedAssignRules || automationConfig.statusBasedAssignRules,
        customRules: configWithoutId.customRules || automationConfig.customRules,
        scheduledReports: configWithoutId.scheduledReports || automationConfig.scheduledReports,
        blockerDetection: {
          enabled: configWithoutId.blockerDetection?.enabled !== undefined ? configWithoutId.blockerDetection.enabled : automationConfig.blockerDetection.enabled,
          keywords: configWithoutId.blockerDetection?.keywords || automationConfig.blockerDetection.keywords,
          notificationChannels: configWithoutId.blockerDetection?.notificationChannels || automationConfig.blockerDetection.notificationChannels
        }
      };
      console.log('✅ Loaded automation config from MongoDB');
    } else {
      console.log('📋 No automation config in MongoDB, using defaults');
    }
  } catch (error) {
    console.error('Error loading automation config:', error);
    // Continue with default config on error
  }
}

// Save automation config to MongoDB
async function saveAutomationConfig() {
  if (!db) {
    console.warn('⚠️ MongoDB not connected, automation config not persisted');
    return;
  }
  try {
    const collection = db.collection(AUTOMATION_COLLECTION);
    const result = await collection.updateOne(
      { _id: 'main' },
      { $set: { ...automationConfig, _id: 'main', updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    if (result.upsertedCount > 0) {
      console.log('✅ Created new automation config in MongoDB');
    } else if (result.modifiedCount > 0) {
      console.log('✅ Updated automation config in MongoDB');
    }
  } catch (error) {
    console.error('❌ Error saving automation config:', error);
    throw error; // Re-throw to allow callers to handle
  }
}

// Enhanced PR → Jira Auto-linking
async function autoLinkPRToJira(pr) {
  if (!automationConfig.autoLinkPRToJira) return pr;
  
  // Extract Jira key from PR title/description
  const jiraKeyPattern = /([A-Z]+-\d+)/gi;
  const prText = `${pr.title} ${pr.body || ''}`.toUpperCase();
  const matches = prText.match(jiraKeyPattern);
  
  if (matches && matches.length > 0) {
    const jiraKey = matches[0];
    const matchingIssue = jiraIssuesData.find(issue => 
      issue.key && issue.key.toUpperCase() === jiraKey.toUpperCase()
    );
    
    if (matchingIssue) {
      console.log(`🔗 Auto-linking PR #${pr.prNumber} (${pr.repo}) to Jira ${matchingIssue.key}`);
      return {
        ...pr,
        jira: matchingIssue.key,
        jiraStatus: matchingIssue.status,
        jiraAssignee: matchingIssue.assignee,
        jiraUrl: matchingIssue.url,
        jiraLabels: matchingIssue.labels || [],
      };
    }
  }
  
  return pr;
}

// Auto-assign based on rules
async function autoAssignPR(pr) {
  if (!automationConfig.autoAssign) return pr;
  
  for (const rule of automationConfig.autoAssignRules || []) {
    if (!rule.enabled) continue;
    
    let matches = false;
    
    // Match by repository
    if (rule.repository && pr.repo !== rule.repository) continue;
    
    // Match by label
    if (rule.label && pr.jiraLabels && !pr.jiraLabels.includes(rule.label)) continue;
    
    // Match by author
    if (rule.author && pr.author !== rule.author) continue;
    
    // Match by pattern in title
    if (rule.titlePattern) {
      const regex = new RegExp(rule.titlePattern, 'i');
      if (!regex.test(pr.title)) continue;
    }
    
    if (rule.assignTo) {
      console.log(`🤖 Auto-assigning PR #${pr.prNumber} (${pr.repo}) to ${rule.assignTo}`);
      // In a real implementation, you would update the PR assignment via GitHub API
      // For now, we'll just log it
      return { ...pr, assignedTo: rule.assignTo };
    }
  }
  
  return pr;
}

// Status sync: PR merged → Jira done
async function syncStatusToJira(pr) {
  if (!automationConfig.statusSync) return;
  
  if (pr.mergeStatus === 'Merged' && pr.jira) {
    // Find the matching Jira issue
    const issue = jiraIssuesData.find(i => i.key === pr.jira);
    if (issue && issue.status && !issue.status.toLowerCase().includes('done')) {
      console.log(`🔄 Syncing status: PR #${pr.prNumber} merged → Jira ${pr.jira} should be marked done`);
      // In a real implementation, you would update Jira status via API
      // For now, we'll update our local data
      const issueIndex = jiraIssuesData.findIndex(i => i.key === pr.jira);
      if (issueIndex !== -1) {
        jiraIssuesData[issueIndex] = { ...jiraIssuesData[issueIndex], status: 'Done' };
        await saveJiraIssuesToMongoDB();
      }
    }
  }
}

// Auto-assign Jira issue based on status
async function autoAssignJiraIssueByStatus(issueKey, newStatus, jiraConfig) {
  if (!automationConfig.statusBasedAssignRules || automationConfig.statusBasedAssignRules.length === 0) {
    return;
  }

  // Find matching rule
  for (const rule of automationConfig.statusBasedAssignRules) {
    if (!rule.enabled) continue;
    
    // Match status (case-insensitive)
    if (rule.status && rule.status.toLowerCase() !== newStatus.toLowerCase()) continue;
    
    // Match label if specified
    const issue = jiraIssuesData.find(i => i.key === issueKey);
    if (rule.label && issue && issue.labels && !issue.labels.includes(rule.label)) continue;
    
    // Match project if specified
    if (rule.projectKey) {
      const issueProjectKey = issueKey.split('-')[0];
      if (issueProjectKey.toLowerCase() !== rule.projectKey.toLowerCase()) continue;
    }
    
    // Found a matching rule - assign the issue
    if (rule.assignTo) {
      console.log(`🤖 Auto-assigning Jira ${issueKey} (status: ${newStatus}) to ${rule.assignTo}`);
      
      // Try to assign via Jira API if credentials are available
      if (jiraConfig && jiraConfig.baseUrl && jiraConfig.email && jiraConfig.apiToken) {
        try {
          await assignJiraIssue(jiraConfig.baseUrl, jiraConfig.email, jiraConfig.apiToken, issueKey, rule.assignTo);
          console.log(`✅ Successfully assigned Jira ${issueKey} to ${rule.assignTo}`);
        } catch (error) {
          console.error(`❌ Failed to assign Jira ${issueKey} via API:`, error.message);
          // Still update local data
          if (issue) {
            const issueIndex = jiraIssuesData.findIndex(i => i.key === issueKey);
            if (issueIndex !== -1) {
              jiraIssuesData[issueIndex] = { ...jiraIssuesData[issueIndex], assignee: rule.assignTo };
              await saveJiraIssuesToMongoDB();
            }
          }
        }
      } else {
        // Update local data only
        if (issue) {
          const issueIndex = jiraIssuesData.findIndex(i => i.key === issueKey);
          if (issueIndex !== -1) {
            jiraIssuesData[issueIndex] = { ...jiraIssuesData[issueIndex], assignee: rule.assignTo };
            await saveJiraIssuesToMongoDB();
          }
        }
      }
      
      // Only apply first matching rule
      break;
    }
  }
}

// Assign Jira issue to a user via API
async function assignJiraIssue(baseUrl, email, apiToken, issueKey, assigneeEmail) {
  try {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    
    const headers = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    
    // First, get the user account ID from email
    const userSearchUrl = `${cleanBaseUrl}/rest/api/3/user/search?query=${encodeURIComponent(assigneeEmail)}`;
    const userResponse = await axios.get(userSearchUrl, { headers });
    
    if (!userResponse.data || userResponse.data.length === 0) {
      throw new Error(`User not found: ${assigneeEmail}`);
    }
    
    const userAccountId = userResponse.data[0].accountId;
    
    // Assign the issue
    const assignUrl = `${cleanBaseUrl}/rest/api/3/issue/${issueKey}/assignee`;
    await axios.put(assignUrl, { accountId: userAccountId }, { headers });
    
    return true;
  } catch (error) {
    console.error('Error assigning Jira issue:', error.response?.data || error.message);
    throw error;
  }
}

// Detect blockers in PR/Jira comments
function detectBlockers(text) {
  if (!automationConfig.blockerDetection.enabled) return false;
  
  const keywords = automationConfig.blockerDetection.keywords || [];
  const lowerText = (text || '').toLowerCase();
  
  return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

// Send notifications for blockers
async function notifyBlockers(pr, blockerText) {
  const channels = automationConfig.blockerDetection.notificationChannels || [];
  
  for (const channel of channels) {
    if (!channel.enabled) continue;
    
    try {
      const message = `🚨 Blocker detected in PR #${pr.prNumber} (${pr.repo}):\n${pr.title}\n\nBlocker: ${blockerText}`;
      
      if (channel.type === 'slack' && channel.webhookUrl) {
        await axios.post(channel.webhookUrl, { text: message });
      } else if (channel.type === 'teams' && channel.webhookUrl) {
        await axios.post(channel.webhookUrl, {
          '@type': 'MessageCard',
          '@context': 'https://schema.org/extensions',
          summary: 'Blocker Detected',
          themeColor: 'FF0000',
          title: 'Blocker Detected',
          text: message
        });
      }
      
      console.log(`📢 Blocker notification sent via ${channel.type}`);
    } catch (error) {
      console.error(`Error sending blocker notification via ${channel.type}:`, error);
    }
  }
}

// Process automation rules for a PR
async function processAutomationRules(pr) {
  let updatedPR = pr;
  
  // Auto-link PR to Jira
  updatedPR = await autoLinkPRToJira(updatedPR);
  
  // Auto-assign
  updatedPR = await autoAssignPR(updatedPR);
  
  // Status sync
  await syncStatusToJira(updatedPR);
  
  // Check for blockers in PR description
  if (pr.body && detectBlockers(pr.body)) {
    await notifyBlockers(updatedPR, pr.body);
  }
  
  return updatedPR;
}

// Apply custom automation rules
async function applyCustomRules(pr, eventType = 'pr_created') {
  for (const rule of automationConfig.customRules || []) {
    if (!rule.enabled) continue;
    if (rule.eventType && rule.eventType !== eventType) continue;
    
    try {
      // Evaluate rule conditions
      let conditionMet = true;
      
      if (rule.conditions) {
        for (const condition of rule.conditions) {
          const fieldValue = pr[condition.field];
          let matches = false;
          
          switch (condition.operator) {
            case 'equals':
              matches = fieldValue === condition.value;
              break;
            case 'contains':
              matches = String(fieldValue || '').toLowerCase().includes(String(condition.value || '').toLowerCase());
              break;
            case 'regex':
              matches = new RegExp(condition.value, 'i').test(fieldValue || '');
              break;
            default:
              matches = false;
          }
          
          if (!matches) {
            conditionMet = false;
            break;
          }
        }
      }
      
      if (conditionMet && rule.actions) {
        console.log(`⚙️ Applying custom rule: ${rule.name}`);
        
        for (const action of rule.actions) {
          switch (action.type) {
            case 'assign':
              pr.assignedTo = action.value;
              break;
            case 'add_label':
              if (!pr.jiraLabels) pr.jiraLabels = [];
              if (!pr.jiraLabels.includes(action.value)) {
                pr.jiraLabels.push(action.value);
              }
              break;
            case 'update_jira_status':
              // Update Jira status via API
              console.log(`Would update Jira ${pr.jira} status to ${action.value}`);
              break;
            case 'notify':
              // Send notification
              console.log(`Would send notification: ${action.value}`);
              break;
          }
        }
      }
    } catch (error) {
      console.error(`Error applying custom rule ${rule.name}:`, error);
    }
  }
  
  return pr;
}

// Scheduled reports generator
async function generateScheduledReport(reportConfig) {
  try {
    const { type, filters, recipients, format } = reportConfig;
    
    let data = [];
    if (type === 'pr') {
      data = prsData.filter(pr => {
        if (filters.repository && pr.repo !== filters.repository) return false;
        if (filters.status && pr.qaStatus !== filters.status) return false;
        if (filters.dateRange) {
          const prDate = new Date(pr.created);
          if (filters.dateRange.start && prDate < new Date(filters.dateRange.start)) return false;
          if (filters.dateRange.end && prDate > new Date(filters.dateRange.end)) return false;
        }
        return true;
      });
    } else if (type === 'jira') {
      data = jiraIssuesData.filter(issue => {
        if (filters.status && issue.status !== filters.status) return false;
        if (filters.assignee && issue.assignee !== filters.assignee) return false;
        return true;
      });
    }
    
    // Generate report content
    const report = {
      type,
      generatedAt: new Date().toISOString(),
      summary: {
        total: data.length,
        // Add more summary stats
      },
      data
    };
    
    // Send report to recipients
    for (const recipient of recipients || []) {
      console.log(`📊 Sending ${type} report to ${recipient.email || recipient}`);
      // In a real implementation, you would send email/notification
    }
    
    return report;
  } catch (error) {
    console.error('Error generating scheduled report:', error);
    throw error;
  }
}

// Automation API Endpoints

// Get automation configuration
app.get('/api/automation/config', async (req, res) => {
  try {
    await loadAutomationConfig();
    // Ensure config has all required fields
    const config = {
      enabled: automationConfig.enabled !== undefined ? automationConfig.enabled : true,
      autoLinkPRToJira: automationConfig.autoLinkPRToJira !== undefined ? automationConfig.autoLinkPRToJira : true,
      autoAssign: automationConfig.autoAssign !== undefined ? automationConfig.autoAssign : true,
      statusSync: automationConfig.statusSync !== undefined ? automationConfig.statusSync : true,
      webhooks: {
        github: automationConfig.webhooks?.github || { enabled: false, secret: '' },
        jira: automationConfig.webhooks?.jira || { enabled: false, secret: '' }
      },
      autoAssignRules: automationConfig.autoAssignRules || [],
      statusSyncRules: automationConfig.statusSyncRules || [],
      statusBasedAssignRules: automationConfig.statusBasedAssignRules || [],
      customRules: automationConfig.customRules || [],
      scheduledReports: automationConfig.scheduledReports || [],
      blockerDetection: {
        enabled: automationConfig.blockerDetection?.enabled !== undefined ? automationConfig.blockerDetection.enabled : true,
        keywords: automationConfig.blockerDetection?.keywords || ['blocked', 'blocker', 'blocking', 'cannot proceed', 'stuck'],
        notificationChannels: automationConfig.blockerDetection?.notificationChannels || []
      }
    };
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error in /api/automation/config:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to load automation configuration',
      config: automationConfig // Return default config even on error
    });
  }
});

// Update automation configuration
app.put('/api/automation/config', async (req, res) => {
  try {
    const updates = req.body;
    automationConfig = { ...automationConfig, ...updates };
    await saveAutomationConfig();
    res.json({ success: true, config: automationConfig });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add auto-assign rule
app.post('/api/automation/auto-assign-rules', async (req, res) => {
  try {
    const rule = { ...req.body, id: `rule-${Date.now()}` };
    if (!automationConfig.autoAssignRules) {
      automationConfig.autoAssignRules = [];
    }
    automationConfig.autoAssignRules.push(rule);
    await saveAutomationConfig();
    res.json({ success: true, rule });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add custom automation rule
app.post('/api/automation/custom-rules', async (req, res) => {
  try {
    const rule = { ...req.body, id: `custom-rule-${Date.now()}` };
    if (!automationConfig.customRules) {
      automationConfig.customRules = [];
    }
    automationConfig.customRules.push(rule);
    await saveAutomationConfig();
    res.json({ success: true, rule });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add status-based assignment rule
app.post('/api/automation/status-based-assign-rules', async (req, res) => {
  try {
    const rule = { ...req.body, id: `status-rule-${Date.now()}` };
    if (!automationConfig.statusBasedAssignRules) {
      automationConfig.statusBasedAssignRules = [];
    }
    automationConfig.statusBasedAssignRules.push(rule);
    await saveAutomationConfig();
    res.json({ success: true, rule });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add scheduled report
app.post('/api/automation/scheduled-reports', async (req, res) => {
  try {
    const report = { ...req.body, id: `report-${Date.now()}` };
    if (!automationConfig.scheduledReports) {
      automationConfig.scheduledReports = [];
    }
    automationConfig.scheduledReports.push(report);
    await saveAutomationConfig();
    res.json({ success: true, report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Webhook endpoint for GitHub
app.post('/api/webhooks/github', async (req, res) => {
  try {
    const event = req.headers['x-github-event'];
    const payload = req.body;
    
    console.log(`📥 Received GitHub webhook: ${event}`);
    
    if (event === 'pull_request') {
      const action = payload.action;
      const pr = payload.pull_request;
      
      if (action === 'opened' || action === 'synchronize') {
        // Process automation rules for new/updated PR
        const prData = {
          id: pr.id.toString(),
          repo: pr.base.repo.name,
          prNumber: pr.number,
          title: pr.title,
          author: pr.user.login,
          created: pr.created_at,
          body: pr.body,
          mergeStatus: pr.state === 'open' ? 'Open' : pr.merged ? 'Merged' : 'Closed',
        };
        
        const updatedPR = await processAutomationRules(prData);
        const finalPR = await applyCustomRules(updatedPR, 'pr_' + action);
        
        // Update PRs data
        const existingIndex = prsData.findIndex(p => p.id === prData.id);
        if (existingIndex !== -1) {
          prsData[existingIndex] = finalPR;
        } else {
          prsData.push(finalPR);
        }
        
        await savePRsToMongoDB();
      } else if (action === 'closed' && pr.merged) {
        // PR merged - sync status to Jira
        const existingPR = prsData.find(p => p.prNumber === pr.number && p.repo === pr.base.repo.name);
        if (existingPR) {
          await syncStatusToJira({ ...existingPR, mergeStatus: 'Merged' });
        }
      }
    }
    
    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Error processing GitHub webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Store Jira config for automation (set when syncing)
let currentJiraConfig = null;

// Webhook endpoint for Jira
app.post('/api/webhooks/jira', async (req, res) => {
  try {
    const event = req.body.webhookEvent;
    const issue = req.body.issue;
    const changelog = req.body.changelog;
    
    console.log(`📥 Received Jira webhook: ${event}`);
    
    if (event === 'jira:issue_updated' || event === 'jira:issue_created') {
      const oldStatus = changelog?.items?.find(item => item.field === 'status')?.fromString;
      const newStatus = issue.fields.status.name;
      
      // Update local Jira issue data
      const issueData = {
        key: issue.key,
        summary: issue.fields.summary,
        status: newStatus,
        assignee: issue.fields.assignee?.displayName || 'Unassigned',
        labels: issue.fields.labels || [],
        created: issue.fields.created,
        url: `${req.body.jiraBaseUrl || ''}/browse/${issue.key}`,
      };
      
      const existingIndex = jiraIssuesData.findIndex(i => i.key === issue.key);
      const statusChanged = existingIndex !== -1 && jiraIssuesData[existingIndex].status !== newStatus;
      
      if (existingIndex !== -1) {
        jiraIssuesData[existingIndex] = issueData;
      } else {
        jiraIssuesData.push(issueData);
      }
      
      await saveJiraIssuesToMongoDB();
      
      // If status changed, check for status-based auto-assignment
      if (statusChanged || event === 'jira:issue_created') {
        console.log(`🔄 Status changed: ${oldStatus || 'N/A'} → ${newStatus} for ${issue.key}`);
        await autoAssignJiraIssueByStatus(issue.key, newStatus, currentJiraConfig);
      }
      
      // Check for blockers in issue description
      if (issue.fields.description && detectBlockers(issue.fields.description)) {
        // Find linked PR
        const linkedPR = prsData.find(p => p.jira === issue.key);
        if (linkedPR) {
          await notifyBlockers(linkedPR, issue.fields.description);
        }
      }
    }
    
    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Error processing Jira webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Trigger automation for a specific PR
app.post('/api/automation/trigger/:prId', async (req, res) => {
  try {
    const pr = prsData.find(p => p.id === req.params.prId);
    if (!pr) {
      return res.status(404).json({ success: false, error: 'PR not found' });
    }
    
    const updatedPR = await processAutomationRules(pr);
    const finalPR = await applyCustomRules(updatedPR, 'manual_trigger');
    
    // Update PR in data
    const index = prsData.findIndex(p => p.id === req.params.prId);
    prsData[index] = finalPR;
    await savePRsToMongoDB();
    
    res.json({ success: true, pr: finalPR });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate and send scheduled reports
app.post('/api/automation/generate-report/:reportId', async (req, res) => {
  try {
    const report = automationConfig.scheduledReports?.find(r => r.id === req.params.reportId);
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }
    
    const reportData = await generateScheduledReport(report);
    res.json({ success: true, report: reportData });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Store kubeconfig in memory (in production, use secure storage)
let currentKubeconfig = null;
let k8sApi = null;
let k8sAppsApi = null;
let k8sBatchApi = null;
let k8sNetworkingApi = null;
let currentKubeConfig = null; // KubeConfig object for direct HTTP calls

// Helper function to make direct HTTP calls to Kubernetes API as workaround for library bug
async function makeK8sDirectHttpCall(apiPath, namespace = null) {
  if (!currentKubeConfig) {
    throw new Error('KubeConfig not available');
  }
  
  const cluster = currentKubeConfig.getCurrentCluster();
  if (!cluster || !cluster.server) {
    throw new Error('No active cluster');
  }
  
  // Build the API path
  let path = apiPath;
  if (namespace && path.includes('{namespace}')) {
    path = path.replace('{namespace}', encodeURIComponent(namespace));
  }
  
  // Use the library's authentication method for HTTPS requests
  const https = await import('https');
  
  // Get authentication options from KubeConfig (not async)
  const opts = {};
  currentKubeConfig.applyToHTTPSOptions(opts);
  
  // Build the full URL
  const url = cluster.server + path;
  
  // Create HTTPS agent with certificates if available
  let httpsAgent = null;
  if (opts.ca || opts.cert || opts.key) {
    httpsAgent = new https.Agent({
      ca: opts.ca,
      cert: opts.cert,
      key: opts.key,
      rejectUnauthorized: opts.rejectUnauthorized !== false
    });
  }
  
  // Prepare headers
  const headers = {};
  if (opts.headers) {
    Object.assign(headers, opts.headers);
  }
  
  // Apply authorization header if present
  if (opts.auth) {
    headers['Authorization'] = opts.auth;
  }
  
  // Make the request using axios
  const httpResponse = await axios({
    method: 'GET',
    url: url,
    headers: headers,
    httpsAgent: httpsAgent,
    validateStatus: () => true, // Don't throw on HTTP errors
  });
  
  if (httpResponse.status >= 200 && httpResponse.status < 300) {
    // Format response to match library format
    return { body: httpResponse.data };
  } else {
    // Check if response is HTML (error page) instead of JSON
    const contentType = httpResponse.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      throw new Error(`HTTP ${httpResponse.status}: Server returned HTML error page. The API endpoint may not exist or the resource type may not be available in this Kubernetes version.`);
    }
    // For 404, return empty list structure
    if (httpResponse.status === 404) {
      return { body: { items: [] } };
    }
    // For 403, throw with clear message about permissions
    if (httpResponse.status === 403) {
      throw new Error(`HTTP 403: Forbidden - User/service account lacks permission to access this resource. Check RBAC permissions.`);
    }
    throw new Error(`HTTP ${httpResponse.status}: ${httpResponse.statusText || 'Unknown error'}`);
  }
}

// Helper function to validate and parse kubeconfig
function validateKubeconfig(kubeconfig) {
  const issues = [];
  const suggestions = [];

  // Check if kubeconfig is empty
  if (!kubeconfig || !kubeconfig.trim()) {
    return {
      valid: false,
      issues: ['Kubeconfig is empty'],
      suggestions: ['Please provide a valid kubeconfig YAML content']
    };
  }

  // Try to parse YAML - be more lenient
  let parsed = null;
  try {
    const kc = new k8s.KubeConfig();
    // Trim whitespace first
    const trimmed = kubeconfig.trim();
    kc.loadFromString(trimmed);
    parsed = kc;
  } catch (parseError) {
    // Provide more helpful error messages
    const errorMsg = parseError.message || 'Unknown parsing error';
    let suggestions = [
      'Check if the YAML format is correct',
      'Ensure all required fields are present (apiVersion, kind, clusters, contexts, users)',
    ];

    // Add specific suggestions based on error
    if (errorMsg.includes('YAMLException') || errorMsg.includes('yaml')) {
      suggestions.push('Verify YAML syntax - check for indentation errors or special characters');
    }
    if (errorMsg.includes('kind') || errorMsg.includes('Config')) {
      suggestions.push('Ensure the file starts with "apiVersion: v1" and "kind: Config"');
    }
    if (errorMsg.includes('cluster') || errorMsg.includes('context')) {
      suggestions.push('Verify cluster and context definitions are properly formatted');
    }

    return {
      valid: false,
      issues: [`Failed to parse kubeconfig: ${errorMsg}`],
      suggestions: suggestions,
      parseError: errorMsg
    };
  }

  // Validate structure
  const clusters = parsed.getClusters();
  const contexts = parsed.getContexts();
  const users = parsed.getUsers();
  const currentContext = parsed.getCurrentContext();

  if (!clusters || clusters.length === 0) {
    issues.push('No clusters defined in kubeconfig');
    suggestions.push('Add at least one cluster configuration');
  }

  if (!contexts || contexts.length === 0) {
    issues.push('No contexts defined in kubeconfig');
    suggestions.push('Add at least one context configuration');
  }

  if (!users || users.length === 0) {
    issues.push('No users defined in kubeconfig');
    suggestions.push('Add at least one user authentication configuration');
  }

  if (!currentContext && contexts.length > 0) {
    issues.push('No current context is set');
    suggestions.push(`Set current-context to one of: ${contexts.map(c => c.name).join(', ')}`);
  }

  // Validate each cluster
  clusters.forEach((cluster, idx) => {
    if (!cluster.name) {
      issues.push(`Cluster ${idx + 1} is missing a name`);
      suggestions.push('Ensure each cluster has a name field');
    }
    if (!cluster.cluster || !cluster.cluster.server) {
      issues.push(`Cluster "${cluster.name || `#${idx + 1}`}" is missing server URL`);
      suggestions.push('Ensure each cluster has a server URL configured');
    }
  });

  // Validate each context
  contexts.forEach((context, idx) => {
    if (!context.name) {
      issues.push(`Context ${idx + 1} is missing a name`);
      suggestions.push('Ensure each context has a name field');
    }
    if (!context.context) {
      issues.push(`Context "${context.name || `#${idx + 1}`}" is missing context configuration`);
      suggestions.push('Ensure each context has cluster, user, and namespace (optional) configured');
    } else {
      if (!context.context.cluster) {
        issues.push(`Context "${context.name}" is missing cluster reference`);
        suggestions.push(`Ensure context "${context.name}" references a valid cluster`);
      }
      if (!context.context.user) {
        issues.push(`Context "${context.name}" is missing user reference`);
        suggestions.push(`Ensure context "${context.name}" references a valid user`);
      }
    }
  });

  // Validate each user
  users.forEach((user, idx) => {
    if (!user.name) {
      issues.push(`User ${idx + 1} is missing a name`);
      suggestions.push('Ensure each user has a name field');
    }
    if (!user.user) {
      issues.push(`User "${user.name || `#${idx + 1}`}" is missing authentication configuration`);
      suggestions.push('Ensure each user has authentication configured (token, client-certificate-data, etc.)');
    }
  });

  // Check if current context is valid
  if (currentContext && contexts.length > 0) {
    const contextExists = contexts.some(c => c.name === currentContext);
    if (!contextExists) {
      issues.push(`Current context "${currentContext}" does not exist`);
      suggestions.push(`Set current-context to one of: ${contexts.map(c => c.name).join(', ')}`);
    } else {
      const context = contexts.find(c => c.name === currentContext);
      if (context && context.context) {
        const clusterExists = clusters.some(c => c.name === context.context.cluster);
        const userExists = users.some(u => u.name === context.context.user);
        
        if (!clusterExists) {
          issues.push(`Current context "${currentContext}" references non-existent cluster "${context.context.cluster}"`);
          suggestions.push(`Add cluster "${context.context.cluster}" or update context to use an existing cluster`);
        }
        if (!userExists) {
          issues.push(`Current context "${currentContext}" references non-existent user "${context.context.user}"`);
          suggestions.push(`Add user "${context.context.user}" or update context to use an existing user`);
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    suggestions,
    parsed: parsed, // Always return parsed if parsing succeeded, even if there are issues
    info: {
      clustersCount: clusters ? clusters.length : 0,
      contextsCount: contexts ? contexts.length : 0,
      usersCount: users ? users.length : 0,
      currentContext: currentContext || 'none',
      clusters: clusters ? clusters.map(c => c.name) : [],
      contexts: contexts ? contexts.map(c => c.name) : [],
      users: users ? users.map(u => u.name) : []
    }
  };
}

// Function to resolve kubeconfig issues
function resolveKubeconfigIssues(kubeconfig) {
  const resolution = {
    resolved: false,
    originalKubeconfig: kubeconfig,
    resolvedKubeconfig: kubeconfig,
    fixes: [],
    remainingIssues: []
  };

  try {
    // Parse the kubeconfig
    const kc = new k8s.KubeConfig();
    let parsedSuccessfully = false;
    
    try {
      kc.loadFromString(kubeconfig);
      parsedSuccessfully = true;
    } catch (parseError) {
      // Try to fix basic YAML issues
      // Remove trailing whitespace
      let fixed = kubeconfig.trim();
      
      // Try parsing again
      try {
        kc.loadFromString(fixed);
        resolution.fixes.push('Removed trailing whitespace');
        resolution.resolvedKubeconfig = fixed;
        parsedSuccessfully = true;
      } catch (e) {
        resolution.remainingIssues.push('Cannot parse YAML - manual fix required');
        return resolution;
      }
    }

    if (!parsedSuccessfully) {
      return resolution;
    }

    // Load as YAML object for manipulation
    let configObj;
    try {
      configObj = yaml.load(resolution.resolvedKubeconfig);
      if (!configObj || typeof configObj !== 'object') {
        resolution.remainingIssues.push('Invalid kubeconfig structure');
        return resolution;
      }
    } catch (yamlError) {
      resolution.remainingIssues.push('YAML parsing failed - cannot auto-resolve');
      return resolution;
    }

    const clusters = kc.getClusters();
    const contexts = kc.getContexts();
    const users = kc.getUsers();
    const currentContext = kc.getCurrentContext();

    // Fix 1: Set current-context if missing or invalid
    if (!currentContext || !contexts.some(c => c.name === currentContext)) {
      if (contexts.length > 0) {
        // Find first valid context (one that references existing cluster and user)
        let validContext = null;
        for (const ctx of contexts) {
          if (ctx.context) {
            const clusterExists = clusters.some(c => c.name === ctx.context.cluster);
            const userExists = users.some(u => u.name === ctx.context.user);
            if (clusterExists && userExists) {
              validContext = ctx.name;
              break;
            }
          }
        }
        
        // If no perfect match, use first context anyway
        if (!validContext && contexts.length > 0) {
          validContext = contexts[0].name;
        }
        
        if (validContext) {
          configObj['current-context'] = validContext;
          resolution.fixes.push(`Set current-context to "${validContext}"`);
        }
      }
    } else {
      // Verify current context is valid
      const context = contexts.find(c => c.name === currentContext);
      if (context && context.context) {
        const clusterExists = clusters.some(c => c.name === context.context.cluster);
        const userExists = users.some(u => u.name === context.context.user);
        
        if (!clusterExists || !userExists) {
          // Find a valid context
          let validContext = null;
          for (const ctx of contexts) {
            if (ctx.context) {
              const cExists = clusters.some(c => c.name === ctx.context.cluster);
              const uExists = users.some(u => u.name === ctx.context.user);
              if (cExists && uExists) {
                validContext = ctx.name;
                break;
              }
            }
          }
          
          if (validContext && validContext !== currentContext) {
            configObj['current-context'] = validContext;
            resolution.fixes.push(`Changed current-context from "${currentContext}" to "${validContext}" (original was invalid)`);
          }
        }
      }
    }

    // Fix 2: Ensure contexts reference valid clusters and users
    // This is more complex and might require manual intervention, but we can log warnings

    // Convert back to YAML
    try {
      const resolvedYaml = yaml.dump(configObj, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
      });
      
      resolution.resolvedKubeconfig = resolvedYaml;
      resolution.resolved = resolution.fixes.length > 0;
      
      // Validate the resolved config
      const validation = validateKubeconfig(resolvedYaml);
      resolution.remainingIssues = validation.issues || [];
      
    } catch (yamlError) {
      resolution.remainingIssues.push('Failed to convert resolved config back to YAML');
    }

  } catch (error) {
    resolution.remainingIssues.push(`Resolution error: ${error.message}`);
  }

  return resolution;
}

// Resolve kubeconfig issues endpoint
app.post('/api/k8s/resolve', (req, res) => {
  try {
    const { kubeconfig } = req.body;
    
    if (!kubeconfig) {
      return res.status(400).json({
        error: 'Kubeconfig is required',
        message: 'Please provide a kubeconfig YAML content'
      });
    }

    const resolution = resolveKubeconfigIssues(kubeconfig);
    
    res.json({
      success: true,
      resolved: resolution.resolved,
      fixes: resolution.fixes,
      remainingIssues: resolution.remainingIssues,
      resolvedKubeconfig: resolution.resolvedKubeconfig,
      hasChanges: resolution.resolvedKubeconfig !== resolution.originalKubeconfig
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to resolve kubeconfig',
      message: error.message
    });
  }
});

// Validate kubeconfig endpoint
app.post('/api/k8s/validate', (req, res) => {
  try {
    const { kubeconfig } = req.body;
    
    const validation = validateKubeconfig(kubeconfig);

    if (validation.valid) {
      res.json({
        success: true,
        valid: true,
        message: 'Kubeconfig is valid',
        info: validation.info
      });
    } else {
      res.status(400).json({
        success: false,
        valid: false,
        issues: validation.issues,
        suggestions: validation.suggestions,
        info: validation.info || null
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      valid: false,
      error: 'Failed to validate kubeconfig',
      message: error.message
    });
  }
});

// Load kubeconfigs from MongoDB (legacy - for migration)
async function loadKubeconfigsFromMongoDB() {
  if (!db) return;
  try {
    // Try new collection first
    const newCollection = db.collection(USER_KUBECONFIGS_COLLECTION);
    const newKubeconfigs = await newCollection.find({}).toArray();
    if (newKubeconfigs.length > 0) {
      kubeconfigsData = newKubeconfigs;
      console.log(`📊 Loaded ${kubeconfigsData.length} kubeconfigs from MongoDB (user-specific)`);
      return;
    }
    // Fallback to old collection for migration
    const oldCollection = db.collection(KUBECONFIGS_COLLECTION);
    const oldKubeconfigs = await oldCollection.find({}).toArray();
    if (oldKubeconfigs.length > 0) {
      // Migrate to new collection with userId
      for (const kc of oldKubeconfigs) {
        if (!kc.userId) {
          kc.userId = 'system'; // Default for legacy data
        }
        await newCollection.insertOne(kc);
      }
      await oldCollection.deleteMany({});
      kubeconfigsData = await newCollection.find({}).toArray();
      console.log(`📊 Migrated ${kubeconfigsData.length} kubeconfigs to user-specific collection`);
    }
  } catch (error) {
    console.error('Error loading kubeconfigs:', error);
  }
}

// Save kubeconfigs to MongoDB (legacy - for backward compatibility)
async function saveKubeconfigsToMongoDB() {
  // This function is kept for backward compatibility but user-specific saves happen directly
  console.warn('⚠️ saveKubeconfigsToMongoDB is deprecated - use user-specific endpoints');
}

// Kubeconfig Management API Endpoints

// Get all kubeconfigs (user-specific, admin can see all)
app.get('/api/k8s/kubeconfigs', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    
    if (!db) {
      // In-memory mode - filter by user
      const userKubeconfigs = isAdmin 
        ? kubeconfigsData 
        : kubeconfigsData.filter(kc => kc.userId === userId);
      return res.json({ success: true, kubeconfigs: userKubeconfigs });
    }
    
    const collection = db.collection(USER_KUBECONFIGS_COLLECTION);
    const query = isAdmin ? {} : { userId };
    const kubeconfigs = await collection.find(query).toArray();
    
    res.json({ success: true, kubeconfigs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save a new kubeconfig (user-specific)
app.post('/api/k8s/kubeconfigs', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, kubeconfig } = req.body;
    
    if (!name || !kubeconfig) {
      return res.status(400).json({
        success: false,
        error: 'Name and kubeconfig are required'
      });
    }

    // Validate kubeconfig
    const validation = validateKubeconfig(kubeconfig);
    if (!validation.parsed) {
      return res.status(400).json({
        success: false,
        error: 'Invalid kubeconfig',
        issues: validation.issues
      });
    }

    const newKubeconfig = {
      id: `kubeconfig-${Date.now()}`,
      userId,
      name: name.trim(),
      kubeconfig: kubeconfig,
      isActive: req.body.isActive || false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!db) {
      // In-memory mode
      if (newKubeconfig.isActive) {
        kubeconfigsData.forEach(kc => {
          if (kc.userId === userId) kc.isActive = false;
        });
      }
      kubeconfigsData.push(newKubeconfig);
      return res.json({ success: true, kubeconfig: newKubeconfig });
    }

    const collection = db.collection(USER_KUBECONFIGS_COLLECTION);
    
    // If setting as active, deactivate user's other kubeconfigs
    if (newKubeconfig.isActive) {
      await collection.updateMany(
        { userId, isActive: true },
        { $set: { isActive: false } }
      );
    }
    
    // Save to MongoDB for retention (MongoDB is the source of truth)
    await collection.insertOne(newKubeconfig);
    console.log(`✅ Saved kubeconfig "${newKubeconfig.name}" to MongoDB for user ${userId}`);
    res.json({ success: true, kubeconfig: newKubeconfig });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update a kubeconfig (user-specific, admin can update any)
app.put('/api/k8s/kubeconfigs/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const { id } = req.params;
    const { name, kubeconfig, isActive } = req.body;

    if (!db) {
      // In-memory mode
      const index = kubeconfigsData.findIndex(kc => 
        kc.id === id && (isAdmin || kc.userId === userId)
      );
      if (index === -1) {
        return res.status(404).json({ success: false, error: 'Kubeconfig not found' });
      }

      if (isActive === true) {
        kubeconfigsData.forEach(kc => {
          if (kc.id !== id && kc.userId === kubeconfigsData[index].userId) {
            kc.isActive = false;
          }
        });
      }

      if (kubeconfig) {
        const validation = validateKubeconfig(kubeconfig);
        if (!validation.parsed) {
          return res.status(400).json({
            success: false,
            error: 'Invalid kubeconfig',
            issues: validation.issues
          });
        }
        kubeconfigsData[index].kubeconfig = kubeconfig;
      }

      if (name !== undefined) kubeconfigsData[index].name = name.trim();
      if (isActive !== undefined) kubeconfigsData[index].isActive = isActive;
      kubeconfigsData[index].updatedAt = new Date().toISOString();
      return res.json({ success: true, kubeconfig: kubeconfigsData[index] });
    }

    const collection = db.collection(USER_KUBECONFIGS_COLLECTION);
    const query = isAdmin ? { id } : { id, userId };
    const kubeconfigDoc = await collection.findOne(query);
    
    if (!kubeconfigDoc) {
      return res.status(404).json({ success: false, error: 'Kubeconfig not found' });
    }

    // If setting as active, deactivate user's other kubeconfigs
    if (isActive === true) {
      await collection.updateMany(
        { userId: kubeconfigDoc.userId, id: { $ne: id }, isActive: true },
        { $set: { isActive: false } }
      );
    }

    // Validate kubeconfig if provided
    if (kubeconfig) {
      const validation = validateKubeconfig(kubeconfig);
      if (!validation.parsed) {
        return res.status(400).json({
          success: false,
          error: 'Invalid kubeconfig',
          issues: validation.issues
        });
      }
    }

    const update = {
      updatedAt: new Date().toISOString()
    };
    if (name !== undefined) update.name = name.trim();
    if (kubeconfig !== undefined) update.kubeconfig = kubeconfig;
    if (isActive !== undefined) update.isActive = isActive;

    // Update in MongoDB for retention (MongoDB is the source of truth)
    await collection.updateOne({ id }, { $set: update });
    const updated = await collection.findOne({ id });
    console.log(`✅ Updated kubeconfig "${updated?.name}" in MongoDB`);
    res.json({ success: true, kubeconfig: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a kubeconfig (user-specific, admin can delete any)
app.delete('/api/k8s/kubeconfigs/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const { id } = req.params;

    if (!db) {
      // In-memory mode
      const index = kubeconfigsData.findIndex(kc => 
        kc.id === id && (isAdmin || kc.userId === userId)
      );
      if (index === -1) {
        return res.status(404).json({ success: false, error: 'Kubeconfig not found' });
      }
      kubeconfigsData.splice(index, 1);
      return res.json({ success: true, message: 'Kubeconfig deleted' });
    }

    const collection = db.collection(USER_KUBECONFIGS_COLLECTION);
    const query = isAdmin ? { id } : { id, userId };
    const result = await collection.deleteOne(query);
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Kubeconfig not found' });
    }
    
    res.json({ success: true, message: 'Kubeconfig deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Set active kubeconfig and connect (user-specific, admin can activate any)
app.post('/api/k8s/kubeconfigs/:id/activate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const { id } = req.params;

    let kubeconfig;
    if (!db) {
      // In-memory mode
      kubeconfig = kubeconfigsData.find(kc => 
        kc.id === id && (isAdmin || kc.userId === userId)
      );
      if (!kubeconfig) {
        return res.status(404).json({ success: false, error: 'Kubeconfig not found' });
      }
      // Deactivate user's other kubeconfigs
      kubeconfigsData.forEach(kc => {
        if (kc.userId === kubeconfig.userId) kc.isActive = (kc.id === id);
      });
    } else {
      const collection = db.collection(USER_KUBECONFIGS_COLLECTION);
      const query = isAdmin ? { id } : { id, userId };
      kubeconfig = await collection.findOne(query);
      
      if (!kubeconfig) {
        return res.status(404).json({ success: false, error: 'Kubeconfig not found' });
      }

      // Deactivate user's other kubeconfigs
      await collection.updateMany(
        { userId: kubeconfig.userId, id: { $ne: id } },
        { $set: { isActive: false } }
      );
      await collection.updateOne({ id }, { $set: { isActive: true } });
    }

    // Connect using this kubeconfig
    const validation = validateKubeconfig(kubeconfig.kubeconfig);
    if (!validation.parsed) {
      return res.status(400).json({
        success: false,
        error: 'Invalid kubeconfig',
        issues: validation.issues
      });
    }

    const kc = validation.parsed;
    k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
    k8sBatchApi = kc.makeApiClient(k8s.BatchV1Api);
    k8sNetworkingApi = kc.makeApiClient(k8s.NetworkingV1Api);
    currentKubeconfig = kubeconfig.kubeconfig;
    currentKubeConfig = kc;

    // Test connection with timeout
    try {
      // Wrap API call with timeout (15 seconds)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Connection timeout: The Kubernetes API server did not respond within 15 seconds'));
        }, 15000);
      });
      
      await Promise.race([
        k8sApi.listNamespace(),
        timeoutPromise
      ]);
      
      res.json({
        success: true,
        kubeconfig,
        message: 'Successfully connected to Kubernetes cluster'
      });
    } catch (connectionError) {
      const errorMsg = connectionError.message || 'Connection failed';
      const suggestions = [];
      
      if (connectionError.code === 'ETIMEDOUT' || errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
        suggestions.push('Connection timeout - the API server did not respond');
        suggestions.push('The cluster may be unreachable from your current network');
        suggestions.push('Check if you need to be on a VPN or specific network');
        suggestions.push('Verify the API server IP address and port');
      }
      
      res.status(500).json({
        success: false,
        error: 'Connection failed',
        message: errorMsg,
        errorCode: connectionError.code,
        suggestions: suggestions.length > 0 ? suggestions : undefined
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Kubernetes API endpoints
app.post('/api/k8s/connect', async (req, res) => {
  try {
    const { kubeconfig, kubeconfigId } = req.body;
    
    let kubeconfigToUse = kubeconfig;
    
    // If kubeconfigId is provided, use stored kubeconfig
    if (kubeconfigId && !kubeconfig) {
      await loadKubeconfigsFromMongoDB();
      const stored = kubeconfigsData.find(kc => kc.id === kubeconfigId);
      if (!stored) {
        return res.status(404).json({
          success: false,
          error: 'Kubeconfig not found'
        });
      }
      kubeconfigToUse = stored.kubeconfig;
    }
    
    if (!kubeconfigToUse) {
      return res.status(400).json({
        success: false,
        error: 'kubeconfig or kubeconfigId is required'
      });
    }
    
    // First validate the kubeconfig - but be lenient if it can parse
    const validation = validateKubeconfig(kubeconfigToUse);
    
    // If it can't parse at all, return error
    if (!validation.parsed) {
      return res.status(400).json({
        error: 'Invalid kubeconfig - cannot parse',
        valid: false,
        issues: validation.issues,
        suggestions: validation.suggestions,
        info: validation.info
      });
    }

    // If validation found issues but kubeconfig can parse, warn but continue
    // Use the parsed kubeconfig even if validation found minor issues
    const kc = validation.parsed;

    // Create API clients
    k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
    k8sBatchApi = kc.makeApiClient(k8s.BatchV1Api);
    k8sNetworkingApi = kc.makeApiClient(k8s.NetworkingV1Api);
    currentKubeconfig = kubeconfigToUse;
    
    // Store the KubeConfig for direct HTTP calls if needed
    currentKubeConfig = kc;
    
    console.log('✅ Kubernetes API clients created');
    console.log('✅ k8sApi initialized:', !!k8sApi);
    console.log('✅ k8sAppsApi initialized:', !!k8sAppsApi);
    console.log('✅ k8sBatchApi initialized:', !!k8sBatchApi);

    // Test connection with timeout
    try {
      console.log('🔍 Testing connection to Kubernetes cluster...');
      console.log('🔍 Current context:', kc.getCurrentContext());
      const cluster = kc.getCurrentCluster();
      if (cluster) {
        console.log('🔍 Cluster server:', cluster.server);
      }
      
      // Wrap API call with timeout (15 seconds)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Connection timeout: The Kubernetes API server did not respond within 15 seconds'));
        }, 15000);
      });
      
      // Use listNamespace() (singular) - the method returns a promise
      const response = await Promise.race([
        k8sApi.listNamespace(),
        timeoutPromise
      ]);
      
      console.log('✅ Connection test successful');
      res.json({
        success: true,
        valid: true,
        message: 'Successfully connected to Kubernetes cluster',
        info: validation.info,
        warnings: validation.issues && validation.issues.length > 0 ? validation.issues : undefined
      });
    } catch (connectionError) {
      // Connection test failed, but kubeconfig structure is valid
      console.error('❌ Connection test failed:', connectionError.message);
      console.error('❌ Error code:', connectionError.code);
      console.error('❌ Error statusCode:', connectionError.statusCode);
      
      const errorMsg = connectionError.message || 'Cannot reach Kubernetes cluster';
      const statusCode = connectionError.statusCode || connectionError.response?.statusCode || 500;
      const suggestions = [
        'Check if the cluster server URL is accessible',
        'Verify network connectivity',
        'Ensure firewall rules allow access',
        'Check if the cluster API server is running',
      ];

      // Add specific suggestions based on error
      if (connectionError.code === 'ETIMEDOUT' || errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
        suggestions.unshift('Connection timeout - the API server did not respond');
        suggestions.push('The cluster may be unreachable from your current network');
        suggestions.push('Check if you need to be on a VPN or specific network to access the cluster');
        suggestions.push('Verify the API server IP address and port (default is 6443)');
        suggestions.push('Try accessing the cluster from kubectl to verify connectivity');
        suggestions.push('Check if there are network restrictions or firewall rules blocking the connection');
      }
      if (connectionError.code === 'ENOTFOUND' || errorMsg.includes('ENOTFOUND')) {
        suggestions.push('DNS resolution failed - verify the server URL is correct');
      }
      if (connectionError.code === 'ECONNREFUSED' || errorMsg.includes('ECONNREFUSED')) {
        suggestions.push('Connection refused - the server may be down or the URL is incorrect');
        suggestions.push('Check if you need to be on a VPN or specific network to access the cluster');
        suggestions.push('Verify the API server IP address and port (default is 6443)');
        suggestions.push('Try accessing the cluster from kubectl to verify connectivity');
      }
      if (statusCode === 401 || errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
        suggestions.push('Authentication failed - verify your credentials (certificate, token, etc.)');
      }
      if (statusCode === 403 || errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
        suggestions.push('Access forbidden - check user permissions and RBAC settings');
      }
      if (errorMsg.includes('certificate') || errorMsg.includes('SSL') || errorMsg.includes('TLS')) {
        suggestions.push('SSL/TLS certificate issue - verify certificate data or disable verification if using self-signed certs');
      }

      res.status(500).json({
        error: 'Failed to connect to cluster',
        valid: true, // Structure is valid, but can't reach cluster
        message: errorMsg,
        errorCode: connectionError.code,
        suggestions: suggestions,
        info: validation.info,
        warnings: validation.issues && validation.issues.length > 0 ? validation.issues : undefined
      });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Failed to process kubeconfig',
      message: error.message
    });
  }
});

app.get('/api/k8s/deployments', async (req, res) => {
  try {
    if (!k8sAppsApi) {
      return res.status(400).json({
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const namespace = req.query.namespace || 'default';
    console.log('📦 Deployments endpoint - Requested namespace:', namespace, 'Query:', req.query);
    
    if (!namespace || namespace.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Invalid namespace',
        message: 'Namespace parameter is required and cannot be empty'
      });
    }
    
    let deployments = [];
    
    if (namespace === 'all' || namespace === '*') {
      // Fetch deployments from all namespaces
      const response = await k8sAppsApi.listDeploymentForAllNamespaces();
      console.log('📦 All namespaces deployments response:', {
        hasResponse: !!response,
        hasBody: !!response?.body,
        hasItems: !!response?.body?.items,
        responseType: typeof response,
        responseKeys: response ? Object.keys(response) : []
      });
      
      // Handle both response.body.items and direct response.items
      const items = response?.body?.items || response?.items || [];
      
      if (!response) {
        console.error('❌ Invalid response from listDeploymentForAllNamespaces');
        return res.status(500).json({
          success: false,
          error: 'Invalid response',
          message: 'Received invalid response from Kubernetes API'
        });
      }
      
      deployments = (items || []).map((deployment) => {
        const containers = deployment.spec.template.spec.containers || [];
        return {
          name: deployment.metadata.name,
          namespace: deployment.metadata.namespace,
          replicas: deployment.spec.replicas || 0,
          readyReplicas: deployment.status.readyReplicas || 0,
          containers: containers.map((container) => ({
            name: container.name,
            image: container.image,
            imagePullPolicy: container.imagePullPolicy || 'IfNotPresent'
          })),
          labels: deployment.metadata.labels || {},
          creationTimestamp: deployment.metadata.creationTimestamp
        };
      });
    } else {
      // Fetch deployments from specific namespace
      const namespaceParam = namespace.trim();
      console.log('📦 Fetching deployments from namespace:', namespaceParam, 'Type:', typeof namespaceParam, 'Length:', namespaceParam.length);
      
      if (!namespaceParam || namespaceParam.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid namespace',
          message: 'Namespace parameter cannot be empty'
        });
      }
      
      // Workaround for library bug - ensure namespace is a primitive string
      const ns = typeof namespaceParam === 'string' ? namespaceParam.trim() : String(namespaceParam).trim();
      if (!ns || ns.length === 0) {
        throw new Error('Namespace cannot be empty');
      }
      
      console.log('📦 Calling listNamespacedDeployment with namespace:', ns);
      
      // The library bug: parameter validation fails even with valid strings
      // Use direct HTTP call as workaround
      let response;
      try {
        response = await k8sAppsApi.listNamespacedDeployment(ns);
      } catch (libraryError) {
        console.log('⚠️ Library method failed, using direct HTTP call...');
        response = await makeK8sDirectHttpCall(`/apis/apps/v1/namespaces/{namespace}/deployments`, ns);
      }
      
      // Handle both response.body.items and direct response.items
      const items = response?.body?.items || response?.items || [];
      
      if (!response) {
        console.error('❌ Invalid response from listNamespacedDeployment');
        return res.status(500).json({
          success: false,
          error: 'Invalid response',
          message: 'Received invalid response from Kubernetes API'
        });
      }
      
      deployments = (items || []).map((deployment) => {
        const containers = deployment.spec.template.spec.containers || [];
        return {
          name: deployment.metadata.name,
          namespace: deployment.metadata.namespace,
          replicas: deployment.spec.replicas || 0,
          readyReplicas: deployment.status.readyReplicas || 0,
          containers: containers.map((container) => ({
            name: container.name,
            image: container.image,
            imagePullPolicy: container.imagePullPolicy || 'IfNotPresent'
          })),
          labels: deployment.metadata.labels || {},
          creationTimestamp: deployment.metadata.creationTimestamp
        };
      });
    }

    res.json({
      success: true,
      deployments,
      namespace
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch deployments',
      message: error.message || 'Error fetching deployments from Kubernetes'
    });
  }
});

app.get('/api/k8s/services', async (req, res) => {
  try {
    if (!k8sApi) {
      return res.status(400).json({
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const namespace = req.query.namespace || 'default';
    console.log('📦 Services endpoint - Requested namespace:', namespace, 'Query:', req.query);
    
    if (!namespace || namespace.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Invalid namespace',
        message: 'Namespace parameter is required and cannot be empty'
      });
    }
    
    let services = [];
    
    if (namespace === 'all' || namespace === '*') {
      // Fetch services from all namespaces
      const response = await k8sApi.listServiceForAllNamespaces();
      console.log('📦 All namespaces services response:', {
        hasResponse: !!response,
        hasBody: !!response?.body,
        hasItems: !!response?.body?.items,
        responseType: typeof response,
        responseKeys: response ? Object.keys(response) : []
      });
      
      // Handle both response.body.items and direct response.items
      const items = response?.body?.items || response?.items || [];
      
      if (!response) {
        console.error('❌ Invalid response from listServiceForAllNamespaces');
        return res.status(500).json({
          success: false,
          error: 'Invalid response',
          message: 'Received invalid response from Kubernetes API'
        });
      }
      
      services = (items || []).map((service) => {
        const ports = service.spec.ports || [];
        return {
          name: service.metadata.name,
          namespace: service.metadata.namespace,
          type: service.spec.type || 'ClusterIP',
          ports: ports.map((port) => ({
            port: port.port,
            targetPort: port.targetPort,
            protocol: port.protocol || 'TCP',
            name: port.name
          })),
          selector: service.spec.selector || {},
          clusterIP: service.spec.clusterIP,
          labels: service.metadata.labels || {},
          creationTimestamp: service.metadata.creationTimestamp
        };
      });
    } else {
      // Fetch services from specific namespace
      const namespaceParam = namespace.trim();
      console.log('📦 Fetching services from namespace:', namespaceParam, 'Type:', typeof namespaceParam, 'Length:', namespaceParam.length);
      
      if (!namespaceParam || namespaceParam.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid namespace',
          message: 'Namespace parameter cannot be empty'
        });
      }
      
      // Ensure namespace is a string and k8sApi is initialized
      const ns = String(namespaceParam).trim();
      if (!ns) {
        return res.status(400).json({
          success: false,
          error: 'Invalid namespace',
          message: 'Namespace cannot be empty'
        });
      }
      
      if (!k8sApi || typeof k8sApi.listNamespacedService !== 'function') {
        return res.status(500).json({
          success: false,
          error: 'API not initialized',
          message: 'Kubernetes API client is not properly initialized. Please reconnect to the cluster.'
        });
      }
      
      console.log('📦 Calling listNamespacedService with namespace:', ns);
      
      // WORKAROUND: The library has a bug where it doesn't recognize namespace parameter
      // Use direct HTTP call via KubeConfig's request options
      let response;
      
      try {
        // Try the library method first
        response = await k8sApi.listNamespacedService(ns);
      } catch (libraryError) {
        console.log('⚠️ Library method failed due to parameter validation bug, using direct HTTP call...');
        
        // Use KubeConfig's request method as a workaround
        if (!currentKubeConfig) {
          throw new Error('KubeConfig not available');
        }
        
        const cluster = currentKubeConfig.getCurrentCluster();
        if (!cluster || !cluster.server) {
          throw new Error('No active cluster');
        }
        
        // Use direct HTTP call as workaround
        response = await makeK8sDirectHttpCall(`/api/v1/namespaces/{namespace}/services`, ns);
      }
      
      // Handle both response.body.items and direct response.items
      const items = response?.body?.items || response?.items || [];
      
      if (!response) {
        console.error('❌ Invalid response from listNamespacedService');
        return res.status(500).json({
          success: false,
          error: 'Invalid response',
          message: 'Received invalid response from Kubernetes API'
        });
      }
      
      services = (items || []).map((service) => {
        const ports = service.spec.ports || [];
        return {
          name: service.metadata.name,
          namespace: service.metadata.namespace,
          type: service.spec.type || 'ClusterIP',
          ports: ports.map((port) => ({
            port: port.port,
            targetPort: port.targetPort,
            protocol: port.protocol || 'TCP',
            name: port.name
          })),
          selector: service.spec.selector || {},
          clusterIP: service.spec.clusterIP,
          labels: service.metadata.labels || {},
          creationTimestamp: service.metadata.creationTimestamp
        };
      });
    }

    res.json({
      success: true,
      services,
      namespace
    });
  } catch (error) {
    console.error('❌ Error fetching services:', error);
    console.error('❌ Error details:', {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      response: error.response?.body || error.response
    });
    res.status(500).json({
      error: 'Failed to fetch services',
      message: error.message || 'Error fetching services from Kubernetes',
      details: error.response?.body || error.code
    });
  }
});

// Get CronJobs
app.get('/api/k8s/cronjobs', async (req, res) => {
  try {
    if (!k8sBatchApi) {
      return res.status(400).json({
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const namespace = req.query.namespace || 'default';
    console.log('📦 CronJobs endpoint - Requested namespace:', namespace, 'Query:', req.query);
    
    if (!namespace || namespace.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Invalid namespace',
        message: 'Namespace parameter is required and cannot be empty'
      });
    }
    
    let cronjobs = [];
    
    if (namespace === 'all' || namespace === '*') {
      // Fetch cronjobs from all namespaces
      let response;
      try {
        // Try library method first
        if (k8sBatchApi && typeof k8sBatchApi.listCronJobForAllNamespaces === 'function') {
          response = await k8sBatchApi.listCronJobForAllNamespaces();
        } else {
          throw new Error('Library method not available');
        }
      } catch (libraryError) {
        console.log('⚠️ Library method failed for all namespaces, using direct HTTP call...', libraryError.message);
        try {
          // Try batch/v1 first (Kubernetes 1.21+)
          response = await makeK8sDirectHttpCall(`/apis/batch/v1/cronjobs`, null);
        } catch (v1Error) {
          // Handle 403 Forbidden (RBAC permissions issue)
          if (v1Error.message && (v1Error.message.includes('403') || v1Error.message.includes('Forbidden'))) {
            console.warn('⚠️ Permission denied (403) for CronJobs. User/service account lacks cluster-wide "list" permission on cronjobs resource.');
            console.warn('💡 To fix: Grant RBAC permissions with ClusterRole or skip CronJobs.');
            // Return empty array instead of failing
            cronjobs = [];
            response = null; // Ensure response is null when we have 403
          } else {
            console.log('⚠️ batch/v1 failed, trying batch/v1beta1...', v1Error.message);
            try {
              // Fallback to batch/v1beta1 for older Kubernetes versions
              response = await makeK8sDirectHttpCall(`/apis/batch/v1beta1/cronjobs`, null);
            } catch (v1beta1Error) {
              // Handle 403 Forbidden in fallback too
              if (v1beta1Error.message && (v1beta1Error.message.includes('403') || v1beta1Error.message.includes('Forbidden'))) {
                console.warn('⚠️ Permission denied (403) for CronJobs. User/service account lacks cluster-wide "list" permission on cronjobs resource.');
                console.warn('💡 To fix: Grant RBAC permissions with ClusterRole or skip CronJobs.');
                // Return empty array instead of failing
                cronjobs = [];
                response = null; // Ensure response is null when we have 403
              } else {
                throw v1beta1Error;
              }
            }
          }
        }
      }
      
      // Only process response if we got one (not 403)
      if (response && cronjobs.length === 0) {
        const items = response?.body?.items || response?.items || [];
        
        cronjobs = (items || []).map((cronjob) => {
          const containers = cronjob.spec?.jobTemplate?.spec?.template?.spec?.containers || [];
          return {
            name: cronjob.metadata.name,
            namespace: cronjob.metadata.namespace,
            schedule: cronjob.spec?.schedule || '',
            suspend: cronjob.spec?.suspend || false,
            active: cronjob.status?.active?.length || 0,
            lastScheduleTime: cronjob.status?.lastScheduleTime || '',
            lastSuccessfulTime: cronjob.status?.lastSuccessfulTime || '',
            containers: containers.map((container) => ({
              name: container.name,
              image: container.image,
              imagePullPolicy: container.imagePullPolicy || 'IfNotPresent'
            })),
            labels: cronjob.metadata.labels || {},
            creationTimestamp: cronjob.metadata.creationTimestamp
          };
        });
      }
    } else {
      // Fetch cronjobs from specific namespace
      const ns = typeof namespace === 'string' ? namespace.trim() : String(namespace).trim();
      if (!ns || ns.length === 0) {
        throw new Error('Namespace cannot be empty');
      }
      
      // Use direct HTTP call for CronJobs (library has namespace parameter issues)
      let response;
      let has403Error = false;
      try {
        // Try batch/v1 first (Kubernetes 1.21+)
        response = await makeK8sDirectHttpCall(`/apis/batch/v1/namespaces/${encodeURIComponent(ns)}/cronjobs`, null);
      } catch (v1Error) {
        // Handle 403 Forbidden (RBAC permissions issue)
        if (v1Error.message && (v1Error.message.includes('403') || v1Error.message.includes('Forbidden'))) {
          console.warn(`⚠️ Permission denied (403) for CronJobs in namespace '${ns}'. User/service account lacks 'list' permission on cronjobs resource.`);
          console.warn('💡 To fix: Grant RBAC permissions or skip CronJobs for this namespace.');
          // Return empty array instead of failing
          cronjobs = [];
          has403Error = true;
          response = null; // Ensure response is null when we have 403
        } else {
          console.log('⚠️ batch/v1 failed for CronJobs, trying batch/v1beta1...', v1Error.message);
          try {
            // Fallback to batch/v1beta1 for older Kubernetes versions
            response = await makeK8sDirectHttpCall(`/apis/batch/v1beta1/namespaces/${encodeURIComponent(ns)}/cronjobs`, null);
          } catch (v1beta1Error) {
            // Handle 403 Forbidden in fallback too
            if (v1beta1Error.message && (v1beta1Error.message.includes('403') || v1beta1Error.message.includes('Forbidden'))) {
              console.warn(`⚠️ Permission denied (403) for CronJobs in namespace '${ns}'. User/service account lacks 'list' permission on cronjobs resource.`);
              console.warn('💡 To fix: Grant RBAC permissions or skip CronJobs for this namespace.');
              // Return empty array instead of failing
              cronjobs = [];
              has403Error = true;
              response = null; // Ensure response is null when we have 403
            } else {
              console.error('❌ Failed to fetch CronJobs via direct HTTP call:', v1beta1Error.message);
              throw v1beta1Error;
            }
          }
        }
      }
      
      // Only process response if we got one (not 403)
      if (response && !has403Error && cronjobs.length === 0) {
        const items = response?.body?.items || response?.items || [];
        
        cronjobs = (items || []).map((cronjob) => {
          const containers = cronjob.spec?.jobTemplate?.spec?.template?.spec?.containers || [];
          return {
            name: cronjob.metadata.name,
            namespace: cronjob.metadata.namespace,
            schedule: cronjob.spec?.schedule || '',
            suspend: cronjob.spec?.suspend || false,
            active: cronjob.status?.active?.length || 0,
            lastScheduleTime: cronjob.status?.lastScheduleTime || '',
            lastSuccessfulTime: cronjob.status?.lastSuccessfulTime || '',
            containers: containers.map((container) => ({
              name: container.name,
              image: container.image,
              imagePullPolicy: container.imagePullPolicy || 'IfNotPresent'
            })),
            labels: cronjob.metadata.labels || {},
            creationTimestamp: cronjob.metadata.creationTimestamp
          };
        });
      }
    }

    res.json({
      success: true,
      cronjobs,
      namespace
    });
  } catch (error) {
    console.error('❌ Error fetching cronjobs:', error);
    console.error('❌ Error details:', {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode || error.response?.statusCode,
      response: error.response?.data || error.response?.body
    });
    
    // Handle 403 Forbidden - return empty array with warning
    const statusCode = error.statusCode || error.response?.statusCode || 500;
    if (statusCode === 403) {
      console.warn('⚠️ Permission denied (403) for CronJobs. This is an RBAC permissions issue.');
      return res.json({
        success: true,
        cronjobs: [],
        warning: 'Permission denied: User/service account lacks permission to list CronJobs. Grant RBAC permissions or contact cluster administrator.',
        message: 'No cronjobs accessible (403 Forbidden)',
        namespace: req.query.namespace || 'default'
      });
    }
    
    // If it's a 404, it might just mean no cronjobs exist - return empty array
    if (statusCode === 404) {
      return res.json({
        success: true,
        cronjobs: [],
        namespace: req.query.namespace || 'default'
      });
    }
    
    res.status(statusCode < 600 ? statusCode : 500).json({
      success: false,
      error: 'Failed to fetch cronjobs',
      message: error.message || 'Error fetching cronjobs from Kubernetes',
      details: error.response?.data || error.code || 'Unknown error'
    });
  }
});

// Get Nodes (cluster-level)
app.get('/api/k8s/nodes', async (req, res) => {
  try {
    if (!k8sApi) {
      return res.status(400).json({
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const response = await k8sApi.listNode();
    const items = response?.body?.items || response?.items || [];

    const nodes = (items || []).map((node) => {
      const labels = node?.metadata?.labels || {};
      const roles = Object.keys(labels)
        .filter((k) => k.startsWith('node-role.kubernetes.io/'))
        .map((k) => k.split('/')[1] || k);

      const readyCondition = (node?.status?.conditions || []).find((c) => c.type === 'Ready');
      return {
        name: node?.metadata?.name || 'unknown',
        status: readyCondition?.status === 'True' ? 'Ready' : 'NotReady',
        roles,
        kubeletVersion: node?.status?.nodeInfo?.kubeletVersion,
        containerRuntime: node?.status?.nodeInfo?.containerRuntimeVersion,
        cpu: node?.status?.allocatable?.cpu,
        memory: node?.status?.allocatable?.memory,
        podCapacity: node?.status?.capacity?.pods,
        creationTimestamp: node?.metadata?.creationTimestamp,
      };
    });

    res.json({ success: true, nodes });
  } catch (error) {
    console.error('❌ Error fetching nodes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch nodes',
      message: error.message || 'Error fetching nodes from Kubernetes',
      details: error.response?.data || error.code || 'Unknown error'
    });
  }
});

// Get Jobs
app.get('/api/k8s/jobs', async (req, res) => {
  try {
    if (!k8sBatchApi) {
      return res.status(400).json({
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const namespace = req.query.namespace || 'default';
    console.log('📦 Jobs endpoint - Requested namespace:', namespace, 'Query:', req.query);
    
    if (!namespace || namespace.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Invalid namespace',
        message: 'Namespace parameter is required and cannot be empty'
      });
    }
    
    let jobs = [];
    
    if (namespace === 'all' || namespace === '*') {
      // Fetch jobs from all namespaces
      let response;
      try {
        // Try library method first
        if (k8sBatchApi && typeof k8sBatchApi.listJobForAllNamespaces === 'function') {
          response = await k8sBatchApi.listJobForAllNamespaces();
        } else {
          throw new Error('Library method not available');
        }
      } catch (libraryError) {
        console.log('⚠️ Library method failed for all namespaces Jobs, using direct HTTP call...', libraryError.message);
        response = await makeK8sDirectHttpCall(`/apis/batch/v1/jobs`, null);
      }
      const items = response?.body?.items || response?.items || [];
      
      jobs = (items || []).map((job) => {
        const containers = job.spec?.template?.spec?.containers || [];
        return {
          name: job.metadata.name,
          namespace: job.metadata.namespace,
          completions: job.spec?.completions || 1,
          parallelism: job.spec?.parallelism || 1,
          active: job.status?.active || 0,
          succeeded: job.status?.succeeded || 0,
          failed: job.status?.failed || 0,
          startTime: job.status?.startTime || '',
          completionTime: job.status?.completionTime || '',
          conditions: job.status?.conditions || [],
          containers: containers.map((container) => ({
            name: container.name,
            image: container.image,
            imagePullPolicy: container.imagePullPolicy || 'IfNotPresent'
          })),
          labels: job.metadata.labels || {},
          creationTimestamp: job.metadata.creationTimestamp
        };
      });
    } else {
      // Fetch jobs from specific namespace
      const ns = typeof namespace === 'string' ? namespace.trim() : String(namespace).trim();
      if (!ns || ns.length === 0) {
        throw new Error('Namespace cannot be empty');
      }
      
      // Use direct HTTP call for Jobs (library has namespace parameter issues)
      let response;
      try {
        response = await makeK8sDirectHttpCall(`/apis/batch/v1/namespaces/${encodeURIComponent(ns)}/jobs`, null);
      } catch (httpError) {
        console.error('❌ Failed to fetch jobs via direct HTTP call:', httpError.message);
        throw httpError;
      }
      
      const items = response?.body?.items || response?.items || [];
      
      jobs = (items || []).map((job) => {
        const containers = job.spec?.template?.spec?.containers || [];
        return {
          name: job.metadata.name,
          namespace: job.metadata.namespace,
          completions: job.spec?.completions || 1,
          parallelism: job.spec?.parallelism || 1,
          active: job.status?.active || 0,
          succeeded: job.status?.succeeded || 0,
          failed: job.status?.failed || 0,
          startTime: job.status?.startTime || '',
          completionTime: job.status?.completionTime || '',
          conditions: job.status?.conditions || [],
          containers: containers.map((container) => ({
            name: container.name,
            image: container.image,
            imagePullPolicy: container.imagePullPolicy || 'IfNotPresent'
          })),
          labels: job.metadata.labels || {},
          creationTimestamp: job.metadata.creationTimestamp
        };
      });
    }

    res.json({
      success: true,
      jobs,
      namespace
    });
  } catch (error) {
    console.error('❌ Error fetching jobs:', error);
    console.error('❌ Error details:', {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode || error.response?.statusCode,
      response: error.response?.data || error.response?.body
    });
    
    // If it's a 404, it might just mean no jobs exist - return empty array
    const statusCode = error.statusCode || error.response?.statusCode || 500;
    if (statusCode === 404) {
      return res.json({
        success: true,
        jobs: [],
        namespace: req.query.namespace || 'default'
      });
    }
    
    res.status(statusCode < 600 ? statusCode : 500).json({
      success: false,
      error: 'Failed to fetch jobs',
      message: error.message || 'Error fetching jobs from Kubernetes',
      details: error.response?.data || error.code || 'Unknown error'
    });
  }
});

// Get detailed CronJob information
app.get('/api/k8s/cronjobs/:namespace/:name', async (req, res) => {
  try {
    if (!k8sBatchApi) {
      return res.status(400).json({ error: 'Not connected', message: 'Please connect to a Kubernetes cluster first' });
    }

    const { namespace, name } = req.params;
    
    if (!namespace || !name) {
      return res.status(400).json({ error: 'Invalid parameters', message: 'Namespace and name are required' });
    }

    let response;
    try {
      // Try library method first
      if (k8sBatchApi && typeof k8sBatchApi.readNamespacedCronJob === 'function') {
        response = await k8sBatchApi.readNamespacedCronJob(name, namespace);
      } else {
        throw new Error('Library method not available');
      }
    } catch (libraryError) {
      console.log('⚠️ Library method failed for CronJob details, using direct HTTP call...', libraryError.message);
      try {
        // Try batch/v1 first (Kubernetes 1.21+)
        response = await makeK8sDirectHttpCall(`/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/cronjobs/${encodeURIComponent(name)}`, null);
      } catch (v1Error) {
        console.log('⚠️ batch/v1 failed, trying batch/v1beta1...', v1Error.message);
        // Fallback to batch/v1beta1 for older Kubernetes versions
        response = await makeK8sDirectHttpCall(`/apis/batch/v1beta1/namespaces/${encodeURIComponent(namespace)}/cronjobs/${encodeURIComponent(name)}`, null);
      }
    }

    const cronjob = response?.body || response;
    
    res.json({ success: true, cronjob });
  } catch (error) {
    console.error('❌ Error fetching cronjob details:', error);
    res.status(500).json({ error: 'Failed to fetch cronjob details', message: error.message || 'Error fetching cronjob from Kubernetes' });
  }
});

// Get detailed Job information
app.get('/api/k8s/jobs/:namespace/:name', async (req, res) => {
  try {
    if (!k8sBatchApi) {
      return res.status(400).json({ error: 'Not connected', message: 'Please connect to a Kubernetes cluster first' });
    }

    const { namespace, name } = req.params;
    
    if (!namespace || !name) {
      return res.status(400).json({ error: 'Invalid parameters', message: 'Namespace and name are required' });
    }

    let response;
    try {
      // Try library method first
      if (k8sBatchApi && typeof k8sBatchApi.readNamespacedJob === 'function') {
        response = await k8sBatchApi.readNamespacedJob(name, namespace);
      } else {
        throw new Error('Library method not available');
      }
    } catch (libraryError) {
      console.log('⚠️ Library method failed for Job details, using direct HTTP call...', libraryError.message);
      response = await makeK8sDirectHttpCall(`/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs/${encodeURIComponent(name)}`, null);
    }

    const job = response?.body || response;
    
    res.json({ success: true, job });
  } catch (error) {
    console.error('❌ Error fetching job details:', error);
    res.status(500).json({ error: 'Failed to fetch job details', message: error.message || 'Error fetching job from Kubernetes' });
  }
});

// Check Kubernetes connection status
app.get('/api/k8s/status', (req, res) => {
  res.json({
    connected: !!k8sApi,
    hasKubeconfig: !!currentKubeconfig,
    message: k8sApi ? 'Connected to Kubernetes cluster' : 'Not connected. Please connect with kubeconfig first.'
  });
});

app.get('/api/k8s/namespaces', async (req, res) => {
  try {
    if (!k8sApi) {
      console.error('❌ Namespaces endpoint: k8sApi is not initialized');
      console.error('Current state - k8sApi:', !!k8sApi, 'currentKubeconfig:', !!currentKubeconfig);
      return res.status(400).json({
        success: false,
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first. Click "Connect to Cluster" with your kubeconfig. If you already connected, the connection may have been lost - please reconnect.'
      });
    }

    console.log('📋 Fetching namespaces from Kubernetes cluster...');
    const response = await k8sApi.listNamespace();
    
    // Log response structure for debugging
    console.log('📋 Response type:', typeof response);
    console.log('📋 Response keys:', response ? Object.keys(response) : 'response is null');
    console.log('📋 Has body?', !!response?.body);
    console.log('📋 Body type:', typeof response?.body);
    console.log('📋 Body keys:', response?.body ? Object.keys(response.body) : 'body is null');
    
    // Safely handle response - check multiple possible structures
    let items = [];
    if (response && response.body && Array.isArray(response.body.items)) {
      items = response.body.items;
    } else if (response && Array.isArray(response.items)) {
      items = response.items;
    } else if (response && response.body && response.body.kind === 'NamespaceList' && Array.isArray(response.body.items)) {
      items = response.body.items;
    } else {
      console.error('❌ Namespaces endpoint: Invalid response structure');
      console.error('Response:', JSON.stringify(response, null, 2).substring(0, 500));
      return res.status(500).json({
        success: false,
        error: 'Invalid response',
        message: 'Received invalid response from Kubernetes API. Response structure does not match expected format.'
      });
    }

    console.log(`✅ Found ${items.length} namespaces`);
    
    const namespaces = items.map((ns) => ({
      name: ns.metadata?.name || 'unknown',
      status: ns.status?.phase || 'Unknown',
      creationTimestamp: ns.metadata?.creationTimestamp || '',
      labels: ns.metadata?.labels || {}
    }));

    res.json({
      success: true,
      namespaces
    });
  } catch (error) {
    console.error('❌ Error fetching namespaces:', error.message);
    console.error('Error details:', {
      code: error.code,
      statusCode: error.statusCode,
      response: error.response?.body
    });
    
    let errorMessage = error.message || 'Error fetching namespaces from Kubernetes';
    
    // Provide more specific error messages
    if (error.code === 'ENOTFOUND') {
      errorMessage = 'DNS resolution failed - cannot reach Kubernetes API server';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused - Kubernetes API server may be down or unreachable';
    } else if (error.statusCode === 401) {
      errorMessage = 'Authentication failed - check your kubeconfig credentials';
    } else if (error.statusCode === 403) {
      errorMessage = 'Access forbidden - check RBAC permissions';
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch namespaces',
      message: errorMessage,
      details: error.response?.body || error.code
    });
  }
});

app.get('/api/k8s/pods', async (req, res) => {
  try {
    if (!k8sApi) {
      return res.status(400).json({
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const namespace = req.query.namespace || 'default';
    console.log('📦 Pods endpoint - Requested namespace:', namespace, 'Query:', req.query);
    
    if (!namespace || namespace.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Invalid namespace',
        message: 'Namespace parameter is required and cannot be empty'
      });
    }
    
    let pods = [];
    
    if (namespace === 'all' || namespace === '*') {
      // Fetch pods from all namespaces
      const response = await k8sApi.listPodForAllNamespaces();
      console.log('📦 All namespaces pods response:', {
        hasResponse: !!response,
        hasBody: !!response?.body,
        hasItems: !!response?.body?.items,
        responseType: typeof response,
        responseKeys: response ? Object.keys(response) : []
      });
      
      // Handle both response.body.items and direct response.items
      const items = response?.body?.items || response?.items || [];
      
      if (!response) {
        console.error('❌ Invalid response from listPodForAllNamespaces');
        return res.status(500).json({
          success: false,
          error: 'Invalid response',
          message: 'Received invalid response from Kubernetes API'
        });
      }
      
      pods = (items || []).map((pod) => {
        const containers = pod.spec.containers || [];
        const initContainers = pod.spec.initContainers || [];
        return {
          name: pod.metadata.name,
          namespace: pod.metadata.namespace,
          status: pod.status.phase,
          nodeName: pod.spec.nodeName,
          hostIP: pod.status.hostIP,
          podIP: pod.status.podIP,
          restartCount: pod.status.containerStatuses?.[0]?.restartCount || 0,
          ready: pod.status.containerStatuses?.every((cs) => cs.ready) || false,
          containers: containers.map((container) => ({
            name: container.name,
            image: container.image,
            imagePullPolicy: container.imagePullPolicy,
            ready: pod.status.containerStatuses?.find((cs) => cs.name === container.name)?.ready || false,
            restartCount: pod.status.containerStatuses?.find((cs) => cs.name === container.name)?.restartCount || 0
          })),
          initContainers: initContainers.map((container) => ({
            name: container.name,
            image: container.image
          })),
          labels: pod.metadata.labels || {},
          creationTimestamp: pod.metadata.creationTimestamp,
          startTime: pod.status.startTime
        };
      });
    } else {
      // Fetch pods from specific namespace
      const namespaceParam = namespace.trim();
      console.log('📦 Fetching pods from namespace:', namespaceParam, 'Type:', typeof namespaceParam, 'Length:', namespaceParam.length);
      
      if (!namespaceParam || namespaceParam.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid namespace',
          message: 'Namespace parameter cannot be empty'
        });
      }
      
      console.log('📦 Calling listNamespacedPod with namespace:', namespaceParam);
      console.log('📦 k8sApi check:', {
        isNull: k8sApi === null,
        isUndefined: k8sApi === undefined,
        hasMethod: typeof k8sApi?.listNamespacedPod === 'function'
      });
      
      if (!k8sApi || typeof k8sApi.listNamespacedPod !== 'function') {
        throw new Error('k8sApi is not properly initialized');
      }
      
      let response;
      try {
        // Ensure namespace is a string and not empty
        const ns = String(namespaceParam).trim();
        if (!ns || ns.length === 0) {
          throw new Error('Namespace cannot be empty');
        }
        
        console.log('📦 Calling with namespace string:', ns, 'type:', typeof ns, 'length:', ns.length);
        
        // The library bug: parameter validation fails even with valid strings
        // Use direct HTTP call as workaround
        try {
          response = await k8sApi.listNamespacedPod(ns);
          console.log('📦 listNamespacedPod response received:', !!response, 'hasBody:', !!response?.body);
        } catch (libraryError) {
          console.log('⚠️ Library method failed, using direct HTTP call...');
          response = await makeK8sDirectHttpCall(`/api/v1/namespaces/{namespace}/pods`, ns);
        }
      } catch (apiError) {
        console.error('❌ Error fetching pods:', apiError.message);
        throw new Error(`Failed to fetch pods from namespace "${namespaceParam}": ${apiError.message}`);
      }
      
      // Handle both response.body.items and direct response.items
      const items = response?.body?.items || response?.items || [];
      
      if (!response) {
        console.error('❌ Invalid response from listNamespacedPod');
        return res.status(500).json({
          success: false,
          error: 'Invalid response',
          message: 'Received invalid response from Kubernetes API'
        });
      }
      
      pods = (items || []).map((pod) => {
        const containers = pod.spec.containers || [];
        const initContainers = pod.spec.initContainers || [];
        return {
          name: pod.metadata.name,
          namespace: pod.metadata.namespace,
          status: pod.status.phase,
          nodeName: pod.spec.nodeName,
          hostIP: pod.status.hostIP,
          podIP: pod.status.podIP,
          restartCount: pod.status.containerStatuses?.[0]?.restartCount || 0,
          ready: pod.status.containerStatuses?.every(cs => cs.ready) || false,
          containers: containers.map((container) => ({
            name: container.name,
            image: container.image,
            imagePullPolicy: container.imagePullPolicy || 'IfNotPresent',
            ready: pod.status.containerStatuses?.find(cs => cs.name === container.name)?.ready || false,
            restartCount: pod.status.containerStatuses?.find(cs => cs.name === container.name)?.restartCount || 0
          })),
          initContainers: initContainers.map((container) => ({
            name: container.name,
            image: container.image
          })),
          labels: pod.metadata.labels || {},
          creationTimestamp: pod.metadata.creationTimestamp,
          startTime: pod.status.startTime
        };
      });
    }

    console.log(`📊 Returning ${pods.length} pods for namespace: ${namespace}`);
    if (namespace !== 'all' && namespace !== '*') {
      // Verify all pods are in the correct namespace
      const wrongNamespacePods = pods.filter(p => p.namespace !== namespace);
      if (wrongNamespacePods.length > 0) {
        console.warn(`⚠️ Found ${wrongNamespacePods.length} pods in wrong namespace. Expected: ${namespace}, Found:`, 
          wrongNamespacePods.map(p => `${p.name} (${p.namespace})`));
      }
    }
    
    res.json({
      success: true,
      pods,
      namespace,
      count: pods.length
    });
  } catch (error) {
    console.error('❌ Error fetching pods:', error);
    console.error('❌ Error details:', {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      response: error.response?.body || error.response
    });
    res.status(500).json({
      error: 'Failed to fetch pods',
      message: error.message || 'Error fetching pods from Kubernetes',
      details: error.response?.body || error.code
    });
  }
});

// Scale Deployment
app.patch('/api/k8s/deployments/:namespace/:name/scale', async (req, res) => {
  try {
    if (!k8sAppsApi) {
      return res.status(400).json({ 
        success: false,
        error: 'Not connected', 
        message: 'Please connect to a Kubernetes cluster first' 
      });
    }

    const { namespace, name } = req.params;
    const { replicas } = req.body;
    
    if (!namespace || !name) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid parameters', 
        message: 'Namespace and name are required' 
      });
    }

    if (replicas === undefined || replicas === null || isNaN(parseInt(replicas))) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid replicas', 
        message: 'Replicas must be a valid number' 
      });
    }

    const replicaCount = parseInt(replicas);
    if (replicaCount < 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid replicas', 
        message: 'Replicas must be 0 or greater' 
      });
    }

    try {
      // Get current deployment
      let deployment;
      try {
        const response = await k8sAppsApi.readNamespacedDeployment(name, namespace);
        deployment = response.body;
      } catch (libraryError) {
        const response = await makeK8sDirectHttpCall(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`, null);
        deployment = response.body;
      }

      // Update replicas
      deployment.spec.replicas = replicaCount;

      // Apply the update
      try {
        await k8sAppsApi.replaceNamespacedDeployment(name, namespace, deployment);
      } catch (libraryError) {
        // Use direct HTTP call as fallback
        const https = await import('https');
        const cluster = currentKubeConfig.getCurrentCluster();
        const opts = {};
        currentKubeConfig.applyToHTTPSOptions(opts);
        
        let httpsAgent = null;
        if (opts.ca || opts.cert || opts.key) {
          httpsAgent = new https.Agent({
            ca: opts.ca,
            cert: opts.cert,
            key: opts.key,
            rejectUnauthorized: opts.rejectUnauthorized !== false
          });
        }

        const headers = { 'Content-Type': 'application/json' };
        if (opts.headers) Object.assign(headers, opts.headers);
        if (opts.auth) headers['Authorization'] = opts.auth;

        await axios({
          method: 'PUT',
          url: `${cluster.server}/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`,
          headers,
          httpsAgent,
          data: deployment,
          validateStatus: () => true
        });
      }

      res.json({ 
        success: true, 
        message: `Deployment ${name} scaled to ${replicaCount} replicas`,
        replicas: replicaCount
      });
    } catch (error) {
      console.error('❌ Error scaling deployment:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to scale deployment', 
        message: error.message || 'Error scaling deployment' 
      });
    }
  } catch (error) {
    console.error('❌ Error in scale endpoint:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to scale deployment', 
      message: error.message || 'Unknown error' 
    });
  }
});

// Restart Deployment
app.post('/api/k8s/deployments/:namespace/:name/restart', async (req, res) => {
  try {
    if (!k8sAppsApi) {
      return res.status(400).json({ 
        success: false,
        error: 'Not connected', 
        message: 'Please connect to a Kubernetes cluster first' 
      });
    }

    const { namespace, name } = req.params;
    
    if (!namespace || !name) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid parameters', 
        message: 'Namespace and name are required' 
      });
    }

    try {
      // Get current deployment
      let deployment;
      try {
        const response = await k8sAppsApi.readNamespacedDeployment(name, namespace);
        deployment = response.body;
      } catch (libraryError) {
        const response = await makeK8sDirectHttpCall(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`, null);
        deployment = response.body;
      }

      // Add restart annotation to trigger rollout restart
      if (!deployment.spec.template.metadata) {
        deployment.spec.template.metadata = {};
      }
      if (!deployment.spec.template.metadata.annotations) {
        deployment.spec.template.metadata.annotations = {};
      }
      deployment.spec.template.metadata.annotations['kubectl.kubernetes.io/restartedAt'] = new Date().toISOString();

      // Apply the update
      try {
        await k8sAppsApi.replaceNamespacedDeployment(name, namespace, deployment);
      } catch (libraryError) {
        // Use direct HTTP call as fallback
        const https = await import('https');
        const cluster = currentKubeConfig.getCurrentCluster();
        const opts = {};
        currentKubeConfig.applyToHTTPSOptions(opts);
        
        let httpsAgent = null;
        if (opts.ca || opts.cert || opts.key) {
          httpsAgent = new https.Agent({
            ca: opts.ca,
            cert: opts.cert,
            key: opts.key,
            rejectUnauthorized: opts.rejectUnauthorized !== false
          });
        }

        const headers = { 'Content-Type': 'application/json' };
        if (opts.headers) Object.assign(headers, opts.headers);
        if (opts.auth) headers['Authorization'] = opts.auth;

        await axios({
          method: 'PUT',
          url: `${cluster.server}/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`,
          headers,
          httpsAgent,
          data: deployment,
          validateStatus: () => true
        });
      }

      res.json({ 
        success: true, 
        message: `Deployment ${name} restart initiated`
      });
    } catch (error) {
      console.error('❌ Error restarting deployment:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to restart deployment', 
        message: error.message || 'Error restarting deployment' 
      });
    }
  } catch (error) {
    console.error('❌ Error in restart endpoint:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to restart deployment', 
      message: error.message || 'Unknown error' 
    });
  }
});

// Delete Resource
app.delete('/api/k8s/:resourceType/:namespace/:name', async (req, res) => {
  try {
    const { resourceType, namespace, name } = req.params;
    
    if (!resourceType || !namespace || !name) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid parameters', 
        message: 'Resource type, namespace, and name are required' 
      });
    }

    // Map resource types to API clients
    const resourceTypeMap = {
      'deployments': { api: k8sAppsApi, method: 'deleteNamespacedDeployment', path: `/apis/apps/v1/namespaces/{namespace}/deployments/{name}` },
      'pods': { api: k8sApi, method: 'deleteNamespacedPod', path: `/api/v1/namespaces/{namespace}/pods/{name}` },
      'services': { api: k8sApi, method: 'deleteNamespacedService', path: `/api/v1/namespaces/{namespace}/services/{name}` },
      'configmaps': { api: k8sApi, method: 'deleteNamespacedConfigMap', path: `/api/v1/namespaces/{namespace}/configmaps/{name}` },
      'cronjobs': { api: k8sBatchApi, method: 'deleteNamespacedCronJob', path: `/apis/batch/v1/namespaces/{namespace}/cronjobs/{name}` },
      'jobs': { api: k8sBatchApi, method: 'deleteNamespacedJob', path: `/apis/batch/v1/namespaces/{namespace}/jobs/{name}` }
    };

    const resourceConfig = resourceTypeMap[resourceType];
    if (!resourceConfig) {
      return res.status(400).json({ 
        success: false,
        error: 'Unsupported resource type', 
        message: `Resource type ${resourceType} is not supported for deletion` 
      });
    }

    if (!resourceConfig.api) {
      return res.status(400).json({ 
        success: false,
        error: 'Not connected', 
        message: 'Please connect to a Kubernetes cluster first' 
      });
    }

    try {
      // Try library method first
      if (resourceConfig.api[resourceConfig.method]) {
        await resourceConfig.api[resourceConfig.method](name, namespace);
      } else {
        throw new Error('Library method not available');
      }
    } catch (libraryError) {
      // Use direct HTTP call as fallback
      const https = await import('https');
      const cluster = currentKubeConfig.getCurrentCluster();
      const opts = {};
      currentKubeConfig.applyToHTTPSOptions(opts);
      
      let httpsAgent = null;
      if (opts.ca || opts.cert || opts.key) {
        httpsAgent = new https.Agent({
          ca: opts.ca,
          cert: opts.cert,
          key: opts.key,
          rejectUnauthorized: opts.rejectUnauthorized !== false
        });
      }

      const headers = {};
      if (opts.headers) Object.assign(headers, opts.headers);
      if (opts.auth) headers['Authorization'] = opts.auth;

      const path = resourceConfig.path
        .replace('{namespace}', encodeURIComponent(namespace))
        .replace('{name}', encodeURIComponent(name));

      const response = await axios({
        method: 'DELETE',
        url: `${cluster.server}${path}`,
        headers,
        httpsAgent,
        validateStatus: () => true
      });

      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }

    res.json({ 
      success: true, 
      message: `${resourceType} ${name} deleted successfully`
    });
  } catch (error) {
    console.error(`❌ Error deleting ${req.params.resourceType}:`, error);
    res.status(500).json({ 
      success: false,
      error: `Failed to delete ${req.params.resourceType}`, 
      message: error.message || `Error deleting ${req.params.resourceType}` 
    });
  }
});

// ConfigMaps endpoint
app.get('/api/k8s/configmaps', async (req, res) => {
  try {
    if (!k8sApi) {
      return res.status(400).json({
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const namespace = req.query.namespace || 'default';
    console.log('📦 ConfigMaps endpoint - Requested namespace:', namespace);
    
    if (!namespace || namespace.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Invalid namespace',
        message: 'Namespace parameter is required and cannot be empty'
      });
    }

    let configmaps = [];
    
    if (namespace === 'all' || namespace === '*') {
      const response = await k8sApi.listConfigMapForAllNamespaces();
      const items = response?.body?.items || response?.items || [];
      configmaps = items.map((cm) => ({
        name: cm.metadata.name,
        namespace: cm.metadata.namespace,
        data: cm.data || {},
        labels: cm.metadata.labels || {},
        creationTimestamp: cm.metadata.creationTimestamp
      }));
    } else {
      const namespaceParam = namespace.trim();
      console.log('📦 Calling listNamespacedConfigMap with namespace:', namespaceParam);
      // The library bug: parameter validation fails even with valid strings
      // Use direct HTTP call as workaround
      let response;
      try {
        response = await k8sApi.listNamespacedConfigMap(namespaceParam);
      } catch (libraryError) {
        console.log('⚠️ Library method failed, using direct HTTP call...');
        response = await makeK8sDirectHttpCall(`/api/v1/namespaces/{namespace}/configmaps`, namespaceParam);
      }
      const items = response?.body?.items || response?.items || [];
      configmaps = items.map((cm) => ({
        name: cm.metadata.name,
        namespace: cm.metadata.namespace,
        data: cm.data || {},
        labels: cm.metadata.labels || {},
        creationTimestamp: cm.metadata.creationTimestamp
      }));
    }

    res.json({
      success: true,
      configmaps,
      namespace
    });
  } catch (error) {
    console.error('❌ Error fetching configmaps:', error);
    res.status(500).json({
      error: 'Failed to fetch configmaps',
      message: error.message || 'Error fetching configmaps from Kubernetes'
    });
  }
});

// Events endpoint
app.get('/api/k8s/events', async (req, res) => {
  try {
    if (!k8sApi) {
      return res.status(400).json({
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const namespace = req.query.namespace || 'default';
    console.log('📦 Events endpoint - Requested namespace:', namespace);
    
    if (!namespace || namespace.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Invalid namespace',
        message: 'Namespace parameter is required and cannot be empty'
      });
    }

    let events = [];
    
    if (namespace === 'all' || namespace === '*') {
      const response = await k8sApi.listEventForAllNamespaces();
      const items = response?.body?.items || response?.items || [];
      events = items.map((event) => ({
        name: event.metadata.name,
        namespace: event.metadata.namespace,
        reason: event.reason,
        message: event.message,
        type: event.type,
        involvedObject: {
          kind: event.involvedObject.kind,
          name: event.involvedObject.name
        },
        firstTimestamp: event.firstTimestamp,
        lastTimestamp: event.lastTimestamp,
        count: event.count
      }));
    } else {
      const namespaceParam = namespace.trim();
      console.log('📦 Calling listNamespacedEvent with namespace:', namespaceParam);
      // The library bug: parameter validation fails even with valid strings
      // Use direct HTTP call as workaround
      let response;
      try {
        response = await k8sApi.listNamespacedEvent(namespaceParam);
      } catch (libraryError) {
        console.log('⚠️ Library method failed, using direct HTTP call...');
        response = await makeK8sDirectHttpCall(`/api/v1/namespaces/{namespace}/events`, namespaceParam);
      }
      const items = response?.body?.items || response?.items || [];
      events = items.map((event) => ({
        name: event.metadata.name,
        namespace: event.metadata.namespace,
        reason: event.reason,
        message: event.message,
        type: event.type,
        involvedObject: {
          kind: event.involvedObject.kind,
          name: event.involvedObject.name
        },
        firstTimestamp: event.firstTimestamp,
        lastTimestamp: event.lastTimestamp,
        count: event.count
      }));
    }

    res.json({
      success: true,
      events,
      namespace
    });
  } catch (error) {
    console.error('❌ Error fetching events:', error);
    res.status(500).json({
      error: 'Failed to fetch events',
      message: error.message || 'Error fetching events from Kubernetes'
    });
  }
});

// Find application by URL - finds Ingress, Service, and Deployment
app.get('/api/k8s/find-by-url', async (req, res) => {
  try {
    if (!k8sApi || !k8sNetworkingApi || !k8sAppsApi) {
      return res.status(400).json({
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const url = req.query.url;
    const preferredNamespace = req.query.namespace; // Optional namespace filter
    
    if (!url) {
      return res.status(400).json({
        error: 'URL required',
        message: 'Please provide a URL parameter'
      });
    }

    // Parse URL to get hostname
    let hostname;
    try {
      const urlObj = new URL(url);
      hostname = urlObj.hostname;
    } catch {
      hostname = url; // If URL parsing fails, use as-is
    }

    console.log(`🔍 Finding application for URL: ${url} (hostname: ${hostname})${preferredNamespace ? ` in namespace: ${preferredNamespace}` : ''}`);

    // Get ingresses - filter by namespace if provided
    let ingresses = [];
    try {
      if (preferredNamespace && preferredNamespace !== 'all') {
        // Search in specific namespace first
        console.log(`📋 Searching ingresses in namespace: ${preferredNamespace}`);
        const response = await k8sNetworkingApi.listNamespacedIngress(preferredNamespace);
        ingresses = response?.body?.items || response?.items || [];
        console.log(`📋 Found ${ingresses.length} ingresses in namespace ${preferredNamespace}`);
        
        // If not found in preferred namespace, also search all namespaces
        if (ingresses.length === 0) {
          console.log(`⚠️ No ingresses found in ${preferredNamespace}, searching all namespaces...`);
          const allResponse = await k8sNetworkingApi.listIngressForAllNamespaces();
          ingresses = allResponse?.body?.items || allResponse?.items || [];
          console.log(`📋 Found ${ingresses.length} total ingresses across all namespaces`);
        }
      } else {
        // Search all namespaces
        const response = await k8sNetworkingApi.listIngressForAllNamespaces();
        ingresses = response?.body?.items || response?.items || [];
        console.log(`📋 Found ${ingresses.length} total ingresses in cluster`);
      }
    } catch (error) {
      console.error('Error fetching ingresses:', error);
      // Try alternative API version
      try {
        const path = preferredNamespace && preferredNamespace !== 'all'
          ? `/apis/networking.k8s.io/v1/namespaces/${preferredNamespace}/ingresses`
          : '/apis/networking.k8s.io/v1/ingresses';
        const response = await makeK8sDirectHttpCall(path, preferredNamespace && preferredNamespace !== 'all' ? preferredNamespace : null);
        ingresses = response?.body?.items || response?.items || [];
      } catch (err) {
        console.error('Failed to fetch ingresses:', err);
      }
    }

    // Helper function to check if hostname matches rule host
    const hostnameMatches = (ruleHost, targetHostname) => {
      if (!ruleHost || !targetHostname) return false;
      
      // Normalize to lowercase for comparison
      const ruleHostLower = ruleHost.toLowerCase();
      const targetHostnameLower = targetHostname.toLowerCase();
      
      // Exact match
      if (ruleHostLower === targetHostnameLower) return true;
      
      // Wildcard match (e.g., *.airteldev.com matches n1devcmp-user.airteldev.com)
      if (ruleHostLower.startsWith('*.')) {
        const domain = ruleHostLower.substring(2); // Remove '*.' prefix
        if (targetHostnameLower.endsWith('.' + domain) || targetHostnameLower === domain) {
          return true;
        }
      }
      
      // Partial match - check if target hostname contains rule host or vice versa
      if (targetHostnameLower.includes(ruleHostLower) || ruleHostLower.includes(targetHostnameLower)) {
        return true;
      }
      
      // Domain match - check if they share the same domain
      const targetDomain = targetHostnameLower.split('.').slice(-2).join('.');
      const ruleDomain = ruleHostLower.replace(/^\*\./, '').split('.').slice(-2).join('.');
      if (targetDomain === ruleDomain && targetDomain.length > 0) {
        return true;
      }
      
      return false;
    };

    // Find ingress matching the hostname - prioritize preferred namespace
    let matchingIngress = null;
    const allHosts = [];
    
    // First pass: search in preferred namespace if specified
    if (preferredNamespace && preferredNamespace !== 'all') {
      for (const ingress of ingresses) {
        if (ingress.metadata.namespace !== preferredNamespace) continue;
        
        const rules = ingress.spec?.rules || [];
        for (const rule of rules) {
          if (rule.host) {
            allHosts.push({
              host: rule.host,
              ingress: ingress.metadata.name,
              namespace: ingress.metadata.namespace
            });
            
            if (hostnameMatches(rule.host, hostname)) {
              matchingIngress = ingress;
              console.log(`✅ Matched ingress in preferred namespace: ${ingress.metadata.name} in ${ingress.metadata.namespace} (host: ${rule.host})`);
              break;
            }
          }
        }
        if (matchingIngress) break;
      }
    }
    
    // Second pass: search all ingresses if not found in preferred namespace
    if (!matchingIngress) {
      for (const ingress of ingresses) {
        // Skip if we already checked this namespace in first pass
        if (preferredNamespace && preferredNamespace !== 'all' && ingress.metadata.namespace === preferredNamespace) {
          continue;
        }
        
        const rules = ingress.spec?.rules || [];
        for (const rule of rules) {
          if (rule.host) {
            allHosts.push({
              host: rule.host,
              ingress: ingress.metadata.name,
              namespace: ingress.metadata.namespace
            });
            
            if (hostnameMatches(rule.host, hostname)) {
              matchingIngress = ingress;
              console.log(`✅ Matched ingress: ${ingress.metadata.name} in ${ingress.metadata.namespace} (host: ${rule.host})${preferredNamespace ? ` (not in preferred namespace ${preferredNamespace})` : ''}`);
              break;
            }
          }
        }
        if (matchingIngress) break;
      }
    }

    if (!matchingIngress) {
      // Return helpful error with all found hosts for debugging
      console.log(`❌ No matching ingress found. Available hosts:`, allHosts.slice(0, 20));
      return res.status(404).json({
        error: 'Not found',
        message: `No ingress found matching hostname: ${hostname}`,
        url,
        hostname,
        totalIngresses: ingresses.length,
        availableHosts: allHosts.slice(0, 50).map(h => ({
          host: h.host,
          ingress: h.ingress,
          namespace: h.namespace
        })),
        suggestion: 'Check if the ingress exists in the cluster and if the hostname matches exactly (including subdomain)'
      });
    }

    const ingressNamespace = matchingIngress.metadata.namespace;
    const ingressName = matchingIngress.metadata.name;
    
    // Extract service name from ingress - handle both old and new backend formats
    let serviceName = null;
    const firstRule = matchingIngress.spec?.rules?.[0];
    if (firstRule?.http?.paths?.[0]?.backend) {
      const backend = firstRule.http.paths[0].backend;
      // New format (Kubernetes 1.19+)
      if (backend.service) {
        serviceName = backend.service.name;
      }
      // Old format (deprecated but still used)
      else if (backend.serviceName) {
        serviceName = backend.serviceName;
      }
    }

    console.log(`✅ Found ingress: ${ingressName} in namespace ${ingressNamespace}, service: ${serviceName || 'none'}`);

    // Find service
    let matchingService = null;
    if (serviceName) {
      try {
        const serviceResponse = await k8sApi.readNamespacedService(serviceName, ingressNamespace);
        matchingService = serviceResponse?.body || serviceResponse;
      } catch (error) {
        console.error('Error fetching service:', error);
        // Try direct HTTP call
        try {
          const response = await makeK8sDirectHttpCall(`/api/v1/namespaces/${ingressNamespace}/services/${serviceName}`, null);
          matchingService = response?.body || response;
        } catch (err) {
          console.error('Failed to fetch service:', err);
        }
      }
    } else {
      console.warn(`⚠️ No service found in ingress ${ingressName} - ingress may use resource backend or serviceName not found`);
    }

    // Find deployments matching service selector
    let matchingDeployments = [];
    let allDeploymentsInNamespace = [];
    let serviceSelector = null;
    
    if (matchingService && matchingService.spec?.selector) {
      serviceSelector = matchingService.spec.selector;
      try {
        const deploymentsResponse = await k8sAppsApi.listNamespacedDeployment(ingressNamespace);
        allDeploymentsInNamespace = deploymentsResponse?.body?.items || deploymentsResponse?.items || [];
        
        console.log(`📦 Found ${allDeploymentsInNamespace.length} deployments in namespace ${ingressNamespace}`);
        console.log(`🔍 Service selector:`, serviceSelector);
        
        // Find matching deployments
        matchingDeployments = allDeploymentsInNamespace.filter(deployment => {
          const labels = deployment.metadata.labels || {};
          const matches = Object.keys(serviceSelector).every(key => labels[key] === serviceSelector[key]);
          
          if (!matches) {
            console.log(`❌ Deployment ${deployment.metadata.name} doesn't match:`, {
              deploymentLabels: labels,
              requiredSelector: serviceSelector,
              missingKeys: Object.keys(serviceSelector).filter(key => labels[key] !== serviceSelector[key])
            });
          }
          
          return matches;
        }).map(deployment => ({
          name: deployment.metadata.name,
          namespace: deployment.metadata.namespace
        }));
        
        console.log(`✅ Found ${matchingDeployments.length} matching deployments`);
        
        // If no matches, provide debugging info
        if (matchingDeployments.length === 0 && allDeploymentsInNamespace.length > 0) {
          console.warn(`⚠️ No deployments match service selector. Available deployments:`, 
            allDeploymentsInNamespace.map(d => ({
              name: d.metadata.name,
              labels: d.metadata.labels || {}
            }))
          );
        }
      } catch (error) {
        console.error('Error fetching deployments:', error);
      }
    } else if (matchingService) {
      console.warn(`⚠️ Service ${matchingService.metadata.name} has no selector defined`);
    }

    // Check for Keycloak (common auth service) - search by hostname pattern
    let keycloakIngress = null;
    let keycloakService = null;
    let keycloakDeployment = null;
    
    try {
      // Search for Keycloak ingress - look for auth-related hostnames
      const authHostnamePatterns = ['auth', 'keycloak', 'sso', 'login'];
      const targetHostnameLower = hostname.toLowerCase();
      
      // Check if the current hostname itself is an auth service
      const isAuthHostname = authHostnamePatterns.some(pattern => targetHostnameLower.includes(pattern));
      
      if (isAuthHostname) {
        // The current ingress might be the auth service
        keycloakIngress = {
          name: ingressName,
          namespace: ingressNamespace,
          host: matchingIngress.spec?.rules?.[0]?.host || hostname
        };
        console.log(`🔐 Current URL appears to be an auth service: ${hostname}`);
      } else {
        // Search for separate Keycloak ingress - prioritize preferred namespace
      // First search in preferred namespace if specified
      if (preferredNamespace && preferredNamespace !== 'all') {
        for (const ingress of ingresses) {
          if (ingress.metadata.namespace !== preferredNamespace) continue;
          
          const rules = ingress.spec?.rules || [];
          for (const rule of rules) {
            const ruleHostLower = (rule.host || '').toLowerCase();
            if (authHostnamePatterns.some(pattern => ruleHostLower.includes(pattern)) ||
                ruleHostLower.includes('airteldev.com') && ruleHostLower.includes('auth')) {
              keycloakIngress = {
                name: ingress.metadata.name,
                namespace: ingress.metadata.namespace,
                host: rule.host
              };
              console.log(`🔐 Found Keycloak ingress in preferred namespace: ${ingress.metadata.name} in ${ingress.metadata.namespace} (host: ${rule.host})`);
              break;
            }
          }
          if (keycloakIngress) break;
        }
      }
      
      // If not found in preferred namespace, search all namespaces
      if (!keycloakIngress) {
        for (const ingress of ingresses) {
          // Skip if we already checked this namespace
          if (preferredNamespace && preferredNamespace !== 'all' && ingress.metadata.namespace === preferredNamespace) {
            continue;
          }
          
          const rules = ingress.spec?.rules || [];
          for (const rule of rules) {
            const ruleHostLower = (rule.host || '').toLowerCase();
            if (authHostnamePatterns.some(pattern => ruleHostLower.includes(pattern)) ||
                ruleHostLower.includes('airteldev.com') && ruleHostLower.includes('auth')) {
              keycloakIngress = {
                name: ingress.metadata.name,
                namespace: ingress.metadata.namespace,
                host: rule.host
              };
              console.log(`🔐 Found Keycloak ingress: ${ingress.metadata.name} in ${ingress.metadata.namespace} (host: ${rule.host})${preferredNamespace ? ` (not in preferred namespace ${preferredNamespace})` : ''}`);
              break;
            }
          }
          if (keycloakIngress) break;
        }
      }
      }
      
      // If Keycloak ingress found, try to find its service and deployment
      if (keycloakIngress) {
        try {
          // Get the Keycloak ingress details
          const keycloakIngressResponse = await k8sNetworkingApi.readNamespacedIngress(
            keycloakIngress.name,
            keycloakIngress.namespace
          );
          const keycloakIngressObj = keycloakIngressResponse?.body || keycloakIngressResponse;
          
          // Extract service name from Keycloak ingress
          const keycloakFirstRule = keycloakIngressObj.spec?.rules?.[0];
          let keycloakServiceName = null;
          if (keycloakFirstRule?.http?.paths?.[0]?.backend) {
            const backend = keycloakFirstRule.http.paths[0].backend;
            keycloakServiceName = backend.service?.name || backend.serviceName;
          }
          
          if (keycloakServiceName) {
            try {
              const keycloakServiceResponse = await k8sApi.readNamespacedService(
                keycloakServiceName,
                keycloakIngress.namespace
              );
              const keycloakServiceObj = keycloakServiceResponse?.body || keycloakServiceResponse;
              
              keycloakService = {
                name: keycloakServiceName,
                namespace: keycloakIngress.namespace,
                clusterIP: keycloakServiceObj.spec?.clusterIP,
                ports: keycloakServiceObj.spec?.ports || []
              };
              
              // Try to find Keycloak deployment and check pod status
              if (keycloakServiceObj.spec?.selector) {
                const keycloakDeploymentsResponse = await k8sAppsApi.listNamespacedDeployment(keycloakIngress.namespace);
                const allKeycloakDeployments = keycloakDeploymentsResponse?.body?.items || keycloakDeploymentsResponse?.items || [];
                
                const keycloakSelector = keycloakServiceObj.spec.selector;
                const matchingKeycloakDeployments = allKeycloakDeployments.filter(deployment => {
                  const labels = deployment.metadata.labels || {};
                  return Object.keys(keycloakSelector).every(key => labels[key] === keycloakSelector[key]);
                });
                
                if (matchingKeycloakDeployments.length > 0) {
                  const keycloakDeploymentObj = matchingKeycloakDeployments[0];
                  keycloakDeployment = {
                    name: keycloakDeploymentObj.metadata.name,
                    namespace: keycloakIngress.namespace,
                    replicas: keycloakDeploymentObj.spec?.replicas || 0,
                    readyReplicas: keycloakDeploymentObj.status?.readyReplicas || 0,
                    availableReplicas: keycloakDeploymentObj.status?.availableReplicas || 0
                  };
                  
                  // Check pod status
                  try {
                    const keycloakPodsResponse = await k8sApi.listNamespacedPod(keycloakIngress.namespace);
                    const allKeycloakPods = keycloakPodsResponse?.body?.items || keycloakPodsResponse?.items || [];
                    const keycloakPods = allKeycloakPods.filter(pod => {
                      const labels = pod.metadata.labels || {};
                      return Object.keys(keycloakSelector).every(key => labels[key] === keycloakSelector[key]);
                    });
                    
                    keycloakDeployment.pods = keycloakPods.map(pod => ({
                      name: pod.metadata.name,
                      status: pod.status?.phase || 'Unknown',
                      ready: pod.status?.containerStatuses?.[0]?.ready || false,
                      restartCount: pod.status?.containerStatuses?.[0]?.restartCount || 0
                    }));
                  } catch (podErr) {
                    console.warn('Could not fetch Keycloak pods:', podErr.message);
                  }
                }
              }
            } catch (err) {
              console.warn('Could not fetch Keycloak service details:', err.message);
            }
          }
        } catch (err) {
          console.warn('Could not fetch Keycloak ingress details:', err.message);
        }
      }
    } catch (error) {
      console.error('Error finding Keycloak:', error);
    }

    // Prepare response with debugging info if no deployments found
    const responseData = {
      success: true,
      url,
      hostname,
      ingress: {
        name: ingressName,
        namespace: ingressNamespace
      },
      service: matchingService ? {
        name: matchingService.metadata.name,
        namespace: matchingService.metadata.namespace,
        selector: matchingService.spec?.selector || {}
      } : null,
      deployments: matchingDeployments,
      keycloak: keycloakIngress ? {
        ingress: keycloakIngress,
        service: keycloakService,
        deployment: keycloakDeployment,
        url: keycloakIngress.host ? (keycloakIngress.host.startsWith('http') ? keycloakIngress.host : `https://${keycloakIngress.host}`) : null
      } : null,
      authenticationFlow: !!keycloakIngress,
      debug: {
        matchedHost: matchingIngress.spec?.rules?.[0]?.host,
        serviceName: serviceName,
        totalIngressesChecked: ingresses.length,
        preferredNamespace: preferredNamespace || null,
        matchedNamespace: ingressNamespace,
        namespaceMatch: preferredNamespace && preferredNamespace !== 'all' ? (ingressNamespace === preferredNamespace) : null
      }
    };

    // Add debugging info if no deployments matched
    if (matchingDeployments.length === 0 && matchingService && serviceSelector) {
      responseData.debug = {
        ...responseData.debug,
        serviceSelector: serviceSelector,
        totalDeploymentsInNamespace: allDeploymentsInNamespace.length,
        availableDeployments: allDeploymentsInNamespace.map((d) => ({
          name: d.metadata.name,
          labels: d.metadata.labels || {},
          selectorMatch: Object.keys(serviceSelector).map(key => ({
            key,
            required: serviceSelector[key],
            actual: d.metadata.labels?.[key] || 'missing',
            matches: d.metadata.labels?.[key] === serviceSelector[key]
          }))
        })),
        suggestion: 'Check if deployment labels match the service selector. The service selector requires all keys to match exactly.'
      };
    }

    res.json(responseData);
  } catch (error) {
    console.error('❌ Error finding application by URL:', error);
    res.status(500).json({
      error: 'Failed to find application',
      message: error.message || 'Error searching Kubernetes resources'
    });
  }
});

// List all ingresses with their hosts (for debugging)
app.get('/api/k8s/ingresses', async (req, res) => {
  try {
    if (!k8sApi || !k8sNetworkingApi) {
      return res.status(400).json({
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const namespace = req.query.namespace;
    
    let ingresses = [];
    try {
      if (namespace && namespace !== 'all') {
        const response = await k8sNetworkingApi.listNamespacedIngress(namespace);
        ingresses = response?.body?.items || response?.items || [];
      } else {
        const response = await k8sNetworkingApi.listIngressForAllNamespaces();
        ingresses = response?.body?.items || response?.items || [];
      }
    } catch (error) {
      console.error('Error fetching ingresses:', error);
      try {
        const path = namespace && namespace !== 'all' 
          ? `/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses`
          : '/apis/networking.k8s.io/v1/ingresses';
        const response = await makeK8sDirectHttpCall(path, namespace && namespace !== 'all' ? namespace : null);
        ingresses = response?.body?.items || response?.items || [];
      } catch (err) {
        console.error('Failed to fetch ingresses:', err);
      }
    }

    const ingressList = ingresses.map(ingress => {
      const hosts = [];
      const rules = ingress.spec?.rules || [];
      rules.forEach(rule => {
        if (rule.host) {
          hosts.push(rule.host);
        }
      });

      return {
        name: ingress.metadata.name,
        namespace: ingress.metadata.namespace,
        hosts: hosts,
        paths: rules.flatMap(rule => 
          (rule.http?.paths || []).map(path => ({
            path: path.path || '/',
            backend: path.backend?.service?.name || path.backend?.serviceName || 'unknown'
          }))
        ),
        creationTimestamp: ingress.metadata.creationTimestamp
      };
    });

    res.json({
      success: true,
      ingresses: ingressList,
      total: ingressList.length,
      namespace: namespace || 'all'
    });
  } catch (error) {
    console.error('❌ Error listing ingresses:', error);
    res.status(500).json({
      error: 'Failed to list ingresses',
      message: error.message || 'Error fetching ingresses from Kubernetes'
    });
  }
});

app.get('/api/k8s/resources', async (req, res) => {
  try {
    if (!k8sApi || !k8sAppsApi) {
      return res.status(400).json({
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const namespace = req.query.namespace || 'default';
    
    // Fetch all resources in parallel
    const [namespacesRes, deploymentsRes, servicesRes, podsRes] = await Promise.allSettled([
      k8sApi.listNamespace(),
      k8sAppsApi.listNamespacedDeployment(namespace),
      k8sApi.listNamespacedService(namespace),
      k8sApi.listNamespacedPod(namespace)
    ]);

    const namespaces = namespacesRes.status === 'fulfilled' 
      ? namespacesRes.value.body.items.map((ns) => ({
          name: ns.metadata.name,
          status: ns.status.phase,
          creationTimestamp: ns.metadata.creationTimestamp
        }))
      : [];

    const deployments = deploymentsRes.status === 'fulfilled'
      ? deploymentsRes.value.body.items.map((deployment) => {
          const containers = deployment.spec.template.spec.containers || [];
          return {
            name: deployment.metadata.name,
            namespace: deployment.metadata.namespace,
            replicas: deployment.spec.replicas || 0,
            readyReplicas: deployment.status.readyReplicas || 0,
            containers: containers.map((container) => ({
              name: container.name,
              image: container.image,
              imagePullPolicy: container.imagePullPolicy || 'IfNotPresent'
            })),
            labels: deployment.metadata.labels || {}
          };
        })
      : [];

    const services = servicesRes.status === 'fulfilled'
      ? servicesRes.value.body.items.map((service) => ({
          name: service.metadata.name,
          namespace: service.metadata.namespace,
          type: service.spec.type || 'ClusterIP',
          ports: (service.spec.ports || []).map((port) => ({
            port: port.port,
            targetPort: port.targetPort,
            protocol: port.protocol || 'TCP',
            name: port.name
          })),
          selector: service.spec.selector || {},
          clusterIP: service.spec.clusterIP
        }))
      : [];

    const pods = podsRes.status === 'fulfilled'
      ? podsRes.value.body.items.map((pod) => ({
          name: pod.metadata.name,
          namespace: pod.metadata.namespace,
          status: pod.status.phase,
          nodeName: pod.spec.nodeName,
          podIP: pod.status.podIP,
          containers: (pod.spec.containers || []).map((container) => ({
            name: container.name,
            image: container.image
          }))
        }))
      : [];

    res.json({
      success: true,
      namespaces,
      deployments,
      services,
      pods,
      namespace
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch resources',
      message: error.message || 'Error fetching resources from Kubernetes'
    });
  }
});

// AI-powered image update suggestions
app.post('/api/k8s/ai-suggest-images', async (req, res) => {
  try {
    if (!k8sAppsApi) {
      return res.status(400).json({
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const { namespace, pattern, strategy } = req.body;
    // pattern: 'latest', 'increment', 'semver', 'custom'
    // strategy: 'all', 'matching', 'selective'

    if (!namespace) {
      return res.status(400).json({
        error: 'Namespace required',
        message: 'Please provide a namespace'
      });
    }

    // Get all deployments
    const response = await k8sAppsApi.listNamespacedDeployment(namespace);
    const deployments = response.body.items;

    const suggestions = [];

    deployments.forEach((deployment) => {
      const containers = deployment.spec.template.spec.containers || [];
      
      containers.forEach((container) => {
        const currentImage = container.image;
        let suggestedImage = currentImage;
        let reason = '';

        // AI logic for suggesting image updates
        if (pattern === 'latest') {
          // Suggest latest tag
          if (currentImage.includes(':')) {
            const [imageName] = currentImage.split(':');
            suggestedImage = `${imageName}:latest`;
            reason = 'Update to latest tag';
          } else {
            suggestedImage = `${currentImage}:latest`;
            reason = 'Add latest tag';
          }
        } else if (pattern === 'increment') {
          // Try to increment version number
          const versionMatch = currentImage.match(/(.*?)(\d+)(.*)/);
          if (versionMatch) {
            const [, prefix, version, suffix] = versionMatch;
            const newVersion = parseInt(version) + 1;
            suggestedImage = `${prefix}${newVersion}${suffix}`;
            reason = `Increment version from ${version} to ${newVersion}`;
          } else {
            suggestedImage = `${currentImage}:v2`;
            reason = 'Add version increment';
          }
        } else if (pattern === 'semver') {
          // Semantic versioning increment (patch version)
          const semverMatch = currentImage.match(/(.*?)(\d+)\.(\d+)\.(\d+)(.*)/);
          if (semverMatch) {
            const [, prefix, major, minor, patch, suffix] = semverMatch;
            const newPatch = parseInt(patch) + 1;
            suggestedImage = `${prefix}${major}.${minor}.${newPatch}${suffix}`;
            reason = `Increment patch version to ${major}.${minor}.${newPatch}`;
          } else {
            suggestedImage = currentImage;
            reason = 'No semantic version found';
          }
        } else if (pattern === 'remove-tag') {
          // Remove tag to use default
          if (currentImage.includes(':')) {
            const [imageName] = currentImage.split(':');
            suggestedImage = imageName;
            reason = 'Remove tag to use default';
          }
        }

        if (suggestedImage !== currentImage) {
          suggestions.push({
            namespace: deployment.metadata.namespace,
            deployment: deployment.metadata.name,
            container: container.name,
            currentImage,
            suggestedImage,
            reason
          });
        }
      });
    });

    res.json({
      success: true,
      suggestions,
      count: suggestions.length,
      pattern,
      strategy
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to generate AI suggestions',
      message: error.message || 'Error generating image update suggestions'
    });
  }
});

app.post('/api/k8s/update-images', async (req, res) => {
  try {
    if (!k8sAppsApi) {
      return res.status(400).json({
        error: 'Not connected',
        message: 'Please connect to a Kubernetes cluster first'
      });
    }

    const { updates } = req.body; // Array of { namespace, deployment, container, image }

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        error: 'Invalid updates',
        message: 'Please provide an array of image updates'
      });
    }

    const results = [];
    const errors = [];

    for (const update of updates) {
      try {
        console.log('🔄 Raw update object:', JSON.stringify(update, null, 2));
        console.log('🔄 Update object keys:', Object.keys(update || {}));
        console.log('🔄 Update object values:', {
          namespace: update?.namespace,
          deployment: update?.deployment,
          container: update?.container,
          image: update?.image
        });
        
        let { namespace, deployment, container, image } = update || {};

        // Immediate validation after destructuring
        if (!update || typeof update !== 'object') {
          errors.push({
            deployment: 'unknown/unknown',
            container: 'unknown',
            error: 'Update object is invalid or missing'
          });
          continue;
        }

        console.log('🔄 Processing image update:', { 
          original: { namespace, deployment, container, image },
          types: { 
            namespace: typeof namespace, 
            deployment: typeof deployment, 
            container: typeof container, 
            image: typeof image 
          },
          isUndefined: {
            namespace: namespace === undefined,
            deployment: deployment === undefined,
            container: container === undefined,
            image: image === undefined
          }
        });

        // Trim and validate all fields
        namespace = namespace?.trim();
        deployment = deployment?.trim();
        container = container?.trim();
        image = image?.trim();

        // Ensure deployment name doesn't contain namespace prefix
        if (deployment && deployment.includes('/')) {
          const parts = deployment.split('/').filter(p => p && p.trim() !== '');
          if (parts.length > 0) {
            deployment = parts[parts.length - 1]; // Get last non-empty part
            console.log('🔧 Extracted deployment name from path:', { original: update.deployment, extracted: deployment, parts });
          } else {
            console.error('⚠️ Failed to extract deployment name from:', update.deployment);
            errors.push({
              deployment: `${namespace || 'unknown'}/${update.deployment || 'unknown'}`,
              container: container || 'unknown',
              error: `Invalid deployment name format: ${update.deployment}`
            });
            continue;
          }
        }

        console.log('✅ After processing:', { namespace, deployment, container, image });

        if (!namespace || !deployment || !container || !image || deployment.trim() === '' || namespace.trim() === '') {
          const errorMsg = `Missing or empty required fields - namespace: ${!!namespace}, deployment: ${!!deployment}, container: ${!!container}, image: ${!!image}`;
          console.error('❌ Validation failed:', errorMsg);
          errors.push({
            deployment: `${namespace || 'unknown'}/${deployment || 'unknown'}`,
            container: container || 'unknown',
            error: errorMsg
          });
          continue;
        }

        // Ensure values are strings and not null/undefined
        // Handle case where deployment or namespace might be null/undefined
        if (deployment === null || deployment === undefined || namespace === null || namespace === undefined) {
          const errorMsg = `Null or undefined values - deployment: ${deployment}, namespace: ${namespace}`;
          console.error('❌ Null/undefined values detected:', errorMsg);
          errors.push({
            deployment: `${namespace || 'unknown'}/${deployment || 'unknown'}`,
            container: container || 'unknown',
            error: errorMsg
          });
          continue;
        }
        
        const deploymentName = String(deployment).trim();
        const namespaceName = String(namespace).trim();
        
        if (!deploymentName || !namespaceName || deploymentName === '' || namespaceName === '') {
          const errorMsg = `Invalid values after conversion - deployment: "${deploymentName}", namespace: "${namespaceName}"`;
          console.error('❌ String conversion failed:', errorMsg);
          errors.push({
            deployment: `${namespaceName || 'unknown'}/${deploymentName || 'unknown'}`,
            container: container || 'unknown',
            error: errorMsg
          });
          continue;
        }
        
        // Final validation - ensure they're valid non-empty strings
        if (typeof deploymentName !== 'string' || typeof namespaceName !== 'string') {
          const errorMsg = `Type mismatch - deployment: ${typeof deploymentName}, namespace: ${typeof namespaceName}`;
          console.error('❌ Type validation failed:', errorMsg);
          errors.push({
            deployment: `${namespaceName}/${deploymentName}`,
            container: container || 'unknown',
            error: errorMsg
          });
          continue;
        }

        // Get current deployment
        // Ensure we're using primitive strings (not String objects)
        const nameParam = '' + deploymentName; // Force to primitive string
        const namespaceParam = '' + namespaceName; // Force to primitive string
        
        console.log('📡 Calling readNamespacedDeployment with:', { 
          name: nameParam, 
          namespace: namespaceParam,
          nameType: typeof nameParam,
          namespaceType: typeof namespaceParam,
          nameLength: nameParam.length,
          namespaceLength: namespaceParam.length,
          nameValue: JSON.stringify(nameParam),
          namespaceValue: JSON.stringify(namespaceParam)
        });
        
        // Validate one more time
        if (!nameParam || nameParam.length === 0 || !namespaceParam || namespaceParam.length === 0) {
          throw new Error(`Invalid parameters: name="${nameParam}", namespace="${namespaceParam}"`);
        }
        
        // Final check right before the call - be very explicit
        const finalName = (nameParam && typeof nameParam === 'string' && nameParam.trim()) || null;
        const finalNamespace = (namespaceParam && typeof namespaceParam === 'string' && namespaceParam.trim()) || null;
        
        if (!finalName || !finalNamespace) {
          throw new Error(`Invalid parameters after final validation: name="${finalName}" (original: "${nameParam}", type: ${typeof nameParam}), namespace="${finalNamespace}" (original: "${namespaceParam}", type: ${typeof namespaceParam})`);
        }
        
        let getResponse;
        let deploymentObj;
        try {
          console.log('🚀 About to call readNamespacedDeployment:', {
            name: finalName,
            namespace: finalNamespace,
            nameType: typeof finalName,
            namespaceType: typeof finalNamespace,
            nameLength: finalName.length,
            namespaceLength: finalNamespace.length,
            nameValue: JSON.stringify(finalName),
            namespaceValue: JSON.stringify(finalNamespace)
          });
          
          // Use the final validated values
          getResponse = await k8sAppsApi.readNamespacedDeployment(finalName, finalNamespace);
          deploymentObj = getResponse.body;
          console.log('✅ readNamespacedDeployment succeeded');
        } catch (apiError) {
          console.error('⚠️ Library method failed:', {
            message: apiError.message,
            stack: apiError.stack,
            finalName: finalName,
            finalNamespace: finalNamespace,
            originalNameParam: nameParam,
            originalNamespaceParam: namespaceParam,
            nameType: typeof finalName,
            namespaceType: typeof finalNamespace
          });
          console.error('⚠️ Trying direct HTTP call as fallback...');
          try {
            const directResponse = await makeK8sDirectHttpCall(
              `/apis/apps/v1/namespaces/${encodeURIComponent(finalNamespace)}/deployments/${encodeURIComponent(finalName)}`, 
              null
            );
            deploymentObj = directResponse.body || directResponse;
            console.log('✅ Direct HTTP call succeeded');
          } catch (directError) {
            console.error('❌ Both library and direct HTTP call failed:', {
              libraryError: apiError.message,
              libraryStack: apiError.stack,
              directError: directError.message,
              directStack: directError.stack,
              finalName: finalName,
              finalNamespace: finalNamespace,
              nameType: typeof finalName,
              namespaceType: typeof finalNamespace
            });
            // Re-throw with more context
            const errorMsg = `Failed to fetch deployment "${finalName}" in namespace "${finalNamespace}": ${directError.message || apiError.message}`;
            throw new Error(errorMsg);
          }
        }

        // Update container image
        const containerIndex = deploymentObj.spec.template.spec.containers.findIndex(
          c => c.name === container
        );

        if (containerIndex === -1) {
          errors.push({
            deployment: `${namespaceName}/${deploymentName}`,
            container,
            error: `Container "${container}" not found in deployment`
          });
          continue;
        }

        deploymentObj.spec.template.spec.containers[containerIndex].image = image;

        // Apply update - use the validated values (finalName and finalNamespace are already validated)
        // Re-validate one more time before the replace call
        if (!finalName || !finalNamespace || finalName.trim() === '' || finalNamespace.trim() === '') {
          throw new Error(`Invalid parameters for replace: name="${finalName}", namespace="${finalNamespace}"`);
        }
        
        console.log('📤 Updating deployment with:', { 
          name: finalName, 
          namespace: finalNamespace, 
          newImage: image,
          nameType: typeof finalName,
          namespaceType: typeof finalNamespace,
          nameLength: finalName.length,
          namespaceLength: finalNamespace.length
        });
        
        try {
          // Correct parameter order: namespace, name, body
          await k8sAppsApi.replaceNamespacedDeployment(
            finalNamespace,
            finalName,
            deploymentObj
          );
          console.log('✅ Deployment updated successfully');
        } catch (replaceError) {
          console.error('⚠️ Library replace method failed, trying direct HTTP PUT...', replaceError.message);
          try {
            // Use direct HTTP PUT as fallback
            const https = await import('https');
            const cluster = currentKubeConfig.getCurrentCluster();
            if (!cluster || !cluster.server) {
              throw new Error('No active cluster for direct HTTP call');
            }
            
            const opts = {};
            currentKubeConfig.applyToHTTPSOptions(opts);
            
            let httpsAgent = null;
            if (opts.ca || opts.cert || opts.key) {
              httpsAgent = new https.Agent({
                ca: opts.ca,
                cert: opts.cert,
                key: opts.key,
                rejectUnauthorized: opts.rejectUnauthorized !== false
              });
            }

            const headers = { 'Content-Type': 'application/json' };
            if (opts.headers) Object.assign(headers, opts.headers);
            if (opts.auth) headers['Authorization'] = opts.auth;

            console.log('📡 Making direct HTTP PUT to:', `${cluster.server}/apis/apps/v1/namespaces/${encodeURIComponent(finalNamespace)}/deployments/${encodeURIComponent(finalName)}`);
            
            await axios({
              method: 'PUT',
              url: `${cluster.server}/apis/apps/v1/namespaces/${encodeURIComponent(finalNamespace)}/deployments/${encodeURIComponent(finalName)}`,
              headers,
              httpsAgent,
              data: deploymentObj,
              validateStatus: () => true
            });
            
            console.log('✅ Direct HTTP PUT succeeded');
          } catch (directError) {
            console.error('❌ Both library and direct HTTP PUT failed:', {
              libraryError: replaceError.message,
              libraryStack: replaceError.stack,
              directError: directError.message,
              directStack: directError.stack,
              name: finalName,
              namespace: finalNamespace,
              nameType: typeof finalName,
              namespaceType: typeof finalNamespace
            });
            throw new Error(`Failed to update deployment: ${directError.message || replaceError.message}`);
          }
        }

        results.push({
          namespace: finalNamespace,
          deployment: finalName,
          container: container,
          image: image,
          success: true
        });
      } catch (error) {
        errors.push({
          deployment: `${update.namespace}/${update.deployment}`,
          container: update.container,
          error: error.message || 'Failed to update deployment'
        });
      }
    }

    res.json({
      success: errors.length === 0,
      updated: results.length,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update images',
      message: error.message || 'Error updating container images'
    });
  }
});

// Helper function to provide troubleshooting suggestions
function getJiraErrorSuggestion(status, message) {
  if (status === 401) {
    return 'Check your email and API token. Make sure the API token is valid and not expired.';
  } else if (status === 403) {
    return 'Your account may not have permission to access this Jira instance or project. Contact your Jira administrator.';
  } else if (status === 404 || status === 410) {
    if (message?.includes('project')) {
      return `The project key may be incorrect, deleted, or archived. Use the "List Projects" endpoint to find available project keys. Status ${status} means the project doesn't exist or is no longer available.`;
    }
    return 'The Jira instance URL may be incorrect. Check the base URL.';
  } else if (status === 400) {
    return 'Invalid request. Check if the project key and labels are correctly formatted.';
  } else if (!status) {
    if (message?.includes('Cannot connect') || message?.includes('ENOTFOUND')) {
      return 'Cannot reach the Jira server. Check the base URL and your network connection.';
    }
    if (message?.includes('ECONNREFUSED')) {
      return 'Connection refused. The Jira server may be down or the URL is incorrect.';
    }
  }
  return 'Check your Jira configuration and try again. Review the error details above.';
}

// Helper function to fetch GitHub PRs with pagination (on-demand)
async function fetchGitHubPRsPaginated(token, organization, username, repositories, page = 1, pageSize = 100, state = 'all', repoFilter = null) {
  try {
    const headers = {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    };
    
    let repos = [];
    
    // Get repositories
    if (repositories && repositories.length > 0) {
      const owner = organization || username;
      repos = repositories.map(repo => ({
        full_name: `${owner}/${repo}`,
        owner: owner,
        name: repo,
      }));
    } else {
      const apiUrl = organization
        ? `https://api.github.com/orgs/${organization}/repos`
        : `https://api.github.com/user/repos`;
      
      const reposResponse = await axios.get(apiUrl, { headers });
      repos = reposResponse.data.map(repo => ({
        full_name: repo.full_name,
        owner: repo.owner.login,
        name: repo.name,
      }));
    }
    
    // Filter repos if repoFilter is specified
    if (repoFilter && repoFilter !== 'all') {
      repos = repos.filter(repo => repo.name === repoFilter);
    }
    
    // Fetch PRs from each repository with pagination
    // Strategy: Fetch one page (100 PRs) from each repo, combine, sort, and paginate
    // For later pages, we'll fetch more pages as needed
    const allPRs = [];
    const perPage = 100; // GitHub API max per page
    
    // Calculate how many pages to fetch from each repo to get enough PRs for the requested page
    // If pageSize is very large (like 10000), we're trying to fetch all PRs for filtering
    const isFetchingAll = pageSize >= 5000;
    const minPRsNeeded = isFetchingAll ? 10000 : (page * pageSize);
    const filterMultiplier = (state === 'merged' || state === 'closed') ? 2 : 1.5; // Fetch more if filtering
    const adjustedPRsNeeded = isFetchingAll ? 10000 : Math.ceil(minPRsNeeded * filterMultiplier);
    
    // Calculate pages per repo: fetch many pages if fetching all (up to 100 pages = 10000 PRs per repo)
    // Otherwise, fetch enough for the requested page
    const maxPagesPerRepo = isFetchingAll ? 100 : Math.max(1, Math.ceil(adjustedPRsNeeded / (repos.length * perPage || 1))) + 2;
    const pagesPerRepo = Math.min(maxPagesPerRepo, 100); // Cap at 100 pages per repo (10000 PRs)
    console.log(`📊 Pagination calculation: page=${page}, pageSize=${pageSize}, repos=${repos.length}, pagesPerRepo=${pagesPerRepo}, minPRsNeeded=${minPRsNeeded}, adjustedPRsNeeded=${adjustedPRsNeeded}, state=${state}, isFetchingAll=${isFetchingAll}`);
    
    for (const repo of repos) {
      try {
        // Map state filter to GitHub API state
        let githubState = 'all';
        if (state === 'open') githubState = 'open';
        else if (state === 'closed') githubState = 'closed';
        else if (state === 'merged') {
          // For merged, we need to fetch closed PRs and filter by merged_at
          githubState = 'closed';
        }
        
        // Fetch pages from this repo
        for (let pageNum = 1; pageNum <= pagesPerRepo; pageNum++) {
          const prsUrl = `https://api.github.com/repos/${repo.full_name}/pulls?state=${githubState}&per_page=${perPage}&page=${pageNum}&sort=updated&direction=desc`;
          const prsResponse = await axios.get(prsUrl, { headers });
          
          if (prsResponse.data.length === 0) break; // No more PRs in this repo
          
          let repoPRs = prsResponse.data.map(pr => ({
            id: pr.id.toString(),
            repo: repo.name,
            prNumber: pr.number,
            title: pr.title,
            author: pr.user.login,
            created: pr.created_at,
            updated: pr.updated_at,
            assignedTo: pr.requested_reviewers?.[0]?.login || 'Unassigned',
            qaStatus: getQAStatus(pr.state, pr.mergeable),
            mergeStatus: pr.state === 'open' ? 'Open' : pr.merged_at ? 'Merged' : 'Closed',
            jira: extractJiraKey(pr.title, pr.body) || `PROJ-${pr.number}`,
            url: pr.html_url,
            baseBranch: pr.base?.ref || 'main',
            headBranch: pr.head?.ref || 'feature',
            labels: (pr.labels || []).map(label => label.name),
            reviewers: (pr.requested_reviewers || []).map(reviewer => reviewer.login),
          }));
          
          // Filter for merged if state is 'merged'
          if (state === 'merged') {
            repoPRs = repoPRs.filter(pr => pr.mergeStatus === 'Merged');
          } else if (state === 'closed') {
            repoPRs = repoPRs.filter(pr => pr.mergeStatus === 'Closed');
          }
          
          allPRs.push(...repoPRs);
          
          // If we got less than perPage, no more pages for this repo
          if (prsResponse.data.length < perPage) break;
        }
      } catch (error) {
        console.error(`Error fetching PRs from ${repo.full_name}:`, error.message);
        // Continue with other repositories
      }
    }
    
    // Sort by updated date (most recent first)
    allPRs.sort((a, b) => new Date(b.updated) - new Date(a.updated));
    
    // Remove duplicates (in case same PR appears in multiple pages)
    const uniquePRs = [];
    const seenPRs = new Set();
    for (const pr of allPRs) {
      const prKey = `${pr.repo}-${pr.prNumber}`;
      if (!seenPRs.has(prKey)) {
        seenPRs.add(prKey);
        uniquePRs.push(pr);
      }
    }
    
    console.log(`📊 After filtering and deduplication: ${uniquePRs.length} unique PRs available (state=${state})`);
    
    // Apply pagination
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedPRs = uniquePRs.slice(startIndex, endIndex);
    
    console.log(`📊 Pagination result: fetched ${uniquePRs.length} unique PRs, requesting page ${page} (${startIndex} to ${endIndex}), returning ${paginatedPRs.length} PRs`);
    
    // If we got fewer PRs than requested, we might need to fetch more
    if (paginatedPRs.length < pageSize && endIndex < uniquePRs.length) {
      console.log(`⚠️ Got ${paginatedPRs.length} PRs but requested ${pageSize}. This might be due to filtering.`);
    }
    
    // Check if there are more PRs
    // If we got a full page and haven't reached the end of fetched PRs, there might be more
    const hasMore = paginatedPRs.length === pageSize && endIndex < uniquePRs.length;
    
    // For total count: if we're requesting a page beyond what we've fetched,
    // we can't know the exact total, so we estimate based on what we have
    // If we got a full page, estimate there might be more
    let estimatedTotal = uniquePRs.length;
    if (hasMore && paginatedPRs.length === pageSize) {
      // If we got a full page and there might be more, estimate conservatively
      // Use the current fetched count as minimum, but indicate it might be more
      estimatedTotal = Math.max(uniquePRs.length, page * pageSize);
    }
    
    return {
      prs: paginatedPRs,
      hasMore: hasMore,
      total: estimatedTotal,
      page: page,
      pageSize: pageSize
    };
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('Invalid GitHub token. Please check your personal access token.');
    } else if (error.response?.status === 404) {
      throw new Error('Repository or organization not found. Please check your configuration.');
    } else {
      throw new Error(`GitHub API error: ${error.message}`);
    }
  }
}

// Helper function to fetch GitHub PRs (all PRs - for sync)
async function fetchGitHubPRs(token, organization, username, repositories) {
  try {
    const headers = {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    };
    
    let repos = [];
    
    // Get repositories
    if (repositories && repositories.length > 0) {
      // Use specified repositories
      const owner = organization || username;
      repos = repositories.map(repo => ({
        full_name: `${owner}/${repo}`,
        owner: owner,
        name: repo,
      }));
    } else {
      // Fetch all repositories
      const apiUrl = organization
        ? `https://api.github.com/orgs/${organization}/repos`
        : `https://api.github.com/user/repos`;
      
      const reposResponse = await axios.get(apiUrl, { headers });
      repos = reposResponse.data.map(repo => ({
        full_name: repo.full_name,
        owner: repo.owner.login,
        name: repo.name,
      }));
    }
    
    // Fetch PRs from each repository (with pagination to get all PRs)
    const allPRs = [];
    
    for (const repo of repos) {
      try {
        let page = 1;
        let hasMore = true;
        const perPage = 100; // GitHub API max per page
        
        while (hasMore) {
          const prsUrl = `https://api.github.com/repos/${repo.full_name}/pulls?state=all&per_page=${perPage}&page=${page}&sort=updated&direction=desc`;
          const prsResponse = await axios.get(prsUrl, { headers });
          
          const repoPRs = prsResponse.data.map(pr => ({
            id: pr.id.toString(),
            repo: repo.name,
            prNumber: pr.number,
            title: pr.title,
            author: pr.user.login,
            created: pr.created_at,
            updated: pr.updated_at,
            assignedTo: pr.requested_reviewers?.[0]?.login || 'Unassigned',
            qaStatus: getQAStatus(pr.state, pr.mergeable),
            mergeStatus: pr.state === 'open' ? 'Open' : pr.merged_at ? 'Merged' : 'Closed',
            jira: extractJiraKey(pr.title, pr.body) || `PROJ-${pr.number}`,
            url: pr.html_url,
            baseBranch: pr.base?.ref || 'main',
            headBranch: pr.head?.ref || 'feature',
            labels: (pr.labels || []).map(label => label.name),
            reviewers: (pr.requested_reviewers || []).map(reviewer => reviewer.login),
          }));
          
          allPRs.push(...repoPRs);
          
          // Check if there are more pages
          hasMore = prsResponse.data.length === perPage;
          page++;
          
          // Safety limit: don't fetch more than 1000 PRs per repo
          if (page > 10) {
            console.log(`⚠️  Reached page limit for ${repo.full_name}, fetched ${allPRs.length} PRs`);
            break;
          }
        }
        
        const repoPRCount = allPRs.filter(pr => pr.repo === repo.name).length;
        console.log(`✓ Fetched ${repoPRCount} PRs from ${repo.full_name} (Open: ${allPRs.filter(pr => pr.repo === repo.name && pr.mergeStatus === 'Open').length}, Merged: ${allPRs.filter(pr => pr.repo === repo.name && pr.mergeStatus === 'Merged').length}, Closed: ${allPRs.filter(pr => pr.repo === repo.name && pr.mergeStatus === 'Closed').length})`);
      } catch (error) {
        console.error(`Error fetching PRs from ${repo.full_name}:`, error.message);
        // Continue with other repositories
      }
    }
    
    console.log(`📊 Total PRs fetched: ${allPRs.length} (across ${repos.length} repositories)`);
    console.log(`   - Open: ${allPRs.filter(pr => pr.mergeStatus === 'Open').length}`);
    console.log(`   - Merged: ${allPRs.filter(pr => pr.mergeStatus === 'Merged').length}`);
    console.log(`   - Closed: ${allPRs.filter(pr => pr.mergeStatus === 'Closed').length}`);
    return allPRs;
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('Invalid GitHub token. Please check your personal access token.');
    } else if (error.response?.status === 404) {
      throw new Error('Repository or organization not found. Please check your configuration.');
    } else {
      throw new Error(`GitHub API error: ${error.message}`);
    }
  }
}

// Helper function to fetch Jira issues
async function fetchJiraIssues(baseUrl, email, apiToken, projectKey, labels = []) {
  let verifiedProjectKey = projectKey; // Will be updated from API response
  try {
    // Clean up baseUrl - remove trailing slash if present
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    
    console.log('\n========== FETCH JIRA ISSUES ==========');
    console.log('Raw Base URL:', baseUrl);
    console.log('Cleaned Base URL:', cleanBaseUrl);
    console.log('Email:', email);
    console.log('API Token Length:', apiToken ? apiToken.length : 'NOT PROVIDED');
    console.log('API Token (masked):', apiToken ? `${apiToken.substring(0, 4)}...${apiToken.substring(apiToken.length - 4)}` : 'NOT PROVIDED');
    console.log('Full API Token:', apiToken);
    console.log('Project Key:', projectKey);
    console.log('Labels:', labels && labels.length > 0 ? labels.join(', ') : 'None');
    console.log('Labels Type:', Array.isArray(labels) ? 'Array' : typeof labels);
    console.log('Labels Array:', JSON.stringify(labels));
    
    // Validate baseUrl format
    if (!cleanBaseUrl.startsWith('http://') && !cleanBaseUrl.startsWith('https://')) {
      throw new Error('Invalid Jira base URL. It must start with http:// or https://');
    }
    
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    console.log('Auth String:', `${email}:${apiToken.substring(0, 4)}...`);
    console.log('Auth Header (masked):', `Basic ${auth.substring(0, 20)}...`);
    console.log('Full Auth Header:', `Basic ${auth}`);
    
    const headers = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    console.log('Request Headers:', {
      'Authorization': `Basic ${auth.substring(0, 20)}...`,
      'Accept': headers.Accept,
      'Content-Type': headers['Content-Type']
    });
    
    // First, test the connection by checking if we can access Jira
    console.log(`\nStep 1: Testing connection to Jira at: ${cleanBaseUrl}`);
    
    try {
      const myselfUrl = `${cleanBaseUrl}/rest/api/3/myself`;
      console.log('Myself URL:', myselfUrl);
      console.log('Making GET request to:', myselfUrl);
      const myselfResponse = await axios.get(myselfUrl, { headers });
      console.log(`✓ Connected as: ${myselfResponse.data.displayName} (${myselfResponse.data.emailAddress})`);
      console.log('Response Status:', myselfResponse.status);
    } catch (testError) {
      if (testError.response?.status === 401) {
        throw new Error('Invalid Jira credentials. Please check your email and API token.');
      } else if (testError.response?.status === 403) {
        throw new Error('Access forbidden. Your account may not have permission to access this Jira instance.');
      } else if (testError.code === 'ENOTFOUND' || testError.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to Jira server at ${cleanBaseUrl}. Please check the base URL.`);
      }
      throw new Error(`Failed to connect to Jira: ${testError.response?.data?.message || testError.message}`);
    }
    
    // First, verify the project exists and is accessible - use the verified key for search
    console.log(`\nStep 2: Verifying project: ${projectKey}`);
    let verifiedProjectKey = projectKey; // Default to input, will be updated from API response
    
    try {
      const projectUrl = `${cleanBaseUrl}/rest/api/3/project/${projectKey}`;
      console.log('Project URL:', projectUrl);
      console.log('Making GET request to:', projectUrl);
      const projectResponse = await axios.get(projectUrl, { headers });
      
      // Use the actual project key from the API response (more reliable)
      verifiedProjectKey = projectResponse.data.key;
      console.log(`✓ Project verified: ${projectResponse.data.name} (${projectResponse.data.key})`);
      console.log('Response Status:', projectResponse.status);
      console.log('Project Details:', {
        key: projectResponse.data.key,
        name: projectResponse.data.name,
        archived: projectResponse.data.archived,
        projectTypeKey: projectResponse.data.projectTypeKey
      });
      
      // Compare input key with verified key
      if (projectKey.trim().toUpperCase() !== verifiedProjectKey.toUpperCase()) {
        console.log(`⚠️  Warning: Input project key '${projectKey}' differs from verified key '${verifiedProjectKey}'. Using verified key.`);
      }
      
      if (projectResponse.data.archived) {
        throw new Error(`Project '${projectKey}' is archived and cannot be accessed.`);
      }
    } catch (projectError) {
      if (projectError.response?.status === 404 || projectError.response?.status === 410) {
        throw new Error(`Project '${projectKey}' not found or has been deleted/archived. Please verify the project key exists in Jira. Use the "List Projects" button to see all available projects.`);
      } else if (projectError.response?.status === 403) {
        throw new Error(`You don't have permission to access project '${projectKey}'. Contact your Jira administrator.`);
      }
      throw projectError;
    }
    
    // Search for issues in the project using the VERIFIED project key
    console.log(`\nStep 3: Searching for issues`);
    // Will use POST /rest/api/3/search/jql endpoint"jql": "project = \"FLUID\" AND labels = \"APC-12-DEC\" ORDER BY created DESC",
    
    // Build JQL query with optional label filtering
    // Use the verified project key (from API response) instead of user input
    // For JQL, we can use the key directly without quotes in most cases, but quotes are safer
    const escapedProjectKey = verifiedProjectKey.replace(/"/g, '\\"');
    let jql = `project = "${escapedProjectKey}"`;
    
    console.log('Using verified project key for search:', verifiedProjectKey);
    
    console.log('Escaped Project Key:', escapedProjectKey);
    console.log('Labels provided:', labels);
    console.log('Labels is array?', Array.isArray(labels));
    console.log('Labels length:', labels && Array.isArray(labels) ? labels.length : 'N/A');
    
    // Add label filters if provided - use IN syntax for multiple labels
    if (labels && Array.isArray(labels) && labels.length > 0) {
      console.log('Processing labels:', labels);
      // Use labels IN (...) syntax for cleaner JQL query
      const escapedLabels = labels.map(label => {
        const trimmedLabel = label.trim();
        const escapedLabel = trimmedLabel.replace(/"/g, '\\"');
        console.log(`  Label: "${trimmedLabel}" -> Escaped: "${escapedLabel}"`);
        return `"${escapedLabel}"`;
      });
      jql += ` AND labels IN (${escapedLabels.join(', ')})`;
      console.log(`✓ Filtering by labels using IN syntax: ${labels.join(', ')}`);
      console.log(`✓ JQL labels clause: labels IN (${escapedLabels.join(', ')})`);
    } else {
      console.log('No labels to filter by');
    }
    
    jql += ` ORDER BY created DESC`;
    
    console.log(`Final JQL Query: ${jql}`);
    
    // Use GET method to /rest/api/3/search/jql (enhanced search endpoint)
    // This is the recommended endpoint as per Atlassian documentation
    // https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-get
    
    // Build query parameters
    const params = new URLSearchParams({
      jql: jql,
      maxResults: '100',
      startAt: '0'
    });
    
    // Add fields as individual parameters (Jira expects fields[] format)
    const fields = ['summary', 'status', 'assignee', 'labels', 'created', 'key', 'issuetype'];
    fields.forEach(field => params.append('fields', field));
    
    const searchUrl = `${cleanBaseUrl}/rest/api/3/search/jql?${params.toString()}`;
    console.log(`Making GET request to: ${cleanBaseUrl}/rest/api/3/search/jql`);
    console.log('JQL Query:', jql);
    console.log('Query Parameters:', params.toString());
    
    let response;
    try {
      response = await axios.get(searchUrl, { headers });
      console.log('✓ Successfully used GET method to /rest/api/3/search/jql');
    } catch (error) {
      // Log detailed error information
      console.error('Error from /rest/api/3/search/jql:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        jql: jql,
      });
      throw error;
    }
    
    console.log('Response Status:', response.status);
    
    // Handle response from /rest/api/3/search/jql
    // The response format is the same as the standard search endpoint
    const issues = response.data.issues || [];
    const total = response.data.total || 0;
    const maxResults = response.data.maxResults || 0;
    
    console.log(`Response: ${issues.length} issues out of ${total} total`);
    console.log('Using enhanced search endpoint: /rest/api/3/search/jql');
    
    console.log('Total Issues Found:', total);
    console.log('Max Results:', maxResults);
    
    // If no issues found but total > 0, there might be a filter issue
    if (total > 0 && issues.length === 0) {
      console.log('⚠️  Warning: Total issues > 0 but no issues returned. This might indicate a pagination or filter issue.');
    }
    console.log(`✓ Found ${issues.length} issues in project ${verifiedProjectKey}${labels && labels.length > 0 ? ` with labels: ${labels.join(', ')}` : ''}`);
    
    if (issues.length > 0) {
      console.log('Sample Issue Keys:', issues.slice(0, 5).map(i => i.key).join(', '));
    }
    
    console.log('========================================\n');
    
    return issues;
  } catch (error) {
    console.error('\n========== JIRA API ERROR ==========');
    console.error('Error Message:', error.message);
    console.error('Error Code:', error.code);
    console.error('HTTP Status:', error.response?.status);
    console.error('HTTP Status Text:', error.response?.statusText);
    console.error('Request URL:', error.config?.url);
    console.error('Request Method:', error.config?.method);
    console.error('Response Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Full Error Object:', JSON.stringify({
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
    }, null, 2));
    console.error('====================================\n');
    
    if (error.message.includes('Invalid Jira credentials') || 
        error.message.includes('Cannot connect') ||
        error.message.includes('Access forbidden')) {
      throw error; // Re-throw our custom errors
    } else if (error.response?.status === 401) {
      throw new Error('Invalid Jira credentials. Please check your email and API token.');
    } else if (error.response?.status === 403) {
      throw new Error('Access forbidden. Your account may not have permission to access this Jira instance or project.');
    } else if (error.response?.status === 404 || error.response?.status === 410) {
      const errorMsg = error.response?.data?.errorMessages?.[0] || error.response?.data?.message || 'Not found';
      
      // Check if it's a project-related error
      if (errorMsg.toLowerCase().includes('project') || 
          errorMsg.toLowerCase().includes('does not exist') ||
          error.response?.status === 410) {
        throw new Error(
          `Jira project '${projectKey}' not found, deleted, or archived (HTTP ${error.response?.status}). ` +
          `Please verify the project key in Jira. Use the "List Projects" button in Settings to see all available projects.`
        );
      }
      
      // Check for JQL syntax errors
      if (errorMsg.toLowerCase().includes('jql') || errorMsg.toLowerCase().includes('query')) {
        console.error('JQL Query that failed:', jql || 'N/A');
        throw new Error(`JQL query error: ${errorMsg}. The query used was: ${jql || 'N/A'}. Please check your project key and label filters.`);
      }
      
      throw new Error(`Jira resource not found (HTTP ${error.response?.status}): ${errorMsg}`);
    } else if (error.code === 'ENOTFOUND') {
      throw new Error(`Cannot resolve Jira server hostname. Please check the base URL: ${baseUrl}`);
    } else if (error.code === 'ECONNREFUSED') {
      throw new Error(`Connection refused to Jira server. Please check if the base URL is correct: ${baseUrl}`);
    } else if (error.response?.data?.errorMessages) {
      throw new Error(`Jira API error: ${error.response.data.errorMessages.join(', ')}`);
    } else {
      throw new Error(`Jira API error: ${error.response?.data?.message || error.message}`);
    }
  }
}

// Helper function to extract Jira key from PR title/body
// Looks for patterns like: APC-616, PROJ-123, FLUID-7339, etc.
function extractJiraKey(title, body) {
  const text = `${title || ''} ${body || ''}`;
  // Match pattern: uppercase letters (2+ chars) followed by dash and numbers (e.g., APC-616, PROJ-123)
  const match = text.match(/([A-Z]{2,}-\d+)/);
  if (match) {
    console.log(`📌 Extracted Jira key "${match[1]}" from PR: "${(title || '').substring(0, 50)}..."`);
    return match[1];
  }
  return null;
}

// Helper function to determine QA status
function getQAStatus(state, mergeable) {
  if (state === 'closed') return 'Approved';
  if (mergeable === false) return 'In Review';
  return 'Pending';
}

// ==================== USER MANAGEMENT & AUTHENTICATION ====================

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// Role-based authorization middleware
function authorizeRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Middleware to check Kubernetes access (role-based or time-based grant)
function authorizeKubernetesAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const userId = req.user.id;
  const user = usersData.find(u => u.id === userId);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Check role-based access
  const hasRoleAccess = user.role === 'admin' || user.role === 'manager';
  
  // Check time-based access grant
  const hasGrantAccess = hasActiveAccessGrant(userId, 'kubernetes');
  
  if (!hasRoleAccess && !hasGrantAccess) {
    return res.status(403).json({ 
      error: 'Access denied', 
      message: 'You do not have access to Kubernetes Management. Your access grant may have expired.',
      hasRoleAccess: false,
      hasGrantAccess: false
    });
  }
  
  next();
}

// Helper to remove password from user object
function sanitizeUser(user) {
  const { password, ...sanitized } = user;
  return sanitized;
}

// Debug endpoint to check users (remove in production)
app.get('/api/debug/users', (req, res) => {
  res.json({ 
    userCount: usersData.length,
    users: usersData.map(u => ({ username: u.username, role: u.role, isActive: u.isActive }))
  });
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Ensure default admin exists if no users (lazy initialization)
    if (usersData.length === 0) {
      console.log('⚠️  No users found during login, initializing default admin...');
      await initializeDefaultAdmin();
    }

    console.log(`Login attempt for username: ${username}, usersData length: ${usersData.length}`);
    const user = usersData.find(u => u.username === username && u.isActive);
    if (!user) {
      console.log(`User not found or inactive. Available users: ${usersData.map(u => u.username).join(', ') || 'none'}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date().toISOString();
    await saveUsersToMongoDB();

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Create session in MongoDB
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const session = await createUserSession(user.id, token, ipAddress, userAgent);

    res.json({
      success: true,
      token,
      sessionId: session.sessionId,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

// Validate session endpoint
app.post('/api/auth/validate-session', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    const session = await validateSession(sessionId);
    
    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    
    // Get user data
    const user = usersData.find(u => u.id === session.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    
    res.json({
      success: true,
      session: {
        sessionId: session.sessionId,
        userId: session.userId,
        expiresAt: session.expiresAt,
        lastActivity: session.lastActivity
      },
      user: sanitizeUser(user),
      token: session.token
    });
  } catch (error) {
    console.error('Session validation error:', error);
    res.status(500).json({ error: 'Session validation failed', message: error.message });
  }
});

// Logout endpoint
app.post('/api/auth/logout', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (sessionId) {
      await deleteSession(sessionId);
    }
    
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed', message: error.message });
  }
});

// Get current user
app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = usersData.find(u => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ success: true, user: sanitizeUser(user) });
});

// Get all users (admin only)
app.get('/api/users', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const users = usersData.map(sanitizeUser);
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users', message: error.message });
  }
});

// ==================== USER SETTINGS & SEARCH HISTORY ====================

// Get user settings (user can see own, admin can see any)
// IMPORTANT: This must come BEFORE /api/users/:id to avoid route conflicts
app.get('/api/user/settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.query.userId && req.user.role === 'admin' 
      ? req.query.userId 
      : req.user.id;
    
    if (!db) {
      return res.json({ success: true, settings: {} });
    }
    
    const collection = db.collection(USER_SETTINGS_COLLECTION);
    const settings = await collection.findOne({ userId });
    
    res.json({ success: true, settings: settings?.settings || {} });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save user settings
app.put('/api/user/settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { settings } = req.body;
    
    if (!db) {
      return res.json({ success: true, message: 'Settings saved (in-memory mode)' });
    }
    
    const collection = db.collection(USER_SETTINGS_COLLECTION);
    await collection.updateOne(
      { userId },
      { 
        $set: { 
          userId,
          settings: settings || {},
          updatedAt: new Date().toISOString()
        } 
      },
      { upsert: true }
    );
    
    res.json({ success: true, message: 'Settings saved' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user by ID (admin only)
app.get('/api/users/:id', authenticateToken, authorizeRole('admin'), (req, res) => {
  const user = usersData.find(u => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ success: true, user: sanitizeUser(user) });
});

// Create user (admin only)
app.post('/api/users', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    if (!username || !email || !password || !role) {
      return res.status(400).json({ error: 'Username, email, password, and role are required' });
    }

    if (!['admin', 'manager', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin, manager, or viewer' });
    }

    // Check if username or email already exists
    if (usersData.some(u => u.username === username)) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    if (usersData.some(u => u.email === email)) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      username,
      email,
      password: hashedPassword,
      role,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true
    };

    usersData.push(newUser);
    await saveUsersToMongoDB();

    res.status(201).json({ success: true, user: sanitizeUser(newUser) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user', message: error.message });
  }
});

// Update user (admin only, or user can update their own profile)
app.put('/api/users/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, password, role, isActive } = req.body;
    const currentUser = usersData.find(u => u.id === req.user.id);

    // Check if user exists
    const user = usersData.find(u => u.id === id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Protect default admin user from role changes
    if (user.username === 'admin' && role && role !== 'admin') {
      return res.status(403).json({ error: 'Cannot change role of the default admin user. The admin user must always maintain admin privileges.' });
    }

    // Protect default admin user from deactivation
    if (user.username === 'admin' && isActive === false) {
      return res.status(403).json({ error: 'Cannot deactivate the default admin user. The admin user is required for system access.' });
    }

    // Only admin can update other users or change roles
    if (id !== req.user.id && currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Only admin can change role
    if (role && role !== user.role && currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Only admin can change user roles' });
    }

    // Update fields
    if (username && user.username !== 'admin') {
      // Allow username change for non-admin users only
      user.username = username;
    }
    if (email) user.email = email;
    if (password) {
      user.password = await bcrypt.hash(password, 10);
    }
    if (role && currentUser.role === 'admin') {
      if (!['admin', 'manager', 'viewer'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      // Ensure admin user always has admin role
      if (user.username === 'admin') {
        user.role = 'admin';
      } else {
        user.role = role;
      }
    }
    if (isActive !== undefined && currentUser.role === 'admin') {
      // Ensure admin user is always active
      if (user.username === 'admin') {
        user.isActive = true;
      } else {
        user.isActive = isActive;
      }
    }
    user.updatedAt = new Date().toISOString();

    await saveUsersToMongoDB();

    res.json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user', message: error.message });
  }
});

// Delete user (admin only)
app.delete('/api/users/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting yourself
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const user = usersData.find(u => u.id === id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Protect default admin user from deletion
    if (user.username === 'admin') {
      return res.status(403).json({ error: 'Cannot delete the default admin user. The admin user is required for system access.' });
    }

    const userIndex = usersData.findIndex(u => u.id === id);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    usersData.splice(userIndex, 1);
    await saveUsersToMongoDB();

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user', message: error.message });
  }
});

// ==================== END USER MANAGEMENT ====================

// ==================== TIME-BASED ACCESS GRANTS ====================

// Get all access grants (admin only)
app.get('/api/access-grants', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const { userId, resource, activeOnly } = req.query;
    let grants = [...accessGrantsData];
    
    // Filter by userId if provided
    if (userId) {
      grants = grants.filter(g => g.userId === userId);
    }
    
    // Filter by resource if provided
    if (resource) {
      grants = grants.filter(g => g.resource === resource);
    }
    
    // Filter active only if requested
    if (activeOnly === 'true') {
      const now = new Date();
      grants = grants.filter(g => 
        g.isActive &&
        new Date(g.startTime) <= now &&
        new Date(g.endTime) >= now &&
        !g.revokedAt
      );
    }
    
    // Sort by creation date (newest first)
    grants.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json({ success: true, grants });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch access grants', message: error.message });
  }
});

// Get user's active access grants
app.get('/api/access-grants/my-grants', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    
    const activeGrants = accessGrantsData.filter(grant => 
      grant.userId === userId &&
      grant.isActive &&
      new Date(grant.startTime) <= now &&
      new Date(grant.endTime) >= now &&
      !grant.revokedAt
    );
    
    res.json({ success: true, grants: activeGrants });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch access grants', message: error.message });
  }
});

// Check if user has access to a resource
app.get('/api/access-grants/check/:resource', authenticateToken, async (req, res) => {
  try {
    const { resource } = req.params;
    const userId = req.user.id;
    const user = usersData.find(u => u.id === userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check role-based access first
    const hasRoleAccess = (user.role === 'admin' || user.role === 'manager') && resource === 'kubernetes';
    
    // Check time-based access grant
    const hasGrantAccess = hasActiveAccessGrant(userId, resource);
    
    const hasAccess = hasRoleAccess || hasGrantAccess;
    
    res.json({ 
      success: true, 
      hasAccess,
      hasRoleAccess,
      hasGrantAccess,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check access', message: error.message });
  }
});

// Create access grant (admin only)
app.post('/api/access-grants', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const { userId, resource, startTime, endTime, reason, permissions } = req.body;
    
    if (!userId || !resource || !startTime || !endTime) {
      return res.status(400).json({ error: 'userId, resource, startTime, and endTime are required' });
    }
    
    // Validate resource
    const validResources = ['kubernetes', 'admin', 'automation', 'flows'];
    if (!validResources.includes(resource)) {
      return res.status(400).json({ error: `Invalid resource. Must be one of: ${validResources.join(', ')}` });
    }
    
    // Validate user exists
    const user = usersData.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Validate dates
    const start = new Date(startTime);
    const end = new Date(endTime);
    const now = new Date();
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    
    if (end <= start) {
      return res.status(400).json({ error: 'endTime must be after startTime' });
    }
    
    // Create grant
    const grant = {
      id: `grant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId,
      username: user.username,
      resource,
      grantedBy: req.user.id,
      grantedByUsername: req.user.username,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      isActive: true,
      createdAt: now.toISOString(),
      reason: reason || '',
      permissions: permissions || []
    };
    
    accessGrantsData.push(grant);
    await saveAccessGrantsToMongoDB();
    
    res.status(201).json({ success: true, grant });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create access grant', message: error.message });
  }
});

// Revoke access grant (admin only)
app.put('/api/access-grants/:id/revoke', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const grant = accessGrantsData.find(g => g.id === id);
    if (!grant) {
      return res.status(404).json({ error: 'Access grant not found' });
    }
    
    grant.isActive = false;
    grant.revokedAt = new Date().toISOString();
    grant.revokedBy = req.user.id;
    grant.reason = reason || grant.reason || 'Revoked by admin';
    
    await saveAccessGrantsToMongoDB();
    
    res.json({ success: true, grant });
  } catch (error) {
    res.status(500).json({ error: 'Failed to revoke access grant', message: error.message });
  }
});

// Delete access grant (admin only)
app.delete('/api/access-grants/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const grantIndex = accessGrantsData.findIndex(g => g.id === id);
    if (grantIndex === -1) {
      return res.status(404).json({ error: 'Access grant not found' });
    }
    
    accessGrantsData.splice(grantIndex, 1);
    await saveAccessGrantsToMongoDB();
    
    res.json({ success: true, message: 'Access grant deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete access grant', message: error.message });
  }
});

// ==================== END TIME-BASED ACCESS GRANTS ====================

// Get user search history (user can see own, admin can see any)
app.get('/api/user/search-history', authenticateToken, async (req, res) => {
  try {
    const userId = req.query.userId && req.user.role === 'admin' 
      ? req.query.userId 
      : req.user.id;
    const limit = parseInt(req.query.limit) || 50;
    
    if (!db) {
      return res.json({ success: true, history: [] });
    }
    
    const collection = db.collection(USER_SEARCH_HISTORY_COLLECTION);
    const history = await collection
      .find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    
    res.json({ success: true, history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save search to history
app.post('/api/user/search-history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { query, type, filters } = req.body;
    
    if (!query) {
      return res.status(400).json({ success: false, error: 'Search query is required' });
    }
    
    if (!db) {
      return res.json({ success: true, message: 'Search saved (in-memory mode)' });
    }
    
    const collection = db.collection(USER_SEARCH_HISTORY_COLLECTION);
    await collection.insertOne({
      userId,
      query,
      type: type || 'general',
      filters: filters || {},
      timestamp: new Date().toISOString()
    });
    
    res.json({ success: true, message: 'Search saved to history' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear user search history
app.delete('/api/user/search-history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    if (!db) {
      return res.json({ success: true, message: 'History cleared (in-memory mode)' });
    }
    
    const collection = db.collection(USER_SEARCH_HISTORY_COLLECTION);
    await collection.deleteMany({ userId });
    
    res.json({ success: true, message: 'Search history cleared' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ADMIN: VIEW ALL USERS DATA ====================

// Get all users' kubeconfigs (admin only)
app.get('/api/admin/kubeconfigs', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    if (!db) {
      return res.json({ success: true, kubeconfigs: kubeconfigsData });
    }
    
    const collection = db.collection(USER_KUBECONFIGS_COLLECTION);
    const kubeconfigs = await collection.find({}).toArray();
    
    // Group by user
    const usersCollection = db.collection(USERS_COLLECTION);
    const users = await usersCollection.find({}).toArray();
    const userMap = new Map(users.map(u => [u.id, sanitizeUser(u)]));
    
    const result = kubeconfigs.map(kc => ({
      ...kc,
      user: userMap.get(kc.userId) || { id: kc.userId, username: 'Unknown' }
    }));
    
    res.json({ success: true, kubeconfigs: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all users' settings (admin only)
app.get('/api/admin/user-settings', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    if (!db) {
      return res.json({ success: true, allSettings: [] });
    }
    
    const collection = db.collection(USER_SETTINGS_COLLECTION);
    const allSettings = await collection.find({}).toArray();
    
    const usersCollection = db.collection(USERS_COLLECTION);
    const users = await usersCollection.find({}).toArray();
    const userMap = new Map(users.map(u => [u.id, sanitizeUser(u)]));
    
    const result = allSettings.map(s => ({
      ...s,
      user: userMap.get(s.userId) || { id: s.userId, username: 'Unknown' }
    }));
    
    res.json({ success: true, allSettings: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all users' search history (admin only)
app.get('/api/admin/search-history', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    
    if (!db) {
      return res.json({ success: true, allHistory: [] });
    }
    
    const collection = db.collection(USER_SEARCH_HISTORY_COLLECTION);
    const allHistory = await collection
      .find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    
    const usersCollection = db.collection(USERS_COLLECTION);
    const users = await usersCollection.find({}).toArray();
    const userMap = new Map(users.map(u => [u.id, sanitizeUser(u)]));
    
    const result = allHistory.map(h => ({
      ...h,
      user: userMap.get(h.userId) || { id: h.userId, username: 'Unknown' }
    }));
    
    res.json({ success: true, allHistory: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== USER ACTIVITY LOGGING ====================

// Helper function to log user activity
async function logUserActivity(userId, action, resource, details = {}) {
  if (!db) return; // Skip logging in in-memory mode
  
  try {
    const collection = db.collection(USER_ACTIVITY_LOG_COLLECTION);
    await collection.insertOne({
      userId,
      action,
      resource,
      details,
      timestamp: new Date().toISOString(),
      ip: details.ip || null
    });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

// Get user activity log (user can see own, admin can see any/all)
app.get('/api/user/activity', authenticateToken, async (req, res) => {
  try {
    const userId = req.query.userId && req.user.role === 'admin' 
      ? req.query.userId 
      : req.user.id;
    const limit = parseInt(req.query.limit) || 100;
    
    if (!db) {
      return res.json({ success: true, activities: [] });
    }
    
    const collection = db.collection(USER_ACTIVITY_LOG_COLLECTION);
    const activities = await collection
      .find(userId ? { userId } : {})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    
    res.json({ success: true, activities });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all users' activities (admin only)
app.get('/api/admin/activities', authenticateToken, authorizeRole('admin'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    
    if (!db) {
      return res.json({ success: true, allActivities: [] });
    }
    
    const collection = db.collection(USER_ACTIVITY_LOG_COLLECTION);
    const allActivities = await collection
      .find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    
    const usersCollection = db.collection(USERS_COLLECTION);
    const users = await usersCollection.find({}).toArray();
    const userMap = new Map(users.map(u => [u.id, sanitizeUser(u)]));
    
    const result = allActivities.map(a => ({
      ...a,
      user: userMap.get(a.userId) || { id: a.userId, username: 'Unknown' }
    }));
    
    res.json({ success: true, allActivities: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== END USER ACTIVITY LOGGING ====================

// ==================== END USER SETTINGS & SEARCH HISTORY ====================

// ==================== TRACE VISUALIZATION ====================

/**
 * Get trace information for a correlation ID
 * Useful for debugging and correlating UI actions with backend traces
 */
app.get('/api/traces/:correlationId', async (req, res) => {
  try {
    const { correlationId } = req.params;
    const traceContext = getTraceContext(correlationId);
    
    if (!traceContext) {
      return res.status(404).json({
        error: 'Trace not found',
        message: `No trace found for correlation ID: ${correlationId}`,
        correlationId,
      });
    }

    // Get OpenTelemetry trace ID if available
    let otelTraceId = null;
    let otelSpanId = null;
    if (traceContext.span) {
      const spanContext = traceContext.span.spanContext();
      otelTraceId = spanContext.traceId;
      otelSpanId = spanContext.spanId;
    }

    res.json({
      correlationId,
      traceId: traceContext.traceId,
      otelTraceId,
      otelSpanId,
      path: traceContext.path,
      method: traceContext.method,
      startTime: traceContext.startTime,
      duration: Date.now() - traceContext.startTime,
      parentSpanId: traceContext.parentSpanId,
      // Links to trace viewers
      links: {
        jaeger: otelTraceId ? `http://localhost:16686/trace/${otelTraceId}` : null,
        tempo: otelTraceId ? `http://localhost:3200/trace/${otelTraceId}` : null,
      },
    });
  } catch (error) {
    console.error('Error fetching trace:', error);
    res.status(500).json({
      error: 'Failed to fetch trace',
      message: error.message,
    });
  }
});

/**
 * List recent traces (from in-memory context)
 * In production, this would query the trace backend (Jaeger/Tempo)
 */
app.get('/api/traces', async (req, res) => {
  try {
    // This is a simplified version - in production, query Jaeger/Tempo API
    res.json({
      message: 'Recent traces endpoint',
      note: 'In production, this would query Jaeger/Tempo API for traces',
      suggestion: 'Use /api/traces/:correlationId to get trace for a specific correlation ID',
      traceViewers: {
        jaeger: 'http://localhost:16686',
        tempo: 'http://localhost:3200',
      },
    });
  } catch (error) {
    console.error('Error listing traces:', error);
    res.status(500).json({
      error: 'Failed to list traces',
      message: error.message,
    });
  }
});

// ==================== END TRACE VISUALIZATION ====================

// GitHub Releases API
app.get('/api/github/releases', asyncHandler(async (req, res) => {
  try {
    const { repo } = req.query;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('token ')) {
      return res.status(401).json({ error: 'GitHub token required in Authorization header' });
    }
    
    const token = authHeader.replace('token ', '');
    
    if (!repo) {
      return res.status(400).json({ error: 'Repository name is required' });
    }
    
    // Fetch releases from GitHub API
    const githubApiUrl = `https://api.github.com/repos/${repo}/releases`;
    const response = await axios.get(githubApiUrl, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    
    res.json({
      releases: response.data || [],
      repo: repo,
    });
  } catch (error) {
    console.error('Error fetching GitHub releases:', error.message);
    if (error.response) {
      return res.status(error.response.status).json({
        error: 'GitHub API error',
        message: error.response.data?.message || error.message,
      });
    }
    res.status(500).json({ error: 'Failed to fetch releases', message: error.message });
  }
}));

// GitHub Tags API
app.get('/api/github/tags', asyncHandler(async (req, res) => {
  try {
    const { repo } = req.query;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('token ')) {
      return res.status(401).json({ error: 'GitHub token required in Authorization header' });
    }
    
    const token = authHeader.replace('token ', '');
    
    if (!repo) {
      return res.status(400).json({ error: 'Repository name is required' });
    }
    
    // Fetch tags from GitHub API with pagination
    let allTags = [];
    let page = 1;
    let hasMore = true;
    const perPage = 100;
    
    while (hasMore) {
      const githubApiUrl = `https://api.github.com/repos/${repo}/git/refs/tags?per_page=${perPage}&page=${page}`;
      const response = await axios.get(githubApiUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      
      const tags = response.data.map((ref) => {
        const tagName = ref.ref.replace('refs/tags/', '');
        return {
          name: tagName,
          sha: ref.object?.sha || '',
          url: ref.url,
          nodeId: ref.node_id,
        };
      });
      
      allTags.push(...tags);
      
      hasMore = response.data.length === perPage;
      page++;
      
      // Safety limit: don't fetch more than 1000 tags per repo
      if (page > 10) {
        console.log(`⚠️  Reached page limit for tags in ${repo}, fetched ${allTags.length} tags`);
        break;
      }
    }
    
    // Also try to get tag details (annotated tags) from /tags endpoint
    // This gives us more info like commit date, author, etc.
    try {
      const tagsEndpoint = `https://api.github.com/repos/${repo}/tags?per_page=100`;
      const tagsResponse = await axios.get(tagsEndpoint, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      
      // Merge tag details with refs data
      const tagsMap = new Map();
      tagsResponse.data.forEach((tag) => {
        tagsMap.set(tag.name, {
          name: tag.name,
          sha: tag.commit?.sha || '',
          zipballUrl: tag.zipball_url,
          tarballUrl: tag.tarball_url,
          commit: tag.commit,
        });
      });
      
      // Enhance allTags with additional info
      allTags = allTags.map(tag => {
        const detailedTag = tagsMap.get(tag.name);
        return {
          ...tag,
          zipballUrl: detailedTag?.zipballUrl || '',
          tarballUrl: detailedTag?.tarballUrl || '',
          commit: detailedTag?.commit || null,
        };
      });
    } catch (tagsErr) {
      console.log(`Note: Could not fetch detailed tag info for ${repo}, using refs only`);
    }
    
    // Sort by name (reverse to show newest first if version-like)
    allTags.sort((a, b) => b.name.localeCompare(a.name));
    
    res.json({
      tags: allTags || [],
      repo: repo,
      count: allTags.length,
    });
  } catch (error) {
    console.error('Error fetching GitHub tags:', error.message);
    if (error.response) {
      return res.status(error.response.status).json({
        error: 'GitHub API error',
        message: error.response.data?.message || error.message,
      });
    }
    res.status(500).json({ error: 'Failed to fetch tags', message: error.message });
  }
}));

// GitHub Branches API
app.get('/api/github/branches', asyncHandler(async (req, res) => {
  try {
    const { repo } = req.query;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('token ')) {
      return res.status(401).json({ error: 'GitHub token required in Authorization header' });
    }
    
    const token = authHeader.replace('token ', '');
    
    if (!repo) {
      return res.status(400).json({ error: 'Repository name is required' });
    }
    
    // Fetch branches from GitHub API with pagination
    let allBranches = [];
    let page = 1;
    let hasMore = true;
    const perPage = 100;
    
    while (hasMore) {
      const githubApiUrl = `https://api.github.com/repos/${repo}/branches?per_page=${perPage}&page=${page}`;
      const response = await axios.get(githubApiUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      
      const branches = response.data.map((branch) => ({
        name: branch.name,
        sha: branch.commit?.sha || '',
        protected: branch.protected || false,
      }));
      
      allBranches.push(...branches);
      
      hasMore = response.data.length === perPage;
      page++;
      
      // Safety limit: don't fetch more than 1000 branches per repo
      if (page > 10) {
        console.log(`⚠️  Reached page limit for branches in ${repo}, fetched ${allBranches.length} branches`);
        break;
      }
    }
    
    // Sort branches: protected/main branches first, then alphabetically
    allBranches.sort((a, b) => {
      if (a.protected && !b.protected) return -1;
      if (!a.protected && b.protected) return 1;
      if (a.name === 'main' || a.name === 'master') return -1;
      if (b.name === 'main' || b.name === 'master') return 1;
      return a.name.localeCompare(b.name);
    });
    
    res.json({
      branches: allBranches || [],
      repo: repo,
      count: allBranches.length,
    });
  } catch (error) {
    console.error('Error fetching GitHub branches:', error.message);
    if (error.response) {
      return res.status(error.response.status).json({
        error: 'GitHub API error',
        message: error.response.data?.message || error.message,
      });
    }
    res.status(500).json({ error: 'Failed to fetch branches', message: error.message });
  }
}));

// GitHub Customers API - Fetch customer names from config file or repository names
app.get('/api/github/customers', asyncHandler(async (req, res) => {
  try {
    const { repo, organization } = req.query;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('token ')) {
      return res.status(401).json({ error: 'GitHub token required in Authorization header' });
    }
    
    const token = authHeader.replace('token ', '');
    
    const headers = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    };
    
    let customers = [];
    
    // Strategy 1: Try to fetch from a config file in a repository
    if (repo) {
      // Try common locations for customer config files
      const configPaths = [
        '.github/customers.json',
        'customers.json',
        '.github/customers.yaml',
        'customers.yaml',
        'config/customers.json',
      ];
      
      for (const configPath of configPaths) {
        try {
          const contentUrl = `https://api.github.com/repos/${repo}/contents/${configPath}`;
          const contentResponse = await axios.get(contentUrl, { headers });
          
          if (contentResponse.data && contentResponse.data.content) {
            // Decode base64 content
            const content = Buffer.from(contentResponse.data.content, 'base64').toString('utf-8');
            
            // Try to parse as JSON
            try {
              const config = JSON.parse(content);
              if (Array.isArray(config)) {
                customers = config;
              } else if (config.customers && Array.isArray(config.customers)) {
                customers = config.customers;
              } else if (config.names && Array.isArray(config.names)) {
                customers = config.names;
              }
              
              if (customers.length > 0) {
                console.log(`✓ Found ${customers.length} customers from ${configPath} in ${repo}`);
                break;
              }
            } catch (parseError) {
              // Try YAML parsing if JSON fails
              if (configPath.endsWith('.yaml') || configPath.endsWith('.yml')) {
                // For now, skip YAML parsing (would need yaml library)
                continue;
              }
            }
          }
        } catch (fileError) {
          // File doesn't exist or not accessible, try next path
          continue;
        }
      }
    }
    
    // Strategy 2: If no config file found, try to get customer names from repository names
    if (customers.length === 0 && organization) {
      try {
        const orgReposUrl = `https://api.github.com/orgs/${organization}/repos?per_page=100&sort=updated`;
        const reposResponse = await axios.get(orgReposUrl, { headers });
        
        // Extract repository names as potential customer names
        // Filter out common non-customer repos (like infrastructure, tools, etc.)
        const excludePatterns = [
          /^\./,
          /^infra/,
          /^tools/,
          /^ci/,
          /^cd/,
          /^docs/,
          /^test/,
          /^example/,
          /^template/,
        ];
        
        customers = reposResponse.data
          .map(repo => repo.name)
          .filter(name => !excludePatterns.some(pattern => pattern.test(name.toLowerCase())))
          .slice(0, 50); // Limit to 50 most recent repos
        
        console.log(`✓ Found ${customers.length} potential customers from organization repositories`);
      } catch (orgError) {
        console.log(`Note: Could not fetch repositories from organization: ${orgError.message}`);
      }
    }
    
    // Strategy 3: If still no customers, return default environment options
    if (customers.length === 0) {
      customers = ['production', 'staging', 'dev', 'qa', 'test', 'preprod'];
      console.log('Using default environment options as customers');
    }
    
    // Remove duplicates and sort
    customers = [...new Set(customers)].sort();
    
    res.json({
      customers: customers,
      source: customers.length > 0 ? (repo ? 'config-file' : 'repositories') : 'default',
      count: customers.length,
    });
  } catch (error) {
    console.error('Error fetching GitHub customers:', error.message);
    if (error.response) {
      return res.status(error.response.status).json({
        error: 'GitHub API error',
        message: error.response.data?.message || error.message,
      });
    }
    // Return default options on error
    res.json({
      customers: ['production', 'staging', 'dev', 'qa', 'test', 'preprod'],
      source: 'default',
      count: 6,
    });
  }
}));

// Create Draft Release API - Requires authentication and admin/manager role
app.post('/api/github/create-release', authenticateToken, authorizeRole('admin', 'manager'), asyncHandler(async (req, res) => {
  try {
    const { repo, tag, branch, name, body, prerelease } = req.body;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Get GitHub token from request body or use the one from user's config
    const githubToken = req.body.githubToken;
    
    if (!repo || !tag) {
      return res.status(400).json({ error: 'Repository and tag are required' });
    }
    
    if (!branch) {
      return res.status(400).json({ error: 'Branch name is required' });
    }
    
    // Log who is creating the release
    console.log(`📦 Creating draft release for ${repo}@${tag} by user: ${req.user.username} (${req.user.role})`);
    console.log(`   Branch: ${branch}, Tag: ${tag}, Name: ${name || tag}`);
    
    // Create draft release via GitHub API
    const githubApiUrl = `https://api.github.com/repos/${repo}/releases`;
    const releaseData = {
      tag_name: tag,
      target_commitish: branch, // The branch to create the release from
      name: name || tag,
      body: body || `Release ${tag} from branch ${branch}`,
      draft: true, // Always create as draft
      prerelease: prerelease || false,
    };
    
    const headers = {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
    
    const response = await axios.post(githubApiUrl, releaseData, { headers });
    
    res.json({
      success: true,
      message: `Draft release created successfully for ${repo}@${tag}`,
      release: {
        id: response.data.id,
        tagName: response.data.tag_name,
        name: response.data.name,
        body: response.data.body,
        draft: response.data.draft,
        prerelease: response.data.prerelease,
        url: response.data.html_url,
        createdAt: response.data.created_at,
      },
      repo: repo,
      tag: tag,
      branch: branch,
    });
  } catch (error) {
    console.error('Error creating draft release:', error.message);
    if (error.response) {
      return res.status(error.response.status).json({
        error: 'GitHub API error',
        message: error.response.data?.message || error.message,
      });
    }
    res.status(500).json({
      error: 'Failed to create draft release',
      message: error.message,
    });
  }
}));

// GitHub Commits/Release Notes API - Fetch commits for a tag and generate release notes
app.get('/api/github/release-notes', asyncHandler(async (req, res) => {
  try {
    const { repo, tag, previousTag } = req.query;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('token ')) {
      return res.status(401).json({ error: 'GitHub token required in Authorization header' });
    }
    
    const token = authHeader.replace('token ', '');
    
    if (!repo || !tag) {
      return res.status(400).json({ error: 'Repository and tag are required' });
    }
    
    // Get the commit SHA for the tag
    let tagSha = null;
    try {
      const tagRefUrl = `https://api.github.com/repos/${repo}/git/refs/tags/${tag}`;
      const tagRefResponse = await axios.get(tagRefUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      tagSha = tagRefResponse.data.object.sha;
    } catch (tagError) {
      // Try alternative endpoint for annotated tags
      try {
        const tagUrl = `https://api.github.com/repos/${repo}/git/tags/${tag}`;
        const tagResponse = await axios.get(tagUrl, {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        });
        tagSha = tagResponse.data.sha;
      } catch (altError) {
        return res.status(404).json({ error: 'Tag not found', message: `Could not find tag ${tag}` });
      }
    }
    
    // Get previous tag SHA if provided
    let previousTagSha = null;
    if (previousTag) {
      try {
        const prevTagRefUrl = `https://api.github.com/repos/${repo}/git/refs/tags/${previousTag}`;
        const prevTagRefResponse = await axios.get(prevTagRefUrl, {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        });
        previousTagSha = prevTagRefResponse.data.object.sha;
      } catch (prevTagError) {
        // Previous tag not found, will fetch all commits up to this tag
        console.log(`Previous tag ${previousTag} not found, fetching all commits`);
      }
    }
    
    // Fetch commits between previous tag and current tag (or all commits up to current tag)
    let allCommits = [];
    let page = 1;
    let hasMore = true;
    const perPage = 100;
    
    while (hasMore) {
      let commitsUrl = `https://api.github.com/repos/${repo}/commits?sha=${tagSha}&per_page=${perPage}&page=${page}`;
      const response = await axios.get(commitsUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      
      const commits = response.data.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message,
        author: commit.commit.author.name,
        authorEmail: commit.commit.author.email,
        date: commit.commit.author.date,
        url: commit.html_url,
      }));
      
      // If we have a previous tag, stop when we reach it
      if (previousTagSha) {
        const prevTagIndex = commits.findIndex(c => c.sha === previousTagSha);
        if (prevTagIndex >= 0) {
          allCommits.push(...commits.slice(0, prevTagIndex));
          break;
        }
      }
      
      allCommits.push(...commits);
      
      hasMore = response.data.length === perPage;
      page++;
      
      // Safety limit: don't fetch more than 500 commits
      if (page > 5) {
        console.log(`⚠️  Reached page limit for commits in ${repo}, fetched ${allCommits.length} commits`);
        break;
      }
    }
    
    // Generate release notes from commits
    const releaseNotes = generateReleaseNotes(allCommits, tag, previousTag);
    
    res.json({
      commits: allCommits,
      releaseNotes: releaseNotes,
      tag: tag,
      previousTag: previousTag || null,
      commitCount: allCommits.length,
    });
  } catch (error) {
    console.error('Error fetching release notes:', error.message);
    if (error.response) {
      return res.status(error.response.status).json({
        error: 'GitHub API error',
        message: error.response.data?.message || error.message,
      });
    }
    res.status(500).json({ error: 'Failed to fetch release notes', message: error.message });
  }
}));

// Helper function to generate release notes from commits
function generateReleaseNotes(commits, tag, previousTag) {
  if (!commits || commits.length === 0) {
    return `## ${tag}\n\nNo commits found for this tag.`;
  }
  
  // Group commits by type (feat, fix, docs, etc.)
  const commitTypes = {
    feat: { title: '✨ Features', commits: [] },
    fix: { title: '🐛 Bug Fixes', commits: [] },
    docs: { title: '📚 Documentation', commits: [] },
    style: { title: '💎 Style', commits: [] },
    refactor: { title: '♻️ Refactoring', commits: [] },
    perf: { title: '⚡ Performance', commits: [] },
    test: { title: '✅ Tests', commits: [] },
    chore: { title: '🔧 Chores', commits: [] },
    other: { title: '📝 Other Changes', commits: [] },
  };
  
  commits.forEach(commit => {
    const message = commit.message.split('\n')[0]; // First line only
    const match = message.match(/^(\w+)(\(.+\))?:\s*(.+)$/);
    
    if (match) {
      const type = match[1].toLowerCase();
      const description = match[3] || message;
      
      if (commitTypes[type]) {
        commitTypes[type].commits.push({ message: description, author: commit.author, sha: commit.sha.substring(0, 7) });
      } else {
        commitTypes.other.commits.push({ message, author: commit.author, sha: commit.sha.substring(0, 7) });
      }
    } else {
      commitTypes.other.commits.push({ message, author: commit.author, sha: commit.sha.substring(0, 7) });
    }
  });
  
  // Build release notes
  let notes = `## ${tag}\n\n`;
  
  if (previousTag) {
    notes += `### Changes since ${previousTag}\n\n`;
  }
  
  // Add sections for each type that has commits
  Object.values(commitTypes).forEach(type => {
    if (type.commits.length > 0) {
      notes += `### ${type.title}\n\n`;
      type.commits.forEach(commit => {
        notes += `- ${commit.message} (${commit.sha}) - @${commit.author}\n`;
      });
      notes += '\n';
    }
  });
  
  notes += `\n**Total commits:** ${commits.length}\n`;
  
  return notes;
}

// Build Tag API - Requires authentication and admin/manager role
app.post('/api/github/build-tag', authenticateToken, authorizeRole('admin', 'manager'), asyncHandler(async (req, res) => {
  try {
    const { repo, tag, branchName, consoleName, githubToken } = req.body;
    
    if (!repo || !tag) {
      return res.status(400).json({ error: 'Repository and tag are required' });
    }
    
    if (!branchName || !consoleName) {
      return res.status(400).json({ error: 'Branch name and console name are required' });
    }
    
    if (!githubToken) {
      return res.status(400).json({ error: 'GitHub token is required' });
    }
    
    // Log who is making the build request
    console.log(`🏗️  Build request for ${repo}@${tag} by user: ${req.user.username} (${req.user.role})`);
    console.log(`   Branch: ${branchName}, Console: ${consoleName}`);
    
    // Here you would integrate with your CI/CD system (Jenkins, GitHub Actions, etc.)
    // For now, we'll return a success message
    // In production, you would:
    // 1. Trigger a build job via API
    // 2. Create a webhook to GitHub Actions
    // 3. Call Jenkins API
    // 4. Or use any other CI/CD system
    
    // Example: You could trigger a GitHub Actions workflow
    // const workflowResponse = await axios.post(
    //   `https://api.github.com/repos/${repo}/actions/workflows/build.yml/dispatches`,
    //   { 
    //     ref: branchName,
    //     inputs: {
    //       tag: tag,
    //       console: consoleName
    //     }
    //   },
    //   { headers: { Authorization: `token ${githubToken}` } }
    // );
    
    res.json({
      success: true,
      message: `Build request queued for ${repo}@${tag} (Branch: ${branchName}, Console: ${consoleName}). Check your CI/CD system for build status.`,
      repo: repo,
      tag: tag,
      branchName: branchName,
      consoleName: consoleName,
    });
  } catch (error) {
    console.error('Error building tag:', error.message);
    res.status(500).json({
      error: 'Failed to trigger build',
      message: error.message,
    });
  }
}));

// ==================== FLOW TRACING API ====================
// Flow tracing endpoints (optional feature, doesn't break existing functionality)
// These endpoints are only active if flow tracing is enabled

// Lazy load flow analyzer (will be loaded on first request if available)
let flowAnalyzerModule = null;
let flowAnalyzerLoaded = false;

async function loadFlowAnalyzer() {
  if (flowAnalyzerLoaded) {
    return flowAnalyzerModule;
  }
  
  try {
    flowAnalyzerModule = await import('./services/flowAnalyzer.js');
    flowAnalyzerLoaded = true;
    console.log('✅ Flow Analyzer service loaded');
    return flowAnalyzerModule;
  } catch (error) {
    flowAnalyzerLoaded = true; // Mark as attempted to avoid repeated tries
    console.log('⚠️  Flow Analyzer service not available (optional feature):', error.message);
    return null;
  }
}

// Flow API endpoints (lazy loaded - always register, check service availability in handler)
// IMPORTANT: Specific routes must come before parameterized routes

// List all operations (must come before /api/flows/:flowId)
app.get('/api/flows/operations', asyncHandler(async (req, res) => {
    try {
      const flowAnalyzer = await loadFlowAnalyzer();
      if (!flowAnalyzer) {
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'Flow Analyzer service is not available',
        });
      }

      const filters = {};

      // Get all flows and extract unique operations
      const flows = flowAnalyzer.getFlowGraphs(filters);
      const operationsMap = new Map();

      flows.forEach(flow => {
        const opName = flow.operationName || 'unknown';
        if (!operationsMap.has(opName)) {
          operationsMap.set(opName, {
            name: opName,
            count: 0,
            lastSeen: 0,
          });
        }
        
        const op = operationsMap.get(opName);
        op.count++;
        op.lastSeen = Math.max(op.lastSeen, flow.startTime || 0);
      });

      const operations = Array.from(operationsMap.values()).map(op => ({
        name: op.name,
        count: op.count,
        lastSeen: op.lastSeen > 0 
          ? new Date(op.lastSeen > 1e12 ? op.lastSeen / 1000000 : op.lastSeen).toISOString() 
          : null,
      }));

      res.json({
        operations: operations.sort((a, b) => b.count - a.count),
        total: operations.length,
      });
    } catch (error) {
      console.error('Error fetching operations:', error);
      res.status(500).json({
        error: 'Failed to fetch operations',
        message: error.message,
      });
    }
  }));

// Get operation statistics (must come before /api/flows/:flowId)
app.get('/api/flows/operations/:operationName/stats', asyncHandler(async (req, res) => {
    try {
      const flowAnalyzer = await loadFlowAnalyzer();
      if (!flowAnalyzer) {
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'Flow Analyzer service is not available',
        });
      }

      const { operationName } = req.params;
      const { startTime, endTime } = req.query;

      const stats = flowAnalyzer.getOperationStats(
        operationName,
        startTime ? parseInt(startTime) : undefined,
        endTime ? parseInt(endTime) : undefined
      );

      if (!stats) {
        return res.status(404).json({
          error: 'Operation not found',
          message: `No data found for operation: ${operationName}`,
        });
      }

      res.json({
        operationName: stats.operationName,
        period: {
          start: startTime ? new Date(parseInt(startTime)).toISOString() : null,
          end: endTime ? new Date(parseInt(endTime)).toISOString() : null,
        },
        stats: {
          totalRequests: stats.totalRequests,
          successCount: stats.successCount,
          errorCount: stats.errorCount,
          avgLatency: stats.avgLatency,
          p50Latency: stats.p50Latency,
          p95Latency: stats.p95Latency,
          p99Latency: stats.p99Latency,
          services: Object.values(stats.services),
        },
      });
    } catch (error) {
      console.error('Error fetching operation stats:', error);
      res.status(500).json({
        error: 'Failed to fetch operation stats',
        message: error.message,
      });
    }
  }));

// Get service dependencies (must come before /api/flows/:flowId)
app.get('/api/flows/dependencies', asyncHandler(async (req, res) => {
    try {
      const flowAnalyzer = await loadFlowAnalyzer();
      if (!flowAnalyzer) {
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'Flow Analyzer service is not available',
        });
      }

      const { namespace, service } = req.query;
      
      const filters = {};
      if (namespace) filters.namespace = namespace;
      if (service) filters.serviceName = service;

      const dependencyGraph = flowAnalyzer.getServiceDependencies(filters);

      res.json({
        ...dependencyGraph,
        metadata: {
          namespace: namespace || 'all',
          service: service || 'all',
          lastUpdated: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('Error fetching dependencies:', error);
      res.status(500).json({
        error: 'Failed to fetch dependencies',
        message: error.message,
      });
    }
  }));

// Get flow graphs
app.get('/api/flows', asyncHandler(async (req, res) => {
    try {
      const flowAnalyzer = await loadFlowAnalyzer();
      if (!flowAnalyzer) {
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'Flow Analyzer service is not available',
        });
      }

      const { operation, startTime, endTime, limit = 20, offset = 0 } = req.query;
      
      const filters = {};
      if (operation) filters.operationName = operation;
      if (startTime) filters.startTime = parseInt(startTime);
      if (endTime) filters.endTime = parseInt(endTime);

      const flows = flowAnalyzer.getFlowGraphs(filters);
      const total = flows.length;
      const paginatedFlows = flows.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

      res.json({
        flows: paginatedFlows,
        total,
        page: Math.floor(parseInt(offset) / parseInt(limit)) + 1,
        pageSize: parseInt(limit),
      });
    } catch (error) {
      console.error('Error fetching flows:', error);
      res.status(500).json({
        error: 'Failed to fetch flows',
        message: error.message,
      });
    }
  }));

// Get specific flow graph (parameterized route - must come last)
app.get('/api/flows/:flowId', asyncHandler(async (req, res) => {
    try {
      const flowAnalyzer = await loadFlowAnalyzer();
      if (!flowAnalyzer) {
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'Flow Analyzer service is not available',
        });
      }

      const { flowId } = req.params;
      // Extract trace ID from flow ID (format: flow-{traceId})
      const traceId = flowId.replace('flow-', '');
      
      const flowGraph = flowAnalyzer.getFlowGraph(traceId);
      
      if (!flowGraph) {
        return res.status(404).json({
          error: 'Flow not found',
          message: `Flow with ID ${flowId} not found`,
        });
      }

      res.json({
        flowId: flowGraph.flowId,
        graph: {
          nodes: flowGraph.nodes,
          edges: flowGraph.edges,
        },
        metadata: flowGraph.metadata,
      });
    } catch (error) {
      console.error('Error fetching flow:', error);
      res.status(500).json({
        error: 'Failed to fetch flow',
        message: error.message,
      });
    }
  }));

// Endpoint to analyze a trace (called by trace collector or manually)
app.post('/api/flows/analyze', asyncHandler(async (req, res) => {
    try {
      const flowAnalyzer = await loadFlowAnalyzer();
      if (!flowAnalyzer) {
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'Flow Analyzer service is not available',
        });
      }

      const { traceData } = req.body;
      
      if (!traceData) {
        return res.status(400).json({
          error: 'Missing trace data',
          message: 'traceData is required in request body',
        });
      }

      const flowGraph = flowAnalyzer.analyzeTrace(traceData);
      
      if (!flowGraph) {
        return res.status(400).json({
          error: 'Failed to analyze trace',
          message: 'Could not extract flow information from trace data',
        });
      }

      res.json({
        success: true,
        flowGraph,
      });
    } catch (error) {
      console.error('Error analyzing trace:', error);
      res.status(500).json({
        error: 'Failed to analyze trace',
        message: error.message,
      });
    }
  }));

console.log('✅ Flow Tracing API endpoints registered (lazy loaded)');

// Manual trace collection trigger
app.post('/api/flows/collect', asyncHandler(async (req, res) => {
  try {
    if (!traceCollector) {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Trace collector is not available',
      });
    }

    // Support namespace parameter in request body
    const { namespace } = req.body;
    if (namespace) {
      await traceCollector.collectTracesForNamespace(namespace);
    } else {
      await traceCollector.collectTracesNow();
    }
    const status = traceCollector.getCollectorStatus();
    
    res.json({
      success: true,
      message: 'Trace collection triggered',
      status,
    });
  } catch (error) {
    console.error('Error triggering trace collection:', error);
    res.status(500).json({
      error: 'Failed to trigger trace collection',
      message: error.message,
    });
  }
}));

// Get trace collector status
app.get('/api/flows/collector/status', asyncHandler(async (req, res) => {
  try {
    if (!traceCollector) {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Trace collector is not available',
      });
    }

    const status = traceCollector.getCollectorStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get collector status',
      message: error.message,
    });
  }
}));

// ==================== END FLOW TRACING API ====================

// Proxy endpoint to check Tempo/Jaeger health (avoids CORS issues)
app.get('/api/tempo/health', asyncHandler(async (req, res) => {
  try {
    const tempoUrl = req.query.url || 'http://localhost:3200';
    const response = await fetch(`${tempoUrl}/ready`, {
      method: 'GET',
      timeout: 5000,
    });
    
    if (response.ok) {
      const text = await response.text();
      res.json({ 
        status: 'ready',
        ready: text.includes('ready') || response.status === 200,
        url: tempoUrl 
      });
    } else {
      res.status(response.status).json({ 
        status: 'not ready',
        ready: false,
        url: tempoUrl 
      });
    }
  } catch (error) {
    res.status(503).json({ 
      status: 'error',
      ready: false,
      error: error.message,
      url: req.query.url || 'http://localhost:3200'
    });
  }
}));

app.get('/api/jaeger/health', asyncHandler(async (req, res) => {
  try {
    const jaegerUrl = req.query.url || 'http://localhost:16686';
    const response = await fetch(`${jaegerUrl}/api/services`, {
      method: 'GET',
      timeout: 5000,
    });
    
    if (response.ok) {
      res.json({ 
        status: 'ready',
        ready: true,
        url: jaegerUrl 
      });
    } else {
      res.status(response.status).json({ 
        status: 'not ready',
        ready: false,
        url: jaegerUrl 
      });
    }
  } catch (error) {
    res.status(503).json({ 
      status: 'error',
      ready: false,
      error: error.message,
      url: req.query.url || 'http://localhost:16686'
    });
  }
}));

// 404 handler for undefined routes (must be after all routes, before error handler)
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Global error handler middleware (must be last, after all routes)
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  console.error('Stack:', err.stack);
  console.error('Request:', req.method, req.path);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Pre-load Flow Analyzer at startup (for better error messages and immediate availability)
let flowAnalyzerPreloaded = false;
try {
  const preloadedFlowAnalyzer = await import('./services/flowAnalyzer.js');
  // Pre-load it into the lazy loader cache
  flowAnalyzerModule = preloadedFlowAnalyzer;
  flowAnalyzerLoaded = true;
  flowAnalyzerPreloaded = true;
  console.log('✅ Flow Analyzer service pre-loaded at startup');
} catch (error) {
  console.log('⚠️  Flow Analyzer service not available (optional feature):', error.message);
}

// Initialize trace collector (if enabled)
let traceCollector = null;
try {
  const traceCollectorModule = await import('./services/traceCollector.js');
  traceCollector = traceCollectorModule;
  await traceCollector.initializeTraceCollector();
} catch (error) {
  console.log('⚠️  Trace collector not available (optional feature):', error.message);
}

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 FlowLens API Server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api`);
  console.log(`💚 Health check: http://localhost:${PORT}/api/health`);
  console.log(`💾 MongoDB: ${MONGODB_URI} (${DB_NAME})`);
  console.log('\nReady to receive requests!');
  
  // Connect to MongoDB (optional). Set SKIP_MONGO=true to suppress connection attempts.
  if (process.env.SKIP_MONGO === 'true') {
    console.log('⚠️  SKIP_MONGO=true set; running in in-memory mode without MongoDB.');
    await initializeDefaultAdmin();
  } else {
    await connectMongoDB();
  }
  
  // Final safety check - ensure we always have at least one user
  if (usersData.length === 0) {
    console.log('⚠️  CRITICAL: No users found after initialization, forcing default admin creation...');
    const initialized = await initializeDefaultAdmin();
    if (!initialized || usersData.length === 0) {
      console.error('❌ CRITICAL ERROR: Failed to initialize default admin user!');
      console.error('❌ Attempting emergency initialization...');
      // Emergency fallback - create user directly
      try {
        const defaultPassword = await bcrypt.hash('admin123', 10);
        usersData.push({
          id: `user-${Date.now()}`,
          username: 'admin',
          email: 'admin@example.com',
          password: defaultPassword,
          role: 'admin',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isActive: true
        });
        console.log('✅ Emergency initialization successful');
      } catch (err) {
        console.error('❌ Emergency initialization failed:', err);
      }
    } else {
      console.log(`✅ Successfully initialized ${usersData.length} user(s)`);
    }
  } else {
    console.log(`✅ User initialization complete: ${usersData.length} user(s) available`);
  }
  
  // Log final state
  console.log(`📊 Final usersData state: ${usersData.length} user(s)`);
  if (usersData.length > 0) {
    console.log(`📊 Users: ${usersData.map(u => u.username).join(', ')}`);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  if (mongoClient) {
    await mongoClient.close();
    console.log('✅ MongoDB connection closed');
  }
  process.exit(0);
});


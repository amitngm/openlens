# FlowLens - System Architecture

## Overview

FlowLens is a unified DevOps platform that consolidates Kubernetes management, GitHub PR tracking, Jira integration, and distributed flow tracing into one comprehensive system with advanced observability capabilities. FlowLens provides complete visibility - see every flow from UI action to database.

## High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              User Interface Layer                            │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Next.js Frontend (Port 3000)                     │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │   │
│  │  │   Dashboard  │  │   Admin      │  │   Kubernetes  │            │   │
│  │  │   (PRs/Jira) │  │   Panel      │  │   Management  │            │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘            │   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │   │
│  │  │   Flow       │  │   Release    │  │   Service     │            │   │
│  │  │   Tracing    │  │   Notes      │  │   Flow        │            │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────┬─────────────────────────────────────┘
                                        │
                                        │ HTTP/REST API
                                        │
┌───────────────────────────────────────▼─────────────────────────────────────┐
│                         API Server Layer (Port 8000)                        │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Express.js API Server                            │   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │   │
│  │  │   GitHub     │  │   Jira       │  │   Kubernetes  │            │   │
│  │  │   Sync       │  │   Sync       │  │   API         │            │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘            │   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │   │
│  │  │   Flow       │  │   OpenTelemetry│ │   Auth       │            │   │
│  │  │   Analyzer   │  │   Tracing    │  │   (JWT)      │            │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────┬─────────────────────────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
                    │                   │                   │
┌───────────────────▼──────┐  ┌────────▼────────┐  ┌───────▼──────────┐
│   External Services       │  │   Data Storage  │  │  Observability   │
│                           │  │                 │  │                  │
│  ┌────────────────────┐  │  │  ┌───────────┐ │  │  ┌────────────┐ │
│  │   GitHub API        │  │  │  │  MongoDB  │ │  │  │  Tempo/    │ │
│  │   (PRs, Repos)      │  │  │  │  (PRs,    │ │  │  │  Jaeger    │ │
│  └────────────────────┘  │  │  │  Users,   │ │  │  │  (Traces)  │ │
│                           │  │  │  Jira,    │ │  │  └────────────┘ │
│  ┌────────────────────┐  │  │  │  Config)  │ │  │                  │
│  │   Jira API         │  │  │  └───────────┘ │  │  ┌────────────┐ │
│  │   (Issues,         │  │  │                 │  │  │  OTel      │ │
│  │   Projects)        │  │  │                 │  │  │  Collector │ │
│  └────────────────────┘  │  │                 │  │  └────────────┘ │
│                           │  │                 │  │                  │
│  ┌────────────────────┐  │  │                 │  │  ┌────────────┐ │
│  │   Kubernetes       │  │  │                 │  │  │  Flow      │ │
│  │   API              │  │  │                 │  │  │  Analyzer  │ │
│  │   (Pods, Deploys,  │  │  │                 │  │  │  Service   │ │
│  │   Services)        │  │  │                 │  │  └────────────┘ │
│  └────────────────────┘  │  │                 │  │                  │
└──────────────────────────┘  └─────────────────┘  └──────────────────┘
```

## Component Architecture

### 1. Frontend Layer (Next.js 14)

**Technology Stack:**
- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- React 18
- ReactFlow (for service diagrams)

**Key Components:**
- **Dashboard**: Main PR and Jira issue management
- **Admin Panel**: User management, RBAC, automation settings
- **Kubernetes Management**: Cluster connection, resource management
- **Flow Visualization**: Service dependency graphs and request flows
- **Release Notes**: Automated release note generation
- **Service Flow Diagram**: Multi-namespace service visualization

**Responsibilities:**
- User interface and interaction
- API communication
- State management
- Authentication and authorization UI
- Real-time data visualization

### 2. API Server Layer (Express.js)

**Technology Stack:**
- Node.js 20
- Express.js
- MongoDB (optional, with in-memory fallback)
- OpenTelemetry for tracing
- Kubernetes Client SDK

**Key Modules:**
- **GitHub Integration**: PR synchronization, repository management
- **Jira Integration**: Issue synchronization, project management
- **Kubernetes Integration**: Resource queries, pod logs, deployments
- **Flow Analyzer**: Trace processing, dependency graph building
- **Authentication**: JWT-based auth with role-based access control
- **Tracing Middleware**: OpenTelemetry instrumentation

**API Endpoints:**
```
/api/health                    - Health check
/api/prs                       - Get PRs with filters
/api/sync/github              - Sync GitHub data
/api/sync/jira                - Sync Jira data
/api/k8s/*                    - Kubernetes resource APIs
/api/flows/*                  - Flow tracing APIs
/api/users/*                  - User management
/api/auth/*                   - Authentication
```

### 3. Data Storage

**MongoDB (Optional):**
- PR data persistence
- User accounts and settings
- Jira issue cache
- Automation configurations
- Kubeconfig storage

**In-Memory Storage (Fallback):**
- Used when MongoDB is unavailable
- Data resets on server restart
- Suitable for development/testing

### 4. External Integrations

**GitHub:**
- Personal Access Token authentication
- Organization and repository access
- PR status tracking
- Webhook support (optional)

**Jira:**
- API token authentication
- Project and issue management
- Status synchronization
- Custom field mapping

**Kubernetes:**
- Kubeconfig-based authentication
- Multi-cluster support
- Resource queries (pods, services, deployments)
- Log streaming
- Event monitoring

### 5. Observability Stack

**OpenTelemetry:**
- Automatic instrumentation
- Trace collection
- Context propagation
- Metadata enrichment

**Trace Storage:**
- Tempo (default)
- Jaeger (alternative)
- OTLP protocol

**Flow Analyzer Service:**
- Trace analysis
- Dependency graph construction
- Flow pattern detection
- Service relationship mapping

## Data Flow

### PR Synchronization Flow

```
User Action → Frontend → API Server → GitHub API
                                    ↓
                              Process & Store
                                    ↓
                              MongoDB/In-Memory
                                    ↓
                              Frontend Update
```

### Flow Tracing Flow

```
UI Event → Frontend → API Server → Microservice
                                    ↓
                              OTel Collector
                                    ↓
                              Trace Store (Tempo/Jaeger)
                                    ↓
                              Flow Analyzer
                                    ↓
                              Flow API
                                    ↓
                              Visualization Dashboard
```

### Kubernetes Resource Flow

```
User Request → Frontend → API Server → Kubernetes API
                                    ↓
                              Resource Query
                                    ↓
                              Process & Format
                                    ↓
                              Return to Frontend
                                    ↓
                              Display in UI
```

## Deployment Architecture

### Development
```
Frontend:  localhost:3000 (Next.js dev server)
API:       localhost:8000 (Node.js)
MongoDB:   localhost:27017 (optional)
Tempo:     localhost:3200 (optional)
```

### Production (Kubernetes)
```
┌─────────────────────────────────────────────────────────┐
│                  Kubernetes Cluster                      │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Frontend   │  │   API        │  │   MongoDB    │ │
│  │   Service    │  │   Service    │  │   StatefulSet │ │
│  │   (Deploy)   │  │   (Deploy)   │  │              │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐                    │
│  │   Tempo      │  │   OTel       │                    │
│  │   StatefulSet│  │   Collector  │                    │
│  └──────────────┘  └──────────────┘                    │
│                                                           │
│  ┌──────────────────────────────────────┐               │
│  │         Ingress Controller           │               │
│  │    (Routes to Frontend/API)          │               │
│  └──────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

## Security Architecture

### Authentication Flow
```
User Login → JWT Token Generation → Token Storage (localStorage)
                                    ↓
                              API Requests with Token
                                    ↓
                              Token Validation
                                    ↓
                              Role-Based Access Control
```

### RBAC Roles
- **Admin**: Full system access
- **Manager**: PR management, automation settings
- **User**: Read-only access, personal settings

## Key Features Architecture

### 1. Multi-Namespace Service Flow Visualization
- Namespace selector with multi-select
- Real-time pod and deployment display
- Service-to-service connection mapping
- Auto-refresh capabilities

### 2. Distributed Tracing
- OpenTelemetry instrumentation
- Trace collection and storage
- Flow graph analysis
- Service dependency visualization

### 3. Automation Management
- Auto-link PRs to Jira
- Status synchronization
- Webhook support
- Custom rule engine

### 4. Release Notes Generation
- Automated note creation
- Customer-specific formatting
- Jira integration
- Version tracking

## Technology Decisions

### Why Next.js?
- Server-side rendering for better performance
- Built-in API routes (though we use separate API server)
- Excellent TypeScript support
- Modern React patterns

### Why Express.js for API?
- Lightweight and flexible
- Large ecosystem
- Easy Kubernetes integration
- Good OpenTelemetry support

### Why MongoDB?
- Flexible schema for PR data
- Good for document storage
- Easy integration with Node.js
- Optional (works without it)

### Why OpenTelemetry?
- Vendor-neutral standard
- Automatic instrumentation
- Rich metadata collection
- Kubernetes-native

## Scalability Considerations

### Horizontal Scaling
- Frontend: Stateless, can scale horizontally
- API: Stateless, can scale horizontally
- MongoDB: Replica sets for read scaling
- Flow Analyzer: Can be scaled independently

### Performance Optimizations
- API response caching
- MongoDB indexing
- Lazy loading of components
- Connection pooling

## Monitoring & Observability

### Metrics
- API response times
- Error rates
- Request counts
- Resource usage

### Logging
- Structured logging
- Error tracking
- Audit logs for admin actions

### Tracing
- Distributed tracing across services
- Flow visualization
- Latency analysis
- Dependency mapping

## Future Enhancements

1. **Service Mesh Integration**: Istio/Linkerd for advanced traffic management
2. **GraphQL API**: More flexible query interface
3. **Real-time Updates**: WebSocket support for live data
4. **Advanced Analytics**: ML-based insights and predictions
5. **Multi-tenancy**: Support for multiple organizations


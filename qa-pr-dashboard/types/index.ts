export interface PRData {
  id: string
  repo: string
  prNumber: number
  title: string
  author: string
  created: string
  assignedTo: string
  qaStatus: 'Pending' | 'In Review' | 'Approved' | 'Rejected'
  mergeStatus: 'Open' | 'Merged' | 'Closed'
  jira: string
  jiraUrl?: string
  jiraStatus?: string
  jiraAssignee?: string
  jiraLabels?: string[]
}

export interface SummaryStats {
  totalActive: number
  pending: number
  inReview: number
  approved: number
  rejected: number
  merged: number
}

export interface JiraSummaryStats {
  totalIssues: number
  toDo: number
  inProgress: number
  qaReady: number
  uatReady: number
  devComplete: number
  reviewMerge: number
  reOpen: number
  duplicate: number
  onHold: number
  rejected: number
  done: number
}

export interface Filters {
  repository: string
  status: string
  view: string
  jira: string
  createdDate: string
  jiraLabel?: string
  page?: number
}

export interface PaginationInfo {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

export interface APIResponse {
  prs: PRData[]
  stats: SummaryStats
  allRepositories?: string[]
  allJiraLabels?: string[]
  pagination?: PaginationInfo
}

export type UserRole = 'admin' | 'manager' | 'viewer'

export interface User {
  id: string
  username: string
  email: string
  role: UserRole
  createdAt: string
  updatedAt: string
  lastLogin?: string
  isActive: boolean
}

export interface LoginCredentials {
  username: string
  password: string
}

export interface AuthSession {
  user: User
  token: string
  expiresAt: number
}

// QA Automation Types
export interface TestRun {
  id: string
  name: string
  status: 'running' | 'passed' | 'failed' | 'skipped' | 'cancelled'
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  duration: number
  startedAt: string
  completedAt?: string
  triggeredBy: string
  environment: string
  framework: 'playwright' | 'selenium' | 'cypress' | 'jest'
  linkedPR?: string
  linkedJira?: string
  reportUrl?: string
  videoUrl?: string
  traceUrl?: string
  testSuite?: string
  errorMessage?: string
}

export interface TestStats {
  totalRuns: number
  passedRuns: number
  failedRuns: number
  skippedRuns: number
  averageDuration: number
  passRate: number
  totalTests: number
  flakyTests: number
  lastRunAt?: string
}

export interface TestCase {
  id: string
  name: string
  description?: string
  suite: string
  framework: 'playwright' | 'selenium' | 'cypress' | 'jest'
  tags?: string[]
  status: 'active' | 'inactive' | 'deprecated'
  lastRun?: string
  lastStatus?: 'passed' | 'failed' | 'skipped'
}

// Time-based Access Grants
export interface AccessGrant {
  id: string
  userId: string
  username: string
  resource: 'kubernetes' | 'admin' | 'automation' | 'flows'
  grantedBy: string
  grantedByUsername: string
  startTime: string
  endTime: string
  isActive: boolean
  createdAt: string
  revokedAt?: string
  revokedBy?: string
  reason?: string
  permissions?: string[] // Specific permissions if needed
}


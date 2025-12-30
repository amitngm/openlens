import axios from 'axios'
import { PRData, SummaryStats, Filters } from '@/types'
import { createTraceHeaders, logUIAction } from './tracing'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api'

const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add trace headers to all axios requests
apiClient.interceptors.request.use((config) => {
  const traceHeaders = createTraceHeaders()
  config.headers = {
    ...(config.headers || {}),
    ...traceHeaders,
  } as any
  return config
})

// Log responses with correlation IDs
apiClient.interceptors.response.use(
  (response) => {
    const correlationId = response.headers['x-request-id'] || response.headers['x-trace-id']
    if (correlationId) {
      console.log(`[${correlationId}] API Response: ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`)
    }
    return response
  },
  (error) => {
    const correlationId = error.response?.headers['x-request-id'] || error.response?.headers['x-trace-id']
    if (correlationId) {
      console.error(`[${correlationId}] API Error: ${error.config?.method?.toUpperCase()} ${error.config?.url} - ${error.message}`)
    }
    return Promise.reject(error)
  }
)

export interface APIResponse {
  prs: PRData[]
  stats: SummaryStats
}

export const checkConnection = async (url: string): Promise<boolean> => {
  const traceHeaders = createTraceHeaders()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

  try {
    // Try health endpoint first
    const healthResponse = await fetch(`${url}/health`, { 
      method: 'GET',
      headers: traceHeaders,
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (healthResponse.ok) {
      return true
    }
  } catch {
    clearTimeout(timeoutId)
    // Health endpoint might not exist, that's okay
  }

  // If health check fails, try a simple GET to the base URL
  const controller2 = new AbortController()
  const timeoutId2 = setTimeout(() => controller2.abort(), 5000)
  
  try {
    const response = await fetch(url, { 
      method: 'GET',
      headers: traceHeaders,
      signal: controller2.signal
    })
    clearTimeout(timeoutId2)
    // Any response (even 404) means server is reachable
    return true
  } catch {
    clearTimeout(timeoutId2)
    return false
  }
}

export const fetchPRs = async (
  filters: Filters,
  apiUrl: string = API_URL
): Promise<APIResponse> => {
  const traceHeaders = createTraceHeaders()
  logUIAction('fetchPRs', { filters, apiUrl })
  
  const response = await fetch(`${apiUrl}/prs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...traceHeaders,
    },
    body: JSON.stringify(filters),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch PRs')
  }

  return response.json()
}

export const syncGitHub = async (
  apiUrl: string = API_URL,
  config?: { token?: string; organization?: string; username?: string; repositories?: string[] }
): Promise<{ success: boolean; message: string }> => {
  const traceHeaders = createTraceHeaders()
  logUIAction('syncGitHub', { apiUrl, organization: config?.organization })
  
  try {
    const response = await fetch(`${apiUrl}/sync/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...traceHeaders,
      },
      body: JSON.stringify(config || {}),
    })

    const data = await response.json().catch(() => ({ message: 'Unknown error' }))

    if (!response.ok) {
      const errorMessage = data.message || data.error || `HTTP ${response.status}: ${response.statusText}`
      throw new Error(errorMessage)
    }

    return { success: true, message: data.message || 'GitHub sync completed successfully' }
  } catch (error: any) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(`Cannot connect to API server at ${apiUrl}. Please check if the server is running.`)
    }
    throw error
  }
}

export const syncJira = async (
  apiUrl: string = API_URL,
  config?: { baseUrl?: string; email?: string; apiToken?: string; projectKey?: string; labels?: string[] }
): Promise<{ success: boolean; message: string }> => {
  const traceHeaders = createTraceHeaders()
  logUIAction('syncJira', { apiUrl, projectKey: config?.projectKey })
  
  try {
    const response = await fetch(`${apiUrl}/sync/jira`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...traceHeaders,
      },
      body: JSON.stringify(config || {}),
    })

    const data = await response.json().catch(() => ({ message: 'Unknown error' }))

    if (!response.ok) {
      const errorMessage = data.message || data.error || `HTTP ${response.status}: ${response.statusText}`
      throw new Error(errorMessage)
    }

    return { success: true, message: data.message || 'Jira sync completed successfully' }
  } catch (error: any) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(`Cannot connect to API server at ${apiUrl}. Please check if the server is running.`)
    }
    throw error
  }
}

export const listJiraProjects = async (
  apiUrl: string = API_URL,
  config?: { baseUrl?: string; email?: string; apiToken?: string }
): Promise<{ success: boolean; projects: Array<{ key: string; name: string; projectType: string; archived: boolean; lead: string }> }> => {
  const traceHeaders = createTraceHeaders()
  logUIAction('listJiraProjects', { apiUrl, baseUrl: config?.baseUrl })
  
  try {
    const response = await fetch(`${apiUrl}/jira/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...traceHeaders,
      },
      body: JSON.stringify(config || {}),
    })

    const data = await response.json().catch(() => ({ message: 'Unknown error' }))

    if (!response.ok) {
      const errorMessage = data.message || data.error || `HTTP ${response.status}: ${response.statusText}`
      throw new Error(errorMessage)
    }

    return { success: true, projects: data.projects || [] }
  } catch (error: any) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(`Cannot connect to API server at ${apiUrl}. Please check if the server is running.`)
    }
    throw error
  }
}

// QA Automation API functions
import { TestRun, TestStats } from '@/types'

export const fetchTestRuns = async (
  apiUrl: string = API_URL,
  filters?: { status?: string; framework?: string; environment?: string; limit?: number; offset?: number }
): Promise<{ success: boolean; testRuns: TestRun[]; total?: number }> => {
  const traceHeaders = createTraceHeaders()
  logUIAction('fetchTestRuns', { apiUrl, filters })
  
  try {
    const queryParams = new URLSearchParams()
    if (filters?.status) queryParams.append('status', filters.status)
    if (filters?.framework) queryParams.append('framework', filters.framework)
    if (filters?.environment) queryParams.append('environment', filters.environment)
    if (filters?.limit) queryParams.append('limit', filters.limit.toString())
    if (filters?.offset) queryParams.append('offset', filters.offset.toString())

    const response = await fetch(`${apiUrl}/qa/test-runs?${queryParams.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...traceHeaders,
      },
    })

    const data = await response.json().catch(() => ({ message: 'Unknown error' }))

    if (!response.ok) {
      const errorMessage = data.message || data.error || `HTTP ${response.status}: ${response.statusText}`
      throw new Error(errorMessage)
    }

    return { success: true, testRuns: data.testRuns || [], total: data.total }
  } catch (error: any) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(`Cannot connect to API server at ${apiUrl}. Please check if the server is running.`)
    }
    throw error
  }
}

export const triggerTestRun = async (
  apiUrl: string = API_URL,
  config: { testSuite: string; environment: string; framework: string; linkedPR?: string; linkedJira?: string }
): Promise<{ success: boolean; testRun: TestRun }> => {
  const traceHeaders = createTraceHeaders()
  logUIAction('triggerTestRun', { apiUrl, testSuite: config.testSuite })
  
  try {
    const response = await fetch(`${apiUrl}/qa/test-runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...traceHeaders,
      },
      body: JSON.stringify(config),
    })

    const data = await response.json().catch(() => ({ message: 'Unknown error' }))

    if (!response.ok) {
      const errorMessage = data.message || data.error || `HTTP ${response.status}: ${response.statusText}`
      throw new Error(errorMessage)
    }

    return { success: true, testRun: data.testRun }
  } catch (error: any) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(`Cannot connect to API server at ${apiUrl}. Please check if the server is running.`)
    }
    throw error
  }
}

export const getTestStats = async (
  apiUrl: string = API_URL,
  timeframe?: string
): Promise<{ success: boolean; stats: TestStats }> => {
  const traceHeaders = createTraceHeaders()
  logUIAction('getTestStats', { apiUrl, timeframe })
  
  try {
    const queryParams = timeframe ? `?timeframe=${timeframe}` : ''
    const response = await fetch(`${apiUrl}/qa/stats${queryParams}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...traceHeaders,
      },
    })

    const data = await response.json().catch(() => ({ message: 'Unknown error' }))

    if (!response.ok) {
      const errorMessage = data.message || data.error || `HTTP ${response.status}: ${response.statusText}`
      throw new Error(errorMessage)
    }

    return { success: true, stats: data.stats }
  } catch (error: any) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(`Cannot connect to API server at ${apiUrl}. Please check if the server is running.`)
    }
    throw error
  }
}

export const cancelTestRun = async (
  apiUrl: string = API_URL,
  runId: string
): Promise<{ success: boolean; message: string }> => {
  const traceHeaders = createTraceHeaders()
  logUIAction('cancelTestRun', { apiUrl, runId })
  
  try {
    const response = await fetch(`${apiUrl}/qa/test-runs/${runId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...traceHeaders,
      },
    })

    const data = await response.json().catch(() => ({ message: 'Unknown error' }))

    if (!response.ok) {
      const errorMessage = data.message || data.error || `HTTP ${response.status}: ${response.statusText}`
      throw new Error(errorMessage)
    }

    return { success: true, message: data.message || 'Test run cancelled successfully' }
  } catch (error: any) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(`Cannot connect to API server at ${apiUrl}. Please check if the server is running.`)
    }
    throw error
  }
}


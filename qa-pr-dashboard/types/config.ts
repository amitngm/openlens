export interface GitHubConfig {
  token: string
  organization?: string
  username?: string
  repositories?: string[]
}

export interface JiraConfig {
  baseUrl: string
  email: string
  apiToken: string
  projectKey: string
  labels?: string[]
}

export interface IntegrationConfig {
  github?: GitHubConfig
  jira?: JiraConfig
}


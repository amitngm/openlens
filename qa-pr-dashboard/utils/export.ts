import * as XLSX from 'xlsx'
import { PRData } from '@/types'

// Jira Issue interface
export interface JiraIssue {
  key: string
  summary: string
  status: string
  assignee: string
  labels: string[]
  created: string
  url: string
  issueType?: string
}

export const exportToExcel = (prs: PRData[], filename: string = 'pr-dashboard.xlsx') => {
  const worksheet = XLSX.utils.json_to_sheet(
    prs.map((pr) => ({
      'Repository': pr.repo,
      'PR Number': pr.prNumber,
      'Title': pr.title,
      'Author': pr.author,
      'Created': pr.created,
      'Assigned To': pr.assignedTo,
      'QA Status': pr.qaStatus,
      'Merge Status': pr.mergeStatus,
      'Jira': pr.jira,
    }))
  )

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Pull Requests')
  XLSX.writeFile(workbook, filename)
}

export const exportToCSV = (prs: PRData[], filename: string = 'pr-dashboard.csv') => {
  const headers = [
    'Repository',
    'PR Number',
    'Title',
    'Author',
    'Created',
    'Assigned To',
    'QA Status',
    'Merge Status',
    'Jira',
  ]

  const rows = prs.map((pr) => [
    pr.repo,
    pr.prNumber,
    pr.title,
    pr.author,
    pr.created,
    pr.assignedTo,
    pr.qaStatus,
    pr.mergeStatus,
    pr.jira,
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)

  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Export Jira issues to Excel
export const exportJiraToExcel = (issues: JiraIssue[], filename: string = 'jira-issues.xlsx') => {
  const worksheet = XLSX.utils.json_to_sheet(
    issues.map((issue) => ({
      'Key': issue.key,
      'Summary': issue.summary,
      'Status': issue.status,
      'Assignee': issue.assignee || 'Unassigned',
      'Labels': issue.labels?.join(', ') || '',
      'Issue Type': issue.issueType || 'Task',
      'Created': issue.created,
      'URL': issue.url,
    }))
  )

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Jira Issues')
  XLSX.writeFile(workbook, filename)
}

// Export Jira issues to CSV
export const exportJiraToCSV = (issues: JiraIssue[], filename: string = 'jira-issues.csv') => {
  const headers = [
    'Key',
    'Summary',
    'Status',
    'Assignee',
    'Labels',
    'Issue Type',
    'Created',
    'URL',
  ]

  const rows = issues.map((issue) => [
    issue.key,
    issue.summary,
    issue.status,
    issue.assignee || 'Unassigned',
    issue.labels?.join(', ') || '',
    issue.issueType || 'Task',
    issue.created,
    issue.url,
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)

  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}


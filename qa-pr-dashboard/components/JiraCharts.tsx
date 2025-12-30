'use client'

import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface JiraIssue {
  key: string
  summary: string
  status: string
  assignee: string
  labels: string[]
  created: string
  issueType?: string
  url: string
}

interface JiraChartsProps {
  issues: JiraIssue[]
}

interface JiraStats {
  total: number
  byStatus: { name: string; value: number; color: string }[]
  byAssignee: { name: string; value: number }[]
  byIssueType: { name: string; value: number; color: string }[]
}

export default function JiraCharts({ issues }: JiraChartsProps) {
  // Calculate stats from issues
  const calculateStats = (): JiraStats => {
    if (!issues || issues.length === 0) {
      return {
        total: 0,
        byStatus: [],
        byAssignee: [],
        byIssueType: [],
      }
    }

    // Status colors based on common Jira statuses
    const getStatusColor = (status: string): string => {
      const statusLower = status?.toLowerCase() || ''
      if (statusLower.includes('done') || statusLower.includes('closed') || statusLower.includes('resolved')) {
        return '#22c55e' // green
      } else if (statusLower.includes('in progress') || statusLower.includes('testing') || statusLower.includes('review')) {
        return '#3b82f6' // blue
      } else if (statusLower.includes('blocked') || statusLower.includes('on hold')) {
        return '#ef4444' // red
      } else if (statusLower.includes('to do') || statusLower.includes('open') || statusLower.includes('new')) {
        return '#f97316' // orange
      }
      return '#6b7280' // gray
    }

    // Count by status
    const statusCount: Record<string, number> = {}
    issues.forEach(issue => {
      const status = issue.status || 'Unknown'
      statusCount[status] = (statusCount[status] || 0) + 1
    })

    const byStatus = Object.entries(statusCount)
      .map(([name, value]) => ({
        name,
        value,
        color: getStatusColor(name),
      }))
      .sort((a, b) => b.value - a.value)

    // Count by assignee
    const assigneeCount: Record<string, number> = {}
    issues.forEach(issue => {
      const assignee = issue.assignee || 'Unassigned'
      assigneeCount[assignee] = (assigneeCount[assignee] || 0) + 1
    })

    const byAssignee = Object.entries(assigneeCount)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10) // Top 10 assignees

    // Count by issue type
    const issueTypeCount: Record<string, number> = {}
    issues.forEach(issue => {
      const issueType = issue.issueType || 'Unknown'
      issueTypeCount[issueType] = (issueTypeCount[issueType] || 0) + 1
    })

    const issueTypeColors: Record<string, string> = {
      'Bug': '#ef4444',
      'Story': '#3b82f6',
      'Task': '#22c55e',
      'Epic': '#a855f7',
      'Sub-task': '#f97316',
    }

    const byIssueType = Object.entries(issueTypeCount)
      .map(([name, value]) => ({
        name,
        value,
        color: issueTypeColors[name] || '#6b7280',
      }))
      .sort((a, b) => b.value - a.value)

    return {
      total: issues.length,
      byStatus,
      byAssignee,
      byIssueType,
    }
  }

  const stats = calculateStats()

  // Custom tooltip for pie chart
  const renderTooltip = (props: any) => {
    if (props.active && props.payload && props.payload.length) {
      const data = props.payload[0]
      const percent = stats.total > 0 ? ((data.value / stats.total) * 100).toFixed(1) : '0'
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold">{data.name}</p>
          <p className="text-sm">
            <span className="font-medium">{data.value}</span> issues ({percent}%)
          </p>
        </div>
      )
    }
    return null
  }

  if (stats.total === 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Jira Issues Charts</h3>
        <div className="h-[300px] flex items-center justify-center text-gray-500">
          No Jira issues available
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-6">Jira Issues Analytics</h3>
        
        {/* Status Distribution - Two charts side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Status Bar Chart */}
          <div>
            <h4 className="text-md font-medium text-gray-700 mb-4">Status Distribution (Bar Chart)</h4>
            {stats.byStatus.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stats.byStatus} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="name" 
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                  />
                  <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} />
                  <Tooltip 
                    formatter={(value: number) => [value, 'Count']}
                    contentStyle={{ 
                      backgroundColor: '#fff', 
                      border: '1px solid #e5e7eb', 
                      borderRadius: '8px',
                      padding: '10px'
                    }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '10px' }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {stats.byStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500">
                No status data available
              </div>
            )}
          </div>

          {/* Status Pie Chart */}
          <div>
            <h4 className="text-md font-medium text-gray-700 mb-4">Status Distribution (Pie Chart)</h4>
            {stats.byStatus.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={stats.byStatus}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={(entry) => {
                      const percent = stats.total > 0 ? ((entry.value / stats.total) * 100).toFixed(0) : '0'
                      return entry.value > 0 ? `${percent}%` : ''
                    }}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {stats.byStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={renderTooltip} />
                  <Legend 
                    formatter={(value) => value}
                    wrapperStyle={{ paddingTop: '20px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500">
                No status data available
              </div>
            )}
          </div>
        </div>

        {/* Issue Type and Assignee Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Issue Type Bar Chart */}
          <div>
            <h4 className="text-md font-medium text-gray-700 mb-4">Issue Type Distribution</h4>
            {stats.byIssueType.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stats.byIssueType} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="name" 
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                  />
                  <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} />
                  <Tooltip 
                    formatter={(value: number) => [value, 'Count']}
                    contentStyle={{ 
                      backgroundColor: '#fff', 
                      border: '1px solid #e5e7eb', 
                      borderRadius: '8px',
                      padding: '10px'
                    }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '10px' }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {stats.byIssueType.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500">
                No issue type data available
              </div>
            )}
          </div>

          {/* Assignee Bar Chart */}
          <div>
            <h4 className="text-md font-medium text-gray-700 mb-4">Top Assignees</h4>
            {stats.byAssignee.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stats.byAssignee} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="name" 
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                  />
                  <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} />
                  <Tooltip 
                    formatter={(value: number) => [value, 'Issues']}
                    contentStyle={{ 
                      backgroundColor: '#fff', 
                      border: '1px solid #e5e7eb', 
                      borderRadius: '8px',
                      padding: '10px'
                    }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '10px' }} />
                  <Bar dataKey="value" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500">
                No assignee data available
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


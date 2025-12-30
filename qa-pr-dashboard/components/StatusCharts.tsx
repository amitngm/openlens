'use client'

import { SummaryStats } from '@/types'
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface StatusChartsProps {
  stats: SummaryStats
}

export default function StatusCharts({ stats }: StatusChartsProps) {
  // Prepare data for bar chart
  const barData = [
    { name: 'Pending', value: stats.pending, color: '#f97316' },
    { name: 'In Review', value: stats.inReview, color: '#3b82f6' },
    { name: 'Approved', value: stats.approved, color: '#22c55e' },
    { name: 'Rejected', value: stats.rejected, color: '#ef4444' },
    { name: 'Merged', value: stats.merged, color: '#a855f7' },
  ].filter(item => item.value > 0) // Only show statuses with values

  // Prepare data for pie chart
  const pieData = [
    { name: 'Pending', value: stats.pending, color: '#f97316' },
    { name: 'In Review', value: stats.inReview, color: '#3b82f6' },
    { name: 'Approved', value: stats.approved, color: '#22c55e' },
    { name: 'Rejected', value: stats.rejected, color: '#ef4444' },
    { name: 'Merged', value: stats.merged, color: '#a855f7' },
  ].filter(item => item.value > 0)

  // Custom tooltip for pie chart
  const renderTooltip = (props: any) => {
    if (props.active && props.payload && props.payload.length) {
      const data = props.payload[0]
      const percent = stats.totalActive > 0 ? ((data.value / stats.totalActive) * 100).toFixed(1) : '0'
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold">{data.name}</p>
          <p className="text-sm">
            <span className="font-medium">{data.value}</span> PRs ({percent}%)
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Bar Chart */}
      <div>
        <h4 className="text-md font-medium text-gray-700 mb-4">PR Status Distribution (Bar Chart)</h4>
        {stats.totalActive > 0 && barData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={barData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
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
                {barData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[300px] flex items-center justify-center text-gray-500">
            No data available
          </div>
        )}
      </div>

      {/* Pie Chart */}
      <div>
        <h4 className="text-md font-medium text-gray-700 mb-4">PR Status Distribution (Pie Chart)</h4>
        {stats.totalActive > 0 && pieData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => {
                  const percent = stats.totalActive > 0 ? ((entry.value / stats.totalActive) * 100).toFixed(0) : '0'
                  return entry.value > 0 ? `${percent}%` : ''
                }}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {pieData.map((entry, index) => (
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
            No data available
          </div>
        )}
      </div>
    </div>
  )
}


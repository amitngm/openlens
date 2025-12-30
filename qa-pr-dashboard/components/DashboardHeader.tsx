import { CheckCircle2 } from 'lucide-react'

interface DashboardHeaderProps {
  apiUrl: string
  onApiUrlChange: (url: string) => void
  onConnect: () => void
  isConnected: boolean
}

export default function DashboardHeader({
  apiUrl,
  onApiUrlChange,
  onConnect,
  isConnected,
}: DashboardHeaderProps) {
  return (
    <div className="mb-4 sm:mb-6 lg:mb-8 space-y-4">
      {/* API Connection Section */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 bg-white/95 backdrop-blur-sm p-4 sm:p-5 rounded-xl shadow-md border border-gray-200/80 hover:shadow-lg transition-all duration-200">
        <label className="text-xs sm:text-sm font-semibold text-gray-700 whitespace-nowrap flex items-center">API URL:</label>
        <input
          type="text"
          value={apiUrl}
          onChange={(e) => onApiUrlChange(e.target.value)}
          className="flex-1 min-w-0 px-4 py-2.5 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all bg-white"
          placeholder="http://localhost:8000/api"
        />
        <button
          onClick={onConnect}
          className="btn-primary text-sm sm:text-base whitespace-nowrap"
        >
          Connect
        </button>
        {isConnected ? (
          <div className="flex items-center gap-2 text-green-600 px-3 py-2 bg-green-50 rounded-lg">
            <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
            <span className="text-xs sm:text-sm font-semibold">Connected</span>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2 text-orange-600 px-3 py-2 bg-orange-50 rounded-lg">
            <span className="text-xs sm:text-sm font-semibold">Not Connected</span>
            <span className="text-xs text-gray-500 hidden sm:inline">(Sync will attempt connection)</span>
          </div>
        )}
      </div>
    </div>
  )
}


import { JiraSummaryStats } from '@/types'
import { 
  FileText, 
  Circle, 
  PlayCircle, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  XCircle,
  RotateCcw,
  Copy,
  Pause,
  CheckSquare,
  GitBranch
} from 'lucide-react'

interface SummaryCardsProps {
  stats: JiraSummaryStats
  selectedStatus?: string | null
  onCardClick?: (status: string | null) => void
}

export default function SummaryCards({ stats, selectedStatus, onCardClick }: SummaryCardsProps) {
  const cards = [
    {
      label: 'Total Issues',
      value: stats.totalIssues,
      bgColor: 'bg-gradient-to-br from-gray-50 to-gray-100',
      textColor: 'text-gray-900',
      borderColor: 'border-gray-200',
      icon: FileText,
      status: null, // null means show all
    },
    {
      label: 'To Do',
      value: stats.toDo,
      bgColor: 'bg-gradient-to-br from-orange-50 to-orange-100',
      textColor: 'text-orange-900',
      borderColor: 'border-orange-200',
      icon: Circle,
      status: 'todo',
    },
    {
      label: 'In Progress',
      value: stats.inProgress,
      bgColor: 'bg-gradient-to-br from-blue-50 to-blue-100',
      textColor: 'text-blue-900',
      borderColor: 'border-blue-200',
      icon: PlayCircle,
      status: 'inprogress',
    },
    {
      label: 'QA',
      value: stats.qaReady,
      bgColor: 'bg-gradient-to-br from-yellow-50 to-yellow-100',
      textColor: 'text-yellow-900',
      borderColor: 'border-yellow-200',
      icon: CheckCircle2,
      status: 'qaready',
    },
    {
      label: 'UAT Ready',
      value: stats.uatReady,
      bgColor: 'bg-gradient-to-br from-amber-50 to-amber-100',
      textColor: 'text-amber-900',
      borderColor: 'border-amber-200',
      icon: Clock,
      status: 'uatready',
    },
    {
      label: 'Dev Complete',
      value: stats.devComplete,
      bgColor: 'bg-gradient-to-br from-teal-50 to-teal-100',
      textColor: 'text-teal-900',
      borderColor: 'border-teal-200',
      icon: CheckSquare,
      status: 'devcomplete',
    },
    {
      label: 'Review & Merge',
      value: stats.reviewMerge,
      bgColor: 'bg-gradient-to-br from-indigo-50 to-indigo-100',
      textColor: 'text-indigo-900',
      borderColor: 'border-indigo-200',
      icon: GitBranch,
      status: 'reviewmerge',
    },
    {
      label: 'Rejected',
      value: stats.rejected,
      bgColor: 'bg-gradient-to-br from-red-50 to-red-100',
      textColor: 'text-red-900',
      borderColor: 'border-red-200',
      icon: XCircle,
      status: 'rejected',
    },
    {
      label: 'Re-Open',
      value: stats.reOpen,
      bgColor: 'bg-gradient-to-br from-pink-50 to-pink-100',
      textColor: 'text-pink-900',
      borderColor: 'border-pink-200',
      icon: RotateCcw,
      status: 'reopen',
    },
    {
      label: 'Duplicate',
      value: stats.duplicate,
      bgColor: 'bg-gradient-to-br from-rose-50 to-rose-100',
      textColor: 'text-rose-900',
      borderColor: 'border-rose-200',
      icon: Copy,
      status: 'duplicate',
    },
    {
      label: 'On Hold',
      value: stats.onHold,
      bgColor: 'bg-gradient-to-br from-gray-50 to-gray-100',
      textColor: 'text-gray-900',
      borderColor: 'border-gray-200',
      icon: Pause,
      status: 'onhold',
    },
    {
      label: 'Done',
      value: stats.done,
      bgColor: 'bg-gradient-to-br from-green-50 to-green-100',
      textColor: 'text-green-900',
      borderColor: 'border-green-200',
      icon: CheckCircle2,
      status: 'done',
    },
  ]

  return (
    <div className="mb-4 lg:mb-6">
      {/* Mobile: Horizontal scroll */}
      <div className="flex gap-2.5 overflow-x-auto pb-2 md:hidden scrollbar-hide -mx-4 sm:-mx-6 px-4 sm:px-6">
        {cards.map((card) => {
          const isSelected = selectedStatus === card.status
          const Icon = card.icon
          return (
            <div
              key={card.label}
              className={`${card.bgColor} ${card.textColor} p-3 sm:p-3.5 rounded-xl shadow-sm border-2 transition-all duration-200 flex-shrink-0 w-28 sm:w-32 flex flex-col ${
                isSelected 
                  ? 'border-primary-500 shadow-lg ring-2 ring-primary-200 scale-105' 
                  : `${card.borderColor} hover:border-primary-300 hover:shadow-md`
              } cursor-pointer hover:scale-105 active:scale-95`}
              onClick={() => onCardClick?.(card.status)}
            >
              <div className="flex items-center justify-between mb-1.5">
                <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${isSelected ? 'text-primary-600' : 'opacity-60'}`} />
                <div className="text-lg sm:text-xl font-bold">{card.value}</div>
              </div>
              <div className="text-[10px] sm:text-xs font-semibold leading-tight line-clamp-2">{card.label}</div>
            </div>
          )
        })}
      </div>
      
      {/* Tablet: 2 columns grid */}
      <div className="hidden md:grid md:grid-cols-2 lg:hidden gap-3">
        {cards.map((card) => {
          const isSelected = selectedStatus === card.status
          const Icon = card.icon
          return (
            <div
              key={card.label}
              className={`${card.bgColor} ${card.textColor} p-4 rounded-xl shadow-sm border-2 transition-all duration-200 ${
                isSelected 
                  ? 'border-primary-500 shadow-lg ring-2 ring-primary-200 scale-[1.02]' 
                  : `${card.borderColor} hover:border-primary-300 hover:shadow-md`
              } cursor-pointer hover:scale-[1.01]`}
              onClick={() => onCardClick?.(card.status)}
            >
              <div className="flex items-center justify-between mb-2">
                <Icon className={`w-5 h-5 ${isSelected ? 'text-primary-600' : 'opacity-60'}`} />
                <div className="text-2xl font-bold">{card.value}</div>
              </div>
              <div className="text-xs font-semibold leading-tight">{card.label}</div>
            </div>
          )
        })}
      </div>
      
      {/* Desktop: Compact grid with better alignment */}
      <div className="hidden lg:grid lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-6 gap-3">
        {cards.map((card) => {
          const isSelected = selectedStatus === card.status
          const Icon = card.icon
          return (
            <div
              key={card.label}
              className={`${card.bgColor} ${card.textColor} p-4 rounded-xl shadow-sm border-2 transition-all duration-200 flex flex-col items-center justify-center text-center relative overflow-hidden group ${
                isSelected 
                  ? 'border-primary-500 shadow-lg ring-2 ring-primary-200 scale-105' 
                  : `${card.borderColor} hover:border-primary-300 hover:shadow-md`
              } cursor-pointer hover:scale-105`}
              onClick={() => onCardClick?.(card.status)}
            >
              {/* Subtle gradient overlay on hover */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200"></div>
              
              <Icon className={`w-5 h-5 mb-2 ${isSelected ? 'text-primary-600' : 'opacity-60'} transition-all duration-200`} />
              <div className="text-2xl xl:text-3xl font-bold mb-1 relative z-10">{card.value}</div>
              <div className="text-xs xl:text-sm font-semibold leading-tight relative z-10">{card.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


import { useEffect } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { TrendingUp } from 'lucide-react'
import { useSnapshot } from '../hooks/useSnapshot'
import type { VelocityData, VelocitySprint } from '../api/client'
import { shortSprintName } from '../utils/format'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

interface VelocityTrendProps {
  /** Pass snapshot velocity directly to skip reading it from the shared poll again. */
  velocity?: VelocityData
  syncIntervalSeconds?: number
  refreshKey?: number
}

export default function VelocityTrend({ velocity, syncIntervalSeconds = 300, refreshKey = 0 }: VelocityTrendProps) {
  const { snapshot } = useSnapshot(syncIntervalSeconds, refreshKey)
  const data = velocity ?? snapshot?.velocity ?? {}

  // Some mobile browsers don't fire a resize after orientation change,
  // leaving Chart.js canvases at their pre-rotation width.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const trigger = () => {
      clearTimeout(timer)
      // Re-dispatch once the new viewport dimensions have settled.
      window.dispatchEvent(new Event('resize'))
      timer = setTimeout(() => window.dispatchEvent(new Event('resize')), 250)
    }
    window.addEventListener('orientationchange', trigger)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('orientationchange', trigger)
    }
  }, [])

  const averageVelocity = (sprints: VelocitySprint[]) => {
    if (!sprints || sprints.length === 0) return 0
    const sum = sprints.reduce((acc, s) => acc + (s.completed_sp || 0), 0)
    return (sum / sprints.length).toFixed(1)
  }

  const chartData = (sprints: VelocitySprint[]): ChartData<'bar'> => {
    const colors = ['#667eea', '#764ba2', '#059669', '#ea8c00', '#dc2626']
    return {
      labels: sprints.map((s) => shortSprintName(s.sprint_key)),
      datasets: [
        {
          label: 'Completed SP',
          data: sprints.map((s) => s.completed_sp || 0),
          backgroundColor: sprints.map((_, i) => colors[i % colors.length]),
          borderRadius: 4,
          maxBarThickness: 40,
        },
      ],
    }
  }

  const chartOptions = (projectKey: string): ChartOptions<'bar'> => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<'bar'>) => {
            const sprint = (data[projectKey] || []).find(
              (s) => shortSprintName(s.sprint_key) === ctx.label,
            )
            if (sprint) {
              return ` ${sprint.completed_sp} SP completed of ${sprint.total_sp} (${sprint.completed_percent}%)`
            }
            return ` ${ctx.parsed.y} SP`
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { precision: 0 },
        grid: { color: '#f3f4f6' },
      },
      x: {
        grid: { display: false },
      },
    },
  })

  return (
    <div className="next-sprint-overview">
      <h2 className="component-title"><TrendingUp size={24} className="title-icon" />VELOCITY TREND</h2>
      <p className="component-subtitle">Throughput of completed sprints per project — use the trend to commit realistically in your next planning.</p>
      {Object.keys(data).length === 0 ? (
        <div className="empty-cell">No completed sprint data available yet.</div>
      ) : (
        <>
          <div className="velocity-project-avg">
            {Object.entries(data).map(([projectKey, sprints]) => (
              <span key={projectKey} className="avg-pill">
                {projectKey} · avg {averageVelocity(sprints)} SP
              </span>
            ))}
          </div>
          <div className="velocity-grid">
            {Object.entries(data).map(([projectKey, sprints]) => (
              <div key={projectKey} className="velocity-project">
                <div className="velocity-project-header">
                  <span className="velocity-project-key">{projectKey}</span>
                </div>
                <div className="bar-chart-wrap">
                  <Bar data={chartData(sprints)} options={chartOptions(projectKey)} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

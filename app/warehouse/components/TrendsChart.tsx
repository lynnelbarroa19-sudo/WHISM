'use client'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

export default function TrendChart() {
  const data = {
    labels: ['Jan','Feb','Mar','Apr','May','Jun'],
    datasets: [
      { label: 'Prediction 1', data: [20,25,22,28,24,26], backgroundColor: '#e53e3e', borderRadius: 3 },
      { label: 'Prediction 2', data: [15,18,16,20,17,19], backgroundColor: '#ed8936', borderRadius: 3 },
      { label: 'Prediction 3', data: [12,14,13,15,12,14], backgroundColor: '#ecc94b', borderRadius: 3 },
      { label: 'Prediction 4', data: [8,10,9,11,9,10],   backgroundColor: '#48bb78', borderRadius: 3 },
      { label: 'Prediction 5', data: [5,6,5,7,5,6],      backgroundColor: '#3b82f6', borderRadius: 3 },
    ]
  }
  const options = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { stacked: true, ticks: { color: '#6b7280' }, grid: { display: false } },
      y: { stacked: true, ticks: { color: '#6b7280' }, grid: { color: 'rgba(0,0,0,0.05)' } }
    }
  }

  return (
    <div className="bg-white dark:bg-[#161d17] border border-gray-200 dark:border-[#2a3a2a] rounded-xl p-4">
      <p className="text-green-800 dark:text-[#7aba7a] font-medium text-sm mb-1">Medicine Stock Trends</p>
      <p className="text-sm font-medium text-gray-700 dark:text-[#c0d8c0] mb-3">Month</p>
      <Bar data={data} options={options} />
      <div className="flex flex-col gap-1 mt-3">
        {[['#e53e3e','Prediction 1'],['#ed8936','Prediction 2'],['#ecc94b','Prediction 3'],['#48bb78','Prediction 4'],['#3b82f6','Prediction 5']].map(([c, l]) => (
          <div key={l} className="flex items-center gap-2 text-xs text-gray-500 dark:text-[#7a9a7a]">
            <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: c }}></div>
            {l} <span className="ml-auto">00%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
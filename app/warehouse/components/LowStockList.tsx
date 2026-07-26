'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Medicine {
  med_name: string
  quantity: number
}

const colors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#ecc94b']

export default function LowStockList() {
  const [items, setItems] = useState<Medicine[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLowStock()
  }, [])

  const fetchLowStock = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('warehouse_medicines')
      .select('med_name, quantity')
      .eq('archived', false)
      .order('quantity', { ascending: true })
      .limit(4)

    setItems(data || [])
    setLoading(false)
  }

  return (
    <div className="bg-green-800 dark:bg-[#0d3d1a] rounded-xl p-4 flex flex-col">
      <p className="text-white font-medium text-xs mb-4 text-center uppercase tracking-wide">
        Lowest Medicine Stock
      </p>
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-white/60 text-xs">Loading...</p>
        </div>
      ) : items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-2 text-white text-sm font-medium">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: colors[i] }}></span>
              <span className="flex-1 truncate">{item.med_name}</span>
              <span className="ml-auto">{item.quantity}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-white/60 text-xs text-center">No medicines added yet</p>
        </div>
      )}
    </div>
  )
}
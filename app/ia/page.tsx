'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AppShell from '../AppShell'
import { FaBrain, FaRobot, FaChartLine, FaExclamationTriangle, FaCheckCircle, FaSync } from 'react-icons/fa'

export default function IAPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    setLoading(true)

    const { data, error } = await supabase
      .from('watchlist')
      .select('*')
      .order('ai_probability', { ascending: false })

    if (error) {
      console.error('Error IA:', error)
      setLoading(false)
      return
    }

    setData(data || [])
    setLoading(false)
  }

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      setLoading(true)

      const { data, error } = await supabase
        .from('watchlist')
        .select('*')
        .order('ai_probability', { ascending: false })

      if (!isMounted) return

      if (error) {
        console.error('Error IA:', error)
      } else {
        setData(data || [])
      }

      setLoading(false)
    }

    load()
    const interval = setInterval(load, 60000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [])

  // Función para definir colores según probabilidad
  const getSignalStyle = (prob: number) => {
    if (prob >= 80) return 'bg-green-500/10 text-green-400 border-green-500/50'
    if (prob >= 65) return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/50'
    return 'bg-gray-500/10 text-gray-400 border-gray-500/50'
  }

  return (
    <AppShell>
      <div className="p-4 max-w-6xl mx-auto min-h-screen pb-20">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-8 bg-zinc-900/50 p-6 rounded-2xl border border-white/5">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
              <FaBrain className="text-blue-500" /> IA Trading Signals
            </h1>
            <p className="text-zinc-400 mt-1">Análisis predictivo basado en RSI, EMA y Distancia a Target</p>
          </div>
          <button 
            onClick={fetchData}
            disabled={loading}
            className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-full transition-all border border-white/10"
          >
            <FaSync className={`${loading ? 'animate-spin text-blue-400' : 'text-zinc-400'}`} />
          </button>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.map((item) => (
            <div 
              key={item.id} 
              className="bg-zinc-900 border border-white/5 rounded-2xl p-5 hover:border-blue-500/30 transition-all group overflow-hidden relative"
            >
              {item.ai_probability > 80 && (
                <div className="absolute -top-10 -right-10 w-24 h-24 bg-green-500/10 rounded-full blur-2xl group-hover:bg-green-500/20 transition-all" />
              )}

              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-2xl font-black text-white tracking-tight">{item.ticker}</h2>
                  <span className="text-xs text-zinc-500 font-mono">ID: #{item.id}</span>
                </div>
                <div className={`px-3 py-1 rounded-lg border text-xs font-bold uppercase tracking-wider ${getSignalStyle(item.ai_probability)}`}>
                  {item.ai_signal || 'SIN SEÑAL'}
                </div>
              </div>

              {/* Precios */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                  <p className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Precio Actual</p>
                  <p className="text-lg font-semibold text-white">
                    {item.current_price ? `$${item.current_price.toFixed(2)}` : '---'}
                  </p>
                </div>
                <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                  <p className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Tu Target</p>
                  <p className="text-lg font-semibold text-blue-400">
                    {item.buy_target ? `$${item.buy_target.toFixed(2)}` : '---'}
                  </p>
                </div>
              </div>

              {/* Indicadores */}
              <div className="space-y-3 mb-6">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-zinc-400 flex items-center gap-2"><FaChartLine className="text-[10px]" /> RSI (14)</span>
                  <span className={`font-mono font-bold ${item.rsi < 30 ? 'text-green-400' : item.rsi > 70 ? 'text-red-400' : 'text-white'}`}>
                    {item.rsi ? item.rsi.toFixed(2) : '---'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-zinc-400 flex items-center gap-2"><FaRobot className="text-[10px]" /> EMA 20</span>
                  <span className="text-white font-mono">
                    {item.ema20 ? item.ema20.toFixed(2) : '---'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-zinc-400 flex items-center gap-2"><FaExclamationTriangle className="text-[10px]" /> Volatilidad</span>
                  <span className="text-white font-mono">
                    {item.volatility ? `${item.volatility.toFixed(2)}%` : '---'}
                  </span>
                </div>
              </div>

              {/* IA */}
              <div className="mt-4 pt-4 border-t border-white/5">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-xs font-bold text-zinc-500 uppercase">Confianza IA</span>
                  <span className="text-2xl font-black text-white">
                    {item.ai_probability ? `${item.ai_probability}%` : '---'}
                  </span>
                </div>
                
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-1000 ${
                      item.ai_probability > 80 ? 'bg-green-500' : item.ai_probability > 65 ? 'bg-yellow-500' : 'bg-blue-600'
                    }`}
                    style={{ width: `${item.ai_probability || 0}%` }}
                  />
                </div>
                
                <p className="text-[10px] text-center mt-3 text-zinc-600 italic">
                  * Score técnico: {item.ai_score}
                </p>
              </div>
            </div>
          ))}
        </div>

        {!loading && data.length === 0 && (
          <div className="text-center py-20 bg-zinc-900/50 rounded-3xl border border-dashed border-white/10">
            <FaRobot className="mx-auto text-5xl text-zinc-700 mb-4" />
            <h3 className="text-white font-bold">No hay datos de IA disponibles</h3>
            <p className="text-zinc-500 text-sm">Asegúrate de que el Cron Job esté funcionando correctamente.</p>
          </div>
        )}
      </div>
    </AppShell>
  )
}
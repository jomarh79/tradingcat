'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AppShell from '../AppShell'
import { FaBrain, FaRobot, FaChartLine, FaExclamationTriangle, FaSync } from 'react-icons/fa'

export default function IAPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false) // 🔥 Nuevo

  // Usamos una función estable para cargar datos
  const loadData = async () => {
    try {
      const { data: watchlist, error } = await supabase
        .from('watchlist')
        .select('*')
        .order('ai_probability', { ascending: false })

      if (error) throw error
      setData(watchlist || [])
    } catch (err) {
      console.error('Error cargando IA:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setMounted(true) // 🔥 Marcamos como montado
    loadData()
    const interval = setInterval(loadData, 60000)
    return () => clearInterval(interval)
  }, [])

  const getSignalStyle = (prob: number) => {
    if (prob >= 80) return 'bg-green-500/10 text-green-400 border-green-500/50'
    if (prob >= 65) return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/50'
    return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/50'
  }

  // 🔥 Evita el error de hidratación devolviendo null hasta que esté montado
  if (!mounted) return null

  return (
    <AppShell>
      <div className="p-4 max-w-6xl mx-auto min-h-screen pb-20">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-8 bg-zinc-900/50 p-6 rounded-2xl border border-white/5">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3 text-white leading-none">
              <FaBrain className="text-blue-500" /> IA Trading Signals
            </h1>
            <p className="text-zinc-400 mt-2 text-sm">Análisis predictivo basado en indicadores técnicos y targets</p>
          </div>
          <button 
            onClick={loadData}
            disabled={loading}
            className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-full transition-all border border-white/10 disabled:opacity-50"
          >
            <FaSync className={`${loading ? 'animate-spin text-blue-400' : 'text-zinc-400'}`} />
          </button>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.map((item) => (
            <div 
              key={item.id} 
              className="bg-zinc-900 border border-white/5 rounded-2xl p-5 hover:border-blue-500/30 transition-all group overflow-hidden relative shadow-xl"
            >
              {/* Glow effect para probabilidades altas */}
              {(item.ai_probability || 0) > 80 && (
                <div className="absolute -top-10 -right-10 w-24 h-24 bg-green-500/10 rounded-full blur-2xl group-hover:bg-green-500/20 transition-all" />
              )}

              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-2xl font-black text-white tracking-tight leading-none">
                    {item.ticker?.toUpperCase()}
                  </h2>
                  <p className="text-[10px] text-zinc-500 font-mono mt-1 uppercase tracking-widest">Prediction Engine v1.0</p>
                </div>
                <div className={`px-3 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider ${getSignalStyle(item.ai_probability || 0)}`}>
                  {item.ai_signal || 'WAITING'}
                </div>
              </div>

              {/* Precios */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                  <p className="text-[9px] text-zinc-500 uppercase font-bold mb-1 tracking-tighter">Current Price</p>
                  <p className="text-lg font-semibold text-white">
                    {item.current_price ? `$${Number(item.current_price).toFixed(2)}` : '---'}
                  </p>
                </div>
                <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                  <p className="text-[9px] text-zinc-500 uppercase font-bold mb-1 tracking-tighter">Buy Target</p>
                  <p className="text-lg font-semibold text-blue-400">
                    {item.buy_target ? `$${Number(item.buy_target).toFixed(2)}` : '---'}
                  </p>
                </div>
              </div>

              {/* Indicadores */}
              <div className="space-y-3 mb-6 bg-zinc-950/30 p-3 rounded-xl border border-white/5">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-zinc-500 flex items-center gap-2"><FaChartLine className="text-[10px]" /> RSI (14)</span>
                  <span className={`font-mono font-bold ${(item.rsi || 0) < 35 ? 'text-green-400' : (item.rsi || 0) > 65 ? 'text-red-400' : 'text-zinc-300'}`}>
                    {item.rsi ? Number(item.rsi).toFixed(2) : '--'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-zinc-500 flex items-center gap-2"><FaRobot className="text-[10px]" /> EMA (20)</span>
                  <span className="text-zinc-300 font-mono">
                    {item.ema20 ? Number(item.ema20).toFixed(2) : '--'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-zinc-500 flex items-center gap-2"><FaExclamationTriangle className="text-[10px]" /> Volatility</span>
                  <span className="text-zinc-300 font-mono">
                    {item.volatility ? `${Number(item.volatility).toFixed(2)}%` : '--'}
                  </span>
                </div>
              </div>

              {/* IA Confidence Bar */}
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">AI Confidence</span>
                  <span className="text-xl font-black text-white">
                    {item.ai_probability ? `${item.ai_probability}%` : '0%'}
                  </span>
                </div>
                
                <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-1000 ${
                      (item.ai_probability || 0) > 80 ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 
                      (item.ai_probability || 0) > 65 ? 'bg-yellow-500' : 'bg-blue-600'
                    }`}
                    style={{ width: `${item.ai_probability || 0}%` }}
                  />
                </div>
                
                <div className="flex justify-between mt-3">
                   <p className="text-[9px] text-zinc-600 italic">Score: {item.ai_score || 0} pts</p>
                   <p className="text-[9px] text-zinc-600 font-mono tracking-tighter uppercase">Last Analysis: Live</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {!loading && data.length === 0 && (
          <div className="text-center py-20 bg-zinc-900/50 rounded-3xl border border-dashed border-white/10">
            <FaRobot className="mx-auto text-5xl text-zinc-700 mb-4" />
            <h3 className="text-white font-bold tracking-tight">No data available</h3>
            <p className="text-zinc-500 text-sm mt-1">Wait for the next engine update cycle.</p>
          </div>
        )}
      </div>
    </AppShell>
  )
}

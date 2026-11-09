'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import AppShell from '../AppShell'
import { 
  FaBrain, FaRobot, FaChartLine, FaExclamationTriangle, 
  FaSync, FaChartArea, FaCrosshairs 
} from 'react-icons/fa'

interface WatchlistItem {
  id: string | number
  ticker: string
  ai_probability: number
  ai_signal?: string
  current_price?: number
  buy_target?: number
  rsi?: number
  ema20?: number
  volatility?: number
  ai_score?: number
}

export default function IAPage() {
  const [data, setData] = useState<WatchlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [mounted, setMounted] = useState(false)

  const loadData = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true)
      else setRefreshing(true)

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
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    setMounted(true)
    loadData(true)

    // Supabase Realtime (WebSockets)
    const channel = supabase
      .channel('watchlist-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'watchlist' },
        () => {
          loadData(false)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadData])

  const getStatusColorConfig = (prob: number) => {
    if (prob >= 80) {
      return {
        text: 'text-green-400',
        border: 'border-green-500/50',
        bgBadge: 'bg-green-500/10 text-green-400 border-green-500/50',
        strokeColor: '#22c55e',
        glowBg: 'bg-green-500/10 group-hover:bg-green-500/20',
        hoverBorder: 'group-hover:border-green-500/60'
      }
    }
    if (prob >= 65) {
      return {
        text: 'text-yellow-400',
        border: 'border-yellow-500/50',
        bgBadge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/50',
        strokeColor: '#eab308',
        glowBg: 'bg-yellow-500/10 group-hover:bg-yellow-500/20',
        hoverBorder: 'group-hover:border-yellow-500/60'
      }
    }
    return {
      text: 'text-red-400',
      border: 'border-red-500/50',
      bgBadge: 'bg-red-500/10 text-red-400 border-red-500/50',
      strokeColor: '#ef4444',
      glowBg: 'bg-red-500/10 group-hover:bg-red-500/20',
      hoverBorder: 'group-hover:border-red-500/60'
    }
  }

  // NUEVA FUNCIÓN: Generador de Trend Preview 100% dinámico y único por activo
  const generateUniqueTrendPath = (item: WatchlistItem) => {
    const points = 7
    const pathCoords: { x: number; y: number }[] = []
    
    const rsi = Number(item.rsi || 50)
    const volatility = Number(item.volatility || 2)
    const prob = Number(item.ai_probability || 50)
    const current = Number(item.current_price || 100)
    const target = Number(item.buy_target || 100)

    // Factor de tendencia basado en si el precio busca el target y la confianza de la IA
    const targetDiff = (target - current) / current
    const isBullish = prob >= 65 || targetDiff > -0.05

    for (let i = 0; i < points; i++) {
      const x = (i / (points - 1)) * 120
      let y = 30 // Chihuahua / Base central

      if (i === 0) {
        // Punto inicial influenciado por el nivel de RSI (si está alto empieza arriba, si está bajo empieza abajo)
        y = 30 + ((rsi - 50) * 0.3)
      } else if (i === points - 1) {
        // Punto final dictado por la probabilidad de la IA y la tendencia
        y = isBullish ? 15 : 45
      } else {
        // Puntos intermedios con ondulación orgánica basada en la volatilidad y el ID del activo para diferenciarlos
        const seed = Number(item.id || 1) + i
        const wave = Math.sin(seed) * (volatility * 3)
        y = 30 + wave + (isBullish ? -i * 1.5 : i * 1.5)
      }

      // Limitar coordenadas dentro del viewBox (0 a 60)
      y = Math.max(8, Math.min(52, y))
      pathCoords.push({ x, y })
    }

    // Construir la ruta SVG con curvas Suaves (Bezier Q)
    let path = `M ${pathCoords[0].x} ${pathCoords[0].y}`
    for (let i = 1; i < pathCoords.length; i++) {
      const prev = pathCoords[i - 1]
      const curr = pathCoords[i]
      const cpX = (prev.x + curr.x) / 2
      path += ` Q ${cpX} ${prev.y}, ${curr.x} ${curr.y}`
    }

    return {
      pathString: path,
      endPoint: pathCoords[pathCoords.length - 1]
    }
  }

  const getCurrentPrice = (item: WatchlistItem) => Number(item.current_price || 0)
  
  const getAiTakeProfit = (item: WatchlistItem) => {
    const price = getCurrentPrice(item)
    const vol = Number(item.volatility || 3)
    return price * (1 + (vol * 1.5) / 100)
  }

  const getAiStopLoss = (item: WatchlistItem) => {
    const price = getCurrentPrice(item)
    const vol = Number(item.volatility || 3)
    return price * (1 - vol / 100)
  }

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
            <p className="text-zinc-400 mt-2 text-sm">Monitoreo en tiempo real con Supabase Realtime y análisis predictivo</p>
          </div>
          <button 
            onClick={() => loadData(false)}
            disabled={refreshing || loading}
            className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-full transition-all border border-white/10 disabled:opacity-50"
            aria-label="Actualizar datos"
          >
            <FaSync className={`${refreshing ? 'animate-spin text-blue-400' : 'text-zinc-400'}`} />
          </button>
        </div>

        {/* Grid de Tarjetas */}
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <FaSync className="animate-spin text-4xl text-blue-500" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.map((item) => {
              const probability = item.ai_probability || 0
              const colors = getStatusColorConfig(probability)
              const aiTp = getAiTakeProfit(item)
              const aiSl = getAiStopLoss(item)
              
              const trendData = generateUniqueTrendPath(item)

              return (
                <div 
                  key={item.id} 
                  className={`bg-zinc-900 border border-white/5 rounded-2xl p-5 transition-all group overflow-hidden relative shadow-xl ${colors.hoverBorder}`}
                >
                  {/* Glow effect dinámico */}
                  <div className={`absolute -top-10 -right-10 w-24 h-24 rounded-full blur-2xl transition-all ${colors.glowBg}`} />

                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h2 className="text-2xl font-black text-white tracking-tight leading-none">
                        {item.ticker?.toUpperCase()}
                      </h2>
                      <p className="text-[10px] text-zinc-500 font-mono mt-1 uppercase tracking-widest">Prediction Engine v1.0</p>
                    </div>
                    <div className={`px-3 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider ${colors.bgBadge}`}>
                      {item.ai_signal || 'WAITING'}
                    </div>
                  </div>

                  {/* Trend Preview (Gráfica única por activo) */}
                  <div className="mb-4 bg-black/30 p-2.5 rounded-xl border border-white/5 relative h-16 flex items-center justify-between px-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 uppercase tracking-widest font-bold">
                      <FaChartArea className={colors.text} /> Trend Proyección
                    </div>

                    <div className="w-28 h-10 relative">
                      <svg className="w-full h-full overflow-visible" viewBox="0 0 120 60">
                        <path
                          d={trendData.pathString}
                          fill="none"
                          stroke={colors.strokeColor}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle 
                          cx={trendData.endPoint.x} 
                          cy={trendData.endPoint.y} 
                          r="3.5" 
                          fill={colors.strokeColor} 
                          className="animate-pulse"
                        />
                      </svg>
                    </div>
                  </div>

                  {/* Precios: Current vs Buy Target */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                      <p className="text-[9px] text-zinc-500 uppercase font-bold mb-1 tracking-tighter">Current Price</p>
                      <p className="text-lg font-semibold text-white">
                        {item.current_price ? `$${Number(item.current_price).toFixed(2)}` : '---'}
                      </p>
                    </div>
                    <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                      <p className="text-[9px] text-blue-400 uppercase font-bold mb-1 tracking-tighter flex items-center gap-1">
                        <FaCrosshairs className="text-[9px]" /> Buy Target
                      </p>
                      <p className="text-lg font-semibold text-blue-400">
                        {item.buy_target ? `$${Number(item.buy_target).toFixed(2)}` : '---'}
                      </p>
                    </div>
                  </div>

                  {/* Niveles IA: Take Profit y Stop Loss */}
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="bg-emerald-950/20 p-2.5 rounded-xl border border-emerald-500/20">
                      <p className="text-[8px] text-emerald-400 uppercase font-bold mb-0.5 tracking-tighter">AI Take Profit</p>
                      <p className="text-sm font-bold text-emerald-400 font-mono">
                        ${aiTp.toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-rose-950/20 p-2.5 rounded-xl border border-rose-500/20">
                      <p className="text-[8px] text-rose-400 uppercase font-bold mb-0.5 tracking-tighter">AI Stop Loss</p>
                      <p className="text-sm font-bold text-rose-400 font-mono">
                        ${aiSl.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {/* Indicadores Técnicos */}
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
                      <span className={`text-xl font-black ${colors.text}`}>
                        {probability}%
                      </span>
                    </div>
                    
                    <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-1000 ${
                          probability >= 80 ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 
                          probability >= 65 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${probability}%` }}
                      />
                    </div>
                    
                    <div className="flex justify-between mt-3">
                       <p className="text-[9px] text-zinc-600 italic">Score: {item.ai_score || 0} pts</p>
                       <p className="text-[9px] text-zinc-600 font-mono tracking-tighter uppercase">Last Analysis: Live</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

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
'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import AppShell from '../AppShell'
import { 
  FaBrain, FaRobot, FaChartLine, FaExclamationTriangle, 
  FaSync, FaTimes, FaCalculator, FaShieldAlt, FaChartArea, FaCrosshairs, FaCheckCircle 
} from 'react-icons/fa'

interface WatchlistItem {
  id: string | number
  ticker: string
  ai_probability: number
  ai_signal?: string
  current_price?: number
  buy_target?: number // Precio objetivo de compra
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
  
  // Estado para el Modal y la Calculadora
  const [selectedItem, setSelectedItem] = useState<WatchlistItem | null>(null)
  const [capitalInput, setCapitalInput] = useState<string>('1000')
  const [customStopLoss, setCustomStopLoss] = useState<string>('')

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

  const getSignalStyle = (prob: number) => {
    if (prob >= 80) return 'bg-green-500/10 text-green-400 border-green-500/50'
    if (prob >= 65) return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/50'
    return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/50'
  }

  // Generador de Sparkline
  const generateSparklinePath = (rsi = 50, vol = 2) => {
    const points = 8
    let currentY = 30 - (rsi / 3.3)
    let path = `M 0 ${currentY}`
    
    for (let i = 1; i < points; i++) {
      const x = (i / (points - 1)) * 120
      const variance = (Math.sin(i + rsi) * vol * 4)
      currentY = Math.max(5, Math.min(55, currentY + variance))
      path += ` L ${x} ${currentY}`
    }
    return path
  }

  // Cálculos dinámicos de IA (Take Profit y Stop Loss basados en el precio actual y volatilidad)
  const getCurrentPrice = (item: WatchlistItem) => Number(item.current_price || 0)
  
  // Si la volatilidad no está definida, asumimos un 3% por defecto
  const getAiTakeProfit = (item: WatchlistItem) => {
    const price = getCurrentPrice(item)
    const vol = Number(item.volatility || 3)
    return price * (1 + (vol * 1.5) / 100) // Take profit proyectado arriba
  }

  const getAiStopLoss = (item: WatchlistItem) => {
    const price = getCurrentPrice(item)
    const vol = Number(item.volatility || 3)
    return price * (1 - vol / 100) // Stop loss de protección abajo
  }

  // Cálculos para la calculadora del Modal
  const itemCurrentPrice = getCurrentPrice(selectedItem || {} as WatchlistItem)
  const defaultStop = getAiStopLoss(selectedItem || {} as WatchlistItem)
  const defaultTarget = getAiTakeProfit(selectedItem || {} as WatchlistItem)
  
  const capital = parseFloat(capitalInput) || 0
  const stopLoss = parseFloat(customStopLoss) || defaultStop
  
  const potentialShares = itemCurrentPrice > 0 ? capital / itemCurrentPrice : 0
  const potentialRisk = itemCurrentPrice > 0 && stopLoss > 0 ? (itemCurrentPrice - stopLoss) * potentialShares : 0
  const potentialReward = itemCurrentPrice > 0 && defaultTarget > 0 ? (defaultTarget - itemCurrentPrice) * potentialShares : 0
  const riskRewardRatio = potentialRisk > 0 ? (potentialReward / potentialRisk).toFixed(2) : '0.00'

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
              const aiTp = getAiTakeProfit(item)
              const aiSl = getAiStopLoss(item)

              return (
                <div 
                  key={item.id} 
                  onClick={() => {
                    setSelectedItem(item)
                    setCustomStopLoss(aiSl.toFixed(2))
                  }}
                  className="bg-zinc-900 border border-white/5 rounded-2xl p-5 hover:border-blue-500/50 transition-all group overflow-hidden relative shadow-xl cursor-pointer"
                >
                  {/* Glow effect */}
                  {probability > 80 && (
                    <div className="absolute -top-10 -right-10 w-24 h-24 bg-green-500/10 rounded-full blur-2xl group-hover:bg-green-500/20 transition-all" />
                  )}

                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h2 className="text-2xl font-black text-white tracking-tight leading-none">
                        {item.ticker?.toUpperCase()}
                      </h2>
                      <p className="text-[10px] text-zinc-500 font-mono mt-1 uppercase tracking-widest">Prediction Engine v1.0</p>
                    </div>
                    <div className={`px-3 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider ${getSignalStyle(probability)}`}>
                      {item.ai_signal || 'WAITING'}
                    </div>
                  </div>

                  {/* Mini-gráfico de Tendencia (Sparkline SVG) */}
                  <div className="mb-4 bg-black/30 p-2 rounded-xl border border-white/5 relative h-16 flex items-center justify-center">
                    <div className="absolute left-3 top-2 flex items-center gap-1 text-[9px] text-zinc-500 uppercase tracking-widest">
                      <FaChartArea className="text-blue-400" /> Trend Preview
                    </div>
                    <svg className="w-full h-10 overflow-visible mt-2" viewBox="0 0 120 60">
                      <path
                        d={generateSparklinePath(item.rsi, item.volatility)}
                        fill="none"
                        stroke={probability >= 80 ? '#22c55e' : probability >= 65 ? '#eab308' : '#3b82f6'}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
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
                      <span className="text-xl font-black text-white">
                        {probability}%
                      </span>
                    </div>
                    
                    <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-1000 ${
                          probability > 80 ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 
                          probability > 65 ? 'bg-yellow-500' : 'bg-blue-600'
                        }`}
                        style={{ width: `${probability}%` }}
                      />
                    </div>
                    
                    <div className="flex justify-between mt-3">
                       <p className="text-[9px] text-zinc-600 italic">Score: {item.ai_score || 0} pts</p>
                       <p className="text-[9px] text-zinc-600 font-mono tracking-tighter uppercase">Click para calculadora</p>
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

        {/* Modal de Detalle y Calculadora de Riesgo/Beneficio */}
        {selectedItem && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
              
              <button 
                onClick={() => setSelectedItem(null)}
                className="absolute top-5 right-5 text-zinc-400 hover:text-white p-2 bg-zinc-800/50 rounded-full transition-all"
              >
                <FaTimes />
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl border border-blue-500/20">
                  <FaCalculator className="text-xl" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-white">{selectedItem.ticker?.toUpperCase()} — Position Calculator</h2>
                  <p className="text-xs text-zinc-400">Simulación basada en Take Profit y Stop Loss sugeridos por la IA</p>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-zinc-500 block mb-1">Capital a Invertir ($)</label>
                    <input 
                      type="number" 
                      value={capitalInput}
                      onChange={(e) => setCapitalInput(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-zinc-500 block mb-1">Stop Loss Personalizado ($)</label>
                    <input 
                      type="number" 
                      value={customStopLoss}
                      onChange={(e) => setCustomStopLoss(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="bg-black/40 p-4 rounded-2xl border border-white/5 space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Precio de Compra (Actual):</span>
                    <span className="text-white font-mono font-bold">${itemCurrentPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Acciones / Títulos estimados:</span>
                    <span className="text-white font-mono font-bold">{potentialShares.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Riesgo estimado (Stop Loss):</span>
                    <span className="text-rose-400 font-mono font-bold">-${potentialRisk.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Beneficio estimado (Take Profit):</span>
                    <span className="text-emerald-400 font-mono font-bold">+${potentialReward.toFixed(2)}</span>
                  </div>
                  <div className="pt-2 border-t border-white/5 flex justify-between items-center text-sm">
                    <span className="text-white font-bold flex items-center gap-1.5"><FaShieldAlt className="text-blue-400" /> Ratio Risk/Reward:</span>
                    <span className={`font-mono font-black text-base ${Number(riskRewardRatio) >= 2 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                      1 : {riskRewardRatio}
                    </span>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setSelectedItem(null)}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-600/20"
              >
                Cerrar Calculadora
              </button>
            </div>
          </div>
        )}

      </div>
    </AppShell>
  )
}
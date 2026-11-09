'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import AppShell from '../AppShell'
import { FaBrain, FaRobot, FaChartLine, FaExclamationTriangle, FaSync, FaTimes, FaCalculator } from 'react-icons/fa'

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

// Componente Sparkline SVG para la microtendencia
const Sparkline = ({ probability }: { probability: number }) => {
  // Generamos una curva simulada basada en la probabilidad para efectos visuales limpios
  const points = probability > 70 
    ? "0,20 15,15 30,18 45,10 60,12 75,5 90,2" 
    : "0,5 15,12 30,10 45,18 60,15 75,22 90,25"

  const strokeColor = probability >= 80 ? '#22c55e' : probability >= 65 ? '#eab308' : '#3b82f6'

  return (
    <svg className="w-full h-8 overflow-visible" viewBox="0 0 90 30">
      <path
        d={`M ${points}`}
        fill="none"
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function IAPage() {
  const [data, setData] = useState<WatchlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [mounted, setMounted] = useState(false)
  
  // Estado para el Modal de Detalle / Calculadora
  const [selectedItem, setSelectedItem] = useState<WatchlistItem | null>(null)
  const [accountCapital, setAccountCapital] = useState<number>(10000)
  const [riskPercentage, setRiskPercentage] = useState<number>(1)

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

    // Suscripción en Tiempo Real con Supabase Realtime
    const channel = supabase
      .channel('watchlist_realtime')
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

  if (!mounted) return null

  // Cálculos para la calculadora de posición en el modal
  const currentPrice = Number(selectedItem?.current_price) || 0
  const buyTarget = Number(selectedItem?.buy_target) || currentPrice
  const riskAmount = (accountCapital * riskPercentage) / 100
  const estimatedShares = currentPrice > 0 ? Math.floor(riskAmount / (currentPrice * 0.02)) : 0

  return (
    <AppShell>
      <div className="p-4 max-w-6xl mx-auto min-h-screen pb-20">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-8 bg-zinc-900/50 p-6 rounded-2xl border border-white/5">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3 text-white leading-none">
              <FaBrain className="text-blue-500" /> IA Trading Signals
            </h1>
            <p className="text-zinc-400 mt-2 text-sm">Monitoreo en tiempo real, análisis técnico y calculadora de riesgo</p>
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
              return (
                <div 
                  key={item.id} 
                  onClick={() => setSelectedItem(item)}
                  className="bg-zinc-900 border border-white/5 rounded-2xl p-5 hover:border-blue-500/30 transition-all group overflow-hidden relative shadow-xl cursor-pointer"
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

                  {/* Precios */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
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

                  {/* Mini Sparkline */}
                  <div className="mb-4 bg-black/20 p-2 rounded-xl border border-white/5">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[9px] text-zinc-500 uppercase font-mono">Micro Trend</span>
                    </div>
                    <Sparkline probability={probability} />
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
                       <p className="text-[9px] text-zinc-600 font-mono tracking-tighter uppercase">Realtime Active</p>
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

        {/* Modal de Detalle y Calculadora de Posición */}
        {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-3xl max-w-lg w-full p-6 relative shadow-2xl">
              <button 
                onClick={() => setSelectedItem(null)}
                className="absolute top-5 right-5 text-zinc-400 hover:text-white p-2 rounded-full bg-zinc-800/50"
              >
                <FaTimes />
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 text-blue-400">
                  <FaCalculator className="text-xl" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white">{selectedItem.ticker?.toUpperCase()}</h3>
                  <p className="text-xs text-zinc-400">Calculadora de Riesgo y Posición</p>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                    <p className="text-[10px] text-zinc-500 uppercase font-bold">Current Price</p>
                    <p className="text-lg font-bold text-white">${currentPrice.toFixed(2)}</p>
                  </div>
                  <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                    <p className="text-[10px] text-zinc-500 uppercase font-bold">Buy Target</p>
                    <p className="text-lg font-bold text-blue-400">${buyTarget.toFixed(2)}</p>
                  </div>
                </div>

                <div className="bg-zinc-950/50 p-4 rounded-2xl border border-white/5 space-y-3">
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">Capital Total de Cuenta ($)</label>
                    <input 
                      type="number" 
                      value={accountCapital} 
                      onChange={(e) => setAccountCapital(Number(e.target.value))}
                      className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">Riesgo Máximo por Operación (%)</label>
                    <input 
                      type="number" 
                      value={riskPercentage} 
                      onChange={(e) => setRiskPercentage(Number(e.target.value))}
                      className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="bg-blue-950/20 p-4 rounded-2xl border border-blue-500/20 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Riesgo Monetario Permitido:</span>
                    <span className="font-mono font-bold text-red-400">${riskAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Acciones / Títulos Sugeridos:</span>
                    <span className="font-mono font-bold text-white">{estimatedShares} unidades</span>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setSelectedItem(null)}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-600/20"
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
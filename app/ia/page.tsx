'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function IAPage() {
  const [data, setData] = useState<any[]>([])

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const { data } = await supabase
      .from('watchlist')
      .select('*')
      .order('ai_probability', { ascending: false })

    setData(data || [])
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>🧠 IA Trading Signals</h1>

      <div style={{ display: 'grid', gap: 12 }}>
        {data.map((item) => (
          <div key={item.id} style={{
            border: '1px solid #222',
            padding: 12,
            borderRadius: 8
          }}>
            <h2>{item.ticker}</h2>

            <p>💰 Precio: ${item.current_price}</p>
            <p>🎯 Target: ${item.buy_target}</p>

            <p>📊 RSI: {item.rsi?.toFixed(2)}</p>
            <p>📈 EMA20: {item.ema20?.toFixed(2)}</p>
            <p>🌊 Volatilidad: {item.volatility?.toFixed(2)}%</p>

            <hr />

            <p>🤖 Probabilidad: <b>{item.ai_probability}%</b></p>
            <p>📊 Score: {item.ai_score}</p>
            // Dentro del return de IAPage
            <p style={{ 
              color: item.ai_probability > 80 ? '#00ff00' : item.ai_probability > 65 ? '#fbbf24' : '#9ca3af',
              fontWeight: 'bold' 
            }}>
              🚀 Señal: {item.ai_signal}
            </p>

            <p>🚀 Señal: {item.ai_signal}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
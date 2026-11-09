'use client'

import { useEffect, useState } from 'react'
import { authedFetch } from '../../lib/authed-fetch'

type FG = {
  value: number
  label: string
  asOf: string
  components: { key: string; label: string; score: number; detail: string }[]
  missing: string[]
  notes?: string[]
}

const CACHE_KEY = 'tc_fear_greed_v2'
const CACHE_MS = 30 * 60 * 1000
const CACHE_PARTIAL_MS = 5 * 60 * 1000   // si falta algún indicador se vuelve a intentar pronto

// Miedo = verde · neutral = amarillo · codicia = rojo (0 → 100)
function fgColor(v: number): string {
  const a = v < 50 ? [34, 197, 94] : [234, 179, 8]
  const b = v < 50 ? [234, 179, 8] : [244, 63, 94]
  const t = v < 50 ? v / 50 : (v - 50) / 50
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(',')})`
}

export default function FearGreedBar({ compact = false }: { compact?: boolean }) {
  const [fg, setFg] = useState<FG | null>(null)

  useEffect(() => {
    let alive = true
    // Cada página monta su propio AppShell: se guarda el último valor para no pedirlo en cada navegación
    try {
      const raw = sessionStorage.getItem(CACHE_KEY)
      if (raw) {
        const c = JSON.parse(raw)
        if (c?.data && Date.now() - c.ts < (c.data.missing?.length ? CACHE_PARTIAL_MS : CACHE_MS)) { setFg(c.data); return }
      }
    } catch { /* sin almacenamiento: se pide igual */ }

    authedFetch('/api/fear-greed')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!alive || !data || typeof data.value !== 'number') return
        setFg(data)
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })) } catch { /* ignorar */ }
      })
      .catch(() => { /* sin sesión o sin datos: simplemente no se muestra */ })
    return () => { alive = false }
  }, [])

  if (!fg) return null
  const c = fgColor(fg.value)

  const tip = [
    `Miedo y codicia: ${fg.value} · ${fg.label}  (0 = miedo extremo, 100 = codicia extrema)`,
    ...fg.components.map(x => `• ${x.label}: ${x.score} — ${x.detail}`),
    ...(fg.missing.length ? [`Sin datos: ${fg.missing.join(', ')}`] : []),
    ...(fg.missing.length && fg.notes?.length ? fg.notes.map(n => `  ↳ ${n}`) : []),
    `Datos al ${fg.asOf} · índice propio`,
  ].join('\n')

  if (compact) {
    return (
      <div title={tip} style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, padding: '3px 7px', borderRadius: 4, border: `1px solid ${c}55`, background: '#0a0a0a' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
        <span style={{ fontSize: 12, fontWeight: 800, color: c }}>{fg.value}</span>
      </div>
    )
  }

  return (
    <div title={tip} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 1 560px', minWidth: 0, margin: '0 10px', cursor: 'help' }}>
      <span style={{ fontSize: 9, color: '#666', fontWeight: 700 }}>0</span>
      <div style={{ position: 'relative', flex: 1, minWidth: 60, height: 8, borderRadius: 4, background: 'linear-gradient(90deg, #22c55e, #eab308, #f43f5e)' }}>
        <div style={{
          position: 'absolute', left: `${fg.value}%`, top: -4, width: 3, height: 16, borderRadius: 2,
          background: '#fff', transform: 'translateX(-50%)', boxShadow: '0 0 4px rgba(0,0,0,0.9)',
        }} />
      </div>
      <span style={{ fontSize: 9, color: '#666', fontWeight: 700 }}>100</span>
      <span style={{ fontSize: 13, fontWeight: 900, color: c, flexShrink: 0 }}>{fg.value}</span>
      <span style={{ fontSize: 10, color: c, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fg.label}</span>
    </div>
  )
}
'use client'

import { useState } from 'react'
import { authedFetch } from '@/lib/authed-fetch'

// Panel «Revisión semestral PMP» (PMP-11): escribes el ticker de una posición PMP abierta y pulsas. Solo lectura: no guarda, no compra ni vende.
// Todo el código vive aquí; la página solo dibuja <RevisionPmp />.

interface Criterio { codigo: string; estado: string; detalle: string }
interface Resultado {
  ok: boolean; error?: string; ticker?: string; fecha?: string
  resultado?: 'revisar_venta_100' | 'mantener' | 'no_evaluable'
  motivos?: string[]
  rendimiento?: { estado: string; anualizado_pct: number | null; detalle: string }
  fundamentales?: { estado: string; deterioros: number; sin_datos: number; criterios: Criterio[] }
  valuacion?: { valor: number; fecha: string; horizonte_meses: number } | null
  cierre?: { valor: number; fecha: string } | null
  periodo_fundamentales?: string | null
  avisos?: string[]
}

const COLOR: Record<string, string> = { revisar_venta_100: '#f43f5e', mantener: '#22c55e', no_evaluable: '#eab308' }
const TEXTO: Record<string, string> = { revisar_venta_100: 'REVISAR VENTA DEL 100%', mantener: 'MANTENER', no_evaluable: 'NO EVALUABLE' }
const COLOR_CRITERIO: Record<string, string> = { deterioro: '#f43f5e', sin_deterioro: '#22c55e', no_evaluable: '#eab308' }
const etiqueta = (s: string) => s.replace(/_/g, ' ')

export default function RevisionPmp() {
  const [ticker, setTicker] = useState('')
  const [cargando, setCargando] = useState(false)
  const [res, setRes] = useState<Resultado | null>(null)
  const [fallo, setFallo] = useState('')

  const revisar = async () => {
    const t = ticker.trim().toUpperCase()
    if (!/^[A-Z0-9.\-]{1,10}$/.test(t)) { setFallo('Escribe un ticker válido'); return }
    setCargando(true); setRes(null); setFallo('')
    try {
      const r = await authedFetch('/api/oficina/revision-pmp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: t }) })
      const j = (await r.json().catch(() => null)) as Resultado | null
      if (!j) { setFallo(`El servidor respondió ${r.status} sin detalle`); return }
      if (!j.ok) { setFallo(j.error ?? 'Error desconocido'); return }
      setRes(j)
    } catch {
      setFallo('No se pudo conectar con el servidor')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div style={{ background: '#080808', border: '1px solid #1a1a1a', borderRadius: 10, padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Revisión semestral PMP (PMP-11)</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === 'Enter' && !cargando) revisar() }} placeholder="Ticker (ej. META)" disabled={cargando}
          style={{ background: '#000', border: '1px solid #222', color: 'white', padding: '8px 10px', borderRadius: 6, fontSize: 13, outline: 'none', width: 150 }} />
        <button onClick={revisar} disabled={cargando}
          style={{ background: '#0a0a0a', border: '1px solid #222', color: cargando ? '#444' : '#00bfff', padding: '8px 14px', borderRadius: 6, fontWeight: 700, cursor: cargando ? 'default' : 'pointer', fontSize: 12 }}>
          {cargando ? 'Revisando…' : 'Revisar'}
        </button>
        <span style={{ fontSize: 10, color: '#555' }}>Solo lectura: no guarda ni vende nada. Pide el valor estimado declarado en la ficha (valuacion_base).</span>
      </div>
      {fallo && <div style={{ color: '#f43f5e', fontSize: 12, marginTop: 10 }}>{fallo}</div>}

      {res && res.resultado && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#ccc' }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 900, color: COLOR[res.resultado], border: `1px solid ${COLOR[res.resultado]}`, borderRadius: 4, padding: '2px 8px' }}>{TEXTO[res.resultado]}</span>
            <span style={{ marginLeft: 8, color: '#666' }}>{res.ticker} · {res.fecha} · la venta nunca es automática</span>
          </div>
          {(res.motivos ?? []).map((m, i) => <div key={i} style={{ color: '#eab308', marginBottom: 3 }}>• {m}</div>)}
          <div style={{ marginTop: 8 }}><b>Rendimiento:</b> {res.rendimiento?.detalle}</div>
          <div style={{ color: '#666', marginBottom: 8 }}>
            Valor estimado: {res.valuacion ? `${res.valuacion.valor} (${res.valuacion.fecha}, ${res.valuacion.horizonte_meses} meses)` : 'sin declarar'} · Cierre: {res.cierre ? `${res.cierre.valor} (${res.cierre.fecha})` : 'sin dato'}
          </div>
          <div><b>Fundamentales</b> ({res.periodo_fundamentales ?? 'sin periodo comparable'}): {res.fundamentales?.deterioros} de 4 deterioros · {res.fundamentales?.sin_datos} sin datos</div>
          {(res.fundamentales?.criterios ?? []).map(c => (
            <div key={c.codigo} style={{ marginTop: 3 }}>
              <span style={{ color: COLOR_CRITERIO[c.estado] ?? '#aaa', fontWeight: 700 }}>{etiqueta(c.estado)}</span> · {etiqueta(c.codigo)}: <span style={{ color: '#888' }}>{c.detalle}</span>
            </div>
          ))}
          {(res.avisos ?? []).length > 0 && (
            <div style={{ marginTop: 8, color: '#666', fontSize: 11 }}>{(res.avisos ?? []).slice(0, 8).map((a, i) => <div key={i}>• {a}</div>)}</div>
          )}
        </div>
      )}
    </div>
  )
}

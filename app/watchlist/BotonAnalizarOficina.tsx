'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'
import { authedFetch } from '@/lib/authed-fetch'

// Botón «Analizar en la Oficina» de la watchlist: hace lo mismo que analizar-fundamental.ps1 (con -ConToken -Guardar), sin abrir PowerShell.
// Todo el código vive aquí; la página solo dibuja <BotonAnalizarOficina ticker=... portafolios=... />.

const PORTAFOLIOS = ['PMP', 'PCP', 'PLP', 'ETF', 'SEMILLA'] as const
const MONTO_POR_PORTAFOLIO: Record<string, string> = { PMP: '50', PCP: '25' }
const etiqueta = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—')

interface Resultado { ok: boolean; decision?: string | null; estado_final?: string; auditoria_veredicto?: string | null; motivos?: { codigo: string; detalle: string }[]; error?: string; etapa?: string; problemas?: string[] }

export default function BotonAnalizarOficina({ ticker, portafolios, grande = false }: { ticker: string; portafolios?: string[] | null; grande?: boolean }) {
  const inicial = (portafolios ?? []).find(p => (PORTAFOLIOS as readonly string[]).includes(p)) ?? 'PMP'
  const [abierto, setAbierto] = useState(false)
  const [portafolio, setPortafolio] = useState<string>(inicial)
  const [monto, setMonto] = useState<string>(MONTO_POR_PORTAFOLIO[inicial] ?? '')
  const [corriendo, setCorriendo] = useState(false)
  const [res, setRes] = useState<Resultado | null>(null)
  const [fallo, setFallo] = useState('')

  const abrir = () => {
    const p = (portafolios ?? []).find(x => (PORTAFOLIOS as readonly string[]).includes(x)) ?? 'PMP'
    setPortafolio(p); setMonto(MONTO_POR_PORTAFOLIO[p] ?? ''); setRes(null); setFallo(''); setAbierto(true)
  }
  const cambiarPortafolio = (p: string) => { setPortafolio(p); setMonto(MONTO_POR_PORTAFOLIO[p] ?? '') }

  const analizar = async () => {
    const m = monto.trim()
    if (m !== '' && !/^\d{1,9}(\.\d{1,2})?$/.test(m)) { setFallo('El monto debe ser un número positivo en USD con hasta 2 decimales'); return }
    setCorriendo(true); setRes(null); setFallo('')
    try {
      const r = await authedFetch('/api/oficina/analisis-fundamental', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, portafolio, con_director: true, guardar: true, ...(m !== '' ? { monto: Number(m) } : {}) }),
      })
      const j = (await r.json().catch(() => null)) as Resultado | null
      if (!j) { setFallo(`El servidor respondió ${r.status} sin detalle`); return }
      if (r.status === 429) { setFallo('Espera unos segundos entre un análisis y otro y vuelve a intentar'); return }
      setRes(j)
    } catch {
      setFallo('No se pudo conectar con el servidor (el análisis puede seguir en marcha: revísalo en /oficina en un minuto)')
    } finally {
      setCorriendo(false)
    }
  }

  const btn: React.CSSProperties = grande
    ? { flex: 1, minHeight: 42, borderRadius: 8, border: '1px solid #1a1a1a', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#22c55e' }
    : { background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#333', display: 'flex', transition: 'color 0.2s' }
  const sel: React.CSSProperties = { background: '#000', border: '1px solid #222', color: 'white', padding: '8px 10px', borderRadius: 6, fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }

  return (
    <>
      <button onClick={abrir} title="Analizar en la Oficina" aria-label="Analizar en la Oficina" style={btn}
        onMouseEnter={grande ? undefined : e => (e.currentTarget.style.color = '#22c55e')}
        onMouseLeave={grande ? undefined : e => (e.currentTarget.style.color = '#333')}>
        <Play size={grande ? 18 : 14} />
      </button>

      {abierto && (
        <div onClick={() => { if (!corriendo) setAbierto(false) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#080808', border: '1px solid #1a1a1a', borderRadius: 12, width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto', padding: 16, color: 'white', textAlign: 'left', whiteSpace: 'normal' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Analizar en la Oficina · {ticker}</div>
              <button onClick={() => setAbierto(false)} disabled={corriendo} aria-label="Cerrar" style={{ background: 'none', border: 'none', color: '#888', fontSize: 20, cursor: corriendo ? 'default' : 'pointer' }}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <label style={{ fontSize: 10, color: '#888', fontWeight: 700 }}>PORTAFOLIO
                <select value={portafolio} onChange={e => cambiarPortafolio(e.target.value)} disabled={corriendo} style={{ ...sel, marginTop: 4 }}>
                  {PORTAFOLIOS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 10, color: '#888', fontWeight: 700 }}>MONTO (USD)
                <input value={monto} onChange={e => setMonto(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" disabled={corriendo} placeholder="opcional" style={{ ...sel, marginTop: 4 }} />
              </label>
            </div>
            <div style={{ fontSize: 10, color: '#555', marginBottom: 10 }}>Sin monto, el Auditor no evalúa la regla del monto (queda NO EVALUABLE). Guarda la corrida; no compra ni vende nada.</div>

            {corriendo && <div style={{ color: '#00bfff', fontSize: 12, marginBottom: 10 }}>Analizando… puede tardar uno o dos minutos. No cierres esta ventana.</div>}
            {fallo && <div style={{ color: '#f43f5e', fontSize: 12, marginBottom: 10 }}>{fallo}</div>}

            {res && (
              <div style={{ border: '1px solid #151515', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 12 }}>
                {res.ok ? (
                  <>
                    <div style={{ fontWeight: 700, color: '#22c55e', marginBottom: 4 }}>Corrida guardada</div>
                    <div style={{ color: '#ccc' }}>Decisión: <b>{etiqueta(res.decision)}</b> · Estado: {etiqueta(res.estado_final)} · Auditor: {etiqueta(res.auditoria_veredicto)}</div>
                    {(res.motivos ?? []).slice(0, 4).map((m, i) => <div key={i} style={{ color: '#eab308', marginTop: 3 }}>• {etiqueta(m.codigo)}: {m.detalle}</div>)}
                    <a href="/oficina" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 8, color: '#00bfff', textDecoration: 'none', fontWeight: 700 }}>Ver el detalle en Oficina →</a>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 700, color: '#f43f5e', marginBottom: 4 }}>No se pudo analizar{res.etapa ? ` (${res.etapa})` : ''}</div>
                    <div style={{ color: '#ccc' }}>{res.error ?? 'Error desconocido'}</div>
                    {(res.problemas ?? []).map((p, i) => <div key={i} style={{ color: '#eab308', marginTop: 3 }}>• {p}</div>)}
                  </>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setAbierto(false)} disabled={corriendo} style={{ background: '#0a0a0a', color: '#aaa', border: '1px solid #222', padding: '8px 14px', borderRadius: 6, cursor: corriendo ? 'default' : 'pointer', fontSize: 13 }}>Cerrar</button>
              <button onClick={analizar} disabled={corriendo}
                style={{ background: '#1b2a1b', color: '#22c55e', border: '1px solid #2d4a2d', padding: '8px 14px', borderRadius: 6, fontWeight: 700, cursor: corriendo ? 'default' : 'pointer', fontSize: 13, opacity: corriendo ? 0.6 : 1 }}>
                {corriendo ? 'Analizando…' : res ? 'Analizar otra vez' : 'Analizar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

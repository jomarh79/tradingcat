'use client'

import { useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { authedFetch } from '@/lib/authed-fetch'

// Botón «Ficha PMP» de la watchlist: abre el borrador de la ficha PMP-09 de la última corrida del ticker, deja aprobar cada apartado
// y escribir los que son tuyos. Todo el código de la ficha vive aquí; la página solo dibuja <BotonAprobarFicha ticker=... />.

interface Propuesto { apartado: string; texto: string; fuente: string; aprobado: boolean; texto_aprobado: string | null }
interface Propio { apartado: string; texto_aprobado: string | null }
interface Estado {
  ticker: string
  corrida: { corrida_id: string; iniciada_at: string } | null
  propuesta: Propuesto[]
  no_propuestos: string[]
  propios: Propio[]
  aprobados: string[]
}

const etiqueta = (s: string) => s.replace(/_/g, ' ')
const fecha = (iso: string) => { try { return new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return iso } }

export default function BotonAprobarFicha({ ticker, grande = false }: { ticker: string; grande?: boolean }) {
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [estado, setEstado] = useState<Estado | null>(null)
  const [marcados, setMarcados] = useState<Record<string, boolean>>({})
  const [textos, setTextos] = useState<Record<string, string>>({})

  const cargar = async () => {
    setCargando(true); setError(''); setOk('')
    try {
      const res = await authedFetch(`/api/oficina/ficha?ticker=${encodeURIComponent(ticker)}`)
      const j = await res.json()
      if (!res.ok || !j?.ok) { setEstado(null); setError(j?.error ?? 'No se pudo leer la ficha'); return }
      const e = j as Estado
      setEstado(e)
      setMarcados(Object.fromEntries(e.propuesta.map(p => [p.apartado, !p.aprobado])))
      setTextos(Object.fromEntries(e.propios.map(p => [p.apartado, p.texto_aprobado ?? ''])))
    } catch {
      setEstado(null); setError('No se pudo conectar con el servidor')
    } finally {
      setCargando(false)
    }
  }

  const abrir = () => { setAbierto(true); void cargar() }

  const aprobar = async () => {
    if (!estado) return
    const aprobar = estado.propuesta.filter(p => marcados[p.apartado]).map(p => p.apartado)
    // solo se mandan los textos que cambiaron o que son nuevos; un texto vacío no borra nada
    const previos = Object.fromEntries(estado.propios.map(p => [p.apartado, p.texto_aprobado ?? '']))
    const cambiados = Object.fromEntries(Object.entries(textos).filter(([k, v]) => v.trim() !== '' && v.trim() !== (previos[k] ?? '').trim()))
    if (aprobar.length === 0 && Object.keys(cambiados).length === 0) { setError('No hay nada nuevo que aprobar'); return }
    setGuardando(true); setError(''); setOk('')
    try {
      const res = await authedFetch('/api/oficina/ficha', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, aprobar, textos: cambiados }),
      })
      const j = await res.json()
      if (!res.ok || !j?.ok) { setError(j?.error ?? 'No se pudo aprobar'); return }
      setOk(`Aprobado: ${(j.aprobados as string[]).map(etiqueta).join(', ')}`)
      await cargar()
    } catch {
      setError('No se pudo conectar con el servidor')
    } finally {
      setGuardando(false)
    }
  }

  const btn: React.CSSProperties = grande
    ? { flex: 1, minHeight: 42, borderRadius: 8, border: '1px solid #1a1a1a', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#ffd700' }
    : { background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#333', display: 'flex', transition: 'color 0.2s' }

  return (
    <>
      <button onClick={abrir} title="Ficha PMP-09: aprobar apartados" aria-label="Ficha PMP-09" style={btn}
        onMouseEnter={grande ? undefined : e => (e.currentTarget.style.color = '#ffd700')}
        onMouseLeave={grande ? undefined : e => (e.currentTarget.style.color = '#333')}>
        <ClipboardCheck size={grande ? 18 : 14} />
      </button>

      {abierto && (
        <div onClick={() => setAbierto(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#080808', border: '1px solid #1a1a1a', borderRadius: 12, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', padding: 16, color: 'white', textAlign: 'left', whiteSpace: 'normal' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Ficha PMP-09 · {ticker}</div>
              <button onClick={() => setAbierto(false)} aria-label="Cerrar" style={{ background: 'none', border: 'none', color: '#888', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>

            {cargando && <div style={{ color: '#888', fontSize: 12 }}>Cargando…</div>}
            {error && <div style={{ color: '#f43f5e', fontSize: 12, marginBottom: 10 }}>{error}</div>}
            {ok && <div style={{ color: '#22c55e', fontSize: 12, marginBottom: 10 }}>{ok}</div>}

            {estado && (
              <>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 10 }}>
                  {estado.corrida
                    ? `Borrador de la corrida PMP del ${fecha(estado.corrida.iniciada_at)}. Marca lo que apruebas tal cual.`
                    : 'Aún no hay corrida de PMP con borrador: corre el análisis de este ticker en PMP.'}
                  {' '}Rol, negocio y competidores salen de esta misma fila de la watchlist.
                </div>

                {estado.propuesta.map(p => (
                  <label key={p.apartado} style={{ display: 'block', border: '1px solid #151515', borderRadius: 8, padding: 10, marginBottom: 8, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={!!marcados[p.apartado]} onChange={e => setMarcados(m => ({ ...m, [p.apartado]: e.target.checked }))} />
                      <span style={{ color: '#00bfff', fontWeight: 700, fontSize: 12 }}>{etiqueta(p.apartado)}</span>
                      {p.aprobado && <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 700 }}>APROBADO</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#ccc', marginTop: 4, wordBreak: 'break-word' }}>{p.texto}</div>
                    {p.aprobado && p.texto_aprobado !== p.texto && <div style={{ fontSize: 10, color: '#eab308', marginTop: 3 }}>Lo aprobado antes es distinto; si marcas, se reemplaza.</div>}
                  </label>
                ))}

                <div style={{ fontSize: 11, color: '#888', margin: '12px 0 6px' }}>Los escribes tú</div>
                {estado.propios.map(p => (
                  <div key={p.apartado} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: '#00bfff', fontWeight: 700, marginBottom: 3 }}>
                      {etiqueta(p.apartado)} {p.texto_aprobado && <span style={{ color: '#22c55e', fontSize: 10 }}>APROBADO</span>}
                    </div>
                    <textarea value={textos[p.apartado] ?? ''} onChange={e => setTextos(t => ({ ...t, [p.apartado]: e.target.value }))} rows={2} maxLength={4000}
                      style={{ width: '100%', boxSizing: 'border-box', background: '#000', border: '1px solid #222', color: 'white', borderRadius: 6, padding: 8, fontSize: 13, outline: 'none', resize: 'vertical' }} />
                  </div>
                ))}
                {estado.no_propuestos.filter(x => !estado.propios.some(p => x.startsWith(`${p.apartado}:`))).map((x, i) => (
                  <div key={i} style={{ fontSize: 11, color: '#eab308' }}>• {x}</div>
                ))}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                  <button onClick={() => setAbierto(false)} style={{ background: '#0a0a0a', color: '#aaa', border: '1px solid #222', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cerrar</button>
                  <button onClick={aprobar} disabled={guardando}
                    style={{ background: '#1b2a1b', color: '#22c55e', border: '1px solid #2d4a2d', padding: '8px 14px', borderRadius: 6, fontWeight: 700, cursor: guardando ? 'default' : 'pointer', fontSize: 13, opacity: guardando ? 0.6 : 1 }}>
                    {guardando ? 'Guardando…' : 'Aprobar lo marcado'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

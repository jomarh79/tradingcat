'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useIsMobile } from '@/lib/useIsMobile'
import { authedFetch } from '@/lib/authed-fetch'
import AppShell from '../AppShell'
import { FaSync, FaSearch, FaSpinner, FaTimes } from 'react-icons/fa'
import { Briefcase } from 'lucide-react'

const C = { accent: '#00bfff', success: '#22c55e', danger: '#f43f5e', warning: '#eab308', card: '#080808', border: '#1a1a1a' }

interface Corrida {
  id: string
  corrida_id: string
  version: number
  ticker: string | null
  portafolio_codigo: string | null
  tipo_evaluacion: string | null
  decision: string | null
  estado_final: string
  director_estado: string
  auditoria_veredicto: string | null
  iniciada_at: string
  finalizada_at: string | null
  motivos_total: number
}
interface Agente {
  agente: string
  estado: string
  reintentos: number | null
  error: string | null
  veredicto: string | null
  puntaje: number | null
  confianza: string | number | null
  textos: string[]
  negativos: string[]
}
interface Regla { codigo: string; resultado: string; detalle: string }
interface Motivo { codigo: string; detalle: string }
interface Detalle {
  corrida: Corrida & { ruta: string | null; disparador: string | null; snapshot_fecha_datos: string | null }
  agentes: Agente[]
  director: Agente | null
  reglas_auditor: Regla[]
  motivos: Motivo[]
  datos_faltantes: string[]
  avisos: string[]
  datos_vencidos: string[]
}

// Verde = comprar, amarillo = esperar / mantener, rojo = bloqueado o salida, gris = sin decisión
const COLOR_DECISION: Record<string, string> = {
  COMPRAR: C.success, RECOMPRAR: C.success,
  ESPERAR: C.warning, VIGILAR: C.warning, MANTENER: C.warning, MANTENER_BAJO_VIGILANCIA: C.warning,
  BLOQUEADO: C.danger, VENDER: C.danger, REDUCIR: C.danger,
  NO_COMPRAR: '#888', NO_RECOMPRAR: '#888', NO_EVALUABLE: '#888',
}
const colorDecision = (d: string | null) => (d && COLOR_DECISION[d]) || '#555'

const COLOR_REGLA: Record<string, string> = { cumple: C.success, incumple: C.danger, no_evaluable: C.warning, informativo: '#888' }
const COLOR_ESTADO: Record<string, string> = { completada: C.success, bloqueada: C.danger, incompleta: C.warning, pendiente_informacion: C.warning }
const COLOR_AGENTE: Record<string, string> = { ok: C.success, error: C.danger, ausente: C.warning, no_ejecutado: '#666' }

const fecha = (s: string | null) =>
  s ? new Date(s).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

const etiqueta = (s: string | null) => (s ? s.replace(/_/g, ' ') : '—')

const Badge = ({ texto, color }: { texto: string; color: string }) => (
  <span style={{
    color, border: `1px solid ${color}55`, background: `${color}14`, borderRadius: 4,
    padding: '2px 7px', fontSize: 10, fontWeight: 800, letterSpacing: 0.4, whiteSpace: 'nowrap',
  }}>
    {texto}
  </span>
)

const Seccion = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <div style={{ marginTop: 16 }}>
    <div style={{ fontSize: 10, color: '#888', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>{titulo}</div>
    {children}
  </div>
)

const Vacio = ({ texto }: { texto: string }) => <div style={{ fontSize: 12, color: '#555' }}>{texto}</div>

export default function OficinaPage() {
  const isMobile = useIsMobile()

  const [corridas, setCorridas] = useState<Corrida[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState('')
  const [ultima, setUltima] = useState<Date | null>(null)

  const [abierta, setAbierta] = useState<Corrida | null>(null)
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [errorDetalle, setErrorDetalle] = useState('')

  const alive = useRef(true)
  const reqLista = useRef(0)
  const reqDetalle = useRef(0)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const cargarLista = useCallback(async (ticker: string) => {
    const id = ++reqLista.current
    setCargando(true)
    try {
      const qs = new URLSearchParams({ limite: '50' })
      if (ticker) qs.set('ticker', ticker)
      const res = await authedFetch(`/api/oficina/corridas?${qs.toString()}`)
      const j = await res.json().catch(() => null)
      if (!alive.current || id !== reqLista.current) return
      if (!res.ok || !j?.ok) { setError(j?.error || `La consulta respondió ${res.status}`); return }
      setCorridas(j.corridas as Corrida[])
      setError('')
      setUltima(new Date())
    } catch (e) {
      if (alive.current && id === reqLista.current) setError(e instanceof Error ? e.message : 'No se pudo cargar')
    } finally {
      if (alive.current && id === reqLista.current) setCargando(false)
    }
  }, [])

  // Carga al abrir y cada vez que cambia el filtro (con una pausa corta mientras se escribe)
  useEffect(() => {
    const t = setTimeout(() => { cargarLista(filtro.trim()) }, filtro ? 350 : 0)
    return () => clearTimeout(t)
  }, [filtro, cargarLista])

  const abrir = async (c: Corrida) => {
    const id = ++reqDetalle.current
    setAbierta(c)
    setDetalle(null)
    setErrorDetalle('')
    setCargandoDetalle(true)
    try {
      const res = await authedFetch(`/api/oficina/corridas?id=${encodeURIComponent(c.corrida_id)}`)
      const j = await res.json().catch(() => null)
      if (!alive.current || id !== reqDetalle.current) return
      if (!res.ok || !j?.ok) { setErrorDetalle(j?.error || `La consulta respondió ${res.status}`); return }
      setDetalle(j as Detalle)
    } catch (e) {
      if (alive.current && id === reqDetalle.current) setErrorDetalle(e instanceof Error ? e.message : 'No se pudo cargar')
    } finally {
      if (alive.current && id === reqDetalle.current) setCargandoDetalle(false)
    }
  }

  const cerrar = () => { reqDetalle.current++; setAbierta(null); setDetalle(null); setErrorDetalle('') }

  useEffect(() => {
    if (!abierta) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [abierta])

  const btnH = isMobile ? 42 : 34

  // ── Contenido del detalle ──
  const renderDetalle = () => {
    if (cargandoDetalle) return <div style={{ color: '#666', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}><FaSpinner style={{ animation: 'spin 1s linear infinite' }} /> Cargando…</div>
    if (errorDetalle) return <div style={{ color: C.danger, fontSize: 13 }}>No se pudo cargar el detalle: {errorDetalle}</div>
    if (!detalle) return null
    const d = detalle
    return (
      <>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge texto={d.corrida.decision ?? 'SIN DECISIÓN'} color={colorDecision(d.corrida.decision)} />
          <Badge texto={etiqueta(d.corrida.estado_final).toUpperCase()} color={COLOR_ESTADO[d.corrida.estado_final] ?? '#888'} />
          {d.corrida.auditoria_veredicto && <Badge texto={`AUDITOR: ${etiqueta(d.corrida.auditoria_veredicto).toUpperCase()}`} color={d.corrida.auditoria_veredicto === 'CUMPLE' ? C.success : d.corrida.auditoria_veredicto === 'BLOQUEO_REGLA' ? C.danger : C.warning} />}
          <Badge texto={`DIRECTOR: ${etiqueta(d.corrida.director_estado).toUpperCase()}`} color={d.corrida.director_estado === 'ok' ? C.success : d.corrida.director_estado === 'error' ? C.danger : '#888'} />
        </div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
          {etiqueta(d.corrida.tipo_evaluacion)} · ruta {etiqueta(d.corrida.ruta)} · {d.corrida.disparador ?? '—'} · datos al {d.corrida.snapshot_fecha_datos ?? '—'} · {fecha(d.corrida.iniciada_at)}
        </div>

        <Seccion titulo="Motivos">
          {d.motivos.length === 0
            ? <Vacio texto="Sin motivos: la corrida terminó normal." />
            : d.motivos.map((m, i) => (
              <div key={i} style={{ fontSize: 12, marginBottom: 4, color: '#ccc' }}>
                <span style={{ color: C.warning, fontWeight: 700 }}>{m.codigo}</span> · {m.detalle}
              </div>
            ))}
        </Seccion>

        <Seccion titulo="Reglas del Auditor">
          {d.reglas_auditor.length === 0
            ? <Vacio texto="El Auditor no dejó resultados guardados para esta corrida." />
            : d.reglas_auditor.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6, fontSize: 12 }}>
                <span style={{ width: 62, flexShrink: 0, fontWeight: 800, color: '#ddd' }}>{r.codigo}</span>
                <span style={{ width: 82, flexShrink: 0 }}><Badge texto={etiqueta(r.resultado).toUpperCase()} color={COLOR_REGLA[r.resultado] ?? '#888'} /></span>
                <span style={{ color: '#999', minWidth: 0, wordBreak: 'break-word' }}>{r.detalle}</span>
              </div>
            ))}
        </Seccion>

        <Seccion titulo="Agentes">
          {d.agentes.length === 0 && <Vacio texto="Sin agentes registrados." />}
          {d.agentes.map((a, i) => (
            <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', marginBottom: 8, background: '#050505' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, fontSize: 13 }}>{etiqueta(a.agente)}</span>
                <Badge texto={etiqueta(a.estado).toUpperCase()} color={COLOR_AGENTE[a.estado] ?? '#888'} />
                {a.veredicto && <span style={{ fontSize: 12, color: C.accent, fontWeight: 700 }}>{etiqueta(a.veredicto)}</span>}
                {a.puntaje !== null && <span style={{ fontSize: 12, color: '#aaa' }}>puntaje {a.puntaje}</span>}
                {a.confianza !== null && <span style={{ fontSize: 11, color: '#666' }}>confianza {String(a.confianza)}</span>}
                {a.reintentos ? <span style={{ fontSize: 11, color: '#666' }}>{a.reintentos} reintento(s)</span> : null}
              </div>
              {a.error && <div style={{ fontSize: 11, color: C.danger, marginTop: 4, wordBreak: 'break-word' }}>{a.error}</div>}
              {a.textos.map((t, k) => <div key={`t${k}`} style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>+ {t}</div>)}
              {a.negativos.map((t, k) => <div key={`n${k}`} style={{ fontSize: 12, color: '#d98a8a', marginTop: 4 }}>− {t}</div>)}
            </div>
          ))}
          {d.director && (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', background: '#050505' }}>
              <span style={{ fontWeight: 800, fontSize: 13 }}>director</span>
              {d.director.confianza !== null && <span style={{ fontSize: 11, color: '#666', marginLeft: 8 }}>confianza {String(d.director.confianza)}</span>}
            </div>
          )}
        </Seccion>

        <Seccion titulo="Datos faltantes">
          {d.datos_faltantes.length === 0 && d.datos_vencidos.length === 0
            ? <Vacio texto="Ninguno." />
            : (
              <>
                {d.datos_faltantes.map((x, i) => <div key={`f${i}`} style={{ fontSize: 12, color: '#ccc', marginBottom: 3 }}>• {x}</div>)}
                {d.datos_vencidos.map((x, i) => <div key={`v${i}`} style={{ fontSize: 12, color: C.warning, marginBottom: 3 }}>• vencido: {x}</div>)}
              </>
            )}
        </Seccion>

        {d.avisos.length > 0 && (
          <Seccion titulo="Avisos">
            {d.avisos.map((x, i) => <div key={i} style={{ fontSize: 12, color: '#aaa', marginBottom: 3 }}>• {x}</div>)}
          </Seccion>
        )}
      </>
    )
  }

  const decisionBadge = (c: Corrida) => <Badge texto={c.decision ?? 'SIN DECISIÓN'} color={colorDecision(c.decision)} />

  return (
    <AppShell>
      <div style={{ padding: isMobile ? '12px 2px' : '22px 28px', color: 'white', maxWidth: 1300, margin: '0 auto' }}>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h1 style={{ fontSize: isMobile ? 19 : 20, fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Briefcase size={20} color={C.accent} />
            Oficina de Inversiones
            <span style={{ fontSize: 11, color: '#666', fontWeight: 400 }}>({corridas.length})</span>
          </h1>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {ultima && <span style={{ fontSize: 10, color: '#444' }}>{ultima.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>}
            <button onClick={() => cargarLista(filtro.trim())} disabled={cargando}
              style={{ background: '#0a0a0a', border: '1px solid #222', color: cargando ? '#444' : C.warning, minHeight: btnH, padding: '0 14px', borderRadius: 6, cursor: cargando ? 'default' : 'pointer', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
              <FaSync style={{ animation: cargando ? 'spin 1s linear infinite' : 'none' }} /> Actualizar
            </button>
          </div>
        </div>

        {/* ── FILTRO ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <FaSearch style={{ color: '#666', fontSize: 12 }} />
          <input value={filtro} onChange={e => setFiltro(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="Filtrar por ticker…"
            style={{ background: '#000', border: '1px solid #222', color: 'white', padding: isMobile ? '10px 10px' : '8px 10px', borderRadius: 8, outline: 'none', fontSize: isMobile ? 14 : 13, width: isMobile ? '100%' : 240, boxSizing: 'border-box' }} />
        </div>

        {error && (
          <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 12, background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.25)', color: C.danger }}>
            No se pudieron cargar las corridas: {error}
          </div>
        )}

        {/* ── LISTA ── */}
        {isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {corridas.length === 0 && (
              <div style={{ padding: 36, textAlign: 'center', color: '#555', background: '#0a0a0a', borderRadius: 12, border: `1px solid ${C.border}` }}>
                {cargando ? 'Cargando corridas…' : 'No hay corridas.'}
              </div>
            )}
            {corridas.map(c => (
              <button key={c.id} onClick={() => abrir(c)}
                style={{ textAlign: 'left', background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${colorDecision(c.decision)}`, borderRadius: 12, padding: '10px 12px', color: 'white', cursor: 'pointer', minHeight: 44 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 900, fontSize: 17, color: C.accent }}>{c.ticker ?? '—'}</span>
                  {decisionBadge(c)}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: '#777' }}>
                  <span>{c.portafolio_codigo ?? '—'}</span>
                  <span>{fecha(c.iniciada_at)}</span>
                  <span style={{ color: COLOR_ESTADO[c.estado_final] ?? '#888', fontWeight: 700 }}>{etiqueta(c.estado_final)}</span>
                  {c.motivos_total > 0 && <span>{c.motivos_total} motivo(s)</span>}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: 'auto', background: '#050505', borderRadius: 12, border: `1px solid ${C.border}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr style={{ background: '#0a0a0a' }}>
                  {['Fecha', 'Ticker', 'Portafolio', 'Tipo', 'Decisión', 'Estado', 'Auditor', 'Motivos'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {corridas.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#555' }}>{cargando ? 'Cargando corridas…' : 'No hay corridas.'}</td></tr>
                )}
                {corridas.map(c => (
                  <tr key={c.id} onClick={() => abrir(c)} style={{ cursor: 'pointer', borderBottom: '1px solid #0c0c0c' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ ...tdStyle, color: '#777', fontSize: '0.72rem' }}>{fecha(c.iniciada_at)}</td>
                    <td style={{ ...tdStyle, fontWeight: 800, color: C.accent }}>{c.ticker ?? '—'}</td>
                    <td style={tdStyle}>{c.portafolio_codigo ?? '—'}</td>
                    <td style={{ ...tdStyle, color: '#888' }}>{etiqueta(c.tipo_evaluacion)}</td>
                    <td style={tdStyle}>{decisionBadge(c)}</td>
                    <td style={{ ...tdStyle, color: COLOR_ESTADO[c.estado_final] ?? '#888', fontWeight: 700 }}>{etiqueta(c.estado_final)}</td>
                    <td style={{ ...tdStyle, color: '#888' }}>{etiqueta(c.auditoria_veredicto)}</td>
                    <td style={{ ...tdStyle, color: '#888' }}>{c.motivos_total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 9, color: '#333', textAlign: 'right' }}>
          Solo lectura · las corridas se lanzan desde PowerShell
        </div>
      </div>

      {/* ── DETALLE ── */}
      {abierta && (
        <div onClick={cerrar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 20 }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-label={`Corrida de ${abierta.ticker ?? ''}`}
            style={{ background: '#0a0a0a', border: `1px solid ${C.border}`, borderRadius: isMobile ? '14px 14px 0 0' : 14, width: '100%', maxWidth: isMobile ? '94vw' : 760, maxHeight: '88vh', overflowY: 'auto', padding: '14px 16px 20px', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>
                <span style={{ color: C.accent }}>{abierta.ticker ?? '—'}</span>
                <span style={{ color: '#666', fontSize: 12, fontWeight: 600, marginLeft: 10 }}>{abierta.portafolio_codigo ?? ''}</span>
              </div>
              <button onClick={cerrar} aria-label="Cerrar"
                style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', minWidth: 42, minHeight: 42, fontSize: 16 }}>
                <FaTimes />
              </button>
            </div>
            {renderDetalle()}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </AppShell>
  )
}

const thStyle: React.CSSProperties = { padding: '10px 12px', textAlign: 'center', color: '#888', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '9px 10px', textAlign: 'center', whiteSpace: 'nowrap', fontSize: '0.82rem' }
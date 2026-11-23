'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useIsMobile } from '@/lib/useIsMobile'
import { authedFetch } from '@/lib/authed-fetch'
import AppShell from '../AppShell'
import { FaSync, FaSearch, FaSpinner, FaTimes } from 'react-icons/fa'
import { Briefcase } from 'lucide-react'
import RevisionPmp from './RevisionPmp'

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
interface PlanSalida {
  total_salidas: number | null
  hechas: number | null
  siguiente: number | null
  nivel_siguiente: string | null
  precio_actual: string | null
  confirmaciones_minimas: number | null
  motivo: string | null
  confirmaciones_nuevas: string[]
  faltantes: string[]
  exigida: { decision: string; porcentaje: number | null; detalle: string } | null
}
interface Detalle {
  corrida: Corrida & { ruta: string | null; disparador: string | null; snapshot_fecha_datos: string | null }
  agentes: Agente[]
  director: Agente | null
  reglas_auditor: Regla[]
  motivos: Motivo[]
  datos_faltantes: string[]
  avisos: string[]
  datos_vencidos: string[]
  salida_pmp: PlanSalida | null
  salida_pcp?: {
    compras: number | null; costo_promedio: string | null; precio_actual: string | null; primera_salida_realizada: boolean; motivo: string | null
    nivel_alcanzado: string | null; niveles: { nivel: string | null; cumplido: boolean }[]; stop: string | null; zona_recompra: boolean
    recompras_restantes: number | null; senal_salida: boolean; faltantes: string[]
    exigida: { decision: string; porcentaje: number | null; detalle: string } | null
  } | null
  entrada_pcp?: { confirmada: boolean; senales_minimas: number | null; fuerza: string | null; no_evaluables: string[]; cumplidas: { id: string; detalle: string }[] } | null
  salud_financiera?: { resumen: string | null; texto: string | null; ganancias: { estado: string | null; ttm: number | null; anual: number | null; fy: string | null }; flujo_caja: { estado: string | null; ttm: number | null; anual: number | null; fy: string | null }; avisos: string[] } | null
  pertenencia_indices?: { estado: string | null; indices: string[]; no_incluido_en: string[]; texto: string | null } | null
  dividendo_pmp?: { estado: string | null; texto: string | null; rendimiento_actual: number | null; rendimiento_promedio: number | null; puntos: number | null; anios_cubiertos: number | null; ultimo_dividendo: { fecha: string | null; monto: number | null } | null } | null
  valuacion?: { anios: number | null; pe_objetivo: number | null; origen_pe: string | null; eps: number | null; origen_eps: string | null; precio_objetivo: number | null; cierre: number | null; ganancia_total_pct: number | null; ganancia_anualizada_pct: number | null; fecha: string | null; motivo: string | null; avisos: string[]; per: { per_actual: number | null; per_promedio: number | null; puntos: number | null; relacion: string | null; motivo: string | null } | null } | null
  ficha_propuesta?: { propuesta: { apartado: string; texto: string; fuente: string }[]; no_propuestos: string[] } | null
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

// Distancia del precio al nivel de la siguiente salida: «faltan +24.0% para llegar» o «ya pasó el nivel por 3.2%»
const distanciaANivel = (precio: string | null, nivel: string | null): string | null => {
  const p = Number(precio), n = Number(nivel)
  if (!precio || !nivel || !isFinite(p) || !isFinite(n) || p <= 0) return null
  const pct = ((n - p) / p) * 100
  return pct > 0 ? `faltan +${pct.toFixed(1)}% para llegar al nivel` : `ya pasó el nivel por ${Math.abs(pct).toFixed(1)}%`
}

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
            : d.reglas_auditor.filter(r => r.resultado !== 'no_aplica').map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6, fontSize: 12 }}>
                <span style={{ width: 62, flexShrink: 0, fontWeight: 800, color: '#ddd' }}>{r.codigo}</span>
                <span style={{ width: 82, flexShrink: 0 }}><Badge texto={etiqueta(r.resultado).toUpperCase()} color={COLOR_REGLA[r.resultado] ?? '#888'} /></span>
                <span style={{ color: '#999', minWidth: 0, wordBreak: 'break-word' }}>{r.detalle}</span>
              </div>
            ))}
          {/* v0.62: las reglas que no aplican a esta corrida no se listan (la lista salía muy larga); solo queda el conteo, plegado */}
          {d.reglas_auditor.some(r => r.resultado === 'no_aplica') && (
            <details style={{ marginTop: 6, fontSize: 11, color: '#555' }}>
              <summary style={{ cursor: 'pointer' }}>{d.reglas_auditor.filter(r => r.resultado === 'no_aplica').length} reglas no aplican a esta corrida</summary>
              <div style={{ marginTop: 4 }}>{d.reglas_auditor.filter(r => r.resultado === 'no_aplica').map(r => r.codigo).join(', ')}</div>
            </details>
          )}
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

        {d.salida_pmp && (
          <Seccion titulo="Plan de salidas (PMP)">
            <div style={{ fontSize: 12, color: '#ccc', marginBottom: 4 }}>
              {d.salida_pmp.hechas ?? 0} de {d.salida_pmp.total_salidas ?? '—'} salidas hechas
              {d.salida_pmp.siguiente !== null && <> · siguiente: salida {d.salida_pmp.siguiente}{d.salida_pmp.nivel_siguiente ? <> en nivel {d.salida_pmp.nivel_siguiente}</> : <> sin nivel planeado</>}</>}
              {d.salida_pmp.siguiente === null && <> · ya no quedan salidas por hacer</>}
            </div>
            {d.salida_pmp.precio_actual && (
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
                Precio (último cierre): {d.salida_pmp.precio_actual}
                {distanciaANivel(d.salida_pmp.precio_actual, d.salida_pmp.nivel_siguiente) !== null && <> · {distanciaANivel(d.salida_pmp.precio_actual, d.salida_pmp.nivel_siguiente)}</>}
              </div>
            )}
            {d.salida_pmp.exigida
              ? <div style={{ fontSize: 12, color: C.danger, fontWeight: 700 }}>{d.salida_pmp.exigida.decision}{d.salida_pmp.exigida.porcentaje !== null ? ` ${d.salida_pmp.exigida.porcentaje}%` : ''} · {d.salida_pmp.exigida.detalle}</div>
              : <Vacio texto="Hoy no se cumple ninguna condición de salida." />}
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
              Confirmaciones: {d.salida_pmp.confirmaciones_nuevas.length} de {d.salida_pmp.confirmaciones_minimas ?? 2}
              {d.salida_pmp.confirmaciones_nuevas.length > 0 && <> ({d.salida_pmp.confirmaciones_nuevas.map(etiqueta).join(', ')})</>}
            </div>
            {d.salida_pmp.faltantes.map((x, i) => <div key={i} style={{ fontSize: 11, color: C.warning, marginTop: 3 }}>• {x}</div>)}
          </Seccion>
        )}

        {d.salud_financiera && (
          <Seccion titulo={d.corrida.portafolio_codigo === 'PMP' ? 'Salud financiera (obligatoria, PMP)' : 'Salud financiera (informativa, PCP)'}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: d.salud_financiera.resumen === 'solida' || d.salud_financiera.resumen === 'aceptable' ? C.success : d.salud_financiera.resumen === 'debil' ? C.danger : C.warning }}>
              {d.salud_financiera.resumen === 'solida' ? 'Genera ganancias y flujo de caja libre' : d.salud_financiera.resumen === 'debil' ? 'No genera ganancias ni flujo de caja libre' : d.salud_financiera.resumen === 'aceptable' ? 'Genera ganancias y flujo de caja libre (TTM y último año no coinciden en alguna medida)' : d.salud_financiera.resumen === 'mixta' ? 'Una medida negativa' : d.salud_financiera.resumen === 'incompleta' ? 'Datos incompletos' : 'Sin datos'}
            </div>
            {([['Ganancias (utilidad neta)', d.salud_financiera.ganancias], ['Flujo de caja libre', d.salud_financiera.flujo_caja]] as const).map(([nombre, m]) => (
              <div key={nombre} style={{ fontSize: 12, color: '#ccc', marginTop: 3 }}>
                • {nombre}: {etiqueta(m.estado)}{m.ttm !== null ? ` · TTM ${m.ttm > 0 ? 'positivo' : 'no positivo'}` : ''}{m.anual !== null ? ` · ${m.fy ?? 'último año'} ${m.anual > 0 ? 'positivo' : 'no positivo'}` : ''}
              </div>
            ))}
            <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>{d.corrida.portafolio_codigo === 'PMP' ? 'Obligatoria en PMP: sin ganancias y flujo de caja libre positivos (TTM y último año) no se compra.' : 'Solo ayuda a decidir cuánto invertir: no compra, no vende ni bloquea la decisión.'}</div>
            {d.salud_financiera.avisos.map((x, i) => <div key={i} style={{ fontSize: 11, color: C.warning, marginTop: 3 }}>• {x}</div>)}
          </Seccion>
        )}

        {d.pertenencia_indices && (
          <Seccion titulo="Índices de referencia">
            <div style={{ fontSize: 12, fontWeight: 700, color: d.pertenencia_indices.estado === 'pertenece' ? C.success : d.corrida.portafolio_codigo === 'PMP' ? C.danger : C.warning }}>
              {d.pertenencia_indices.estado === 'pertenece' ? `Pertenece a: ${d.pertenencia_indices.indices.join(', ')}` : d.pertenencia_indices.estado === 'no_pertenece' ? (d.corrida.portafolio_codigo === 'PMP' ? 'No pertenece a ningún índice: PMP no compra, se sugiere PCP' : 'Alerta: no pertenece a ningún índice de referencia') : 'No se pudo comprobar la pertenencia'}
            </div>
            {d.pertenencia_indices.texto && <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>{d.pertenencia_indices.texto}</div>}
          </Seccion>
        )}

        {d.dividendo_pmp && (
          <Seccion titulo="Dividendo vs precio (obligatorio, PMP)">
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: d.dividendo_pmp.estado === 'paga_verde' ? C.success : d.dividendo_pmp.estado === 'paga_rojo' || d.dividendo_pmp.estado === 'no_paga' ? C.danger : C.warning }}>
              {d.dividendo_pmp.estado === 'paga_verde' ? 'Lado verde: barata, se puede comprar' : d.dividendo_pmp.estado === 'paga_rojo' ? 'Lado rojo: cara, no se compra' : d.dividendo_pmp.estado === 'no_paga' ? 'No paga dividendos: se sugiere pasarla a PCP' : 'Sin datos'}
            </div>
            {d.dividendo_pmp.rendimiento_actual !== null && d.dividendo_pmp.rendimiento_promedio !== null && (
              <div style={{ fontSize: 12, color: '#ccc' }}>Hoy {d.dividendo_pmp.rendimiento_actual.toFixed(3)}% · promedio de 5 años {d.dividendo_pmp.rendimiento_promedio.toFixed(3)}% (diario, sin anualizar; {d.dividendo_pmp.puntos} cierres, {d.dividendo_pmp.anios_cubiertos} años)</div>
            )}
            {d.dividendo_pmp.ultimo_dividendo && <div style={{ fontSize: 11, color: '#999', marginTop: 3 }}>Último dividendo: {d.dividendo_pmp.ultimo_dividendo.monto ?? '—'} el {d.dividendo_pmp.ultimo_dividendo.fecha ?? '—'}</div>}
            {d.dividendo_pmp.texto && <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>{d.dividendo_pmp.texto}</div>}
          </Seccion>
        )}

        {d.entrada_pcp && (
          <Seccion titulo="Entrada técnica (PCP)">
            <div style={{ fontSize: 12, color: d.entrada_pcp.confirmada ? C.success : C.warning, fontWeight: 700, marginBottom: 4 }}>
              {d.entrada_pcp.cumplidas.length} señal(es) cumplida(s) · mínimo {d.entrada_pcp.senales_minimas ?? '—'}
              {d.entrada_pcp.fuerza ? <> · fuerza {d.entrada_pcp.fuerza.replace('_', ' ')}</> : null}
              {d.entrada_pcp.confirmada ? '' : ' · no alcanza el mínimo'}
            </div>
            {d.entrada_pcp.cumplidas.map((x, i) => <div key={i} style={{ fontSize: 11, color: '#ccc', marginTop: 3 }}>• {etiqueta(x.id)}: {x.detalle}</div>)}
            {d.entrada_pcp.no_evaluables.length > 0 && <div style={{ fontSize: 11, color: C.warning, marginTop: 3 }}>Sin datos para evaluar: {d.entrada_pcp.no_evaluables.map(etiqueta).join(', ')}</div>}
            <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>La fuerza (2 normal · 3 fuerte · 4 o más muy fuerte) es solo informativa: no cambia la decisión.</div>
          </Seccion>
        )}

        {d.salida_pcp && (
          <Seccion titulo="Salida (PCP)">
            <div style={{ fontSize: 12, color: '#ccc', marginBottom: 4 }}>
              {d.salida_pcp.compras ?? '—'} compra(s){d.salida_pcp.costo_promedio ? <> · costo promedio {d.salida_pcp.costo_promedio}</> : null}
              {d.salida_pcp.primera_salida_realizada && <> · primera salida ya hecha</>}
            </div>
            {d.salida_pcp.precio_actual && <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>Precio (último cierre): {d.salida_pcp.precio_actual}{d.salida_pcp.stop ? <> · stop de referencia {d.salida_pcp.stop}</> : null}</div>}
            <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
              Niveles: {d.salida_pcp.niveles.length === 0 ? 'sin datos' : d.salida_pcp.niveles.map((n, i) => `TP${i + 1} ${n.nivel ?? '—'}${n.cumplido ? ' ✓' : ''}`).join(' · ')}
              {' · '}señal de salida: {d.salida_pcp.senal_salida ? 'sí' : 'no'}
            </div>
            {d.salida_pcp.exigida
              ? <div style={{ fontSize: 12, color: C.danger, fontWeight: 700 }}>{d.salida_pcp.exigida.decision}{d.salida_pcp.exigida.porcentaje !== null ? ` ${d.salida_pcp.exigida.porcentaje}%` : ''} · {d.salida_pcp.exigida.detalle}</div>
              : <Vacio texto="Hoy no se cumple ninguna condición de salida." />}
            {d.salida_pcp.zona_recompra && (
              <div style={{ fontSize: 12, color: C.warning, fontWeight: 700, marginTop: 4 }}>
                Zona de posible recompra: el precio está en o bajo el stop ({d.salida_pcp.recompras_restantes ?? '—'} recompra(s) disponible(s)). Es solo un aviso: la Oficina no vende ni compra sola.
              </div>
            )}
            {d.salida_pcp.faltantes.map((x, i) => <div key={i} style={{ fontSize: 11, color: C.warning, marginTop: 3 }}>• {x}</div>)}
          </Seccion>
        )}

        {d.valuacion && (
          <Seccion titulo="Valuación por código (modelo de /position)">
            {d.valuacion.per && (
              <div style={{ fontSize: 12, marginBottom: 6, fontWeight: 700, color: d.valuacion.per.relacion === 'por_debajo' ? C.success : d.valuacion.per.relacion === 'por_encima' ? C.danger : C.warning }}>
                {d.valuacion.per.relacion === null
                  ? `P/E vs promedio de 5 años: no evaluable (${d.valuacion.per.motivo ?? 'faltan datos'})`
                  : `P/E actual ${d.valuacion.per.per_actual?.toFixed(1)}x ${d.valuacion.per.relacion === 'por_debajo' ? 'por debajo' : 'igual o por encima'} del promedio de ${d.valuacion.per.puntos} años ${d.valuacion.per.per_promedio?.toFixed(1)}x · ${d.valuacion.per.relacion === 'por_debajo' ? 'BARATA: se puede comprar' : 'CARA: no se compra'}`}
              </div>
            )}
            {d.valuacion.precio_objetivo === null
              ? <div style={{ fontSize: 12, color: C.warning }}>No se pudo calcular: {d.valuacion.motivo ?? 'faltan datos'}</div>
              : (
                <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.7 }}>
                  <div>P/E objetivo <b>{d.valuacion.pe_objetivo?.toFixed(1)}x</b> ({d.valuacion.origen_pe}) × EPS a {d.valuacion.anios} años <b>{d.valuacion.eps?.toFixed(2)}</b> ({d.valuacion.origen_eps})</div>
                  <div>Precio objetivo <b>{d.valuacion.precio_objetivo.toFixed(2)}</b> · cierre usado <b>{d.valuacion.cierre?.toFixed(2) ?? '—'}</b> ({d.valuacion.fecha ?? '—'})</div>
                  <div>Ganancia total <b>{d.valuacion.ganancia_total_pct?.toFixed(1) ?? '—'}%</b> · anualizada a {d.valuacion.anios} años <b style={{ color: (d.valuacion.ganancia_anualizada_pct ?? 0) >= 14 ? C.success : C.warning }}>{d.valuacion.ganancia_anualizada_pct?.toFixed(2) ?? '—'}%</b> (mínimo 14%)</div>
                </div>
              )}
            {d.valuacion.avisos.map((x, i) => <div key={i} style={{ fontSize: 11, color: C.warning, marginTop: 3 }}>• {x}</div>)}
          </Seccion>
        )}

        {d.ficha_propuesta && (
          <Seccion titulo="Ficha PMP-09 propuesta (borrador, sin aprobar)">
            {d.ficha_propuesta.propuesta.map(p => (
              <div key={p.apartado} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: C.accent, fontWeight: 700 }}>{etiqueta(p.apartado)}</div>
                <div style={{ fontSize: 12, color: '#ccc', wordBreak: 'break-word' }}>{p.texto}</div>
                <div style={{ fontSize: 10, color: '#555' }}>Fuente: {p.fuente}</div>
              </div>
            ))}
            {d.ficha_propuesta.no_propuestos.map((x, i) => <div key={i} style={{ fontSize: 11, color: C.warning, marginTop: 3 }}>• {x}</div>)}
          </Seccion>
        )}

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

        <RevisionPmp />

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

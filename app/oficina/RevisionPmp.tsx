'use client'

import { useEffect, useState } from 'react'
import { authedFetch } from '@/lib/authed-fetch'
import { supabase } from '@/lib/supabase'
import { estadoRevision, leerHistorial } from '@/lib/oficina/conexion/revision-pmp-historial'

// Panel «Revisión semestral PMP» (PMP-11): eliges o escribes un ticker y pulsas. Cada revisión se guarda en el historial del expediente PMP del ticker (si lo tiene) y el panel
// muestra cuándo toca la siguiente (cada 6 meses). Nunca compra ni vende.
// Todo el código vive aquí; la página solo dibuja <RevisionPmp />.

interface Criterio { codigo: string; estado: string; detalle: string }
interface Resultado {
  ok: boolean; error?: string; ticker?: string; fecha?: string
  resultado?: 'revisar_venta_100' | 'mantener' | 'no_evaluable'
  motivos?: string[]
  rendimiento?: { estado: string; anualizado_pct: number | null; detalle: string }
  fundamentales?: { estado: string; deterioros: number; sin_datos: number; criterios: Criterio[] }
  valuacion?: { valor: number; fecha: string; horizonte_meses: number; fuente?: string } | null
  modelo?: { anios: number; pe_objetivo: number | null; origen_pe: string | null; eps: number | null; origen_eps: string | null; precio_objetivo: number | null; ganancia_total_pct: number | null; ganancia_anualizada_pct: number | null; motivo: string | null } | null
  cierre?: { valor: number; fecha: string } | null
  periodo_fundamentales?: string | null
  avisos?: string[]
  guardada?: boolean; guardada_motivo?: string | null; proxima_revision?: string | null
}

const COLOR: Record<string, string> = { revisar_venta_100: '#f43f5e', mantener: '#22c55e', no_evaluable: '#eab308' }
const TEXTO: Record<string, string> = { revisar_venta_100: 'REVISAR VENTA DEL 100%', mantener: 'MANTENER', no_evaluable: 'NO EVALUABLE' }
const COLOR_CRITERIO: Record<string, string> = { deterioro: '#f43f5e', sin_deterioro: '#22c55e', no_evaluable: '#eab308' }
const etiqueta = (s: string) => s.replace(/_/g, ' ')

export default function RevisionPmp() {
  const [ticker, setTicker] = useState('')
  const [abiertas, setAbiertas] = useState<string[]>([])
  const [cargandoLista, setCargandoLista] = useState(true)
  const [todas, setTodas] = useState<Record<string, Resultado>>({})
  const [progreso, setProgreso] = useState('')
  const [anios, setAnios] = useState(1)
  const [cargando, setCargando] = useState(false)
  const [res, setRes] = useState<Resultado | null>(null)
  const [fallo, setFallo] = useState('')
  const [guardar, setGuardar] = useState(true)
  const [fichas, setFichas] = useState<Record<string, unknown>>({})

  // Posiciones abiertas de PMP (trades abiertos cuyo portafolio se llama PMP): la primera queda elegida por omisión.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data, error } = await supabase.from('trades').select('ticker, portfolios(name)').eq('status', 'open')
      if (!vivo) return
      if (!error) {
        const lista = Array.from(new Set((data ?? []).filter((t: any) => /(^|[^A-Za-z])PMP([^A-Za-z]|$)/i.test(String(t?.portfolios?.name ?? ''))).map((t: any) => String(t.ticker).toUpperCase()))).sort()
        setAbiertas(lista)
        setTicker(prev => prev || lista[0] || '')
      }
      setCargandoLista(false)
    })()
    return () => { vivo = false }
  }, [])

  // Historial guardado: la ficha de cada expediente PMP (la lectura usa tu sesión; solo ves lo tuyo).
  const cargarFichas = async () => {
    const { data, error } = await supabase.from('oficina_expedientes').select('ticker, ficha').eq('portafolio_codigo', 'PMP')
    if (error) return
    const m: Record<string, unknown> = {}
    for (const f of (data ?? []) as any[]) m[String(f.ticker).toUpperCase()] = f.ficha
    setFichas(m)
    setTicker(prev => prev || Object.keys(m).sort()[0] || '')
  }
  useEffect(() => { cargarFichas() }, [])
  const hoy = new Date().toISOString().slice(0, 10)
  // Calendario: posiciones PMP abiertas + cualquier ticker con expediente PMP (así no depende del nombre del portafolio en trades).
  const calendario = Array.from(new Set([...abiertas, ...Object.keys(fichas)])).sort()

  const pedir = async (t: string): Promise<Resultado> => {
    try {
      const r = await authedFetch('/api/oficina/revision-pmp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: t, anios, guardar }) })
      const j = (await r.json().catch(() => null)) as Resultado | null
      if (!j) return { ok: false, error: `El servidor respondió ${r.status} sin detalle` }
      return j
    } catch {
      return { ok: false, error: 'No se pudo conectar con el servidor' }
    }
  }

  const revisarTodas = async () => {
    if (abiertas.length === 0) return
    setCargando(true); setRes(null); setFallo(''); setTodas({})
    for (let i = 0; i < abiertas.length; i++) {
      const t = abiertas[i]!
      setProgreso(`Revisando ${t} (${i + 1} de ${abiertas.length})…`)
      const r = await pedir(t)
      setTodas(prev => ({ ...prev, [t]: r }))
      if (i < abiertas.length - 1) await new Promise(ok => setTimeout(ok, 6000)) // el servidor exige unos segundos entre consultas
    }
    setProgreso(''); setCargando(false); cargarFichas()
  }

  const revisar = async () => {
    const t = ticker.trim().toUpperCase()
    if (!/^[A-Z0-9.\-]{1,10}$/.test(t)) { setFallo('Escribe un ticker válido'); return }
    setCargando(true); setRes(null); setFallo('')
    try {
      const r = await authedFetch('/api/oficina/revision-pmp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: t, anios, guardar }) })
      const j = (await r.json().catch(() => null)) as Resultado | null
      if (!j) { setFallo(`El servidor respondió ${r.status} sin detalle`); return }
      if (!j.ok) { setFallo(j.error ?? 'Error desconocido'); return }
      setRes(j)
    } catch {
      setFallo('No se pudo conectar con el servidor')
    } finally {
      setCargando(false); cargarFichas()
    }
  }

  const verResultado = (res: Resultado, clave?: string) => (
        <div key={clave} style={{ marginTop: 12, fontSize: 12, color: '#ccc', borderTop: clave ? '1px solid #151515' : undefined, paddingTop: clave ? 10 : 0 }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 900, color: COLOR[res.resultado ?? 'no_evaluable'], border: `1px solid ${COLOR[res.resultado ?? 'no_evaluable']}`, borderRadius: 4, padding: '2px 8px' }}>{TEXTO[res.resultado ?? 'no_evaluable']}</span>
            <span style={{ marginLeft: 8, color: '#666' }}>{res.ticker} · {res.fecha} · la venta nunca es automática</span>
          </div>
          {(res.motivos ?? []).map((m, i) => <div key={i} style={{ color: '#eab308', marginBottom: 3 }}>• {m}</div>)}
          <div style={{ marginTop: 8 }}><b>Rendimiento:</b> {res.rendimiento?.detalle}</div>
          {res.modelo && res.modelo.precio_objetivo != null && (
            <div style={{ color: '#888', marginTop: 3 }}>
              Modelo: P/E objetivo {res.modelo.pe_objetivo?.toFixed(1)}x ({res.modelo.origen_pe}) · EPS a {res.modelo.anios} {res.modelo.anios === 1 ? 'año' : 'años'} {res.modelo.eps?.toFixed(2)} ({res.modelo.origen_eps}) · precio objetivo {res.modelo.precio_objetivo.toFixed(2)} · ganancia anualizada {res.modelo.ganancia_anualizada_pct?.toFixed(1)}%
            </div>
          )}
          <div style={{ color: '#666', marginBottom: 8 }}>
            Valor estimado: {res.valuacion ? `${res.valuacion.valor} (${res.valuacion.fuente || res.valuacion.fecha}, horizonte ${res.valuacion.horizonte_meses} meses)` : 'sin declarar'} · Cierre: {res.cierre ? `${res.cierre.valor} (${res.cierre.fecha})` : 'sin dato'}
          </div>
          <div><b>Fundamentales</b> ({res.periodo_fundamentales ?? 'sin periodo comparable'}): {res.fundamentales?.deterioros} de 4 deterioros · {res.fundamentales?.sin_datos} sin datos</div>
          {(res.fundamentales?.criterios ?? []).map(c => (
            <div key={c.codigo} style={{ marginTop: 3 }}>
              <span style={{ color: COLOR_CRITERIO[c.estado] ?? '#aaa', fontWeight: 700 }}>{etiqueta(c.estado)}</span> · {etiqueta(c.codigo)}: <span style={{ color: '#888' }}>{c.detalle}</span>
            </div>
          ))}
          <div style={{ marginTop: 8, color: res.guardada ? '#22c55e' : '#888', fontSize: 11 }}>
            {res.guardada ? `Guardada en el historial · próxima revisión: ${res.proxima_revision}` : res.guardada_motivo ? `No se guardó: ${res.guardada_motivo}` : 'No se guardó (casilla desmarcada)'}
          </div>
          {(res.avisos ?? []).length > 0 && (
            <div style={{ marginTop: 8, color: '#666', fontSize: 11 }}>{(res.avisos ?? []).slice(0, 8).map((a, i) => <div key={i}>• {a}</div>)}</div>
          )}
        </div>
  )

  return (
    <div style={{ background: '#080808', border: '1px solid #1a1a1a', borderRadius: 10, padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Revisión semestral PMP (PMP-11)</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Escribe cualquier ticker o elige una de tus posiciones PMP abiertas (la primera ya viene puesta). No necesita una corrida previa de la Oficina. */}
        <input value={ticker} list="posiciones-pmp" onChange={e => setTicker(e.target.value.toUpperCase().replace(/\s/g, ''))} onKeyDown={e => { if (e.key === 'Enter' && !cargando) revisar() }}
          placeholder={cargandoLista ? 'Cargando…' : 'Ticker (ej. META)'} disabled={cargando} autoComplete="off"
          style={{ background: '#000', border: '1px solid #222', color: 'white', padding: '8px 10px', borderRadius: 6, fontSize: 13, outline: 'none', width: 150 }} />
        <datalist id="posiciones-pmp">{abiertas.map(t => <option key={t} value={t} />)}</datalist>
        <label style={{ fontSize: 11, color: '#888', display: 'flex', alignItems: 'center', gap: 6 }}>Objetivo a
          <select value={anios} onChange={e => setAnios(Number(e.target.value))} disabled={cargando}
            style={{ background: '#000', border: '1px solid #222', color: 'white', padding: '7px 8px', borderRadius: 6, fontSize: 12 }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} {n === 1 ? 'año' : 'años'}</option>)}
          </select>
        </label>
        <button onClick={revisar} disabled={cargando}
          style={{ background: '#0a0a0a', border: '1px solid #222', color: cargando ? '#444' : '#00bfff', padding: '8px 14px', borderRadius: 6, fontWeight: 700, cursor: cargando ? 'default' : 'pointer', fontSize: 12 }}>
          {cargando ? 'Revisando…' : 'Revisar'}
        </button>
        {abiertas.length > 1 && (
          <button onClick={revisarTodas} disabled={cargando}
            style={{ background: '#0a0a0a', border: '1px solid #222', color: cargando ? '#444' : '#22c55e', padding: '8px 14px', borderRadius: 6, fontWeight: 700, cursor: cargando ? 'default' : 'pointer', fontSize: 12 }}>
            Revisar todas ({abiertas.length})
          </button>
        )}
        <label style={{ fontSize: 11, color: '#888', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={guardar} onChange={e => setGuardar(e.target.checked)} disabled={cargando} /> Guardar en el historial
        </label>
        <span style={{ fontSize: 10, color: '#555' }}>Elige una posición PMP abierta o escribe cualquier ticker. Nunca vende ni compra. Usa el modelo de valuación de /position (P/E objetivo × EPS).</span>
      </div>
      {calendario.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 11 }}>
          <div style={{ color: '#666', marginBottom: 4 }}>Calendario semestral (primera revisión formal de la regla: 2027-04-06)</div>
          {calendario.map(t => {
            const e = estadoRevision(fichas[t], hoy)
            const color = e.estado === 'vencida' ? '#f43f5e' : e.estado === 'al_dia' ? '#22c55e' : '#eab308'
            return (
              <div key={t} style={{ color: '#aaa', marginBottom: 2 }}>
                <b style={{ color: 'white' }}>{t}</b> · <span style={{ color, fontWeight: 700 }}>{e.estado === 'nunca' ? 'sin revisar' : e.estado === 'vencida' ? 'revisión vencida' : 'al día'}</span>
                {e.ultima && <span style={{ color: '#888' }}> · última {e.ultima.fecha}: {TEXTO[e.ultima.resultado] ?? e.ultima.resultado}{e.ultima.anualizada_pct != null ? ` (${e.ultima.anualizada_pct}% anualizado)` : ''} · próxima {e.proxima}</span>}
              </div>
            )
          })}
        </div>
      )}
      {ticker !== '' && leerHistorial(fichas[ticker]).length > 0 && (
        <details style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
          <summary style={{ cursor: 'pointer' }}>Historial de {ticker} ({leerHistorial(fichas[ticker]).length})</summary>
          {leerHistorial(fichas[ticker]).slice().reverse().map(h => (
            <div key={h.fecha} style={{ marginTop: 3 }}>{h.fecha} · <b style={{ color: COLOR[h.resultado] ?? '#aaa' }}>{TEXTO[h.resultado] ?? h.resultado}</b> · {h.anualizada_pct != null ? `${h.anualizada_pct}% a ${h.anios} año(s)` : 'sin rendimiento'} · {h.deterioros} deterioros, {h.sin_datos} sin datos{h.motivos.length > 0 ? ` · ${h.motivos[0]}` : ''}</div>
          ))}
        </details>
      )}
      {fallo && <div style={{ color: '#f43f5e', fontSize: 12, marginTop: 10 }}>{fallo}</div>}

      {progreso && <div style={{ color: '#00bfff', fontSize: 12, marginTop: 10 }}>{progreso}</div>}
      {res && res.resultado && verResultado(res)}
      {Object.entries(todas).map(([t, r]) => (r.resultado ? verResultado(r, t) : <div key={t} style={{ color: '#f43f5e', fontSize: 12, marginTop: 10 }}>{t}: {r.error ?? 'sin resultado'}</div>))}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'
import { authedFetch } from '@/lib/authed-fetch'
import { tieneCompetidor } from '@/lib/competidores'
import { portafoliosParaCorrida } from '@/lib/portafolios-watchlist'

// Botón «Analizar en la Oficina» de la watchlist y de Trades abiertos: hace lo mismo que analizar-fundamental.ps1 (con -ConToken -Guardar), sin abrir PowerShell.
// Todo el código vive aquí; la página solo dibuja <BotonAnalizarOficina ticker=... portafolios=... />.
// v0.61: el portafolio ya está declarado en la fila (watchlist: campo Portafolios; Trades abiertos: su portafolio) y el monto es fijo por portafolio, así que al dar clic
// el análisis arranca de inmediato y se abre la ventana con el avance y el resultado. Solo si el portafolio no se puede decidir solo (ninguno, o más de uno marcado)
// se abre la ventana con el selector, como antes.
// v0.68b: si la fila tiene PMP y PCP marcados, la corrida se hace para AMBOS, una tras otra (primero PMP), y la ventana muestra el resultado de cada uno.

const PORTAFOLIOS = ['PMP', 'PCP', 'PLP', 'ETF', 'SEMILLA'] as const
// Monto fijo por portafolio. PLP y ETF no llevan monto (sus activos ya están comprados; una sustitución entra con lo que dejó la venta), y una posición abierta tampoco.
const MONTO_POR_PORTAFOLIO: Record<string, string> = { PMP: '50', PCP: '25', SEMILLA: '5' }
const SIN_MONTO = ['PLP', 'ETF']
// El servidor pide 30 s entre un análisis y otro (cuenta desde que EMPIEZA el anterior): un análisis que falla pronto deja la siguiente llamada dentro de esa espera.
const ESPERA_ENTRE_ANALISIS_MS = 31_000
const ESPERA_REINTENTO_MS = 31_000
const etiqueta = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—')

interface Resultado { ok: boolean; decision?: string | null; estado_final?: string; auditoria_veredicto?: string | null; motivos?: { codigo: string; detalle: string }[]; error?: string; etapa?: string; problemas?: string[]; avisos_datos?: string[]
  // v0.80: la posición PCP está en la zona de recompra → el botón encadena la evaluación de recompra y la deja aquí
  comparacion_sugerencia?: { ticker: string; texto: string };
  aviso_riesgo_pais?: string;
  recompra_sugerida?: { zona: boolean; restantes: number | null; monto_siguiente: string | null; por_stop?: boolean; por_senal?: boolean }; recompra_res?: Resultado | null; recompra_fallo?: string }

// Código de portafolio (PMP, PCP...) a partir del nombre del portafolio de Trades abiertos (por ejemplo «PMP» o «PMP · Mediano plazo»); null si no coincide.
function codigoDeNombre(nombre: string | null | undefined): string | null {
  const n = (nombre ?? '').toUpperCase()
  const porCodigo = (PORTAFOLIOS as readonly string[]).find(p => new RegExp(`(^|[^A-Z])${p}([^A-Z]|$)`).test(n))
  if (porCodigo !== undefined) return porCodigo
  // v0.61: los portafolios de Trades abiertos también se llaman por plazo (corto, mediano, largo)
  const plazos = [['CORTO', 'PCP'], ['MEDIANO', 'PMP'], ['LARGO', 'PLP']].filter(([palabra]) => n.includes(palabra as string))
  return plazos.length === 1 ? (plazos[0]![1] as string) : null
}

// `abierta` = se usa desde Trades abiertos: la posición ya existe, así que no se pide monto. `portafolioNombre` = nombre del portafolio del trade.
export default function BotonAnalizarOficina({ ticker, portafolios, portafolioNombre, abierta = false, grande = false, competidores }: { ticker: string; portafolios?: string[] | null; portafolioNombre?: string | null; abierta?: boolean; grande?: boolean; competidores?: string | null }) {
  // Portafolios candidatos de la fila: los marcados en la watchlist; si no hay, el del trade abierto. Con exactamente uno se analiza sin preguntar.
  const candidatos = (): string[] => {
    const marcados = (portafolios ?? []).filter(p => (PORTAFOLIOS as readonly string[]).includes(p))
    if (marcados.length > 0) return marcados
    const c = codigoDeNombre(portafolioNombre)
    return c !== null ? [c] : []
  }
  const elegir = (): string => candidatos()[0] ?? 'PMP'
  const montoPor = (p: string): string => (abierta ? '' : MONTO_POR_PORTAFOLIO[p] ?? '')
  const inicial = elegir()
  const [abierto, setAbierto] = useState(false)
  const [portafolio, setPortafolio] = useState<string>(inicial)
  const [monto, setMonto] = useState<string>(montoPor(inicial))
  const [corriendo, setCorriendo] = useState(false)
  const [res, setRes] = useState<Resultado | null>(null)
  const [fallo, setFallo] = useState('')
  const [elegirAMano, setElegirAMano] = useState(false)
  // Corrida para varios portafolios (PMP y PCP marcados): lista a correr, el que va en marcha y los resultados ya listos
  const [modoLote, setModoLote] = useState<string[] | null>(null)
  const [loteActual, setLoteActual] = useState('')
  const [loteRes, setLoteRes] = useState<{ portafolio: string; res: Resultado | null; fallo: string }[]>([])

  const abrir = () => {
    if (corriendo) { setAbierto(true); return }
    // Watchlist: una corrida necesita al menos un competidor (Trades abiertos no pasa la prop y no se exige)
    if (competidores !== undefined && !tieneCompetidor(competidores)) { alert('Agrega al menos un competidor (hasta 4) en la fila de ' + ticker + ' antes de analizar'); return }
    const lote = abierta ? null : portafoliosParaCorrida(portafolios)
    if (lote !== null && lote.length >= 2) { setModoLote(lote); setLoteRes([]); setRes(null); setFallo(''); setElegirAMano(false); setAbierto(true); void analizarLote(lote); return }
    setModoLote(null)
    const c = candidatos()
    const p = elegir()
    setPortafolio(p); setMonto(montoPor(p)); setRes(null); setFallo(''); setAbierto(true)
    if (c.length === 1) { setElegirAMano(false); void analizar(p, montoPor(p)) }
    else setElegirAMano(true)
  }
  const cambiarPortafolio = (p: string) => { setPortafolio(p); setMonto(montoPor(p)) }

  // Una llamada al análisis de un portafolio. Un 429 (demasiado pronto) se reintenta una vez tras unos segundos.
  const llamar = async (portafolioUsado: string, montoUsado: string, evaluacion?: 'recompra'): Promise<{ res: Resultado | null; fallo: string }> => {
    const m = montoUsado.trim()
    if (m !== '' && !/^\d{1,9}(\.\d{1,2})?$/.test(m)) return { res: null, fallo: 'El monto debe ser un número positivo en USD con hasta 2 decimales' }
    for (let intento = 0; intento < 2; intento++) {
      try {
        const r = await authedFetch('/api/oficina/analisis-fundamental', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker, portafolio: portafolioUsado, con_director: true, guardar: true, ...(m !== '' ? { monto: Number(m) } : {}), ...(evaluacion !== undefined ? { evaluacion } : {}) }),
        })
        if (r.status === 429 && intento === 0) { await new Promise(x => setTimeout(x, ESPERA_REINTENTO_MS)); continue }
        if (r.status === 429) return { res: null, fallo: 'Espera unos segundos entre un análisis y otro y vuelve a intentar' }
        const j = (await r.json().catch(() => null)) as Resultado | null
        if (!j) return { res: null, fallo: `El servidor respondió ${r.status} sin detalle` }
        // v0.80: posición PCP en zona de recompra → evaluar la recompra con el monto que toca (25 o 50). El servidor pide 30 s entre análisis.
        const rs = j.recompra_sugerida
        if (evaluacion === undefined && (portafolioUsado === 'PCP' || portafolioUsado === 'PMP' || portafolioUsado === 'PLP') && j.ok && rs?.zona === true && rs.monto_siguiente !== null) {
          await new Promise(x => setTimeout(x, ESPERA_ENTRE_ANALISIS_MS))
          const r2 = await llamar(portafolioUsado, rs.monto_siguiente, 'recompra')
          j.recompra_res = r2.res; j.recompra_fallo = r2.fallo
        }
        return { res: j, fallo: '' }
      } catch {
        return { res: null, fallo: 'No se pudo conectar con el servidor (el análisis puede seguir en marcha: revísalo en /oficina en un minuto)' }
      }
    }
    return { res: null, fallo: 'Espera unos segundos entre un análisis y otro y vuelve a intentar' }
  }

  const analizar = async (portafolioUsado: string = portafolio, montoUsado: string = monto) => {
    setCorriendo(true); setRes(null); setFallo('')
    try {
      const o = await llamar(portafolioUsado, montoUsado)
      setRes(o.res); setFallo(o.fallo)
    } finally {
      setCorriendo(false)
    }
  }

  // PMP y PCP marcados: una corrida por portafolio, en orden, cada una con su monto fijo (PMP 50, PCP 25). El resultado de cada una queda en pantalla en cuanto termina.
  const analizarLote = async (lista: string[]) => {
    setCorriendo(true); setRes(null); setFallo(''); setLoteRes([])
    try {
      let inicioAnterior = 0
      for (const p of lista) {
        setLoteActual(p)
        const falta = inicioAnterior === 0 ? 0 : ESPERA_ENTRE_ANALISIS_MS - (Date.now() - inicioAnterior)
        if (falta > 0) await new Promise(x => setTimeout(x, falta))
        inicioAnterior = Date.now()
        const o = await llamar(p, montoPor(p))
        setLoteRes(prev => [...prev, { portafolio: p, res: o.res, fallo: o.fallo }])
      }
    } finally {
      setLoteActual(''); setCorriendo(false)
    }
  }

  const btn: React.CSSProperties = grande
    ? { flex: 1, minHeight: 42, borderRadius: 8, border: '1px solid #1a1a1a', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#22c55e' }
    : { background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#333', display: 'flex', transition: 'color 0.2s' }
  const sel: React.CSSProperties = { background: '#000', border: '1px solid #222', color: 'white', padding: '8px 10px', borderRadius: 6, fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }

  // Tarjeta con el resultado de una corrida
  const tarjetaRes = (res: Resultado) => (
    <div style={{ border: '1px solid #151515', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 12 }}>
                  {res.ok ? (
                    <>
                      <div style={{ fontWeight: 700, color: '#22c55e', marginBottom: 4 }}>Corrida guardada</div>
                      <div style={{ color: '#ccc' }}>Decisión: <b>{etiqueta(res.decision)}</b> · Estado: {etiqueta(res.estado_final)} · Auditor: {etiqueta(res.auditoria_veredicto)}</div>
                      {(res.motivos ?? []).slice(0, 4).map((m, i) => <div key={i} style={{ color: '#eab308', marginTop: 3 }}>• {etiqueta(m.codigo)}: {m.detalle}</div>)}
                      {(res.avisos_datos ?? []).length > 0 && (
                        <details style={{ marginTop: 8 }}>
                          <summary style={{ cursor: 'pointer', color: '#888', fontSize: 11 }}>Avisos de datos ({(res.avisos_datos ?? []).length})</summary>
                          <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: 4, fontSize: 10, color: '#777' }}>
                            {(res.avisos_datos ?? []).map((x, i) => <div key={i}>• {x}</div>)}
                          </div>
                        </details>
                      )}
                      {res.aviso_riesgo_pais && (
                        <div style={{ marginTop: 8, color: '#eab308' }}>{res.aviso_riesgo_pais}</div>
                      )}
                      {res.comparacion_sugerencia && (
                        <div style={{ marginTop: 8, color: '#eab308' }}>{res.comparacion_sugerencia.texto}</div>
                      )}
                      {res.recompra_sugerida?.zona === true && (
                        <div style={{ marginTop: 10, borderTop: '1px solid #151515', paddingTop: 8 }}>
                          <div style={{ fontWeight: 700, color: '#eab308', marginBottom: 4 }}>{res.recompra_sugerida.por_stop === true || res.recompra_sugerida.por_senal === true ? `Recompra ${(res as { portafolio?: string }).portafolio ?? portafolio} (${[res.recompra_sugerida.por_stop ? 'stop tocado' : '', res.recompra_sugerida.por_senal ? 'señal de recompra' : ''].filter(Boolean).join(' y ')})` : 'Zona de recompra'}: evaluación de recompra{res.recompra_sugerida.monto_siguiente ? ` (${res.recompra_sugerida.monto_siguiente} USD)` : ''}</div>
                          {res.recompra_res?.ok ? (
                            <>
                              <div style={{ color: '#ccc' }}>Decisión: <b>{etiqueta(res.recompra_res.decision)}</b> · Estado: {etiqueta(res.recompra_res.estado_final)} · Auditor: {etiqueta(res.recompra_res.auditoria_veredicto)}</div>
                              {(res.recompra_res.motivos ?? []).slice(0, 4).map((m, i) => <div key={i} style={{ color: '#eab308', marginTop: 3 }}>• {etiqueta(m.codigo)}: {m.detalle}</div>)}
                            </>
                          ) : (
                            <div style={{ color: '#ef4444' }}>{res.recompra_res?.error ?? (res.recompra_fallo || (res.recompra_sugerida.monto_siguiente ? 'No se pudo evaluar la recompra' : 'No toca recompra automática (revisa tus compras)'))}{(res.recompra_res?.problemas ?? []).map((x, i) => <div key={i}>• {x}</div>)}</div>
                          )}
                        </div>
                      )}
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
  )

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

            {modoLote !== null ? (
              <div style={{ fontSize: 12, color: '#ccc', marginBottom: 10 }}>
                Corrida para <b>{modoLote.join(' + ')}</b> · {modoLote.map(p => `${p} ${montoPor(p)} USD`).join(' · ')}
              </div>
            ) : elegirAMano ? (
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
            ) : (
              <div style={{ fontSize: 12, color: '#ccc', marginBottom: 10 }}>
                Portafolio <b>{portafolio}</b>{abierta ? ' · posición abierta' : monto !== '' ? ` · monto ${monto} USD` : ''}
              </div>
            )}
            {modoLote !== null
              ? <div style={{ fontSize: 10, color: '#555', marginBottom: 10 }}>Una corrida por portafolio, una tras otra. Guarda las corridas; no compra ni vende nada.</div>
              : <div style={{ fontSize: 10, color: '#555', marginBottom: 10 }}>{abierta ? 'Posición abierta: no necesita monto. ' : monto === '' && !SIN_MONTO.includes(portafolio) ? 'Sin monto, el Auditor no evalúa la regla del monto (queda NO EVALUABLE). ' : ''}Guarda la corrida; no compra ni vende nada.</div>}

            {corriendo && <div style={{ color: '#00bfff', fontSize: 12, marginBottom: 10 }}>{modoLote !== null && loteActual !== '' ? `Analizando ${loteActual} (${loteRes.length + 1} de ${modoLote.length})… ` : 'Analizando… '}puede tardar uno o dos minutos por portafolio. No cierres esta ventana.</div>}
            {fallo && <div style={{ color: '#f43f5e', fontSize: 12, marginBottom: 10 }}>{fallo}</div>}

            {modoLote === null && res && tarjetaRes(res)}
            {modoLote !== null && loteRes.map(x => (
              <div key={x.portafolio} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#888', fontWeight: 900, marginBottom: 4 }}>{x.portafolio}</div>
                {x.res ? tarjetaRes(x.res) : <div style={{ color: '#f43f5e', fontSize: 12 }}>{x.fallo}</div>}
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setAbierto(false)} disabled={corriendo} style={{ background: '#0a0a0a', color: '#aaa', border: '1px solid #222', padding: '8px 14px', borderRadius: 6, cursor: corriendo ? 'default' : 'pointer', fontSize: 13 }}>Cerrar</button>
              <button onClick={() => { void (modoLote !== null ? analizarLote(modoLote) : analizar()) }} disabled={corriendo}
                style={{ background: '#1b2a1b', color: '#22c55e', border: '1px solid #2d4a2d', padding: '8px 14px', borderRadius: 6, fontWeight: 700, cursor: corriendo ? 'default' : 'pointer', fontSize: 13, opacity: corriendo ? 0.6 : 1 }}>
                {corriendo ? 'Analizando…' : res || fallo !== '' || loteRes.length > 0 ? 'Analizar otra vez' : 'Analizar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

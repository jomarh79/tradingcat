'use client'

import { useState } from 'react'
import { MAX_COMPETIDORES, clasificarCompetidor, formatearCompetidores, parseCompetidores, validarCasillas } from '@/lib/competidores'

// Columna «Competidores» de la watchlist: hasta 4 casillas, una por ticker. Al mostrarlos, cada ticker se pinta en VERDE si ya está en la watchlist y en
// AMARILLO si ya tienes una posición abierta de ese ticker (el amarillo manda). Todo el código vive aquí y en lib/competidores.ts; la página solo dibuja
// <CompetidoresCeldas ... /> y guarda lo que este componente le entrega.
// `onGuardar` devuelve null si se guardó o el mensaje de error si no.

const COLOR: Record<'abierto' | 'watchlist' | 'ninguno', string> = { abierto: '#eab308', watchlist: '#22c55e', ninguno: '#888' }
const AYUDA: Record<'abierto' | 'watchlist' | 'ninguno', string> = {
  abierto: 'Ya tienes una posición abierta de este ticker',
  watchlist: 'Ya está en tu watchlist',
  ninguno: 'No está en tu watchlist ni en tus posiciones abiertas',
}

export default function CompetidoresCeldas({ ticker, valor, enWatchlist, enAbiertos, onGuardar, ancho = false }: {
  ticker: string
  valor: string | null
  enWatchlist: ReadonlySet<string>
  enAbiertos: ReadonlySet<string>
  onGuardar: (valor: string) => Promise<string | null>
  /** Celular: las casillas ocupan el ancho de la tarjeta (2 por renglón). */
  ancho?: boolean
}) {
  const actuales = parseCompetidores(valor)
  const [editando, setEditando] = useState(false)
  const [casillas, setCasillas] = useState<string[]>(['', '', '', ''])
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const abrir = () => {
    const c = Array.from({ length: MAX_COMPETIDORES }, (_, i) => actuales[i] ?? '')
    setCasillas(c); setError(''); setEditando(true)
  }
  const cancelar = () => { if (!guardando) { setEditando(false); setError('') } }

  const guardar = async () => {
    if (guardando) return
    const v = validarCasillas(casillas, ticker)
    if (!v.ok) { setError(v.error); return }
    const nuevo = formatearCompetidores(v.tickers)
    if (nuevo === formatearCompetidores(actuales)) { setEditando(false); return }   // sin cambios
    setGuardando(true); setError('')
    const fallo = await onGuardar(nuevo)
    setGuardando(false)
    if (fallo !== null) { setError(fallo); return }
    setEditando(false)
  }

  const inp: React.CSSProperties = {
    background: '#000', border: '1px solid #222', color: 'white', padding: ancho ? '8px 8px' : '4px 6px', borderRadius: 6, outline: 'none',
    fontSize: ancho ? 14 : '0.8rem', width: ancho ? '100%' : 64, minWidth: 0, boxSizing: 'border-box', textTransform: 'uppercase',
  }
  const boton = (color: string): React.CSSProperties => ({
    background: 'none', border: `1px solid ${color}`, color, borderRadius: 6, padding: ancho ? '8px 12px' : '3px 10px', fontSize: ancho ? 13 : 11, fontWeight: 700,
    cursor: guardando ? 'default' : 'pointer', opacity: guardando ? 0.5 : 1,
  })

  if (editando) {
    return (
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: ancho ? 'stretch' : 'center' }}>
        <div style={ancho ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 } : { display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 150 }}>
          {casillas.map((c, i) => (
            <input key={i} value={c} maxLength={10} autoFocus={i === 0} disabled={guardando} placeholder={`Ticker ${i + 1}`} aria-label={`Competidor ${i + 1} de ${ticker}`}
              onChange={e => setCasillas(prev => prev.map((x, j) => (j === i ? e.target.value.toUpperCase().replace(/\s/g, '') : x)))}
              onKeyDown={e => { if (e.key === 'Enter') void guardar(); if (e.key === 'Escape') cancelar() }}
              style={inp} />
          ))}
        </div>
        {error && <div style={{ color: '#f43f5e', fontSize: 11, whiteSpace: 'normal', maxWidth: ancho ? undefined : 190 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 6, justifyContent: ancho ? 'flex-start' : 'center' }}>
          <button onClick={() => void guardar()} disabled={guardando} style={boton('#22c55e')}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          <button onClick={cancelar} disabled={guardando} style={boton('#888')}>Cancelar</button>
        </div>
      </div>
    )
  }

  return (
    <span onClick={abrir} style={{ cursor: 'pointer', whiteSpace: 'normal' }} title="Clic para editar (hasta 4 tickers). Verde = ya está en tu watchlist · Amarillo = ya tienes posición abierta">
      {actuales.length === 0
        ? <span style={{ color: '#333' }}>—</span>
        : actuales.map((t, i) => {
            const clase = clasificarCompetidor(t, enWatchlist, enAbiertos)
            return (
              <span key={t} title={AYUDA[clase]} style={{ color: COLOR[clase], fontSize: ancho ? 13 : 11, fontWeight: clase === 'ninguno' ? 400 : 700 }}>
                {t}{i < actuales.length - 1 ? <span style={{ color: '#555' }}>, </span> : null}
              </span>
            )
          })}
    </span>
  )
}

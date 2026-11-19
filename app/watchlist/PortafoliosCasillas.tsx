'use client'

import { PORTAFOLIOS_WATCHLIST, alternarPortafolio, portafoliosAjenos } from '@/lib/portafolios-watchlist'

// Columna «Portafolio» de la watchlist: dos casillas, PMP y PCP. Se pueden marcar las dos (la corrida ▶ se hace para ambos).
// Los códigos viejos (PLP, ETF, SEMILLA) que el ticker ya tuviera se muestran en gris y se conservan. `onCambiar` recibe la lista nueva.

export default function PortafoliosCasillas({ ticker, valor, onCambiar, ancho = false }: {
  ticker: string
  valor: readonly string[] | null
  onCambiar: (nuevo: string[]) => void
  /** Celular: casillas más grandes. */
  ancho?: boolean
}) {
  const actuales = valor ?? []
  const ajenos = portafoliosAjenos(actuales)
  return (
    <div style={{ display: 'flex', gap: ancho ? 14 : 8, alignItems: 'center', justifyContent: ancho ? 'flex-start' : 'center', flexWrap: 'wrap' }}>
      {PORTAFOLIOS_WATCHLIST.map(p => {
        const marcado = actuales.includes(p)
        return (
          <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: ancho ? 14 : 12, fontWeight: 700, color: marcado ? '#22c55e' : '#777' }}>
            <input type="checkbox" checked={marcado} onChange={e => onCambiar(alternarPortafolio(actuales, p, e.target.checked))}
              aria-label={`${p} para ${ticker}`} style={{ width: ancho ? 18 : 14, height: ancho ? 18 : 14, accentColor: '#22c55e', cursor: 'pointer' }} />
            {p}
          </label>
        )
      })}
      {ajenos.length > 0 && <span style={{ color: '#555', fontSize: 10 }} title="Guardado antes; esta pantalla ya no lo cambia">+{ajenos.join('+')}</span>}
    </div>
  )
}

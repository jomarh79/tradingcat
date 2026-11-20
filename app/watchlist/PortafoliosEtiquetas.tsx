'use client'

import { PORTAFOLIOS_WATCHLIST } from '@/lib/portafolios-watchlist'

// Columna «Portafolio» de la watchlist: solo se MUESTRA (no se marca a mano). Siempre aparecen PMP y PCP: en gris opaco si el ticker no está considerado en ese
// portafolio y en verde si lo está. Lo decide el rol (lib/portafolios-watchlist.ts): crecimiento = PCP, flujo = PMP, mixto = los dos.

export default function PortafoliosEtiquetas({ ticker, activos, ancho = false }: {
  ticker: string
  activos: readonly string[]
  /** Celular: etiquetas más grandes y alineadas a la izquierda. */
  ancho?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: ancho ? 10 : 6, alignItems: 'center', justifyContent: ancho ? 'flex-start' : 'center' }}>
      {PORTAFOLIOS_WATCHLIST.map(p => {
        const activo = activos.includes(p)
        return (
          <span key={p} title={activo ? `${ticker} está considerado en ${p} (lo decide el rol)` : `${ticker} no está considerado en ${p} (lo decide el rol)`}
            style={{
              fontSize: ancho ? 13 : 11, fontWeight: 800, letterSpacing: 0.5, padding: ancho ? '4px 10px' : '2px 7px', borderRadius: 6,
              color: activo ? '#22c55e' : '#4a4a4a', background: activo ? 'rgba(34,197,94,0.10)' : 'transparent',
              border: `1px solid ${activo ? 'rgba(34,197,94,0.45)' : '#222'}`,
            }}>
            {p}
          </span>
        )
      })}
    </div>
  )
}

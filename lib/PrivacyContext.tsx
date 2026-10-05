'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

interface PrivacyContextType {
  visible: boolean
  toggle: () => void
  // Formatea dinero: si visible → $1,234.56 | si oculto → $***
  money: (value: number | null | undefined, symbol?: string) => string
  // Formatea cantidad de acciones: si visible → 10.123456 | si oculto → ***
  shares: (value: number | null | undefined) => string
}

const STORAGE_KEY = 'tradercat_privacy'

const toNum = (value: number | null | undefined): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0 // antes un NaN/Infinity se mostraba como "$NaN"
}

// Negativos como -$1,234.56 (antes salía $-1,234.56) y sin "-$0.00" cuando el valor redondea a cero
function formatMoney(value: number | null | undefined, symbol: string): string {
  const n = Math.round(toNum(value) * 100) / 100
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${n < 0 ? '-' : ''}${symbol}${abs}`
}

const formatShares = (value: number | null | undefined) => (toNum(value) + 0).toFixed(6)

const PrivacyContext = createContext<PrivacyContextType>({
  visible: true,
  toggle: () => {},
  money: (v, symbol = '$') => formatMoney(v, symbol),
  shares: formatShares,
})

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  // Arranca OCULTO hasta leer la preferencia guardada. Antes arrancaba visible: si habías dejado los montos
  // ocultos, durante un instante al cargar se veían (y quedaba a la vista de quien mirara la pantalla).
  // El servidor y el primer render del cliente coinciden, así que tampoco hay error de hidratación.
  const [visible, setVisible] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      setVisible(saved === null ? true : saved === 'true') // sin preferencia guardada: visible, como siempre
    } catch {
      setVisible(true) // localStorage bloqueado (modo privado, etc.)
    }
    setReady(true)

    // Si cambias la preferencia en otra pestaña, esta se actualiza sola
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue !== null) setVisible(e.newValue === 'true')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback(() => {
    setVisible(prev => {
      const next = !prev
      // (guardar dentro de este callback es inofensivo: escribe el mismo valor aunque React lo ejecute dos veces)
      try { localStorage.setItem(STORAGE_KEY, String(next)) } catch { /* sin almacenamiento: solo dura la sesión */ }
      return next
    })
  }, [])

  const value = useMemo<PrivacyContextType>(() => {
    const shown = ready && visible // mientras no se haya leído la preferencia, todo se muestra oculto
    return {
      visible: shown,
      toggle,
      money: (v, symbol = '$') => (shown ? formatMoney(v, symbol) : `${symbol}***`),
      shares: v => (shown ? formatShares(v) : '***'),
    }
  }, [ready, visible, toggle])

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
}

export const usePrivacy = () => useContext(PrivacyContext)
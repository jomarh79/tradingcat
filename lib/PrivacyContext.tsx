'use client'
import { createContext, useContext, useState, useEffect } from 'react'

interface PrivacyContextType {
  visible: boolean
  toggle: () => void
  // Formatea dinero: si visible → $1,234.56 | si oculto → $***
  money: (value: number | null | undefined, symbol?: string) => string
  // Formatea cantidad de acciones: si visible → 10.123456 | si oculto → ***
  shares: (value: number | null | undefined) => string
}

const PrivacyContext = createContext<PrivacyContextType>({
  visible: true,
  toggle: () => {},
  money: (v) => `$${(v ?? 0).toFixed(2)}`,
  shares: (v) => (v ?? 0).toFixed(6),
})

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(true)

  // Carga preferencia guardada
  useEffect(() => {
    const saved = localStorage.getItem('tradercat_privacy')
    if (saved !== null) setVisible(saved === 'true')
  }, [])

  const toggle = () => {
    setVisible(prev => {
      const next = !prev
      localStorage.setItem('tradercat_privacy', String(next))
      return next
    })
  }

  const money = (value: number | null | undefined, symbol = '$') => {
    if (!visible) return `${symbol}***`
    const n = Number(value ?? 0)
    return `${symbol}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const shares = (value: number | null | undefined) => {
    if (!visible) return '***'
    const n = Number(value ?? 0)
    return n.toFixed(6)
  }

  return (
    <PrivacyContext.Provider value={{ visible, toggle, money, shares }}>
      {children}
    </PrivacyContext.Provider>
  )
}

export const usePrivacy = () => useContext(PrivacyContext)
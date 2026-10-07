import { useEffect, useState } from 'react'

/**
 * true cuando la pantalla es angosta (celular / tablet vertical).
 * Arranca en false para que el HTML del servidor y el del primer render coincidan;
 * se corrige en cuanto monta en el navegador.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [breakpoint])

  return isMobile
}
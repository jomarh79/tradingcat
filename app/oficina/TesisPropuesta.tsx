'use client'

import { useEffect, useState } from 'react'
import { authedFetch } from '@/lib/authed-fetch'

// Tesis que propuso el Director en una corrida: la muestra y la aprueba con un botón. Nada se aprueba solo. Todo el código vive aquí; la página solo dibuja
// <TesisPropuesta corridaId={...} />. Si el Director no propuso tesis en esa corrida, no dibuja nada.

interface Estado {
  ok: boolean; error?: string; corrida_id?: string; ticker?: string; portafolio_codigo?: string
  propuesta?: { texto: string; clasificacion: 'primera_propuesta' | 'cambio_de_tesis' } | null
  vigente?: { texto: string | null; version: number } | null
  aprobada?: { version: number; aprobada_en: string } | null
}

export default function TesisPropuesta({ corridaId }: { corridaId: string }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [fallo, setFallo] = useState('')

  const cargar = async () => {
    try {
      const r = await authedFetch(`/api/oficina/tesis?corrida_id=${encodeURIComponent(corridaId)}`)
      const j = (await r.json().catch(() => null)) as Estado | null
      setEstado(j && j.ok ? j : null)
    } catch {
      setEstado(null)
    }
  }
  useEffect(() => { setMensaje(''); setFallo(''); setEstado(null); cargar() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [corridaId])

  const aprobar = async () => {
    if (!estado?.propuesta) return
    if (!window.confirm(`¿Aprobar esta tesis como la vigente de ${estado.ticker}? Queda guardada con su versión y la anterior se conserva en el historial.`)) return
    setGuardando(true); setFallo(''); setMensaje('')
    try {
      const r = await authedFetch('/api/oficina/tesis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ corrida_id: corridaId }) })
      const j = (await r.json().catch(() => null)) as { ok: boolean; error?: string; version?: number } | null
      if (!j) setFallo(`El servidor respondió ${r.status} sin detalle`)
      else if (!j.ok) setFallo(j.error ?? 'Error desconocido')
      else { setMensaje(`Tesis aprobada: versión ${j.version}`); await cargar() }
    } catch {
      setFallo('No se pudo conectar con el servidor')
    } finally {
      setGuardando(false)
    }
  }

  if (!estado || !estado.propuesta) return null
  const p = estado.propuesta
  const cambio = p.clasificacion === 'cambio_de_tesis'
  return (
    <div style={{ border: '1px solid #1a1a1a', borderRadius: 8, padding: '10px 12px', background: '#050505', marginTop: 10 }}>
      <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        Tesis propuesta por el Director · {cambio ? 'cambio de tesis' : 'primera tesis'}
      </div>
      <div style={{ fontSize: 12, color: '#ddd', whiteSpace: 'pre-wrap' }}>{p.texto}</div>
      {cambio && estado.vigente?.texto && (
        <details style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
          <summary style={{ cursor: 'pointer' }}>Tesis vigente (versión {estado.vigente.version})</summary>
          <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{estado.vigente.texto}</div>
        </details>
      )}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {estado.aprobada
          ? <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 700 }}>Aprobada · versión {estado.aprobada.version}</span>
          : (
            <button onClick={aprobar} disabled={guardando}
              style={{ background: '#0a0a0a', border: '1px solid #222', color: guardando ? '#444' : '#22c55e', padding: '7px 14px', borderRadius: 6, fontWeight: 700, cursor: guardando ? 'default' : 'pointer', fontSize: 12 }}>
              {guardando ? 'Guardando…' : 'Aprobar tesis'}
            </button>
          )}
        <span style={{ fontSize: 10, color: '#555' }}>Nada se aprueba solo; esto no cambia la decisión de la corrida.</span>
      </div>
      {mensaje && <div style={{ color: '#22c55e', fontSize: 12, marginTop: 6 }}>{mensaje}</div>}
      {fallo && <div style={{ color: '#f43f5e', fontSize: 12, marginTop: 6 }}>{fallo}</div>}
    </div>
  )
}

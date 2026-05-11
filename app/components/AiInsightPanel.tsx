'use client'

import { useEffect, useState } from 'react'
import { X, Brain, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Props {
  ticker:       string
  country?:     string
  sector?:      string
  subsector?:   string
  rsi?:         number | null
  entry_price?: number
  quantity?:    number
  onClose:      () => void
}

const SECTION_STYLES: Record<string, { color: string; bg: string }> = {
  '🏢': { color: '#00bfff', bg: 'rgba(0,191,255,0.06)' },
  '⚙️': { color: '#a78bfa', bg: 'rgba(167,139,250,0.06)' },
  '📰': { color: '#eab308', bg: 'rgba(234,179,8,0.06)' },
  '🔗': { color: '#34d399', bg: 'rgba(52,211,153,0.06)' },
  '📊': { color: '#f97316', bg: 'rgba(249,115,22,0.06)' },
  '💡': { color: '#22c55e', bg: 'rgba(34,197,94,0.06)' },
}

function RenderContent({ text }: { text: string }) {
  const lines = text.split('\n')
  let currentEmoji = ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {lines.map((line, i) => {
        const emoji = Object.keys(SECTION_STYLES).find(e => line.startsWith(e))

        if (emoji) {
          currentEmoji = emoji
          const style = SECTION_STYLES[emoji]
          return (
            <div key={i} style={{
              marginTop: i > 0 ? 14 : 0,
              background: style.bg,
              border: `1px solid ${style.color}22`,
              borderRadius: 6, padding: '6px 10px',
            }}>
              <span style={{ fontSize: 10, fontWeight: 900, color: style.color, letterSpacing: 0.8 }}>
                {line}
              </span>
            </div>
          )
        }

        if (line.trim() === '') return <div key={i} style={{ height: 2 }} />

        const isBullet  = line.trim().startsWith('-') || line.trim().startsWith('•')
        const cleanLine = isBullet ? line.trim().replace(/^[-•]\s*/, '') : line
        const accent    = currentEmoji ? SECTION_STYLES[currentEmoji]?.color : '#aaa'

        return (
          <div key={i} style={{
            fontSize: 12, color: '#d1d5db', lineHeight: 1.65,
            paddingLeft: isBullet ? 12 : 4,
            display: 'flex', gap: isBullet ? 6 : 0, alignItems: 'flex-start',
          }}>
            {isBullet && <span style={{ color: accent, flexShrink: 0, marginTop: 1, fontSize: 10 }}>›</span>}
            <span>{cleanLine}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function AiInsightPanel({
  ticker, country, sector, subsector, rsi, entry_price, quantity, onClose,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState('')
  const [error,   setError]   = useState('')
  const [retries, setRetries] = useState(0)
  const [similarTickers, setSimilarTickers] = useState<string[]>([])
  const [openTickers, setOpenTickers] = useState<string[]>([])
  const generateInsight = async () => {
  setLoading(true)
  setError('')
  setContent('')

  try {
    const res = await fetch('/api/ai-terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker,
        country,
        sector,
        subsector,
        rsi,
        entry_price,
        quantity
      }),
    })

    const data = await res.json()

    if (!data.ok) {
      throw new Error(data.error || 'Error generando análisis')
    }

    let cleanContent = data.content || ''

      // Quitar "content":" al inicio
      cleanContent = cleanContent.replace(/^"?content"?\s*:\s*"/i, '')

      // Quitar última comilla final
      cleanContent = cleanContent.replace(/"$/, '')

      // Convertir \\n a saltos reales
      cleanContent = cleanContent.replace(/\\n/g, '\n')

      // Limpiar escapes
      cleanContent = cleanContent.replace(/\\"/g, '"')

      setContent(cleanContent.trim())

    if (data.similarTickers) {
      setSimilarTickers(data.similarTickers)
    }

  } catch (err: any) {
    setError(err.message || 'Error conectando con la IA')
  } finally {
    setLoading(false)
  }
}

const loadOpenTickers = async () => {
  const { data } = await supabase
    .from('trades')
    .select('ticker')
    .eq('status', 'open')

  if (data) {
    setOpenTickers(
      data.map(t => String(t.ticker).toUpperCase())
    )
  }
}

  useEffect(() => {
  generateInsight()
  loadOpenTickers()
}, [ticker, retries])

  const rsiColor = rsi == null ? '#666'
    : rsi < 30 ? '#22c55e'
    : rsi > 70 ? '#f43f5e'
    : '#aaa'

  return (
  <div style={{
    width: 320,
    background: '#111',
    border: '1px solid #333',
    borderLeft: 'none',
    borderRadius: '0 12px 12px 0',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
    flexShrink: 0,
    alignSelf: 'stretch', // 🔥 Esto hace que estire lo mismo que el modal
    height: '100%',       // 🔥 Ocupa el 100% del contenedor flexible
}}>

      
      {/* Orejas decorativas */}
      <div style={{ position: 'absolute', top: -2, right: 18, pointerEvents: 'none', opacity: 0.12 }}>
        <svg width={56} height={36} viewBox="0 0 60 40" fill="#00bfff">
          <polygon points="0,40 12,0 24,40"/>
          <polygon points="36,40 48,0 60,40"/>
        </svg>
      </div>

      {/* Header */}
      <div style={{
        padding: '13px 16px 11px', borderBottom: '1px solid #131313',
        background: '#111', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Brain size={14} color="#00bfff" />
            <div>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#00bfff', letterSpacing: 0.6 }}>
                Resumen
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {!loading && (
              <button
                onClick={() => setRetries(r => r + 1)}
                title="Regenerar análisis"
                style={{
                  background: 'none', border: '1px solid #1a1a1a', color: '#555',
                  cursor: 'pointer', borderRadius: 5, padding: '3px 6px',
                  display: 'flex', alignItems: 'center', transition: 'color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#00bfff')}
                onMouseLeave={e => (e.currentTarget.style.color = '#555')}>
                <RefreshCw size={11} />
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', color: '#555',
                cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'color 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
              onMouseLeave={e => (e.currentTarget.style.color = '#555')}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Tags contexto + RSI */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          {[country, sector, subsector].filter(Boolean).map((tag, i) => (
            <span key={i} style={{
              fontSize: 10, color: '#bbb', background: '#151515',
              padding: '2px 7px', borderRadius: 3, border: '1px solid #1a1a1a',
            }}>{tag}</span>
          ))}
          {rsi != null && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: rsiColor,
              background: `${rsiColor}18`, padding: '2px 7px',
              borderRadius: 3, border: `1px solid ${rsiColor}33`,
            }}>
              RSI {Number(rsi).toFixed(1)}
            </span>
          )}
        </div>
      </div>

      {/* Contenido */}
      <div style={{
          flex: 1,            // 🔥 Toma todo el espacio disponible entre header y footer
          overflowY: 'auto',  // 🔥 Activa el scroll lateral
          padding: '14px 16px',
          minHeight: 0,       // Importante para que flexbox respete el scroll
      }}>


        {loading && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: 320, gap: 16,
          }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 7, height: 7, borderRadius: '50%', background: '#00bfff',
                  animation: `tc-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#555', letterSpacing: 1, marginBottom: 4 }}>
                ANALIZANDO {ticker}
              </div>
              <div style={{ fontSize: 9, color: '#333' }}>Consultando mercados globales...</div>
            </div>
          </div>
        )}

        {!loading && error && (
          <div style={{
            background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.2)',
            borderRadius: 8, padding: '12px 14px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#f43f5e', marginBottom: 6 }}>⚠ Error</div>
            <div style={{ fontSize: 10, color: '#c0435a', lineHeight: 1.5, marginBottom: 10 }}>{error}</div>
            <button
              onClick={() => setRetries(r => r + 1)}
              style={{
                background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)',
                color: '#f43f5e', borderRadius: 5, padding: '5px 12px',
                cursor: 'pointer', fontSize: 10, fontWeight: 700,
              }}>
              Reintentar
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {content && <RenderContent text={content} />}

            {similarTickers.length > 0 && (
              <div style={{ marginTop: 18 }}>
                
                <div style={{
                  fontSize: 10,
                  color: '#555',
                  marginBottom: 8,
                  fontWeight: 800,
                  letterSpacing: 1,
                }}>
                  TICKERS RELACIONADOS
                </div>

                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                }}>
                  {similarTickers.map((tk) => {
                    const alreadyOpen = openTickers.includes(
                      tk.toUpperCase()
                    )

                    return (
                      <div
                        key={tk}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          border: `1px solid ${
                            alreadyOpen
                              ? '#22c55e55'
                              : '#333'
                          }`,
                          background: alreadyOpen
                            ? 'rgba(34,197,94,0.08)'
                            : '#111',
                          color: alreadyOpen
                            ? '#22c55e'
                            : '#ddd',
                        }}
                      >
                        {tk}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

       <style>{`
        @keyframes tc-pulse {
          0%, 100% { opacity: 0.15; transform: scale(0.75); }
          50%       { opacity: 1;    transform: scale(1.15); }
        }
      `}</style>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  ticker: string
  country?: string
  sector?: string
  subsector?: string
  onClose: () => void
}

export default function AiInsightPanel({
  ticker,
  country,
  sector,
  subsector,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    generateInsight()
  }, [ticker])

  const generateInsight = async () => {
    try {
      setLoading(true)
      setError('')

      const res = await fetch('/api/ai-terminal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ticker,
          country,
          sector,
          subsector,
        }),
      })

      const data = await res.json()

      if (!data.ok) {
        throw new Error(data.error || 'Error IA')
      }

      setContent(data.content)
    } catch (err: any) {
      setError(err.message || 'Error generando análisis')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        width: 380,
        height: '90vh',
        background: '#050505',
        border: '1px solid #222',
        borderRadius: 12,
        zIndex: 9999,
        padding: 16,
        overflowY: 'auto',
        color: 'white',
        boxShadow: '0 0 25px rgba(0,0,0,0.5)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 900,
              color: '#00bfff',
            }}
          >
            {ticker}
          </div>

          <div
            style={{
              fontSize: 10,
              color: '#666',
            }}
          >
            IA Terminal
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
          }}
        >
          <X size={16} />
        </button>
      </div>

      {loading && (
        <div
          style={{
            color: '#888',
            fontSize: 12,
          }}
        >
          Generando análisis IA...
        </div>
      )}

      {error && (
        <div
          style={{
            color: '#f43f5e',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {!loading && !error && (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            fontSize: 12,
            lineHeight: 1.7,
            color: '#ddd',
          }}
        >
          {content}
        </div>
      )}
    </div>
  )
}
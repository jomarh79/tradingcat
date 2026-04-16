const { createClient } = require('@supabase/supabase-js')

// ⚠️ CONFIGURA ESTO
const SUPABASE_URL = 'https://kdxqnaglhhjwnzvptqvt.supabase.co'
const SUPABASE_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkeHFuYWdsaGhqd256dnB0cXZ0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU0NzEzMSwiZXhwIjoyMDg3MTIzMTMxfQ.x16f-iDX1T8FjYsP91BTFEJ0pQiez_clK-b2-nx7zQQ' // 👈 CAMBIA ESTO

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

async function fixTrades() {
  console.log('🚀 Iniciando corrección profunda de trades...\n')

  const { data: trades, error } = await supabase
    .from('trades')
    .select('*')

  if (error) {
    console.error('❌ Error obteniendo trades:', error)
    return
  }

  for (const trade of trades) {
    console.log(`\n🔧 Procesando: ${trade.ticker} (ID: ${trade.id})`)

    // 1. Obtener ejecuciones ordenadas
    const { data: executions, error: execError } = await supabase
      .from('trade_executions')
      .select('*')
      .eq('trade_id', trade.id)
      .order('executed_at', { ascending: true })

    if (execError) {
      console.error('❌ Error obteniendo ejecuciones:', execError)
      continue
    }

    let initialPrice = 0
    let initialQty = 0
    let firstExecutionId = null

    // 🔹 BUSCAR PRIMERA COMPRA REAL (ordenada por fecha)
    const firstBuy = executions
      ?.filter(e => e.execution_type === 'buy')
      ?.sort((a, b) => new Date(a.executed_at) - new Date(b.executed_at))[0]

    if (firstBuy) {
      initialPrice = parseFloat(Number(firstBuy.price).toFixed(2))
      initialQty = parseFloat(Number(firstBuy.quantity).toFixed(6))
      firstExecutionId = firstBuy.id
      console.log(`  ⚠️ Base reconstruida desde primera compra (ID: ${firstExecutionId})`)
    } else {
      // fallback
      initialPrice = parseFloat(Number(trade.initial_entry_price || trade.entry_price).toFixed(2))
      initialQty = parseFloat(Number(trade.initial_quantity || trade.quantity).toFixed(6))
      console.log('  ⚠️ Base tomada desde registro trade (fallback)')
    }

    console.log(`  [BASE] Qty: ${initialQty} | Precio: $${initialPrice}`)

    // 🔹 RECALCULAR
    let currentQty = initialQty
    let currentCap = parseFloat((initialQty * initialPrice).toFixed(2))
    let realizedPnL = 0

    if (executions && executions.length > 0) {
      for (const e of executions) {

        // 🔥 Evitar duplicar la primera compra usada como base
        if (e.id === firstExecutionId) continue

        const q = parseFloat(Number(e.quantity).toFixed(6))
        const p = parseFloat(Number(e.price).toFixed(2))
        const comm = parseFloat(Number(e.commission || 0).toFixed(2))
        const gross = parseFloat((q * p).toFixed(2))

        if (e.execution_type === 'buy') {
          currentQty = parseFloat((currentQty + q).toFixed(6))
          currentCap = parseFloat((currentCap + gross + comm).toFixed(2))
        } else {
          const avgAtMoment = currentQty > 0 ? currentCap / currentQty : 0
          const cost = parseFloat((q * avgAtMoment).toFixed(2))
          const net = parseFloat((gross - comm).toFixed(2))

          currentQty = parseFloat((currentQty - q).toFixed(6))
          currentCap = parseFloat((currentCap - cost).toFixed(2))
          realizedPnL = parseFloat((realizedPnL + (net - cost)).toFixed(2))
        }
      }
    }

    const finalAvgPrice = currentQty > 0
      ? parseFloat((currentCap / currentQty).toFixed(2))
      : initialPrice

    console.log(`  [RESULTADO] Qty: ${currentQty.toFixed(4)} | Avg: $${finalAvgPrice} | PnL: $${realizedPnL.toFixed(2)}`)

    // 🔹 GUARDAR
    const { error: updateError } = await supabase
      .from('trades')
      .update({
        initial_entry_price: initialPrice,
        initial_quantity: initialQty,
        quantity: currentQty,
        total_invested: parseFloat(currentCap.toFixed(2)),
        entry_price: finalAvgPrice,
        realized_pnl: parseFloat(realizedPnL.toFixed(2)),
        status: currentQty <= 0 ? 'closed' : 'open'
      })
      .eq('id', trade.id)

    if (updateError) {
      console.error(`  ❌ Error en ${trade.ticker}:`, updateError.message)
    } else {
      console.log(`  ✅ ${trade.ticker} actualizado correctamente.`)
    }

    // Anti rate limit
    await new Promise(r => setTimeout(r, 120))
  }

  console.log('\n✨ PROCESO TERMINADO: Trades normalizados.')
}

fixTrades()
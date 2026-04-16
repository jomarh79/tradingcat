import { serve } from "https://deno.land/std/http/server.ts";

const CRON_TOKEN = "Bearer tradingcat-cron-2026";

serve(async (req) => {
  // ── Autenticación ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== CRON_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── Hora México ──────────────────────────────────────────────────────────
  const now = new Date();

  const mexicoNow = new Date();
const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Mexico_City",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  weekday: "short",
});

const parts = formatter.formatToParts(mexicoNow);
  const day  = mexicoTime.getDay();
  const time = mexicoTime.getHours() + mexicoTime.getMinutes() / 60;

  // Solo Lun-Vie 7:30am–3:00pm hora México
  if (day < 1 || day > 5 || time < 7.5 || time >= 15) {
    return new Response("Mercado cerrado");
  }

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year:     "numeric",
    month:    "2-digit",
    day:      "2-digit",
  }).format(mexicoTime);

  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const FINNHUB_KEY   = Deno.env.get("FINNHUB_API_KEY")!;

  const headers = {
    apikey:         SUPABASE_KEY,
    Authorization:  `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // ── Obtener todos los trades abiertos ──────────────────────────────
    const res    = await fetch(`${SUPABASE_URL}/rest/v1/trades?status=eq.open`, { headers });
    const trades = await res.json();

    if (!Array.isArray(trades) || trades.length === 0) {
      return new Response("Sin trades abiertos");
    }

    let updated  = 0;
    let alerted  = 0;
    let skipped  = 0;

    for (const trade of trades) {
      try {
        // ── Precio actual desde Finnhub ──────────────────────────────
        const quoteRes = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${trade.ticker}&token=${FINNHUB_KEY}`
        );
        const quote = await quoteRes.json();

        // Si no hay precio válido, saltar este trade
        if (!quote?.c || quote.c === 0) {
          skipped++;
          continue;
        }

        const price  = quote.c as number;
        const change = typeof quote.dp === "number" ? quote.dp : 0;

        const updateData: Record<string, any> = {
          last_price: parseFloat(price.toFixed(4)),
          day_change: parseFloat(change.toFixed(2)),
        };

        // ── Alertas (solo 1 vez por día por trade) ───────────────────
        // Comparación segura: si last_trade_alert_date es null, '' o distinto de hoy → puede alertar
        const alreadyAlertedToday = (trade.last_trade_alert_date ?? "") === todayStr;

        if (!alreadyAlertedToday) {
          let alertMsg  = "";
          let alertTarget = 0;

          // Stop loss tiene prioridad sobre los TPs
          if (trade.stop_loss && price <= Number(trade.stop_loss)) {
            alertMsg    = "🚨 STOP LOSS ALCANZADO";
            alertTarget = Number(trade.stop_loss);
          } else if (trade.take_profit_3 && price >= Number(trade.take_profit_3)) {
            alertMsg    = "💰 TAKE PROFIT 3 ALCANZADO";
            alertTarget = Number(trade.take_profit_3);
          } else if (trade.take_profit_2 && price >= Number(trade.take_profit_2)) {
            alertMsg    = "💰 TAKE PROFIT 2 ALCANZADO";
            alertTarget = Number(trade.take_profit_2);
          } else if (trade.take_profit_1 && price >= Number(trade.take_profit_1)) {
            alertMsg    = "💰 TAKE PROFIT 1 ALCANZADO";
            alertTarget = Number(trade.take_profit_1);
          }

          if (alertMsg) {
            await sendAlert({
              ticker:       trade.ticker,
              type:         alertMsg,
              currentPrice: price,
              targetPrice:  alertTarget,
            });
            updateData.last_trade_alert_date = todayStr;
            alerted++;
          }
        }

        // ── Guardar en Supabase ──────────────────────────────────────
        const patchRes = await fetch(
          `${SUPABASE_URL}/rest/v1/trades?id=eq.${trade.id}`,
          { method: "PATCH", headers, body: JSON.stringify(updateData) }
        );

        if (patchRes.ok) updated++;
        else {
          const err = await patchRes.text();
          console.error(`Error actualizando ${trade.ticker}:`, err);
        }

      } catch (tradeErr) {
        // Error en un trade no detiene el loop
        console.error(`Error procesando ${trade.ticker}:`, tradeErr);
        skipped++;
      }

      // Rate limit Finnhub plan gratuito: 60 req/min → 1.2s entre llamadas
      await new Promise((r) => setTimeout(r, 1200));
    }

    return new Response(
      `OK — ${updated} actualizados, ${alerted} alertas enviadas, ${skipped} saltados`
    );

  } catch (e: any) {
    return new Response(`Error: ${e?.message ?? String(e)}`, { status: 500 });
  }
});

// ── Helper de alertas ─────────────────────────────────────────────────────────

async function sendAlert(payload: Record<string, any>): Promise<void> {
  try {
    await fetch("https://tradingcat.onrender.com/api/notify", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
  } catch {
    // Fallo silencioso — las alertas no deben romper el flujo
  }
}
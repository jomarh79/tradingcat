import { serve } from "https://deno.land/std/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const CRON_TOKEN = "Bearer tradingcat-cron-2026";

serve(async (req) => {
   if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
    }
  // ── Autenticación ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  const isCron     = authHeader === CRON_TOKEN;

if (!isCron && !req.headers.get("apikey")) {
  return new Response("Unauthorized", { status: 401, headers: CORS });
}

 // ── Hora México estable ───────────────────────────────────────────────
const mexicoNow = new Date(
  new Date().toLocaleString("en-US", {
    timeZone: "America/Mexico_City",
  })
)

const day = mexicoNow.getDay()

const time =
  mexicoNow.getHours() +
  mexicoNow.getMinutes() / 60

const isMarketOpen =
  day >= 1 &&
  day <= 5 &&
  time >= 8 &&
  time < 15

if (isCron && !isMarketOpen) {
  return new Response("Mercado cerrado (cron bloqueado)", { headers: CORS });
}

const todayStr = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const FINNHUB_KEY  = Deno.env.get("FINNHUB_API_KEY")!;

  const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

  try {
    // ── Trades abiertos ────────────────────────────────────────────────
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trades?status=eq.open&select=id,ticker,stop_loss,stop_hit,take_profit_1,tp1_hit,take_profit_2,tp2_hit,take_profit_3,tp3_hit,last_trade_alert_date`,
      { headers }
    );
    const trades = await res.json();


    if (!Array.isArray(trades) || trades.length === 0) {
      return new Response("Sin trades abiertos", { headers: CORS });
    }

    let updated = 0, alerted = 0, skipped = 0;

    for (const trade of trades) {
  try {

    await new Promise(r => setTimeout(r, 1200))

    // ── Traer precio actual ─────────────────────────────────
const controller = new AbortController()

const timeout = setTimeout(() => controller.abort(), 4000)

const quoteRes = await fetch(
  `https://finnhub.io/api/v1/quote?symbol=${trade.ticker}:US&token=${FINNHUB_KEY}`,
  { signal: controller.signal }
);

clearTimeout(timeout)
if (!quoteRes.ok) {
  const errorText = await quoteRes.text()

  console.error(`Finnhub error ${trade.ticker}:`, errorText)

  skipped++
  continue
}

const quote = await quoteRes.json();

console.log("QUOTE:", trade.ticker, quote)
console.log("CHANGE:", trade.ticker, quote.dp)

let price = 0;

if (quote?.c && quote.c > 0) {
  price = quote.c;
} else if (quote?.pc && quote.pc > 0) {
  price = quote.pc;
} else {

  console.error(`Precio inválido ${trade.ticker}:`, quote)

  skipped++;
  continue;
}

let change = 0

// Fallback usando precio previo
if (quote?.pc && quote.pc > 0) {
  change = ((price - quote.pc) / quote.pc) * 100
}

// Realtime Finnhub tiene prioridad
if (
  typeof quote.dp === "number" &&
  !isNaN(quote.dp)
) {
  change = Number(quote.dp)
}

const updateData: Record<string, any> = {
  last_price: parseFloat(price.toFixed(4)),
  day_change: parseFloat(change.toFixed(2)),
};

        // ── Alertas — 1 vez por día por trade ─────────────────────────
        const alreadyAlerted = (trade.last_trade_alert_date ?? "") === todayStr;

        if (!alreadyAlerted && isMarketOpen) {
          let alertMsg    = "";
          let alertTarget = 0;

          if (
            trade.stop_loss &&
            !trade.stop_hit &&
            price <= Number(trade.stop_loss)
          ) {
            alertMsg = "🚨 STOP LOSS ALCANZADO"; alertTarget = Number(trade.stop_loss);
          } 
          else if (
            trade.take_profit_3 &&
            !trade.tp3_hit &&
            price >= Number(trade.take_profit_3)
          ) {
            alertMsg = "💰 TAKE PROFIT 3 ALCANZADO"; alertTarget = Number(trade.take_profit_3);
          } 
          else if (
            trade.take_profit_2 &&
            !trade.tp2_hit &&
            price >= Number(trade.take_profit_2)
          ) {
            alertMsg = "💰 TAKE PROFIT 2 ALCANZADO"; alertTarget = Number(trade.take_profit_2);
          } 
          else if (
            trade.take_profit_1 &&
            !trade.tp1_hit &&
            price >= Number(trade.take_profit_1)
          ) {
            alertMsg = "💰 TAKE PROFIT 1 ALCANZADO"; alertTarget = Number(trade.take_profit_1);
          }

          if (alertMsg) {
            await sendAlert({ ticker: trade.ticker, type: alertMsg, currentPrice: price, targetPrice: alertTarget });
            updateData.last_trade_alert_date = todayStr;
            alerted++;
          }
        }

        const patchRes = await fetch(
          `${SUPABASE_URL}/rest/v1/trades?id=eq.${trade.id}`,
          { method: "PATCH", headers, body: JSON.stringify(updateData) }
        );

        if (patchRes.ok) updated++;
        else console.error(`Error actualizando ${trade.ticker}:`, await patchRes.text());

      } catch (err) {
        console.error(`Error en ${trade.ticker}:`, err);
        skipped++;
      }
    }

    return new Response(`OK — ${updated} actualizados, ${alerted} alertas, ${skipped} saltados`, { headers: CORS });

  } catch (e: any) {
    return new Response(`Error: ${e?.message ?? String(e)}`, {
      status: 500,
      headers: CORS
    });
  }
});


async function sendAlert(payload: Record<string, any>): Promise<void> {
  // ── Validar horario REAL al momento de enviar ─────────────────────
  const mexicoTime = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "America/Mexico_City",
    })
  )

  const day  = mexicoTime.getDay()
  const time =
    mexicoTime.getHours() +
    mexicoTime.getMinutes() / 60

  const isMarketOpen =
    day >= 1 &&
    day <= 5 &&
    time >= 8 &&
    time < 15

  // ── Bloquear alertas fuera de horario ────────────────────────────
  if (!isMarketOpen) {
    console.log("🔕 Alerta bloqueada — mercado cerrado")
    return
  }

  try {
    await fetch("https://tradingcat.onrender.com/api/notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error("Error enviando alerta:", err)
  }
}


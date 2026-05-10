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

 // ── Hora México — forma correcta ───────────────────────────────────────
const now = new Date();

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Mexico_City",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const parts = formatter.formatToParts(now);

const dayStr = parts.find(p => p.type === "weekday")?.value;
const hour   = parseInt(parts.find(p => p.type === "hour")?.value || "0");
const minute = parseInt(parts.find(p => p.type === "minute")?.value || "0");

const time = hour + minute / 60;

const dayMap: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
};

const day = dayMap[dayStr || ""] ?? 0;

// 👇 ESTE lo puedes activar/desactivar para pruebas
 const isMarketOpen = day >= 1 && day <= 5 && time >= 8.05 && time < 15;
 (globalThis as any).isMarketOpen = isMarketOpen;

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
    apikey:         SUPABASE_KEY,
    Authorization:  `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // ── Trades abiertos ────────────────────────────────────────────────
    const res    = await fetch(`${SUPABASE_URL}/rest/v1/trades?status=eq.open`, { headers });
    const trades = await res.json();

    // ── Traer RSI desde watchlist ───────────────────────────
    const wlRes = await fetch(
      `${SUPABASE_URL}/rest/v1/watchlist?select=ticker,rsi`,
      { headers }
    );
    const wlData = await wlRes.json();

    const rsiMap: Record<string, number> = {};
    for (const w of wlData) {
      rsiMap[w.ticker] = w.rsi;
    }

    if (!Array.isArray(trades) || trades.length === 0) {
      return new Response("Sin trades abiertos", { headers: CORS });
    }

    let updated = 0, alerted = 0, skipped = 0;

    for (const trade of trades) {
      try {

// ── Traer precio actual ─────────────────────────────────
const quoteRes = await fetch(
  `https://finnhub.io/api/v1/quote?symbol=${trade.ticker}&token=${FINNHUB_KEY}`
);
const quote = await quoteRes.json();

let price = 0;

if (quote?.c && quote.c > 0) {
  price = quote.c;
} else if (quote?.pc && quote.pc > 0) {
  price = quote.pc;
} else {
  skipped++;
  continue;
}

const change = typeof quote.dp === "number" ? quote.dp : 0;

const rsi = rsiMap[trade.ticker] ?? null;

const updateData: Record<string, any> = {
  last_price: parseFloat(price.toFixed(4)),
  day_change: parseFloat(change.toFixed(2)),
  rsi: rsi,
};

        // ── Alertas — 1 vez por día por trade ─────────────────────────
        const alreadyAlerted = (trade.last_trade_alert_date ?? "") === todayStr;

        if (!alreadyAlerted && isMarketOpen) {
          let alertMsg    = "";
          let alertTarget = 0;

          if (trade.stop_loss && price <= Number(trade.stop_loss)) {
            alertMsg = "🚨 STOP LOSS ALCANZADO"; alertTarget = Number(trade.stop_loss);
          } else if (trade.take_profit_3 && price >= Number(trade.take_profit_3)) {
            alertMsg = "💰 TAKE PROFIT 3 ALCANZADO"; alertTarget = Number(trade.take_profit_3);
          } else if (trade.take_profit_2 && price >= Number(trade.take_profit_2)) {
            alertMsg = "💰 TAKE PROFIT 2 ALCANZADO"; alertTarget = Number(trade.take_profit_2);
          } else if (trade.take_profit_1 && price >= Number(trade.take_profit_1)) {
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

      await new Promise(r => setTimeout(r, 1200));
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
    time >= 8.05 &&
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


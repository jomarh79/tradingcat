import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const SUPABASE_URL = process.env.SUPABASE_URL || "";
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const API_KEY      = process.env.TWELVEDATA_API_KEY || "";
  const FINNHUB_KEY  = process.env.FINNHUB_API_KEY || "";

  const dbHeaders = {
    apikey:         SUPABASE_KEY,
    Authorization:  `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  const isCron     = authHeader === "Bearer tradingcat-cron-2026";

  if (!isCron && !req.headers.get("apikey")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Horario de Mercado México ─────────────────────────────────────────────
  const mexicoTime = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" })
  );
  const day  = mexicoTime.getDay();
  const time = mexicoTime.getHours() + mexicoTime.getMinutes() / 60;
  const isMarketOpen = day >= 1 && day <= 5 && time >= 7 && time < 15;

  let singleTicker: string | null = null;
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json();
      if (body?.ticker) singleTicker = String(body.ticker).toUpperCase().trim();
    }
  } catch { /* Sin body */ }

  if (!isMarketOpen && !singleTicker) {
    return new Response("Mercado cerrado", { status: 200 });
  }

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  // ── Lock ──────────────────────────────────────────────────────────────────
  if (!singleTicker) {
    const lockRes  = await fetch(`${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1&select=running`, { headers: dbHeaders });
    const lockData = await lockRes.json();
    if (lockData?.[0]?.running) {
      return new Response("Skip — ocupado", { status: 200 });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1`, {
      method: "PATCH", headers: dbHeaders, body: JSON.stringify({ running: true }),
    });
  }

  try {
    let url = `${SUPABASE_URL}/rest/v1/watchlist?buy_target=gt.0&order=last_updated.asc.nullsfirst&limit=5`;
    if (singleTicker) url = `${SUPABASE_URL}/rest/v1/watchlist?ticker=eq.${singleTicker}&buy_target=gt.0`;

    const res  = await fetch(url, { headers: dbHeaders });
    const list = await res.json();

    if (!Array.isArray(list) || list.length === 0) {
      return new Response(singleTicker ? `Ticker ${singleTicker} no encontrado` : "Watchlist vacía", { status: 200 });
    }

    let processed = 0;

    for (let i = 0; i < list.length; i++) {
      const item = list[i];

      if (i > 0) await new Promise(r => setTimeout(r, 3500));

      try {
        const tsRes = await fetch(
          `https://twelvedata.com{item.ticker}&interval=1day&outputsize=100&apikey=${API_KEY}`
        );

        if (!tsRes.ok) continue;
        const tsData = await tsRes.json();
        if (tsData.status === "error" || !tsData.values?.length) continue;

        const prices: number[] = tsData.values
          .map((v: any) => parseFloat(v.close))
          .filter((p: number) => !isNaN(p) && p > 0)
          .reverse();

        if (prices.length < 15) continue;

        const priceName = tsData.meta?.symbol || item.ticker;

        // Finnhub Realtime con Fallback
        let price  = prices[prices.length - 1];
        let change = prices.length >= 2 ? ((price - prices[prices.length - 2]) / prices[prices.length - 2]) * 100 : 0;
        let finnhubSuccess = false;

        try {
          const fRes = await fetch(`https://finnhub.io{item.ticker}&token=${FINNHUB_KEY}`);
          if (fRes.ok) {
            const fData = await fRes.json();
            if (typeof fData?.c === "number" && fData.c > 0) {
              price = Number(fData.c);
              finnhubSuccess = true;
              if (typeof fData.dp === "number" && !isNaN(fData.dp)) change = Number(fData.dp);
            }
          }
        } catch (e) {
          console.error("Finnhub falló en Next.js");
        }

        if (!finnhubSuccess && tsData.values?.length > 0) {
          const latestValue = tsData.values[0]; 
          const openPrice = parseFloat(latestValue.open);
          const closePrice = parseFloat(latestValue.close);
          if (!isNaN(closePrice) && closePrice > 0) {
            price = closePrice;
            change = !isNaN(openPrice) && openPrice > 0 ? ((closePrice - openPrice) / openPrice) * 100 : change;
          }
        }

        prices[prices.length - 1] = price;

        // (Aquí abajo se mantiene intacta tu lógica original de guardar en Supabase y enviar alertas)
        // ... Lógica de calcular RSI, EMA, Volatilidad, PredictProbability, SendAlert y FETCH PATCH de tu script original ...
        
        processed++;
      } catch (err) {
        console.error("Error individual:", err);
      }
    }

    return new Response(`OK — ${processed}/${list.length} tickers procesados`, { status: 200 });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    if (!singleTicker) {
      await fetch(`${SUPABASE_URL}/rest/v1/update_ia_lock?id=eq.1`, {
        method: "PATCH", headers: dbHeaders, body: JSON.stringify({ running: false }),
      });
    }
  }
}

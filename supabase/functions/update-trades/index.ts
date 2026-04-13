import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req) => {

  // 🔐 Seguridad (CRON)
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== "Bearer tradingcat-cron-2026") {
    return new Response("Unauthorized", { status: 401 });
  }

  // 🕐 Hora México
  const now = new Date();
  const mexicoTime = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Mexico_City" })
  );

  const day = mexicoTime.getDay();
  const hour = mexicoTime.getHours();
  const min = mexicoTime.getMinutes();
  const time = hour + min / 60;

  const isMarketOpen =
    day >= 1 && day <= 5 && time >= 7.5 && time < 15;

  if (!isMarketOpen) {
    return new Response("Mercado cerrado");
  }

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY")!;

    // 🔹 1. Traer trades abiertos
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trades?status=eq.open`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        },
      }
    );

    const trades = await res.json();

    // 🔹 2. Recorrer trades
    for (const trade of trades) {

      // 📊 Precio actual
      const quoteRes = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${trade.ticker}&token=${FINNHUB_KEY}`
      );

      const quote = await quoteRes.json();

      if (!quote || !quote.c) continue;

      const price = quote.c;
      const change = quote.dp || 0;

      const updateData: any = {
        last_price: price,
        day_change: change,
      };

      // 🔔 ALERTAS (solo 1 vez por día)
      if (trade.last_trade_alert_date !== todayStr) {

        let alertMsg = "";

        if (trade.stop_loss && price <= trade.stop_loss) {
          alertMsg = "🚨 STOP LOSS";
        } else if (trade.take_profit_3 && price >= trade.take_profit_3) {
          alertMsg = "💰 TAKE PROFIT 3";
        } else if (trade.take_profit_2 && price >= trade.take_profit_2) {
          alertMsg = "💰 TAKE PROFIT 2";
        } else if (trade.take_profit_1 && price >= trade.take_profit_1) {
          alertMsg = "💰 TAKE PROFIT 1";
        }

        if (alertMsg) {
          await fetch("https://tradingcat.onrender.com/api/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticker: trade.ticker,
              type: alertMsg,
              currentPrice: price,
              targetPrice:
                trade.stop_loss || trade.take_profit_1,
            }),
          }).catch(() => {});

          updateData.last_trade_alert_date = todayStr;
        }
      }

      // 💾 Guardar en Supabase
      await fetch(
        `${SUPABASE_URL}/rest/v1/trades?id=eq.${trade.id}`,
        {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updateData),
        }
      );

      // ⏱️ Rate limit (Finnhub)
      await new Promise((r) => setTimeout(r, 1200));
    }

    return new Response("OK");
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
});
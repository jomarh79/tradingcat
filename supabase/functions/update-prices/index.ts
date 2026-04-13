import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== "Bearer tradingcat-cron-2026") {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  const mexicoTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  const time = mexicoTime.getHours() + mexicoTime.getMinutes() / 60;

  if (mexicoTime.getDay() < 1 || mexicoTime.getDay() > 5 || time < 7.5 || time >= 15) {
    return new Response("Mercado cerrado");
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const API_KEY = Deno.env.get("TWELVEDATA_API_KEY")!;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/watchlist`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    const list = await res.json();

    for (const item of list) {
      const current = item.current_price || 0;
      const target = item.buy_target;

      if (current > 0) {
        const dist = Math.abs((current - target) / target);
        let wait = 15;
        if (dist <= 0.05) wait = 2;
        else if (dist <= 0.10) wait = 5;

        const last = item.last_updated ? new Date(item.last_updated).getTime() : 0;
        if ((Date.now() - last) / 60000 < wait) continue;
      }

      const apiRes = await fetch(
        `https://api.twelvedata.com/quote?symbol=${item.ticker}&apikey=${API_KEY}`
      );

      const data = await apiRes.json();

      if (data.status === "error" || !data.close) continue;

      const price = parseFloat(data.close);

      const updateData: any = {
        current_price: price,
        price_change: parseFloat(data.percent_change || 0),
        last_updated: new Date().toISOString(),
      };

      const inZone = Math.abs((price - target) / target) <= 0.02;

      if (inZone && item.last_alert_date !== todayStr) {
        await fetch("https://tradingcat.onrender.com/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker: item.ticker,
            currentPrice: price,
            targetPrice: target,
            type: "🟢 POSIBLE ENTRADA",
          }),
        }).catch(() => {});

        updateData.last_alert_date = todayStr;
      }

      await fetch(`${SUPABASE_URL}/rest/v1/watchlist?id=eq.${item.id}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateData),
      });

      await new Promise((r) => setTimeout(r, 8000));
    }

    return new Response("OK");
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
});
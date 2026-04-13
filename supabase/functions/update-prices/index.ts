import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req) => {
  // 1. Horario de México (L-V 7:30 AM a 3:00 PM)
  const now = new Date();
  const mexicoTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Mexico_City"}));
  const day = mexicoTime.getDay();
  const hour = mexicoTime.getHours();
  const min = mexicoTime.getMinutes();
  const time = hour + min / 60;

  const isMarketOpen = day >= 1 && day <= 5 && time >= 7.5 && time < 15;

  if (!isMarketOpen) {
    return new Response("Mercado cerrado", { status: 200 });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const API_KEY = Deno.env.get("TWELVEDATA_API_KEY")!;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/watchlist`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` },
    });
    const list = await res.json();

    for (const item of list) {
      const current = item.current_price || 0;
      const target = item.buy_target;
      const dist = Math.abs((current - target) / target);

      // 2. Lógica de tiempos según distancia
      let waitMinutes = 15; 
      if (dist <= 0.05) waitMinutes = 2;
      else if (dist <= 0.10) waitMinutes = 5;

      const lastUpdate = item.last_updated ? new Date(item.last_updated).getTime() : 0;
      const minutesSinceUpdate = (Date.now() - lastUpdate) / 60000;

      // 3. Saltar si no ha pasado el tiempo necesario
      if (minutesSinceUpdate < waitMinutes) continue;

      // 4. Actualizar precio
      const apiRes = await fetch(`https://api.twelvedata.com/quote?symbol=${item.ticker}&apikey=${API_KEY}`);
      const data = await apiRes.json();

      if (data.close) {
        const price = parseFloat(data.close);
        await fetch(`${SUPABASE_URL}/rest/v1/watchlist?id=eq.${item.id}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            current_price: price,
            price_change: parseFloat(data.percent_change || 0),
            last_updated: new Date().toISOString(),
          }),
        });

        // Notificar si está en zona (±2%)
        if (Math.abs((price - target) / target) <= 0.02) {
          await fetch("https://tradingcat.onrender.com/api/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticker: item.ticker, currentPrice: price, targetPrice: target }),
          }).catch(() => {});
        }
        // Espera para no quemar la API (TwelveData permite 8 req/min)
        await new Promise(r => setTimeout(r, 8000));
      }
    }
    return new Response("OK");
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
});

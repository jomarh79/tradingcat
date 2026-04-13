import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req) => {
  const now = new Date();
  // Obtener fecha actual en formato YYYY-MM-DD para Chihuahua/CDMX
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);

  const mexicoTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Mexico_City"}));
  const day = mexicoTime.getDay();
  const hour = mexicoTime.getHours();
  const min = mexicoTime.getMinutes();
  const time = hour + min / 60;

  // L-V 7:30 AM a 3:00 PM
  const isMarketOpen = day >= 1 && day <= 5 && time >= 7.5 && time < 15;
  if (!isMarketOpen) return new Response("Mercado cerrado");

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
      
      // LOGICA DE ESPERA: Si tiene precio, respetar tiempos. Si es nuevo (0), actualizar ya.
      if (current > 0) {
        const dist = Math.abs((current - target) / target);
        let waitMinutes = 15; 
        if (dist <= 0.05) waitMinutes = 2;
        else if (dist <= 0.10) waitMinutes = 5;

        const lastUpdate = item.last_updated ? new Date(item.last_updated).getTime() : 0;
        if ((Date.now() - lastUpdate) / 60000 < waitMinutes) continue;
      }

      // Llamada API
      const apiRes = await fetch(`https://api.twelvedata.com/quote?symbol=${item.ticker}&apikey=${API_KEY}`);
      const data = await apiRes.json();

      if (data && data.close) {
        const price = parseFloat(data.close);
        const updateData: any = {
          current_price: price,
          price_change: parseFloat(data.percent_change || 0),
          last_updated: new Date().toISOString(),
        };

        // CONTROL DE SPAM: Solo si no se ha avisado HOY
        const inZone = Math.abs((price - target) / target) <= 0.02;
        const alreadyAlertedToday = item.last_alert_date === todayStr;

        if (inZone && !alreadyAlertedToday) {
          await fetch("https://tradingcat.onrender.com/api/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticker: item.ticker, currentPrice: price, targetPrice: target }),
          }).catch(() => {});
          
          updateData.last_alert_date = todayStr;
        }

        await fetch(`${SUPABASE_URL}/rest/v1/watchlist?id=eq.${item.id}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(updateData),
        });

        await new Promise(r => setTimeout(r, 8000));
      }
    }
    return new Response("OK");
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
});

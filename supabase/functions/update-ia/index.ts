import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== "Bearer tradingcat-cron-2026") {
    return new Response("Unauthorized", { status: 401 });
  }

  // 🕒 Horario mercado
  const now = new Date();
  const mexicoTime = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Mexico_City" })
  );

  const day = mexicoTime.getDay();
  const time = mexicoTime.getHours() + mexicoTime.getMinutes() / 60;

  if (day < 1 || day > 5 || time < 7.5 || time >= 15) {
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
      // 📈 HISTÓRICOS
      const ts = await fetch(
        `https://api.twelvedata.com/time_series?symbol=${item.ticker}&interval=1day&outputsize=30&apikey=${API_KEY}`
      );

      const tsData = await ts.json();
      if (!tsData.values) continue;

      const prices = tsData.values
        .map((v: any) => parseFloat(v.close))
        .reverse();

      const price = prices[prices.length - 1];
      const prev = prices[prices.length - 2] || price;
      const change = ((price - prev) / prev) * 100;

      // 📊 INDICADORES
      const rsi = calculateRSI(prices);
      const ema20 = calculateEMA(prices, 20);
      const volatility = calculateVolatility(prices);

      // 🤖 IA
      const { probability, score, signal } = predictProbability({
        rsi,
        price,
        ema20,
        volatility,
        price_change: change,
        target: item.buy_target,
        analyst_target: item.analyst_target,
        spy_change: 0,
      });

      // 💾 GUARDAR
      await fetch(`${SUPABASE_URL}/rest/v1/watchlist?id=eq.${item.id}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rsi,
          ema20,
          volatility,
          ai_probability: probability,
          ai_score: score,
          ai_signal: signal,
        }),
      });

      // 🔔 ALERTA IA (solo top)
      if (probability > 85) {
        await fetch("https://tradingcat.onrender.com/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker: item.ticker,
            currentPrice: price,
            targetPrice: item.buy_target,
            type: `🤖 IA ${signal} (${probability}%)`,
          }),
        }).catch(() => {});
      }

      await new Promise((r) => setTimeout(r, 8000));
    }

    return new Response("OK");
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
});

// ================= INDICADORES =================

function calculateRSI(prices: number[], period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const rs = (gains / period) / ((losses / period) || 1);
  return 100 - 100 / (1 + rs);
}

function calculateEMA(prices: number[], period = 20) {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateVolatility(prices: number[]) {
  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - avg) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

// ================= IA =================

function predictProbability({
  rsi,
  price,
  ema20,
  volatility,
  price_change,
  target,
  analyst_target,
  spy_change,
}: any) {
  let score = 0;

  if (rsi < 30) score += 20;
  else if (rsi < 45) score += 10;
  else if (rsi > 70) score -= 15;

  if (price > ema20) score += 15;
  else score -= 10;

  const dist = Math.abs((price - target) / target);
  if (dist < 0.02) score += 25;
  else if (dist < 0.05) score += 15;
  else if (dist < 0.1) score += 5;

  if (price_change > 0 && price_change < 3) score += 10;
  else if (price_change < 0) score += 5;
  else score -= 10;

  if (volatility < 2) score += 10;
  else if (volatility > 4) score -= 10;

  if (analyst_target) {
    const vs = (analyst_target - price) / price;
    if (vs > 0.1) score += 15;
    else if (vs > 0.05) score += 10;
  }

  if (spy_change < 0) score -= 15;
  else score += 5;

  let probability = Math.max(5, Math.min(95, 50 + score));

  let signal = "NO TRADE";
  if (probability > 80) signal = "🔥 STRONG BUY";
  else if (probability > 65) signal = "⚡ BUY";
  else if (probability > 50) signal = "👀 WATCH";

  return { probability, score, signal };
}
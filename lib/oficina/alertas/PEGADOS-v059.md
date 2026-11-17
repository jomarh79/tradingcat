# v0.59 — lo que se pega a mano en dos archivos tuyos

## 1) `app/api/notify/route.ts` (3 cambios)

a) Después de `const rsiNum = ...` agrega:
```ts
  const detalle = typeof body?.detalle === 'string' ? body.detalle.replace(/[\r\n]+/g, ' ').trim().slice(0, 500) : ''
```

b) Cambia la línea de `isEntry` por:
```ts
  const isEntry = type.includes('ENTRADA') || type.includes('SEÑAL')
```

c) Debajo de `const safeRsi = ...` agrega:
```ts
  const soloAviso = detalle !== '' && price === 0 && target === 0
```
y reemplaza el bloque `<div style="background: #111; padding: 25px; ...">...</div>` (el de Precio Actual / Objetivo / RSI) por:
```ts
          ${soloAviso ? '' : `<div style="background: #111; padding: 25px; border-radius: 10px; margin-top: 20px; border: 1px solid #333;">
            <p style="font-size: 1.2rem; margin: 10px 0;">💰 Precio Actual: <strong style="color: #fff;">$${safePrice}</strong></p>
            ${target > 0 || !detalle ? `<p style="font-size: 1.2rem; margin: 10px 0;">🎯 Objetivo: <strong style="color: #fff;">$${safeTarget}</strong></p>` : ''}
            ${rsiNum !== null || !detalle ? `<p style="font-size: 1.1rem; margin: 10px 0;">📊 RSI: <strong style="color: #fff;">${safeRsi}</strong></p>` : ''}
          </div>`}
          ${detalle ? `<div style="background: #111; padding: 18px 25px; border-radius: 10px; margin-top: 20px; border: 1px solid #333; color: #ddd; font-size: 1rem;">${esc(detalle)}</div>` : ''}
```
Las alertas de TP, stop y entrada no mandan `detalle`, así que salen exactamente igual que antes.

## 2) `supabase/functions/update-ia/index.ts` (2 cambios)

a) Primera línea del archivo:
```ts
import { ejecutarAlertasOficina } from "./alertas-oficina.ts";
```

b) Justo antes del `return new Response(\`OK — ${processed}/...` final (dentro del `try`), pega:
```ts
    // ── Alertas de la Oficina (v0.59): revisión PMP-11 vencida y señal técnica nueva ──
    // Solo en la corrida de toda la lista y si todavía queda tiempo (la función no puede pasar de ~150 s).
    if (!singleTicker && Date.now() - startedAtRun < 70_000) {
      try {
        const resumenAlertas = await ejecutarAlertasOficina({
          hoy: todayStr,
          mercadoAbierto: isMarketOpen,
          leer: async (ruta) => {
            try {
              const r = await fetchT(`${SUPABASE_URL}/rest/v1/${ruta}`, { headers: dbHeaders });
              return r.ok ? await r.json() : null;
            } catch { return null; }
          },
          guardarEstado: async (clave, valor) => {
            try {
              const r = await fetchT(`${SUPABASE_URL}/rest/v1/oficina_alertas_estado?on_conflict=clave`, {
                method: "POST",
                headers: { ...dbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
                body: JSON.stringify({ clave, valor, actualizado: new Date().toISOString() }),
              });
              return r.ok;
            } catch { return false; }
          },
          enviar: sendAlert,
          consultarSenal: async (ticker) => {
            try {
              const r = await fetch(NOTIFY_URL.replace("/api/notify", "/api/oficina/senal"), {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(NOTIFY_SECRET ? { "x-notify-secret": NOTIFY_SECRET } : {}) },
                body: JSON.stringify({ ticker }),
                signal: AbortSignal.timeout(50_000),
              });
              const j = await r.json().catch(() => null);
              if (!r.ok || !j?.ok) return { ok: false as const, error: String(j?.error ?? `HTTP ${r.status}`) };
              return {
                ok: true as const, confirmada: j.confirmada === true,
                senales_cumplidas: Array.isArray(j.senales_cumplidas) ? j.senales_cumplidas.map(String) : [],
                senales_minimas: Number(j.senales_minimas) || 2, cierre: Number(j.cierre) || 0, fecha_vela: String(j.fecha_vela ?? ""),
              };
            } catch (e) { return { ok: false as const, error: e instanceof Error ? e.name : "error" }; }
          },
          esperar: sleep,
          ahoraMs: () => Date.now(),
          log: (m) => console.log("🔔", m),
        }, list.map((t: any) => String(t.ticker)));
        console.log("🔔 Alertas Oficina:", JSON.stringify(resumenAlertas));
      } catch (err) {
        console.error("Alertas Oficina fallaron (no afectan al análisis):", err);
      }
    }

```

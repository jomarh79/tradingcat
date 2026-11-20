# v0.69 — un solo cambio a mano (Edge Function `update-ia`)

Archivo: `supabase/functions/update-ia/index.ts`, dentro del objeto que se le pasa a `ejecutarAlertasOficina({ ... })`, justo DESPUÉS de la función `consultarSenal` (antes de `esperar: sleep,`)
agrega esta propiedad nueva (no cambies nada de lo que ya está):

```ts
          consultarSalidaPcp: async (entrada) => {
            try {
              const r = await fetch(NOTIFY_URL.replace("/api/notify", "/api/oficina/senal-salida"), {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(NOTIFY_SECRET ? { "x-notify-secret": NOTIFY_SECRET } : {}) },
                body: JSON.stringify(entrada),
                signal: AbortSignal.timeout(50_000),
              });
              const j = await r.json().catch(() => null);
              if (!r.ok || !j?.ok) return { ok: false as const, error: String(j?.error ?? `HTTP ${r.status}`) };
              return {
                ok: true as const, fecha_vela: String(j.fecha_vela ?? ""), cierre: Number(j.cierre) || 0,
                decision: j.decision === "VENDER" || j.decision === "REDUCIR" ? j.decision : null,
                porcentaje: typeof j.porcentaje === "number" ? j.porcentaje : null,
                motivo: typeof j.motivo === "string" ? j.motivo : null, nivel: typeof j.nivel === "string" ? j.nivel : null,
                detalle: typeof j.detalle === "string" ? j.detalle : null, zona_recompra: j.zona_recompra === true,
                recompras_restantes: typeof j.recompras_restantes === "number" ? j.recompras_restantes : null,
                costo_promedio: typeof j.costo_promedio === "string" ? j.costo_promedio : null, stop: typeof j.stop === "string" ? j.stop : null,
              };
            } catch (e) { return { ok: false as const, error: e instanceof Error ? e.name : "error" }; }
          },
```

Después despliega la función. Si no haces este pegado, todo sigue como hoy: simplemente no se revisan las salidas de PCP.
Lo demás (leer trades, ejecuciones y fichas) lo hace `alertas-oficina.ts` con el mismo acceso a la base que ya usan las otras alertas.

# v0.68 — un solo cambio a mano (Edge Function `update-ia`)

Archivo: `supabase/functions/update-ia/index.ts`, dentro de `consultarSenal`. Hoy el `return` del caso correcto arma el objeto campo por campo y por eso descarta la señal de PCP.
Reemplaza SOLO el `return { ok: true as const, ... }` por:

```ts
              return {
                ok: true as const, confirmada: j.confirmada === true,
                senales_cumplidas: Array.isArray(j.senales_cumplidas) ? j.senales_cumplidas.map(String) : [],
                senales_minimas: Number(j.senales_minimas) || 2, cierre: Number(j.cierre) || 0, fecha_vela: String(j.fecha_vela ?? ""),
                pcp: j.pcp && typeof j.pcp === "object"
                  ? {
                      confirmada: j.pcp.confirmada === true,
                      senales_cumplidas: Array.isArray(j.pcp.senales_cumplidas) ? j.pcp.senales_cumplidas.map(String) : [],
                      senales_minimas: Number(j.pcp.senales_minimas) || 2,
                    }
                  : null,
              };
```

Nada más cambia en `index.ts`: la lista de tickers marcados PCP se lee de `watchlist` dentro de `alertas-oficina.ts`.
Después: despliega la función (`supabase functions deploy update-ia`) o como la despliegas normalmente.
Si no haces este pegado, todo sigue funcionando como hasta hoy (solo alertas de PMP); las de PCP simplemente no salen.

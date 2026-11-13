-- Oficina v0.36: aprueba apartados de la ficha PMP-09 de un ticker.
-- Cambia SOLO las tres líneas de "PARÁMETROS". Antes mira en /oficina el borrador de la última corrida (sección «Ficha PMP-09 propuesta»).
--   · Apartados «de la corrida»: copia el texto propuesto por la última corrida del ticker en PMP.
--   · Apartados «tuyos» (plan_ejecucion, decision_final, correlacion, dividendos_fundamentales): escribe tu texto en la sección TUS TEXTOS.
-- Un apartado solo cuenta para PMP-09 si queda 'aprobado' con texto. Lo que no listes no se toca. Se puede repetir.

with parametros as (
  select 'SE'::text as ticker,                                                   -- PARÁMETROS (1/3): ticker
         array['identidad','rendimiento','volatilidad_riesgo','indices_referencia']::text[] as de_la_corrida,   -- (2/3): apartados que apruebas tal como los propuso la corrida
         '{}'::jsonb as tus_textos                                               -- (3/3): ej. '{"plan_ejecucion":"Entrada 50 USD ...","decision_final":"..."}'
),
corrida as (
  select h.referencias->'ficha_propuesta'->'propuesta' as propuesta
  from oficina_corridas_historial h, parametros p
  where h.ticker = p.ticker and h.portafolio_codigo = 'PMP' and h.referencias ? 'ficha_propuesta'
  order by h.iniciada_at desc limit 1
),
nuevos as (
  select jsonb_object_agg(k, jsonb_build_object('estado','aprobado','texto', t, 'aprobado_at', now(), 'origen', origen)) as ficha_pmp
  from (
    select a as k, c.propuesta->a->>'texto' as t, 'propuesta_oficina'::text as origen
    from parametros p, corrida c, unnest(p.de_la_corrida) as a
    where coalesce(trim(c.propuesta->a->>'texto'),'') <> ''
    union all
    select e.key, e.value, 'usuario'
    from parametros p, jsonb_each_text(p.tus_textos) e
    where trim(e.value) <> ''
  ) x
)
update oficina_expedientes ex
set ficha = jsonb_set(coalesce(ex.ficha,'{}'::jsonb), '{ficha_pmp}', coalesce(ex.ficha->'ficha_pmp','{}'::jsonb) || coalesce(n.ficha_pmp,'{}'::jsonb))
from parametros p, nuevos n
where ex.ticker = p.ticker and ex.portafolio_codigo = 'PMP' and n.ficha_pmp is not null
returning ex.ticker, (select array_agg(k) from jsonb_object_keys(ex.ficha->'ficha_pmp') k) as apartados_en_ficha;

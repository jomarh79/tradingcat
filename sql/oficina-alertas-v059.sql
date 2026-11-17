-- v0.59: estado de las alertas de la Oficina (revisión PMP-11 vencida y señal técnica nueva).
-- Lo escribe y lo lee SOLO la Edge Function update-ia con la clave de servicio. RLS activada y sin políticas: ningún usuario de la app puede leerla ni escribirla.
-- Claves: 'pmp11:<TICKER>' = { avisada: 'AAAA-MM-DD' } y 'senal:<TICKER>' = { fecha_revisada, confirmada, sin_dato? }.
create table if not exists public.oficina_alertas_estado (
  clave       text primary key,
  valor       jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now()
);
alter table public.oficina_alertas_estado enable row level security;

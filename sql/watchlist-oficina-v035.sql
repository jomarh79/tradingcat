-- Oficina v0.35: columnas de la watchlist que lee la Oficina (rol, portafolios, competidores). El negocio es la columna `notes` que ya existe.
-- Seguro de repetir: usa IF NOT EXISTS. Las filas actuales quedan con rol NULL, portafolios vacío y competidores NULL.
alter table public.watchlist add column if not exists rol text;
alter table public.watchlist add column if not exists portafolios text[] not null default '{}';
alter table public.watchlist add column if not exists competidores text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'watchlist_rol_check') then
    alter table public.watchlist add constraint watchlist_rol_check check (rol is null or rol in ('flujo','crecimiento','mixto'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'watchlist_portafolios_check') then
    alter table public.watchlist add constraint watchlist_portafolios_check check (portafolios <@ array['PMP','PCP','PLP','ETF','SEMILLA']::text[]);
  end if;
end $$;

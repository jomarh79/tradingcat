-- Parche catalogo v0.70 (decision de Jaime, 20-nov): entradas de PCP.
--  * PCP-04 (recompra) y PCP-10 (apertura): se quita el MACD (lo revisas tu fuera de la Oficina).
--  * PCP-10 suma dos grupos de senales objetivas: rebote en la SMA 100/200 y reversion alcista por velas. El minimo sigue en 2.
-- Una transaccion. Se corre UNA vez (si se repite, la guarda no escribe nada).
begin;

do $$
begin
  if exists (select 1 from oficina_reglas_versiones v join oficina_reglas r on r.id = v.regla_id
             where r.codigo = 'PCP-10' and v.vigente_desde = date '2026-11-21') then
    raise exception 'Parche ya aplicado: no se escribe nada';
  end if;
end $$;

do $$
declare
  cod text;
  rid uuid;
  uid uuid;
  def jsonb;
  nueva jsonb;
begin
  foreach cod in array array['PCP-04', 'PCP-10'] loop
    select r.id into rid from oficina_reglas r where r.codigo = cod;
    select v.definicion, v.user_id into def, uid from oficina_reglas_versiones v where v.regla_id = rid and v.estado = 'vigente';
    if def is null then raise exception '% no tiene version vigente', cod; end if;

    -- quita el MACD del grupo "sobreventa"
    nueva := jsonb_set(def, '{cualquiera_de}', (
      select jsonb_agg(
               case when g->>'id' = 'sobreventa'
                    then jsonb_set(g, '{indicadores}', (select coalesce(jsonb_agg(i), '[]'::jsonb) from jsonb_array_elements(g->'indicadores') i where i->>'nombre' <> 'MACD'))
                    else g end
               order by ord)
        from jsonb_array_elements(def->'cualquiera_de') with ordinality as t(g, ord)));

    if cod = 'PCP-10' then
      nueva := jsonb_set(nueva, '{cualquiera_de}', (nueva->'cualquiera_de') || $j$[
        {"id": "rebote_sma_100_200", "criterio": "la ultima vela cerrada tiene el minimo a no mas de 1% sobre la SMA 100 o la SMA 200 diaria y cierra por encima de ella", "evaluacion": "objetiva"},
        {"id": "reversion_alcista_por_velas", "patrones": ["estrella_de_la_manana", "envolvente_alcista", "martillo", "martillo_invertido"], "criterio": "patron de reversion alcista que se completa en la ultima vela cerrada (detectCandlePatterns)", "evaluacion": "objetiva"}
      ]$j$::jsonb);
    end if;

    update oficina_reglas_versiones set estado = 'archivada', vigente_hasta = date '2026-11-20' where regla_id = rid and estado = 'vigente';

    insert into oficina_reglas_versiones (user_id, regla_id, version, definicion, estado, motivo, aprobada_at, vigente_desde, parametros_pendientes)
    values (uid, rid, (select max(x.version) + 1 from oficina_reglas_versiones x where x.regla_id = rid), nueva, 'vigente',
            case when cod = 'PCP-10' then 'Apertura de PCP: sin MACD; suma rebote en SMA 100/200 y reversion alcista por velas (6 senales posibles, minimo 2) (20-nov).'
                 else 'Recompra de PCP: sin MACD (lo revisas tu fuera de la Oficina) (20-nov).' end,
            now(), date '2026-11-21', '[]'::jsonb);
  end loop;
end $$;

do $$
begin
  if (select count(*) from oficina_reglas_versiones v join oficina_reglas r on r.id = v.regla_id where r.codigo in ('PCP-04', 'PCP-10') and v.estado = 'vigente') <> 2 then
    raise exception 'PCP-04 y PCP-10 deben quedar con exactamente una version vigente cada una';
  end if;
  if exists (select 1 from oficina_reglas_versiones v join oficina_reglas r on r.id = v.regla_id where r.codigo in ('PCP-04', 'PCP-10') and v.estado = 'vigente' and v.definicion::text like '%MACD%') then
    raise exception 'Quedo MACD en una version vigente';
  end if;
end $$;

commit;

select r.codigo, v.version, v.estado, v.vigente_desde, v.vigente_hasta,
       jsonb_array_length(v.definicion->'cualquiera_de') as grupos, v.definicion->>'cuantos_deben_coincidir' as minimo
  from oficina_reglas r join oficina_reglas_versiones v on r.id = v.regla_id
 where r.codigo in ('PCP-04', 'PCP-10') order by r.codigo, v.version;

-- Parche catalogo v0.72 (decision de Jaime, 22-nov): PMP-01 baja el umbral de ganancia anualizada de 14% a 10% (sigue vigente en PMP).
-- Una transaccion. Se corre UNA vez (si se repite, la guarda no escribe nada).
-- Resultado esperado: PMP-01 vN+1 vigente desde 2026-11-22 con umbral 10; la anterior archivada hasta 2026-11-21.
begin;

do $$
begin
  if exists (select 1 from oficina_reglas_versiones v join oficina_reglas r on r.id = v.regla_id
             where r.codigo = 'PMP-01' and v.vigente_desde = date '2026-11-22') then
    raise exception 'Parche ya aplicado: no se escribe nada';
  end if;
end $$;

do $$
declare
  rid uuid;
  uid uuid;
  def jsonb;
begin
  select r.id into rid from oficina_reglas r where r.codigo = 'PMP-01';
  select v.definicion, v.user_id into def, uid from oficina_reglas_versiones v where v.regla_id = rid and v.estado = 'vigente';
  if def is null then raise exception 'PMP-01 no tiene version vigente'; end if;
  if (def->>'umbral')::numeric <> 14 then raise exception 'PMP-01 vigente no tiene umbral 14 (tiene %): revisar antes de aplicar', def->>'umbral'; end if;

  update oficina_reglas_versiones set estado = 'archivada', vigente_hasta = date '2026-11-21' where regla_id = rid and estado = 'vigente';

  insert into oficina_reglas_versiones (user_id, regla_id, version, definicion, estado, motivo, aprobada_at, vigente_desde, parametros_pendientes)
  values (uid, rid, (select max(x.version) + 1 from oficina_reglas_versiones x where x.regla_id = rid),
          jsonb_set(def, '{umbral}', to_jsonb(10)), 'vigente',
          'El umbral de ganancia anualizada de PMP baja de 14% a 10% (el 14% venia del promedio del S&P 500; se busca superarlo con un umbral mas alcanzable) (22-nov).',
          now(), date '2026-11-22', '[]'::jsonb);
end $$;

do $$
begin
  if (select count(*) from oficina_reglas_versiones v join oficina_reglas r on r.id = v.regla_id where r.codigo = 'PMP-01' and v.estado = 'vigente') <> 1 then
    raise exception 'PMP-01 no quedo con exactamente una version vigente';
  end if;
end $$;

commit;

select r.codigo, v.version, v.estado, v.vigente_desde, v.vigente_hasta, v.definicion->>'umbral' as umbral
  from oficina_reglas r join oficina_reglas_versiones v on r.id = v.regla_id
 where r.codigo = 'PMP-01' order by v.version;

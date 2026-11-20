import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PRIMERA_REVISION_PMP11, debeAvisarPmp11, decidirSenal, diasEntre, estadoPmp11, leerEstadoSenal, sumarMeses, tocaRevisarSenal, ultimaRevisionPmp11,
} from './alertas-oficina';

describe('revisión PMP-11 vencida', () => {
  it('suma meses con fin de mes', () => {
    expect(sumarMeses('2026-08-31', 6)).toBe('2027-02-28');
    expect(sumarMeses('2026-11-17', 6)).toBe('2027-05-17');
  });
  it('sin ninguna revisión vence en la primera fecha formal de la regla', () => {
    expect(estadoPmp11({}, '2027-04-05')).toMatchObject({ vencida: false, vence: PRIMERA_REVISION_PMP11, ultima: null });
    expect(estadoPmp11(null, '2027-04-06')).toMatchObject({ vencida: true, dias_atraso: 0 });
    expect(estadoPmp11({}, '2027-04-16').dias_atraso).toBe(10);
  });
  it('con revisiones vence 6 meses después de la última', () => {
    const f = { revisiones_pmp11: [{ fecha: '2026-11-16' }, { fecha: '2026-05-01' }, { fecha: 'mala' }, 3] };
    expect(ultimaRevisionPmp11(f)).toBe('2026-11-16');
    expect(estadoPmp11(f, '2027-05-15')).toMatchObject({ vencida: false, vence: '2027-05-16' });
    expect(estadoPmp11(f, '2027-05-16')).toMatchObject({ vencida: true, dias_atraso: 0 });
  });
  it('el aviso se repite como máximo cada 7 días', () => {
    expect(debeAvisarPmp11(null, '2027-05-16')).toBe(true);
    expect(debeAvisarPmp11('2027-05-16', '2027-05-17')).toBe(false);
    expect(debeAvisarPmp11('2027-05-16', '2027-05-22')).toBe(false);
    expect(debeAvisarPmp11('2027-05-16', '2027-05-23')).toBe(true);
    expect(debeAvisarPmp11('basura', '2027-05-23')).toBe(true);
    expect(diasEntre('2027-05-16', '2027-05-23')).toBe(7);
  });
});

describe('señal técnica nueva', () => {
  const hoy = '2026-11-17';
  it('lee el estado guardado o null si es inválido', () => {
    expect(leerEstadoSenal({ fecha_revisada: '2026-11-16', confirmada: true })).toEqual({ fecha_revisada: '2026-11-16', confirmada: true });
    expect(leerEstadoSenal({ fecha_revisada: 'x', confirmada: true })).toBeNull();
    expect(leerEstadoSenal(null)).toBeNull();
  });
  it('una revisión por ticker y día', () => {
    expect(tocaRevisarSenal(null, hoy)).toBe(true);
    expect(tocaRevisarSenal({ fecha_revisada: hoy, confirmada: false }, hoy)).toBe(false);
    expect(tocaRevisarSenal({ fecha_revisada: '2026-11-16', confirmada: false }, hoy)).toBe(true);
  });
  it('la primera observación solo se guarda, aunque ya esté confirmada (no inunda al activar)', () => {
    expect(decidirSenal(null, true, hoy)).toEqual({ accion: 'guardar', estado: { fecha_revisada: hoy, confirmada: true } });
    expect(decidirSenal(null, false, hoy).accion).toBe('guardar');
  });
  it('avisa solo al pasar de no confirmada a confirmada', () => {
    const ayer = { fecha_revisada: '2026-11-16', confirmada: false };
    expect(decidirSenal(ayer, true, hoy)).toEqual({ accion: 'alertar', estado: { fecha_revisada: hoy, confirmada: true } });
    expect(decidirSenal({ ...ayer, confirmada: true }, true, hoy).accion).toBe('guardar'); // sigue confirmada: no repite
    expect(decidirSenal({ ...ayer, confirmada: true }, false, hoy).accion).toBe('guardar'); // baja: queda listo para avisar la próxima subida
    expect(decidirSenal(ayer, false, hoy).accion).toBe('guardar');
  });
  it('si ya se revisó hoy se omite', () => {
    const hoyEst = { fecha_revisada: hoy, confirmada: false };
    expect(decidirSenal(hoyEst, true, hoy)).toEqual({ accion: 'omitir', estado: hoyEst });
  });
});

describe('copia en la Edge Function', () => {
  it('supabase/functions/update-ia/alertas-oficina.ts es idéntica a lib/oficina/alertas/alertas-oficina.ts', () => {
    const a = readFileSync(new URL('./alertas-oficina.ts', import.meta.url), 'utf8');
    const b = readFileSync(new URL('../../../supabase/functions/update-ia/alertas-oficina.ts', import.meta.url), 'utf8');
    expect(b).toBe(a);
  });
});

import { decidirSalidaPcp, ejecutarAlertasOficina, firmaSalidaPcp, leerEstadoSalidaPcp, TIPO_ALERTA_PMP11, TIPO_ALERTA_RECOMPRA_PCP, TIPO_ALERTA_SALIDA_PCP, TIPO_ALERTA_SENAL, TIPO_ALERTA_SENAL_PCP } from './alertas-oficina';
import type { DepsAlertas, RespuestaSalidaPcp, RespuestaSenal } from './alertas-oficina';

function montar(o: { tablas?: Record<string, unknown[]>; senal?: (t: string) => RespuestaSenal; salida?: (t: string) => RespuestaSalidaPcp | null; correoOk?: boolean; abierto?: boolean; hoy?: string } = {}) {
  const salidasConsultadas: Record<string, unknown>[] = []; const enviados: Record<string, unknown>[] = []; const guardados: Record<string, unknown> = {}; const consultas: string[] = []; const logs: string[] = [];
  const tablas: Record<string, unknown[]> = {
    'oficina_portafolios_config': [{ portfolio_id: 'P1', codigo: 'PMP' }],
    'oficina_v_posiciones': [{ portfolio_id: 'P1', ticker: 'META' }, { portfolio_id: 'P9', ticker: 'SPY' }],
    'oficina_expedientes': [{ ticker: 'META', ficha: {} }],
    'oficina_alertas_estado:pmp11': [], 'oficina_alertas_estado:senal': [], ...(o.tablas ?? {}),
  };
  let ms = 0;
  const deps: DepsAlertas = {
    hoy: o.hoy ?? '2027-04-10', mercadoAbierto: o.abierto ?? true,
    leer: async ruta => (ruta.includes('clave=like.pmp11') ? tablas['oficina_alertas_estado:pmp11']! : ruta.includes('clave=like.salida_pcp') ? (tablas['oficina_alertas_estado:salida_pcp'] ?? []) : ruta.includes('clave=like.senal_pcp') ? (tablas['oficina_alertas_estado:senal_pcp'] ?? []) : ruta.includes('clave=like.senal') ? tablas['oficina_alertas_estado:senal']! : (tablas[ruta.split('?')[0]!] ?? null)),
    guardarEstado: async (c, v) => { guardados[c] = v; return true; },
    enviar: async p => { enviados.push(p); return o.correoOk ?? true; },
    consultarSenal: async t => { consultas.push(t); return (o.senal ?? (() => ({ ok: true, confirmada: true, senales_cumplidas: ['EMA8_SOBRE_EMA21', 'NIVEL_PASADO'], senales_minimas: 2, cierre: 100, fecha_vela: '2027-04-09' })))(t); },
    esperar: async () => { ms += 15000; }, ahoraMs: () => ms, log: m => logs.push(m),
  };
  if (o.salida !== undefined) {
    const f = o.salida;
    deps.consultarSalidaPcp = async e => { salidasConsultadas.push(e as unknown as Record<string, unknown>); return f(e.ticker) ?? { ok: false, error: 'HTTP 502' }; };
  }
  return { deps, enviados, guardados, consultas, logs, salidasConsultadas };
}

describe('orquestación de alertas (v0.59)', () => {
  it('PMP-11: avisa de la posición PMP abierta vencida (solo PMP) y guarda la fecha del aviso', async () => {
    const m = montar();
    const r = await ejecutarAlertasOficina(m.deps, []);
    expect(r.pmp11_avisadas).toEqual(['META']);
    expect(m.enviados).toHaveLength(1);
    expect(m.enviados[0]).toMatchObject({ ticker: 'META', type: TIPO_ALERTA_PMP11, currentPrice: 0, targetPrice: 0 });
    expect(String(m.enviados[0]!['detalle'])).toContain('2027-04-06');
    expect(m.guardados['pmp11:META']).toEqual({ avisada: '2027-04-10' });
  });
  it('PMP-11: no avisa si no vence, si se avisó hace menos de 7 días ni si el correo no salió', async () => {
    const a = montar({ hoy: '2027-04-05' }); await ejecutarAlertasOficina(a.deps, []); expect(a.enviados).toHaveLength(0);
    const b = montar({ tablas: { 'oficina_alertas_estado:pmp11': [{ clave: 'pmp11:META', valor: { avisada: '2027-04-08' } }] } }); await ejecutarAlertasOficina(b.deps, []); expect(b.enviados).toHaveLength(0);
    const c = montar({ correoOk: false }); const r = await ejecutarAlertasOficina(c.deps, []); expect(r.pmp11_avisadas).toEqual([]); expect(c.guardados['pmp11:META']).toBeUndefined();
  });
  it('PMP-11: con una revisión reciente guardada no avisa', async () => {
    const m = montar({ tablas: { 'oficina_expedientes': [{ ticker: 'META', ficha: { revisiones_pmp11: [{ fecha: '2027-03-01' }] } }] } });
    await ejecutarAlertasOficina(m.deps, []);
    expect(m.enviados).toHaveLength(0);
  });
  it('mercado cerrado: no hace nada', async () => {
    const m = montar({ abierto: false });
    const r = await ejecutarAlertasOficina(m.deps, ['GKOS']);
    expect(r.omitido).toBe('mercado cerrado');
    expect(m.enviados).toHaveLength(0); expect(m.consultas).toHaveLength(0);
  });
  it('señal: la primera observación solo se guarda (no avisa); mañana, si pasa a confirmada, avisa', async () => {
    const m = montar({ hoy: '2026-11-17', tablas: { 'oficina_v_posiciones': [] } });
    await ejecutarAlertasOficina(m.deps, ['GKOS']);
    expect(m.enviados).toHaveLength(0);
    expect(m.guardados['senal:GKOS']).toEqual({ fecha_revisada: '2026-11-17', confirmada: true });
    const n = montar({ hoy: '2026-11-18', tablas: { 'oficina_v_posiciones': [], 'oficina_alertas_estado:senal': [{ clave: 'senal:GKOS', valor: { fecha_revisada: '2026-11-17', confirmada: false } }] } });
    const r = await ejecutarAlertasOficina(n.deps, ['GKOS']);
    expect(r.senales_avisadas).toEqual(['GKOS']);
    expect(n.enviados[0]).toMatchObject({ ticker: 'GKOS', type: TIPO_ALERTA_SENAL, currentPrice: 100 });
    expect(String(n.enviados[0]!['detalle'])).toContain('EMA8_SOBRE_EMA21');
  });
  it('señal: si el correo no sale no se guarda el estado (se reintenta); sin cambio no avisa', async () => {
    const previo = { 'oficina_v_posiciones': [], 'oficina_alertas_estado:senal': [{ clave: 'senal:GKOS', valor: { fecha_revisada: '2026-11-17', confirmada: false } }] };
    const a = montar({ hoy: '2026-11-18', tablas: previo, correoOk: false });
    await ejecutarAlertasOficina(a.deps, ['GKOS']);
    expect(a.guardados['senal:GKOS']).toBeUndefined();
    const b = montar({ hoy: '2026-11-18', tablas: { ...previo, 'oficina_alertas_estado:senal': [{ clave: 'senal:GKOS', valor: { fecha_revisada: '2026-11-17', confirmada: true } }] } });
    await ejecutarAlertasOficina(b.deps, ['GKOS']);
    expect(b.enviados).toHaveLength(0);
    expect(b.guardados['senal:GKOS']).toEqual({ fecha_revisada: '2026-11-18', confirmada: true });
  });
  it('señal: un ticker revisado hoy se omite y como mucho 2 tickers por corrida, esperando entre uno y otro', async () => {
    const m = montar({ hoy: '2026-11-18', tablas: { 'oficina_v_posiciones': [], 'oficina_alertas_estado:senal': [{ clave: 'senal:AAA', valor: { fecha_revisada: '2026-11-18', confirmada: false } }] } });
    const r = await ejecutarAlertasOficina(m.deps, ['AAA', 'BBB', 'CCC', 'DDD', 'IVV PESOS']);
    expect(m.consultas).toEqual(['BBB', 'CCC']);
    expect(r.senales_revisadas).toEqual(['BBB', 'CCC']);
  });
  it('señal: si la consulta falla se guarda «sin dato» (no se reintenta hoy) y una caída no cuenta como observación', async () => {
    const m = montar({ hoy: '2026-11-18', tablas: { 'oficina_v_posiciones': [] }, senal: () => ({ ok: false, error: 'HTTP 502' }) });
    await ejecutarAlertasOficina(m.deps, ['GKOS']);
    expect(m.guardados['senal:GKOS']).toEqual({ fecha_revisada: '2026-11-18', confirmada: false, sin_dato: true });
    expect(m.enviados).toHaveLength(0);
    // al día siguiente, con ese estado «sin dato», una confirmada es primera observación: se guarda, no avisa
    const n = montar({ hoy: '2026-11-19', tablas: { 'oficina_v_posiciones': [], 'oficina_alertas_estado:senal': [{ clave: 'senal:GKOS', valor: { fecha_revisada: '2026-11-18', confirmada: false, sin_dato: true } }] } });
    await ejecutarAlertasOficina(n.deps, ['GKOS']);
    expect(n.enviados).toHaveLength(0);
  });
});

describe('señal de entrada de PCP (v0.68)', () => {
  const hoy = '2026-11-19';
  const respuesta = (pmp: boolean, pcp: boolean | null): RespuestaSenal => ({
    ok: true, confirmada: pmp, senales_cumplidas: pmp ? ['EMA8_SOBRE_EMA21', 'NIVEL_PASADO'] : [], senales_minimas: 2, cierre: 150.98, fecha_vela: '2026-11-18',
    ...(pcp === null ? {} : { pcp: { confirmada: pcp, senales_cumplidas: pcp ? ['RSI_SOBREVENTA', 'KONCORDE_BAJO_CERO'] : ['RSI_SOBREVENTA'], senales_minimas: 2 } }),
  });
  const base = { 'oficina_v_posiciones': [], watchlist: [{ ticker: 'FSLR', portafolios: ['PCP'] }, { ticker: 'GKOS', portafolios: ['PMP'] }, { ticker: 'XYZ', portafolios: null }] };
  const ayer = (c: boolean) => ({ fecha_revisada: '2026-11-18', confirmada: c });

  it('la primera observación PCP solo se guarda (no avisa), aunque ya esté confirmada', async () => {
    const m = montar({ hoy, tablas: base, senal: () => respuesta(false, true) });
    const r = await ejecutarAlertasOficina(m.deps, ['FSLR']);
    expect(m.enviados).toHaveLength(0);
    expect(m.guardados['senal_pcp:FSLR']).toEqual({ fecha_revisada: hoy, confirmada: true });
    expect(r.senales_pcp_avisadas).toEqual([]);
  });
  it('avisa cuando pasa de no confirmada a confirmada, con tipo PCP y las señales; el estado PCP es independiente del de PMP', async () => {
    const m = montar({ hoy, senal: () => respuesta(false, true), tablas: { ...base, 'oficina_alertas_estado:senal': [{ clave: 'senal:FSLR', valor: ayer(false) }], 'oficina_alertas_estado:senal_pcp': [{ clave: 'senal_pcp:FSLR', valor: ayer(false) }] } });
    const r = await ejecutarAlertasOficina(m.deps, ['FSLR']);
    expect(r.senales_pcp_avisadas).toEqual(['FSLR']);
    expect(r.senales_avisadas).toEqual([]);
    expect(m.enviados).toHaveLength(1);
    expect(m.enviados[0]).toMatchObject({ ticker: 'FSLR', type: TIPO_ALERTA_SENAL_PCP, currentPrice: 150.98, targetPrice: 0 });
    expect(String(m.enviados[0]!['detalle'])).toContain('RSI_SOBREVENTA, KONCORDE_BAJO_CERO');
    expect(String(m.enviados[0]!['detalle'])).toContain('mínimo 2');
    expect(m.guardados['senal_pcp:FSLR']).toEqual({ fecha_revisada: hoy, confirmada: true });
  });
  it('un ticker no marcado PCP no genera alerta PCP aunque el servidor mande el dato; sigue la de PMP', async () => {
    const m = montar({ hoy, senal: () => respuesta(true, true), tablas: { ...base, 'oficina_alertas_estado:senal': [{ clave: 'senal:GKOS', valor: ayer(false) }] } });
    const r = await ejecutarAlertasOficina(m.deps, ['GKOS']);
    expect(r.senales_pcp_avisadas).toEqual([]);
    expect(r.senales_avisadas).toEqual(['GKOS']);
    expect(m.guardados['senal_pcp:GKOS']).toBeUndefined();
    expect(m.enviados.map(x => x['type'])).toEqual([TIPO_ALERTA_SENAL]);
  });
  it('si ya estaba confirmada no repite; si el correo no sale no guarda (se reintenta)', async () => {
    const t = (c: boolean) => ({ ...base, 'oficina_alertas_estado:senal': [{ clave: 'senal:FSLR', valor: ayer(false) }], 'oficina_alertas_estado:senal_pcp': [{ clave: 'senal_pcp:FSLR', valor: ayer(c) }] });
    const a = montar({ hoy, senal: () => respuesta(false, true), tablas: t(true) });
    await ejecutarAlertasOficina(a.deps, ['FSLR']);
    expect(a.enviados).toHaveLength(0);
    const b = montar({ hoy, senal: () => respuesta(false, true), tablas: t(false), correoOk: false });
    await ejecutarAlertasOficina(b.deps, ['FSLR']);
    expect(b.guardados['senal_pcp:FSLR']).toBeUndefined();
  });
  it('un servidor sin el dato PCP (versión vieja) no rompe nada: solo PMP', async () => {
    const m = montar({ hoy, senal: () => respuesta(false, null), tablas: base });
    await ejecutarAlertasOficina(m.deps, ['FSLR']);
    expect(m.guardados['senal_pcp:FSLR']).toBeUndefined();
    expect(m.guardados['senal:FSLR']).toBeDefined();
  });
  it('si la consulta falla, el estado PCP también queda «sin dato» y la caída no cuenta como observación', async () => {
    const m = montar({ hoy, senal: () => ({ ok: false, error: 'HTTP 502' }), tablas: base });
    await ejecutarAlertasOficina(m.deps, ['FSLR']);
    expect(m.guardados['senal_pcp:FSLR']).toEqual({ fecha_revisada: hoy, confirmada: false, sin_dato: true });
  });
  it('un ticker recién marcado PCP se revisa aunque su señal de PMP ya se haya revisado hoy', async () => {
    const m = montar({ hoy, senal: () => respuesta(false, false), tablas: { ...base, 'oficina_alertas_estado:senal': [{ clave: 'senal:FSLR', valor: { fecha_revisada: hoy, confirmada: false } }] } });
    await ejecutarAlertasOficina(m.deps, ['FSLR']);
    expect(m.consultas).toEqual(['FSLR']);
  });
});

describe('salida y zona de recompra de PCP (v0.69)', () => {
  const hoy = '2026-11-19';
  const sal = (extra: Partial<Extract<RespuestaSalidaPcp, { ok: true }>> = {}): RespuestaSalidaPcp => ({
    ok: true, fecha_vela: '2026-11-18', cierre: 150.98, decision: null, porcentaje: null, motivo: null, nivel: null, detalle: null, zona_recompra: false, recompras_restantes: null, costo_promedio: '140', stop: '130', ...extra,
  });
  const vender = sal({ decision: 'VENDER', porcentaje: 100, motivo: 'nivel_planeado', nivel: 'TP1 = 150', detalle: 'el precio llegó al nivel planeado' });
  const zona = sal({ zona_recompra: true, recompras_restantes: 2, cierre: 125 });
  const trade = { id: 'T1', ticker: 'FSLR', portfolio_id: 'P2', entry_price: 140, initial_quantity: 0.2, take_profit_1: 150, stop_loss: 130 };
  const tablas = (extra: Record<string, unknown[]> = {}): Record<string, unknown[]> => ({
    'oficina_v_posiciones': [], 'oficina_portafolios_config': [{ portfolio_id: 'P2', codigo: 'PCP' }],
    trades: [trade, { id: 'T9', ticker: 'META', portfolio_id: 'P1' }],
    trade_executions: [{ id: 'E1', trade_id: 'T1', execution_type: 'buy' }, { id: 'E2', trade_id: 'T9', execution_type: 'buy' }],
    oficina_expedientes: [{ ticker: 'FSLR', portfolio_id: 'P2', ficha: { plan_pcp: { estado: 'declarado', modalidad: 'una_compra' } } }],
    ...extra,
  });

  it('la firma resume lo que dice el plan hoy', () => {
    expect(firmaSalidaPcp({ decision: 'VENDER', porcentaje: 100, motivo: 'nivel_planeado', nivel: 'TP1 = 150', zona_recompra: false })).toBe('VENDER:100:nivel_planeado:TP1 = 150');
    expect(firmaSalidaPcp({ decision: null, porcentaje: null, motivo: null, nivel: null, zona_recompra: true })).toBe('ZONA_RECOMPRA');
    expect(firmaSalidaPcp({ decision: null, porcentaje: null, motivo: null, nivel: null, zona_recompra: false })).toBe('NADA');
  });
  it('decide: avisa lo nuevo, nunca repite lo mismo, guarda «nada» y revisa una vez al día', () => {
    expect(decidirSalidaPcp(null, 'VENDER:100:senal_salida:', hoy).accion).toBe('alertar');
    expect(decidirSalidaPcp(null, 'NADA', hoy).accion).toBe('guardar');
    expect(decidirSalidaPcp({ fecha_revisada: '2026-11-18', firma: 'ZONA_RECOMPRA' }, 'ZONA_RECOMPRA', hoy).accion).toBe('guardar');
    expect(decidirSalidaPcp({ fecha_revisada: '2026-11-18', firma: 'ZONA_RECOMPRA' }, 'VENDER:100:senal_salida:', hoy).accion).toBe('alertar');
    expect(decidirSalidaPcp({ fecha_revisada: '2026-11-18', firma: 'VENDER:100:senal_salida:' }, 'NADA', hoy).accion).toBe('guardar');   // ya no hay salida: se rearma
    expect(decidirSalidaPcp({ fecha_revisada: hoy, firma: 'NADA' }, 'VENDER:100:senal_salida:', hoy).accion).toBe('omitir');
    expect(leerEstadoSalidaPcp({ fecha_revisada: hoy, firma: 'NADA' })).toEqual({ fecha_revisada: hoy, firma: 'NADA' });
    expect(leerEstadoSalidaPcp({ fecha_revisada: 'x', firma: 'NADA' })).toBeNull();
  });
  it('avisa una salida exigida (aunque sea la primera vez que se ve), con su tipo, el detalle y sin tocar el precio del correo', async () => {
    const m = montar({ hoy, tablas: tablas(), salida: () => vender });
    const r = await ejecutarAlertasOficina(m.deps, []);
    expect(r.salidas_pcp_avisadas).toEqual(['FSLR']);
    expect(m.enviados).toHaveLength(1);
    expect(m.enviados[0]).toMatchObject({ ticker: 'FSLR', type: TIPO_ALERTA_SALIDA_PCP, currentPrice: 0, targetPrice: 0 });
    expect(String(m.enviados[0]!['detalle'])).toContain('Vender 100% de FSLR');
    expect(String(m.enviados[0]!['detalle'])).toContain('la Oficina no vende');
    expect(m.guardados['salida_pcp:T1']).toEqual({ fecha_revisada: hoy, firma: 'VENDER:100:nivel_planeado:TP1 = 150' });
  });
  it('al servidor solo van el trade PCP, SUS ejecuciones y su ficha (no los de otro portafolio)', async () => {
    const m = montar({ hoy, tablas: tablas(), salida: () => sal() });
    await ejecutarAlertasOficina(m.deps, []);
    expect(m.salidasConsultadas).toHaveLength(1);
    const e = m.salidasConsultadas[0] as { ticker: string; trade: { id: string }; ejecuciones: { id: string }[]; ficha: unknown };
    expect(e.ticker).toBe('FSLR');
    expect(e.trade.id).toBe('T1');
    expect(e.ejecuciones.map(x => x.id)).toEqual(['E1']);
    expect(e.ficha).toEqual({ plan_pcp: { estado: 'declarado', modalidad: 'una_compra' } });
  });
  it('zona de posible recompra: aviso con tipo propio y dice que no vende', async () => {
    const m = montar({ hoy, tablas: tablas(), salida: () => zona });
    await ejecutarAlertasOficina(m.deps, []);
    expect(m.enviados[0]).toMatchObject({ ticker: 'FSLR', type: TIPO_ALERTA_RECOMPRA_PCP });
    expect(String(m.enviados[0]!['detalle'])).toContain('zona de posible recompra (hasta 2 más)');
    expect(String(m.enviados[0]!['detalle'])).toContain('no vende');
  });
  it('sin nada que avisar solo guarda; con la misma firma que ya se avisó no repite', async () => {
    const a = montar({ hoy, tablas: tablas(), salida: () => sal() });
    await ejecutarAlertasOficina(a.deps, []);
    expect(a.enviados).toHaveLength(0);
    expect(a.guardados['salida_pcp:T1']).toEqual({ fecha_revisada: hoy, firma: 'NADA' });
    const b = montar({ hoy, salida: () => vender, tablas: tablas({ 'oficina_alertas_estado:salida_pcp': [{ clave: 'salida_pcp:T1', valor: { fecha_revisada: '2026-11-18', firma: 'VENDER:100:nivel_planeado:TP1 = 150' } }] }) });
    await ejecutarAlertasOficina(b.deps, []);
    expect(b.enviados).toHaveLength(0);
    expect(b.guardados['salida_pcp:T1']).toEqual({ fecha_revisada: hoy, firma: 'VENDER:100:nivel_planeado:TP1 = 150' });
  });
  it('si el correo no sale o el servidor falla no se guarda nada (se reintenta en la siguiente corrida)', async () => {
    const a = montar({ hoy, tablas: tablas(), salida: () => vender, correoOk: false });
    await ejecutarAlertasOficina(a.deps, []);
    expect(a.guardados['salida_pcp:T1']).toBeUndefined();
    const b = montar({ hoy, tablas: tablas(), salida: () => null });
    const r = await ejecutarAlertasOficina(b.deps, []);
    expect(b.guardados['salida_pcp:T1']).toBeUndefined();
    expect(r.salidas_pcp_revisadas).toEqual(['FSLR']);
    expect(b.logs.join(' ')).toContain('salida PCP FSLR');
  });
  it('sin la función de la v0.69 en la Edge Function (consultarSalidaPcp ausente) no revisa salidas y todo lo demás sigue', async () => {
    const m = montar({ hoy, tablas: tablas() });
    const r = await ejecutarAlertasOficina(m.deps, []);
    expect(r.salidas_pcp_revisadas).toEqual([]);
    expect(m.enviados).toHaveLength(0);
  });
  it('mercado cerrado: no consulta nada', async () => {
    const m = montar({ hoy, abierto: false, tablas: tablas(), salida: () => vender });
    await ejecutarAlertasOficina(m.deps, []);
    expect(m.salidasConsultadas).toHaveLength(0);
  });
});


import { describe, expect, it } from 'vitest';
import { decidir, evaluarRecompraPMP, limiteActivoPMP } from './motor';
import type { EntradaMotor } from './motor';
import { calcularLimitePosicionPmp, invertidoNeto } from './conexion/limite-posicion-pmp';
import { construirDatosSalidaPmp } from './conexion/salida-pmp-bd';
import { SENALES_POR_USO, MINIMO_SENALES_POR_USO } from './tecnico/detonantes';

describe('v0.87: recompra de PMP = stop O señal', () => {
  const e = (x: Partial<Parameters<typeof evaluarRecompraPMP>[0]> = {}) => evaluarRecompraPMP({ precio_actual: '100', stop: '90', senal_confirmada: false, senales_cumplidas: [], ...x });
  it('ni stop ni señal: no dispara', () => { expect(e().disparada).toBe(false); });
  it('cierre en o bajo el stop dispara solo', () => {
    expect(e({ precio_actual: '90' })).toMatchObject({ disparada: true, por_stop: true, por_senal: false, monto: '10' });
    expect(e({ precio_actual: '89.5' }).por_stop).toBe(true);
  });
  it('una señal basta aunque el precio esté sobre el stop', () => {
    expect(e({ senal_confirmada: true, senales_cumplidas: ['RSI_SOBREVENTA'] })).toMatchObject({ disparada: true, por_stop: false, por_senal: true });
  });
  it('sin stop solo cuenta la señal; señal no evaluable se declara y no se supone', () => {
    expect(e({ stop: null, precio_actual: '1' }).disparada).toBe(false);
    const r = e({ senal_confirmada: null, precio_actual: '80' });
    expect(r.disparada).toBe(true);
    expect(r.faltantes.join()).toContain('recompra_pmp');
  });
  it('el Técnico usa las mismas 4 señales que la recompra de PCP, mínimo 1', () => {
    expect(SENALES_POR_USO.recompra_pmp).toEqual(SENALES_POR_USO.recompra_pcp);
    expect(MINIMO_SENALES_POR_USO.recompra_pmp).toBe(1);
  });
  it('el stop del trade llega a los datos de salida de PMP', () => {
    const tr = { id: 't', entry_price: 10, initial_quantity: 5, take_profit_1: 12, take_profit_2: null, take_profit_3: null, tp1_hit: false, tp2_hit: false, tp3_hit: false, stop_loss: 8.5 };
    const r = construirDatosSalidaPmp(tr, [], null, 'X', '');
    expect(r.ok && r.datos.stop).toBe('8.5');
    expect(construirDatosSalidaPmp({ ...tr, stop_loss: 0 }, [], null, 'X', '')).toMatchObject({ ok: true, datos: { stop: null } });
  });
});

describe('v0.87: tope de 10% por activo', () => {
  it('portafolio de 100 USD: el máximo de un activo es 10 USD', () => {
    const a = limiteActivoPMP({ posicion_actual: '0', otras_posiciones: ['60'], efectivo: '40', monto: '10' });
    expect(a).toMatchObject({ portafolio_total: '100.00', tope: '10.00', posicion_despues: '10.00', excede: false });
    expect(limiteActivoPMP({ posicion_actual: '5', otras_posiciones: ['55'], efectivo: '40', monto: '10' })).toMatchObject({ posicion_despues: '15.00', excede: true });
  });
  it('invertido neto: apertura + compras − ventas, nunca bajo 0', () => {
    const tr = { id: 't', entry_price: 10, initial_quantity: 5 };   // apertura 50
    expect(invertidoNeto(tr, [{ execution_type: 'buy', total: 10, quantity: 1 }, { execution_type: 'sell', total: 20, quantity: 1 }])).toBe(BigInt(40) * BigInt(100000000));
    expect(invertidoNeto(tr, [{ execution_type: 'sell', total: 500, quantity: 1 }])).toBe(BigInt(0));
    expect(invertidoNeto(tr, [{ execution_type: 'buy', total: 'x', quantity: 1 }])).toBeNull();
  });
  it('calcula con las posiciones abiertas del portafolio y el efectivo (lector simulado)', async () => {
    const trades: Record<string, Record<string, unknown>> = { a: { id: 'a', entry_price: 10, initial_quantity: 1 }, b: { id: 'b', entry_price: 10, initial_quantity: 5 } };
    const lector = async (tabla: string, _c: string, f: [string, string][]): Promise<{ filas: Record<string, unknown>[] }> => {
      if (tabla === 'oficina_v_posiciones') return { filas: [{ trade_id: 'a' }, { trade_id: 'b' }] };
      if (tabla === 'trades') return { filas: [trades[f[0]![1]]!] };
      return { filas: [] };
    };
    const r = await calcularLimitePosicionPmp(lector, { portfolio_id: 'p', trade_id: 'a', efectivo: '40', monto: '10' });
    expect(r).toMatchObject({ ok: true, limite: { posicion_actual: '10.00', portafolio_total: '100.00', tope: '10.00', posicion_despues: '20.00', excede: true } });
    const mal = await calcularLimitePosicionPmp(lector, { portfolio_id: 'p', trade_id: 'a', efectivo: null, monto: '10' });
    expect(mal.ok).toBe(false);
  });
});

describe('v0.87: el Motor aplica el tope en la recompra de PMP', () => {
  const entrada = (x: Partial<EntradaMotor> = {}): EntradaMotor => ({
    corrida_id: 'c', ticker: 'X', portafolio_codigo: 'PMP', tipo_evaluacion: 'recompra', ruta: 'analitica', fecha_evaluacion: '2026-11-25',
    reglas_versiones_ids: [], parametros_versiones: [], snapshot_id: 's', agentes_requeridos: [], resultados_agentes: {},
    auditoria: { veredicto: 'CUMPLE', reglas_revisadas: [] } as never, director: { estado: 'ok' }, datos_vencidos: [], datos_faltantes: [], posicion_confirmada: true,
    capital: { efectivo_disponible: '40', monto_requerido: '10', veredicto_riesgo: 'VIABLE' }, tesis_estado: 'intacta', monto_operacion: '10', momento: { detonante_confirmado: true }, ...x,
  });
  const ok = { posicion_actual: '0.00', portafolio_total: '100.00', tope: '10.00', posicion_despues: '10.00', excede: false };
  it('dentro del tope y con detonante: RECOMPRAR', () => {
    expect(decidir(entrada({ limite_posicion: ok })).decision).toBe('RECOMPRAR');
  });
  it('si pasa del 10%: ESPERAR limite_10pct_portafolio', () => {
    const r = decidir(entrada({ limite_posicion: { ...ok, posicion_despues: '15.00', excede: true } }));
    expect(r.decision).toBe('ESPERAR');
    expect(JSON.stringify(r)).toContain('limite_10pct_portafolio');
  });
  it('sin el dato del portafolio: NO_EVALUABLE (no se supone)', () => {
    expect(decidir(entrada()).decision).toBe('NO_EVALUABLE');
  });
  it('en PCP el tope no aplica', () => {
    expect(decidir(entrada({ portafolio_codigo: 'PCP' })).decision).toBe('RECOMPRAR');
  });
});

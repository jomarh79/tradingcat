import { describe, expect, it } from 'vitest';
import { ejecutarRevisionPmp, valuacionVigente } from './revision-pmp-bd';
import { calcularValuacion, cierreCercano } from './valuacion-modelos';
import { datosFundamentalesDeItems } from './revision-pmp-datos';
import type { FetchDatos } from '../agentes-ia';
import { DIARIAS_PRUEBA, respuestaChart } from '../agentes-ia/velas.test-util';

const it0 = (campo: string, valor: number) => ({ id: campo, campo, valor, unidad: 'USD', fuente: 'x', fecha_dato: '2026-01-01' });
const entrada = (fy: number, ingresos: number) => ({
  fiscalYear: fy, fiscalPeriod: 0, endDate: `${fy}-12-31`, currency: 'USD', revenue: ingresos, costOfRevenue: null, grossProfit: ingresos * 0.8, opex: null, sgaExp: null, rndExp: null,
  opIncome: ingresos * 0.2, otherNetIncome: null, ebt: null, incomeTax: null, netIncome: ingresos * 0.1, dilutedAvgShares: 1000, dilutedEps: 0.1, interestNet: null,
});
const RESP: Record<string, unknown> = {
  '/api/webull/income-statement': { success: true, symbol: 'META', annual: [entrada(2024, 1200), entrada(2025, 1500)], ttm: { dilutedEps: 14 }, forwardEps: { eps: 16 } },
  'freq=annual': { data: [] }, 'freq=quarterly': { data: [] }, '/stock/metric': { metric: {} },
  'interval=1day': respuestaChart('META', '1day', DIARIAS_PRUEBA()),
  '/api/fundamentals': { pe: 25, ownHistory: [{ year: 2023, endDate: '2023-12-31', eps: 10 }, { year: 2024, endDate: '2024-12-31', eps: 12 }] },
  '/api/chart-data': { dailyCloses: [{ date: '2023-12-29', close: 200 }, { date: '2024-12-31', close: 300 }, { date: '2026-11-13', close: 100 }] },
};
const fetchFn: FetchDatos = async (url, init) => {
  const k = Object.keys(RESP).find(x => url.includes(x) && (x !== '/api/chart-data' || init.method === 'POST') && !(x === 'interval=1day' && init.method === 'POST'));
  if (k === undefined) throw new Error('URL no prevista');
  return { ok: true, status: 200, json: async () => RESP[k] };
};
// sin /api/fundamentals ni POST chart-data: el modelo de valuación no se puede calcular
const mal: FetchDatos = async (url, init) => {
  if (url.includes('/api/fundamentals') || (url.includes('/api/chart-data') && init.method === 'POST')) return { ok: false, status: 500, json: async () => ({}) };
  return fetchFn(url, init);
};
const deps = { fetchFn, origen: 'https://x.test', authorization: 'Bearer T', finnhub_key: 'K' };
const clienteCon = (filas: unknown[], trades: unknown[] = []) => ({ from: (t: string) => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: t === 'trades' ? trades : filas, error: null }) }) }) }) });
const ficha = (valor: unknown) => ({ valuacion_base: { estado: 'declarado', valor_estimado_base: valor, fuente: 'mi análisis', fecha: '2026-11-01', horizonte_meses: 36 } });
const AHORA = '2026-11-10T15:00:00.000Z';

describe('valuacionVigente', () => {
  it('lee la valuación declarada y rechaza lo inválido', () => {
    expect(valuacionVigente(ficha(300))).toMatchObject({ valor: 300, horizonte_meses: 36 });
    expect(valuacionVigente(ficha('250.5'))?.valor).toBe(250.5);
    expect(valuacionVigente(ficha(-1))).toBeNull();
    expect(valuacionVigente({})).toBeNull();
    expect(valuacionVigente({ valuacion_base: { estado: 'borrador', valor_estimado_base: 5, horizonte_meses: 36 } })).toBeNull();
  });
});

describe('datosFundamentalesDeItems', () => {
  it('compara los dos últimos años fiscales consecutivos y suma deuda larga + corriente', () => {
    const r = datosFundamentalesDeItems([
      it0('ingresos_fy2024', 100), it0('ingresos_fy2025', 120), it0('margen_operativo_fy2024', 0.2), it0('margen_operativo_fy2025', 0.18),
      it0('deuda_largo_plazo_fy2024', 50), it0('deuda_corriente_fy2024', 10), it0('deuda_largo_plazo_fy2025', 60), it0('deuda_corriente_fy2025', 15),
      it0('flujo_caja_libre_fy2024', -5), it0('flujo_caja_libre_fy2025', -8), it0('activos_totales_fy2025', 900),
    ]);
    expect(r.periodo).toBe('FY2025 vs FY2024');
    expect(r.datos).toMatchObject({ ingresos_actual: 120, ingresos_previo: 100, deuda_total: 75, deuda_total_previa: 60, fcf_anuales: [-5, -8], activos_totales: 900, fcf_trimestres: null, deterioro_activos: null });
  });
  it('sin años consecutivos o con deuda a medias: null, nunca cero', () => {
    const r = datosFundamentalesDeItems([it0('ingresos_fy2025', 120), it0('deuda_largo_plazo_fy2025', 60)]);
    expect(r.periodo).toBeNull();
    expect(r.datos.ingresos_previo).toBeNull();
    expect(r.datos.deuda_total).toBeNull();
  });
});

describe('ejecutarRevisionPmp', () => {
  it('valor estimado muy bajo frente al cierre → revisar venta del 100% (no automática)', async () => {
    const r = await ejecutarRevisionPmp({ ...deps, fetchFn: mal }, clienteCon([{ id: 'e1', ficha: ficha(50) }]), 'meta', AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.resultado).toBe('revisar_venta_100');
    expect(r.datos.venta_automatica).toBe(false);
    expect(r.datos.ticker).toBe('META');
    expect(r.datos.cierre).not.toBeNull();
    expect(r.datos.periodo_fundamentales).toBe('FY2025 vs FY2024');
  });
  it('sin valuacion_base declarada: no evaluable y lo avisa', async () => {
    const r = await ejecutarRevisionPmp({ ...deps, fetchFn: mal }, clienteCon([{ id: 'e1', ficha: {} }]), 'META', AHORA);
    expect(r.ok && r.datos.resultado).toBe('no_evaluable');
    expect(r.ok && r.datos.avisos.some(a => a.includes('valuacion_base'))).toBe(true);
  });
  it('ticker inválido y expedientes duplicados', async () => {
    const a = await ejecutarRevisionPmp(deps, clienteCon([]), '', AHORA);
    expect(a.ok).toBe(false);
    const b = await ejecutarRevisionPmp(deps, clienteCon([{ id: '1', ficha: {} }, { id: '2', ficha: {} }]), 'META', AHORA);
    expect(!b.ok && b.http).toBe(409);
  });
});

describe('deuda sin parte corriente (v0.48)', () => {
  it('compara solo la deuda de largo plazo en ambos años y lo avisa', () => {
    const r = datosFundamentalesDeItems([
      it0('ingresos_fy2024', 100), it0('ingresos_fy2025', 120), it0('deuda_largo_plazo_fy2024', 50), it0('deuda_largo_plazo_fy2025', 60), it0('deuda_corriente_fy2025', 15),
    ]);
    expect(r.datos).toMatchObject({ deuda_total: 60, deuda_total_previa: 50 });
    expect(r.avisos.join(' ')).toContain('solo la deuda de largo plazo');
  });
});


describe('calcularValuacion (misma fórmula que ValuationModelsCard)', () => {
  it('forward real a 1 año: EPS × P/E objetivo y ganancia anualizada (caso de la pantalla de META)', () => {
    const r = calcularValuacion({ eps_ttm: 30, eps_forward: 32.86, pe_actual: 23.766, historial: [], cierres: [], precio: 641.69 });
    expect(r.origen_pe).toBe('actual');
    expect(r.origen_eps).toBe('estimado real (analistas)');
    expect(r.precio_objetivo).toBeCloseTo(780.94, 1);
    expect(r.ganancia_anualizada_pct).toBeCloseTo(21.7, 1);
  });
  it('P/E histórico = promedio de (cierre cercano ÷ EPS); EPS proyectado con CAGR acotado a 4–12%', () => {
    const cierres = [{ date: '2023-12-29', close: 200 }, { date: '2024-12-31', close: 300 }];
    const historial = [{ year: 2023, endDate: '2023-12-31', eps: 10 }, { year: 2024, endDate: '2024-12-31', eps: 12 }];
    const r = calcularValuacion({ eps_ttm: 14, eps_forward: null, pe_actual: 99, historial, cierres, precio: 300, anios: 3 });
    expect(r.pe_objetivo).toBeCloseTo((20 + 25) / 2, 6);
    expect(r.origen_pe).toBe('histórico');
    expect(r.crecimiento_eps).toBe(0.12); // CAGR 20% → tope 12%
    expect(r.eps).toBeCloseTo(14 * 1.12 ** 3, 6);
    expect(r.ganancia_anualizada_pct).toBeCloseTo(((14 * 1.12 ** 3 * 22.5 / 300) ** (1 / 3) - 1) * 100, 6);
  });
  it('EPS no positivo o sin precio: no hay objetivo y dice por qué', () => {
    expect(calcularValuacion({ eps_ttm: -2, eps_forward: null, pe_actual: 20, historial: [], cierres: [], precio: 10 }).motivo).toContain('EPS proyectado');
    expect(calcularValuacion({ eps_ttm: 2, eps_forward: null, pe_actual: 20, historial: [], cierres: [], precio: null }).motivo).toBe('sin precio actual');
    expect(calcularValuacion({ eps_ttm: 2, eps_forward: null, pe_actual: null, historial: [], cierres: [], precio: 10 }).motivo).toContain('P/E');
  });
  it('cierreCercano respeta el máximo de 10 días', () => {
    expect(cierreCercano([{ date: '2024-01-02', close: 5 }], '2024-01-05')).toBe(5);
    expect(cierreCercano([{ date: '2024-01-02', close: 5 }], '2024-02-01')).toBeNull();
  });
});

describe('revisión PMP-11 con el modelo de valuación', () => {
  it('usa el precio objetivo del modelo y su horizonte (1 año por omisión)', async () => {
    const r = await ejecutarRevisionPmp(deps, clienteCon([{ id: 'e1', ficha: {} }]), 'META', AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.modelo?.origen_eps).toBe('estimado real (analistas)');
    expect(r.datos.valuacion?.horizonte_meses).toBe(12);
    expect(r.datos.valuacion?.fuente).toContain('Modelo de valuación');
    expect(r.datos.rendimiento.estado).toBe('evaluado');
    expect(r.datos.venta_automatica).toBe(false);
  });
  it('anios = 3 compone el crecimiento y usa horizonte de 36 meses', async () => {
    const r = await ejecutarRevisionPmp(deps, clienteCon([{ id: 'e1', ficha: {} }]), 'META', AHORA, 3);
    expect(r.ok && r.datos.modelo?.anios).toBe(3);
    expect(r.ok && r.datos.valuacion?.horizonte_meses).toBe(36);
    expect(r.ok && r.datos.modelo?.origen_eps).toBe('proyectado (crecimiento histórico)');
  });
  it('si el modelo no se puede calcular cae a la valuación declarada en la ficha y lo avisa', async () => {
    const r = await ejecutarRevisionPmp({ ...deps, fetchFn: mal }, clienteCon([{ id: 'e1', ficha: ficha(500) }]), 'META', AHORA);
    expect(r.ok && r.datos.valuacion?.valor).toBe(500);
    expect(r.ok && r.datos.avisos.some(a => a.includes('valuacion_base'))).toBe(true);
  });
});

// v0.53: guardar la revisión en ficha.revisiones_pmp11
const clienteEscribe = (filas: unknown[], upd: { filas: unknown[] | null; error?: boolean }) => {
  const guardado: { ficha?: Record<string, unknown>; id?: string } = {};
  const cliente = { from: (t: string) => ({
    select: () => ({ eq: () => ({ eq: async () => ({ data: t === 'trades' ? [] : filas, error: null }) }) }),
    update: (v: { ficha: Record<string, unknown> }) => { guardado.ficha = v.ficha; return { eq: (_c: string, id: string) => { guardado.id = id; return { select: async () => ({ data: upd.filas, error: upd.error ? { message: 'x' } : null }) }; } }; },
  }) };
  return { cliente, guardado };
};
describe('guardar la revisión PMP-11 (v0.53)', () => {
  it('sin guardar: no escribe nada', async () => {
    const { cliente, guardado } = clienteEscribe([{ id: 'e1', ficha: { rol: 'x' } }], { filas: [{ id: 'e1' }] });
    const r = await ejecutarRevisionPmp({ ...deps, fetchFn: mal }, cliente, 'META', AHORA);
    expect(r.ok && r.datos.guardada).toBe(false);
    expect(guardado.ficha).toBeUndefined();
  });
  it('guardar: agrega al historial conservando el resto de la ficha y da la próxima fecha', async () => {
    const { cliente, guardado } = clienteEscribe([{ id: 'e1', ficha: { rol: 'x', ...ficha(50) } }], { filas: [{ id: 'e1' }] });
    const r = await ejecutarRevisionPmp({ ...deps, fetchFn: mal }, cliente, 'META', AHORA, undefined, true);
    expect(r.ok && r.datos.guardada).toBe(true);
    expect(r.ok && r.datos.proxima_revision).toBe('2027-05-10');
    expect(guardado.id).toBe('e1');
    expect(guardado.ficha?.['rol']).toBe('x');
    const h = guardado.ficha?.['revisiones_pmp11'] as Array<Record<string, unknown>>;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ fecha: '2026-11-10', resultado: 'revisar_venta_100' });
  });
  it('sin expediente PMP: no crea nada y lo dice', async () => {
    const { cliente, guardado } = clienteEscribe([], { filas: [] });
    const r = await ejecutarRevisionPmp({ ...deps, fetchFn: mal }, cliente, 'META', AHORA, undefined, true);
    expect(r.ok && r.datos.guardada).toBe(false);
    expect(r.ok && r.datos.guardada_motivo).toContain('no tiene expediente');
    expect(guardado.ficha).toBeUndefined();
  });
  it('la base no actualiza ninguna fila (permiso) o falla: guardada false con motivo', async () => {
    const a = clienteEscribe([{ id: 'e1', ficha: {} }], { filas: [] });
    const ra = await ejecutarRevisionPmp({ ...deps, fetchFn: mal }, a.cliente, 'META', AHORA, undefined, true);
    expect(ra.ok && ra.datos.guardada).toBe(false);
    expect(ra.ok && ra.datos.guardada_motivo).toContain('permiso');
    const b = clienteEscribe([{ id: 'e1', ficha: {} }], { filas: null, error: true });
    const rb = await ejecutarRevisionPmp({ ...deps, fetchFn: mal }, b.cliente, 'META', AHORA, undefined, true);
    expect(rb.ok && rb.datos.guardada).toBe(false);
  });
});

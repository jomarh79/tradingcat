// Pruebas de la v0.15: las cifras que escribe el modelo deben coincidir con los datos que cita (Técnico y Fundamental) y prompts tecnico.p2 / fundamental.p7.
import { describe, expect, it } from 'vitest';
import {
  EPSILON_CIFRA, ESCALAS_CIFRA, MAX_VALORES_EN_MENSAJE, PROMPT_FUNDAMENTAL, PROMPT_TECNICO, VERIFICAR_CIFRAS_FUNDAMENTAL, VERIFICAR_CIFRAS_TECNICO, VERSION_PROMPT_FUNDAMENTAL,
  VERSION_PROMPT_TECNICO, ejecutarAnalisisGuardado, validarSalidaFundamental, validarSalidaTecnicoIa, validarSobreTecnico,
} from './index';
import type { FetchDatos, SobreTecnicoValido } from './index';
import { cifrasSinRespaldo, lecturasDeCifra, numerosEnTextos } from './utilidades';
import type { Obj } from './utilidades';
import { erroresDeCifras, numerosPermitidos } from './verificar-cifras';
import { salidaBase, sobreBase } from './fixtures.test-util';
import { modeloFalso } from './modelo-falso.test-util';
import { nuevaBdGuardado } from './bd-guardado.test-util';
import { DIARIAS_PRUEBA, SEMANALES_PRUEBA, respuestaChart, velasDiarias, velasSemanales } from './velas.test-util';
import { prepararTecnico } from '../orquestador/preparar-tecnico';

const AHORA = '2026-11-04T15:00:00.000Z';
const RUN = '11111111-1111-4111-8111-111111111111';
const SNAP = '22222222-2222-4222-8222-222222222222';

describe('v0.15: lecturas de una cifra escrita', () => {
  it('enteros, decimales y separadores de miles', () => {
    expect(lecturasDeCifra('62')).toEqual([{ valor: 62, decimales: 0 }]);
    expect(lecturasDeCifra('62.02')).toEqual([{ valor: 62.02, decimales: 2 }]);
    expect(lecturasDeCifra('62,02')).toEqual([{ valor: 62.02, decimales: 2 }]);
    expect(lecturasDeCifra('1,234')).toEqual([{ valor: 1.234, decimales: 3 }, { valor: 1234, decimales: 0 }]);
    expect(lecturasDeCifra('1.234')).toEqual([{ valor: 1.234, decimales: 3 }, { valor: 1234, decimales: 0 }]);
    expect(lecturasDeCifra('1,234.56')).toEqual([{ valor: 1234.56, decimales: 2 }]);
    expect(lecturasDeCifra('1.234,56')).toEqual([{ valor: 1234.56, decimales: 2 }]);
    expect(lecturasDeCifra('1,234,567')).toEqual([{ valor: 1234.567, decimales: 3 }, { valor: 1234567, decimales: 0 }]);
    expect(lecturasDeCifra('12.5')).toEqual([{ valor: 12.5, decimales: 1 }]);
  });
  it('números dentro de textos (ids)', () => {
    expect(numerosEnTextos(['ind_ema8', 'ind_ema200_diaria', 'x'])).toEqual([8, 200]);
    expect(numerosEnTextos(['2025-12-31', 'a8b8'])).toEqual([2025, 12, 31, 8]);
    expect(numerosEnTextos([])).toEqual([]);
  });
  it('constantes', () => {
    expect(ESCALAS_CIFRA).toEqual([1, 100, 1e-3, 1e-6, 1e-9]);
    expect(EPSILON_CIFRA).toBeGreaterThan(0);
    expect(MAX_VALORES_EN_MENSAJE).toBe(12);
    expect(VERIFICAR_CIFRAS_TECNICO).toBe(true);
    expect(VERIFICAR_CIFRAS_FUNDAMENTAL).toBe(true);
  });
});

describe('v0.15: cifras sin respaldo', () => {
  const RSI = 62.01958516653587;
  it('redondeada coincide; truncada no', () => {
    expect(cifrasSinRespaldo('El RSI es 62.02', [RSI])).toEqual([]);
    expect(cifrasSinRespaldo('El RSI es 62.01', [RSI])).toEqual(['62.01']);
    expect(cifrasSinRespaldo('El RSI es 62.0', [RSI])).toEqual([]);
    expect(cifrasSinRespaldo('El RSI es 62', [RSI])).toEqual([]);
    expect(cifrasSinRespaldo('El RSI es 63', [RSI])).toEqual(['63']);
    expect(cifrasSinRespaldo('El RSI es 62.5', [RSI])).toEqual(['62.5']);
  });
  it('el borde del redondeo: medio paso exacto se acepta, un poco más no', () => {
    expect(cifrasSinRespaldo('vale 62.01', [62.005])).toEqual([]);
    expect(cifrasSinRespaldo('vale 62.00', [62.005])).toEqual([]);
    expect(cifrasSinRespaldo('vale 62.01', [62.0049])).toEqual(['62.01']);
    expect(cifrasSinRespaldo('vale 62.00', [62.0051])).toEqual(['62.00']);
    expect(cifrasSinRespaldo('vale 62.1', [62.05])).toEqual([]);
    expect(cifrasSinRespaldo('vale 62.1', [62.0499])).toEqual(['62.1']);
  });
  it('porcentaje, miles, millones y miles de millones', () => {
    expect(cifrasSinRespaldo('margen de 82%', [0.82])).toEqual([]);
    expect(cifrasSinRespaldo('margen de 81%', [0.82])).toEqual(['81']);
    expect(cifrasSinRespaldo('ingresos de 123.5 millones', [123456789])).toEqual([]);
    expect(cifrasSinRespaldo('ingresos de 123.4 millones', [123456789])).toEqual(['123.4']);
    expect(cifrasSinRespaldo('ingresos de 1.5 miles de millones', [1.5e9])).toEqual([]);
    expect(cifrasSinRespaldo('ingresos de 123 mil', [123456])).toEqual([]);
    expect(cifrasSinRespaldo('ingresos de 124 mil', [123456])).toEqual(['124']);
    expect(cifrasSinRespaldo('flujo de 1,234 dólares', [1234])).toEqual([]);
    expect(cifrasSinRespaldo('flujo de 1.234,56 dólares', [1234.56])).toEqual([]);
  });
  it('valores negativos se comparan por magnitud', () => {
    expect(cifrasSinRespaldo('pérdida de 5.2', [-5.2])).toEqual([]);
    expect(cifrasSinRespaldo('pérdida de 5.3', [-5.2])).toEqual(['5.3']);
  });
  it('se ignoran fechas ISO, conteos de un dígito y parámetros permitidos', () => {
    expect(cifrasSinRespaldo('Al 2026-11-05 hay 2 señales', [])).toEqual([]);
    expect(cifrasSinRespaldo('Al 2026-11-05 hay 12 señales', [])).toEqual(['12']);
    expect(cifrasSinRespaldo('EMA21 y RSI de 14 periodos', [], [14, 21])).toEqual([]);
    expect(cifrasSinRespaldo('RSI de 14 periodos', [], [21])).toEqual(['14']);
    expect(cifrasSinRespaldo('crece 5%', [])).toEqual(['5']);
  });
  it('sin cifras o sin datos', () => {
    expect(cifrasSinRespaldo('sin cifras', [1, 2])).toEqual([]);
    expect(cifrasSinRespaldo('vale 62.02', [])).toEqual(['62.02']);
    expect(cifrasSinRespaldo('vale 62.02 y 70.5', [62.02])).toEqual(['70.5']);
  });
  it('una cifra ambigua se acepta si CUALQUIERA de sus lecturas coincide', () => {
    expect(cifrasSinRespaldo('ratio 1.234', [1.234])).toEqual([]);
    expect(cifrasSinRespaldo('flujo 1.234', [1234])).toEqual([]);
    expect(cifrasSinRespaldo('flujo 1.234', [999])).toEqual(['1.234']);
  });
  it('un número desmesurado (infinito) no se lee como cifra', () => {
    expect(lecturasDeCifra('9'.repeat(400))).toEqual([]);
    expect(cifrasSinRespaldo(`vale ${'9'.repeat(400)}`, [1e308])).toEqual(['9'.repeat(400)]);
  });
  it('un valor igual a cero solo respalda cero', () => {
    expect(cifrasSinRespaldo('vale 0', [0])).toEqual([]);
    expect(cifrasSinRespaldo('vale 0.5', [0])).toEqual(['0.5']);
  });
});

describe('v0.15: Técnico: cifras de la salida', () => {
  const tc = prepararTecnico({ ticker: 'GKOS', mercado: 'US', evaluado_en: AHORA, fuente: 'TwelveData', velas_diarias: velasDiarias('2026-11-03', 600), velas_semanales: velasSemanales('2026-11-02', 260) });
  const crudo = { contrato: 'entrada.v1', run_id: RUN, agente: 'tecnico', ticker: 'GKOS', mercado: 'US', snapshot: { id: SNAP, generado_en: AHORA }, tecnico_codigo: { estado: tc.estado, snapshot: tc.snapshot, detonantes: tc.detonantes, descartes: tc.descartes, motivos: tc.motivos } };
  const r = validarSobreTecnico(crudo);
  if (!r.ok) throw new Error(r.errores.join('; '));
  const s: SobreTecnicoValido = r.valor;
  const item = (id: string) => s.items.find(i => i.id === id)!;
  const rsi = item('ind_rsi14');
  const cierre = item('cierre_ultima_vela_diaria');
  const f2 = (n: number): string => n.toFixed(2);
  const base = (cambios: Obj = {}): Obj => ({
    contrato: 'salida.v1', agente: 'tecnico', run_id: RUN, snapshot_id: SNAP, ticker: 'GKOS', veredicto: 'ESPERAR', confianza: 0.7,
    resumen: `El cierre fue ${f2(cierre.valor as number)} y el RSI ${f2(rsi.valor as number)}.`,
    tendencia: { corto: 'lateral', medio: 'lateral', largo: 'alcista' },
    hallazgos: [{ id: 'h1', tipo: 'neutral', texto: `El RSI de 14 periodos vale ${f2(rsi.valor as number)}.`, evidencia: ['ind_rsi14'] }],
    negativos: ['No hay señal de entrada confirmada.'], datos_fuente: [rsi, cierre],
    zona_entrada: null, soporte_clave: null, resistencia_clave: null, nivel_invalidacion: null, datos_faltantes: [], ...cambios,
  });
  const errs = (x: Obj): string[] => { const v = validarSalidaTecnicoIa(x, s); return v.ok ? [] : v.errores; };
  it('cifras redondeadas de los datos citados pasan', () => {
    expect(errs(base())).toEqual([]);
  });
  it('el RSI truncado en el resumen se rechaza y el mensaje trae el dato para corregir', () => {
    const trunc = Math.floor((rsi.valor as number) * 100) / 100;
    expect(f2(trunc)).not.toBe(f2(rsi.valor as number));
    const e = errs(base({ resumen: `El RSI es ${f2(trunc)}.` }));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^resumen cita cifras que no coinciden con ningún dato de datos_fuente: /);
    expect(e[0]).toContain(f2(trunc));
    expect(e[0]).toContain(`ind_rsi14=${String(rsi.valor)}`);
    expect(e[0]).toContain('copia la cifra del dato, redondeada, sin truncar');
  });
  it('un indicador mencionado sin citar su dato se rechaza (el caso del ADX)', () => {
    const adx = item('ind_adx14');
    const e = errs(base({ resumen: `El ADX está en ${f2(adx.valor as number)}.` }));
    expect(e.some(x => x.startsWith('resumen cita cifras'))).toBe(true);
    expect(errs(base({ resumen: `El ADX está en ${f2(adx.valor as number)}.`, datos_fuente: [rsi, cierre, adx] }))).toEqual([]);
  });
  it('hallazgos: la cifra debe ser la de SU evidencia, no la de otro dato citado', () => {
    const h = [{ id: 'h1', tipo: 'neutral', texto: `El RSI vale ${f2(cierre.valor as number)}.`, evidencia: ['ind_rsi14'] }];
    const e = errs(base({ hallazgos: h }));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^hallazgos\[0\] cita cifras que no coinciden con los datos de su evidencia: /);
    expect(e[0]).toContain('ind_rsi14=');
    expect(e[0]).not.toContain('cierre_ultima_vela_diaria=');
  });
  it('hallazgos: el índice del error es el del hallazgo', () => {
    const bueno = { id: 'h1', tipo: 'neutral', texto: 'sin cifras', evidencia: ['ind_rsi14'] };
    const malo = { id: 'h2', tipo: 'neutral', texto: 'RSI de 14 periodos en 99.99', evidencia: ['ind_rsi14'] };
    expect(errs(base({ hallazgos: [bueno, malo] })).some(x => x.startsWith('hallazgos[1] cita cifras'))).toBe(true);
    expect(errs(base({ hallazgos: [bueno, malo] })).some(x => x.startsWith('hallazgos[0]'))).toBe(false);
  });
  it('hallazgos: evidencia que no está en datos_fuente no cuenta como respaldo', () => {
    const h = [{ id: 'h1', tipo: 'neutral', texto: `El RSI vale ${f2(rsi.valor as number)}.`, evidencia: ['ind_rsi14'] }];
    const e = errs(base({ hallazgos: h, datos_fuente: [cierre] }));
    expect(e.some(x => x.includes('no está en datos_fuente'))).toBe(true);
    expect(e.some(x => x.startsWith('hallazgos[0] cita cifras'))).toBe(true);
  });
  it('negativos con cifra sin dato se rechazan', () => {
    const e = errs(base({ negativos: ['El volumen cayó 45.7 puntos.'] }));
    expect(e.some(x => x.startsWith('negativos[0] cita cifras'))).toBe(true);
    expect(errs(base({ negativos: ['Sin señal de entrada.', `Cierre ${f2(cierre.valor as number)} sin confirmación.`] }))).toEqual([]);
  });
  it('parámetros de indicadores, años y fechas no cuentan como cifras', () => {
    expect(errs(base({ resumen: 'La EMA8 supera a la EMA21 y la EMA200 sube; RSI de 14 periodos; al 2026-11-03.' }))).toEqual([]);
    expect(errs(base({ resumen: 'El RSI de 14 periodos pasó de 30 a 70 en los extremos.' }))).toEqual([]);
    expect(errs(base({ resumen: 'El cierre está sobre la media de 200 sesiones y la de 21.' }))).toEqual([]);
    expect(errs(base({ resumen: 'El cierre está sobre la media de 150 sesiones.' })).some(x => x.startsWith('resumen cita cifras'))).toBe(true);
  });
  it('un nivel citado en el texto necesita su dato en datos_fuente', () => {
    const n = s.snapshot.niveles_calculados[0]!;
    const it = s.items.find(i => i.id === n.id)!;
    const t = `El nivel en ${f2(Number(n.precio))} es relevante.`;
    expect(errs(base({ resumen: t })).some(x => x.startsWith('resumen cita cifras'))).toBe(true);
    expect(errs(base({ resumen: t, datos_fuente: [rsi, cierre, it] }))).toEqual([]);
  });
  it('una distancia calculada por el modelo se rechaza', () => {
    expect(errs(base({ resumen: 'El precio está 12.34% por encima de la media.' })).some(x => x.startsWith('resumen cita cifras'))).toBe(true);
  });
  it('erroresDeCifras ignora salidas mal formadas (otros validadores las reportan)', () => {
    const fuentes = new Map(s.items.map(i => [i.id, i]));
    expect(erroresDeCifras({ resumen: 5, hallazgos: [5, { evidencia: 'x' }, { texto: 'x', evidencia: [5] }], negativos: 'x' }, fuentes, new Set(), [])).toEqual([]);
    expect(erroresDeCifras({}, fuentes, new Set(), [])).toEqual([]);
  });
  it('el mensaje solo lista datos numéricos, hasta el máximo', () => {
    const fuentes = new Map(s.items.map(i => [i.id, i]));
    const todos = new Set(s.items.map(i => i.id));
    const e = erroresDeCifras({ resumen: 'vale 98765.4321' }, fuentes, todos, []);
    expect(e).toHaveLength(1);
    expect((e[0]!.match(/=/g) ?? []).length).toBe(MAX_VALORES_EN_MENSAJE);
    expect(erroresDeCifras({ resumen: 'vale 98765.4321' }, fuentes, new Set(), [])[0]).toContain('(no hay datos numéricos citados)');
    // un valor de texto que parece número NO respalda una cifra
    const parecido = new Map([['t', { id: 't', campo: 't', valor: '5.55', unidad: null, fuente: 'x', fecha_dato: '2026-01-01' }]]);
    expect(erroresDeCifras({ resumen: 'vale 5.55' }, parecido, new Set(['t']), [])).toHaveLength(1);
    const soloTexto = new Map([['t', { id: 't', campo: 't', valor: 'texto', unidad: null, fuente: 'x', fecha_dato: '2026-01-01' }]]);
    expect(erroresDeCifras({ resumen: 'vale 98765.4321' }, soloTexto, new Set(['t']), [])[0]).toContain('(no hay datos numéricos citados)');
  });
  it('numerosPermitidos suma los dígitos de ids, campos y fechas más los extras', () => {
    const p = numerosPermitidos([{ id: 'ind_ema21', campo: 'ema21', valor: 1, unidad: null, fuente: 'f', fecha_dato: '2026-11-03' }], [14]);
    expect(p).toEqual(expect.arrayContaining([21, 2026, 11, 3, 14]));
    const it = (id: string, campo: string, fecha = '2026-01-01') => ({ id, campo, valor: 1, unidad: null, fuente: 'f', fecha_dato: fecha });
    expect(numerosPermitidos([it('x77', 'y')])).toContain(77);
    expect(numerosPermitidos([it('z', 'k88')])).toContain(88);
    expect(numerosPermitidos([it('z', 'y', '2031-05-09')])).toEqual(expect.arrayContaining([2031, 5, 9]));
    expect(numerosPermitidos([], [])).toEqual([]);
  });
});

describe('v0.15: Fundamental: cifras de la salida', () => {
  const sobre = sobreBase();
  const errs = (x: Obj): string[] => { const v = validarSalidaFundamental(x, sobre); return v.ok ? [] : v.errores; };
  const salida = (cambios: Obj = {}): Obj => ({ ...salidaBase(), ...cambios }) as unknown as Obj;
  it('la salida base pasa', () => {
    expect(errs(salida())).toEqual([]);
  });
  it('una cifra del hallazgo que no es la de su dato se rechaza', () => {
    const h = [{ id: 'h1', tipo: 'positivo', texto: 'Margen bruto de 0.81 en el último reporte.', evidencia: ['d2'] }, { id: 'h2', tipo: 'negativo', texto: 'Concentración en un solo producto.', evidencia: ['d3'] }];
    const e = errs(salida({ hallazgos: h }));
    expect(e.some(x => x.startsWith('hallazgos[0] cita cifras que no coinciden con los datos de su evidencia: 0.81'))).toBe(true);
  });
  it('como porcentaje y en millones también respaldadas', () => {
    const h = [{ id: 'h1', tipo: 'positivo', texto: 'Margen bruto de 82% con ingresos de 123.5 millones.', evidencia: ['d1', 'd2'] }, { id: 'h2', tipo: 'negativo', texto: 'Concentración en un solo producto.', evidencia: ['d3'] }];
    expect(errs(salida({ hallazgos: h }))).toEqual([]);
  });
  it('solo respaldan los datos que la salida copió en datos_fuente, no cualquier item del sobre', () => {
    const solo = [sobre.snapshot.datos.items[1]!, sobre.snapshot.datos.items[2]!];   // d2 y d3; d1 (ingresos) NO se copia
    const e = errs(salida({ datos_fuente: solo, resumen: 'Ingresos de 123.5 millones.' }));
    expect(e.some(x => x.startsWith('resumen cita cifras'))).toBe(true);
    expect(errs(salida({ resumen: 'Ingresos de 123.5 millones.' }))).toEqual([]);
  });
  it('el resumen y los negativos también se revisan', () => {
    expect(errs(salida({ resumen: 'Margen bruto de 0.9.' })).some(x => x.startsWith('resumen cita cifras'))).toBe(true);
    expect(errs(salida({ negativos: ['Deuda de 77 millones.'] })).some(x => x.startsWith('negativos[0] cita cifras'))).toBe(true);
    expect(errs(salida({ resumen: 'Margen bruto de 0.82 sostenido.' }))).toEqual([]);
  });
  it('el año fiscal en el texto no cuenta como cifra', () => {
    expect(errs(salida({ resumen: 'Ingresos del fy2024 con margen bruto de 0.82.' }))).toEqual([]);
    expect(errs(salida({ resumen: 'En 2026 el margen bruto fue 0.82.' }))).toEqual([]);
  });
});

describe('v0.15: prompts', () => {
  it('versiones', () => {
    expect(VERSION_PROMPT_TECNICO).toBe('tecnico.p4');
    expect(VERSION_PROMPT_FUNDAMENTAL).toBe('fundamental.p7');
  });
  it('el Técnico recibe las reglas nuevas', () => {
    for (const t of ['REDONDEADA', 'nunca truncada', '62.0196 se escribe 62.02', 'cita ese item en `datos_fuente`', 'No calcules diferencias', 'solo si perjudica la lectura', 'es `neutral`', 'ya está dentro de la zona', 'evento concreto']) {
      expect(PROMPT_TECNICO).toContain(t);
    }
  });
  it('el Fundamental recibe la regla de cifras', () => {
    for (const t of ['REDONDEADA', 'nunca truncada', 'porcentaje (ratio por 100)', 'No calcules cifras nuevas', 'El código rechaza una cifra']) expect(PROMPT_FUNDAMENTAL).toContain(t);
  });
});

describe('v0.15: guardado: el Técnico con una cifra truncada falla y queda declarado', () => {
  const entrada = (fy: number, ingresos: number) => ({
    fiscalYear: fy, fiscalPeriod: 0, endDate: `${fy}-12-31`, currency: 'USD', revenue: ingresos, costOfRevenue: null, grossProfit: ingresos * 0.8, opex: null, sgaExp: null, rndExp: null,
    opIncome: ingresos * 0.2, otherNetIncome: null, ebt: null, incomeTax: null, netIncome: ingresos * 0.1, dilutedAvgShares: 1000, dilutedEps: 0.1, interestNet: null,
  });
  const RESP: Record<string, unknown> = {
    '/api/webull/income-statement': { success: true, symbol: 'GKOS', annual: [entrada(2023, 1200), entrada(2024, 1500)], ttm: null, forwardEps: null },
    'freq=annual': { data: [{ year: 2025, quarter: 0, form: '10-K', endDate: '2025-12-31', filedDate: '2026-02-23', report: { bs: [{ concept: 'us-gaap_Assets', unit: 'u_usd', value: 893487000 }], cf: [] } }] },
    'freq=quarterly': { data: [{ year: 2026, quarter: 3, form: '10-Q', endDate: '2026-09-30', filedDate: '2026-10-28', report: { bs: [], cf: [{ concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', unit: 'u_usd', value: 40867000 }] } }] },
    '/stock/metric': { metric: { currentRatioAnnual: 4.69 } },
    'interval=1day': respuestaChart('GKOS', '1day', DIARIAS_PRUEBA()),
    'interval=1week': respuestaChart('GKOS', '1week', SEMANALES_PRUEBA()),
  };
  const fetchFn: FetchDatos = async url => { const k = Object.keys(RESP).find(x => url.includes(x))!; return { ok: true, status: 200, json: async () => RESP[k] }; };
  const correr = async (m: ReturnType<typeof modeloFalso>) => {
    const b = nuevaBdGuardado({}, {});
    let n = 0;
    const d = { llamar: m.llamar, modelo_analista: 'ma', modelo_director: 'md', ahora: () => AHORA, nuevoId: () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}` };
    return { b, r: await ejecutarAnalisisGuardado(b.cliente, d, { fetchFn, origen: 'https://x.test', authorization: 'Bearer T', finnhub_key: 'k' }, { ticker: 'GKOS', guardar: true }) };
  };
  it('un resumen con una cifra inventada se rechaza dos veces y el Técnico queda en error, sin guardar', async () => {
    const m = modeloFalso({ directorPropone: true, tecnicoSalida: b => ({ ...b, resumen: 'El RSI está en 99.99.' }) });
    const { b, r } = await correr(m);
    expect(r.cuerpo['tecnico']).toMatchObject({ estado: 'error' });
    expect(String((r.cuerpo['tecnico'] as Obj)['error'])).toContain('resumen cita cifras que no coinciden');
    // 2 intentos por validación × los reintentos del Orquestador por agente
    expect(m.peticiones.filter(p => p.esquema_nombre === 'salida_tecnico_v1').length).toBeGreaterThanOrEqual(2);
    expect(b.e.inserts.some(i => i.tabla === 'oficina_analisis' && i.fila['agente'] === 'tecnico')).toBe(false);
    expect(r.cuerpo['analisis_completo']).toBe(false);
  });
  it('el reintento lleva el mensaje del validador con el dato correcto', async () => {
    const m = modeloFalso({ directorPropone: true, tecnicoSalida: b => ({ ...b, resumen: 'El RSI está en 99.99.' }) });
    await correr(m);
    const segunda = m.peticiones.filter(p => p.esquema_nombre === 'salida_tecnico_v1')[1]!;
    expect(segunda.mensajes[segunda.mensajes.length - 1]!.content).toContain('Tu respuesta fue rechazada por el validador: resumen cita cifras');
  });
});

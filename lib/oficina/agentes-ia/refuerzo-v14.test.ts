// Pruebas de la v0.14: Analista Técnico (velas de chart-data, sobre, validador, puerto y guardado). Base, modelo y red falsos: nunca se llama a la red.
import { describe, expect, it } from 'vitest';
import {
  AGENTE_TECNICO, ESQUEMA_TECNICO, PROMPT_TECNICO, TOPE_CONFIANZA_CON_FALTANTES, VERSION_PROMPT_TECNICO, crearPuertoAnalista, ejecutarAnalisisGuardado, extraerVelas, filaAnalisisIa,
  itemsDesdeSnapshotTecnico, mensajeTecnicoParaModelo, obtenerVelas, validarSalidaTecnicoIa, validarSobreTecnico,
} from './index';
import type { FetchDatos, SobreTecnicoValido } from './index';
import { modeloFalso } from './modelo-falso.test-util';
import { PF, nuevaBdGuardado } from './bd-guardado.test-util';
import type { Fila } from './bd-guardado.test-util';
import { DIARIAS_PRUEBA, SEMANALES_PRUEBA, respuestaChart, velasDiarias, velasSemanales } from './velas.test-util';
import { prepararTecnico } from '../orquestador/preparar-tecnico';
import type { Obj } from './utilidades';

const TOKEN = 'Bearer TOKEN-SECRETO-DEL-DUENO-456';
const CLAVE = 'CLAVE-SECRETA-FINNHUB-123';
const AHORA = '2026-11-04T15:00:00.000Z';
const RUN = '11111111-1111-4111-8111-111111111111';
const SNAP = '22222222-2222-4222-8222-222222222222';

// ---------- sobre y salida válidos del Técnico (a partir del cálculo de código real) ----------
function tecnicoCodigo(dias = 600, semanas = 260) {
  return prepararTecnico({ ticker: 'GKOS', mercado: 'US', evaluado_en: AHORA, fuente: 'TwelveData', velas_diarias: velasDiarias('2026-11-03', dias), velas_semanales: velasSemanales('2026-11-02', semanas) });
}
const sobreCrudo = (tc: Obj | null = tecnicoCodigo() as unknown as Obj): Obj => ({
  contrato: 'entrada.v1', run_id: RUN, agente: 'tecnico', ticker: 'GKOS', mercado: 'US', snapshot: { id: SNAP, generado_en: AHORA },
  ...(tc === null ? {} : { tecnico_codigo: { estado: tc['estado'], snapshot: tc['snapshot'], detonantes: tc['detonantes'], descartes: tc['descartes'], motivos: tc['motivos'] } }),
});
function sobreValido(dias = 600, semanas = 260): SobreTecnicoValido {
  const r = validarSobreTecnico(sobreCrudo(tecnicoCodigo(dias, semanas) as unknown as Obj));
  if (!r.ok) throw new Error(r.errores.join('; '));
  return r.valor;
}
function salidaBuena(s: SobreTecnicoValido): Record<string, unknown> {
  const cierreItem = s.items.find(i => i.id === 'cierre_ultima_vela_diaria')!;
  const cierre = cierreItem.valor as number;
  const niv = s.snapshot.niveles_calculados;
  const sop = niv.filter(n => Number(n.precio) <= cierre).sort((a, b) => Number(b.precio) - Number(a.precio))[0];
  const res = niv.filter(n => Number(n.precio) >= cierre).sort((a, b) => Number(a.precio) - Number(b.precio))[0];
  return {
    contrato: 'salida.v1', agente: 'tecnico', run_id: RUN, snapshot_id: SNAP, ticker: 'GKOS', veredicto: 'ESPERAR', confianza: 0.7, resumen: 'Sin confirmación técnica todavía.',
    tendencia: { corto: 'lateral', medio: 'lateral', largo: 'alcista' },
    hallazgos: [{ id: 'h1', tipo: 'neutral', texto: 'El precio cerró en la última sesión confirmada.', evidencia: ['cierre_ultima_vela_diaria'] }],
    negativos: ['No hay señal de entrada confirmada.'], datos_fuente: [cierreItem],
    zona_entrada: null,
    soporte_clave: sop === undefined ? null : { precio: Number(sop.precio), nivel_id: sop.id },
    resistencia_clave: res === undefined ? null : { precio: Number(res.precio), nivel_id: res.id },
    nivel_invalidacion: null, datos_faltantes: [],
  };
}
const errs = (x: unknown, s: SobreTecnicoValido): string[] => { const r = validarSalidaTecnicoIa(x, s); return r.ok ? [] : r.errores; };
const con = (s: SobreTecnicoValido, cambios: Record<string, unknown>): Record<string, unknown> => ({ ...salidaBuena(s), ...cambios });

// ---------- red falsa de chart-data ----------
interface Llamada { url: string; headers: Record<string, string>; redirect: string }
function redChart(opc: { dia?: unknown; sem?: unknown; statusDia?: number; statusSem?: number; lanza?: 'dia' | 'sem' } = {}) {
  const llamadas: Llamada[] = [];
  const fetchFn: FetchDatos = async (url, init) => {
    llamadas.push({ url, headers: init.headers, redirect: init.redirect });
    const dia = url.includes('interval=1day');
    if (opc.lanza === (dia ? 'dia' : 'sem')) throw new Error(`fallo con ${TOKEN}`);
    const status = (dia ? opc.statusDia : opc.statusSem) ?? 200;
    const cuerpo = dia ? (opc.dia ?? respuestaChart('GKOS', '1day', DIARIAS_PRUEBA())) : (opc.sem ?? respuestaChart('GKOS', '1week', SEMANALES_PRUEBA()));
    return { ok: status >= 200 && status < 300, status, json: async () => cuerpo };
  };
  return { fetchFn, llamadas };
}
const deps = (fetchFn: FetchDatos) => ({ fetchFn, origen: 'https://app.test', authorization: TOKEN, finnhub_key: CLAVE });

describe('v0.14: forma de la respuesta de chart-data', () => {
  const vela = { time: 1, open: 1, high: 2, low: 1, close: 2, volume: 5 };
  it('acepta candles y copia solo los 6 campos', () => {
    const r = extraerVelas({ symbol: 'X', candles: [{ ...vela, extra: 'no' }], mas: { ema8: [1] } });
    expect(r).toEqual({ ok: true, velas: [vela] });
  });
  it('rechaza formas inválidas con un motivo', () => {
    expect(extraerVelas(null)).toMatchObject({ ok: false });
    expect(extraerVelas([])).toMatchObject({ ok: false });
    expect(extraerVelas({})).toEqual({ ok: false, error: 'la respuesta no trae la lista candles' });
    expect(extraerVelas({ candles: [] })).toEqual({ ok: false, error: 'candles viene vacía' });
    expect(extraerVelas({ candles: [vela, 5] })).toEqual({ ok: false, error: 'candles[1] no es un objeto' });
    expect(extraerVelas({ candles: [{ time: 1, open: 1 }] })).toEqual({ ok: false, error: 'candles[0] sin high, low, close, volume' });
    expect(extraerVelas({ candles: [null] })).toMatchObject({ ok: false });
    expect(extraerVelas({ candles: [[1, 2]] })).toMatchObject({ ok: false });
  });
  it('un valor no numérico pasa la forma y lo detiene validarVelas del Técnico (no esta capa)', () => {
    const r = extraerVelas({ candles: [{ ...vela, close: 'x' }] });
    expect(r.ok).toBe(true);
  });
});

describe('v0.14: obtenerVelas (chart-data, solo lectura)', () => {
  it('pide diario y semanal a la ruta interna con el token y sin seguir redirecciones', async () => {
    const red = redChart();
    const r = await obtenerVelas(deps(red.fetchFn), 'BRK.B');
    expect(r.ok).toBe(true);
    expect(red.llamadas.map(l => l.url).sort()).toEqual(['https://app.test/api/chart-data?symbol=BRK.B&interval=1day', 'https://app.test/api/chart-data?symbol=BRK.B&interval=1week'].sort());
    for (const l of red.llamadas) { expect(l.headers['Authorization']).toBe(TOKEN); expect(l.redirect).toBe('manual'); }
    if (r.ok) {
      expect(r.velas.diarias).toHaveLength(300);
      expect(r.velas.semanales).toHaveLength(120);
      expect(r.velas.fuente).toBe('TwelveData (vía /api/chart-data)');
      expect(r.avisos).toEqual([]);
    }
  });
  it('codifica el símbolo en la URL', async () => {
    const red = redChart();
    await obtenerVelas(deps(red.fetchFn), 'EUR/USD');
    expect(red.llamadas[0]!.url).toContain('symbol=EUR%2FUSD');
  });
  it('si falla la semanal sigue con semanales vacías y lo avisa', async () => {
    const r = await obtenerVelas(deps(redChart({ statusSem: 429 }).fetchFn), 'GKOS');
    expect(r).toMatchObject({ ok: true, velas: { semanales: [] } });
    if (r.ok) { expect(r.velas.fuente).toBe('TwelveData (vía /api/chart-data)'); expect(r.velas.diarias).toHaveLength(300); expect(r.avisos).toEqual(['velas semanales (chart-data): HTTP 429; se sigue solo con las diarias']); }
  });
  it('si falla la semanal por forma, también sigue', async () => {
    const r = await obtenerVelas(deps(redChart({ sem: { error: 'x' } }).fetchFn), 'GKOS');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.avisos[0]).toContain('la respuesta no trae la lista candles');
  });
  it('si falla la diaria no hay velas (aunque la semanal esté bien)', async () => {
    for (const opc of [{ statusDia: 502 }, { dia: { candles: [] } }, { lanza: 'dia' as const }]) {
      const r = await obtenerVelas(deps(redChart(opc).fetchFn), 'GKOS');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/^velas diarias \(chart-data\): .*no se rellena$/);
    }
  });
  it('los errores no incluyen tokens ni cuerpos de respuesta', async () => {
    const r = await obtenerVelas(deps(redChart({ lanza: 'dia' }).fetchFn), 'GKOS');
    expect(JSON.stringify(r)).not.toContain('TOKEN-SECRETO');
  });
  it('una redirección no se sigue y se informa', async () => {
    const r = await obtenerVelas(deps(redChart({ statusDia: 302 }).fetchFn), 'GKOS');
    expect(r).toEqual({ ok: false, error: expect.stringContaining('redirección HTTP 302') });
  });
});

describe('v0.14: items del Técnico (todo sale del cálculo de código)', () => {
  const s = sobreValido();
  it('ids únicos; niveles, cierres, banderas, señales e indicadores presentes', () => {
    const ids = s.items.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('cierre_ultima_vela_diaria');
    expect(ids).toContain('cierre_ultima_vela_semanal');
    expect(ids).toContain('ind_rsi14');
    expect(ids).toContain('cierre_sobre_ema200_diaria');
    for (const g of s.snapshot.senales) expect(ids).toContain(`senal_${g.id}`);
    for (const n of s.snapshot.niveles_calculados) expect(s.items.find(i => i.id === n.id)).toMatchObject({ campo: `nivel_${n.tipo}`, valor: Number(n.precio), unidad: 'precio' });
  });
  it('el cierre diario es el de la última vela confirmada y lleva su fecha', () => {
    const c = s.items.find(i => i.id === 'cierre_ultima_vela_diaria')!;
    expect(c).toMatchObject({ valor: Number(s.snapshot.ultima_vela_diaria!.cierre), unidad: 'precio', fecha_dato: '2026-11-03' });
    const w = s.items.find(i => i.id === 'cierre_ultima_vela_semanal')!;
    expect(w.fecha_dato).toBe('2026-10-26');
  });
  it('la volatilidad lleva unidad porcentaje y la sma200 semanal la fecha semanal', () => {
    const v = s.items.find(i => i.id === 'ind_volatilidad_atr14_pct');
    if (v !== undefined) expect(v.unidad).toBe('porcentaje');
    const m = s.items.find(i => i.id === 'ind_sma200_semanal');
    if (m !== undefined) expect(m.fecha_dato).toBe('2026-10-26');
    expect(s.items.find(i => i.id === 'ind_rsi14')!.unidad).toBeNull();
  });
  it('señal sin datos no se rellena con false; banderas si/no', () => {
    const snap = { ...s.snapshot, senales: [{ id: 'RSI_SOBREVENTA', cumplida: null, detalle: 'x' }, { id: 'KONCORDE_BAJO_CERO', cumplida: true, detalle: 'x' }, { id: 'EMA8_SOBRE_EMA21', cumplida: false, detalle: 'x' }] } as never;
    const it = itemsDesdeSnapshotTecnico(snap as never);
    expect(it.find(i => i.id === 'senal_RSI_SOBREVENTA')!.valor).toBe('sin_datos');
    expect(it.find(i => i.id === 'senal_KONCORDE_BAJO_CERO')!.valor).toBe('cumplida');
    expect(it.find(i => i.id === 'senal_EMA8_SOBRE_EMA21')!.valor).toBe('no_cumplida');
    const b = itemsDesdeSnapshotTecnico({ ...s.snapshot, cierre_sobre_ema200_diaria: false, cierre_sobre_sma200_semanal: true } as never);
    expect(b.find(i => i.id === 'cierre_sobre_ema200_diaria')!.valor).toBe('no');
    expect(b.find(i => i.id === 'cierre_sobre_sma200_semanal')!.valor).toBe('si');
    const n = itemsDesdeSnapshotTecnico({ ...s.snapshot, cierre_sobre_ema200_diaria: null, cierre_sobre_sma200_semanal: null } as never);
    expect(n.some(i => i.id.startsWith('cierre_sobre_'))).toBe(false);
  });
  it('un indicador NaN o infinito no genera item; la fuente declara que lo calculó el código', () => {
    const it = itemsDesdeSnapshotTecnico({ ...s.snapshot, indicadores: { ...s.snapshot.indicadores, rsi14: NaN, adx14: Infinity } } as never);
    expect(it.some(i => i.id === 'ind_rsi14' || i.id === 'ind_adx14')).toBe(false);
    expect(it.length).toBeGreaterThan(5);
    for (const i of it) expect(i.fuente).toBe(`${s.snapshot.fuente}; calculado por código`);
  });
  it('sin vela semanal no hay item de cierre semanal; indicadores nulos no generan item', () => {
    const it = itemsDesdeSnapshotTecnico({ ...s.snapshot, ultima_vela_semanal: null, indicadores: { ...s.snapshot.indicadores, rsi14: null } } as never);
    expect(it.some(i => i.id === 'cierre_ultima_vela_semanal')).toBe(false);
    expect(it.some(i => i.id === 'ind_rsi14')).toBe(false);
  });
  it('un nivel sin fecha de origen usa la fecha de la última vela diaria', () => {
    const it = itemsDesdeSnapshotTecnico({ ...s.snapshot, niveles_calculados: [{ id: 'n1', tipo: 'ema21_diaria', precio: '10.0000', fecha_origen: null }] } as never);
    expect(it.find(i => i.id === 'n1')!.fecha_dato).toBe('2026-11-03');
    const it2 = itemsDesdeSnapshotTecnico({ ...s.snapshot, niveles_calculados: [{ id: 'n1', tipo: 'pivote_soporte', precio: '10.0000', fecha_origen: '2026-01-02' }] } as never);
    expect(it2.find(i => i.id === 'n1')!.fecha_dato).toBe('2026-01-02');
  });
  it('sin velas el item de cierre usa la fecha de evaluación en indicadores', () => {
    const it = itemsDesdeSnapshotTecnico({ ...s.snapshot, ultima_vela_diaria: null, ultima_vela_semanal: null } as never);
    expect(it.some(i => i.id === 'cierre_ultima_vela_diaria')).toBe(false);
    expect(it.find(i => i.id === 'ind_rsi14')!.fecha_dato).toBe(s.snapshot.fecha_evaluacion);
  });
});

describe('v0.14: sobre del Técnico', () => {
  it('válido con el cálculo de código completo o parcial', () => {
    expect(validarSobreTecnico(sobreCrudo())).toMatchObject({ ok: true, valor: { run_id: RUN, estado: 'completo' } });
    expect(validarSobreTecnico(sobreCrudo(tecnicoCodigo(300, 120) as unknown as Obj))).toMatchObject({ ok: true, valor: { estado: 'parcial' } });
  });
  it('sin tecnico_codigo (sin velas) no se llama al modelo', () => {
    const r = validarSobreTecnico(sobreCrudo(null));
    expect(r).toEqual({ ok: false, errores: ['tecnico_codigo ausente: no hay cálculo de código del Técnico (sin velas); no se llama al modelo'] });
  });
  it('NO_EVALUABLE y pendiente cortan antes del modelo e incluyen los motivos', () => {
    const corto = prepararTecnico({ ticker: 'GKOS', mercado: 'US', evaluado_en: AHORA, fuente: 'TwelveData', velas_diarias: velasDiarias('2026-11-03', 20), velas_semanales: velasSemanales('2026-11-02', 5) });
    expect(corto.estado).toBe('NO_EVALUABLE');
    const r = validarSobreTecnico(sobreCrudo(corto as unknown as Obj));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores[0]).toMatch(/^el cálculo de código del Técnico quedó en NO_EVALUABLE \(.+\); no se llama al modelo$/);
    const pend = prepararTecnico({ ticker: 'GKOS', mercado: 'US', evaluado_en: 'no es fecha', fuente: 'TwelveData', velas_diarias: velasDiarias('2026-11-03', 20), velas_semanales: [] });
    expect(pend.estado).toBe('pendiente');
    const r2 = validarSobreTecnico(sobreCrudo(pend as unknown as Obj));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errores[0]).toContain('quedó en pendiente');
  });
  it('rechaza contrato, agente, ids, mercado y snapshot inválidos', () => {
    const base = sobreCrudo();
    const malo = (c: Obj) => validarSobreTecnico({ ...base, ...c });
    for (const c of [{ contrato: 'x' }, { agente: 'fundamental' }, { run_id: 'x' }, { ticker: '' }, { mercado: 'EU' }, { snapshot: null }, { snapshot: { id: 'x', generado_en: AHORA } }, { snapshot: { id: SNAP, generado_en: '' } }]) {
      expect(malo(c).ok).toBe(false);
    }
    expect(validarSobreTecnico(null)).toEqual({ ok: false, errores: ['el sobre no es un objeto'] });
    expect(validarSobreTecnico([])).toMatchObject({ ok: false });
  });
  it('un snapshot de código malformado se rechaza', () => {
    const base = sobreCrudo() as Obj;
    const tc = base['tecnico_codigo'] as Obj;
    for (const snap of [null, {}, { ...(tc['snapshot'] as Obj), niveles_calculados: 'x' }, { ...(tc['snapshot'] as Obj), senales: null }, { ...(tc['snapshot'] as Obj), indicadores: null }, { ...(tc['snapshot'] as Obj), fuente: '' }, { ...(tc['snapshot'] as Obj), fecha_evaluacion: '' }]) {
      expect(validarSobreTecnico({ ...base, tecnico_codigo: { ...tc, snapshot: snap } }).ok).toBe(false);
    }
  });
  it('el mensaje al modelo lleva solo datos públicos de mercado: items, niveles, señales, estado y avisos', () => {
    const s = sobreValido(300, 120);
    const m = mensajeTecnicoParaModelo(s);
    expect(Object.keys(m).sort()).toEqual(['agente', 'contrato', 'mercado', 'run_id', 'snapshot', 'ticker']);
    const datos = (m['snapshot'] as Obj)['datos'] as Obj;
    expect(Object.keys(datos).sort()).toEqual(['avisos', 'descartes', 'estado_calculo', 'items', 'niveles_calculados', 'senales']);
    expect(datos['estado_calculo']).toBe('parcial');
    expect((datos['senales'] as Obj[])[0]).toHaveProperty('detalle');
    expect(datos['senales']).toEqual(s.snapshot.senales.map(g => ({ id: g.id, cumplida: g.cumplida, detalle: g.detalle })));
    expect(JSON.stringify(m)).not.toMatch(/posicion|portafolio|tipo_evaluacion|auditor|tesis/i);
  });
});

describe('v0.14: validador de la salida del Técnico', () => {
  const s = sobreValido();
  it('la salida buena pasa', () => {
    expect(validarSalidaTecnicoIa(salidaBuena(s), s)).toMatchObject({ ok: true });
    expect(salidaBuena(s)['soporte_clave']).not.toBeNull();
    expect(salidaBuena(s)['resistencia_clave']).not.toBeNull();
  });
  it('forma, ids y veredicto', () => {
    expect(validarSalidaTecnicoIa(null, s)).toEqual({ ok: false, errores: ['la salida no es un objeto'] });
    expect(errs(con(s, { contrato: 'x' }), s)).toContain('contrato debe ser salida.v1');
    expect(errs(con(s, { agente: 'fundamental' }), s)).toContain('agente debe ser tecnico');
    expect(errs(con(s, { run_id: 'otro' }), s)).toContain('run_id no coincide con el del sobre');
    expect(errs(con(s, { snapshot_id: 'otro' }), s)).toContain('snapshot_id no coincide con el del sobre');
    expect(errs(con(s, { ticker: 'AAPL' }), s)).toContain('ticker no coincide con el del sobre');
    expect(errs(con(s, { confianza: 2 }), s).some(e => e.includes('confianza debe estar entre'))).toBe(true);
    expect(errs(con(s, { resumen: '' }), s).some(e => e.includes('resumen obligatorio'))).toBe(true);
    expect(errs(con(s, { resumen: 'x'.repeat(601) }), s).some(e => e.includes('resumen obligatorio'))).toBe(true);
  });
  it('datos_fuente: solo items calculados, idénticos', () => {
    const c = s.items.find(i => i.id === 'cierre_ultima_vela_diaria')!;
    expect(errs(con(s, { datos_fuente: [{ ...c, id: 'inventado' }] }), s).some(e => e.includes('no existe en los datos calculados'))).toBe(true);
    expect(errs(con(s, { datos_fuente: [{ ...c, valor: 1 }] }), s).some(e => e.includes('no coincide con el dato calculado'))).toBe(true);
    expect(errs(con(s, { datos_fuente: [{ ...c, fuente: '' }] }), s).some(e => e.includes('sin fuente o fecha_dato'))).toBe(true);
    expect(errs(con(s, { datos_fuente: [{ ...c, fecha_dato: 'ayer' }] }), s).some(e => e.includes('sin fuente o fecha_dato'))).toBe(true);
    expect(errs(con(s, { datos_fuente: 'x' }), s)).toContain('datos_fuente debe ser una lista');
    expect(errs(con(s, { datos_fuente: [5] }), s)).toContain('datos_fuente[0] no es objeto');
  });
  it('hallazgos: evidencia obligatoria y cifras citadas', () => {
    expect(errs(con(s, { hallazgos: [{ id: 'h1', tipo: 'neutral', texto: 'x', evidencia: ['ind_rsi14'] }] }), s).some(e => e.includes('no está en datos_fuente'))).toBe(true);
    expect(errs(con(s, { hallazgos: [{ id: 'h1', tipo: 'neutral', texto: 'El RSI vale 55', evidencia: [] }] }), s).some(e => e.includes('cifra sin evidencia'))).toBe(true);
    expect(errs(con(s, { hallazgos: [] }), s)).toContain('un veredicto distinto de NO_EVALUABLE exige al menos un hallazgo con evidencia citada');
    expect(errs(con(s, { hallazgos: [{ id: 'h1', tipo: 'neutral', texto: 'sin cifra', evidencia: [] }] }), s)).toContain('un veredicto distinto de NO_EVALUABLE exige al menos un hallazgo con evidencia citada');
    const h = { id: 'h1', tipo: 'neutral', texto: 'x', evidencia: ['cierre_ultima_vela_diaria'] };
    expect(errs(con(s, { hallazgos: [5, h] }), s)).toContain('hallazgos[0] no es objeto');
    // un hallazgo sin cifra y sin evidencia es válido si otro sustenta el veredicto
    expect(errs(con(s, { hallazgos: [h, { id: 'h2', tipo: 'neutral', texto: 'Contexto general sin cifras.', evidencia: [] }] }), s)).toEqual([]);
    expect(errs(con(s, { hallazgos: [h, h] }), s).some(e => e.includes('id repetido'))).toBe(true);
    expect(errs(con(s, { hallazgos: [{ ...h, tipo: 'raro' }] }), s).some(e => e.includes('tipo inválido'))).toBe(true);
    expect(errs(con(s, { hallazgos: [{ ...h, texto: '' }] }), s).some(e => e.includes('texto ausente'))).toBe(true);
    expect(errs(con(s, { hallazgos: [{ ...h, id: '' }] }), s).some(e => e.includes('id ausente'))).toBe(true);
    expect(errs(con(s, { hallazgos: [{ ...h, evidencia: 'x' }] }), s).some(e => e.includes('evidencia debe ser una lista'))).toBe(true);
    expect(errs(con(s, { hallazgos: 'x' }), s)).toContain('hallazgos debe ser una lista');
  });
  it('negativos obligatorios', () => {
    expect(errs(con(s, { negativos: [] }), s).some(e => e.includes('negativos debe traer'))).toBe(true);
    expect(errs(con(s, { negativos: [''] }), s).some(e => e.includes('negativos debe traer'))).toBe(true);
  });
  it('datos faltantes: críticos solo con NO_EVALUABLE; tope de confianza', () => {
    expect(errs(con(s, { datos_faltantes: [{ campo: 'x', critico: true }], confianza: 0.5 }), s)).toContain('hay datos_faltantes críticos: el veredicto debe ser NO_EVALUABLE');
    expect(errs(con(s, { datos_faltantes: [{ campo: 'x', critico: false }], confianza: TOPE_CONFIANZA_CON_FALTANTES + 0.05 }), s).some(e => e.includes('no puede superar'))).toBe(true);
    expect(errs(con(s, { datos_faltantes: [{ campo: 'x', critico: false }], confianza: TOPE_CONFIANZA_CON_FALTANTES }), s)).toEqual([]);
    expect(errs(con(s, { datos_faltantes: [{ campo: '', critico: false }] }), s).some(e => e.includes('datos_faltantes[0] inválido'))).toBe(true);
    expect(errs(con(s, { datos_faltantes: [{ campo: 'x', critico: 'si' }] }), s).some(e => e.includes('datos_faltantes[0] inválido'))).toBe(true);
    expect(errs(con(s, { datos_faltantes: 'x' }), s)).toContain('datos_faltantes debe ser una lista');
  });
  it('NO_EVALUABLE: exige faltantes, sin niveles, y no pide hallazgos con evidencia', () => {
    const noEval = { veredicto: 'NO_EVALUABLE', hallazgos: [], zona_entrada: null, soporte_clave: null, resistencia_clave: null, nivel_invalidacion: null, confianza: 0.3 };
    expect(errs(con(s, { ...noEval, datos_faltantes: [{ campo: 'velas', critico: true }] }), s)).toEqual([]);
    expect(errs(con(s, { ...noEval, datos_faltantes: [] }), s)).toContain('NO_EVALUABLE exige listar datos_faltantes');
    const ausentes = { ...con(s, { ...noEval, datos_faltantes: [{ campo: 'velas', critico: true }] }) };
    for (const k of ['zona_entrada', 'soporte_clave', 'resistencia_clave', 'nivel_invalidacion']) delete ausentes[k];
    expect(errs(ausentes, s)).toEqual([]);
    const n = s.snapshot.niveles_calculados[0]!;
    const e = errs(con(s, { ...noEval, datos_faltantes: [{ campo: 'x', critico: true }], soporte_clave: { precio: Number(n.precio), nivel_id: n.id } }), s);
    expect(e.some(x => x.startsWith('soporte_clave debe ser null con NO_EVALUABLE'))).toBe(true);
    for (const k of ['zona_entrada', 'resistencia_clave', 'nivel_invalidacion']) {
      expect(errs(con(s, { ...noEval, datos_faltantes: [{ campo: 'x', critico: true }], [k]: { precio: 1, nivel_id: 'n1' } }), s).some(x => x.startsWith(`${k} debe ser null con NO_EVALUABLE`))).toBe(true);
    }
  });
  it('cálculo parcial: obliga a declarar lo que no se calculó', () => {
    const p = sobreValido(300, 120);
    expect(p.estado).toBe('parcial');
    expect(errs(salidaBuena(p), p)).toContain('el cálculo de código quedó parcial: declara en datos_faltantes lo que no se calculó (ver avisos)');
    expect(errs(con(p, { datos_faltantes: [{ campo: 'sma200_semanal', critico: false }], confianza: 0.5 }), p)).toEqual([]);
    // con el cálculo completo no se exige
    expect(s.estado).toBe('completo');
  });
  it('precios: solo niveles calculados, por nivel_id y con el precio exacto (regla del módulo Técnico)', () => {
    const n = s.snapshot.niveles_calculados[0]!;
    expect(errs(con(s, { nivel_invalidacion: { precio: Number(n.precio), nivel_id: n.id } }), s)).toEqual([]);
    expect(errs(con(s, { nivel_invalidacion: { precio: Number(n.precio) + 0.01, nivel_id: n.id } }), s).some(e => e.includes('no coincide'))).toBe(true);
    expect(errs(con(s, { nivel_invalidacion: { precio: 10, nivel_id: 'n999' } }), s).some(e => e.includes('no existe en niveles_calculados'))).toBe(true);
    expect(errs(con(s, { zona_entrada: { min: 1, max: 2, nivel_ids: [] } }), s).some(e => e.includes('falta nivel_ids'))).toBe(true);
    expect(errs(con(s, { tendencia: { corto: 'arriba', medio: 'lateral', largo: 'lateral' } }), s).some(e => e.includes('tendencia.corto inválida'))).toBe(true);
    expect(errs(con(s, { tendencia: undefined }), s)).toContain('tendencia.corto inválida');
    expect(errs(con(s, { tendencia: 'x' }), s)).toContain('tendencia.largo inválida');
    expect(errs(con(s, { veredicto: 'COMPRAR' }), s).some(e => e.startsWith('veredicto fuera de vocabulario'))).toBe(true);
    expect(errs(con(s, { veredicto: 'COMPRAR', tendencia: undefined }), s).some(e => e.startsWith('veredicto fuera de vocabulario'))).toBe(true);
  });
  it('un soporte por encima del último cierre y una resistencia por debajo se rechazan', () => {
    const cierre = Number(s.snapshot.ultima_vela_diaria!.cierre);
    const arriba = s.snapshot.niveles_calculados.filter(n => Number(n.precio) > cierre)[0]!;
    const abajo = s.snapshot.niveles_calculados.filter(n => Number(n.precio) < cierre)[0]!;
    expect(arriba).toBeDefined(); expect(abajo).toBeDefined();
    expect(errs(con(s, { soporte_clave: { precio: Number(arriba.precio), nivel_id: arriba.id } }), s).some(e => e.startsWith('soporte_clave') && e.includes('por encima del último cierre'))).toBe(true);
    expect(errs(con(s, { resistencia_clave: { precio: Number(abajo.precio), nivel_id: abajo.id } }), s).some(e => e.startsWith('resistencia_clave') && e.includes('por debajo del último cierre'))).toBe(true);
    expect(errs(con(s, { soporte_clave: { precio: Number(abajo.precio), nivel_id: abajo.id }, resistencia_clave: { precio: Number(arriba.precio), nivel_id: arriba.id } }), s)).toEqual([]);
  });
  it('un soporte igual al cierre y una resistencia igual al cierre son válidos', () => {
    const cierre = Number(s.snapshot.ultima_vela_diaria!.cierre);
    const base = { ...s, snapshot: { ...s.snapshot, niveles_calculados: [{ id: 'n1', tipo: 'ema21_diaria', precio: s.snapshot.ultima_vela_diaria!.cierre, fecha_origen: null }] } } as SobreTecnicoValido;
    const x = con(base, { soporte_clave: { precio: cierre, nivel_id: 'n1' }, resistencia_clave: { precio: cierre, nivel_id: 'n1' } });
    expect(errs(x, base)).toEqual([]);
  });
  it('sin vela diaria no se compara el soporte con el cierre', () => {
    const n = s.snapshot.niveles_calculados[0]!;
    const base = { ...s, snapshot: { ...s.snapshot, ultima_vela_diaria: null } } as SobreTecnicoValido;
    expect(errs(con(base, { soporte_clave: { precio: Number(n.precio), nivel_id: n.id } }), base).some(e => e.includes('por encima del último cierre'))).toBe(false);
    const bajo = { ...base, snapshot: { ...base.snapshot, niveles_calculados: [{ id: 'n1', tipo: 'ema21_diaria', precio: '-1.0000', fecha_origen: null }] } } as SobreTecnicoValido;
    expect(errs(con(bajo, { resistencia_clave: { precio: -1, nivel_id: 'n1' } }), bajo).some(e => e.includes('por debajo del último cierre'))).toBe(false);
  });
  it('órdenes de compra o venta se rechazan', () => {
    expect(errs(con(s, { resumen: 'Te sugiero comprar ahora.' }), s).some(e => e.includes('instrucción de compra o venta'))).toBe(true);
    expect(errs(con(s, { negativos: ['Debes vender la posición.'] }), s).some(e => e.includes('instrucción de compra o venta'))).toBe(true);
  });
});

describe('v0.14: puerto del Analista Técnico', () => {
  const ahora = () => '2026-11-04T15:00:01Z';
  function armar(respuestas: unknown[], guardar?: (s: Obj) => Promise<{ ok: true; analisis_id: string } | { ok: false; error: string }>) {
    const peticiones: { mensajes: { role: string; content: string }[]; esquema_nombre: string }[] = [];
    const guardados: { salida: Obj; tra: Record<string, unknown> }[] = [];
    let i = 0;
    const llamar = async (p: never) => {
      peticiones.push(p);
      const j = respuestas[Math.min(i++, respuestas.length - 1)];
      return { ok: true as const, texto: JSON.stringify(j), json: j, modelo: 'm-t', tokens_in: 10, tokens_out: 5 };
    };
    const puerto = crearPuertoAnalista({
      llamar: llamar as never, modelo_analista: 'ma', modelo_director: 'md', ahora,
      guardar_analista: async (salida, tra) => { guardados.push({ salida, tra: tra as unknown as Record<string, unknown> }); return guardar ? guardar(salida) : { ok: true, analisis_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }; },
      guardar_director: async () => ({ ok: true, analisis_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }), proveedor: 'gemini',
    });
    return { puerto, peticiones, guardados };
  }
  const s = sobreValido();
  it('camino feliz: valida, guarda con la trazabilidad del Técnico y devuelve la salida', async () => {
    const t = armar([salidaBuena(s)]);
    const r = await t.puerto('tecnico', sobreCrudo());
    expect(r).toMatchObject({ estado: 'ok', veredicto: 'ESPERAR', proveedor: 'gemini', modelo: 'm-t', tokens_in: 10, tokens_out: 5, analisis_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    expect(t.peticiones).toHaveLength(1);
    expect(t.peticiones[0]!.esquema_nombre).toBe('salida_tecnico_v1');
    expect((t.peticiones[0] as unknown as Obj)['esquema']).toBe(ESQUEMA_TECNICO);
    expect((t.peticiones[0] as unknown as Obj)['modelo']).toBe('ma');
    expect(t.peticiones[0]!.mensajes[0]).toEqual({ role: 'system', content: PROMPT_TECNICO });
    expect(t.guardados[0]!.tra).toEqual({ proveedor: 'gemini', modelo: 'm-t', contrato: 'salida.v1', version_prompt: 'tecnico.p4', run_id: RUN, snapshot_id: SNAP, intentos: 1, generado_en: '2026-11-04T15:00:01Z' });
    expect(VERSION_PROMPT_TECNICO).toBe('tecnico.p4');
    expect(AGENTE_TECNICO).toBe('tecnico');
  });
  it('sin cálculo de código NO llama al modelo ni guarda', async () => {
    const t = armar([salidaBuena(s)]);
    const r = await t.puerto('tecnico', sobreCrudo(null));
    expect(r.estado).toBe('error');
    expect(r.error).toMatch(/^sobre del Técnico inválido: tecnico_codigo ausente/);
    expect(t.peticiones).toHaveLength(0);
    expect(t.guardados).toHaveLength(0);
  });
  it('una salida inválida se reintenta una vez con el error y luego se acepta', async () => {
    const t = armar([con(s, { run_id: 'otro' }), salidaBuena(s)]);
    const r = await t.puerto('tecnico', sobreCrudo());
    expect(r.estado).toBe('ok');
    expect(t.peticiones).toHaveLength(2);
    expect(t.peticiones[1]!.mensajes[t.peticiones[1]!.mensajes.length - 1]!.content).toContain('Tu respuesta fue rechazada por el validador: run_id no coincide con el del sobre');
    expect(t.guardados[0]!.tra['intentos']).toBe(2);
  });
  it('dos salidas inválidas: error, nada se guarda', async () => {
    const t = armar([con(s, { run_id: 'otro' })]);
    const r = await t.puerto('tecnico', sobreCrudo());
    expect(r.estado).toBe('error');
    expect(r.error).toContain('la salida no pasó la validación tras 2 intentos');
    expect(t.guardados).toHaveLength(0);
    expect(r).toMatchObject({ proveedor: 'gemini', modelo: 'ma' });
  });
  it('si no se puede guardar el análisis, error', async () => {
    const t = armar([salidaBuena(s)], async () => ({ ok: false, error: 'rls' }));
    expect(await t.puerto('tecnico', sobreCrudo())).toMatchObject({ estado: 'error', error: 'no se pudo guardar el análisis: rls', proveedor: 'gemini', modelo: 'm-t' });
    const t2 = armar([salidaBuena(s)], async () => { throw new Error('boom'); });
    expect(await t2.puerto('tecnico', sobreCrudo())).toMatchObject({ estado: 'error', error: 'no se pudo guardar el análisis: boom' });
  });
  it('el mensaje enviado al modelo es el de mensajeTecnicoParaModelo (datos públicos)', async () => {
    const t = armar([salidaBuena(s)]);
    await t.puerto('tecnico', sobreCrudo());
    expect(JSON.parse(t.peticiones[0]!.mensajes[1]!.content)).toEqual(JSON.parse(JSON.stringify(mensajeTecnicoParaModelo(s))));
  });
  it('el modelo que lanza una excepción no rompe el puerto', async () => {
    const puerto = crearPuertoAnalista({ llamar: (async () => { throw new Error('red'); }) as never, modelo_analista: 'ma', modelo_director: 'md', ahora, guardar_analista: async () => ({ ok: true, analisis_id: 'x' }), guardar_director: async () => ({ ok: true, analisis_id: 'x' }) });
    expect(await puerto('tecnico', sobreCrudo())).toMatchObject({ estado: 'error', error: 'red', proveedor: 'openai' });
  });
});

describe('v0.14: persistencia del análisis del Técnico', () => {
  it('fila: agente tecnico, veredicto y confianza de la salida, puntaje null, datos_fuente de la salida', () => {
    const s = sobreValido();
    const sal = salidaBuena(s);
    const f = filaAnalisisIa(sal, { proveedor: 'p', modelo: 'm', contrato: 'salida.v1', version_prompt: 'tecnico.p2', run_id: RUN, snapshot_id: SNAP, intentos: 1, generado_en: AHORA }, { expediente_id: RUN, ejecucion_id: null });
    expect(f).toMatchObject({ ok: true, fila: { agente: 'tecnico', veredicto: 'ESPERAR', puntaje: null, confianza: 0.7, supuestos: null, invalidadores: null } });
    if (f.ok) expect(f.fila['datos_fuente']).toEqual(sal['datos_fuente']);
  });
});

describe('v0.14: prompt del Técnico', () => {
  it('lleva las reglas que el validador hace cumplir', () => {
    for (const t of ['NO calculas nada', 'COPIA EXACTA', 'nivel_id', 'cumplida', 'sin_datos', 'NO es falsa', 'estado_calculo', 'parcial', `${TOPE_CONFIANZA_CON_FALTANTES}`, 'null: nunca inventes', 'no escribas «compra en»', 'cierre_ultima_vela_diaria', 'lateral en las tres']) {
      expect(PROMPT_TECNICO).toContain(t);
    }
  });
});

// ---------- guardado completo con el Técnico ----------
const entrada = (fy: number, ingresos: number) => ({
  fiscalYear: fy, fiscalPeriod: 0, endDate: `${fy}-12-31`, currency: 'USD', revenue: ingresos, costOfRevenue: null, grossProfit: ingresos * 0.8, opex: null, sgaExp: null, rndExp: null,
  opIncome: ingresos * 0.2, otherNetIncome: null, ebt: null, incomeTax: null, netIncome: ingresos * 0.1, dilutedAvgShares: 1000, dilutedEps: 0.1, interestNet: null,
});
function montar(opc: { chart?: Parameters<typeof redChart>[0]; modelo?: Parameters<typeof modeloFalso>[0]; bd?: Record<string, Fila[]> } = {}) {
  const b = nuevaBdGuardado(opc.bd ?? {}, {});
  const m = modeloFalso({ directorPropone: true, ...(opc.modelo ?? {}) });
  const chart = redChart(opc.chart);
  const llamadas: string[] = [];
  const fetchFn: FetchDatos = async (url, init) => {
    llamadas.push(url);
    if (url.includes('/api/chart-data')) return chart.fetchFn(url, init);
    const cuerpo = url.includes('/api/webull/') ? { success: true, symbol: 'GKOS', annual: [entrada(2023, 1200), entrada(2024, 1500)], ttm: null, forwardEps: null }
      : url.includes('freq=annual') ? { data: [{ year: 2025, quarter: 0, form: '10-K', endDate: '2025-12-31', filedDate: '2026-02-23', report: { bs: [{ concept: 'us-gaap_Assets', unit: 'u_usd', value: 893487000 }], cf: [] } }] }
      : url.includes('freq=quarterly') ? { data: [{ year: 2026, quarter: 3, form: '10-Q', endDate: '2026-09-30', filedDate: '2026-10-28', report: { bs: [], cf: [{ concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', unit: 'u_usd', value: 40867000 }] } }] }
      : { metric: { currentRatioAnnual: 4.69 } };
    return { ok: true, status: 200, json: async () => cuerpo };
  };
  let n = 0;
  const d = { llamar: m.llamar, modelo_analista: 'ma', modelo_director: 'md', ahora: () => AHORA, nuevoId: () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}` };
  const ejecutar = (body: unknown = { ticker: 'GKOS', guardar: true }) => ejecutarAnalisisGuardado(b.cliente, d, deps(fetchFn), body);
  return { b, m, chart, llamadas, ejecutar };
}
const insertsDe = (b: ReturnType<typeof nuevaBdGuardado>, tabla: string) => b.e.inserts.filter(i => i.tabla === tabla).map(i => i.fila);
const peticion = (m: ReturnType<typeof modeloFalso>, esquema: string): Record<string, unknown> => JSON.parse(m.peticiones.find(p => p.esquema_nombre === esquema)!.mensajes[1]!.content) as Record<string, unknown>;

describe('v0.14: guardado con el Técnico', () => {
  it('trae las velas, corre el Técnico, lo guarda y la corrida lleva referencias.tecnico', async () => {
    const t = montar();
    const r = await t.ejecutar();
    expect(r.http).toBe(200);
    expect(r.cuerpo).toMatchObject({ ok: true, analisis_completo: true, avisos_velas: [] });
    expect(r.cuerpo['tecnico']).toMatchObject({ estado: 'ok', veredicto: 'ESPERAR', confianza: 0.5, calculo_codigo: { estado: 'parcial', fecha_evaluacion: '2026-11-04', ultima_vela_diaria: '2026-11-03', ultima_vela_semanal: '2026-10-26' } });
    expect(t.llamadas.filter(u => u.includes('/api/chart-data'))).toHaveLength(2);
    const an = insertsDe(t.b, 'oficina_analisis').find(x => x['agente'] === 'tecnico')!;
    expect(an).toMatchObject({ veredicto: 'ESPERAR', puntaje: null, expediente_id: expect.any(String) });
    expect((an['salida'] as Obj)['trazabilidad']).toMatchObject({ version_prompt: 'tecnico.p4', contrato: 'salida.v1', run_id: r.cuerpo['run_id'] });
    expect(an).not.toHaveProperty('user_id');
    const cc = (r.cuerpo['tecnico'] as Obj)['calculo_codigo'] as Obj;
    expect((cc['motivos'] as string[]).some(m => m.startsWith('sma200_semanal'))).toBe(true);
    expect((an['salida'] as Obj)['snapshot_id']).toBe(((peticion(t.m, 'salida_fundamental_v1')['snapshot']) as Obj)['id']);
    expect(((an['salida'] as Obj)['trazabilidad'] as Obj)['snapshot_id']).toBe((peticion(t.m, 'salida_fundamental_v1')['snapshot'] as Obj)['id']);
    expect(t.llamadas.filter(u => u.includes('/api/chart-data')).every(u => u.includes('symbol=GKOS'))).toBe(true);
    const corrida = t.b.e.rpc[0]!.args['p_corrida'] as Fila;
    const ref = (corrida['referencias'] as Obj)['tecnico'] as Obj;
    expect(ref).toMatchObject({ estado: 'parcial', ultima_vela_diaria: '2026-11-03', ultima_vela_semanal: '2026-10-26' });
    expect(r.cuerpo['resultado_corrida']).toBe('corrida');
  });
  it('el Técnico recibe el cálculo de código y NADA del portafolio, la posición ni el token', async () => {
    const t = montar();
    await t.ejecutar();
    const msg = t.m.peticiones.find(p => p.esquema_nombre === 'salida_tecnico_v1')!.mensajes[1]!.content;
    expect(msg).not.toMatch(/posicion|portafolio|tipo_evaluacion|nueva_posicion|auditor|tesis|TOKEN-SECRETO|PMP/i);
    const p = peticion(t.m, 'salida_tecnico_v1');
    expect(p['agente']).toBe('tecnico');
    expect(((p['snapshot'] as Obj)['datos'] as Obj)['estado_calculo']).toBe('parcial');
  });
  it('con posición abierta la matriz del PMP no pide el Técnico de IA: no se llama y el análisis sigue completo', async () => {
    const t = montar({ bd: { oficina_v_posiciones: [{ trade_id: 't-1', portfolio_id: PF, ticker: 'GKOS', fecha_apertura: '2026-10-01' }], trade_executions: [{ id: 'e1', trade_id: 't-1', execution_type: 'buy', price: 10, quantity: 5, executed_at: '2026-10-10T10:00:00', total: 50 }], oficina_expedientes: [{ id: '00000000-0000-4000-8000-0000000000aa', ticker: 'GKOS', mercado: 'US', portfolio_id: PF, portafolio_codigo: 'PMP', rol_posicion: null, ficha: {}, tesis_vigente: null, tesis_version: 1 }] } });
    const r = await t.ejecutar();
    expect(r.cuerpo['tipo_evaluacion']).toBe('posicion_abierta');
    expect(r.cuerpo['tecnico']).toEqual({ estado: 'no_ejecutado', calculo_codigo: expect.any(Object) });
    expect(r.cuerpo['analisis_completo']).toBe(true);
    expect(t.m.peticiones.some(p => p.esquema_nombre === 'salida_tecnico_v1')).toBe(false);
    expect(insertsDe(t.b, 'oficina_analisis').some(x => x['agente'] === 'tecnico')).toBe(false);
  });
  it('el Director recibe la salida validada del Técnico junto con la del Fundamental', async () => {
    const t = montar();
    await t.ejecutar();
    const ctx = peticion(t.m, 'integracion_v1');
    expect(Object.keys(ctx['salidas_analistas'] as Obj).sort()).toEqual(['fundamental', 'tecnico']);
    expect(((ctx['salidas_analistas'] as Obj)['tecnico'] as Obj)['veredicto']).toBe('ESPERAR');
  });
  it('el Técnico se ejecuta después de traer los datos y antes de registrar la corrida', async () => {
    const t = montar();
    await t.ejecutar();
    const o = t.b.e.orden;
    expect(o.filter(x => x === 'insert:oficina_analisis')).toHaveLength(4);
    expect(o[o.length - 1]).toBe('rpc:oficina_registrar_corrida');
  });
  it('sin velas diarias (chart-data falla): no se aborta, el Técnico queda sin calcular y se declara', async () => {
    const t = montar({ chart: { statusDia: 502 } });
    const r = await t.ejecutar();
    expect(r.cuerpo['avisos_velas']).toEqual([expect.stringContaining('velas diarias (chart-data): HTTP 502')]);
    expect(r.cuerpo['analisis_completo']).toBe(false);
    expect(r.cuerpo['tecnico']).toMatchObject({ estado: 'error', calculo_codigo: { estado: 'no_calculado' } });
    expect(String((r.cuerpo['tecnico'] as Obj)['error'])).toContain('tecnico_codigo ausente');
    expect(t.m.peticiones.some(p => p.esquema_nombre === 'salida_tecnico_v1')).toBe(false);
    expect(insertsDe(t.b, 'oficina_analisis').some(x => x['agente'] === 'tecnico')).toBe(false);
    expect(r.cuerpo['resultado_corrida']).toBe('corrida');
    expect(r.http).toBe(200);
  });
  it('si falla solo la semanal el Técnico se calcula con las diarias y queda el aviso', async () => {
    const t = montar({ chart: { statusSem: 429 } });
    const r = await t.ejecutar();
    expect(r.cuerpo['avisos_velas']).toEqual([expect.stringContaining('velas semanales (chart-data): HTTP 429')]);
    expect(r.cuerpo['tecnico']).toMatchObject({ estado: 'ok' });
  });
  it('velas con precios incoherentes: el cálculo no se hace con ellas y se declara (no se corrige)', async () => {
    const malas = DIARIAS_PRUEBA(); malas[10] = { ...malas[10]!, high: malas[10]!.low - 1 };
    const t = montar({ chart: { dia: respuestaChart('GKOS', '1day', malas) } });
    const r = await t.ejecutar();
    expect(r.cuerpo['tecnico']).toMatchObject({ estado: 'error', calculo_codigo: { estado: 'pendiente' } });
    expect(t.m.peticiones.some(p => p.esquema_nombre === 'salida_tecnico_v1')).toBe(false);
  });
  it('la última vela diaria del día en curso se descarta y no entra al cierre del Técnico', async () => {
    const dia = velasDiarias('2026-11-04', 300);   // trae la vela de hoy (en formación a las 15:00 UTC)
    const t = montar({ chart: { dia: respuestaChart('GKOS', '1day', dia) } });
    const r = await t.ejecutar();
    expect(r.cuerpo['tecnico']).toMatchObject({ calculo_codigo: { ultima_vela_diaria: '2026-11-03', descartes: { diaria: { fecha: '2026-11-04', estado: 'en_formacion' } } } });
  });
  it('el modelo del Técnico no válido deja el Técnico en error y la corrida registrada incompleta', async () => {
    const t = montar({ modelo: { tecnicoMalo: true } });
    const r = await t.ejecutar();
    expect(r.cuerpo['tecnico']).toMatchObject({ estado: 'error' });
    expect(r.cuerpo['analisis_completo']).toBe(false);
    expect(r.http).toBe(200);
    expect(insertsDe(t.b, 'oficina_analisis').some(x => x['agente'] === 'tecnico')).toBe(false);
  });
  it('un precio inventado por el modelo se rechaza y no se guarda', async () => {
    const t = montar({ modelo: { tecnicoSalida: b => ({ ...b, soporte_clave: { precio: 1.23, nivel_id: 'n1' } }) } });
    const r = await t.ejecutar();
    expect(r.cuerpo['tecnico']).toMatchObject({ estado: 'error' });
    expect(String((r.cuerpo['tecnico'] as Obj)['error'])).toContain('soporte_clave');
  });
  it('no filtra tokens ni claves', async () => {
    const t = montar({ chart: { lanza: 'dia' } });
    const r = await t.ejecutar();
    const txt = JSON.stringify(r);
    expect(txt).not.toContain('TOKEN-SECRETO');
    expect(txt).not.toContain(CLAVE);
  });
});

// Pruebas de la v0.19: banderas cierre_sobre_<nivel>, regla «dentro de la zona» contra zona_entrada y prompt tecnico.p6.
import { describe, expect, it } from 'vitest';
import {
  PATRON_DENTRO_DE_ZONA, PATRON_NEGACION, PREFIJO_ITEM_SOBRE_NIVEL, PROMPT_TECNICO, VENTANA_NEGACION, VERIFICAR_DENTRO_DE_ZONA, VERSION_PROMPT_TECNICO,
  itemsDesdeSnapshotTecnico, validarSalidaTecnicoIa, validarSobreTecnico,
} from './index';
import type { SobreTecnicoValido } from './index';
import { afirmaDentroDeZona } from './validar-tecnico';
import { velasDiarias, velasSemanales } from './velas.test-util';
import { prepararTecnico } from '../orquestador/preparar-tecnico';
import type { Obj } from './utilidades';

const AHORA = '2026-11-04T15:00:00.000Z';
const RUN = '11111111-1111-4111-8111-111111111111';
const SNAP = '22222222-2222-4222-8222-222222222222';

function sobreValido(): SobreTecnicoValido {
  const tc = prepararTecnico({ ticker: 'GKOS', mercado: 'US', evaluado_en: AHORA, fuente: 'TwelveData', velas_diarias: velasDiarias('2026-11-03', 600), velas_semanales: velasSemanales('2026-11-02', 260) }) as unknown as Obj;
  const r = validarSobreTecnico({
    contrato: 'entrada.v1', run_id: RUN, agente: 'tecnico', ticker: 'GKOS', mercado: 'US', snapshot: { id: SNAP, generado_en: AHORA },
    tecnico_codigo: { estado: tc['estado'], snapshot: tc['snapshot'], detonantes: tc['detonantes'], descartes: tc['descartes'], motivos: tc['motivos'] },
  });
  if (!r.ok) throw new Error(r.errores.join('; '));
  return r.valor;
}

describe('v0.19: banderas del cierre frente a cada nivel', () => {
  const snap = (cierre: number | null, niveles: { id: string; precio: number | string }[]): never => ({
    fuente: 'F', fecha_evaluacion: '2026-11-05',
    ultima_vela_diaria: cierre === null ? null : { fecha: '2026-11-05', cierre: String(cierre) }, ultima_vela_semanal: null,
    indicadores: {}, cierre_sobre_ema200_diaria: null, cierre_sobre_sma200_semanal: null, senales: [],
    niveles_calculados: niveles.map(n => ({ id: n.id, tipo: 'pivote_maximo', precio: n.precio, fecha_origen: '2026-10-01' })),
  } as never);
  const v = (items: { id: string; valor: unknown }[], id: string): unknown => items.find(i => i.id === id)?.valor;
  it('constantes', () => {
    expect(PREFIJO_ITEM_SOBRE_NIVEL).toBe('cierre_sobre_');
    expect(VERIFICAR_DENTRO_DE_ZONA).toBe(true);
    expect(VENTANA_NEGACION).toBe(25);
  });
  it('caso real de GKOS: cierre 224.2 sobre n3 (201.89) y n2 (222.20) y debajo de n1 (255.185)', () => {
    const it = itemsDesdeSnapshotTecnico(snap(224.2, [{ id: 'n1', precio: 255.185 }, { id: 'n2', precio: 222.2002 }, { id: 'n3', precio: 201.8938 }]));
    expect(v(it, 'cierre_sobre_n1')).toBe('no');
    expect(v(it, 'cierre_sobre_n2')).toBe('si');
    expect(v(it, 'cierre_sobre_n3')).toBe('si');
  });
  it('estrictamente mayor, precio como texto y fecha de la vela diaria', () => {
    const it = itemsDesdeSnapshotTecnico(snap(100, [{ id: 'n1', precio: '100' }, { id: 'n2', precio: '99.99' }]));
    expect(v(it, 'cierre_sobre_n1')).toBe('no');
    expect(v(it, 'cierre_sobre_n2')).toBe('si');
    expect(it.find(i => i.id === 'cierre_sobre_n2')).toMatchObject({ campo: 'cierre_sobre_n2', unidad: null, fecha_dato: '2026-11-05', fuente: 'F; calculado por código' });
  });
  it('con vela semanal presente la fecha de la bandera del nivel sigue siendo la diaria', () => {
    const base = snap(10, [{ id: 'n1', precio: 5 }]) as unknown as Record<string, unknown>;
    const it = itemsDesdeSnapshotTecnico({ ...base, ultima_vela_semanal: { fecha: '2026-11-02', cierre: '9' } } as never);
    expect(it.find(i => i.id === 'cierre_sobre_n1')!.fecha_dato).toBe('2026-11-05');
  });
  it('sin cierre o con precio no numérico no hay bandera', () => {
    expect(itemsDesdeSnapshotTecnico(snap(null, [{ id: 'n1', precio: 10 }])).some(i => i.id === 'cierre_sobre_n1')).toBe(false);
    expect(itemsDesdeSnapshotTecnico(snap(10, [{ id: 'n1', precio: 'x' }])).some(i => i.id === 'cierre_sobre_n1')).toBe(false);
    expect(itemsDesdeSnapshotTecnico(snap(Number.NaN, [{ id: 'n1', precio: 10 }])).some(i => i.id === 'cierre_sobre_n1')).toBe(false);
  });
  it('el sobre real trae una bandera por nivel calculado', () => {
    const s = sobreValido();
    expect(s.snapshot.niveles_calculados.length).toBeGreaterThan(0);
    for (const n of s.snapshot.niveles_calculados) expect(s.items.some(i => i.id === `cierre_sobre_${n.id}`)).toBe(true);
  });
});

describe('v0.19: «dentro de la zona» contra zona_entrada', () => {
  const s0 = sobreValido();
  const niv = Array.from(new Map(s0.snapshot.niveles_calculados.map(n => [Number(n.precio), n])).values()).sort((a, b) => Number(a.precio) - Number(b.precio));
  const lo = niv[0]!; const hi = niv[niv.length - 1]!;
  const zmin = Number(lo.precio); const zmax = Number(hi.precio);
  const conCierre = (c: number): SobreTecnicoValido => ({ ...s0, snapshot: { ...s0.snapshot, ultima_vela_diaria: { ...s0.snapshot.ultima_vela_diaria!, cierre: String(c) } } }) as SobreTecnicoValido;
  const salida = (cambios: Obj = {}): Obj => ({
    contrato: 'salida.v1', agente: 'tecnico', run_id: RUN, snapshot_id: SNAP, ticker: 'GKOS', veredicto: 'ESPERAR', confianza: 0.7,
    resumen: 'Sin confirmación todavía.', tendencia: { corto: 'lateral', medio: 'lateral', largo: 'alcista' },
    hallazgos: [{ id: 'h1', tipo: 'neutral', texto: 'El precio cerró en la última sesión confirmada.', evidencia: ['cierre_ultima_vela_diaria'] }],
    negativos: ['No hay señal de entrada.'], datos_fuente: [s0.items.find(i => i.id === 'cierre_ultima_vela_diaria')!],
    zona_entrada: { min: zmin, max: zmax, nivel_ids: [lo.id, hi.id] }, soporte_clave: null, resistencia_clave: null, nivel_invalidacion: null, datos_faltantes: [], ...cambios,
  }) as Obj;
  const errs = (x: Obj, c: number): string[] => { const r = validarSalidaTecnicoIa(x, conCierre(c)); return r.ok ? [] : r.errores; };
  const delZona = (e: string[]): string[] => e.filter(m => m.includes('dentro de la zona'));
  it('hay al menos dos niveles distintos para la zona', () => { expect(zmax).toBeGreaterThan(zmin); });
  it('cierre por encima de la zona y el resumen dice «dentro»: rechazo con el lado', () => {
    const e = delZona(errs(salida({ resumen: 'El precio ya está dentro de la zona de entrada.' }), zmax + 1));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^resumen dice que el cierre está dentro de la zona de entrada/);
    expect(e[0]).toContain('por encima de la zona');
    expect(e[0]).toContain(`${String(zmin)} a ${String(zmax)}`);
    expect(e[0]).toContain('cierre_sobre_<nivel>');
  });
  it('cierre por debajo de la zona', () => {
    const e = delZona(errs(salida({ resumen: 'El precio ya está dentro de la zona.' }), zmin - 1));
    expect(e).toHaveLength(1);
    expect(e[0]).toContain('por debajo de la zona');
  });
  it('cierre dentro (incluidos los bordes): la frase es correcta', () => {
    for (const c of [(zmin + zmax) / 2, zmin, zmax]) expect(delZona(errs(salida({ resumen: 'El precio está dentro de la zona de entrada.' }), c))).toEqual([]);
  });
  it('una negación previa deja pasar la frase; sin negación se rechaza', () => {
    for (const t of ['El precio no está dentro de la zona.', 'El precio no se encuentra dentro de la zona de entrada.', 'Tampoco está dentro de la zona.', 'El cierre nunca estuvo dentro de la zona.']) {
      expect(delZona(errs(salida({ resumen: t }), zmax + 1))).toEqual([]);
    }
    expect(delZona(errs(salida({ resumen: 'El precio sí está dentro de la zona.' }), zmax + 1))).toHaveLength(1);
  });
  it('también se revisan los hallazgos y los negativos', () => {
    const h = [{ id: 'h1', tipo: 'neutral', texto: 'El cierre está dentro de la zona.', evidencia: ['cierre_ultima_vela_diaria'] }];
    expect(delZona(errs(salida({ hallazgos: h }), zmax + 1))[0]).toMatch(/^hallazgos\[0\] dice que el cierre está dentro de la zona/);
    expect(delZona(errs(salida({ negativos: ['Dentro de la zona sin confirmación.'] }), zmax + 1))[0]).toMatch(/^negativos\[0\] dice que/);
    expect(delZona(errs(salida({ hallazgos: h, negativos: ['Dentro de la zona.'] }), zmax + 1))).toHaveLength(2);
  });
  it('sin zona_entrada la frase no se contrasta', () => {
    expect(delZona(errs(salida({ zona_entrada: null, resumen: 'El precio está dentro de la zona.' }), zmax + 1))).toEqual([]);
  });
  it('un cierre no numérico o una zona no numérica no se contrastan', () => {
    const t = 'El precio está dentro de la zona.';
    expect(delZona(errs(salida({ resumen: t }), Number.NaN))).toEqual([]);
    expect(delZona(errs(salida({ resumen: t, zona_entrada: { min: 'x', max: zmax, nivel_ids: [lo.id, hi.id] } }), zmax + 1))).toEqual([]);
    expect(delZona(errs(salida({ resumen: t, zona_entrada: { min: zmin, max: 'x', nivel_ids: [lo.id, hi.id] } }), zmin - 1))).toEqual([]);
    expect(delZona(errs(salida({ resumen: t }), Number.POSITIVE_INFINITY))).toEqual([]);
    const sinVela = { ...s0, snapshot: { ...s0.snapshot, ultima_vela_diaria: null } } as unknown as SobreTecnicoValido;
    const r = validarSalidaTecnicoIa(salida({ resumen: t }), sinVela);
    expect(r.ok ? [] : delZona(r.errores)).toEqual([]);
  });
  it('afirmaDentroDeZona: variantes, mayúsculas, varias apariciones y límite de la ventana', () => {
    expect(afirmaDentroDeZona('está dentro de zona')).toBe(true);
    expect(afirmaDentroDeZona('ESTÁ DENTRO DE LA ZONA')).toBe(true);
    expect(afirmaDentroDeZona('dentro  de   la  zona')).toBe(true);
    expect(afirmaDentroDeZona('no está dentro de la zona; luego sí está dentro de la zona')).toBe(true);
    expect(afirmaDentroDeZona(`no ${'x'.repeat(VENTANA_NEGACION + 5)} dentro de la zona`)).toBe(true);
    expect(afirmaDentroDeZona('no ' + 'x'.repeat(VENTANA_NEGACION - 10) + ' dentro de la zona')).toBe(false);
    expect(afirmaDentroDeZona('fuera de la zona')).toBe(false);
    expect(afirmaDentroDeZona('')).toBe(false);
    expect(afirmaDentroDeZona('ninguno dentro de la zona')).toBe(true); // «ninguno» no es la palabra «no»
  });
  it('los patrones son los de las constantes', () => {
    expect(PATRON_DENTRO_DE_ZONA.flags).toContain('g');
    expect(PATRON_NEGACION.test('no')).toBe(true);
    expect(PATRON_NEGACION.test('ninguno')).toBe(false);
  });
});

describe('v0.19: prompt tecnico.p6', () => {
  it('versión', () => { expect(VERSION_PROMPT_TECNICO).toBe('tecnico.p6'); });
  it('la ubicación del cierre sale de las banderas, no de la comparación del modelo', () => {
    for (const t of ['no compares precios tú; usa los items `cierre_sobre_<id de nivel>`', 'DENTRO de la zona solo si', 'POR ENCIMA de la zona', 'POR DEBAJO', 'el código rechaza esa frase si no lo está']) expect(PROMPT_TECNICO).toContain(t);
    expect(PROMPT_TECNICO).not.toContain('Compara tú el último cierre');
  });
  it('sin «confirmación» inventada', () => {
    for (const t of ['Tampoco hables de «confirmación»', 'ese criterio no está definido']) expect(PROMPT_TECNICO).toContain(t);
  });
  it('conserva las reglas de p3, p4 y p5', () => {
    for (const t of ['NO perjudica', 'NUNCA es la condición que vuelve FAVORABLE', 'no puede ser mayor que 0.8', 'No compares tú precios entre sí', 'No digas que «faltan más señales»']) expect(PROMPT_TECNICO).toContain(t);
  });
});

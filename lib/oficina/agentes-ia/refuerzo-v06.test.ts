// Pruebas de la v0.6: unidades USD de Finnhub, campo del umbral validado contra los datos, prompts p3.
import { describe, expect, it } from 'vitest';
import {
  MAX_CAMPOS_EN_MENSAJE, PREFIJO_UNIDAD_USD_FINNHUB, PROMPT_DIRECTOR, PROMPT_FUNDAMENTAL, UNIDAD_USD_FINNHUB, esUnidadUsdFinnhub, itemsDesdeFinnhub,
  validarSalidaFundamental,
} from './index';
import type { SobreFundamental } from './index';
import { salidaBase, sobreBase } from './fixtures.test-util';

const GEN = '2026-10-30T18:00:00.000Z';
const HASH_2024 = 'unit_standard_usd_azjm55sbmuwnha0smj3j2q';
const HASH_2023 = 'unit_standard_usd_96yi-4ky9ew9hvzqscxzwq';

describe('v0.6: unidad USD de Finnhub', () => {
  it('acepta u_usd y unit_standard_usd_<código>; rechaza el resto', () => {
    expect(UNIDAD_USD_FINNHUB).toBe('u_usd');
    expect(PREFIJO_UNIDAD_USD_FINNHUB).toBe('unit_standard_usd_');
    expect(esUnidadUsdFinnhub('u_usd')).toBe(true);
    expect(esUnidadUsdFinnhub(HASH_2024)).toBe(true);
    expect(esUnidadUsdFinnhub(HASH_2023)).toBe(true);
    expect(esUnidadUsdFinnhub('unit_standard_usd_x')).toBe(true);
    for (const u of ['unit_standard_usd_', 'unit12', 'u_eur', 'U_USD', 'usd', 'x_unit_standard_usd_a', 'unit_standard_eur_a', '', undefined, null, 5, {}]) expect(esUnidadUsdFinnhub(u)).toBe(false);
  });
  const reporte = (year: number, unit: string, valor: number) => ({ year, quarter: 0, form: '10-K', endDate: `${year}-12-31`, filedDate: `${year + 1}-02-20`, report: { bs: [{ concept: 'us-gaap_CashAndCashEquivalentsAtCarryingValue', unit, value: valor }], cf: [] } });
  it('los reportes con unidad de código distinto por año generan items en USD', () => {
    const r = itemsDesdeFinnhub({ reportado: { data: [reporte(2025, 'u_usd', 90813000), reporte(2024, HASH_2024, 169626000), reporte(2023, HASH_2023, 93467000)] } }, { generado_en: GEN });
    if (!r.ok) throw new Error('debía ser ok');
    const ef = (id: string) => r.items.find(i => i.id === id);
    expect(ef('efectivo_fy2025')).toMatchObject({ valor: 90813000, unidad: 'USD' });
    expect(ef('efectivo_fy2024')).toMatchObject({ valor: 169626000, unidad: 'USD', fecha_dato: '2024-12-31' });
    expect(ef('efectivo_fy2023')).toMatchObject({ valor: 93467000, unidad: 'USD' });
    expect(r.avisos.filter(a => a.includes('unidad inesperada'))).toEqual([]);
  });
  it('una unidad desconocida (unit12) sigue descartándose con aviso, sin asumir USD', () => {
    const r = itemsDesdeFinnhub({ reportado: { data: [reporte(2018, 'unit12', 5), reporte(2025, 'u_usd', 1)] } }, { generado_en: GEN, anios: 2 });
    if (!r.ok) throw new Error('debía ser ok');
    expect(r.items.find(i => i.id === 'efectivo_fy2018')).toBeUndefined();
    expect(r.avisos).toContain('fy2018: us-gaap_CashAndCashEquivalentsAtCarryingValue con unidad inesperada, se omite');
  });
});

describe('v0.6: el campo del umbral debe existir en los datos', () => {
  const err = (campo: unknown, sobre: SobreFundamental = sobreBase()): string => {
    const s = JSON.parse(JSON.stringify(salidaBase())) as Record<string, unknown>;
    s['invalidadores'] = [{ condicion: 'x', medible: true, umbral: { campo, operador: '<', valor: 0.7 } }];
    const r = validarSalidaFundamental(s, sobre);
    return r.ok ? '' : r.errores.join(' | ');
  };
  it('acepta un campo numérico existente', () => {
    expect(err('margen_bruto')).toBe('');
    expect(err('ingresos_ttm')).toBe('');
  });
  it('rechaza un campo inexistente y lista los válidos, primero los que empiezan igual', () => {
    const e = err('margen');
    expect(e).toContain('invalidadores[0].umbral.campo margen no es un campo numérico de los datos');
    expect(e).toContain('campos válidos: margen_bruto, ingresos_ttm');
  });
  it('no acepta el id del item en lugar del campo ni un campo de texto', () => {
    expect(err('d2')).toContain('no es un campo numérico');
    expect(err('fragmento_riesgos')).toContain('no es un campo numérico');
    expect(err('fragmento_riesgos')).not.toContain('campos válidos: fragmento_riesgos');
  });
  it('una condición no medible con umbral null no se ve afectada', () => {
    const s = JSON.parse(JSON.stringify(salidaBase())) as Record<string, unknown>;
    s['invalidadores'] = [{ condicion: 'x', medible: false, umbral: null }];
    expect(validarSalidaFundamental(s, sobreBase()).ok).toBe(true);
  });
  it('un umbral presente con campo inexistente se rechaza aunque la condición no sea medible', () => {
    const s = JSON.parse(JSON.stringify(salidaBase())) as Record<string, unknown>;
    s['invalidadores'] = [{ condicion: 'x', medible: false, umbral: { campo: 'inventado', operador: '<', valor: 1 } }];
    const r = validarSalidaFundamental(s, sobreBase());
    expect(r.ok).toBe(false);
  });
  it('un umbral mal formado sigue dando el error de formato, no el de campo', () => {
    const e = err('');
    expect(e).toContain('umbral inválido (campo, operador, valor)');
    expect(e).not.toContain('campos válidos');
  });
  it('la lista de campos válidos se corta en el máximo', () => {
    const sobre = JSON.parse(JSON.stringify(sobreBase())) as SobreFundamental;
    for (let i = 0; i < MAX_CAMPOS_EN_MENSAJE + 10; i++) sobre.snapshot.datos.items.push({ id: `n${String(i)}`, campo: `campo_${String(i)}`, valor: i, unidad: null, fuente: 'f', fecha_dato: '2026-06-30' });
    const s = JSON.parse(JSON.stringify(salidaBase())) as Record<string, unknown>;
    s['datos_fuente'] = sobre.snapshot.datos.items.slice(0, 3);
    s['invalidadores'] = [{ condicion: 'x', medible: true, umbral: { campo: 'zzz', operador: '<', valor: 1 } }];
    const r = validarSalidaFundamental(s, sobre);
    const msg = (r.ok ? [''] : r.errores).find(m => m.includes('campos válidos'))!;
    expect(msg.split('campos válidos: ')[1]!.replace(/\)$/, '').split(', ')).toHaveLength(MAX_CAMPOS_EN_MENSAJE);
    expect(MAX_CAMPOS_EN_MENSAJE).toBe(30);
  });
});

describe('v0.6: prompts p3', () => {
  it('Fundamental: subpuntajes con evidencia y umbral con campo exacto', () => {
    expect(PROMPT_FUNDAMENTAL).toContain('Cada subpuntaje debe respaldarse con al menos un hallazgo');
    expect(PROMPT_FUNDAMENTAL).toContain('`flujo_caja_libre_*`');
    expect(PROMPT_FUNDAMENTAL).toContain('no puntúes una dimensión sin citarla');
    expect(PROMPT_FUNDAMENTAL).toContain('NINGÚN item de una dimensión, el veredicto es NO_EVALUABLE');
    expect(PROMPT_FUNDAMENTAL).toContain('EXACTAMENTE el `campo` de un item numérico');
    expect(PROMPT_FUNDAMENTAL).toContain('`medible` es false y `umbral` es null');
  });
  it('Director: sin_tesis cuando no hay tesis vigente', () => {
    expect(PROMPT_DIRECTOR).toContain('`sin_tesis` cuando no hay una tesis vigente en el contexto');
    expect(PROMPT_DIRECTOR).toContain('`sin_cambio` solo si existe una tesis vigente y nada la cambia');
  });
});

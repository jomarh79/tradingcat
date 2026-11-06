// Pruebas de la v0.18: banderas cierre_sobre_ema8 y cierre_sobre_ema21 calculadas por código, y prompt tecnico.p5 (no comparar precios sin bandera; no fijar cuántas señales bastan).
import { describe, expect, it } from 'vitest';
import { itemsDesdeSnapshotTecnico } from './datos-tecnico';
import { PROMPT_TECNICO } from './prompts';
import { ID_ITEM_SOBRE_EMA21, ID_ITEM_SOBRE_EMA8, VERSION_PROMPT_TECNICO } from './constantes';

function snap(cierre: number | null, ema8: number | null, ema21: number | null, semanal = false): never {
  return {
    fuente: 'F', fecha_evaluacion: '2026-11-05',
    ultima_vela_diaria: cierre === null ? null : { fecha: '2026-11-05', cierre: String(cierre) },
    ultima_vela_semanal: semanal ? { fecha: '2026-11-02', cierre: '150' } : null,
    indicadores: { ema8, ema21 },
    cierre_sobre_ema200_diaria: null, cierre_sobre_sma200_semanal: null,
    senales: [], niveles_calculados: [],
  } as never;
}
const valor = (items: { id: string; valor: unknown }[], id: string): unknown => items.find(i => i.id === id)?.valor;

describe('v0.18: banderas del cierre frente a EMA8 y EMA21', () => {
  it('ids', () => {
    expect(ID_ITEM_SOBRE_EMA8).toBe('cierre_sobre_ema8');
    expect(ID_ITEM_SOBRE_EMA21).toBe('cierre_sobre_ema21');
  });
  it('caso real de GKOS: cierre 219.98 está debajo de la EMA8 221.63 y sobre la EMA21 199.66', () => {
    const it = itemsDesdeSnapshotTecnico(snap(219.98, 221.62885904138813, 199.66317135453554));
    expect(valor(it, 'cierre_sobre_ema8')).toBe('no');
    expect(valor(it, 'cierre_sobre_ema21')).toBe('si');
  });
  it('estrictamente mayor: igual cuenta como no', () => {
    const it = itemsDesdeSnapshotTecnico(snap(100, 100, 99.99));
    expect(valor(it, 'cierre_sobre_ema8')).toBe('no');
    expect(valor(it, 'cierre_sobre_ema21')).toBe('si');
  });
  it('cada bandera usa su propia media', () => {
    const it = itemsDesdeSnapshotTecnico(snap(50, 40, 60));
    expect(valor(it, 'cierre_sobre_ema8')).toBe('si');
    expect(valor(it, 'cierre_sobre_ema21')).toBe('no');
  });
  it('sin cierre o sin media no hay bandera (no se rellena)', () => {
    const a = itemsDesdeSnapshotTecnico(snap(null, 10, 10));
    expect(a.some(i => i.id === 'cierre_sobre_ema8' || i.id === 'cierre_sobre_ema21')).toBe(false);
    const b = itemsDesdeSnapshotTecnico(snap(10, null, 5));
    expect(b.some(i => i.id === 'cierre_sobre_ema8')).toBe(false);
    expect(valor(b, 'cierre_sobre_ema21')).toBe('si');
    const c = itemsDesdeSnapshotTecnico(snap(10, 5, Number.NaN));
    expect(valor(c, 'cierre_sobre_ema8')).toBe('si');
    expect(c.some(i => i.id === 'cierre_sobre_ema21')).toBe(false);
  });
  it('un cierre no numérico no genera banderas', () => {
    const it = itemsDesdeSnapshotTecnico(snap(Number.NaN, 10, 10));
    expect(it.some(i => i.id === 'cierre_sobre_ema8' || i.id === 'cierre_sobre_ema21')).toBe(false);
  });
  it('con vela semanal presente la fecha de la bandera sigue siendo la diaria', () => {
    const it = itemsDesdeSnapshotTecnico(snap(10, 5, 5, true));
    expect(it.find(i => i.id === 'cierre_sobre_ema8')!.fecha_dato).toBe('2026-11-05');
    expect(it.find(i => i.id === 'cierre_sobre_ema21')!.fecha_dato).toBe('2026-11-05');
  });
  it('la bandera lleva la fecha de la vela diaria y la fuente de código', () => {
    const it = itemsDesdeSnapshotTecnico(snap(10, 5, 5));
    expect(it.find(i => i.id === 'cierre_sobre_ema8')).toMatchObject({ campo: 'cierre_sobre_ema8', unidad: null, fecha_dato: '2026-11-05', fuente: 'F; calculado por código' });
  });
});

describe('v0.18: prompt tecnico.p5', () => {
  it('versión', () => {
    expect(VERSION_PROMPT_TECNICO).toBe('tecnico.p5');
  });
  it('no comparar sin bandera', () => {
    for (const t of ['a menos que un item `cierre_sobre_*` lo diga', 'cierre_sobre_ema8, cierre_sobre_ema21, cierre_sobre_ema200_diaria, cierre_sobre_sma200_semanal', 'si su valor es `no`, el cierre NO está por encima', 'No compares tú precios entre sí']) expect(PROMPT_TECNICO).toContain(t);
  });
  it('no fijar cuántas señales bastan', () => {
    for (const t of ['No digas que «faltan más señales»', 'el criterio de entrada no está definido en los datos', 'sin concluir cuántas bastan']) expect(PROMPT_TECNICO).toContain(t);
  });
  it('conserva las reglas de p3 y p4', () => {
    for (const t of ['NO perjudica', 'ya está dentro de la zona', 'NUNCA es la condición que vuelve FAVORABLE', 'no puede ser mayor que 0.8']) expect(PROMPT_TECNICO).toContain(t);
  });
});

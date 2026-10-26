import { describe, expect, it } from 'vitest';
import { claveGrupoAlerta, procesarAlerta, MS_POR_HORA } from './index';
import type { AlertaEntrante, GrupoAlerta } from './index';

const H = 24;
const base: AlertaEntrante = {
  ticker: 'AAPL', tipo: 'precio_objetivo', condicion: 'precio <= soporte', severidad: 'media',
  estado_posicion: 'VIGILAR', accion_requerida: 'revisar', critica: false, ocurrida_en: '2026-10-22T14:00:00Z',
};
const a = (extra: Partial<AlertaEntrante> = {}): AlertaEntrante => ({ ...base, ...extra });
const sumaH = (iso: string, h: number) => new Date(Date.parse(iso) + h * MS_POR_HORA).toISOString().replace('.000Z', 'Z');
const primero = (extra: Partial<AlertaEntrante> = {}) => procesarAlerta([], a(extra), H);

describe('alertas: grupo nuevo y repetidas (O-08)', () => {
  it('la primera alerta abre un grupo, notifica y permite corrida', () => {
    const r = primero();
    expect(r).toMatchObject({ decision: 'grupo_nuevo', notificar: true, permite_corrida_nueva: true, cambios: [] });
    expect(r.grupo).toMatchObject({
      clave: 'AAPL|precio_objetivo|precio <= soporte', ticker: 'AAPL', ocurrencias: 1, severidad: 'media',
      inicio: '2026-10-22T14:00:00.000Z', fin_ventana: '2026-10-23T14:00:00.000Z',
    });
    expect(r.grupos).toHaveLength(1);
  });
  it('O-08: dos alertas iguales dentro de 24 h son un solo grupo y una sola notificación', () => {
    const r1 = primero();
    const r2 = procesarAlerta(r1.grupos, a({ ocurrida_en: '2026-10-22T20:00:00Z' }), H);
    expect(r2).toMatchObject({ decision: 'agregada_al_grupo', notificar: false, permite_corrida_nueva: false, cambios: [] });
    expect(r2.grupos).toHaveLength(1);
    expect(r2.grupo).toMatchObject({ ocurrencias: 2, ultima_ocurrencia: '2026-10-22T20:00:00.000Z', inicio: '2026-10-22T14:00:00.000Z' });
  });
  it('varias repetidas suman ocurrencias sin notificar ninguna', () => {
    let gs: GrupoAlerta[] = primero().grupos;
    for (let i = 1; i <= 3; i++) {
      const r = procesarAlerta(gs, a({ ocurrida_en: sumaH('2026-10-22T14:00:00Z', i) }), H);
      expect(r.notificar).toBe(false);
      gs = r.grupos;
    }
    expect(gs).toHaveLength(1);
    expect(gs[0]!.ocurrencias).toBe(4);
  });
  it('la clave distingue ticker, tipo y condición: cualquiera distinto es otro grupo', () => {
    const g = primero().grupos;
    for (const otra of [{ ticker: 'MSFT' }, { tipo: 'volumen' }, { condicion: 'precio >= resistencia' }]) {
      const r = procesarAlerta(g, a({ ...otra, ocurrida_en: '2026-10-22T15:00:00Z' }), H);
      expect(r.decision).toBe('grupo_nuevo');
      expect(r.notificar).toBe(true);
      expect(r.grupos).toHaveLength(2);
    }
  });
  it('P5: el ticker no distingue mayúsculas ni espacios; tipo y condición se recortan pero distinguen mayúsculas', () => {
    expect(claveGrupoAlerta({ ticker: ' aapl ', tipo: ' t ', condicion: ' c ' })).toBe('AAPL|t|c');
    const g = primero().grupos;
    expect(procesarAlerta(g, a({ ticker: ' aapl ', ocurrida_en: '2026-10-22T15:00:00Z' }), H).decision).toBe('agregada_al_grupo');
    expect(procesarAlerta(g, a({ tipo: 'PRECIO_OBJETIVO', ocurrida_en: '2026-10-22T15:00:00Z' }), H).decision).toBe('grupo_nuevo');
  });
});

describe('alertas: fin de la ventana (P1)', () => {
  it('justo antes de las 24 h sigue en el grupo; a las 24 h exactas inicia otro grupo', () => {
    const g = primero().grupos;
    const casi = procesarAlerta(g, a({ ocurrida_en: '2026-10-23T13:59:59Z' }), H);
    expect(casi.decision).toBe('agregada_al_grupo');
    const justo = procesarAlerta(g, a({ ocurrida_en: '2026-10-23T14:00:00Z' }), H);
    expect(justo).toMatchObject({ decision: 'grupo_nuevo', notificar: true, permite_corrida_nueva: true });
    expect(justo.grupos).toHaveLength(2);
    expect(justo.grupo!.ocurrencias).toBe(1);
  });
  it('la ventana no se desliza: una repetida a las 23 h no la extiende', () => {
    let gs = primero().grupos;
    gs = procesarAlerta(gs, a({ ocurrida_en: '2026-10-23T13:00:00Z' }), H).grupos;
    expect(gs[0]!.fin_ventana).toBe('2026-10-23T14:00:00.000Z');
    expect(procesarAlerta(gs, a({ ocurrida_en: '2026-10-23T15:00:00Z' }), H).decision).toBe('grupo_nuevo');
  });
  it('con grupos antiguos de la misma clave, manda el más reciente', () => {
    let gs = primero().grupos;
    gs = procesarAlerta(gs, a({ ocurrida_en: '2026-10-24T14:00:00Z' }), H).grupos;     // segundo grupo
    const r = procesarAlerta(gs, a({ ocurrida_en: '2026-10-24T18:00:00Z' }), H);
    expect(r.decision).toBe('agregada_al_grupo');
    expect(r.grupos).toHaveLength(2);
    expect(r.grupos[0]!.ocurrencias).toBe(1);
    expect(r.grupos[1]!.ocurrencias).toBe(2);
  });
  it('la ventana viene del parámetro: con 1 h, una repetida a los 30 min se agrega y a la hora exacta abre otro grupo', () => {
    const g = procesarAlerta([], a(), 1).grupos;
    expect(procesarAlerta(g, a({ ocurrida_en: '2026-10-22T14:30:00Z' }), 1).decision).toBe('agregada_al_grupo');
    expect(procesarAlerta(g, a({ ocurrida_en: '2026-10-22T15:00:00Z' }), 1).decision).toBe('grupo_nuevo');
    expect(procesarAlerta(g, a({ ocurrida_en: '2026-10-22T15:00:00Z' }), 1).grupo!.fin_ventana).toBe('2026-10-22T16:00:00.000Z');
  });
  it('zonas horarias: el instante con offset se normaliza a UTC', () => {
    const r = procesarAlerta([], a({ ocurrida_en: '2026-10-22T08:00:00-06:00' }), H);
    expect(r.grupo!.inicio).toBe('2026-10-22T14:00:00.000Z');
  });
});

describe('alertas: cambios que se notifican de inmediato (O-14, P2, P3)', () => {
  const g = () => primero().grupos;
  const rep = (extra: Partial<AlertaEntrante>) => procesarAlerta(g(), a({ ocurrida_en: '2026-10-22T15:00:00Z', ...extra }), H);
  it('O-14: mayor severidad dentro de la ventana: actualización inmediata', () => {
    const r = rep({ severidad: 'alta' });
    expect(r).toMatchObject({ decision: 'actualizacion_inmediata', notificar: true, cambios: ['severidad'] });
    expect(r.grupo).toMatchObject({ severidad: 'alta', ocurrencias: 2 });
    expect(r.grupos).toHaveLength(1);
  });
  it('P2: una severidad menor también es un cambio', () => {
    expect(rep({ severidad: 'baja' })).toMatchObject({ decision: 'actualizacion_inmediata', cambios: ['severidad'] });
  });
  it('cambia el estado de la posición: actualización inmediata', () => {
    expect(rep({ estado_posicion: 'ABIERTA' })).toMatchObject({ decision: 'actualizacion_inmediata', notificar: true, cambios: ['estado_posicion'] });
  });
  it('cambia la acción requerida: actualización inmediata', () => {
    expect(rep({ accion_requerida: 'vender' })).toMatchObject({ decision: 'actualizacion_inmediata', notificar: true, cambios: ['accion_requerida'] });
  });
  it('varios cambios a la vez se listan todos, en orden fijo', () => {
    expect(rep({ severidad: 'alta', estado_posicion: 'ABIERTA', accion_requerida: 'vender' }).cambios).toEqual(['severidad', 'estado_posicion', 'accion_requerida']);
  });
  it('tras la actualización, repetir lo mismo ya no notifica (el grupo guarda el último valor)', () => {
    const r1 = rep({ severidad: 'alta' });
    const r2 = procesarAlerta(r1.grupos, a({ severidad: 'alta', ocurrida_en: '2026-10-22T16:00:00Z' }), H);
    expect(r2).toMatchObject({ decision: 'agregada_al_grupo', notificar: false });
  });
  it('P3: un valor desconocido (null) no es un cambio y no borra el último valor conocido', () => {
    const r = rep({ estado_posicion: null, accion_requerida: null });
    expect(r).toMatchObject({ decision: 'agregada_al_grupo', notificar: false, cambios: [] });
    expect(r.grupo).toMatchObject({ estado_posicion: 'VIGILAR', accion_requerida: 'revisar' });
  });
  it('P3: si el grupo no conocía el estado y ahora se conoce, no es un cambio pero se guarda', () => {
    const inicial = procesarAlerta([], a({ estado_posicion: null }), H).grupos;
    const r = procesarAlerta(inicial, a({ estado_posicion: 'VIGILAR', ocurrida_en: '2026-10-22T15:00:00Z' }), H);
    expect(r).toMatchObject({ decision: 'agregada_al_grupo', notificar: false });
    expect(r.grupo!.estado_posicion).toBe('VIGILAR');
  });
});

describe('alertas críticas (O-15, P4)', () => {
  it('O-15: una crítica repetida dentro de la ventana se notifica sin demora y permite corrida', () => {
    const g = primero().grupos;
    const r = procesarAlerta(g, a({ critica: true, ocurrida_en: '2026-10-22T15:00:00Z' }), H);
    expect(r).toMatchObject({ decision: 'critica', notificar: true, permite_corrida_nueva: true });
    expect(r.grupo!.ocurrencias).toBe(2);
  });
  it('una crítica repetida idéntica vuelve a notificar cada vez (no se suprime ninguna)', () => {
    let gs = primero({ critica: true }).grupos;
    for (let i = 1; i <= 2; i++) {
      const r = procesarAlerta(gs, a({ critica: true, ocurrida_en: sumaH('2026-10-22T14:00:00Z', i) }), H);
      expect(r.notificar).toBe(true);
      expect(r.decision).toBe('critica');
      gs = r.grupos;
    }
  });
  it('la primera alerta crítica se identifica como crítica, no como grupo nuevo', () => {
    expect(primero({ critica: true })).toMatchObject({ decision: 'critica', notificar: true, permite_corrida_nueva: true });
  });
  it('una crítica con cambio de severidad informa también el cambio', () => {
    const g = primero().grupos;
    const r = procesarAlerta(g, a({ critica: true, severidad: 'alta', ocurrida_en: '2026-10-22T15:00:00Z' }), H);
    expect(r).toMatchObject({ decision: 'critica', cambios: ['severidad'] });
  });
});

describe('alertas: no bloquea corridas nuevas (O-26)', () => {
  const g = () => primero().grupos;
  it('O-26: repetida con datos vencidos permite una corrida nueva, aunque no notifique', () => {
    const r = procesarAlerta(g(), a({ datos_vencidos: true, ocurrida_en: '2026-10-22T15:00:00Z' }), H);
    expect(r).toMatchObject({ decision: 'agregada_al_grupo', notificar: false, permite_corrida_nueva: true });
  });
  it('O-26: repetida con cambio material permite una corrida nueva', () => {
    const r = procesarAlerta(g(), a({ cambio_material: true, ocurrida_en: '2026-10-22T15:00:00Z' }), H);
    expect(r).toMatchObject({ decision: 'agregada_al_grupo', permite_corrida_nueva: true });
  });
  it('repetida sin cambio material ni datos vencidos: no abre corrida duplicada', () => {
    expect(procesarAlerta(g(), a({ ocurrida_en: '2026-10-22T15:00:00Z' }), H).permite_corrida_nueva).toBe(false);
  });
  it('un cambio de severidad notifica pero por sí solo no abre corrida; con cambio material sí', () => {
    expect(procesarAlerta(g(), a({ severidad: 'alta', ocurrida_en: '2026-10-22T15:00:00Z' }), H).permite_corrida_nueva).toBe(false);
    expect(procesarAlerta(g(), a({ severidad: 'alta', cambio_material: true, ocurrida_en: '2026-10-22T15:00:00Z' }), H).permite_corrida_nueva).toBe(true);
  });
  it('los marcadores en false o ausentes no cuentan', () => {
    expect(procesarAlerta(g(), a({ cambio_material: false, datos_vencidos: false, ocurrida_en: '2026-10-22T15:00:00Z' }), H).permite_corrida_nueva).toBe(false);
  });
});

describe('alertas: ventana sin definir y entradas inválidas (P6, P7)', () => {
  it('P6: sin ventana (null) no se agrupa: cada alerta notifica y no se crean grupos', () => {
    const r1 = procesarAlerta([], a(), null);
    expect(r1).toMatchObject({ decision: 'sin_agrupar', notificar: true, permite_corrida_nueva: true, grupo: null, grupos: [] });
    expect(r1.motivos[0]).toContain('ventana_alertas');
    const r2 = procesarAlerta(r1.grupos, a({ ocurrida_en: '2026-10-22T15:00:00Z' }), null);
    expect(r2.notificar).toBe(true);
  });
  it('P6: ventana negativa o no finita tampoco agrupa', () => {
    for (const v of [-1, NaN, Infinity]) expect(procesarAlerta([], a(), v).decision).toBe('sin_agrupar');
  });
  it('ventana 0: nada queda agrupado, cada alerta abre su grupo', () => {
    const g = procesarAlerta([], a(), 0).grupos;
    expect(procesarAlerta(g, a(), 0).decision).toBe('grupo_nuevo');
  });
  it('entradas inválidas no notifican, no tocan los grupos y dicen por qué', () => {
    const g = primero().grupos;
    const malas: Partial<AlertaEntrante>[] = [
      { ticker: '' }, { tipo: '   ' }, { condicion: '' }, { severidad: 'critica' as never }, { ocurrida_en: 'ayer' }, { ocurrida_en: '2026-10-22T14:00:00' },
    ];
    for (const m of malas) {
      const r = procesarAlerta(g, a(m), H);
      expect(r).toMatchObject({ decision: 'invalida', notificar: false, permite_corrida_nueva: false, grupo: null });
      expect(r.grupos).toBe(g);
      expect(r.motivos[0]).toContain('entrada_invalida');
    }
  });
  it('P7: una ocurrencia anterior al inicio del grupo vigente se rechaza como desordenada', () => {
    const g = primero().grupos;
    const r = procesarAlerta(g, a({ ocurrida_en: '2026-10-22T13:00:00Z' }), H);
    expect(r).toMatchObject({ decision: 'invalida', notificar: false });
    expect(r.motivos[0]).toContain('ocurrencia_desordenada');
    expect(r.grupos).toBe(g);
  });
  it('no modifica los grupos recibidos (función pura)', () => {
    const g = primero().grupos;
    const copia = JSON.stringify(g);
    procesarAlerta(g, a({ severidad: 'alta', ocurrida_en: '2026-10-22T15:00:00Z' }), H);
    expect(JSON.stringify(g)).toBe(copia);
  });
});

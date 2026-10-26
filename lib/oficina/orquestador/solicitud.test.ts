import { describe, expect, it } from 'vitest';
import { normalizarCodigoPortafolio, validarSolicitud } from './index';

const sol = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  contrato: 'solicitud.v1', disparador: 'usuario', ticker: 'gkos', mercado: 'US', portafolio_codigo: 'PMP', tipo_evaluacion: 'nueva_posicion',
  origen: { watchlist_id: null, alerta_id: null }, solicitado_en: '2026-10-22T13:55:00Z', ...extra,
});

describe('validarSolicitud', () => {
  it('una solicitud válida se acepta y se normaliza (ticker en mayúsculas, ruta del Motor)', () => {
    const r = validarSolicitud(sol());
    expect(r.clase).toBe('aceptada');
    if (r.clase !== 'aceptada') return;
    expect(r.solicitud).toMatchObject({ ticker: 'GKOS', mercado: 'US', portafolio: 'PMP', tipo_evaluacion: 'nueva_posicion', ruta: 'analitica', disparador: 'usuario' });
    expect(r.solicitud.origen).toEqual({ watchlist_id: null, alerta_id: null });
  });
  it('la ruta sale del tipo: determinista para ETF, posición abierta para posicion_abierta', () => {
    const a = validarSolicitud(sol({ portafolio_codigo: 'ETF', tipo_evaluacion: 'aporte_periodico' }));
    const b = validarSolicitud(sol({ portafolio_codigo: 'PCP', tipo_evaluacion: 'posicion_abierta' }));
    expect(a.clase === 'aceptada' && a.solicitud.ruta).toBe('determinista');
    expect(b.clase === 'aceptada' && b.solicitud.ruta).toBe('posicion_abierta');
  });
  it('el origen (watchlist, alerta) se conserva y un origen ausente queda en null', () => {
    const a = validarSolicitud(sol({ disparador: 'watchlist', origen: { watchlist_id: 'w1', alerta_id: null } }));
    expect(a.clase === 'aceptada' && a.solicitud.origen).toEqual({ watchlist_id: 'w1', alerta_id: null });
    const b = validarSolicitud(sol({ origen: undefined }));
    expect(b.clase === 'aceptada' && b.solicitud.origen).toEqual({ watchlist_id: null, alerta_id: null });
  });
  it('los seis disparadores de la base son válidos y otro no', () => {
    for (const d of ['usuario', 'watchlist', 'alerta', 'programado', 'revision_posicion', 'backtesting_aprobado']) expect(validarSolicitud(sol({ disparador: d })).clase).toBe('aceptada');
    expect(validarSolicitud(sol({ disparador: 'manual' })).clase).toBe('invalida');
  });
  it('estructura mal formada: invalida, con todos los errores a la vez', () => {
    const r = validarSolicitud({ contrato: 'otra', disparador: 'x', ticker: ' ', mercado: 'MX', tipo_evaluacion: 'zzz', solicitado_en: 'ayer', portafolio_codigo: 5 });
    expect(r.clase).toBe('invalida');
    if (r.clase !== 'invalida') return;
    expect(r.errores).toHaveLength(7);
    for (const campo of ['contrato', 'disparador', 'ticker', 'mercado', 'tipo_evaluacion', 'solicitado_en', 'portafolio_codigo']) {
      expect(r.errores.some(x => x.startsWith(campo)), campo).toBe(true);
    }
  });
  it('no objetos: invalida', () => {
    for (const malo of [null, undefined, 5, 'x', []]) expect(validarSolicitud(malo).clase).toBe('invalida');
  });
  it('solicitado_en sin zona horaria es inválido', () => {
    expect(validarSolicitud(sol({ solicitado_en: '2026-10-22T13:55:00' })).clase).toBe('invalida');
  });
  it('Especulativo y Spin Off no abren corrida, con cualquier grafía', () => {
    for (const p of ['ESPECULATIVO', 'Especulativo', ' especulativo ', 'SPIN_OFF', 'Spin Off', 'spin-off']) {
      const r = validarSolicitud(sol({ portafolio_codigo: p }));
      expect(r.clase, p).toBe('sin_corrida');
      if (r.clase === 'sin_corrida') expect(r).toMatchObject({ motivo: 'portafolio_sin_reglas', ticker: 'GKOS', disparador: 'usuario', tipo_evaluacion: 'nueva_posicion' });
    }
  });
  it('sin portafolio, vacío o SIN_CLASIFICAR: pendiente_informacion con portafolio_no_declarado (GLB-04)', () => {
    for (const p of [null, undefined, '', '  ', 'SIN_CLASIFICAR', 'sin clasificar']) {
      const r = validarSolicitud(sol({ portafolio_codigo: p }));
      expect(r.clase, String(p)).toBe('pendiente_informacion');
      if (r.clase === 'pendiente_informacion') {
        expect(r.solicitud.portafolio).toBeNull();
        expect(r.motivos).toHaveLength(1);
        expect(r.motivos[0]!.codigo).toBe('portafolio_no_declarado');
      }
    }
  });
  it('el detalle distingue «no declarado», «SIN_CLASIFICAR» y «desconocido»', () => {
    const d = (p: unknown) => { const r = validarSolicitud(sol({ portafolio_codigo: p })); return r.clase === 'pendiente_informacion' ? r.motivos[0]!.detalle : ''; };
    expect(d(null)).toContain('no declara');
    expect(d('SIN_CLASIFICAR')).toContain('GLB-04');
    expect(d('XYZ')).toContain('desconocido: XYZ');
  });
  it('un portafolio con minúsculas o espacios se normaliza y se acepta', () => {
    const r = validarSolicitud(sol({ portafolio_codigo: ' pcp ', tipo_evaluacion: 'recompra' }));
    expect(r.clase === 'aceptada' && r.solicitud.portafolio).toBe('PCP');
  });
  it('un tipo sin fila en la tabla de agentes queda pendiente_informacion con datos_faltantes (no se inventa una fila)', () => {
    const r = validarSolicitud(sol({ portafolio_codigo: 'SEMILLA', tipo_evaluacion: 'revision_tesis' }));
    expect(r.clase).toBe('pendiente_informacion');
    if (r.clase === 'pendiente_informacion') {
      expect(r.solicitud.portafolio).toBe('SEMILLA');
      expect(r.motivos[0]).toMatchObject({ codigo: 'datos_faltantes' });
      expect(r.motivos[0]!.detalle).toContain('SEMILLA + revision_tesis');
    }
  });
  it('PLP nueva_posicion y SEMILLA recompra se aceptan: tienen regla estructural (23-oct), aunque no fila en la tabla de agentes', () => {
    expect(validarSolicitud(sol({ portafolio_codigo: 'PLP', tipo_evaluacion: 'nueva_posicion' })).clase).toBe('aceptada');
    expect(validarSolicitud(sol({ portafolio_codigo: 'SEMILLA', tipo_evaluacion: 'recompra' })).clase).toBe('aceptada');
  });
  it('normalizarCodigoPortafolio: mayúsculas, sin acentos y espacios/guiones como _', () => {
    expect(normalizarCodigoPortafolio(' Spin-Off ')).toBe('SPIN_OFF');
    expect(normalizarCodigoPortafolio('Especulativo')).toBe('ESPECULATIVO');
    expect(normalizarCodigoPortafolio('sin  clasificar')).toBe('SIN_CLASIFICAR');
    expect(normalizarCodigoPortafolio('Especulatívo')).toBe('ESPECULATIVO');
    expect(normalizarCodigoPortafolio('Spín Óff')).toBe('SPIN_OFF');
  });
});

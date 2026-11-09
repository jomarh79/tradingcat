// Pruebas de la v0.21: (1) regla de código: negativos del Técnico sin señales no cumplidas; (2) prompt tecnico.p7 (el resumen describe el estado, no fija qué cambiaría el veredicto).
import { describe, expect, it } from 'vitest';
import { PROMPT_TECNICO, VERIFICAR_NEGATIVO_SENAL_NO_CUMPLIDA, VERSION_PROMPT_TECNICO, validarSalidaTecnicoIa, validarSobreTecnico } from './index';
import type { SobreTecnicoValido } from './index';
import { velasDiarias, velasSemanales } from './velas.test-util';
import { prepararTecnico } from '../orquestador/preparar-tecnico';
import type { Obj } from './utilidades';

describe('v0.21: un negativo del Técnico no puede nombrar una señal que no se cumple', () => {
  const AHORA = '2026-11-04T15:00:00.000Z';
  const RUN = '11111111-1111-4111-8111-111111111111';
  const SNAP = '22222222-2222-4222-8222-222222222222';
  const tc = prepararTecnico({ ticker: 'GKOS', mercado: 'US', evaluado_en: AHORA, fuente: 'TwelveData', velas_diarias: velasDiarias('2026-11-03', 600), velas_semanales: velasSemanales('2026-11-02', 260) }) as unknown as Obj;
  const r0 = validarSobreTecnico({
    contrato: 'entrada.v1', run_id: RUN, agente: 'tecnico', ticker: 'GKOS', mercado: 'US', snapshot: { id: SNAP, generado_en: AHORA },
    tecnico_codigo: { estado: tc['estado'], snapshot: tc['snapshot'], detonantes: tc['detonantes'], descartes: tc['descartes'], motivos: tc['motivos'] },
  });
  if (!r0.ok) throw new Error(r0.errores.join('; '));
  const s0: SobreTecnicoValido = r0.valor;
  const con = (cumplidas: string[], ema200: boolean | null, noCumplidas: string[] = []): SobreTecnicoValido => ({
    ...s0, snapshot: { ...s0.snapshot, cierre_sobre_ema200_diaria: ema200, senales: [...cumplidas.map(id => ({ id, cumplida: true, detalle: 'x' })), ...noCumplidas.map(id => ({ id, cumplida: false, detalle: 'x' })), { id: 'NIVEL_PASADO', cumplida: null, detalle: 'sin datos' }] },
  }) as unknown as SobreTecnicoValido;
  const salida = (neg: unknown[], hall?: string): Obj => ({
    contrato: 'salida.v1', agente: 'tecnico', run_id: RUN, snapshot_id: SNAP, ticker: 'GKOS', veredicto: 'ESPERAR', confianza: 0.7, resumen: 'Estado técnico descrito.',
    tendencia: { corto: 'lateral', medio: 'lateral', largo: 'alcista' },
    hallazgos: [{ id: 'h1', tipo: 'neutral', texto: hall ?? 'El precio cerró en la última sesión confirmada.', evidencia: ['cierre_ultima_vela_diaria'] }],
    negativos: neg, datos_fuente: [s0.items.find(i => i.id === 'cierre_ultima_vela_diaria')!],
    zona_entrada: null, soporte_clave: null, resistencia_clave: null, nivel_invalidacion: null, datos_faltantes: [],
  }) as Obj;
  const errs = (neg: unknown[], s: SobreTecnicoValido, hall?: string): string[] => { const r = validarSalidaTecnicoIa(salida(neg, hall), s); return (r.ok ? [] : r.errores).filter(e => e.includes('nombra la señal')); };
  it('constante activa y versión del prompt', () => {
    expect(VERIFICAR_NEGATIVO_SENAL_NO_CUMPLIDA).toBe(true);
    expect(VERSION_PROMPT_TECNICO).toBe('tecnico.p7');
  });
  it('un negativo que nombra una señal no cumplida se rechaza con el índice y la señal', () => {
    const e = errs(['La señal RSI_SOBREVENTA no se cumple, manteniendo el estado en espera.'], con(['EMA8_SOBRE_EMA21'], null, ['RSI_SOBREVENTA']));
    expect(e).toHaveLength(1);
    expect(e[0]).toContain('negativos[0] nombra la señal RSI_SOBREVENTA, que no se cumple');
  });
  it('el índice corresponde al elemento y cada señal no cumplida nombrada da su error', () => {
    const e = errs(['Sin novedades adversas.', 'Faltan RSI_SOBREVENTA y MOGALEF_BANDA_INFERIOR.'], con([], null, ['RSI_SOBREVENTA', 'MOGALEF_BANDA_INFERIOR']));
    expect(e).toHaveLength(2);
    expect(e.every(x => x.startsWith('negativos[1]'))).toBe(true);
  });
  it('nombrar una señal cumplida, una sin datos o ninguna no se rechaza', () => {
    expect(errs(['RSI_SOBRECOMPRA está cumplida y es adversa para una entrada.'], con(['RSI_SOBRECOMPRA'], null, ['RSI_SOBREVENTA']))).toEqual([]);
    expect(errs(['NIVEL_PASADO no tiene datos.'], con([], null))).toEqual([]);
    expect(errs(['Se revisaron las señales y no hay nada adverso.'], con([], null, ['RSI_SOBREVENTA']))).toEqual([]);
  });
  it('un hallazgo neutral sí puede describir la señal no cumplida', () => {
    expect(errs(['Sin novedades adversas.'], con([], null, ['RSI_SOBREVENTA']), 'La señal RSI_SOBREVENTA no se cumple.')).toEqual([]);
  });
  it('un elemento que no es texto no rompe la regla', () => {
    expect(errs([5, 'Sin novedades adversas.'], con([], null, ['RSI_SOBREVENTA']))).toEqual([]);
  });
});

describe('v0.21: prompt tecnico.p7', () => {
  it('el resumen describe el estado y no fija qué cambiaría el veredicto', () => {
    for (const t of ['describe el estado actual', 'NO afirmes qué evento cambiaría el veredicto', 'NO va en `negativos`', 'rechaza un negativo que nombre por su id una señal no cumplida']) expect(PROMPT_TECNICO).toContain(t);
  });
  it('ya no pide nombrar el evento que cambiaría el veredicto', () => {
    expect(PROMPT_TECNICO).not.toContain('nombra el evento concreto');
    expect(PROMPT_TECNICO).not.toContain('qué señal concreta de `senales` hoy no se cumple');
  });
});

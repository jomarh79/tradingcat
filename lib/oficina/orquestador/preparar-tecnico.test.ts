import { describe, expect, it } from 'vitest';
import { SENALES_POR_USO } from '../tecnico';
import type { Candle } from '../tecnico';
import {
  CALENDARIO_NYSE_DATOS, USOS_DETONANTE, USOS_MOMENTO, USO_SENAL_SALIDA, crearCalendarioNYSE, prepararTecnico,
} from './index';
import { rachaPreviaDeReferencias } from './index';
import type { EntradaPrepararTecnico, Mercado, ResultadoPrepararTecnico } from './index';

// ---------- Generadores de velas en el formato de chart-data (time = hora del exchange leída como UTC) ----------
const t = (fecha: string): number => Date.parse(`${fecha}T00:00:00Z`) / 1000;
const mas = (fecha: string, dias: number): string => new Date((t(fecha) + dias * 86400) * 1000).toISOString().slice(0, 10);
const dow = (fecha: string): number => new Date(t(fecha) * 1000).getUTCDay();
type Precio = (i: number, n: number) => number;
const vela = (fecha: string, close: number): Candle => ({ time: t(fecha), open: close - 0.1, high: close + 0.2, low: close - 0.2, close, volume: 1000 });
const ondulado: Precio = i => 100 + 10 * Math.sin(i / 5) + i * 0.05;
const sube: Precio = i => 100 + i * 0.5;
const baja: Precio = i => 400 - i * 0.5;

/** `n` velas diarias en días entre semana, la última el `fin`. */
function diarias(fin: string, n: number, precio: Precio = ondulado): Candle[] {
  const fechas: string[] = [];
  for (let f = fin; fechas.length < n; f = mas(f, -1)) if (dow(f) !== 0 && dow(f) !== 6) fechas.unshift(f);
  return fechas.map((f, i) => vela(f, precio(i, n)));
}
/** `n` velas semanales fechadas en lunes, la última el lunes `finLunes`. */
function semanales(finLunes: string, n: number, precio: Precio = ondulado): Candle[] {
  return Array.from({ length: n }, (_, i) => vela(mas(finLunes, -7 * (n - 1 - i)), precio(i, n)));
}
const e = (evaluado_en: string, vd: Candle[], vs: Candle[], mercado: Mercado = 'US'): EntradaPrepararTecnico =>
  ({ ticker: 'TEST', mercado, evaluado_en, fuente: 'TwelveData', velas_diarias: vd, velas_semanales: vs });
const N_DIA = 300, N_SEM = 120;
const OK = ['completo', 'parcial'];
const soloAnios = (anios: number[]) => CALENDARIO_NYSE_DATOS.cobertura.filter(c => anios.includes(c.anio));

describe('la vela del día en curso se descarta por la regla de cierre, no por suposición', () => {
  it('jueves 22-oct a media sesión: la diaria de ayer está cerrada y se usa completa; la semanal en curso se descarta', () => {
    const r = prepararTecnico(e('2026-10-22T14:00:00Z', diarias('2026-10-21', N_DIA), semanales('2026-10-19', N_SEM)));
    expect(OK).toContain(r.estado);
    expect(r.fecha_evaluacion).toBe('2026-10-22');
    expect(r.cierre!.ultima_vela_diaria_cerrada).toBe(true);
    expect(r.cierre!.ultima_vela_semanal_cerrada).toBe(false);
    expect(r.snapshot!.ultima_vela_diaria!.fecha).toBe('2026-10-21');
    expect(r.snapshot!.velas_usadas.diarias).toBe(N_DIA);          // no se quitó ninguna diaria
    expect(r.snapshot!.ultima_vela_semanal!.fecha).toBe('2026-10-12');
    expect(r.snapshot!.velas_usadas.semanales).toBe(N_SEM - 1);   // se quitó solo la semana en curso
    expect(r.descartes.diaria).toBeNull();
    expect(r.descartes.semanal).toEqual({ fecha: '2026-10-19', estado: 'en_formacion', motivos: ['sesion_en_curso'] });
    expect(r.datos_faltantes).toEqual([]);
  });
  it('si chart-data trae la vela de hoy antes del cierre más el margen, se quita una sola vela (no dos)', () => {
    for (const [ev, codigo] of [['2026-10-22T18:00:00Z', 'sesion_en_curso'], ['2026-10-22T20:15:00Z', 'margen_de_cierre']] as const) {
      const r = prepararTecnico(e(ev, diarias('2026-10-22', N_DIA), semanales('2026-10-19', N_SEM)));
      expect(r.snapshot!.ultima_vela_diaria!.fecha).toBe('2026-10-21');
      expect(r.snapshot!.velas_usadas.diarias).toBe(N_DIA - 1);
      expect(r.descartes.diaria).toEqual({ fecha: '2026-10-22', estado: 'en_formacion', motivos: [codigo] });
    }
  });
  it('cumplido el margen (20:30 UTC) la vela de hoy se usa', () => {
    const r = prepararTecnico(e('2026-10-22T20:30:00Z', diarias('2026-10-22', N_DIA), semanales('2026-10-19', N_SEM)));
    expect(r.snapshot!.ultima_vela_diaria!.fecha).toBe('2026-10-22');
    expect(r.snapshot!.velas_usadas.diarias).toBe(N_DIA);
    expect(r.descartes.diaria).toBeNull();
  });
  it('la fecha de la evaluación es la de Ciudad de México: a las 22:30 del 21-oct allá (04:30 UTC del 22, ya 22 en Nueva York y en UTC) sigue siendo 21', () => {
    const r = prepararTecnico(e('2026-10-22T04:30:00Z', diarias('2026-10-21', N_DIA), semanales('2026-10-19', N_SEM)));
    expect(r.fecha_evaluacion).toBe('2026-10-21');
    expect(prepararTecnico(e('2026-10-22T03:00:00Z', diarias('2026-10-21', N_DIA), semanales('2026-10-19', N_SEM))).fecha_evaluacion).toBe('2026-10-21');
    expect(prepararTecnico(e('2026-10-22T06:00:00Z', diarias('2026-10-21', N_DIA), semanales('2026-10-19', N_SEM))).fecha_evaluacion).toBe('2026-10-22');
  });
  it('el margen se puede ajustar con la opción nombrada: con 0 minutos se usa en el cierre', () => {
    const r = prepararTecnico(e('2026-10-22T20:00:00Z', diarias('2026-10-22', N_DIA), semanales('2026-10-19', N_SEM)), undefined, { margen_cierre_minutos: 0 });
    expect(r.snapshot!.ultima_vela_diaria!.fecha).toBe('2026-10-22');
  });
});

describe('la semanal se cierra con el último día hábil de la semana más el margen', () => {
  it('semana normal: el viernes 16-oct a las 20:30 UTC (16:00 ET + 30 min)', () => {
    const d = diarias('2026-10-16', N_DIA), s = semanales('2026-10-12', N_SEM);
    const antes = prepararTecnico(e('2026-10-16T20:29:59Z', d, s));
    expect(antes.snapshot!.ultima_vela_semanal!.fecha).toBe('2026-10-05');
    expect(antes.descartes.semanal!.fecha).toBe('2026-10-12');
    const despues = prepararTecnico(e('2026-10-16T20:30:00Z', d, s));
    expect(despues.snapshot!.ultima_vela_semanal!.fecha).toBe('2026-10-12');
    expect(despues.descartes.semanal).toBeNull();
    expect(despues.snapshot!.velas_usadas.semanales).toBe(N_SEM);
  });
  it('semana con viernes festivo (Good Friday 3-abr-2026): cierra el jueves 2-abr', () => {
    const d = diarias('2026-04-02', N_DIA), s = semanales('2026-03-30', N_SEM);
    expect(prepararTecnico(e('2026-04-02T20:29:59Z', d, s)).descartes.semanal!.fecha).toBe('2026-03-30');
    expect(prepararTecnico(e('2026-04-02T20:30:00Z', d, s)).descartes.semanal).toBeNull();
  });
  it('una vela semanal fechada en fin de semana no se adivina: pendiente y se descarta, el análisis diario sigue', () => {
    const s = [...semanales('2026-10-12', N_SEM - 1), vela('2026-10-18', 100)];
    const r = prepararTecnico(e('2026-10-22T14:00:00Z', diarias('2026-10-21', N_DIA), s));
    expect(OK).toContain(r.estado);
    expect(r.cierre!.semanal.estado).toBe('pendiente');
    expect(r.cierre!.semanal.motivos[0]!.codigo).toBe('fecha_semanal_en_fin_de_semana');
    expect(r.descartes.semanal).toEqual({ fecha: '2026-10-18', estado: 'pendiente', motivos: ['fecha_semanal_en_fin_de_semana'] });
  });
});

describe('lo que no se puede validar no se calcula', () => {
  it('el calendario no cubre la fecha: NO_EVALUABLE, sin snapshot, sin detonantes y sin señal de salida inventada', () => {
    const r = prepararTecnico(e('2029-03-01T15:00:00Z', diarias('2029-02-28', N_DIA), semanales('2029-02-26', N_SEM)));
    expect(r.estado).toBe('NO_EVALUABLE');
    expect(r.cierre!.diaria.estado).toBe('no_evaluable');
    expect(r.snapshot).toBeNull();
    expect(r.detonantes).toBeNull();
    expect(r.momento).toBeNull();
    expect(r.senal_salida).toBeNull();
    expect(r.datos_faltantes).toHaveLength(1);
    expect(r.datos_faltantes[0]).toContain('calendario_no_cubre_fecha');
  });
  it('un calendario inyectado sin el año actual hace lo mismo', () => {
    const cal = crearCalendarioNYSE({ ...CALENDARIO_NYSE_DATOS, cobertura: soloAnios([2027, 2028]),
      feriados: CALENDARIO_NYSE_DATOS.feriados.filter(f => !f.startsWith('2026')), cierres_anticipados: CALENDARIO_NYSE_DATOS.cierres_anticipados.filter(f => !f.startsWith('2026')) });
    const r = prepararTecnico(e('2026-10-22T14:00:00Z', diarias('2026-10-21', N_DIA), semanales('2026-10-19', N_SEM)), cal);
    expect(r.estado).toBe('NO_EVALUABLE');
    expect(r.snapshot).toBeNull();
  });
  it('la BMV no tiene calendario: NO_EVALUABLE', () => {
    const r = prepararTecnico(e('2026-10-22T14:00:00Z', diarias('2026-10-21', N_DIA), semanales('2026-10-19', N_SEM), 'BMV'));
    expect(r.estado).toBe('NO_EVALUABLE');
    expect(r.cierre!.diaria.motivos[0]!.codigo).toBe('calendario_bmv_no_definido');
  });
  it('última vela diaria en sábado (dato incoherente): pendiente, no se calcula', () => {
    const d = [...diarias('2026-10-16', N_DIA - 1), vela('2026-10-17', 100)];
    const r = prepararTecnico(e('2026-10-19T15:00:00Z', d, semanales('2026-10-12', N_SEM)));
    expect(r.estado).toBe('pendiente');
    expect(r.snapshot).toBeNull();
    expect(r.datos_faltantes[0]).toContain('fecha_no_es_sesion');
  });
  it('sin velas diarias: pendiente (sin_vela)', () => {
    const r = prepararTecnico(e('2026-10-22T14:00:00Z', [], semanales('2026-10-19', N_SEM)));
    expect(r.estado).toBe('pendiente');
    expect(r.datos_faltantes[0]).toContain('sin_vela');
  });
  it('serie diaria fuera de orden o incoherente: pendiente, sin snapshot', () => {
    const d = diarias('2026-10-21', N_DIA);
    [d[10], d[11]] = [d[11]!, d[10]!];
    const r = prepararTecnico(e('2026-10-22T14:00:00Z', d, semanales('2026-10-19', N_SEM)));
    expect(r.estado).toBe('pendiente');
    expect(r.motivos[0]).toContain('velas_diarias_invalidas');
    expect(r.snapshot).toBeNull();
    const malas = diarias('2026-10-21', N_DIA);
    malas[5] = { ...malas[5]!, high: malas[5]!.low - 1 };
    expect(prepararTecnico(e('2026-10-22T14:00:00Z', malas, semanales('2026-10-19', N_SEM))).estado).toBe('pendiente');
  });
  it('instante de evaluación sin zona o imposible: pendiente', () => {
    for (const malo of ['2026-10-22T14:00:00', 'hoy', '']) {
      const r = prepararTecnico(e(malo, diarias('2026-10-21', N_DIA), semanales('2026-10-19', N_SEM)));
      expect(r.estado).toBe('pendiente');
      expect(r.fecha_evaluacion).toBeNull();
      expect(r.snapshot).toBeNull();
    }
  });
  it('serie semanal inválida o vacía: se calcula sin semanales y queda declarado', () => {
    const s = semanales('2026-10-19', N_SEM);
    [s[3], s[4]] = [s[4]!, s[3]!];
    const r = prepararTecnico(e('2026-10-22T14:00:00Z', diarias('2026-10-21', N_DIA), s));
    expect(OK).toContain(r.estado);
    expect(r.motivos.join('|')).toContain('velas_semanales_invalidas');
    expect(r.snapshot!.velas_usadas.semanales).toBe(0);
    expect(r.cierre!.semanal.motivos[0]!.codigo).toBe('sin_vela');       // una serie inválida no se usa ni para decidir el cierre
    expect(r.descartes.semanal).toBeNull();
    const v = prepararTecnico(e('2026-10-22T14:00:00Z', diarias('2026-10-21', N_DIA), []));
    expect(OK).toContain(v.estado);
    expect(v.cierre!.semanal.estado).toBe('pendiente');
    expect(v.descartes.semanal).toBeNull();
    expect(v.snapshot!.velas_usadas.semanales).toBe(0);
  });
  it('historial diario insuficiente: el Técnico lo declara NO_EVALUABLE y no hay detonantes', () => {
    const r = prepararTecnico(e('2026-10-22T14:00:00Z', diarias('2026-10-21', 10), semanales('2026-10-19', N_SEM)));
    expect(r.estado).toBe('NO_EVALUABLE');
    expect(r.snapshot!.estado).toBe('NO_EVALUABLE');
    expect(r.detonantes).toBeNull();
    expect(r.senal_salida).toBeNull();
    expect(r.datos_faltantes).toHaveLength(1);
  });
});

describe('cableado hacia el Motor', () => {
  const corre = (p: Precio) => prepararTecnico(e('2026-10-22T14:00:00Z', diarias('2026-10-21', N_DIA, p), semanales('2026-10-19', N_SEM, p)));
  const senal = (r: ResultadoPrepararTecnico, id: string) => r.snapshot!.senales.find(s => s.id === id)!.cumplida;
  it('una racha alcista da RSI de sobrecompra: senal_salida = true, igual al detonante salida_pcp', () => {
    const r = corre(sube);
    expect(senal(r, 'RSI_SOBRECOMPRA')).toBe(true);
    expect(r.senal_salida).toBe(true);
    expect(r.detonantes!.salida_pcp.detonante_confirmado).toBe(true);
    expect(r.detonantes!.salida_pcp.senales_cumplidas).toContain('RSI_SOBRECOMPRA');
  });
  it('una racha bajista da sobreventa: apertura, recompra y DCA del PLP con detonante; senal_salida = false', () => {
    const r = corre(baja);
    expect(senal(r, 'RSI_SOBREVENTA')).toBe(true);
    expect(r.momento).toEqual({ apertura_pcp: { detonante_confirmado: true }, recompra_pcp: { detonante_confirmado: true }, dca_plp: { detonante_confirmado: true } });
    expect(r.senal_salida).toBe(false);
  });
  it('momento.detonante_confirmado de cada uso es el del Técnico; la salida del PCP no va en momento', () => {
    for (const p of [sube, baja, ondulado]) {
      const r = corre(p);
      for (const uso of USOS_MOMENTO) expect(r.momento![uso].detonante_confirmado).toBe(r.detonantes![uso].detonante_confirmado);
      expect(Object.keys(r.momento!).sort()).toEqual([...USOS_MOMENTO].sort());
      expect(r.senal_salida).toBe(r.detonantes![USO_SENAL_SALIDA].detonante_confirmado);
    }
  });
  it('los usos del detonante son exactamente los del Técnico, y el DCA del PLP usa SOPORTE_PASADO (no NIVEL_PASADO)', () => {
    expect([...USOS_DETONANTE].sort()).toEqual(Object.keys(SENALES_POR_USO).sort());
    expect(SENALES_POR_USO.dca_plp).toContain('SOPORTE_PASADO');
    expect(SENALES_POR_USO.dca_plp).not.toContain('NIVEL_PASADO');
    expect(USO_SENAL_SALIDA).toBe('salida_pcp');
  });
});

describe('frescura del precio (parámetro frescura.precio)', () => {
  const corre = (ultimaDiaria: string, ev: string, limite?: number | null) =>
    prepararTecnico(e(ev, diarias(ultimaDiaria, N_DIA), semanales('2026-10-12', N_SEM)), undefined, limite === undefined ? {} : { frescura_precio_dias_habiles: limite });
  it('sin el parámetro (sin definir) no se evalúa la frescura y no se declara nada vencido', () => {
    const r = corre('2026-10-21', '2026-10-22T14:00:00Z');
    expect(r.frescura!.evaluada).toBe(false);
    expect(r.datos_vencidos).toEqual([]);
  });
  it('con límite 1: la última vela de ayer está vigente; la de hace tres días hábiles se declara en datos_vencidos', () => {
    const vigente = corre('2026-10-21', '2026-10-22T14:00:00Z', 1);
    expect(vigente.frescura).toMatchObject({ evaluada: true, vencida: false, dias_habiles_de_antiguedad: 1, ultima_vela: '2026-10-21', fecha_evaluacion: '2026-10-22' });
    expect(vigente.datos_vencidos).toEqual([]);
    const vencida = corre('2026-10-19', '2026-10-22T14:00:00Z', 1);
    expect(vencida.frescura).toMatchObject({ vencida: true, dias_habiles_de_antiguedad: 3 });
    expect(vencida.datos_vencidos).toHaveLength(1);
    expect(vencida.datos_vencidos[0]).toContain('precio_diario');
  });
  it('un precio vencido se declara pero no cambia el estado ni la señal de salida: decide el Motor con datos_vencidos', () => {
    const v = corre('2026-10-19', '2026-10-22T14:00:00Z', 1), ok = corre('2026-10-19', '2026-10-22T14:00:00Z');
    expect(v.estado).toBe(ok.estado);
    expect(v.senal_salida).toBe(ok.senal_salida);
  });
  it('la frescura usa la última vela realmente usada: si la de hoy se descarta (en formación), cuenta la de ayer', () => {
    const r = prepararTecnico(e('2026-10-22T18:00:00Z', diarias('2026-10-22', N_DIA), semanales('2026-10-19', N_SEM)), undefined, { frescura_precio_dias_habiles: 1 });
    expect(r.frescura).toMatchObject({ ultima_vela: '2026-10-21', dias_habiles_de_antiguedad: 1, vencida: false });
  });
  it('si no se calculó el Técnico no hay frescura ni datos vencidos', () => {
    const r = prepararTecnico(e('2029-03-01T15:00:00Z', diarias('2029-02-28', N_DIA), []), undefined, { frescura_precio_dias_habiles: 1 });
    expect(r.estado).toBe('NO_EVALUABLE');
    expect(r.frescura).toBeNull();
    expect(r.datos_vencidos).toEqual([]);
  });
});

describe('registro de la racha de MOGALEF_BANDA_SUPERIOR y referencias de la corrida', () => {
  const salto: Precio = i => (i < 299 ? 100 + Math.sin(i / 3) : 140);            // última vela rompe la banda: primera ruptura
  const salto2: Precio = i => (i < 298 ? 100 + Math.sin(i / 3) : i === 298 ? 130 : 160);   // segunda ruptura consecutiva
  const corre = (p: Precio, opc = {}) => prepararTecnico(e('2026-10-22T14:00:00Z', diarias('2026-10-21', N_DIA, p), semanales('2026-10-19', N_SEM, p)), undefined, opc);
  it('primera ruptura sin registro previo: nueva activación; la señal de salida del Técnico sigue siendo la del snapshot', () => {
    const r = corre(salto);
    expect(r.racha_mogalef_superior).toMatchObject({ estado: 'nueva_activacion', registro: { fecha_inicio: '2026-10-21', dias: 1, activacion_registrada: true } });
    expect(r.snapshot!.senales.find(s => s.id === 'MOGALEF_BANDA_SUPERIOR')!.cumplida).toBe(true);
    expect(r.senal_salida).toBe(true);
  });
  it('la misma activación ya registrada: ya_registrada, y la señal de salida no cambia (solo se evita duplicar el registro)', () => {
    const previa = { fecha_inicio: '2026-10-21', dias: 1, activacion_registrada: true };
    const r = corre(salto, { racha_previa: previa });
    expect(r.racha_mogalef_superior!.estado).toBe('ya_registrada');
    expect(r.senal_salida).toBe(true);
  });
  it('segunda ruptura: racha en curso; sin registro de la activación se declara; con registro se conserva', () => {
    const sin = corre(salto2);
    expect(sin.racha_mogalef_superior).toMatchObject({ estado: 'racha_en_curso', registro: { fecha_inicio: '2026-10-20', dias: 2, activacion_registrada: false } });
    const con = corre(salto2, { racha_previa: { fecha_inicio: '2026-10-20', dias: 1, activacion_registrada: true } });
    expect(con.racha_mogalef_superior!.registro).toEqual({ fecha_inicio: '2026-10-20', dias: 2, activacion_registrada: true });
  });
  it('sin ruptura: sin_racha y no queda racha en las referencias', () => {
    const r = corre(ondulado);
    expect(r.racha_mogalef_superior).toMatchObject({ estado: 'sin_racha', registro: null });
    expect(r.referencias.tecnico.racha_mogalef_superior).toBeNull();
  });
  it('las referencias guardan lo necesario y se leen en la corrida siguiente con rachaPreviaDeReferencias (ida y vuelta por JSON)', () => {
    const r = corre(salto, { margen_cierre_minutos: 45 });
    const t2 = r.referencias.tecnico;
    expect(t2).toMatchObject({
      estado: r.estado, fecha_evaluacion: '2026-10-22', margen_cierre_minutos: 45, ultima_vela_diaria: '2026-10-21', ultima_vela_semanal: '2026-10-12',
      racha_mogalef_superior: { fecha_inicio: '2026-10-21', dias: 1, activacion_registrada: true },
    });
    expect(t2.cierre!.diaria).toEqual({ estado: 'confirmada', motivos: [] });
    expect(t2.cierre!.semanal).toEqual({ estado: 'en_formacion', motivos: ['sesion_en_curso'] });
    expect(t2.descartes.semanal!.fecha).toBe('2026-10-19');
    const guardado = JSON.parse(JSON.stringify(r.referencias));
    expect(rachaPreviaDeReferencias(guardado)).toEqual({ fecha_inicio: '2026-10-21', dias: 1, activacion_registrada: true });
  });
  it('el margen por omisión queda registrado (30) y, sin snapshot, las referencias conservan el estado del cierre y no inventan velas', () => {
    expect(corre(ondulado).referencias.tecnico.margen_cierre_minutos).toBe(30);
    const r = prepararTecnico(e('2029-03-01T15:00:00Z', diarias('2029-02-28', N_DIA), []));
    expect(r.referencias.tecnico).toMatchObject({ estado: 'NO_EVALUABLE', ultima_vela_diaria: null, ultima_vela_semanal: null, racha_mogalef_superior: null, frescura: null });
    expect(r.referencias.tecnico.cierre!.diaria.estado).toBe('no_evaluable');
  });
});

describe('integridad', () => {
  it('es determinista, no modifica las velas de entrada y se serializa sin perder nada', () => {
    const en = e('2026-10-22T18:00:00Z', diarias('2026-10-22', N_DIA), semanales('2026-10-19', N_SEM));
    const copia = JSON.parse(JSON.stringify(en));
    const a = prepararTecnico(en), b = prepararTecnico(en);
    expect(a).toEqual(b);
    expect(en).toEqual(copia);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
  it('el estado completo o parcial nunca trae datos faltantes; los demás siempre traen uno', () => {
    const casos = [
      e('2026-10-22T14:00:00Z', diarias('2026-10-21', N_DIA), semanales('2026-10-19', N_SEM)),
      e('2029-03-01T15:00:00Z', diarias('2029-02-28', N_DIA), semanales('2029-02-26', N_SEM)),
      e('2026-10-22T14:00:00Z', [], []),
      e('2026-10-22T14:00:00Z', diarias('2026-10-21', 10), []),
    ];
    for (const c of casos) {
      const r = prepararTecnico(c);
      if (OK.includes(r.estado)) expect(r.datos_faltantes).toEqual([]);
      else expect(r.datos_faltantes).toHaveLength(1);
    }
  });
});

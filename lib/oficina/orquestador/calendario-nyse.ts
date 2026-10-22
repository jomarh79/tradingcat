// Datos del calendario del NYSE para la Oficina. NO se escriben fechas de memoria: cada año sale de la página oficial
// «Holidays & Trading Hours» del NYSE y su fuente y fecha de consulta quedan registradas en `cobertura`, año por año.
// Mantenimiento: una vez al año, agregar el año nuevo desde esa página (festivos y cierres anticipados) y sumarlo a `cobertura`
// con su propia fecha de consulta. Fuera de los años de `cobertura` el calendario no responde (ver calendario.ts): nunca se
// supone que un día sea hábil o esté cerrado, y el cierre de velas de ese año queda NO_EVALUABLE.

export interface CoberturaAnio {
  anio: number;
  fuente: string;
  url: string;
  /** Fecha (YYYY-MM-DD) en que se copiaron los datos de ESE año desde la fuente. */
  consultado_el: string;
}

export interface DatosCalendarioNYSE {
  /** Años completos cubiertos, cada uno con su fuente y fecha de consulta. Un año solo se agrega con todos sus festivos y cierres anticipados. */
  cobertura: CoberturaAnio[];
  /** Días en que el NYSE no abre (YYYY-MM-DD, entre semana). Incluye los festivos «observados» que cita la fuente. */
  feriados: string[];
  /** Días con cierre anticipado (YYYY-MM-DD). */
  cierres_anticipados: string[];
  /** Hora de cierre de la sesión regular y de la anticipada, hora de Nueva York (HH:MM). */
  hora_cierre_regular: string;
  hora_cierre_anticipado: string;
}

const FUENTE_NYSE = 'NYSE, Holidays & Trading Hours';
const URL_NYSE = 'https://www.nyse.com/trade/hours-calendars';

export const CALENDARIO_NYSE_DATOS: DatosCalendarioNYSE = {
  cobertura: [
    { anio: 2026, fuente: FUENTE_NYSE, url: URL_NYSE, consultado_el: '2026-10-21' },
    { anio: 2027, fuente: FUENTE_NYSE, url: URL_NYSE, consultado_el: '2026-10-21' },
    { anio: 2028, fuente: FUENTE_NYSE, url: URL_NYSE, consultado_el: '2026-10-21' },
  ],
  feriados: [
    // 2026
    '2026-01-01', // New Year's Day
    '2026-01-19', // Martin Luther King, Jr. Day
    '2026-02-16', // Washington's Birthday
    '2026-04-03', // Good Friday
    '2026-05-25', // Memorial Day
    '2026-06-19', // Juneteenth
    '2026-07-03', // Independence Day (observed)
    '2026-09-07', // Labor Day
    '2026-11-26', // Thanksgiving Day
    '2026-12-25', // Christmas Day
    // 2027
    '2027-01-01', // New Year's Day
    '2027-01-18', // Martin Luther King, Jr. Day
    '2027-02-15', // Washington's Birthday
    '2027-03-26', // Good Friday
    '2027-05-31', // Memorial Day
    '2027-06-18', // Juneteenth (observed)
    '2027-07-05', // Independence Day (observed)
    '2027-09-06', // Labor Day
    '2027-11-25', // Thanksgiving Day
    '2027-12-24', // Christmas Day (observed)
    // 2028 (no hay festivo de Año Nuevo: el 1-ene-2028 cae en sábado y el NYSE no lo observa)
    '2028-01-17', // Martin Luther King, Jr. Day
    '2028-02-21', // Washington's Birthday
    '2028-04-14', // Good Friday
    '2028-05-29', // Memorial Day
    '2028-06-19', // Juneteenth
    '2028-07-04', // Independence Day
    '2028-09-04', // Labor Day
    '2028-11-23', // Thanksgiving Day
    '2028-12-25', // Christmas Day
  ],
  cierres_anticipados: [
    '2026-11-27', '2026-12-24',
    '2027-11-26',
    '2028-07-03', '2028-11-24',
  ],
  hora_cierre_regular: '16:00',
  hora_cierre_anticipado: '13:00',
};

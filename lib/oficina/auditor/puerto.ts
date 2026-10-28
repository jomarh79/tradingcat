// Adaptador al puerto `auditor(sobre)` del Orquestador. El Auditor es código: un fallo no se reintenta, queda en error.
import type { RespuestaAuditor } from '../orquestador/corrida';
import { auditar } from './auditor';
import { validarSalida } from './validador';
import type { EntradaAuditor, SalidaAuditor } from './tipos';

export type RespuestaAuditorConSalida = RespuestaAuditor & { salida?: SalidaAuditor };
const ESTADOS_QUE_REVISAN = ['cumple', 'incumple', 'no_evaluable', 'delegada', 'anterior_a_regla'];

/** `validar` se inyecta solo para probar que una salida rechazada por el validador no llega al Orquestador. */
export async function puertoAuditor(sobre: unknown, validar: typeof validarSalida = validarSalida): Promise<RespuestaAuditorConSalida> {
  try {
    const entrada = sobre as EntradaAuditor;
    const salida = auditar(entrada);
    const problemas = validar(entrada, salida);
    if (problemas.length > 0) return { estado: 'error', error: `Salida del Auditor rechazada: ${problemas.join('; ')}` };
    return {
      estado: 'ok', veredicto: salida.veredicto, salida,
      reglas_revisadas: salida.resultados_reglas.filter((r) => ESTADOS_QUE_REVISAN.includes(r.resultado)).map((r) => r.codigo),
    };
  } catch (err) {
    return { estado: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

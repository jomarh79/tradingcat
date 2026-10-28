// Catálogo real de las 50 reglas vigentes (consulta del 26-oct-2026) usado como fixture de pruebas. No es dato de producción.
import type { ReglaEntrada } from './tipos';

export const CATALOGO_FIXTURE: ReglaEntrada[] = [
 {
  "codigo": "ETF-01",
  "version_id": "v-ETF-01-3",
  "caracter": "referencial",
  "vigente_desde": "2026-10-26",
  "definicion": {
   "tipo": "aporte_periodico",
   "num_etfs": "todos_los_sectoriales_vigentes_esa_semana",
   "frecuencia": "semanal",
   "aporte_reducido": true,
   "filtro_de_precio": false,
   "motivo_reduccion": "falta_de_efectivo",
   "monto_por_etf_usd": 2,
   "monto_reducido_usd": 1,
   "aporte_parcial_entre_etfs": false,
   "si_no_alcanza_el_efectivo": "reducir_a_monto_reducido_en_todos_los_etfs",
   "si_no_alcanza_el_reducido": "no_comprar_ninguno"
  },
  "clase": "referencial",
  "aplica_a": {
   "portafolios": [
    "ETF"
   ],
   "tipos_evaluacion": [
    "aporte_periodico"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "ETF-02",
  "version_id": "v-ETF-02-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "universo",
   "sectoriales": {
    "tickers": [
     "XLB",
     "XLC",
     "XLE",
     "XLF",
     "XLI",
     "XLK",
     "XLP",
     "XLRE",
     "XLU",
     "XLV",
     "XLY"
    ],
    "num_etfs": 11,
    "frecuencia": "semanal",
    "filtro_de_precio": "ninguno"
   },
   "fondeados_por_flujos": {
    "monto": "segun_flujos_del_mes",
    "fuente": [
     "PCP-08",
     "PMP-06",
     "PLP-05"
    ],
    "tickers": [
     "QQQ",
     "GBTC",
     "IVV PESOS"
    ],
    "frecuencia": "mensual"
   },
   "excluidos_de_redistribucion": [
    "IVV PESOS",
    "GBTC",
    "QQQ"
   ]
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "ETF"
   ],
   "tipos_evaluacion": [
    "nueva_posicion",
    "aporte_periodico"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "ETF-03",
  "version_id": "v-ETF-03-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "revision_anual",
   "logica": {
    "supera": {
     "accion": "ninguna",
     "reinicia_conteo": true
    },
    "primera_falla": {
     "redistribuir": "otros_etf_sectoriales",
     "vender_pct_de_la_posicion": 50
    },
    "falla_consecutiva": {
     "vender": "resto"
    }
   },
   "ejemplo": "falla, supera, falla = vende 50%, nada, vende 50%",
   "ventana": "12_meses_terminados_el_31_de_diciembre",
   "aplica_a": "etfs_sectoriales",
   "benchmark": "SPY",
   "rendimiento": "total_ponderado_por_tiempo",
   "si_historial_menor_a_12_meses": "no_evaluar"
  },
  "clase": "calendario_tarea",
  "aplica_a": {
   "portafolios": [
    "ETF"
   ],
   "tipos_evaluacion": [
    "revision_anual_etf"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "ETF-04",
  "version_id": "v-ETF-04-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "base": "capital_y_ganancias",
   "tipo": "retiro_periodico",
   "genera": "tarea_pendiente",
   "alcance": "solo_etfs_sectoriales_del_portafolio_ETF",
   "destino": {
    "partes": "iguales",
    "reparto": "entre_los_etfs_sectoriales"
   },
   "cada_anios": 5,
   "retirar_pct": 50,
   "fecha_inicio": "2026-09-30",
   "primer_retiro": "2031-09-30",
   "coincidencia_con_revision_anual": "registrar_por_separado_calcular_sobre_remanente"
  },
  "clase": "calendario_tarea",
  "aplica_a": {
   "portafolios": [
    "ETF"
   ],
   "tipos_evaluacion": [
    "retiro_quinquenal"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "ETF-05",
  "version_id": "v-ETF-05-1",
  "caracter": "referencial",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "reporte",
   "reportar": [
    "aperturas",
    "recompras",
    "ventas",
    "cambios_de_reglas",
    "revisiones_anuales",
    "retiros_quinquenales"
   ]
  },
  "clase": "referencial",
  "aplica_a": {
   "portafolios": [
    "ETF"
   ],
   "tipos_evaluacion": [
    "todos"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "GLB-01",
  "version_id": "v-GLB-01-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "vigencia",
   "aplica_a": "operaciones_nuevas",
   "posicion_previa": "anterior_a_regla",
   "bloqueo_retroactivo": false,
   "pregunta_informativa": "cumpliria_hoy"
  },
  "clase": "transversal",
  "aplica_a": {
   "portafolios": [
    "todos"
   ],
   "tipos_evaluacion": [
    "todos"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "GLB-02",
  "version_id": "v-GLB-02-1",
  "caracter": "referencial",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "registro",
   "campo": "razon_o_rol_de_la_posicion",
   "obligatorio": false,
   "roles_sugeridos": {
    "PMP": [
     "flujo",
     "crecimiento",
     "mixto"
    ]
   }
  },
  "clase": "referencial",
  "aplica_a": {
   "portafolios": [
    "todos"
   ],
   "tipos_evaluacion": [
    "todos"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "GLB-03",
  "version_id": "v-GLB-03-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "checklist",
   "regla": "noticia_no_fundamenta_decision",
   "noticia_solo_origen_de_idea": true
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "todos"
   ],
   "tipos_evaluacion": [
    "nueva_posicion",
    "recompra"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "GLB-04",
  "version_id": "v-GLB-04-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "checklist",
   "regla": "portafolio_destino_obligatorio",
   "no_trasladar_reglas": true
  },
  "clase": "transversal",
  "aplica_a": {
   "portafolios": [
    "todos"
   ],
   "tipos_evaluacion": [
    "todos"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "GLB-05",
  "version_id": "v-GLB-05-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "contable",
   "separar": [
    "realizada",
    "no_realizada"
   ],
   "traspaso_es_ganancia": false
  },
  "clase": "transversal",
  "aplica_a": {
   "portafolios": [
    "todos"
   ],
   "tipos_evaluacion": [
    "todos"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "GLB-06",
  "version_id": "v-GLB-06-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "checklist",
   "regla": "alerta_no_es_orden"
  },
  "clase": "declarativa",
  "aplica_a": {
   "portafolios": [
    "todos"
   ],
   "tipos_evaluacion": [
    "todos"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "GLB-07",
  "version_id": "v-GLB-07-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "integridad",
   "fuente": "oficina_snapshots_semanales",
   "historial_inmutable": true
  },
  "clase": "declarativa",
  "aplica_a": {
   "portafolios": [
    "todos"
   ],
   "tipos_evaluacion": [
    "todos"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PCP-01",
  "version_id": "v-PCP-01-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "filtro",
   "umbral": 5,
   "metrica": "historial_grafico_anios",
   "operador": ">=",
   "si_datos_insuficientes": "no_verificable"
  },
  "clase": "filtro_elegibilidad",
  "aplica_a": {
   "portafolios": [
    "PCP"
   ],
   "tipos_evaluacion": [
    "nueva_posicion"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PCP-02",
  "version_id": "v-PCP-02-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "montos_escalonados",
   "compras": [
    {
     "n": 1,
     "monto_usd": 25
    },
    {
     "n": 2,
     "monto_usd": 25
    },
    {
     "n": 3,
     "monto_usd": 50
    }
   ]
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PCP"
   ],
   "tipos_evaluacion": [
    "nueva_posicion",
    "recompra"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PCP-03",
  "version_id": "v-PCP-03-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "limite",
   "max_compras": 3,
   "max_invertido_usd": 100
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PCP"
   ],
   "tipos_evaluacion": [
    "nueva_posicion",
    "recompra"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PCP-04",
  "version_id": "v-PCP-04-2",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "deteccion_tecnica",
   "accion": "recompra",
   "temporalidad": "diaria",
   "cualquiera_de": [
    {
     "id": "sobreventa",
     "indicadores": [
      {
       "nombre": "RSI",
       "criterio": "<=30",
       "evaluacion": "objetiva"
      },
      {
       "nombre": "MACD",
       "criterio": "visual: gira saliendo o entrando de sobreventa",
       "evaluacion": "discrecional_del_usuario"
      },
      {
       "nombre": "Koncorde",
       "criterio": "cualquiera de sus lineas por debajo de cero",
       "evaluacion": "objetiva"
      }
     ]
    },
    {
     "id": "banda_mogalef_inferior",
     "criterio": "el precio toca o cae por debajo de la banda inferior",
     "indicador": "mogalefBandsSeries",
     "evaluacion": "objetiva",
     "parametros": [
      10,
      30,
      1.5
     ]
    },
    {
     "id": "soporte_resistencia_pasado",
     "niveles": [
      "pivotes",
      "max_min_52_semanas",
      "max_min_5_anios",
      "max_min_10_anios"
     ],
     "evaluacion": "objetiva",
     "tolerancia_pct": 1.5
    }
   ],
   "cuantos_deben_coincidir": 1,
   "discrecional_del_usuario": "el sistema muestra los valores y no bloquea; la confirmacion visual la haces tu al autorizar",
   "requiere_revision_de_la_operacion": true
  },
  "clase": "delegada",
  "aplica_a": {
   "portafolios": [
    "PCP"
   ],
   "tipos_evaluacion": [
    "recompra"
   ]
  },
  "componente_delegado": "tecnico"
 },
 {
  "codigo": "PCP-05",
  "version_id": "v-PCP-05-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "salida",
   "por_numero_de_compras": {
    "1": [
     100
    ],
    "2": [
     50,
     50
    ],
    "3": [
     50,
     50
    ]
   }
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PCP"
   ],
   "tipos_evaluacion": [
    "posicion_abierta"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PCP-06",
  "version_id": "v-PCP-06-2",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "plan_de_salida",
   "por_compras": {
    "1": [
     {
      "pct": 100,
      "cuando": "senal_de_salida"
     }
    ],
    "2": [
     {
      "pct": 50,
      "cuando": "precio_supera_costo_promedio"
     },
     {
      "pct": 50,
      "cuando": "senal_de_salida"
     }
    ],
    "3": {
     "igual_que": "2",
     "tercera_compra": {
      "nivel_bloquea": false,
      "requiere_senal": "PCP-04",
      "nivel_de_referencia": "punto_medio_entre_costo_promedio_y_precio_de_salida_planeado"
     }
    }
   },
   "temporalidad": "diaria",
   "costo_promedio": "ponderado_de_todas_las_compras_realizadas",
   "senales_de_salida": {
    "cualquiera_de": [
     {
      "id": "sobrecompra",
      "indicadores": [
       {
        "nombre": "RSI",
        "criterio": ">=70",
        "evaluacion": "objetiva"
       },
       {
        "nombre": "MACD",
        "criterio": "visual: gira saliendo o entrando de sobrecompra",
        "evaluacion": "discrecional_del_usuario"
       },
       {
        "nombre": "Koncorde",
        "criterio": "visual",
        "evaluacion": "discrecional_del_usuario"
       }
      ]
     },
     {
      "id": "banda_mogalef_superior",
      "criterio": "el precio toca o supera la banda superior",
      "indicador": "mogalefBandsSeries",
      "evaluacion": "objetiva",
      "parametros": [
       10,
       30,
       1.5
      ]
     },
     {
      "id": "soporte_resistencia_pasado",
      "evaluacion": "objetiva",
      "tolerancia_pct": 1.5
     },
     {
      "id": "figura_tecnica",
      "figuras": [
       "canal",
       "hombro_cabeza_hombro",
       "triangulo"
      ],
      "evaluacion": "juicio_del_analista_tecnico_con_evidencia_confirmado_por_el_usuario"
     }
    ],
    "cuantos_deben_coincidir": 1
   },
   "discrecional_del_usuario": "el sistema muestra los valores y no bloquea; la confirmacion visual la haces tu al autorizar"
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PCP"
   ],
   "tipos_evaluacion": [
    "posicion_abierta"
   ]
  },
  "componente_delegado": "tecnico"
 },
 {
  "codigo": "PCP-07",
  "version_id": "v-PCP-07-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "plan_al_abrir",
   "planes": {
    "escalonado": {
     "requiere": "PCP-04",
     "si_toca_stop": "zona_de_posible_recompra",
     "max_recompras": 2
    },
    "una_compra": {
     "si_toca_stop": "salida"
    }
   },
   "plan_declarado_al_abrir": true
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PCP"
   ],
   "tipos_evaluacion": [
    "nueva_posicion",
    "recompra",
    "posicion_abierta"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PCP-08",
  "version_id": "v-PCP-08-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "base": "ganancias_menos_perdidas_realizadas_netas_de_comisiones",
   "tipo": "reparto_mensual",
   "genera": "tarea_pendiente",
   "periodo": "mensual",
   "tercios": [
    "PCP",
    "QQQ",
    "GBTC"
   ],
   "si_neto_negativo": "absorbe_PCP_sin_reparto"
  },
  "clase": "calendario_tarea",
  "aplica_a": {
   "portafolios": [
    "PCP"
   ],
   "tipos_evaluacion": [
    "aporte_periodico"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PCP-10",
  "version_id": "v-PCP-10-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "deteccion_tecnica",
   "accion": "apertura",
   "temporalidad": "diaria",
   "cualquiera_de": [
    {
     "id": "sobreventa",
     "indicadores": [
      {
       "nombre": "RSI",
       "criterio": "<=30",
       "evaluacion": "objetiva"
      },
      {
       "nombre": "MACD",
       "criterio": "visual: gira saliendo de sobreventa",
       "evaluacion": "discrecional_del_usuario"
      },
      {
       "nombre": "Koncorde",
       "criterio": "cualquiera de sus lineas por debajo de cero",
       "evaluacion": "objetiva"
      }
     ]
    },
    {
     "id": "piso_de_figura_chartista",
     "figuras": [
      "canal",
      "hombro_cabeza_hombro",
      "triangulo"
     ],
     "evaluacion": "juicio_del_analista_tecnico_con_evidencia_confirmado_por_el_usuario"
    },
    {
     "id": "cruce_de_medias",
     "criterio": "EMA(8) > EMA(21)",
     "evaluacion": "objetiva"
    },
    {
     "id": "banda_mogalef_inferior",
     "criterio": "el precio toca o cae por debajo de la banda inferior",
     "indicador": "mogalefBandsSeries",
     "evaluacion": "objetiva",
     "parametros": [
      10,
      30,
      1.5
     ]
    }
   ],
   "cuantos_deben_coincidir": 1,
   "discrecional_del_usuario": "el sistema muestra los valores y no bloquea; la confirmacion visual la haces tu al autorizar"
  },
  "clase": "delegada",
  "aplica_a": {
   "portafolios": [
    "PCP"
   ],
   "tipos_evaluacion": [
    "nueva_posicion"
   ]
  },
  "componente_delegado": "tecnico"
 },
 {
  "codigo": "PLP-01",
  "version_id": "v-PLP-01-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "checklist",
   "revisar": [
    "calidad_negocio",
    "fundamentales",
    "dividendos",
    "valuacion",
    "riesgo",
    "diversificacion"
   ],
   "no_solo_rendimiento_dividendo": true
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PLP"
   ],
   "tipos_evaluacion": [
    "nueva_posicion"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PLP-02",
  "version_id": "v-PLP-02-2",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "universo_cerrado",
   "tickers": [
    "ADP",
    "HON",
    "JNJ",
    "MCD",
    "MSFT",
    "NEE",
    "PEP",
    "PG",
    "UNH",
    "V"
   ],
   "sustitucion": {
    "origen": "PLP-09",
    "permitida": true,
    "requiere_autorizacion": true,
    "mantiene_total_de_posiciones": 10
   },
   "abrir_nuevas": false,
   "max_posiciones": 10
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PLP"
   ],
   "tipos_evaluacion": [
    "nueva_posicion"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PLP-03",
  "version_id": "v-PLP-03-2",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "monto",
   "monto_usd": 5,
   "operacion": "dca",
   "frecuencia": "por_senal_de_entrada",
   "calendario_fijo": false
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PLP"
   ],
   "tipos_evaluacion": [
    "recompra",
    "aporte_periodico"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PLP-04",
  "version_id": "v-PLP-04-2",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "deteccion_tecnica",
   "accion": "recompra_dca",
   "temporalidad": "diaria",
   "cualquiera_de": [
    {
     "id": "sobreventa",
     "indicadores": [
      {
       "nombre": "RSI",
       "criterio": "<=30",
       "evaluacion": "objetiva"
      },
      {
       "nombre": "MACD",
       "criterio": "visual: gira saliendo de sobreventa",
       "evaluacion": "discrecional_del_usuario"
      },
      {
       "nombre": "Koncorde",
       "criterio": "cualquiera de sus lineas por debajo de cero",
       "evaluacion": "objetiva"
      }
     ]
    },
    {
     "id": "piso_de_figura_chartista",
     "figuras": [
      "canal",
      "hombro_cabeza_hombro",
      "triangulo"
     ],
     "evaluacion": "juicio_del_analista_tecnico_con_evidencia_confirmado_por_el_usuario"
    },
    {
     "id": "banda_mogalef_inferior",
     "criterio": "el precio toca o cae por debajo de la banda inferior",
     "indicador": "mogalefBandsSeries",
     "evaluacion": "objetiva",
     "parametros": [
      10,
      30,
      1.5
     ]
    },
    {
     "id": "media_movil",
     "criterio": "EMA(8) > EMA(21)",
     "evaluacion": "objetiva"
    },
    {
     "id": "soporte_pasado",
     "niveles": [
      "pivotes",
      "max_min_52_semanas",
      "max_min_5_anios",
      "max_min_10_anios"
     ],
     "evaluacion": "objetiva",
     "tolerancia_pct": 1.5
    }
   ],
   "ademas_evaluar": [
    "oportunidad_valuacion",
    "deterioro_permanente"
   ],
   "cuantos_deben_coincidir": 1,
   "discrecional_del_usuario": "el sistema muestra los valores y no bloquea; la confirmacion visual la haces tu al autorizar"
  },
  "clase": "delegada",
  "aplica_a": {
   "portafolios": [
    "PLP"
   ],
   "tipos_evaluacion": [
    "recompra",
    "aporte_periodico"
   ]
  },
  "componente_delegado": "tecnico,valuacion,fundamental"
 },
 {
  "codigo": "PLP-05",
  "version_id": "v-PLP-05-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "destino",
   "genera": "tarea_pendiente",
   "origen": "dividendos_plp",
   "porcentaje": 100,
   "destino_ticker": "IVV PESOS",
   "separar_de_rendimiento_por_precio": true
  },
  "clase": "calendario_tarea",
  "aplica_a": {
   "portafolios": [
    "PLP"
   ],
   "tipos_evaluacion": [
    "aporte_periodico"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PLP-06",
  "version_id": "v-PLP-06-1",
  "caracter": "referencial",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "stop": "referencial",
   "tipo": "politica_stop",
   "si_tesis_rota": "revision_formal",
   "venta_automatica": false
  },
  "clase": "referencial",
  "aplica_a": {
   "portafolios": [
    "PLP"
   ],
   "tipos_evaluacion": [
    "posicion_abierta",
    "recompra"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PLP-07",
  "version_id": "v-PLP-07-1",
  "caracter": "referencial",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "concentracion_sectorial",
   "limites": "no_definidos"
  },
  "clase": "referencial",
  "aplica_a": {
   "portafolios": [
    "PLP"
   ],
   "tipos_evaluacion": [
    "recompra",
    "aporte_periodico"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PLP-08",
  "version_id": "v-PLP-08-1",
  "caracter": "referencial",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "reporte",
   "comunicar_cuando": "hay_recompras"
  },
  "clase": "referencial",
  "aplica_a": {
   "portafolios": [
    "PLP"
   ],
   "tipos_evaluacion": [
    "recompra"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PLP-09",
  "version_id": "v-PLP-09-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "revision_periodica",
   "evalua": "fundamentales",
   "genera": "tarea_pendiente",
   "alcance": "posiciones_del_PLP",
   "si_vende": {
    "criterio": "una_de_las_mejores_opciones",
    "buscar_sustituta": "empresa_de_calidad",
    "requiere_autorizacion": true
   },
   "cada_meses": 12,
   "vender_solo_si": {
    "confirmado_en": "revision_formal",
    "veredicto_fundamental": "DEBIL"
   },
   "primera_revision": "2027-10-06"
  },
  "clase": "calendario_tarea",
  "aplica_a": {
   "portafolios": [
    "PLP"
   ],
   "tipos_evaluacion": [
    "revision_tesis"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PMP-01",
  "version_id": "v-PMP-01-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "filtro",
   "umbral": 14,
   "formula": "((valor_estimado_base / precio_actual) ^ (12 / horizonte_meses)) - 1",
   "metrica": "ganancia_anualizada_pct",
   "aplica_a": "apertura_de_posicion_nueva",
   "operador": ">",
   "referencia": "rendimiento_anual_aproximado_del_SP500",
   "no_aplica_a": [
    "recompras",
    "posiciones_abiertas"
   ],
   "si_no_cumple": "buscar_otra_candidata",
   "horizonte_meses": 36,
   "exactamente_umbral": "no_cumple",
   "redondeo_decimales": 2,
   "valor_estimado_base": "Analista de Valuacion, escenario base (calculado por codigo)"
  },
  "clase": "filtro_elegibilidad",
  "aplica_a": {
   "portafolios": [
    "PMP"
   ],
   "tipos_evaluacion": [
    "nueva_posicion"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PMP-02",
  "version_id": "v-PMP-02-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "monto",
   "monto_usd": 50,
   "operacion": "apertura",
   "naturaleza": "estandar_no_obligacion"
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PMP"
   ],
   "tipos_evaluacion": [
    "nueva_posicion"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PMP-03",
  "version_id": "v-PMP-03-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "monto",
   "monto_usd": 10,
   "operacion": "recompra",
   "naturaleza": "estandar_no_obligacion",
   "incluye_posiciones_abiertas": true
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PMP"
   ],
   "tipos_evaluacion": [
    "recompra"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PMP-04",
  "version_id": "v-PMP-04-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "rol_obligatorio",
   "roles": [
    "flujo",
    "crecimiento",
    "mixto"
   ],
   "definir_antes_de_comprar": true
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PMP"
   ],
   "tipos_evaluacion": [
    "nueva_posicion"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PMP-05",
  "version_id": "v-PMP-05-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "proceso",
   "orden": [
    "radiografia",
    "valuacion",
    "ganancia_anualizada",
    "grafico_riesgo_ejecucion"
   ]
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PMP"
   ],
   "tipos_evaluacion": [
    "nueva_posicion",
    "recompra"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PMP-06",
  "version_id": "v-PMP-06-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "destino",
   "genera": "tarea_pendiente",
   "origen": "dividendos_pmp",
   "porcentaje": 100,
   "destino_ticker": "IVV PESOS",
   "reinvertir_en_misma_accion": false
  },
  "clase": "calendario_tarea",
  "aplica_a": {
   "portafolios": [
    "PMP"
   ],
   "tipos_evaluacion": [
    "aporte_periodico"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PMP-07",
  "version_id": "v-PMP-07-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "checklist",
   "regla": "caida_no_es_senal_de_recompra",
   "requiere": [
    "tesis",
    "valuacion",
    "analisis_tecnico"
   ]
  },
  "clase": "delegada",
  "aplica_a": {
   "portafolios": [
    "PMP"
   ],
   "tipos_evaluacion": [
    "recompra"
   ]
  },
  "componente_delegado": "motor"
 },
 {
  "codigo": "PMP-08",
  "version_id": "v-PMP-08-1",
  "caracter": "referencial",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "stop": "referencial",
   "tipo": "politica_stop",
   "reevaluar_si": "fundamentos_o_tesis_se_deterioran",
   "venta_automatica": false
  },
  "clase": "referencial",
  "aplica_a": {
   "portafolios": [
    "PMP"
   ],
   "tipos_evaluacion": [
    "posicion_abierta",
    "recompra"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PMP-09",
  "version_id": "v-PMP-09-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "ficha",
   "indices": [
    "SPY",
    "QQQ",
    "DIA",
    "QUAL"
   ],
   "apartados": [
    "identidad",
    "rol",
    "negocio",
    "rendimiento",
    "volatilidad_riesgo",
    "dividendos_fundamentales",
    "correlacion",
    "plan_ejecucion",
    "decision_final",
    "indices_referencia",
    "competidores"
   ],
   "no_pertenecer": "con_reservas"
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PMP"
   ],
   "tipos_evaluacion": [
    "nueva_posicion"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PMP-10",
  "version_id": "v-PMP-10-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "checklist",
   "regla": "mantener_no_autoriza_recompra"
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "PMP"
   ],
   "tipos_evaluacion": [
    "recompra"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "PMP-11",
  "version_id": "v-PMP-11-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "revision_periodica",
   "evalua": "fundamentales",
   "genera": "tarea_pendiente",
   "alcance": "posiciones_abiertas_del_PMP",
   "cada_meses": 6,
   "si_deterioro": {
    "venta": "solo_tras_revision_formal_de_tesis",
    "detener": [
     "aperturas",
     "recompras"
    ],
    "venta_automatica": false
   },
   "primera_revision": "2027-04-06"
  },
  "clase": "calendario_tarea",
  "aplica_a": {
   "portafolios": [
    "PMP"
   ],
   "tipos_evaluacion": [
    "revision_tesis"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "SEM-01",
  "version_id": "v-SEM-01-1",
  "caracter": "referencial",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "objetivo",
   "compras": 1,
   "frecuencia": "semanal",
   "forzar_compra": false
  },
  "clase": "referencial",
  "aplica_a": {
   "portafolios": [
    "SEMILLA"
   ],
   "tipos_evaluacion": [
    "nueva_posicion"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "SEM-02",
  "version_id": "v-SEM-02-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "monto",
   "monto_usd": 5
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "SEMILLA"
   ],
   "tipos_evaluacion": [
    "nueva_posicion"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "SEM-03",
  "version_id": "v-SEM-03-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "limite",
   "posicion_53": "no_se_abre",
   "max_posiciones": 52
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "SEMILLA"
   ],
   "tipos_evaluacion": [
    "nueva_posicion"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "SEM-04",
  "version_id": "v-SEM-04-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "checklist",
   "dividendos": "solo_misma_empresa",
   "recompras_con_dinero_nuevo": false
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "SEMILLA"
   ],
   "tipos_evaluacion": [
    "recompra"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "SEM-05",
  "version_id": "v-SEM-05-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "filtros_seleccion",
   "filtros": [
    "ipo_reciente",
    "empresa_operativa_sin_spac",
    "innovacion_disrupcion",
    "calidad_minima",
    "tesis_escrita_con_invalidacion"
   ],
   "ipo_reciente_prioridad_meses": 6
  },
  "clase": "filtro_elegibilidad",
  "aplica_a": {
   "portafolios": [
    "SEMILLA"
   ],
   "tipos_evaluacion": [
    "nueva_posicion"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "SEM-06",
  "version_id": "v-SEM-06-2",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "salida",
   "no_vender_por": "caida_ordinaria",
   "causas_validas": [
    "quiebra",
    "desliste",
    "adquisicion_o_fusion",
    "revision_final_de_tesis",
    "situacion_extraordinaria",
    "limite_de_vida_15_anios"
   ],
   "limite_de_vida_anios": 15
  },
  "clase": "estructura_limite",
  "aplica_a": {
   "portafolios": [
    "SEMILLA"
   ],
   "tipos_evaluacion": [
    "posicion_abierta"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "SEM-07",
  "version_id": "v-SEM-07-1",
  "caracter": "referencial",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "senal_salida",
   "banana": {
    "definicion": "maximo semanal del movimiento >= multiplo del minimo semanal mas bajo de las 52 semanas previas a ese maximo (o desde la IPO si hay menos historial)",
    "umbral_multiplo": 2,
    "independiente_del_numero_de_semanas": true
   },
   "salida": {
    "conteo_desde": "maximo_semanal_del_movimiento",
    "vela_bajista": "cierre_menor_que_apertura",
    "reinicia_si_nuevo_maximo": true,
    "velas_semanales_bajistas_consecutivas": 3
   },
   "sin_banana": "rige_SEM-06_no_se_vende_por_caida_ordinaria",
   "origen_del_umbral": "definido_por_delegacion_del_usuario",
   "requiere_autorizacion": true
  },
  "clase": "referencial",
  "aplica_a": {
   "portafolios": [
    "SEMILLA"
   ],
   "tipos_evaluacion": [
    "posicion_abierta"
   ]
  },
  "componente_delegado": "tecnico"
 },
 {
  "codigo": "SEM-08",
  "version_id": "v-SEM-08-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "registro_obligatorio",
   "campos": [
    "fecha",
    "ticker",
    "nombre",
    "sector",
    "fecha_ipo",
    "precio",
    "monto",
    "cantidad",
    "tesis",
    "motivo_seleccion",
    "calificacion",
    "conviccion",
    "estado",
    "riesgos"
   ]
  },
  "clase": "calendario_tarea",
  "aplica_a": {
   "portafolios": [
    "SEMILLA"
   ],
   "tipos_evaluacion": [
    "nueva_posicion"
   ]
  },
  "componente_delegado": null
 },
 {
  "codigo": "SEM-09",
  "version_id": "v-SEM-09-1",
  "caracter": "obligatoria",
  "vigente_desde": "2026-10-06",
  "definicion": {
   "tipo": "destino_de_ventas",
   "genera": "tarea_pendiente",
   "origen": "ventas_de_semilla",
   "por_causa": {
    "otras_causas": {
     "destino": "reserva_para_futuras_ipos"
    },
    "limite_de_vida_15_anios": {
     "destino": "cuenta_personal_del_usuario"
    },
    "banana_o_senal_de_salida": {
     "destino": "comprar_siguientes_ipos",
     "si_52_posiciones": "portafolio_etf_sectorial"
    }
   }
  },
  "clase": "calendario_tarea",
  "aplica_a": {
   "portafolios": [
    "SEMILLA"
   ],
   "tipos_evaluacion": [
    "posicion_abierta"
   ]
  },
  "componente_delegado": null
 }
] as ReglaEntrada[];

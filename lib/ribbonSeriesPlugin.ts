import type {
  CustomData,
  ICustomSeriesPaneRenderer,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  PriceToCoordinateConverter,
  Time,
  WhitespaceData,
  CustomSeriesOptions,
} from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'

export interface RibbonData extends CustomData<Time> {
  fast: number
  slow: number
}

export interface RibbonSeriesOptions extends CustomSeriesOptions {
  upColor: string
  downColor: string
}

const defaults = {
  color: 'rgba(34, 197, 94, 0.25)',
  visible: true,
  title: '',
  lastValueVisible: true,
  priceLineVisible: true,
  upColor: 'rgba(34, 197, 94, 0.25)',
  downColor: 'rgba(244, 63, 94, 0.25)',
} as RibbonSeriesOptions

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// Un punto de la cinta ya convertido a píxeles de bitmap
type Pt = { x: number; yFast: number; ySlow: number; diff: number }

class RibbonRenderer implements ICustomSeriesPaneRenderer {
  private _data: PaneRendererCustomData<Time, RibbonData> | null = null
  private _options: RibbonSeriesOptions = defaults

  update(data: PaneRendererCustomData<Time, RibbonData>, options: RibbonSeriesOptions): void {
    this._data = data
    this._options = options
  }

  draw(target: CanvasRenderingTarget2D, priceConverter: PriceToCoordinateConverter): void {
    target.useBitmapCoordinateSpace(scope => {
      if (!this._data || this._data.bars.length < 2) return
      const ctx = scope.context
      const hRatio = scope.horizontalPixelRatio
      const vRatio = scope.verticalPixelRatio
      const { upColor, downColor } = this._options

      // Un tramo continuo del mismo color se dibuja como UN solo polígono (borde de arriba hacia delante,
      // borde de abajo hacia atrás). Antes se rellenaba un cuadrilátero por vela, y con colores
      // semitransparentes las uniones se veían como rayitas.
      let runUp = true
      let fastPts: number[] = [] // x, y, x, y, ...
      let slowPts: number[] = []

      const flush = () => {
        if (fastPts.length >= 4) {
          ctx.fillStyle = runUp ? upColor : downColor
          ctx.beginPath()
          ctx.moveTo(fastPts[0], fastPts[1])
          for (let k = 2; k < fastPts.length; k += 2) ctx.lineTo(fastPts[k], fastPts[k + 1])
          for (let k = slowPts.length - 2; k >= 0; k -= 2) ctx.lineTo(slowPts[k], slowPts[k + 1])
          ctx.closePath()
          ctx.fill()
        }
        fastPts = []
        slowPts = []
      }

      let prev: Pt | null = null

      for (const bar of this._data.bars) {
        const d = bar.originalData as RibbonData
        // Sin datos o fuera de la escala de precios: se corta la cinta en vez de dibujar hasta y=0
        const yFastRaw = isFiniteNum(d.fast) ? priceConverter(d.fast) : null
        const ySlowRaw = isFiniteNum(d.slow) ? priceConverter(d.slow) : null
        if (yFastRaw == null || ySlowRaw == null) {
          flush()
          prev = null
          continue
        }

        const cur: Pt = {
          x: bar.x * hRatio,
          yFast: yFastRaw * vRatio,
          ySlow: ySlowRaw * vRatio,
          diff: d.fast - d.slow,
        }

        if (prev === null) {
          runUp = cur.diff >= 0
          fastPts = [cur.x, cur.yFast]
          slowPts = [cur.x, cur.ySlow]
        } else {
          const prevUp = prev.diff >= 0
          const curUp = cur.diff >= 0

          if (prevUp === curUp) {
            fastPts.push(cur.x, cur.yFast)
            slowPts.push(cur.x, cur.ySlow)
          } else {
            // Las líneas se cruzan entre las dos velas: el tramo se corta justo en el cruce, así cada lado
            // lleva su color (antes el cuadrilátero entero tomaba el color de la primera vela).
            const t = prev.diff / (prev.diff - cur.diff)
            const xc = prev.x + t * (cur.x - prev.x)
            const yc = prev.yFast + t * (cur.yFast - prev.yFast)

            fastPts.push(xc, yc)
            slowPts.push(xc, yc)
            flush()

            runUp = curUp
            fastPts = [xc, yc, cur.x, cur.yFast]
            slowPts = [xc, yc, cur.x, cur.ySlow]
          }
        }
        prev = cur
      }
      flush()
    })
  }
}

export class RibbonSeries implements ICustomSeriesPaneView<Time, RibbonData, RibbonSeriesOptions> {
  private _renderer = new RibbonRenderer()

  priceValueBuilder(plotRow: RibbonData): number[] {
    return [plotRow.fast, plotRow.slow]
  }

  // Un punto sin fast/slow (por ejemplo el arranque de una media móvil) es un hueco, no un dato:
  // antes solo se descartaba `undefined`, y un null/NaN llegaba al autoescalado del precio.
  isWhitespace(data: RibbonData | WhitespaceData<Time>): data is WhitespaceData<Time> {
    const d = data as Partial<RibbonData>
    return !isFiniteNum(d.fast) || !isFiniteNum(d.slow)
  }

  renderer(): ICustomSeriesPaneRenderer {
    return this._renderer
  }

  update(data: PaneRendererCustomData<Time, RibbonData>, options: RibbonSeriesOptions): void {
    this._renderer.update(data, options)
  }

  defaultOptions(): RibbonSeriesOptions {
    return { ...defaults }
  }
}
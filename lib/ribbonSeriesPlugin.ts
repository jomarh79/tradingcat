import type {
  CustomData,
  ICustomSeriesPaneRenderer,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  PriceToCoordinateConverter,
  Time,
  WhitespaceData,
} from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'

export interface RibbonData extends CustomData<Time> {
  fast: number
  slow: number
}

export interface RibbonSeriesOptions {
  color: string // <-- 1. Añadido para satisfacer a CustomStyleOptions
  upColor: string
  downColor: string
}

const defaults: RibbonSeriesOptions = {
  color: 'rgba(34, 197, 94, 0.25)', // <-- 2. Valor por defecto obligatorio
  upColor: 'rgba(34, 197, 94, 0.25)',
  downColor: 'rgba(244, 63, 94, 0.25)',
}

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
      const ratio = scope.horizontalPixelRatio
      const vRatio = scope.verticalPixelRatio

      const bars = this._data!.bars

      for (let i = 0; i < bars.length - 1; i++) {
        const b1 = bars[i]
        const b2 = bars[i + 1]
        const d1 = b1.originalData as RibbonData
        const d2 = b2.originalData as RibbonData
        if (d1.fast == null || d1.slow == null || d2.fast == null || d2.slow == null) continue

        const x1 = b1.x * ratio
        const x2 = b2.x * ratio
        const yFast1 = (priceConverter(d1.fast) ?? 0) * vRatio
        const ySlow1 = (priceConverter(d1.slow) ?? 0) * vRatio
        const yFast2 = (priceConverter(d2.fast) ?? 0) * vRatio
        const ySlow2 = (priceConverter(d2.slow) ?? 0) * vRatio

        const isUp = d1.fast >= d1.slow
        ctx.fillStyle = isUp ? this._options.upColor : this._options.downColor

        ctx.beginPath()
        ctx.moveTo(x1, yFast1)
        ctx.lineTo(x2, yFast2)
        ctx.lineTo(x2, ySlow2)
        ctx.lineTo(x1, ySlow1)
        ctx.closePath()
        ctx.fill()
      }
    })
  }
}

export class RibbonSeries implements ICustomSeriesPaneView<Time, RibbonData, RibbonSeriesOptions> {
  private _renderer = new RibbonRenderer()

  priceValueBuilder(plotRow: RibbonData): number[] {
    return [plotRow.fast, plotRow.slow]
  }

  isWhitespace(data: RibbonData | WhitespaceData<Time>): data is WhitespaceData<Time> {
    return (data as Partial<RibbonData>).fast === undefined
  }

  renderer(): ICustomSeriesPaneRenderer {
    return this._renderer
  }

  update(data: PaneRendererCustomData<Time, RibbonData>, options: RibbonSeriesOptions): void {
    this._renderer.update(data, options)
  }

  defaultOptions(): RibbonSeriesOptions {
    return defaults
  }
}
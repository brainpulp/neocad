import { FASTENERS, STOCK } from '../document/catalog'
import type { FastenerType, StockType } from '../document/types'
import { useDocStore, useStoreApi } from './storeContext'

const STOCK_TYPES = Object.keys(STOCK) as StockType[]
const FASTENER_TYPES = Object.keys(FASTENERS) as FastenerType[]

export function Palette() {
  const store = useStoreApi()
  const activeTool = useDocStore((s) => s.activeTool)
  const fastenTool = useDocStore((s) => s.fastenTool)

  return (
    <div className="palette">
      <div className="label">STOCK</div>
      {STOCK_TYPES.map((t) => (
        <button
          key={t}
          className={activeTool === t ? 'active' : ''}
          onClick={() => store.getState().setActiveTool(activeTool === t ? null : t)}
        >
          {STOCK[t].label}
        </button>
      ))}

      <div className="label" style={{ marginTop: 14 }}>
        FASTENERS
      </div>
      {FASTENER_TYPES.map((t) => (
        <button
          key={t}
          className={fastenTool === t ? 'active' : ''}
          onClick={() => store.getState().setFastenTool(fastenTool === t ? null : t)}
        >
          {FASTENERS[t].label}
        </button>
      ))}
    </div>
  )
}

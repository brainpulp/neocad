import { FASTENERS, RIGID_FASTENER_TYPES, STOCK, STOCK_GROUPS } from '../document/catalog'
import type { FastenerType, StockType } from '../document/types'
import { useDocStore, useStoreApi } from './storeContext'

const STOCK_TYPES = Object.keys(STOCK) as StockType[]

export function Palette() {
  const store = useStoreApi()
  const activeTool = useDocStore((s) => s.activeTool)
  const fastenTool = useDocStore((s) => s.fastenTool)

  return (
    <div className="palette">
      {STOCK_GROUPS.map(({ group, label }, i) => (
        <div key={group}>
          <div className="label" style={i > 0 ? { marginTop: 14 } : undefined}>
            {label}
          </div>
          {STOCK_TYPES.filter((t) => STOCK[t].group === group).map((t) => (
            <button
              key={t}
              className={activeTool === t ? 'active' : ''}
              onClick={() => store.getState().setActiveTool(activeTool === t ? null : t)}
            >
              {STOCK[t].label}
            </button>
          ))}
        </div>
      ))}

      <div className="label" style={{ marginTop: 14 }}>
        FASTENERS
      </div>
      {RIGID_FASTENER_TYPES.map((t: FastenerType) => (
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

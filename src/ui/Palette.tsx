import { STOCK } from '../document/catalog'
import type { StockType } from '../document/types'
import { useDocStore, useStoreApi } from './storeContext'

const STOCK_TYPES = Object.keys(STOCK) as StockType[]

export function Palette() {
  const store = useStoreApi()
  const activeTool = useDocStore((s) => s.activeTool)

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
    </div>
  )
}

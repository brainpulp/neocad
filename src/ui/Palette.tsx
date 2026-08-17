import { FASTENERS, RIGID_FASTENER_TYPES, STOCK } from '../document/catalog'
import { MECHANISMS } from '../document/mechanisms'
import type { FastenerType, StockType } from '../document/types'
import { useDocStore, useStoreApi } from './storeContext'

const STOCK_TYPES = Object.keys(STOCK) as StockType[]

// Placeholder icons (we'll iterate toward proper glyphs).
const STOCK_ICONS: Record<StockType, string> = {
  rod: '📏', tube: '🥤', dowel: '🪄', slat: '🥖', joist: '🪵', panel: '🟫',
  block: '🧱', ball: '⚽', wedge: '◢', gear: '⚙️', pinion: '🔩', ratchet: '🦷', cam: '🥚',
  pulley: '🛞', axle: '🖊', pin: '📍',
}
const FASTENER_ICONS: Record<string, string> = {
  weld: '🔥', glue: '💧', bolt: '🔩', nail: '📌',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="palette-section">
      <summary className="label">{title}</summary>
      {children}
    </details>
  )
}

export function Palette() {
  const store = useStoreApi()
  const activeTool = useDocStore((s) => s.activeTool)
  const fastenTool = useDocStore((s) => s.fastenTool)
  const placingMechanismId = useDocStore((s) => s.placingMechanismId)

  const stockButton = (t: StockType) => (
    <button
      key={t}
      className={activeTool === t ? 'active' : ''}
      onClick={() => store.getState().setActiveTool(activeTool === t ? null : t)}
    >
      <span className="icon">{STOCK_ICONS[t]}</span> {STOCK[t].label}
    </button>
  )

  return (
    <div className="palette">
      <Section title="STOCK">{STOCK_TYPES.filter((t) => STOCK[t].group === 'stock').map(stockButton)}</Section>
      <Section title="MECHANICAL">
        {STOCK_TYPES.filter((t) => STOCK[t].group === 'mechanical').map(stockButton)}
      </Section>
      <Section title="MECHANISMS">
        {MECHANISMS.map((m) => (
          <button
            key={m.id}
            className={placingMechanismId === m.id ? 'active' : ''}
            title="Click, then click a spot on the bench to place it"
            onClick={() =>
              store.getState().setPlacingMechanism(placingMechanismId === m.id ? null : m.id)
            }
          >
            <span className="icon">{m.icon}</span> {m.label}
          </button>
        ))}
      </Section>
      <Section title="FASTENERS">
        {RIGID_FASTENER_TYPES.map((t: FastenerType) => (
          <button
            key={t}
            className={fastenTool === t ? 'active' : ''}
            onClick={() => store.getState().setFastenTool(fastenTool === t ? null : t)}
          >
            <span className="icon">{FASTENER_ICONS[t]}</span> {FASTENERS[t].label}
          </button>
        ))}
      </Section>
    </div>
  )
}

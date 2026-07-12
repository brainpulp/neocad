/**
 * Bill of materials — the "order the wood" list. Tallies the layout parts into
 * grouped line items (identical parts collapse to one row with a quantity),
 * with dimensions, per-part and total volume, and board-feet. Pure: it reads the
 * same `layoutStair` parts the geometry does, so the list always matches the model.
 */
import type { StairSpec } from './spec'
import { layoutStair, type Part, type PartKind } from './layout'

export interface BomLine {
  kind: PartKind
  label: string
  qty: number
  /** Human dimensions, e.g. "275 × 1000 × 40 mm". */
  dims: string
  /** Volume of one part (m³). */
  unitVolume: number
  /** qty × unitVolume (m³). */
  totalVolume: number
}

export interface Bom {
  lines: BomLine[]
  material: string
  totalVolume: number
  /** Board-feet (1 bf = 144 in³ = 0.0023597 m³) — how lumber is often ordered. */
  boardFeet: number
}

const BOARD_FOOT_M3 = 0.0023597

const mm = (x: number) => Math.round(x * 1000)

function polygonArea(poly: [number, number][]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i]
    const [x2, z2] = poly[(i + 1) % poly.length]
    a += x1 * z2 - x2 * z1
  }
  return Math.abs(a / 2)
}

interface Described {
  /** Bounding extents (L ≥ W ≥ T), for grouping + a blank-size dims string. */
  ext: [number, number, number]
  volume: number
  /** A cut to a non-rectangular outline (winder wedge, triangular landing). */
  shaped: boolean
}

function describe(p: Part): Described {
  if (p.shape === 'box') {
    const ext = [...p.size].sort((a, b) => b - a) as [number, number, number]
    return { ext, volume: p.size[0] * p.size[1] * p.size[2], shaped: false }
  }
  const h = p.top - p.bottom
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity
  for (const [x, z] of p.polygon) {
    minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z)
  }
  const ext = [maxx - minx, maxz - minz, h].sort((a, b) => b - a) as [number, number, number]
  return { ext, volume: polygonArea(p.polygon) * h, shaped: true }
}

const KIND_LABEL: Record<PartKind, string> = {
  tread: 'Tread',
  riser: 'Riser',
  landing: 'Landing',
  stringer: 'Stringer',
  fascia: 'Fascia board',
  rail: 'Handrail',
  baluster: 'Baluster',
  post: 'Newel post',
}

interface Group {
  kind: PartKind
  label: string
  qty: number
  ext: [number, number, number] // max blank size seen in the group
  totalVolume: number
}

export function stairBom(spec: StairSpec): Bom {
  const { parts } = layoutStair(spec)
  const groups = new Map<string, Group>()
  for (const p of parts) {
    const d = describe(p)
    // Shaped parts (winder wedges, triangular landings) are each unique, but for a
    // lumber order they collapse to one line — buy N blanks of the largest size.
    const label = KIND_LABEL[p.kind] + (d.shaped ? (p.kind === 'tread' ? ' (winder)' : ' (shaped)') : '')
    const key = d.shaped ? `${p.kind}|shaped` : `${p.kind}|${d.ext.map(mm).join('x')}`
    const g = groups.get(key)
    if (g) {
      g.qty += 1
      g.totalVolume += d.volume
      g.ext = g.ext.map((v, i) => Math.max(v, d.ext[i])) as [number, number, number]
    } else {
      groups.set(key, { kind: p.kind, label, qty: 1, ext: d.ext, totalVolume: d.volume })
    }
  }
  const order: PartKind[] = ['tread', 'riser', 'landing', 'stringer']
  const lines: BomLine[] = [...groups.values()]
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.qty - a.qty)
    .map((g) => ({
      kind: g.kind,
      label: g.label,
      qty: g.qty,
      dims: `${mm(g.ext[0])} × ${mm(g.ext[1])} × ${mm(g.ext[2])} mm`,
      unitVolume: g.totalVolume / g.qty,
      totalVolume: g.totalVolume,
    }))
  const totalVolume = lines.reduce((s, l) => s + l.totalVolume, 0)
  return { lines, material: spec.material, totalVolume, boardFeet: totalVolume / BOARD_FOOT_M3 }
}

/** The cut list as CSV text (for a spreadsheet / a lumber order). */
export function bomToCsv(bom: Bom): string {
  const rows = [
    ['Part', 'Qty', 'Dimensions', 'Material', 'Unit volume (m³)', 'Total volume (m³)'],
    ...bom.lines.map((l) => [
      l.label,
      String(l.qty),
      l.dims,
      bom.material,
      l.unitVolume.toFixed(5),
      l.totalVolume.toFixed(5),
    ]),
    [],
    ['Total', '', '', bom.material, '', bom.totalVolume.toFixed(5)],
    ['Board-feet', '', '', '', '', bom.boardFeet.toFixed(1)],
  ]
  return rows.map((r) => r.map((c) => (c.includes(',') ? `"${c}"` : c)).join(',')).join('\n')
}

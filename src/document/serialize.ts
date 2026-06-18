import { CURRENT_VERSION, type Document } from './types'

export function toJSON(doc: Document): string {
  return JSON.stringify(doc)
}

/**
 * Bring a parsed document up to CURRENT_VERSION. Each future schema bump adds a
 * step here. A versionless (pre-v1) document is treated as v1.
 */
function migrate(raw: Record<string, unknown>): Document {
  const doc = raw as Partial<Document> & Record<string, unknown>
  if (doc.version == null) doc.version = 1
  // future: while (doc.version < CURRENT_VERSION) { ...step up...; doc.version++ }
  if (!doc.fasteners) doc.fasteners = [] // added in M2
  doc.version = CURRENT_VERSION
  return doc as Document
}

export function fromJSON(json: string): Document {
  return migrate(JSON.parse(json))
}

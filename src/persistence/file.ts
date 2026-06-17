import { fromJSON, toJSON } from '../document/serialize'
import type { Document } from '../document/types'

/** Download the document as a canonical .neocad.json file (the share mechanism). */
export function downloadDocument(doc: Document): void {
  const blob = new Blob([toJSON(doc)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${doc.metadata.name || 'untitled'}.neocad.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** Prompt the user to pick a .neocad.json file and parse it. Resolves null if cancelled. */
export function pickDocument(): Promise<Document | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.neocad.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      resolve(fromJSON(await file.text()))
    }
    input.click()
  })
}

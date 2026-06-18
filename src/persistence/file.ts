import { fromJSON, toJSON } from '../document/serialize'
import type { Document } from '../document/types'

/** Trigger a browser download of a Blob under the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Download the document as a canonical .neocad.json file (the share mechanism). */
export function downloadDocument(doc: Document): void {
  const blob = new Blob([toJSON(doc)], { type: 'application/json' })
  downloadBlob(blob, `${doc.metadata.name || 'untitled'}.neocad.json`)
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

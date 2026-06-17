import { fromJSON, toJSON } from '../document/serialize'
import type { Document } from '../document/types'

const DB_NAME = 'neocad'
const STORE = 'documents'
const KEY = 'current'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

/** Persist the current working document (as canonical .neocad.json text). */
export async function saveDoc(doc: Document): Promise<void> {
  if (!hasIndexedDb()) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(toJSON(doc), KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

/** Restore the last working document, or null if none saved. */
export async function loadDoc(): Promise<Document | null> {
  if (!hasIndexedDb()) return null
  const db = await openDb()
  const json = await new Promise<string | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY)
    req.onsuccess = () => resolve(req.result as string | undefined)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return json ? fromJSON(json) : null
}

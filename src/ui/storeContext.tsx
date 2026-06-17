import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { DocState, DocStore } from '../document/store'

export const StoreContext = createContext<DocStore | null>(null)

export function useStoreApi(): DocStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error('StoreContext not provided')
  return store
}

export function useDocStore<T>(selector: (s: DocState) => T): T {
  return useStore(useStoreApi(), selector)
}

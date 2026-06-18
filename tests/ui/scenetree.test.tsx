import { it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'
import { StoreContext } from '../../src/ui/storeContext'
import { SceneTree } from '../../src/ui/SceneTree'

function setup() {
  const store = createDocStore()
  const a = makePiece('block', [0, 1, 0])
  const b = makePiece('rod', [0, 2, 0])
  store.getState().addPiece(a)
  store.getState().addPiece(b)
  store.getState().setFastenTool('weld')
  store.getState().fastenClick(a.id)
  store.getState().fastenClick(b.id)
  render(
    <StoreContext.Provider value={store}>
      <SceneTree />
    </StoreContext.Provider>,
  )
  return { store, a, b }
}

it('lists a row per piece and per fastener', () => {
  setup()
  expect(screen.getByText('Block')).toBeInTheDocument()
  expect(screen.getByText('Rod')).toBeInTheDocument()
  expect(screen.getByText(/Weld/)).toBeInTheDocument()
})

it('clicking a piece row selects it', () => {
  const { store, a } = setup()
  fireEvent.click(screen.getByText('Block'))
  expect(store.getState().selectedId).toBe(a.id)
})

it('clicking a piece row delete (✕) removes it', () => {
  const { store } = setup()
  fireEvent.click(screen.getByLabelText('delete Block'))
  expect(store.getState().doc.pieces.find((p) => p.name === 'Block')).toBeUndefined()
})

it('clicking a fastener row delete removes the fastener', () => {
  const { store } = setup()
  fireEvent.click(screen.getByLabelText(/delete fastener/i))
  expect(store.getState().doc.fasteners).toHaveLength(0)
})

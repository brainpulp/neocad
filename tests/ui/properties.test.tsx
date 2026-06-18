import { it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'
import { StoreContext } from '../../src/ui/storeContext'
import { Properties } from '../../src/ui/Properties'

function renderWithSelected() {
  const store = createDocStore()
  const p = makePiece('block', [0, 1, 0])
  store.getState().addPiece(p)
  store.getState().select(p.id)
  render(
    <StoreContext.Provider value={store}>
      <Properties />
    </StoreContext.Provider>,
  )
  return { store, p }
}

it('shows nothing-selected text when no piece is selected', () => {
  const store = createDocStore()
  render(
    <StoreContext.Provider value={store}>
      <Properties />
    </StoreContext.Provider>,
  )
  expect(screen.getByText(/Nothing selected/i)).toBeInTheDocument()
})

it('toggling Anchored updates the selected piece', () => {
  const { store } = renderWithSelected()
  const cb = screen.getByLabelText(/Anchored/i) as HTMLInputElement
  expect(cb.checked).toBe(false)
  fireEvent.click(cb)
  expect(store.getState().doc.pieces[0].anchored).toBe(true)
})

it('changing material via the dropdown updates the piece', () => {
  const { store } = renderWithSelected()
  const select = screen.getByLabelText(/Material/i) as HTMLSelectElement
  fireEvent.change(select, { target: { value: 'steel' } })
  expect(store.getState().doc.pieces[0].material).toBe('steel')
})

it('editing a dimension commits on blur', () => {
  const { store } = renderWithSelected()
  const input = screen.getByLabelText('x') as HTMLInputElement
  fireEvent.change(input, { target: { value: '0.5' } })
  fireEvent.blur(input)
  expect(store.getState().doc.pieces[0].dimensions.x).toBe(0.5)
})

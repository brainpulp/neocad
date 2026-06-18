import { it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createDocStore } from '../../src/document/store'
import { makePiece } from '../../src/document/catalog'
import { StoreContext } from '../../src/ui/storeContext'
import { EmptyState } from '../../src/render/EmptyState'

it('shows the hint when there are no pieces', () => {
  const store = createDocStore()
  render(
    <StoreContext.Provider value={store}>
      <EmptyState />
    </StoreContext.Provider>,
  )
  expect(screen.getByText(/pick a stock/i)).toBeInTheDocument()
})

it('renders nothing once a piece exists', () => {
  const store = createDocStore()
  store.getState().addPiece(makePiece('block', [0, 1, 0]))
  const { container } = render(
    <StoreContext.Provider value={store}>
      <EmptyState />
    </StoreContext.Provider>,
  )
  expect(container.textContent).toBe('')
})

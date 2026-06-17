import { it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { STOCK } from '../../src/document/catalog'

// The real Scene mounts a WebGL canvas; stub it so the shell renders in jsdom.
vi.mock('../../src/render/Scene', () => ({ Scene: () => <div data-testid="scene" /> }))

import { App } from '../../src/ui/App'

it('renders a Run/Pause control, a button per stock type, and a parts:0 status', () => {
  render(<App />)
  // Pause is shown because physics is ambient (running) by default.
  expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument()
  for (const def of Object.values(STOCK)) {
    expect(screen.getByRole('button', { name: def.label })).toBeInTheDocument()
  }
  expect(screen.getByText('parts: 0')).toBeInTheDocument()
})

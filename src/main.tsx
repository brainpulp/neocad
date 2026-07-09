import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './ui/App'
import { SdfApp } from './sdf/SdfViewer'

// Dev-only SDF modeler preview (branch sdf-core): `?sdf` swaps in the raymarch
// viewer instead of the physics builder. Fully isolated — no shared state.
const sdfMode = new URLSearchParams(window.location.search).has('sdf')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{sdfMode ? <SdfApp /> : <App />}</React.StrictMode>,
)

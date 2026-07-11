import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './ui/App'
import { SdfApp } from './sdf/SdfViewer'
import { CsgApp } from './sdf/CsgViewer'

// Dev-only geometry previews (branch sdf-core), each fully isolated from the
// builder: `?sdf` = raymarched SDF, `?csg` = exact manifold-3d booleans.
const params = new URLSearchParams(window.location.search)
const Root = params.has('csg') ? CsgApp : params.has('sdf') ? SdfApp : App

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)

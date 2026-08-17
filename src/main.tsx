import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './ui/App'
import { StairApp } from './stairs/StairApp'

// Standalone tool routes (kept out of the physics sandbox). `?stairs` = the
// parametric stair generator; default = the NeoCad builder.
const params = new URLSearchParams(window.location.search)
const Root = params.has('stairs') ? StairApp : App

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)

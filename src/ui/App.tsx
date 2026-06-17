import { useMemo } from 'react'
import { createDocStore } from '../document/store'
import { StoreContext } from './storeContext'
import { Toolbar } from './Toolbar'
import { Palette } from './Palette'
import { Properties } from './Properties'
import { StatusBar } from './StatusBar'
import { Scene } from '../render/Scene'
import './app.css'

export function App() {
  const store = useMemo(() => createDocStore(), [])

  return (
    <StoreContext.Provider value={store}>
      <div className="app">
        <Toolbar />
        <div className="body">
          <Palette />
          <div className="viewport">
            <Scene />
          </div>
          <Properties />
        </div>
        <StatusBar />
      </div>
    </StoreContext.Provider>
  )
}

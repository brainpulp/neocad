import { useDocStore, useStoreApi } from './storeContext'

/**
 * Test-force generators: wind, earthquake, and the slingshot options. These are
 * evaluation tools for the running sim — session-only, never saved with the doc.
 */
export function EnvPanel() {
  const store = useStoreApi()
  const env = useDocStore((s) => s.env)
  const set = (patch: Parameters<ReturnType<typeof store.getState>['setEnv']>[0]) =>
    store.getState().setEnv(patch)

  return (
    <div className="env-panel">
      <div className="label" style={{ marginTop: 12 }}>
        FORCES
      </div>
      <label className="field checkbox">
        <input type="checkbox" checked={env.windOn} onChange={(e) => set({ windOn: e.target.checked })} />
        💨 Wind
      </label>
      {env.windOn && (
        <>
          <div className="dim-row">
            <div className="dim-label">Strength</div>
            <input
              type="range"
              aria-label="Wind strength"
              min={1}
              max={40}
              step={1}
              value={env.windStrength}
              onChange={(e) => set({ windStrength: parseFloat(e.target.value) })}
            />
          </div>
          <div className="dim-row">
            <div className="dim-label">Direction</div>
            <input
              type="range"
              aria-label="Wind direction"
              min={0}
              max={360}
              step={5}
              value={Math.round((env.windAngle * 180) / Math.PI)}
              onChange={(e) => set({ windAngle: (parseFloat(e.target.value) * Math.PI) / 180 })}
            />
          </div>
        </>
      )}
      <label className="field checkbox">
        <input type="checkbox" checked={env.quakeOn} onChange={(e) => set({ quakeOn: e.target.checked })} />
        🫨 Earthquake
      </label>
      {env.quakeOn && (
        <div className="dim-row">
          <div className="dim-label">Magnitude</div>
          <input
            type="range"
            aria-label="Earthquake magnitude"
            min={0.5}
            max={12}
            step={0.5}
            value={env.quakeMagnitude}
            onChange={(e) => set({ quakeMagnitude: parseFloat(e.target.value) })}
          />
        </div>
      )}
      <div className="label" style={{ marginTop: 8 }}>
        SLINGSHOT <span className="muted" style={{ letterSpacing: 0 }}>(Space while running)</span>
      </div>
      <div className="dim-row">
        <div className="dim-label">Rock speed</div>
        <input
          type="range"
          aria-label="Rock speed"
          min={2}
          max={20}
          step={1}
          value={env.rockSpeed}
          onChange={(e) => set({ rockSpeed: parseFloat(e.target.value) })}
        />
      </div>
      <div className="dim-row">
        <div className="dim-label">Rock size</div>
        <input
          type="range"
          aria-label="Rock size"
          min={2}
          max={15}
          step={1}
          value={Math.round(env.rockRadius * 100)}
          onChange={(e) => set({ rockRadius: parseFloat(e.target.value) / 100 })}
        />
      </div>
    </div>
  )
}

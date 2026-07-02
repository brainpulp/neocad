// Jolt module loader + collision-layer boilerplate.
//
// We use the default `jolt-physics` build (wasm-compat: wasm embedded as base64),
// which loads in both the browser (Vite) and Node/Vitest without a separate .wasm
// fetch. initJolt() is memoized so the WASM module is instantiated once.

export type JoltModule = Awaited<ReturnType<typeof loadJolt>>

let cached: Promise<JoltModule> | null = null

async function loadJolt() {
  const mod = await import('jolt-physics')
  const init = mod.default as unknown as () => Promise<unknown>
  return (await init()) as Record<string, any>
}

export function initJolt(): Promise<JoltModule> {
  if (!cached) cached = loadJolt()
  return cached
}

// Object layers: static (non-moving), dynamic (moving), the sandbox's invisible
// walls (contain pieces but let slingshot rocks fly in from outside), and the
// rocks themselves.
export const LAYER_NON_MOVING = 0
export const LAYER_MOVING = 1
export const LAYER_WALLS = 2
export const LAYER_PROJECTILE = 3
const NUM_OBJECT_LAYERS = 4

/**
 * Configure a JoltSettings with the layered broadphase/collision filtering that
 * JoltInterface requires. Standard JoltPhysics.js boilerplate, plus wall/rock rules.
 */
export function setupCollisionFiltering(Jolt: JoltModule, settings: any): void {
  const objectFilter = new Jolt.ObjectLayerPairFilterTable(NUM_OBJECT_LAYERS)
  objectFilter.EnableCollision(LAYER_NON_MOVING, LAYER_MOVING)
  objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING)
  objectFilter.EnableCollision(LAYER_WALLS, LAYER_MOVING) // walls contain pieces…
  objectFilter.EnableCollision(LAYER_NON_MOVING, LAYER_PROJECTILE)
  objectFilter.EnableCollision(LAYER_MOVING, LAYER_PROJECTILE)
  objectFilter.EnableCollision(LAYER_PROJECTILE, LAYER_PROJECTILE)
  // …but NOT rocks (no LAYER_WALLS↔LAYER_PROJECTILE): the slingshot fires from
  // outside the bench and must reach the scene.

  const BP_NON_MOVING = new Jolt.BroadPhaseLayer(0)
  const BP_MOVING = new Jolt.BroadPhaseLayer(1)
  const NUM_BROAD_PHASE_LAYERS = 2

  const bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(NUM_OBJECT_LAYERS, NUM_BROAD_PHASE_LAYERS)
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_NON_MOVING, BP_NON_MOVING)
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, BP_MOVING)
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_WALLS, BP_NON_MOVING)
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_PROJECTILE, BP_MOVING)

  settings.mObjectLayerPairFilter = objectFilter
  settings.mBroadPhaseLayerInterface = bpInterface
  settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(
    settings.mBroadPhaseLayerInterface,
    NUM_BROAD_PHASE_LAYERS,
    settings.mObjectLayerPairFilter,
    NUM_OBJECT_LAYERS,
  )
}

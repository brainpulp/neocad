import { setupCollisionFiltering, LAYER_MOVING, LAYER_NON_MOVING, type JoltModule } from './jolt'
import { makeShape } from './shapes'
import { STOCK } from '../document/catalog'
import type { Document, Material, Piece } from '../document/types'

const FALLBACK_DENSITY = 1000

function volumeOf(piece: Piece): number {
  const d = piece.dimensions
  switch (STOCK[piece.stockType].primitive) {
    case 'box':
      return d.x * d.y * d.z
    case 'cylinder':
      return Math.PI * d.radius * d.radius * d.height
    case 'sphere':
      return (4 / 3) * Math.PI * d.radius ** 3
  }
}

function massOf(piece: Piece, materials: Material[]): number {
  const mat = materials.find((m) => m.name === piece.material)
  const density = mat?.density ?? FALLBACK_DENSITY
  return Math.max(0.001, density * volumeOf(piece))
}

/**
 * A live Jolt mirror of a Document. Compiles pieces → bodies, steps at a FIXED
 * timestep (determinism, spec §12), and writes transforms back into State only.
 * Definition is never touched here.
 */
export class PhysicsWorld {
  private Jolt: JoltModule
  private ji: any
  private bodyInterface: any
  private bodies = new Map<string, any>() // pieceId → Jolt BodyID

  constructor(Jolt: JoltModule, doc: Document) {
    this.Jolt = Jolt
    const settings = new Jolt.JoltSettings()
    setupCollisionFiltering(Jolt, settings)
    this.ji = new Jolt.JoltInterface(settings)
    const physicsSystem = this.ji.GetPhysicsSystem()
    this.bodyInterface = physicsSystem.GetBodyInterface()

    const [gx, gy, gz] = doc.ground.gravity
    physicsSystem.SetGravity(new Jolt.Vec3(gx, gy, gz))

    this.createGround()
    for (const piece of doc.pieces) this.createPieceBody(piece, doc.materials)
  }

  private createGround(): void {
    const J = this.Jolt
    // Large static box whose top surface sits at y=0.
    const shape = new J.BoxShape(new J.Vec3(50, 0.5, 50), 0.0)
    const bcs = new J.BodyCreationSettings(
      shape,
      new J.RVec3(0, -0.5, 0),
      new J.Quat(0, 0, 0, 1),
      J.EMotionType_Static,
      LAYER_NON_MOVING,
    )
    const body = this.bodyInterface.CreateBody(bcs)
    this.bodyInterface.AddBody(body.GetID(), J.EActivation_DontActivate)
  }

  private createPieceBody(piece: Piece, materials: Material[]): void {
    const J = this.Jolt
    const shape = makeShape(J, STOCK[piece.stockType].primitive, piece.dimensions)
    const [px, py, pz] = piece.state.transform.position
    const [qx, qy, qz, qw] = piece.state.transform.rotation
    const isStatic = piece.anchored
    const bcs = new J.BodyCreationSettings(
      shape,
      new J.RVec3(px, py, pz),
      new J.Quat(qx, qy, qz, qw),
      isStatic ? J.EMotionType_Static : J.EMotionType_Dynamic,
      isStatic ? LAYER_NON_MOVING : LAYER_MOVING,
    )
    if (!isStatic) {
      // Realistic mass from material density × volume.
      bcs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia
      bcs.mMassPropertiesOverride.mMass = massOf(piece, materials)
    }
    const body = this.bodyInterface.CreateBody(bcs)
    this.bodyInterface.AddBody(body.GetID(), isStatic ? J.EActivation_DontActivate : J.EActivation_Activate)
    this.bodies.set(piece.id, body.GetID())
  }

  /** Advance the simulation by a FIXED dt (callers always pass 1/60). */
  step(dt: number): void {
    this.ji.Step(dt, 1)
  }

  /** Write current body transforms into each piece's State. Definition untouched. */
  syncToDocument(doc: Document): void {
    for (const piece of doc.pieces) {
      const id = this.bodies.get(piece.id)
      if (!id) continue
      const p = this.bodyInterface.GetPosition(id)
      const r = this.bodyInterface.GetRotation(id)
      piece.state.transform.position = [p.GetX(), p.GetY(), p.GetZ()]
      piece.state.transform.rotation = [r.GetX(), r.GetY(), r.GetZ(), r.GetW()]
    }
  }

  dispose(): void {
    if (this.ji && typeof (this.Jolt as any).destroy === 'function') {
      ;(this.Jolt as any).destroy(this.ji)
    }
    this.ji = null
    this.bodies.clear()
  }
}

import {
  setupCollisionFiltering,
  LAYER_MOVING,
  LAYER_NON_MOVING,
  LAYER_PROJECTILE,
  LAYER_WALLS,
  type JoltModule,
} from './jolt'
import { makeShape } from './shapes'
import { FASTENERS, STOCK } from '../document/catalog'
import { localDirToWorld, localToWorld, perpendicular } from '../document/math'
import type { Document, Fastener, Material, Piece, Vec3 } from '../document/types'

const FALLBACK_DENSITY = 1000
// Pieces should feel like workshop stock, not superballs: material restitution is
// honest data (future FEA uses it) but the rigid-body sim caps how bouncy contacts
// get so nothing ricochets off the bench.
const MAX_RESTITUTION = 0.4
const FALLBACK_FRICTION = 0.5
// The bench/ground grips well so pieces settle instead of sliding away.
const GROUND_FRICTION = 0.8
// Runaway prevention: nothing in a workshop moves at highway speed. These caps
// also make overlap resolution a firm push instead of an explosion.
const MAX_LINEAR_VELOCITY = 8 // m/s
const MAX_ANGULAR_VELOCITY = 25 // rad/s

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

function maxHalfHeight(piece: Piece): number {
  const d = piece.dimensions
  switch (STOCK[piece.stockType].primitive) {
    case 'box':
      return Math.max(d.x, d.y, d.z) / 2
    case 'cylinder':
      return Math.max(d.height, d.radius * 2) / 2
    case 'sphere':
      return d.radius
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
/** Called when two bodies collide: materials of both sides + closing speed (m/s). */
export type ImpactCallback = (materialA: string, materialB: string, speed: number) => void

export class PhysicsWorld {
  private Jolt: JoltModule
  private ji: any
  private physicsSystem: any
  private bodyInterface: any
  private contactListener: any = null
  private bodyMaterials = new Map<number, string>() // BodyID number → material name
  private bodies = new Map<string, any>() // pieceId → Jolt BodyID
  private bodyObjs = new Map<string, any>() // pieceId → Jolt Body (needed to build constraints)
  // Fastened pairs must not collide with each other (a gear's collision shape is a
  // solid cylinder — the axle through it would explode the contact solver).
  private groupFilter: any
  private subGroups = new Map<string, number>() // pieceId → subgroup id

  constructor(Jolt: JoltModule, doc: Document, onImpact?: ImpactCallback) {
    this.Jolt = Jolt
    const settings = new Jolt.JoltSettings()
    setupCollisionFiltering(Jolt, settings)
    this.ji = new Jolt.JoltInterface(settings)
    this.physicsSystem = this.ji.GetPhysicsSystem()
    this.bodyInterface = this.physicsSystem.GetBodyInterface()

    const [gx, gy, gz] = doc.ground.gravity
    this.physicsSystem.SetGravity(new Jolt.Vec3(gx, gy, gz))

    // Gentler penetration recovery: overlapping pieces separate with a nudge,
    // not a detonation (default Baumgarte 0.2 is tuned for games, not benches).
    const ps = this.physicsSystem.GetPhysicsSettings()
    ps.mBaumgarte = 0.12
    this.physicsSystem.SetPhysicsSettings(ps)

    this.groupFilter = new Jolt.GroupFilterTable(doc.pieces.length)
    this.createGround(doc)
    for (const piece of doc.pieces) this.createPieceBody(piece, doc.materials)
    for (const fastener of doc.fasteners) this.createFastener(fastener, doc)
    if (onImpact) this.installContactListener(onImpact)
  }

  /** New-contact events → material-aware impact callback (drives sound FX). */
  private installContactListener(onImpact: ImpactCallback): void {
    const J = this.Jolt as any
    const listener = new J.ContactListenerJS()
    listener.OnContactValidate = () => J.ValidateResult_AcceptAllContactsForThisBodyPair
    listener.OnContactAdded = (b1Ptr: number, b2Ptr: number) => {
      const body1 = J.wrapPointer(b1Ptr, J.Body)
      const body2 = J.wrapPointer(b2Ptr, J.Body)
      const v1 = body1.GetLinearVelocity()
      const v2 = body2.GetLinearVelocity()
      const speed = Math.hypot(
        v1.GetX() - v2.GetX(),
        v1.GetY() - v2.GetY(),
        v1.GetZ() - v2.GetZ(),
      )
      const matA = this.bodyMaterials.get(body1.GetID().GetIndexAndSequenceNumber()) ?? 'bench'
      const matB = this.bodyMaterials.get(body2.GetID().GetIndexAndSequenceNumber()) ?? 'bench'
      onImpact(matA, matB, speed)
    }
    listener.OnContactPersisted = () => {}
    listener.OnContactRemoved = () => {}
    this.physicsSystem.SetContactListener(listener)
    this.contactListener = listener
  }

  // Fasteners → Jolt constraints. Rigid (weld/glue/bolt/nail) = FixedConstraint with
  // auto-detected anchors. Joints (pivot/linear/cylindrical) = hinge/slider/6-DOF
  // built from the fastener's stored piece-local anchors + axis, converted to world
  // space at the pieces' CURRENT poses (so rebuilds stay consistent after motion).
  // A fastener whose pieces are missing is silently skipped.
  private createFastener(fastener: Fastener, doc: Document): void {
    const bodyA = this.bodyObjs.get(fastener.partA)
    const bodyB = this.bodyObjs.get(fastener.partB)
    if (!bodyA || !bodyB) return
    const J = this.Jolt
    const kind = FASTENERS[fastener.type].constraint

    // Directly-fastened pieces don't contact-collide; the constraint owns their
    // relative motion (otherwise overlap at the join fights the solver).
    const subA = this.subGroups.get(fastener.partA)
    const subB = this.subGroups.get(fastener.partB)
    if (subA != null && subB != null) this.groupFilter.DisableCollision(subA, subB)

    if (kind === 'fixed') {
      const settings = new J.FixedConstraintSettings()
      settings.mAutoDetectPoint = true
      this.physicsSystem.AddConstraint(settings.Create(bodyA, bodyB))
      return
    }

    const pieceA = doc.pieces.find((p) => p.id === fastener.partA)
    const pieceB = doc.pieces.find((p) => p.id === fastener.partB)
    if (!pieceA || !pieceB) return
    const anchorA = fastener.anchorA ?? [0, 0, 0]
    const anchorB = fastener.anchorB ?? [0, 0, 0]
    const axisLocal = fastener.axisA ?? [0, 1, 0]
    const worldA = localToWorld(pieceA.state.transform, anchorA)
    const worldB = localToWorld(pieceB.state.transform, anchorB)
    const axis = localDirToWorld(pieceA.state.transform, axisLocal)
    const normal = perpendicular(axis)
    const rvA = new J.RVec3(worldA[0], worldA[1], worldA[2])
    const rvB = new J.RVec3(worldB[0], worldB[1], worldB[2])
    const vAxis = new J.Vec3(axis[0], axis[1], axis[2])
    const vNormal = new J.Vec3(normal[0], normal[1], normal[2])

    if (kind === 'hinge') {
      const settings = new J.HingeConstraintSettings()
      settings.mSpace = J.EConstraintSpace_WorldSpace
      settings.mPoint1 = rvA
      settings.mPoint2 = rvB
      settings.mHingeAxis1 = vAxis
      settings.mHingeAxis2 = vAxis
      settings.mNormalAxis1 = vNormal
      settings.mNormalAxis2 = vNormal
      this.physicsSystem.AddConstraint(settings.Create(bodyA, bodyB))
      return
    }

    // Document slide limits describe motion of A's anchor along the axis; Jolt
    // measures body 2 relative to body 1, so the interval negates and swaps.
    const hasSlide = fastener.slideMin != null && fastener.slideMax != null
    const joltMin = hasSlide ? -fastener.slideMax! : 0
    const joltMax = hasSlide ? -fastener.slideMin! : 0

    if (kind === 'slider') {
      const settings = new J.SliderConstraintSettings()
      settings.mSpace = J.EConstraintSpace_WorldSpace
      settings.mPoint1 = rvA
      settings.mPoint2 = rvB
      settings.mSliderAxis1 = vAxis
      settings.mSliderAxis2 = vAxis
      settings.mNormalAxis1 = vNormal
      settings.mNormalAxis2 = vNormal
      if (hasSlide) {
        settings.mLimitsMin = joltMin
        settings.mLimitsMax = joltMax
      }
      this.physicsSystem.AddConstraint(settings.Create(bodyA, bodyB))
      return
    }

    // cylindrical: rotate around AND slide along the same axis. Jolt has no
    // dedicated constraint, so use a 6-DOF with the joint axis as constraint-X
    // and free translation-X + rotation-X.
    const settings = new J.SixDOFConstraintSettings()
    settings.mSpace = J.EConstraintSpace_WorldSpace
    settings.mPosition1 = rvA
    settings.mPosition2 = rvB
    settings.mAxisX1 = vAxis
    settings.mAxisY1 = vNormal
    settings.mAxisX2 = vAxis
    settings.mAxisY2 = vNormal
    settings.MakeFixedAxis(J.SixDOFConstraintSettings_EAxis_TranslationY)
    settings.MakeFixedAxis(J.SixDOFConstraintSettings_EAxis_TranslationZ)
    settings.MakeFixedAxis(J.SixDOFConstraintSettings_EAxis_RotationY)
    settings.MakeFixedAxis(J.SixDOFConstraintSettings_EAxis_RotationZ)
    if (hasSlide) {
      settings.SetLimitedAxis(J.SixDOFConstraintSettings_EAxis_TranslationX, joltMin, joltMax)
    } else {
      settings.MakeFreeAxis(J.SixDOFConstraintSettings_EAxis_TranslationX)
    }
    settings.MakeFreeAxis(J.SixDOFConstraintSettings_EAxis_RotationX)
    this.physicsSystem.AddConstraint(settings.Create(bodyA, bodyB))
  }

  private addStaticBox(
    halfExtents: [number, number, number],
    center: [number, number, number],
    layer: number = LAYER_NON_MOVING,
  ): void {
    const J = this.Jolt
    const shape = new J.BoxShape(new J.Vec3(...halfExtents), 0.0)
    const bcs = new J.BodyCreationSettings(
      shape,
      new J.RVec3(...center),
      new J.Quat(0, 0, 0, 1),
      J.EMotionType_Static,
      layer,
    )
    bcs.mFriction = GROUND_FRICTION
    bcs.mRestitution = 0
    const body = this.bodyInterface.CreateBody(bcs)
    this.bodyInterface.AddBody(body.GetID(), J.EActivation_DontActivate)
  }

  private createGround(doc: Document): void {
    // Large static box whose top surface sits at y=0.
    this.addStaticBox([50, 0.5, 50], [0, -0.5, 0])
    const sb = doc.ground.sandbox
    if (!sb) return
    const half = sb.size / 2
    const t = sb.thickness
    // The workbench slab itself…
    this.addStaticBox([half, t / 2, half], [0, t / 2, 0])
    // …and tall invisible walls at its edge so physics can't fling pieces off
    // the bench (paused user moves bypass physics entirely).
    const wallH = 2.5
    const wallT = 0.05
    this.addStaticBox([wallT / 2, wallH / 2, half + wallT], [half + wallT / 2, wallH / 2, 0], LAYER_WALLS)
    this.addStaticBox([wallT / 2, wallH / 2, half + wallT], [-half - wallT / 2, wallH / 2, 0], LAYER_WALLS)
    this.addStaticBox([half + wallT, wallH / 2, wallT / 2], [0, wallH / 2, half + wallT / 2], LAYER_WALLS)
    this.addStaticBox([half + wallT, wallH / 2, wallT / 2], [0, wallH / 2, -half - wallT / 2], LAYER_WALLS)
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
    const mat = materials.find((m) => m.name === piece.material)
    bcs.mFriction = mat?.friction ?? FALLBACK_FRICTION
    bcs.mRestitution = Math.min(mat?.restitution ?? 0.1, MAX_RESTITUTION)
    bcs.mMaxLinearVelocity = MAX_LINEAR_VELOCITY
    bcs.mMaxAngularVelocity = MAX_ANGULAR_VELOCITY
    if (!isStatic) {
      // Realistic mass from material density × volume.
      bcs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia
      bcs.mMassPropertiesOverride.mMass = massOf(piece, materials)
    }
    const body = this.bodyInterface.CreateBody(bcs)
    this.bodyMaterials.set(body.GetID().GetIndexAndSequenceNumber(), piece.material)
    const sub = this.subGroups.size
    this.subGroups.set(piece.id, sub)
    const cg = body.GetCollisionGroup()
    cg.SetGroupFilter(this.groupFilter)
    cg.SetGroupID(0)
    cg.SetSubGroupID(sub)
    this.bodyInterface.AddBody(body.GetID(), isStatic ? J.EActivation_DontActivate : J.EActivation_Activate)
    this.bodies.set(piece.id, body.GetID())
    this.bodyObjs.set(piece.id, body)
  }

  /** Advance the simulation by a FIXED dt (callers always pass 1/60). */
  step(dt: number): void {
    this.ji.Step(dt, 1)
  }

  /** Start dragging a piece: it becomes kinematic so the pointer drives it. */
  beginGrab(pieceId: string): boolean {
    const id = this.bodies.get(pieceId)
    if (!id) return false
    const J = this.Jolt
    // Anchored pieces are static and cannot be dragged.
    if (this.bodyInterface.GetMotionType(id) === J.EMotionType_Static) return false
    this.bodyInterface.SetMotionType(id, J.EMotionType_Kinematic, J.EActivation_Activate)
    return true
  }

  /**
   * Drive a grabbed piece toward a world position over dt (keeps its rotation).
   * Approach speed is capped so a fast pointer flick doesn't ram other pieces
   * with near-infinite kinematic velocity ("everything explodes").
   */
  moveGrab(pieceId: string, pos: Vec3, dt: number): void {
    const id = this.bodies.get(pieceId)
    if (!id) return
    const J = this.Jolt
    const MAX_DRAG_SPEED = 3 // m/s — brisk but not a wrecking ball
    const cur = this.bodyInterface.GetPosition(id)
    const dx = pos[0] - cur.GetX()
    const dy = pos[1] - cur.GetY()
    const dz = pos[2] - cur.GetZ()
    const dist = Math.hypot(dx, dy, dz)
    const maxStep = MAX_DRAG_SPEED * dt
    const f = dist > maxStep ? maxStep / dist : 1
    const target = new J.RVec3(cur.GetX() + dx * f, cur.GetY() + dy * f, cur.GetZ() + dz * f)
    const rot = this.bodyInterface.GetRotation(id)
    this.bodyInterface.MoveKinematic(id, target, rot, dt)
  }

  /** Set a grabbed piece's rotation kinematically (Alt-rotate during drag). */
  rotateGrab(pieceId: string, rot: [number, number, number, number], dt: number): void {
    const id = this.bodies.get(pieceId)
    if (!id) return
    const J = this.Jolt
    const pos = this.bodyInterface.GetPosition(id)
    this.bodyInterface.MoveKinematic(
      id,
      new J.RVec3(pos.GetX(), pos.GetY(), pos.GetZ()),
      new J.Quat(rot[0], rot[1], rot[2], rot[3]),
      dt,
    )
  }

  /**
   * Environmental forces, applied once per step BEFORE stepping.
   * Wind: gusting directional force scaled by each piece's silhouette area.
   * Earthquake: horizontal frame-shake acceleration (force ∝ mass).
   */
  applyEnvironment(
    time: number,
    wind: { strength: number; angle: number } | null,
    quake: { magnitude: number } | null,
    pieces: Piece[],
    materials: Material[],
  ): void {
    if (!wind && !quake) return
    const J = this.Jolt
    let fx = 0
    let fz = 0
    if (quake) {
      // Two incommensurate frequencies + a fast wobble read as a real tremor.
      const a = quake.magnitude
      fx += a * (Math.sin(time * 13.7) + 0.5 * Math.sin(time * 31.3))
      fz += a * (Math.cos(time * 11.1) + 0.5 * Math.sin(time * 27.9 + 1.3))
    }
    let wx = 0
    let wz = 0
    if (wind) {
      const gust = 0.65 + 0.35 * Math.sin(time * 1.9) * Math.sin(time * 0.53 + 1)
      wx = Math.cos(wind.angle) * wind.strength * gust
      wz = Math.sin(wind.angle) * wind.strength * gust
    }
    for (const piece of pieces) {
      if (piece.anchored) continue
      const id = this.bodies.get(piece.id)
      if (!id) continue
      const mass = massOf(piece, materials)
      // Wind pushes on area; quake accelerates the frame (∝ mass).
      const d = piece.dimensions
      const area = Math.min(
        1.5,
        STOCK[piece.stockType].primitive === 'box'
          ? Math.max(d.x * d.y, d.y * d.z, d.x * d.z)
          : STOCK[piece.stockType].primitive === 'cylinder'
            ? d.radius * 2 * d.height
            : Math.PI * d.radius * d.radius,
      )
      const force = new J.Vec3(fx * mass + wx * area, 0, fz * mass + wz * area)
      // Wind catches pieces above their midline (real gusts TIP structures);
      // quake shakes through the center of mass. Blend: push at 1/4 height up.
      const [px, py, pz] = piece.state.transform.position
      const lift = wind ? maxHalfHeight(piece) * 0.5 : 0
      this.bodyInterface.AddForce(id, force, new J.RVec3(px, py + lift, pz), J.EActivation_Activate)
    }
  }

  // ---- Slingshot projectiles: ephemeral rocks, not part of the document. ----
  private projectiles: { bodyId: any; born: number; radius: number }[] = []

  fireProjectile(origin: Vec3, dir: Vec3, speed: number, radius: number): void {
    const J = this.Jolt
    if (this.projectiles.length >= 16) this.removeProjectile(0)
    const bcs = new J.BodyCreationSettings(
      new J.SphereShape(radius),
      new J.RVec3(origin[0], origin[1], origin[2]),
      new J.Quat(0, 0, 0, 1),
      J.EMotionType_Dynamic,
      LAYER_PROJECTILE, // flies over/through the sandbox walls
    )
    bcs.mFriction = 0.6
    bcs.mRestitution = 0.25
    bcs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia
    bcs.mMassPropertiesOverride.mMass = Math.max(0.05, 2600 * (4 / 3) * Math.PI * radius ** 3)
    const body = this.bodyInterface.CreateBody(bcs)
    this.bodyMaterials.set(body.GetID().GetIndexAndSequenceNumber(), 'rock')
    this.bodyInterface.AddBody(body.GetID(), J.EActivation_Activate)
    this.bodyInterface.SetLinearVelocity(
      body.GetID(),
      new J.Vec3(dir[0] * speed, dir[1] * speed, dir[2] * speed),
    )
    this.projectiles.push({ bodyId: body.GetID(), born: performance.now(), radius })
  }

  private removeProjectile(index: number): void {
    const p = this.projectiles[index]
    if (!p) return
    this.bodyInterface.RemoveBody(p.bodyId)
    this.bodyInterface.DestroyBody(p.bodyId)
    this.projectiles.splice(index, 1)
  }

  /** Live projectile positions+radius for rendering; expires old/fallen rocks. */
  syncProjectiles(): { x: number; y: number; z: number; r: number }[] {
    const now = performance.now()
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      const pos = this.bodyInterface.GetPosition(p.bodyId)
      if (now - p.born > 10000 || pos.GetY() < -5) this.removeProjectile(i)
    }
    return this.projectiles.map((p) => {
      const pos = this.bodyInterface.GetPosition(p.bodyId)
      return { x: pos.GetX(), y: pos.GetY(), z: pos.GetZ(), r: p.radius }
    })
  }

  /** Release a grabbed piece back to dynamic; throw velocity is clamped gently. */
  endGrab(pieceId: string): void {
    const id = this.bodies.get(pieceId)
    if (!id) return
    const J = this.Jolt
    const MAX_THROW_SPEED = 2.5
    const v = this.bodyInterface.GetLinearVelocity(id)
    const speed = Math.hypot(v.GetX(), v.GetY(), v.GetZ())
    if (speed > MAX_THROW_SPEED) {
      const k = MAX_THROW_SPEED / speed
      this.bodyInterface.SetLinearVelocity(id, new J.Vec3(v.GetX() * k, v.GetY() * k, v.GetZ() * k))
    }
    this.bodyInterface.SetMotionType(id, J.EMotionType_Dynamic, J.EActivation_Activate)
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
    if (this.contactListener && typeof (this.Jolt as any).destroy === 'function') {
      this.physicsSystem?.SetContactListener(null)
      ;(this.Jolt as any).destroy(this.contactListener)
      this.contactListener = null
    }
    if (this.ji && typeof (this.Jolt as any).destroy === 'function') {
      ;(this.Jolt as any).destroy(this.ji)
    }
    this.ji = null
    this.bodies.clear()
    this.bodyObjs.clear()
  }
}

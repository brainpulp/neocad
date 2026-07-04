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
import { localDirToWorld, localToWorld, perpendicular, quatConjugate, quatRotate } from '../document/math'
import type { Document, Fastener, Material, Piece, Rope, Vec3 } from '../document/types'

const FALLBACK_DENSITY = 1000
// Material restitution is honest data and the sim now honors it: a soft-rubber
// ball (0.85) genuinely bounces, steel (0.1) thuds. The cap only trims the
// physically-absurd top end; velocity caps below keep even that stable.
const MAX_RESTITUTION = 0.88
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
    case 'wedge':
      return (d.x * d.y * d.z) / 2
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
    case 'wedge':
      return Math.max(d.x, d.y, d.z) / 2
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

  /** Called when a rigid fastener snaps (force exceeded its bond strength). */
  private onBreak: ((fastenerId: string) => void) | null = null
  // Rigid bonds with finite strength, checked against solver impulse each step.
  // `over` counts CONSECUTIVE over-limit steps: a single solver spike (deep
  // contact resolution) must not disintegrate a build — breaking needs a
  // sustained overload, or a truly massive hit.
  private breakables: { fastenerId: string; constraint: any; strength: number; over: number }[] = []

  constructor(
    Jolt: JoltModule,
    doc: Document,
    onImpact?: ImpactCallback,
    onBreak?: (fastenerId: string) => void,
  ) {
    this.Jolt = Jolt
    this.onBreak = onBreak ?? null
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
    ps.mBaumgarte = 0.18
    this.physicsSystem.SetPhysicsSettings(ps)

    this.groupFilter = new Jolt.GroupFilterTable(doc.pieces.length)
    this.createGround(doc)
    for (const piece of doc.pieces) this.createPieceBody(piece, doc.materials)
    for (const fastener of doc.fasteners) this.createFastener(fastener, doc)
    for (const rope of doc.ropes ?? []) this.createRope(rope, doc)
    if (onImpact) this.installContactListener(onImpact)

    // Magnetism roster: magnets emit a dipole field along their long (local y)
    // axis; ferrous pieces are pulled in. Rebuilt with the world, so painting
    // a piece 'magnet' in the inspector is enough to energize it.
    for (const piece of doc.pieces) {
      const mat = doc.materials.find((m) => m.name === piece.material)
      if (!mat?.magnetic) continue
      const d = piece.dimensions
      const volume =
        STOCK[piece.stockType].primitive === 'sphere'
          ? (4 / 3) * Math.PI * d.radius ** 3
          : STOCK[piece.stockType].primitive === 'cylinder'
            ? Math.PI * d.radius * d.radius * d.height
            : (d.x ?? 0.1) * (d.y ?? 0.1) * (d.z ?? 0.1)
      this.magnetics.push({ pieceId: piece.id, kind: mat.magnetic, volume })
    }
  }

  // ---- Soft-body ropes ----
  private ropeBodies: {
    rope: Rope
    body: any
    /** Vertex count (segments+1, or segments for loops). */
    count: number
  }[] = []

  private createRope(rope: Rope, doc: Document): void {
    const J = this.Jolt
    const shared = new J.SoftBodySharedSettings()
    shared.mVertexRadius = rope.radius

    const startPiece = rope.attachStart
      ? doc.pieces.find((p) => p.id === rope.attachStart!.pieceId)
      : undefined
    const endPiece = rope.attachEnd
      ? doc.pieces.find((p) => p.id === rope.attachEnd!.pieceId)
      : undefined
    const start = startPiece
      ? localToWorld(startPiece.state.transform, rope.attachStart!.anchor)
      : rope.start
    const end = endPiece ? localToWorld(endPiece.state.transform, rope.attachEnd!.anchor) : rope.end

    const count = rope.looped ? Math.max(8, rope.segments) : rope.segments + 1
    const dist = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])
    const restLength = Math.max(0.05, dist * rope.slack)
    const mat = doc.materials.find((m) => m.name === rope.material)
    const density = mat?.density ?? 900
    const mass = Math.max(0.01, density * Math.PI * rope.radius ** 2 * restLength)
    const invMass = count / mass

    // Vertices in world space (the soft body sits at the origin).
    for (let i = 0; i < count; i++) {
      const v = new J.SoftBodySharedSettingsVertex()
      if (rope.looped) {
        // A flat loop: two strands between the endpoints, offset vertically —
        // ready to wrap around pulleys like a belt.
        const half = count / 2
        const t = i < half ? i / (half - 1) : (count - 1 - i) / (count - half)
        const off = i < half ? rope.radius * 2 : -rope.radius * 6
        v.mPosition = new J.Float3(
          start[0] + (end[0] - start[0]) * t,
          start[1] + (end[1] - start[1]) * t + off,
          start[2] + (end[2] - start[2]) * t,
        )
      } else {
        const t = i / (count - 1)
        // Seed a slight sag so slack rope settles downward, not sideways.
        const sag = rope.slack > 1.001 ? Math.sin(Math.PI * t) * dist * (rope.slack - 1) * 0.5 : 0
        v.mPosition = new J.Float3(
          start[0] + (end[0] - start[0]) * t,
          start[1] + (end[1] - start[1]) * t - sag,
          start[2] + (end[2] - start[2]) * t,
        )
      }
      // Pinned ends get infinite mass (invMass 0); they follow their attachment
      // kinematically. Must be set BEFORE push_back — emscripten arrays copy.
      const pinned =
        !rope.looped &&
        ((i === 0 && rope.attachStart) || (i === count - 1 && rope.attachEnd))
      v.mInvMass = pinned ? 0 : invMass
      shared.mVertices.push_back(v)
    }

    // Edge compliance = how much the rope STRETCHES. Real rope is inextensible
    // (compliance ≈ 0); `elasticity` opts into bungee stretch. `stiffness` is a
    // legacy knob that still firms things up. Default (elasticity 0) = a taut,
    // non-springy line.
    const elasticity = rope.elasticity ?? 0
    const compliance = 1e-7 + elasticity * 6e-3 + (1 - rope.stiffness) * 2e-4
    const link = (a: number, b: number, c: number) => {
      shared.mEdgeConstraints.push_back(new J.SoftBodySharedSettingsEdge(a, b, c))
    }
    for (let i = 0; i < count - 1; i++) link(i, i + 1, compliance)
    for (let i = 0; i < count - 2; i++) link(i, i + 2, compliance * 12)
    if (rope.looped) {
      link(count - 1, 0, compliance)
      link(count - 2, 0, compliance * 12)
      link(count - 1, 1, compliance * 12)
    }
    shared.CalculateEdgeLengths()
    shared.Optimize()

    const sbcs = new J.SoftBodyCreationSettings(
      shared,
      new J.RVec3(0, 0, 0),
      new J.Quat(0, 0, 0, 1),
      LAYER_MOVING,
    )
    // More iterations + linear damping so the rope settles instead of jiggling
    // ("wiggles") forever; an elastic rope is allowed to ring a little longer.
    sbcs.mNumIterations = 12
    sbcs.mLinearDamping = 0.5 - elasticity * 0.35
    sbcs.mFriction = mat?.friction ?? 0.6
    sbcs.mRestitution = 0.02
    const body = this.bodyInterface.CreateSoftBody(sbcs)
    this.bodyInterface.AddBody(body.GetID(), J.EActivation_Activate)
    this.ropeBodies.push({ rope, body, count })
  }

  /**
   * Per-step rope coupling: pinned ends follow their attached pieces, and the
   * end-edge tension is mirrored onto dynamic pieces so a rope can genuinely
   * HOLD something up (Jolt pins are one-way; this closes the loop).
   */
  updateRopeAttachments(doc: Document): void {
    const J = this.Jolt
    for (const { rope, body, count } of this.ropeBodies) {
      if (rope.looped) continue
      const mp = J.castObject(body.GetMotionProperties(), J.SoftBodyMotionProperties)
      // Vertex positions are RELATIVE to the soft body's (drifting) origin.
      const bp = body.GetPosition()
      const bx = bp.GetX()
      const by = bp.GetY()
      const bz = bp.GetZ()
      const ends: [number, number, Rope['attachStart']][] = [
        [0, 1, rope.attachStart],
        [count - 1, count - 2, rope.attachEnd],
      ]
      for (const [endIdx, neighborIdx, attach] of ends) {
        if (!attach) continue
        const piece = doc.pieces.find((p) => p.id === attach.pieceId)
        if (!piece) continue
        const w = localToWorld(piece.state.transform, attach.anchor)
        const v = mp.GetVertex(endIdx)
        v.mPosition = new J.Vec3(w[0] - bx, w[1] - by, w[2] - bz)
        v.mVelocity = new J.Vec3(0, 0, 0)
        if (piece.anchored) continue
        // Tension mirror: if the first edge is stretched, pull the piece
        // toward the rope with a strain-proportional force.
        const n = mp.GetVertex(neighborIdx).mPosition
        const dx = n.GetX() + bx - w[0]
        const dy = n.GetY() + by - w[1]
        const dz = n.GetZ() + bz - w[2]
        const len = Math.hypot(dx, dy, dz)
        const rest = (Math.max(0.05, // matches createRope's restLength
          Math.hypot(rope.end[0] - rope.start[0], rope.end[1] - rope.start[1], rope.end[2] - rope.start[2]) *
            rope.slack,
        ) / Math.max(1, count - 1))
        const strain = (len - rest) / rest
        if (strain <= 0 || len < 1e-6) continue
        const k = 400 * rope.stiffness * (rope.radius / 0.012) ** 2 // N per unit strain
        const f = Math.min(800, strain * k)
        const id = this.bodies.get(piece.id)
        if (!id) continue
        this.bodyInterface.AddForce(
          id,
          new J.Vec3((dx / len) * f, (dy / len) * f, (dz / len) * f),
          new J.RVec3(w[0], w[1], w[2]),
          J.EActivation_Activate,
        )
      }
    }
  }

  /** Live rope vertex positions for rendering, keyed by rope id. */
  syncRopes(): Map<string, number[]> {
    const J = this.Jolt
    const out = new Map<string, number[]>()
    for (const { rope, body, count } of this.ropeBodies) {
      const mp = J.castObject(body.GetMotionProperties(), J.SoftBodyMotionProperties)
      const bp = body.GetPosition() // vertex positions are body-relative
      const bx = bp.GetX()
      const by = bp.GetY()
      const bz = bp.GetZ()
      const pts: number[] = []
      for (let i = 0; i < count; i++) {
        const p = mp.GetVertex(i).mPosition
        pts.push(p.GetX() + bx, p.GetY() + by, p.GetZ() + bz)
      }
      out.set(rope.id, pts)
    }
    return out
  }

  /** New-contact events → material-aware impact callback (drives sound FX). */
  private installContactListener(onImpact: ImpactCallback): void {
    const J = this.Jolt as any
    const listener = new J.ContactListenerJS()
    listener.OnContactValidate = () => J.ValidateResult_AcceptAllContactsForThisBodyPair
    listener.OnContactAdded = (b1Ptr: number, b2Ptr: number) => {
      const body1 = J.wrapPointer(b1Ptr, J.Body)
      const body2 = J.wrapPointer(b2Ptr, J.Body)
      const id1 = body1.GetID().GetIndexAndSequenceNumber()
      const id2 = body2.GetID().GetIndexAndSequenceNumber()
      if (this.silentBodies.has(id1) || this.silentBodies.has(id2)) return // the pull "hand" is a sensor — no phantom knocks
      // Approach speed from PRE-step velocities: by the time this callback
      // fires the solver has already absorbed the impact (live reads ≈ 0).
      const v1 = this.preStepVel.get(id1) ?? [0, 0, 0]
      const v2 = this.preStepVel.get(id2) ?? [0, 0, 0]
      const speed = Math.hypot(v1[0] - v2[0], v1[1] - v2[1], v1[2] - v2[2])
      const matA = this.bodyMaterials.get(id1) ?? 'bench'
      const matB = this.bodyMaterials.get(id2) ?? 'bench'
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
    let kind = FASTENERS[fastener.type].constraint
    // Cylindrical DOFs are individually switchable in the joint inspector.
    if (kind === 'cylindrical') {
      const spin = fastener.canSpin ?? true
      const slide = fastener.canSlide ?? true
      if (spin && !slide) kind = 'hinge'
      else if (!spin && slide) kind = 'slider'
      else if (!spin && !slide) kind = 'fixed'
    }

    // Fastened pieces whose shapes OVERLAP at the join (a gear around its axle)
    // must not contact-collide — the constraint owns their relative motion and
    // contacts would fight it. Pieces that merely touch (a door on its post)
    // keep colliding so they can't swing through each other.
    const pa = doc.pieces.find((p) => p.id === fastener.partA)
    const pb = doc.pieces.find((p) => p.id === fastener.partB)
    if (pa && pb) {
      const da = pa.state.transform.position
      const db = pb.state.transform.position
      const dist = Math.hypot(da[0] - db[0], da[1] - db[1], da[2] - db[2])
      const overlapping = dist < (maxHalfHeight(pa) + maxHalfHeight(pb)) * 0.6
      if (overlapping) {
        const subA = this.subGroups.get(fastener.partA)
        const subB = this.subGroups.get(fastener.partB)
        if (subA != null && subB != null) this.groupFilter.DisableCollision(subA, subB)
      }
    }

    if (kind === 'fixed') {
      // Rigid bonds with a finite strength SNAP when overloaded (weld > bolt >
      // nail > glue). This build's binding exposes solver impulses only on
      // SixDOFConstraint, so breakable bonds compile to an all-axes-fixed
      // 6-DOF (identical behavior to a FixedConstraint). A locked cylindrical
      // joint compiles here too but has no bond strength — plain fixed.
      const strength = fastener.strength ?? FASTENERS[fastener.type].strength
      if (strength != null && Number.isFinite(strength)) {
        const settings = new J.SixDOFConstraintSettings()
        settings.mSpace = J.EConstraintSpace_WorldSpace
        const pa2 = doc.pieces.find((p) => p.id === fastener.partA)
        const pb2 = doc.pieces.find((p) => p.id === fastener.partB)
        const mid: Vec3 = pa2 && pb2
          ? [
              (pa2.state.transform.position[0] + pb2.state.transform.position[0]) / 2,
              (pa2.state.transform.position[1] + pb2.state.transform.position[1]) / 2,
              (pa2.state.transform.position[2] + pb2.state.transform.position[2]) / 2,
            ]
          : [0, 0, 0]
        settings.mPosition1 = new J.RVec3(mid[0], mid[1], mid[2])
        settings.mPosition2 = new J.RVec3(mid[0], mid[1], mid[2])
        for (const axis of [
          J.SixDOFConstraintSettings_EAxis_TranslationX,
          J.SixDOFConstraintSettings_EAxis_TranslationY,
          J.SixDOFConstraintSettings_EAxis_TranslationZ,
          J.SixDOFConstraintSettings_EAxis_RotationX,
          J.SixDOFConstraintSettings_EAxis_RotationY,
          J.SixDOFConstraintSettings_EAxis_RotationZ,
        ]) {
          settings.MakeFixedAxis(axis)
        }
        const constraint = settings.Create(bodyA, bodyB)
        this.physicsSystem.AddConstraint(constraint)
        this.breakables.push({ fastenerId: fastener.id, constraint, strength, over: 0 })
        return
      }
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
      settings.mNumVelocityStepsOverride = 12
      settings.mNumPositionStepsOverride = 4
      settings.mSpace = J.EConstraintSpace_WorldSpace
      settings.mPoint1 = rvA
      settings.mPoint2 = rvB
      settings.mHingeAxis1 = vAxis
      settings.mHingeAxis2 = vAxis
      settings.mNormalAxis1 = vNormal
      settings.mNormalAxis2 = vNormal
      if (fastener.angleMin != null && fastener.angleMax != null) {
        // Swing limits (e.g. a gate that only opens 90 deg).
        settings.mLimitsMin = fastener.angleMin
        settings.mLimitsMax = fastener.angleMax
      }
      const constraint = settings.Create(bodyA, bodyB)
      this.physicsSystem.AddConstraint(constraint)
      const motor = fastener.motor
      if (motor?.enabled) {
        const hinge = J.castObject(constraint, J.HingeConstraint)
        const ms = hinge.GetMotorSettings()
        ms.mMaxTorqueLimit = motor.maxForce
        ms.mMinTorqueLimit = -motor.maxForce
        hinge.SetMotorState(J.EMotorState_Velocity)
        hinge.SetTargetAngularVelocity(motor.velocity)
        // A driven joint must keep its bodies awake.
        this.bodyInterface.ActivateBody(bodyA.GetID())
        this.bodyInterface.ActivateBody(bodyB.GetID())
      }
      return
    }

    // Document slide limits describe motion of A's anchor along the axis; Jolt
    // measures body 2 relative to body 1, so the interval negates and swaps.
    const hasSlide = fastener.slideMin != null && fastener.slideMax != null
    const joltMin = hasSlide ? -fastener.slideMax! : 0
    const joltMax = hasSlide ? -fastener.slideMin! : 0

    if (kind === 'slider') {
      const settings = new J.SliderConstraintSettings()
      settings.mNumVelocityStepsOverride = 12
      settings.mNumPositionStepsOverride = 4
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
      const constraint = settings.Create(bodyA, bodyB)
      this.physicsSystem.AddConstraint(constraint)
      const motor = fastener.motor
      if (motor?.enabled) {
        const slider = J.castObject(constraint, J.SliderConstraint)
        const ms = slider.GetMotorSettings()
        ms.mMaxForceLimit = motor.maxForce
        ms.mMinForceLimit = -motor.maxForce
        slider.SetMotorState(J.EMotorState_Velocity)
        // Document velocity describes part A's motion; Jolt drives body2 vs
        // body1, so the sign flips (same convention as the slide limits).
        slider.SetTargetVelocity(-motor.velocity)
        this.bodyInterface.ActivateBody(bodyA.GetID())
        this.bodyInterface.ActivateBody(bodyB.GetID())
      }
      return
    }

    if (kind === 'distance') {
      // Spring: an elastic tether between the two anchors.
      const settings = new J.DistanceConstraintSettings()
      settings.mSpace = J.EConstraintSpace_WorldSpace
      settings.mPoint1 = rvA
      settings.mPoint2 = rvB
      const rest = fastener.spring?.restLength ?? Math.hypot(
        worldB[0] - worldA[0],
        worldB[1] - worldA[1],
        worldB[2] - worldA[2],
      )
      settings.mMinDistance = Math.max(0.01, rest)
      settings.mMaxDistance = Math.max(0.01, rest)
      const ss = settings.mLimitsSpringSettings
      ss.mFrequency = fastener.spring?.frequency ?? 3
      ss.mDamping = fastener.spring?.damping ?? 0.2
      this.physicsSystem.AddConstraint(settings.Create(bodyA, bodyB))
      return
    }

    // cylindrical: rotate around AND slide along the same axis. Jolt has no
    // dedicated constraint, so use a 6-DOF with the joint axis as constraint-X
    // and free translation-X + rotation-X.
    const settings = new J.SixDOFConstraintSettings()
    settings.mNumVelocityStepsOverride = 12
    settings.mNumPositionStepsOverride = 4
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

  // Body velocities captured BEFORE each step: Jolt's OnContactAdded fires
  // after the solver has already killed the closing velocity, so reading
  // live velocities in the callback reports ~0 for every impact (silent).
  private preStepVel = new Map<number, [number, number, number]>()

  // ---- Magnetism: magnets pull ferrous pieces and attract/repel each other
  // by pole orientation (point-dipole model, softened and force-capped). ----
  private magnetics: { pieceId: string; kind: 'magnet' | 'ferrous'; volume: number }[] = []

  private applyMagnets(): void {
    if (this.magnetics.length === 0) return
    const J = this.Jolt
    const RANGE = 2 // m — beyond this the field is negligible
    const FMAX = 260 // N per pair — snappy pickup, no explosions
    // Live poses.
    const live = this.magnetics
      .map((m) => {
        const id = this.bodies.get(m.pieceId)
        if (!id) return null
        const p = this.bodyInterface.GetPosition(id)
        const r = this.bodyInterface.GetRotation(id)
        const axis = quatRotate([r.GetX(), r.GetY(), r.GetZ(), r.GetW()], [0, 1, 0])
        return { ...m, id, pos: [p.GetX(), p.GetY(), p.GetZ()] as Vec3, axis }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
    const push = (id: any, f: Vec3, at: Vec3) => {
      this.bodyInterface.AddForce(
        id,
        new J.Vec3(f[0], f[1], f[2]),
        new J.RVec3(at[0], at[1], at[2]),
        J.EActivation_Activate,
      )
    }
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const A = live[i]
        const B = live[j]
        if (A.kind === 'ferrous' && B.kind === 'ferrous') continue // no field between them
        const r: Vec3 = [B.pos[0] - A.pos[0], B.pos[1] - A.pos[1], B.pos[2] - A.pos[2]]
        const dist = Math.hypot(r[0], r[1], r[2])
        if (dist > RANGE || dist < 1e-6) continue
        const d2 = dist * dist + 0.02 // softened so contact never divides by ~0
        const rn: Vec3 = [r[0] / dist, r[1] / dist, r[2] / dist]
        let f: Vec3
        if (A.kind === 'magnet' && B.kind === 'magnet') {
          // Point-dipole force: real attract/repel behavior — flip one magnet
          // and the pair repels. m ∝ volume, along each magnet's local y pole.
          const DIPOLE_K = 1.6e6
          const m1 = A.axis.map((v) => v * A.volume) as Vec3
          const m2 = B.axis.map((v) => v * B.volume) as Vec3
          const d1 = m1[0] * rn[0] + m1[1] * rn[1] + m1[2] * rn[2]
          const d12 = m1[0] * m2[0] + m1[1] * m2[1] + m1[2] * m2[2]
          const dd2 = m2[0] * rn[0] + m2[1] * rn[1] + m2[2] * rn[2]
          const k = DIPOLE_K / (d2 * d2)
          f = [
            k * (d1 * m2[0] + dd2 * m1[0] + d12 * rn[0] - 5 * d1 * dd2 * rn[0]),
            k * (d1 * m2[1] + dd2 * m1[1] + d12 * rn[1] - 5 * d1 * dd2 * rn[1]),
            k * (d1 * m2[2] + dd2 * m1[2] + d12 * rn[2] - 5 * d1 * dd2 * rn[2]),
          ]
        } else {
          // Magnet ↔ ferrous: induced attraction, always toward the magnet.
          // Tuned for PLAY: a hand-sized magnet visibly grabs steel from ~1 m
          // (the force cap keeps close-range snaps from exploding).
          const FERROUS_K = 3.5e5
          const s = (FERROUS_K * A.volume * B.volume) / d2
          f = [rn[0] * s, rn[1] * s, rn[2] * s] // pulls B toward... sign below
          // Attraction: force on B points toward A (−rn), reaction on A +rn.
          f = [-f[0], -f[1], -f[2]]
        }
        const mag = Math.hypot(f[0], f[1], f[2])
        if (mag > FMAX) {
          const s = FMAX / mag
          f = [f[0] * s, f[1] * s, f[2] * s]
        }
        // f is the force ON B; equal and opposite on A.
        push(B.id, f, B.pos)
        push(A.id, [-f[0], -f[1], -f[2]], A.pos)
      }
    }
  }

  /** Set a piece's linear velocity directly (shove tools, tests). */
  setPieceVelocity(pieceId: string, v: Vec3): void {
    const id = this.bodies.get(pieceId)
    if (!id) return
    const J = this.Jolt
    this.bodyInterface.SetLinearVelocity(id, new J.Vec3(v[0], v[1], v[2]))
    this.bodyInterface.ActivateBody(id)
  }

  /** Advance the simulation by a FIXED dt (callers always pass 1/60). */
  step(dt: number): void {
    this.applyMagnets()
    if (this.contactListener) {
      this.preStepVel.clear()
      for (const id of this.bodies.values()) {
        const v = this.bodyInterface.GetLinearVelocity(id)
        this.preStepVel.set(id.GetIndexAndSequenceNumber(), [v.GetX(), v.GetY(), v.GetZ()])
      }
      for (const pr of this.projectiles) {
        const v = this.bodyInterface.GetLinearVelocity(pr.bodyId)
        this.preStepVel.set(pr.bodyId.GetIndexAndSequenceNumber(), [v.GetX(), v.GetY(), v.GetZ()])
      }
    }
    this.ji.Step(dt, 1)
    this.checkBreakables(dt)
  }

  /** Snap any rigid bond whose solver impulse exceeded its strength this step. */
  private checkBreakables(dt: number): void {
    if (this.breakables.length === 0) return
    const J = this.Jolt
    for (let i = this.breakables.length - 1; i >= 0; i--) {
      const b = this.breakables[i]
      const fixed = J.castObject(b.constraint, J.SixDOFConstraint)
      const lam = fixed.GetTotalLambdaPosition()
      const force = Math.hypot(lam.GetX(), lam.GetY(), lam.GetZ()) / dt
      b.over = force > b.strength ? b.over + 1 : 0
      // Sustained overload (~100 ms) or a hit far past the rating.
      if (b.over >= 6 || force > b.strength * 3) {
        this.physicsSystem.RemoveConstraint(b.constraint)
        this.breakables.splice(i, 1)
        this.onBreak?.(b.fastenerId)
      }
    }
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
      const prim = STOCK[piece.stockType].primitive
      const area = Math.min(
        1.5,
        prim === 'box' || prim === 'wedge'
          ? Math.max(d.x * d.y, d.y * d.z, d.x * d.z)
          : prim === 'cylinder'
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

  /**
   * Blower tool: a concentrated cone of wind along the cursor ray. Force fades
   * with angle off the axis and with distance, and pushes above each piece's
   * midline (like ambient wind) so a focused blast can tip things over.
   */
  applyBlower(origin: Vec3, dir: Vec3, strength: number, pieces: Piece[]): void {
    const J = this.Jolt
    const CONE_TAN = 0.35 // ~19° half-angle
    for (const piece of pieces) {
      if (piece.anchored) continue
      const id = this.bodies.get(piece.id)
      if (!id) continue
      const [px, py, pz] = piece.state.transform.position
      const rx = px - origin[0]
      const ry = py - origin[1]
      const rz = pz - origin[2]
      const t = rx * dir[0] + ry * dir[1] + rz * dir[2]
      if (t <= 0.05) continue // behind the nozzle
      const radial = Math.hypot(rx - dir[0] * t, ry - dir[1] * t, rz - dir[2] * t)
      // The piece's own size widens the effective cone so grazing hits count.
      const reach = t * CONE_TAN + maxHalfHeight(piece)
      if (radial > reach) continue
      // Gentle distance fade: the nozzle is usually the CAMERA, 4–8 m out, so a
      // steep t² falloff would make the tool feel dead at normal zoom.
      const falloff = (1 - radial / reach) / (1 + 0.02 * t * t)
      const f = strength * falloff
      const lift = maxHalfHeight(piece) * 0.5
      this.bodyInterface.AddForce(
        id,
        new J.Vec3(dir[0] * f, dir[1] * f, dir[2] * f),
        new J.RVec3(px, py + lift, pz),
        J.EActivation_Activate,
      )
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

  /** Live projectile poses+radius for rendering; expires old/fallen rocks. */
  syncProjectiles(): { x: number; y: number; z: number; r: number; q: [number, number, number, number] }[] {
    const now = performance.now()
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      const pos = this.bodyInterface.GetPosition(p.bodyId)
      if (now - p.born > 10000 || pos.GetY() < -5) this.removeProjectile(i)
    }
    return this.projectiles.map((p) => {
      const pos = this.bodyInterface.GetPosition(p.bodyId)
      const rot = this.bodyInterface.GetRotation(p.bodyId)
      return {
        x: pos.GetX(),
        y: pos.GetY(),
        z: pos.GetZ(),
        r: p.radius,
        q: [rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW()],
      }
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

  // ---- Pull-drag: a spring at the exact grabbed point. The piece stays fully
  // dynamic, so it dangles, pivots and drags under its own weight — mass is
  // FELT through the interaction instead of just displayed. ----
  // The pull is a "mouse joint": a kinematic sensor HAND body point-constrained
  // to the piece at the grabbed spot. The constraint solver handles effective
  // mass exactly (hand-rolled point impulses go unstable at long lever arms),
  // so the piece dangles and pivots under its own weight. Weight is FELT via
  // a mass-scaled tow speed: a cork block zips, a granite slab crawls.
  private pull: {
    pieceId: string
    local: Vec3
    hand: any
    constraint: any
    prevAngularDamping: number
    towCap: number
    /** Max distance the hand may lead the grab point (bounds spring force). */
    leash: number
  } | null = null
  // Bodies whose contacts should stay silent (the hand is a sensor but still
  // reports contacts to the listener).
  private silentBodies = new Set<number>()

  private makePull(pieceId: string, local: Vec3): boolean {
    const id = this.bodies.get(pieceId)
    const body = this.bodyObjs.get(pieceId)
    if (!id || !body) return false
    const J = this.Jolt
    if (this.bodyInterface.GetMotionType(id) === J.EMotionType_Static) return false
    this.endPull()
    const pos = this.bodyInterface.GetPosition(id)
    const rot = this.bodyInterface.GetRotation(id)
    const rel = quatRotate([rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW()], local)
    const gx = pos.GetX() + rel[0]
    const gy = pos.GetY() + rel[1]
    const gz = pos.GetZ() + rel[2]
    const bcs = new J.BodyCreationSettings(
      new J.SphereShape(0.01),
      new J.RVec3(gx, gy, gz),
      new J.Quat(0, 0, 0, 1),
      J.EMotionType_Kinematic,
      LAYER_MOVING,
    )
    bcs.mIsSensor = true // no collision response — it is just an anchor
    const hand = this.bodyInterface.CreateBody(bcs)
    this.silentBodies.add(hand.GetID().GetIndexAndSequenceNumber())
    this.bodyInterface.AddBody(hand.GetID(), J.EActivation_Activate)
    // A SOFT tether (spring-backed zero-length distance constraint), not a
    // rigid point constraint: rigid pulls generate unbounded force when the
    // towed piece jams against the bench or another piece — enough to rip
    // fasteners apart and catapult pieces across the scene.
    const pcs = new J.DistanceConstraintSettings()
    pcs.mSpace = J.EConstraintSpace_WorldSpace
    pcs.mPoint1 = new J.RVec3(gx, gy, gz)
    pcs.mPoint2 = new J.RVec3(gx, gy, gz)
    pcs.mMinDistance = 0
    pcs.mMaxDistance = 0
    const mp = body.GetMotionProperties()
    const mass = 1 / Math.max(1e-6, mp.GetInverseMass())
    // A TIGHT critically-damped spring (~40 ms settle): pieces track the
    // cursor closely instead of trailing half a screen behind. (A constant-
    // stiffness spring was tried for mass feel — heavy slabs turned into
    // freight trains that overshot the cursor; mass-scaled stiffness is the
    // well-behaved regime, and mass is felt through the SPEED budget below.)
    const ss = pcs.mLimitsSpringSettings
    ss.mFrequency = 8
    ss.mDamping = 1
    const constraint = pcs.Create(hand, body)
    this.physicsSystem.AddConstraint(constraint)
    const prevAngularDamping = mp.GetAngularDamping()
    // Carried pieces settle into a dangle instead of pendulum-swinging forever.
    mp.SetAngularDamping(1.5)
    // ~240 kg·m/s of towing effort: cork moves at mouse speed, a granite slab
    // visibly crawls. (The old 60/mass with a 4 m/s ceiling made EVERYTHING
    // trail the cursor identically — steel felt the same as cork.)
    const towCap = Math.min(25, Math.max(1.2, 240 / mass))
    // Bound the spring force to ~4.5 kN regardless of mass: the hand may only
    // lead the grab point by what the spring turns into that force, so a
    // jammed piece can't have its fasteners silently ripped out by the pull.
    const k = mass * (2 * Math.PI * 8) ** 2
    const leash = Math.min(0.25, 4500 / k)
    this.pull = { pieceId, local, hand, constraint, prevAngularDamping, towCap, leash }
    this.bodyInterface.ActivateBody(id)
    return true
  }

  /**
   * Start a pull at a world point on the piece. Returns the grab point in
   * piece-local space (callers keep it to survive world rebuilds), or null if
   * the piece can't be pulled (anchored/static).
   */
  beginPull(pieceId: string, worldPoint: Vec3): Vec3 | null {
    const id = this.bodies.get(pieceId)
    if (!id) return null
    if (this.bodyInterface.GetMotionType(id) === this.Jolt.EMotionType_Static) return null
    const pos = this.bodyInterface.GetPosition(id)
    const rot = this.bodyInterface.GetRotation(id)
    const local = quatRotate(quatConjugate([rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW()]), [
      worldPoint[0] - pos.GetX(),
      worldPoint[1] - pos.GetY(),
      worldPoint[2] - pos.GetZ(),
    ])
    return this.makePull(pieceId, local) ? local : null
  }

  /** Re-attach a pull after a world rebuild (same piece-local grab point). */
  beginPullLocal(pieceId: string, local: Vec3): boolean {
    return this.makePull(pieceId, local)
  }

  /**
   * Tow the hand toward `target`, once per frame BEFORE stepping. The point
   * constraint drags the piece behind it; the hand's speed cap is where the
   * mass-feel comes from.
   */
  applyPull(target: Vec3, dt: number): void {
    if (!this.pull) return
    const J = this.Jolt
    const handId = this.pull.hand.GetID()
    const cur = this.bodyInterface.GetPosition(handId)
    const dx = target[0] - cur.GetX()
    const dy = target[1] - cur.GetY()
    const dz = target[2] - cur.GetZ()
    const dist = Math.hypot(dx, dy, dz)
    const maxStep = this.pull.towCap * dt
    const f = dist > maxStep ? maxStep / dist : 1
    let hx = cur.GetX() + dx * f
    let hy = cur.GetY() + dy * f
    let hz = cur.GetZ() + dz * f
    // LEASH: the hand never leads the actual grab point by more than the
    // stored per-piece leash, so the spring force stays bounded (~4.5 kN).
    // Without it a fast hand + jammed piece stretches the spring without
    // limit — the silent fastener-ripper soft pulls were introduced to stop.
    const LEASH = this.pull.leash
    const id = this.bodies.get(this.pull.pieceId)
    if (id) {
      const pos = this.bodyInterface.GetPosition(id)
      const rot = this.bodyInterface.GetRotation(id)
      const rel = quatRotate(
        [rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW()],
        this.pull.local,
      )
      const grabX = pos.GetX() + rel[0]
      const grabY = pos.GetY() + rel[1]
      const grabZ = pos.GetZ() + rel[2]
      const lx = hx - grabX
      const ly = hy - grabY
      const lz = hz - grabZ
      const lead = Math.hypot(lx, ly, lz)
      if (lead > LEASH) {
        const s = LEASH / lead
        hx = grabX + lx * s
        hy = grabY + ly * s
        hz = grabZ + lz * s
      }
    }
    this.bodyInterface.MoveKinematic(handId, new J.RVec3(hx, hy, hz), new J.Quat(0, 0, 0, 1), dt)
    if (id) this.bodyInterface.ActivateBody(id)
  }

  /** Spin the pulled piece (Alt-rotate while pulling): direct angular velocity. */
  spinPull(axis: Vec3, speed: number): void {
    if (!this.pull) return
    const id = this.bodies.get(this.pull.pieceId)
    if (!id) return
    const J = this.Jolt
    const s = Math.max(-8, Math.min(8, speed)) // hand-spin, not a lathe
    this.bodyInterface.SetAngularVelocity(id, new J.Vec3(axis[0] * s, axis[1] * s, axis[2] * s))
  }

  /** Release the pull: drop the constraint + hand, clamp the exit velocity. */
  endPull(): void {
    const p = this.pull
    this.pull = null
    if (!p) return
    const J = this.Jolt
    this.physicsSystem.RemoveConstraint(p.constraint)
    const handId = p.hand.GetID()
    this.silentBodies.delete(handId.GetIndexAndSequenceNumber())
    this.bodyInterface.RemoveBody(handId)
    this.bodyInterface.DestroyBody(handId)
    const id = this.bodies.get(p.pieceId)
    if (!id) return
    const body = this.bodyObjs.get(p.pieceId)
    body?.GetMotionProperties().SetAngularDamping(p.prevAngularDamping)
    const MAX_THROW_SPEED = 3
    const v = this.bodyInterface.GetLinearVelocity(id)
    const speed = Math.hypot(v.GetX(), v.GetY(), v.GetZ())
    if (speed > MAX_THROW_SPEED) {
      const k = MAX_THROW_SPEED / speed
      this.bodyInterface.SetLinearVelocity(id, new J.Vec3(v.GetX() * k, v.GetY() * k, v.GetZ() * k))
    }
    // Also cap the exit SPIN — a released piece pinwheeling at the angular cap
    // rolls itself right off the bench.
    const MAX_THROW_SPIN = 6
    const w = this.bodyInterface.GetAngularVelocity(id)
    const spin = Math.hypot(w.GetX(), w.GetY(), w.GetZ())
    if (spin > MAX_THROW_SPIN) {
      const k = MAX_THROW_SPIN / spin
      this.bodyInterface.SetAngularVelocity(id, new J.Vec3(w.GetX() * k, w.GetY() * k, w.GetZ() * k))
    }
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
    this.ropeBodies = []
  }
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { GizmoHelper, GizmoViewcube, Grid, OrbitControls } from '@react-three/drei'
import { DoubleSide, Group, IcosahedronGeometry, Quaternion, Vector3, type BufferGeometry, type Mesh } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { initJolt, type JoltModule } from '../physics/jolt'
import { PhysicsWorld } from '../physics/integration'
import { PieceMesh } from './PieceMesh'
import { useDocStore, useStoreApi } from '../ui/storeContext'
import { HeldPiece } from './HeldPiece'
import { FastenerMarker } from './FastenerMarker'
import { FeatureMarker } from './FeatureMarker'
import { ResizeHandles } from './ResizeHandles'
import { RotateRing } from './RotateRing'
import { JointEditor } from './JointEditor'
import { localDirToWorld, localToWorld, worldToLocal } from '../document/math'
import { isJointType, type Vec3 } from '../document/types'
import { maxExtent } from './geometry'
import { playImpact } from '../audio/impacts'

const FIXED_DT = 1 / 60
const UP = new Vector3(0, 1, 0)
const ROPE_DIR = new Vector3()
const BLOW_DIR = new Vector3()

/**
 * Stable key describing the physics-relevant structure; the world rebuilds when it
 * changes. Includes dimensions + material because they change a body's shape/mass.
 */
function structureKey(doc: import('../document/types').Document): string {
  const pieces = doc.pieces
    .map((p) => `${p.id}:${p.anchored ? 1 : 0}:${p.material}:${Object.values(p.dimensions).join(',')}`)
    .join('|')
  const fasteners = doc.fasteners.map((f) => f.id).join('|')
  const ropes = (doc.ropes ?? [])
    .map(
      (r) =>
        `${r.id}:${r.segments},${r.radius},${r.slack},${r.stiffness},${r.elasticity ?? 0},${
          r.looped ? 1 : 0
        },${r.attachStart?.pieceId ?? ''},${r.attachEnd?.pieceId ?? ''}`,
    )
    .join('|')
  const sb = doc.ground.sandbox
  return `${pieces}#${fasteners}#r:${ropes}#sb:${sb ? `${sb.size},${sb.thickness}` : 'none'}`
}

/** Param along a line (origin, unit dir) closest to a pointer ray. */
function lineParam(origin: Vector3, dir: Vector3, rayOrigin: Vector3, rayDir: Vector3): number | null {
  const b = dir.dot(rayDir)
  const denom = 1 - b * b
  if (Math.abs(denom) < 1e-6) return null
  const w = origin.clone().sub(rayOrigin)
  return (b * rayDir.dot(w) - dir.dot(w)) / denom
}

// Ten pre-jittered rock shapes the slingshot cycles through. Vertex offsets are
// hashed from position so shared vertices deform identically (no cracks).
let rockGeos: BufferGeometry[] | null = null
function rockGeometries(): BufferGeometry[] {
  if (rockGeos) return rockGeos
  rockGeos = []
  for (let i = 0; i < 10; i++) {
    const geo = new IcosahedronGeometry(1, 1)
    const pos = geo.getAttribute('position')
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v)
      const y = pos.getY(v)
      const z = pos.getZ(v)
      const h = Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + i * 3.7) * 43758.5453) % 1
      const s = 0.72 + h * 0.55
      pos.setXYZ(
        v,
        x * s * (0.85 + 0.25 * Math.abs(Math.sin(i * 1.3 + 1))),
        y * s,
        z * s * (0.85 + 0.25 * Math.abs(Math.cos(i * 0.7 + 2))),
      )
    }
    geo.computeVertexNormals()
    rockGeos.push(geo)
  }
  return rockGeos
}

interface DragState {
  id: string
  /**
   * 'pull' (default): a spring at the clicked point — the piece dangles and
   * pivots under its own weight. 'carry' (Ctrl/Cmd): the old rigid kinematic
   * grab for precise placement.
   */
  mode: 'pull' | 'carry'
  /** Pull: grab point in piece-local space (survives world rebuilds). */
  grabLocal?: Vec3
  /** Pointer-hit offset from the piece center at grab time (XZ). */
  offX: number
  offZ: number
  /** The piece keeps this height while dragged across the canvas. */
  centerY: number
  /** Height of the invisible drag plane (where the pointer grabbed). */
  planeY: number
  /** planeY − centerY, kept constant when shift-lifting rebases the plane. */
  grabOffY: number
  target: Vec3
  /** Alt-rotate: desired orientation, driven by horizontal pointer motion. */
  rotQuat: Quaternion
}

interface PausedDrag {
  id: string
  /**
   * free = ground-plane move; slide/swing = constrained to the piece's joint;
   * assembly (Ctrl/Cmd) = the whole fastened group moves rigidly together.
   */
  mode: 'free' | 'slide' | 'swing' | 'assembly'
  offX: number
  offZ: number
  centerY: number
  planeY: number
  grabOffY: number
  axis?: Vector3
  startParam?: number
  startPos?: Vector3
  minD?: number
  maxD?: number
  anchor?: Vector3
  startVec?: Vector3
  quat0?: Quaternion
  center0?: Vector3
  /** Assembly mode: every connected piece and where it started. */
  group?: { id: string; start: Vector3 }[]
}

/** All pieces transitively connected to `rootId` through fasteners (incl. root). */
function connectedGroup(doc: import('../document/types').Document, rootId: string): string[] {
  const adj = new Map<string, string[]>()
  for (const f of doc.fasteners) {
    adj.set(f.partA, [...(adj.get(f.partA) ?? []), f.partB])
    adj.set(f.partB, [...(adj.get(f.partB) ?? []), f.partA])
  }
  const seen = new Set<string>([rootId])
  const queue = [rootId]
  while (queue.length) {
    for (const next of adj.get(queue.pop()!) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return [...seen]
}

function Sim({ Jolt }: { Jolt: JoltModule }) {
  const store = useStoreApi()
  const doc = useDocStore((s) => s.doc)
  const worldEpoch = useDocStore((s) => s.worldEpoch)
  const selectedId = useDocStore((s) => s.selectedId)
  const selectedIds = useDocStore((s) => s.selectedIds)
  const proximityTarget = useDocStore((s) => s.proximityTarget)
  const running = useDocStore((s) => s.running)
  const tool = useDocStore((s) => s.tool)
  const jointA = useDocStore((s) => s.jointA)
  const jointHover = useDocStore((s) => s.jointHover)
  const selectedRopeId = useDocStore((s) => s.selectedRopeId)
  const ropeStart = useDocStore((s) => s.ropeStart)
  const camera = useThree((s) => s.camera)
  const worldRef = useRef<PhysicsWorld | null>(null)
  const meshes = useRef(new Map<string, Mesh>())
  const drag = useRef<DragState | null>(null)
  const pausedDrag = useRef<PausedDrag | null>(null)

  // Camera-right, flattened to the ground plane (Alt+Shift tilt axis).
  const horizontalRight = () => {
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    right.y = 0
    return right.lengthSq() < 1e-6 ? new Vector3(1, 0, 0) : right.normalize()
  }

  // Slingshot: Space fires a rock from the camera TOWARD THE CURSOR while the
  // sim runs. Pointer NDC is tracked on the canvas so aiming is just pointing.
  const gl = useThree((s) => s.gl)
  const pointerNdc = useRef<[number, number]>([0, 0])
  useEffect(() => {
    const el = gl.domElement
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      pointerNdc.current = [
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      ]
    }
    el.addEventListener('pointermove', onMove)
    return () => el.removeEventListener('pointermove', onMove)
  }, [gl])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const el = e.target as Element | null
      if (el && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName ?? '')) return
      const s = store.getState()
      if (!s.running) return
      e.preventDefault()
      const [nx, ny] = pointerNdc.current
      const dir = new Vector3(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize()
      const o = camera.position.clone().addScaledVector(dir, 0.3)
      worldRef.current?.fireProjectile(
        [o.x, o.y, o.z],
        [dir.x, dir.y, dir.z],
        s.env.rockSpeed,
        s.env.rockRadius,
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera, store])
  const key = `${structureKey(doc)}#${worldEpoch}`
  // The key the live world was built from. When the doc changes, the world is
  // stale until the rebuild effect runs — the frame loop must NOT step or sync
  // a stale world, or old body poses clobber freshly written aligned states
  // (the "joints feel like springs" bug).
  const builtKey = useRef('')

  // (Re)build the Jolt world whenever the structure changes. Full rebuild is fine
  // for M1 (small scenes); incremental add/remove is a later-milestone optimization.
  useEffect(() => {
    worldRef.current?.dispose()
    worldRef.current = new PhysicsWorld(Jolt, store.getState().doc, (matA, matB, speed) => {
      if (import.meta.env.DEV) {
        const w = window as unknown as Record<string, number>
        w.__impactCount = (w.__impactCount ?? 0) + 1
      }
      const s = store.getState()
      if (!s.soundOn || !s.running) return
      playImpact(matA, speed)
      playImpact(matB, speed * 0.8) // usually throttled away; adds body on hard hits
    }, (fastenerId) => {
      // A bond snapped: drop it from the document (no undo) with a sharp crack.
      const s = store.getState()
      if (s.soundOn) playImpact('wood', 9)
      s.breakFastener(fastenerId)
    })
    // A drag can survive a rebuild (e.g. Alt-duplicate adds a piece mid-drag):
    // re-grab the same piece in the fresh world, otherwise drop the drag.
    if (drag.current) {
      const d = drag.current
      const ok =
        d.mode === 'pull'
          ? worldRef.current.beginPullLocal(d.id, d.grabLocal ?? [0, 0, 0])
          : worldRef.current.beginGrab(d.id)
      if (!ok) {
        drag.current = null
        store.getState().setDraggingId(null)
      }
    }
    if (pausedDrag.current && !store.getState().doc.pieces.some((p) => p.id === pausedDrag.current?.id)) {
      pausedDrag.current = null
      store.getState().setDraggingId(null)
    }
    builtKey.current = key
    return () => {
      worldRef.current?.dispose()
      worldRef.current = null
    }
  }, [Jolt, store, key])

  // While paused with the transform tool, direct manipulation owns the selected
  // mesh's transform; the frame loop must not overwrite it.
  const gizmoActive = !running && tool === 'transform' && !!selectedId
  const gizmoMesh = gizmoActive && selectedId ? meshes.current.get(selectedId) : undefined
  const selectedPiece = selectedId ? doc.pieces.find((p) => p.id === selectedId) : undefined

  const simTime = useRef(0)
  const projectileMeshes = useRef<(Mesh | null)[]>([])
  const shakeOffset = useRef(new Vector3())
  const ropeGroups = useRef(new Map<string, Group>())

  // Blower tool: hold LMB to blow a cone of wind along the cursor ray.
  const blow = useRef<{ origin: Vector3; dir: Vector3; point: Vector3 } | null>(null)
  const blowCone = useRef<Mesh>(null)
  const startBlow = (e: import('@react-three/fiber').ThreeEvent<PointerEvent>) => {
    blow.current = { origin: e.ray.origin.clone(), dir: e.ray.direction.clone(), point: e.point.clone() }
    store.getState().setDraggingId('__blower') // disables orbit while blowing
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const moveBlow = (e: import('@react-three/fiber').ThreeEvent<PointerEvent>) => {
    const b = blow.current
    if (!b) return
    b.origin.copy(e.ray.origin)
    b.dir.copy(e.ray.direction)
    b.point.copy(e.point)
  }
  const endBlow = () => {
    if (!blow.current) return
    blow.current = null
    if (store.getState().draggingId === '__blower') store.getState().setDraggingId(null)
  }

  // Marquee select: while paused with the Move tool, SHIFT+drag on empty
  // ground sweeps a rectangle; pieces whose centers fall inside are selected.
  // The catcher plane only mounts while Shift is held so plain clicks/orbits
  // keep their behavior (incl. click-on-nothing deselect).
  const [shiftDown, setShiftDown] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === 'Shift' && setShiftDown(true)
    const up = (e: KeyboardEvent) => e.key === 'Shift' && setShiftDown(false)
    const blur = () => setShiftDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  const marqueeStart = useRef<{ x0: number; y0: number } | null>(null)
  const marqueeMove = (e: import('@react-three/fiber').ThreeEvent<PointerEvent>) => {
    const m = marqueeStart.current
    if (!m) return
    const x1 = e.nativeEvent.clientX
    const y1 = e.nativeEvent.clientY
    const st = store.getState()
    st.setMarquee({ x0: m.x0, y0: m.y0, x1, y1 })
    const rect = gl.domElement.getBoundingClientRect()
    const lox = Math.min(m.x0, x1)
    const hix = Math.max(m.x0, x1)
    const loy = Math.min(m.y0, y1)
    const hiy = Math.max(m.y0, y1)
    const v = new Vector3()
    st.selectMany(
      st.doc.pieces
        .filter((p) => {
          v.set(...p.state.transform.position).project(camera)
          const cx = rect.left + (v.x * 0.5 + 0.5) * rect.width
          const cy = rect.top + (-v.y * 0.5 + 0.5) * rect.height
          return cx >= lox && cx <= hix && cy >= loy && cy <= hiy
        })
        .map((p) => p.id),
    )
  }
  const endMarquee = () => {
    if (!marqueeStart.current) return
    marqueeStart.current = null
    const st = store.getState()
    st.setMarquee(null)
    if (st.draggingId === '__marquee') st.setDraggingId(null)
  }

  useFrame(() => {
    const world = worldRef.current
    if (!world) return
    if (builtKey.current !== key) return // stale world; rebuild is imminent
    const state = store.getState()
    if (state.running) {
      if (drag.current) {
        if (drag.current.mode === 'pull') world.applyPull(drag.current.target, FIXED_DT)
        else world.moveGrab(drag.current.id, drag.current.target, FIXED_DT)
      }
      simTime.current += FIXED_DT
      world.updateRopeAttachments(state.doc)
      const env = state.env
      world.applyEnvironment(
        simTime.current,
        env.windOn
          ? { strength: env.windStrength * (env.hurricane ? 6 : 1), angle: env.windAngle }
          : null,
        env.quakeOn ? { magnitude: env.quakeMagnitude } : null,
        state.doc.pieces,
        state.doc.materials,
      )
      if (blow.current && state.tool === 'blower') {
        const b = blow.current
        world.applyBlower(
          [b.origin.x, b.origin.y, b.origin.z],
          [b.dir.x, b.dir.y, b.dir.z],
          env.blowStrength,
          state.doc.pieces,
        )
      }
      world.step(FIXED_DT)
      world.syncToDocument(state.doc)
    }
    // Slingshot rocks (ephemeral): drive the mesh pool from the physics list.
    const rocks = world.syncProjectiles()
    projectileMeshes.current.forEach((m, i) => {
      if (!m) return
      const rock = rocks[i]
      if (rock) {
        m.visible = true
        m.position.set(rock.x, rock.y, rock.z)
        m.quaternion.set(...rock.q) // tumble with the body
        m.scale.setScalar(rock.r)
      } else {
        m.visible = false
      }
    })
    // Camera feel: earthquake judder + a gentle lateral sway in wind. Applied
    // as a delta that's removed next frame so OrbitControls stays in charge.
    const prevShake = shakeOffset.current
    camera.position.sub(prevShake)
    prevShake.set(0, 0, 0)
    if (state.running) {
      const env2 = state.env
      if (env2.quakeOn) {
        const a = env2.quakeMagnitude * 0.0045
        prevShake.x += (Math.random() - 0.5) * a
        prevShake.y += (Math.random() - 0.5) * a * 0.5
        prevShake.z += (Math.random() - 0.5) * a
      }
      if (env2.windOn) {
        const sway =
          Math.sin(simTime.current * 0.9) *
          env2.windStrength *
          (env2.hurricane ? 6 : 1) *
          0.0005
        prevShake.addScaledVector(horizontalRight(), sway)
      }
    }
    camera.position.add(prevShake)
    // Blower cone: a faint air jet widening toward where the cursor points.
    const bc = blowCone.current
    if (bc) {
      const b = blow.current
      bc.visible = !!b && state.running && state.tool === 'blower'
      if (b && bc.visible) {
        BLOW_DIR.copy(b.dir).normalize()
        bc.quaternion.setFromUnitVectors(UP, BLOW_DIR.clone().negate())
        bc.position.copy(b.point).addScaledVector(BLOW_DIR, -0.8)
      }
    }
    // Ropes: drive each rope's cylinder chain from the live particle positions.
    const ropePoints = world.syncRopes()
    ropeGroups.current.forEach((g, ropeId) => {
      const pts = ropePoints.get(ropeId)
      if (!g || !pts) return
      const n = pts.length / 3
      g.children.forEach((link, i) => {
        const j = (i + 1) % n
        if (!g.userData.looped && j === 0) return
        const ax = pts[i * 3]
        const ay = pts[i * 3 + 1]
        const az = pts[i * 3 + 2]
        const bx = pts[j * 3]
        const by = pts[j * 3 + 1]
        const bz = pts[j * 3 + 2]
        const dx = bx - ax
        const dy = by - ay
        const dz = bz - az
        const len = Math.hypot(dx, dy, dz)
        if (len < 1e-6) return
        link.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
        link.quaternion.setFromUnitVectors(UP, ROPE_DIR.set(dx / len, dy / len, dz / len))
        link.scale.set(1, len * 1.08, 1) // slight overlap hides the joints
      })
    })
    // Drive meshes from State imperatively (no per-frame React re-render).
    // Pieces mid-assembly-drag are owned by the pointer, not by State.
    const assemblyIds =
      pausedDrag.current?.mode === 'assembly'
        ? new Set(pausedDrag.current.group?.map((g) => g.id))
        : null
    for (const piece of state.doc.pieces) {
      if (gizmoActive && piece.id === state.selectedId) continue
      if (assemblyIds?.has(piece.id)) continue
      const mesh = meshes.current.get(piece.id)
      if (!mesh) continue
      const [px, py, pz] = piece.state.transform.position
      const [qx, qy, qz, qw] = piece.state.transform.rotation
      mesh.position.set(px, py, pz)
      mesh.quaternion.set(qx, qy, qz, qw)
    }
  })

  const endDrag = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (d.mode === 'pull') worldRef.current?.endPull()
    else worldRef.current?.endGrab(d.id)
    store.getState().setDraggingId(null)
    // Record the release point as the piece's new rest placement (undoable).
    const piece = store.getState().doc.pieces.find((p) => p.id === d.id)
    if (piece) {
      store.getState().updatePiece(d.id, {
        definition: { transform: structuredClone(piece.state.transform) },
      })
    }
  }

  const endPausedDrag = () => {
    const pd = pausedDrag.current
    if (!pd) return
    pausedDrag.current = null
    store.getState().setDraggingId(null)
    if (pd.mode === 'assembly' && pd.group) {
      // Commit every group member as ONE undo entry, then rebuild physics.
      const s = store.getState()
      s.beginTransient()
      for (const g of pd.group) {
        const m = meshes.current.get(g.id)
        if (!m) continue
        const transform = {
          position: [m.position.x, m.position.y, m.position.z] as Vec3,
          rotation: [m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w] as [
            number,
            number,
            number,
            number,
          ],
        }
        s.updatePieceTransient(g.id, {
          definition: { transform: structuredClone(transform) },
          state: { transform: structuredClone(transform) },
        })
      }
      s.endTransient()
      s.bumpWorldEpoch()
      return
    }
    const mesh = meshes.current.get(pd.id)
    if (!mesh) return
    store.getState().movePieceTransform(pd.id, {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
    })
  }

  // Start a paused-mode drag. Jointed pieces move along their joint's freedom
  // (slide along the axis, swing around it) so the user can align the motion;
  // loose pieces move freely on the ground plane (shift = vertically).
  const beginPausedDrag = (piece: import('../document/types').Piece, e: import('@react-three/fiber').ThreeEvent<PointerEvent>) => {
    // Derived from document state, not the mesh: a just-made Alt-duplicate has
    // no mounted mesh yet, but its state matches the original's pose.
    const [px, py, pz] = piece.state.transform.position
    const s = store.getState()
    const joint = s.doc.fasteners.find(
      (f) => isJointType(f.type) && (f.partA === piece.id || f.partB === piece.id),
    )
    const base: PausedDrag = {
      id: piece.id,
      mode: 'free',
      offX: e.point.x - px,
      offZ: e.point.z - pz,
      centerY: py,
      planeY: e.point.y,
      grabOffY: e.point.y - py,
    }
    // Ctrl/Cmd = relocate the whole fastened assembly rigidly (SolidWorks'
    // "move component" vs the default articulate-along-the-joint). A drag on
    // a multi-selected piece moves the whole selection the same way.
    const multi =
      s.selectedIds.length > 1 && s.selectedIds.includes(piece.id) ? s.selectedIds : null
    if (e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || multi) {
      const ids =
        e.nativeEvent.ctrlKey || e.nativeEvent.metaKey
          ? connectedGroup(s.doc, piece.id)
          : multi!
      pausedDrag.current = {
        ...base,
        mode: 'assembly',
        group: ids.map((id) => {
          const p = s.doc.pieces.find((x) => x.id === id)!
          return { id, start: new Vector3(...p.state.transform.position) }
        }),
      }
      s.setDraggingId(piece.id)
      ;(e.target as Element).setPointerCapture(e.pointerId)
      return
    }
    if (joint) {
      const pieceA = s.doc.pieces.find((p) => p.id === joint.partA)
      const pieceB = s.doc.pieces.find((p) => p.id === joint.partB)
      if (pieceA && pieceB) {
        const axis = new Vector3(
          ...localDirToWorld(pieceA.state.transform, joint.axisA ?? [0, 1, 0]),
        ).normalize()
        if (joint.type === 'pivot') {
          const anchor = new Vector3(...localToWorld(pieceA.state.transform, joint.anchorA ?? [0, 0, 0]))
          const denom = axis.dot(e.ray.direction)
          if (Math.abs(denom) > 1e-6) {
            const t = axis.dot(anchor.clone().sub(e.ray.origin)) / denom
            const hit = e.ray.origin.clone().addScaledVector(e.ray.direction, t)
            const v0 = hit.sub(anchor).addScaledVector(axis, -hit.clone().sub(anchor).dot(axis))
            if (v0.lengthSq() > 1e-8) {
              pausedDrag.current = {
                ...base,
                mode: 'swing',
                axis,
                anchor,
                startVec: v0.normalize(),
                quat0: new Quaternion(...piece.state.transform.rotation),
                center0: new Vector3(px, py, pz),
              }
            }
          }
        } else {
          // linear / cylindrical: slide along the axis within the end stops.
          const anchorAw = new Vector3(...localToWorld(pieceA.state.transform, joint.anchorA ?? [0, 0, 0]))
          const anchorBw = new Vector3(...localToWorld(pieceB.state.transform, joint.anchorB ?? [0, 0, 0]))
          const d0 = axis.dot(anchorAw.clone().sub(anchorBw))
          let minD = -Infinity
          let maxD = Infinity
          if (joint.slideMin != null && joint.slideMax != null) {
            if (piece.id === joint.partA) {
              minD = joint.slideMin - d0
              maxD = joint.slideMax - d0
            } else {
              minD = d0 - joint.slideMax
              maxD = d0 - joint.slideMin
            }
          }
          const startPos = new Vector3(px, py, pz)
          pausedDrag.current = {
            ...base,
            mode: 'slide',
            axis,
            startPos,
            startParam: lineParam(startPos, axis, e.ray.origin, e.ray.direction) ?? 0,
            minD,
            maxD,
          }
        }
      }
    }
    if (!pausedDrag.current) pausedDrag.current = base
    s.setDraggingId(piece.id)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const movePausedDrag = (e: import('@react-three/fiber').ThreeEvent<PointerEvent>) => {
    const pd = pausedDrag.current
    if (!pd) return
    const mesh = meshes.current.get(pd.id)
    if (!mesh) return
    if (pd.mode === 'assembly' && pd.group) {
      // Ground-plane delta of the grabbed piece, applied rigidly to the group.
      if (Math.abs(e.ray.direction.y) < 1e-6) return
      const t = (pd.planeY - e.ray.origin.y) / e.ray.direction.y
      if (t <= 0) return
      const grabbed = pd.group.find((g) => g.id === pd.id)
      if (!grabbed) return
      const nx = e.ray.origin.x + e.ray.direction.x * t - pd.offX
      const nz = e.ray.origin.z + e.ray.direction.z * t - pd.offZ
      const dx = nx - grabbed.start.x
      const dz = nz - grabbed.start.z
      for (const g of pd.group) {
        const m = meshes.current.get(g.id)
        m?.position.set(g.start.x + dx, g.start.y, g.start.z + dz)
      }
      return
    }
    if (pd.mode === 'slide' && pd.axis && pd.startPos) {
      const t = lineParam(pd.startPos, pd.axis, e.ray.origin, e.ray.direction)
      if (t == null) return
      const delta = Math.min(pd.maxD ?? Infinity, Math.max(pd.minD ?? -Infinity, t - (pd.startParam ?? 0)))
      mesh.position.copy(pd.startPos).addScaledVector(pd.axis, delta)
      return
    }
    if (pd.mode === 'swing' && pd.axis && pd.anchor && pd.startVec && pd.quat0 && pd.center0) {
      const denom = pd.axis.dot(e.ray.direction)
      if (Math.abs(denom) < 1e-6) return
      const t = pd.axis.dot(pd.anchor.clone().sub(e.ray.origin)) / denom
      const hit = e.ray.origin.clone().addScaledVector(e.ray.direction, t)
      const v1 = hit.sub(pd.anchor)
      v1.addScaledVector(pd.axis, -v1.dot(pd.axis))
      if (v1.lengthSq() < 1e-8) return
      v1.normalize()
      const cross = pd.startVec.clone().cross(v1)
      const angle = Math.atan2(cross.dot(pd.axis), pd.startVec.dot(v1))
      const q = new Quaternion().setFromAxisAngle(pd.axis, angle)
      mesh.quaternion.copy(q.clone().multiply(pd.quat0))
      mesh.position.copy(pd.anchor).add(pd.center0.clone().sub(pd.anchor).applyQuaternion(q))
      return
    }
    // free
    if (e.nativeEvent.altKey) {
      // Alt mid-drag = rotate in place (horizontal motion; +Shift tilts).
      const dx = e.nativeEvent.movementX ?? 0
      const axis = e.nativeEvent.shiftKey ? horizontalRight() : UP
      mesh.quaternion.premultiply(new Quaternion().setFromAxisAngle(axis, dx * 0.012))
      return
    }
    if (e.nativeEvent.shiftKey) {
      const lineOrigin = new Vector3(mesh.position.x, 0, mesh.position.z)
      const t = lineParam(lineOrigin, UP, e.ray.origin, e.ray.direction)
      if (t == null) return
      const newY = Math.max(0.01, t - pd.grabOffY)
      mesh.position.y = newY
      pd.centerY = newY
      pd.planeY = newY + pd.grabOffY
    } else {
      if (Math.abs(e.ray.direction.y) < 1e-6) return
      const t = (pd.planeY - e.ray.origin.y) / e.ray.direction.y
      if (t <= 0) return
      mesh.position.x = e.ray.origin.x + e.ray.direction.x * t - pd.offX
      mesh.position.z = e.ray.origin.z + e.ray.direction.z * t - pd.offZ
      mesh.position.y = pd.centerY
    }
  }

  return (
    <>
      {doc.pieces.map((piece) => (
        <PieceMesh
          key={piece.id}
          piece={piece}
          materials={doc.materials}
          selected={piece.id === selectedId || selectedIds.includes(piece.id)}
          highlighted={piece.id === proximityTarget || piece.id === jointA?.pieceId}
          onPointerMove={(e) => {
            const s = store.getState()
            // While placing, hovering a piece offers a join to it at the contact point.
            if (s.activeTool) {
              e.stopPropagation()
              s.setHeldPos([e.point.x, e.point.y, e.point.z])
              s.setProximityTarget(piece.id)
              return
            }
            // Joint tool: live snap preview of the feature under the pointer.
            if (s.tool === 'joint') {
              e.stopPropagation()
              s.jointHoverAt(piece.id, [e.point.x, e.point.y, e.point.z])
              return
            }
            if (s.tool === 'blower') {
              if (blow.current) {
                e.stopPropagation()
                moveBlow(e)
              }
              return
            }
            if (pausedDrag.current) {
              movePausedDrag(e)
              return
            }
            // Dragging (running): slide the piece along the horizontal plane it
            // was grabbed on; shift lifts it vertically; Alt pressed mid-drag
            // rotates (horizontal motion spins; +Shift tilts instead).
            const d = drag.current
            if (d) {
              if (e.nativeEvent.altKey) {
                const dx = e.nativeEvent.movementX ?? 0
                const axis = e.nativeEvent.shiftKey ? horizontalRight() : UP
                if (d.mode === 'pull') {
                  // The pulled body is dynamic: spin it with angular velocity.
                  worldRef.current?.spinPull([axis.x, axis.y, axis.z], dx * 0.7)
                } else {
                  d.rotQuat.premultiply(new Quaternion().setFromAxisAngle(axis, dx * 0.012))
                  worldRef.current?.rotateGrab(
                    d.id,
                    [d.rotQuat.x, d.rotQuat.y, d.rotQuat.z, d.rotQuat.w],
                    FIXED_DT,
                  )
                }
                return
              }
              if (e.nativeEvent.shiftKey) {
                const lineOrigin = new Vector3(d.target[0], 0, d.target[2])
                const t = lineParam(lineOrigin, UP, e.ray.origin, e.ray.direction)
                if (t != null) {
                  d.centerY = Math.max(0.02, t - d.grabOffY)
                  d.planeY = d.centerY + d.grabOffY
                  d.target = [d.target[0], d.mode === 'pull' ? d.planeY : d.centerY, d.target[2]]
                }
              } else if (e.ray.direction.y !== 0) {
                const t = (d.planeY - e.ray.origin.y) / e.ray.direction.y
                if (t > 0) {
                  const hx = e.ray.origin.x + e.ray.direction.x * t
                  const hz = e.ray.origin.z + e.ray.direction.z * t
                  d.target =
                    d.mode === 'pull'
                      ? [hx, d.planeY, hz] // the spring tows the grab POINT to the cursor
                      : [hx - d.offX, d.centerY, hz - d.offZ]
                }
              }
            }
          }}
          onPointerDown={(e) => {
            const s = store.getState()
            // Pointer priority: stock placement > joint picking > fastening (A→B) > drag/select.
            if (s.activeTool) {
              e.stopPropagation()
              s.setProximityTarget(piece.id)
              s.commitHeldAt([e.point.x, e.point.y, e.point.z])
              return
            }
            if (s.tool === 'joint') {
              e.stopPropagation()
              s.jointClick(piece.id, [e.point.x, e.point.y, e.point.z])
              return
            }
            if (s.tool === 'rope') {
              // Clicking a piece ties the rope end to it at the clicked spot.
              e.stopPropagation()
              s.ropeClick([e.point.x, e.point.y, e.point.z], {
                pieceId: piece.id,
                anchor: worldToLocal(piece.state.transform, [e.point.x, e.point.y, e.point.z]),
              })
              return
            }
            if (s.tool === 'blower') {
              e.stopPropagation()
              startBlow(e)
              return
            }
            if (s.fastenTool) {
              e.stopPropagation()
              s.fastenClick(piece.id)
              return
            }
            e.stopPropagation()
            if (s.tool !== 'transform') {
              s.select(piece.id)
              return
            }
            // Shift-click = add/remove from the multi-selection (no drag).
            if (e.nativeEvent.shiftKey) {
              s.toggleSelect(piece.id)
              return
            }
            // Alt held BEFORE the click = drag away a duplicate (paused only —
            // while running Alt is reserved for rotate); Alt pressed AFTER the
            // click rotates in place (see move).
            let target = piece
            if (e.nativeEvent.altKey && !s.running) {
              const clone = s.duplicatePiece(piece.id)
              if (clone) target = clone
            } else {
              s.select(piece.id)
            }
            if (s.running) {
              // Default while the sim runs: PULL the piece from the clicked
              // point (it dangles and pivots under its weight). Ctrl/Cmd =
              // rigid carry for precise placement.
              // (A just-made clone has no body yet; the rebuild effect re-grabs it.)
              if (!target.anchored) {
                const carry = e.nativeEvent.ctrlKey || e.nativeEvent.metaKey
                const [cx, cy, cz] = target.state.transform.position
                let grabLocal: Vec3 | undefined
                if (carry) {
                  worldRef.current?.beginGrab(target.id)
                } else {
                  grabLocal =
                    worldRef.current?.beginPull(target.id, [e.point.x, e.point.y, e.point.z]) ??
                    undefined
                }
                drag.current = {
                  id: target.id,
                  mode: carry ? 'carry' : 'pull',
                  grabLocal,
                  offX: carry ? e.point.x - cx : 0,
                  offZ: carry ? e.point.z - cz : 0,
                  centerY: carry ? cy : e.point.y,
                  planeY: e.point.y,
                  grabOffY: carry ? e.point.y - cy : 0,
                  target: carry ? [cx, cy, cz] : [e.point.x, e.point.y, e.point.z],
                  rotQuat: new Quaternion(...target.state.transform.rotation),
                }
                s.setDraggingId(target.id)
                ;(e.target as Element).setPointerCapture(e.pointerId)
              }
            } else {
              // Paused: body-drag moves the piece (joint-constrained when jointed).
              beginPausedDrag(target, e)
            }
          }}
          onPointerUp={(e) => {
            if (drag.current) {
              ;(e.target as Element).releasePointerCapture(e.pointerId)
              endDrag()
            }
            if (pausedDrag.current) {
              ;(e.target as Element).releasePointerCapture(e.pointerId)
              endPausedDrag()
            }
            if (blow.current) {
              ;(e.target as Element).releasePointerCapture(e.pointerId)
              endBlow()
            }
          }}
          onPointerOut={() => {
            const s = store.getState()
            if (s.jointHover?.pieceId === piece.id) s.jointHoverAt(null)
          }}
          ref={(m) => {
            if (m) meshes.current.set(piece.id, m)
            else meshes.current.delete(piece.id)
          }}
        />
      ))}
      {doc.fasteners.map((f) => (
        <FastenerMarker key={f.id} fastener={f} />
      ))}
      {/* Slingshot rock pool (driven imperatively from physics), 10 shapes cycling. */}
      <group>
        {Array.from({ length: 16 }).map((_, i) => (
          <mesh
            key={i}
            visible={false}
            castShadow
            ref={(m) => {
              projectileMeshes.current[i] = m
            }}
          >
            <primitive object={rockGeometries()[i % 10]} attach="geometry" />
            <meshStandardMaterial color="#78828e" roughness={0.95} metalness={0.02} flatShading />
          </mesh>
        ))}
      </group>
      <WindArrows />
      {/* Ropes: cylinder chains driven from the soft-body particles. */}
      {(doc.ropes ?? []).map((rope) => {
        const count = rope.looped ? Math.max(8, rope.segments) : rope.segments + 1
        const links = rope.looped ? count : count - 1
        const color =
          selectedRopeId === rope.id
            ? '#ff8a00'
            : doc.materials.find((m) => m.name === rope.material)?.color ?? '#b09468'
        return (
          <group
            key={`${rope.id}:${links}`}
            ref={(g) => {
              if (g) {
                g.userData.looped = rope.looped
                ropeGroups.current.set(rope.id, g)
              } else {
                ropeGroups.current.delete(rope.id)
              }
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              store.getState().selectRope(rope.id)
            }}
          >
            {Array.from({ length: links }).map((_, i) => (
              <mesh key={i} castShadow>
                <cylinderGeometry args={[rope.radius, rope.radius, 1, 6]} />
                <meshStandardMaterial color={color} roughness={1} metalness={0} />
              </mesh>
            ))}
          </group>
        )
      })}
      {/* Marquee select: Shift+drag on empty ground while paused. */}
      {!running && tool === 'transform' && shiftDown && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.001, 0]}
          onPointerDown={(e) => {
            if (!e.nativeEvent.shiftKey) return
            e.stopPropagation()
            marqueeStart.current = { x0: e.nativeEvent.clientX, y0: e.nativeEvent.clientY }
            store.getState().setDraggingId('__marquee') // pauses orbit
            ;(e.target as Element).setPointerCapture(e.pointerId)
          }}
          onPointerMove={marqueeMove}
          onPointerUp={(e) => {
            if (!marqueeStart.current) return
            ;(e.target as Element).releasePointerCapture(e.pointerId)
            endMarquee()
          }}
        >
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {/* Blower tool: full-ground catcher + faint air-jet cone while blowing. */}
      {tool === 'blower' && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.045, 0]}
          onPointerDown={(e) => {
            e.stopPropagation()
            startBlow(e)
          }}
          onPointerMove={(e) => {
            if (blow.current) moveBlow(e)
          }}
          onPointerUp={(e) => {
            if (blow.current) {
              ;(e.target as Element).releasePointerCapture(e.pointerId)
              endBlow()
            }
          }}
        >
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      <mesh ref={blowCone} visible={false} raycast={() => null}>
        <coneGeometry args={[0.5, 1.6, 20, 1, true]} />
        <meshBasicMaterial color="#4aa3ff" transparent opacity={0.14} depthWrite={false} side={DoubleSide} />
      </mesh>
      {/* Rope tool: ground catcher + first-endpoint marker. */}
      {tool === 'rope' && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.051, 0]}
          onPointerDown={(e) => {
            e.stopPropagation()
            store.getState().ropeClick([e.point.x, e.point.y, e.point.z], null)
          }}
        >
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {ropeStart && (
        <mesh position={ropeStart.point} renderOrder={999}>
          <sphereGeometry args={[0.02, 12, 8]} />
          <meshBasicMaterial color="#b09468" depthTest={false} />
        </mesh>
      )}
      {/* Joint tool: snap preview under the pointer + the picked point A. */}
      {jointHover && jointHover.pieceId !== jointA?.pieceId && (
        <FeatureMarker anchor={jointHover} color="#2ecc71" />
      )}
      {jointA && <FeatureMarker anchor={jointA} color="#ff8a00" />}
      {/* Paused + transform tool: handles mount on the bounding-box shell —
          corner/top squares resize, lift cone raises. HOLDING ALT shows the
          rotate ring (one axis at a time; X/Y/Z switch, 15° snap, Shift free). */}
      {gizmoMesh && selectedPiece && (
        <>
          <ResizeHandles piece={selectedPiece} mesh={gizmoMesh} />
          <RotateRing piece={selectedPiece} mesh={gizmoMesh} />
        </>
      )}
      <JointEditor />
    </>
  )
}

// Drift lanes for the wind indicator arrows (local +x = downwind).
const WIND_LANES = [
  { z: -1.0, y: 0.45 },
  { z: -0.4, y: 0.8 },
  { z: 0.2, y: 0.55 },
  { z: 0.8, y: 0.75 },
  { z: 1.3, y: 0.5 },
  { z: -1.5, y: 0.65 },
]

/** Subtle drifting arrows showing the wind's direction while it blows. */
function WindArrows() {
  const store = useStoreApi()
  const group = useRef<Group>(null)
  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const env = store.getState().env
    const on = env.windOn && store.getState().running
    g.visible = on
    if (!on) return
    g.rotation.y = -env.windAngle // local +x → the blow direction
    const t = clock.getElapsedTime() * (env.hurricane ? 2.2 : 1)
    g.children.forEach((child, i) => {
      const lane = WIND_LANES[i % WIND_LANES.length]
      const phase = ((t * 0.9 + i * 0.6) % 3) - 1.5
      child.position.set(phase, lane.y, lane.z)
    })
  })
  return (
    <group ref={group} visible={false}>
      {WIND_LANES.map((_, i) => (
        <group key={i}>
          <mesh rotation={[0, 0, -Math.PI / 2]} raycast={() => null}>
            <cylinderGeometry args={[0.006, 0.006, 0.22, 6]} />
            <meshBasicMaterial color="#7ea6d8" transparent opacity={0.5} toneMapped={false} />
          </mesh>
          <mesh position={[0.15, 0, 0]} rotation={[0, 0, -Math.PI / 2]} raycast={() => null}>
            <coneGeometry args={[0.025, 0.06, 8]} />
            <meshBasicMaterial color="#7ea6d8" transparent opacity={0.5} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** The workbench slab: a visible platform where the action happens. */
function Sandbox() {
  const sandbox = useDocStore((s) => s.doc.ground.sandbox)
  if (!sandbox) return null
  return (
    <mesh position={[0, sandbox.thickness / 2, 0]} receiveShadow>
      <boxGeometry args={[sandbox.size, sandbox.thickness, sandbox.size]} />
      <meshStandardMaterial color="#e9eef4" roughness={0.9} metalness={0} />
    </mesh>
  )
}

/** Frame all pieces when the toolbar's fit button fires. */
function FitListener() {
  const store = useStoreApi()
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  useEffect(() => {
    const onFit = () => {
      const doc = store.getState().doc
      const center = new Vector3()
      let radius = (doc.ground.sandbox?.size ?? 4) / 2
      if (doc.pieces.length > 0) {
        const min = new Vector3(Infinity, Infinity, Infinity)
        const max = new Vector3(-Infinity, -Infinity, -Infinity)
        for (const p of doc.pieces) {
          const pos = new Vector3(...p.state.transform.position)
          const half = maxExtent(p) / 2
          min.min(pos.clone().subScalar(half))
          max.max(pos.clone().addScalar(half))
        }
        center.copy(min).add(max).multiplyScalar(0.5)
        radius = Math.max(0.5, max.clone().sub(min).length() / 2)
      }
      const fov = ((camera as { fov?: number }).fov ?? 45) * (Math.PI / 180)
      const dist = (radius / Math.tan(fov / 2)) * 1.25
      const dir = camera.position
        .clone()
        .sub(controls ? controls.target : new Vector3())
        .normalize()
      if (controls) {
        controls.target.copy(center)
        camera.position.copy(center.clone().addScaledVector(dir, dist))
        controls.update()
      }
    }
    window.addEventListener('neocad:fit', onFit)
    return () => window.removeEventListener('neocad:fit', onFit)
  }, [camera, controls, store])
  return null
}

export function Scene() {
  // Load Jolt once; render the simulation only after the WASM module is ready.
  const joltRef = useRef<JoltModule | null>(null)
  const ready = useJolt(joltRef)
  const store = useStoreApi()
  const draggingId = useDocStore((s) => s.draggingId)
  const sandbox = useDocStore((s) => s.doc.ground.sandbox)
  const orbitRef = useRef<OrbitControlsImpl | null>(null)

  return (
    <Canvas
      shadows
      camera={{ position: [3.5, 2.6, 4.5], fov: 45 }}
      onPointerMissed={() => {
        store.getState().select(null)
        store.getState().selectFastener(null)
        store.getState().selectRope(null)
        store.getState().cancelJoint()
      }}
    >
      {/* Tinkercad-style presentation: white background, soft sky light, one
          gentle key light with soft shadows, and a light blue-grey grid. */}
      <color attach="background" args={['#ffffff']} />
      <hemisphereLight args={['#ffffff', '#b8c0cc', 0.85]} />
      <directionalLight
        position={[6, 10, 4]}
        intensity={1.15}
        castShadow
        // Tight frustum + high-res map: ~2.5mm/texel so contact shadows actually
        // touch small pieces (a wide span left a visible gap under objects).
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-bias={-0.0001}
        shadow-normalBias={0.01}
      />
      <directionalLight position={[-6, 5, -6]} intensity={0.3} />
      {/* Shadow catcher just under the workbench so shadows read on white. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial opacity={0.16} />
      </mesh>
      <Sandbox />
      {/* Workplane grid rides on top of the sandbox slab. */}
      <Grid
        position={[0, (sandbox?.thickness ?? 0) + 0.002, 0]}
        args={[sandbox?.size ?? 40, sandbox?.size ?? 40]}
        cellSize={0.1}
        sectionSize={0.5}
        cellColor="#bcc7d4"
        sectionColor="#8fa1b5"
        fadeDistance={40}
      />
      <DevCameraHook />
      <FitListener />
      {ready && joltRef.current && <Sim Jolt={joltRef.current} />}
      <HeldPiece />
      {/* Tinkercad-style view cube: click faces/edges to orbit to that view. */}
      <GizmoHelper alignment="top-right" margin={[70, 70]}>
        <GizmoViewcube
          color="#f4f6f9"
          strokeColor="#8494a7"
          textColor="#33465c"
          hoverColor="#dbe6f4"
        />
      </GizmoHelper>
      <OrbitControls
        ref={orbitRef}
        makeDefault
        enabled={!draggingId}
        // Keep the camera above the workplane — no diving underground.
        maxPolarAngle={Math.PI / 2 - 0.03}
        minDistance={0.5}
        maxDistance={60}
        onChange={() => {
          const c = orbitRef.current
          if (c && c.target.y < 0.02) {
            c.target.y = 0.02
          }
        }}
      />
    </Canvas>
  )
}

// Dev-only hook so e2e scripts can project world→screen through the live camera.
function DevCameraHook() {
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__camera = camera
    ;(window as unknown as Record<string, unknown>).__scene = scene
  }
  return null
}

// Small hook: resolve the Jolt module and trigger a re-render when ready.
function useJolt(ref: React.MutableRefObject<JoltModule | null>): boolean {
  const [ready, setReady] = useState(false)
  useMemo(() => {
    initJolt().then((J) => {
      ref.current = J
      setReady(true)
    })
  }, [ref])
  return ready
}

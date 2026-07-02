import * as THREE from 'three'

/**
 * Procedural material textures (Tinkercad-ish): generated once on a canvas at
 * runtime, so there are no asset downloads and offline builds keep working.
 * Textures are near-white tonal patterns — the material's color multiplies
 * through, so custom material colors still read.
 */

const cache = new Map<string, THREE.Texture | null>()

function makeCanvas(draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.Texture | null {
  try {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    draw(ctx, size)
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = 4
    return tex
  } catch {
    return null // jsdom/tests: no 2D canvas — flat colors are fine
  }
}

// Deterministic pseudo-random (stable textures across loads).
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

function wood(): THREE.Texture | null {
  return makeCanvas((ctx, size) => {
    const rand = rng(42)
    // Long wavy grain lines.
    for (let i = 0; i < 46; i++) {
      const x = rand() * size
      const amp = 2 + rand() * 5
      const period = 40 + rand() * 90
      ctx.strokeStyle = `rgba(120, 82, 45, ${0.05 + rand() * 0.11})`
      ctx.lineWidth = 0.6 + rand() * 2.2
      ctx.beginPath()
      for (let y = 0; y <= size; y += 4) {
        const wx = x + Math.sin((y / period) * Math.PI * 2 + rand()) * amp
        y === 0 ? ctx.moveTo(wx, y) : ctx.lineTo(wx, y)
      }
      ctx.stroke()
    }
    // A couple of knots.
    for (let k = 0; k < 2; k++) {
      const cx = rand() * size
      const cy = rand() * size
      for (let r = 8; r > 1; r -= 2) {
        ctx.strokeStyle = `rgba(100, 66, 34, ${0.1 + (8 - r) * 0.02})`
        ctx.beginPath()
        ctx.ellipse(cx, cy, r * 1.6, r, 0.3, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  })
}

function brushed(seed: number, alpha: number): THREE.Texture | null {
  return makeCanvas((ctx, size) => {
    const rand = rng(seed)
    for (let i = 0; i < 240; i++) {
      const y = rand() * size
      ctx.strokeStyle = `rgba(90, 100, 110, ${alpha * (0.3 + rand() * 0.7)})`
      ctx.lineWidth = 0.5 + rand()
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(size, y + (rand() - 0.5) * 2)
      ctx.stroke()
    }
  })
}

function speckle(seed: number, alpha: number, dots: number): THREE.Texture | null {
  return makeCanvas((ctx, size) => {
    const rand = rng(seed)
    for (let i = 0; i < dots; i++) {
      ctx.fillStyle = `rgba(30, 30, 34, ${alpha * (0.3 + rand() * 0.7)})`
      const r = 0.4 + rand() * 1.6
      ctx.beginPath()
      ctx.arc(rand() * size, rand() * size, r, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

function plastic(): THREE.Texture | null {
  return makeCanvas((ctx, size) => {
    // Barely-there mold texture: soft diagonal sheen.
    const grad = ctx.createLinearGradient(0, 0, size, size)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.5, 'rgba(120,130,150,0.05)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
  })
}

const BUILDERS: Record<string, () => THREE.Texture | null> = {
  wood,
  steel: () => brushed(7, 0.12),
  aluminum: () => brushed(13, 0.07),
  plastic,
  rubber: () => speckle(23, 0.18, 900),
}

/** Texture for a material name, or null (flat color) for custom materials. */
export function textureFor(materialName: string): THREE.Texture | null {
  if (cache.has(materialName)) return cache.get(materialName)!
  const tex = BUILDERS[materialName] ? BUILDERS[materialName]() : null
  cache.set(materialName, tex)
  return tex
}

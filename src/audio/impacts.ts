/**
 * Procedural impact sounds — material- and strength-aware, no audio assets.
 * Each hit is a short noise burst through a bandpass plus a decaying tone;
 * the material picks the voicing (wood knock, metal ring, plastic click,
 * rubber thud) and the impact speed drives loudness and a little pitch.
 */

interface Profile {
  /** Resonant frequency of the body (Hz). */
  freq: number
  /** Tone decay (s) — metal rings, plastic clicks. */
  decay: number
  /** Noise burst share (0..1) vs tone. */
  noise: number
}

const PROFILES: Record<string, Profile> = {
  wood: { freq: 170, decay: 0.09, noise: 0.65 },
  steel: { freq: 1900, decay: 0.35, noise: 0.25 },
  aluminum: { freq: 2500, decay: 0.2, noise: 0.3 },
  plastic: { freq: 550, decay: 0.06, noise: 0.55 },
  rubber: { freq: 90, decay: 0.07, noise: 0.35 },
  // The workbench and anything unknown knock like wood.
  bench: { freq: 140, decay: 0.08, noise: 0.7 },
  // Slingshot rocks: dull stony thump.
  rock: { freq: 220, decay: 0.05, noise: 0.85 },
}

let ctx: AudioContext | null = null
let noiseBuffer: AudioBuffer | null = null
let lastPlay = 0
let voices = 0

/** Create/resume the AudioContext — call from a user gesture (autoplay policy). */
export function ensureAudio(): Promise<void> {
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return Promise.resolve()
    }
    const len = Math.floor(ctx.sampleRate * 0.1)
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }
  // resume() is async — callers that want to play RIGHT NOW must await it,
  // or the "is it running yet" check races the promise and silently no-ops.
  if (ctx.state === 'suspended') return ctx.resume().catch(() => {})
  return Promise.resolve()
}

/** Short confirmation beep (🔊 toggle) so users can verify audio output works. */
export function playBeep(): void {
  void ensureAudio().then(beepNow)
}

function beepNow(): void {
  if (!ctx || ctx.state !== 'running') return
  const t0 = ctx.currentTime
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.frequency.value = 880
  g.gain.setValueAtTime(0.2, t0)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15)
  osc.connect(g).connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + 0.16)
}

/**
 * Play one impact. `speed` is the relative normal velocity (m/s); quiet taps
 * are skipped, hard hits saturate. Throttled so contact storms don't stack.
 */
export function playImpact(material: string, speed: number): void {
  if (!ctx || !noiseBuffer || ctx.state !== 'running') return
  const strength = Math.min(1, Math.max(0, (speed - 0.35) / 5))
  if (strength <= 0.01) return
  const now = performance.now()
  if (now - lastPlay < 25 || voices >= 8) return
  lastPlay = now
  voices++
  const p = PROFILES[material] ?? PROFILES.bench
  const t0 = ctx.currentTime
  const gain = Math.pow(strength, 1.4) * 0.6
  const detune = 1 + (Math.random() - 0.5) * 0.12

  const out = ctx.createGain()
  out.gain.setValueAtTime(gain, t0)
  out.connect(ctx.destination)

  // Noise burst → bandpass at the material's resonance.
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = p.freq * detune
  bp.Q.value = 1.2
  const nGain = ctx.createGain()
  nGain.gain.setValueAtTime(p.noise, t0)
  nGain.gain.exponentialRampToValueAtTime(0.001, t0 + Math.max(0.03, p.decay * 0.5))
  noise.connect(bp).connect(nGain).connect(out)
  noise.start(t0)
  noise.stop(t0 + 0.1)

  // Body tone with exponential decay (harder hits ring slightly sharper).
  const osc = ctx.createOscillator()
  osc.type = material === 'steel' || material === 'aluminum' ? 'triangle' : 'sine'
  osc.frequency.value = p.freq * detune * (1 + strength * 0.05)
  const oGain = ctx.createGain()
  oGain.gain.setValueAtTime(1 - p.noise, t0)
  oGain.gain.exponentialRampToValueAtTime(0.001, t0 + p.decay)
  osc.connect(oGain).connect(out)
  osc.start(t0)
  osc.stop(t0 + p.decay + 0.02)

  osc.onended = () => {
    voices = Math.max(0, voices - 1)
    out.disconnect()
  }
}

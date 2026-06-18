export type KeyAction = 'delete' | 'cancel' | 'undo' | 'redo'

interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/** Map a keyboard event to a builder action, or null if it isn't a shortcut. */
export function keyToAction(e: KeyLike): KeyAction | null {
  const mod = e.ctrlKey || e.metaKey
  if (mod && (e.key === 'z' || e.key === 'Z')) return e.shiftKey ? 'redo' : 'undo'
  if (mod && (e.key === 'y' || e.key === 'Y')) return 'redo'
  if (e.key === 'Delete' || e.key === 'Backspace') return 'delete'
  if (e.key === 'Escape') return 'cancel'
  return null
}

/** True if the event target is a text field, so global shortcuts should be ignored. */
export function isEditableTarget(el: { tagName?: string } | null): boolean {
  if (!el || !el.tagName) return false
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
}

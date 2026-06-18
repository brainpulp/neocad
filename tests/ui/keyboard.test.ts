import { it, expect } from 'vitest'
import { isEditableTarget, keyToAction } from '../../src/ui/keyboard'

it('maps keys to actions', () => {
  expect(keyToAction({ key: 'Delete', ctrlKey: false, metaKey: false, shiftKey: false })).toBe('delete')
  expect(keyToAction({ key: 'Backspace', ctrlKey: false, metaKey: false, shiftKey: false })).toBe('delete')
  expect(keyToAction({ key: 'Escape', ctrlKey: false, metaKey: false, shiftKey: false })).toBe('cancel')
  expect(keyToAction({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false })).toBe('undo')
  expect(keyToAction({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: true })).toBe('redo')
  expect(keyToAction({ key: 'y', ctrlKey: true, metaKey: false, shiftKey: false })).toBe('redo')
  expect(keyToAction({ key: 'z', ctrlKey: false, metaKey: true, shiftKey: false })).toBe('undo') // cmd on mac
  expect(keyToAction({ key: 'a', ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull()
})

it('treats inputs/selects/textareas as editable so shortcuts are ignored there', () => {
  expect(isEditableTarget({ tagName: 'INPUT' } as Element)).toBe(true)
  expect(isEditableTarget({ tagName: 'SELECT' } as Element)).toBe(true)
  expect(isEditableTarget({ tagName: 'TEXTAREA' } as Element)).toBe(true)
  expect(isEditableTarget({ tagName: 'DIV' } as Element)).toBe(false)
  expect(isEditableTarget(null)).toBe(false)
})

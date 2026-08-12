import { afterEach, describe, expect, it } from 'vitest'
import { useShortcutsDialogStore } from './shortcuts-dialog-store.js'

describe('useShortcutsDialogStore', () => {
  afterEach(() => {
    useShortcutsDialogStore.setState({ isOpen: false })
  })

  it('defaults to closed', () => {
    expect(useShortcutsDialogStore.getState().isOpen).toBe(false)
  })

  it('open() opens it', () => {
    useShortcutsDialogStore.getState().open()
    expect(useShortcutsDialogStore.getState().isOpen).toBe(true)
  })

  it('setOpen(false) closes it', () => {
    useShortcutsDialogStore.getState().open()
    useShortcutsDialogStore.getState().setOpen(false)
    expect(useShortcutsDialogStore.getState().isOpen).toBe(false)
  })
})

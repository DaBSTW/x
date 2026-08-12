import { create } from 'zustand'

type ShortcutsDialogState = {
  isOpen: boolean
  open: () => void
  setOpen: (isOpen: boolean) => void
}

/** Global, so any keyboard-shortcut listener (or a future "?" button) can open it without prop-drilling — same non-persisted shape as auth-store.ts. */
export const useShortcutsDialogStore = create<ShortcutsDialogState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  setOpen: (isOpen) => set({ isOpen }),
}))

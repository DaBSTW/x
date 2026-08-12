'use client'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useShortcutsDialogStore } from '@/lib/shortcuts-dialog-store'

const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: 'j', description: 'Ir al post siguiente' },
  { keys: 'k', description: 'Ir al post anterior' },
  { keys: 'l', description: 'Me gusta al post enfocado' },
  { keys: 't', description: 'Repostear el post enfocado' },
  { keys: 'r', description: 'Responder al post enfocado' },
  { keys: 'n', description: 'Enfocar el cuadro de nuevo post' },
  { keys: '?', description: 'Mostrar esta ayuda' },
]

/** SPECS.md §7.5 / ROADMAP.md 2.10 — opened by use-global-keyboard-shortcuts.ts's "?" handler. */
export function KeyboardShortcutsDialog() {
  const isOpen = useShortcutsDialogStore((state) => state.isOpen)
  const setOpen = useShortcutsDialogStore((state) => state.setOpen)

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Atajos de teclado</DialogTitle>
        <DialogDescription>
          Activos mientras el timeline o los guardados están en pantalla, salvo "n" y "?", que
          funcionan en toda la app.
        </DialogDescription>
        <dl className="mt-2 flex flex-col gap-2 text-sm">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="flex items-center justify-between gap-4">
              <dt>
                <kbd className="rounded border border-border bg-muted px-2 py-1 font-mono text-xs">
                  {shortcut.keys}
                </kbd>
              </dt>
              <dd className="text-muted-foreground">{shortcut.description}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { Button } from '@/components/ui/button'
import { applyTheme, useThemeStore } from '@/lib/theme-store'
import { useEffect } from 'react'

const NEXT_THEME = { light: 'dark', dark: 'system', system: 'light' } as const
const THEME_ICON = { light: '☀️', dark: '🌙', system: '🖥️' } as const

export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)

  // Syncs the DOM attribute with store state — not a data fetch, so this is
  // exactly what useEffect is for (CODESTYLE.md §11 bans it only for data).
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTheme(NEXT_THEME[theme])}
      aria-label={`Tema actual: ${theme}. Cambiar tema.`}
    >
      {THEME_ICON[theme]}
    </Button>
  )
}

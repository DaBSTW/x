// Runs before paint (next/script strategy="beforeInteractive") so the manual
// theme override applies before first render — no flash of the wrong theme.
// Kept as a static file rather than an inline script: CODESTYLE.md §11 bans
// dangerouslySetInnerHTML with no exception, and next/script's own inline
// mode is implemented with it internally.
;(() => {
  try {
    const raw = localStorage.getItem('x-theme')
    const theme = raw ? JSON.parse(raw).state.theme : 'system'
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme)
    }
  } catch (_error) {
    // Best-effort: worst case is a system-theme flash, never a broken page.
  }
})()

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        primary: 'var(--color-primary)',
        muted: 'var(--color-muted)',
        border: 'var(--color-border)',
        destructive: 'var(--color-destructive)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
    },
  },
}

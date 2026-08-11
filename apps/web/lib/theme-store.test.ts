import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, useThemeStore } from './theme-store.js'

describe('useThemeStore', () => {
  afterEach(() => {
    useThemeStore.setState({ theme: 'system' })
  })

  it('defaults to system', () => {
    expect(useThemeStore.getState().theme).toBe('system')
  })

  it('updates the theme', () => {
    useThemeStore.getState().setTheme('dark')
    expect(useThemeStore.getState().theme).toBe('dark')
  })
})

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it('sets data-theme for an explicit light/dark choice', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('removes data-theme for "system"', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

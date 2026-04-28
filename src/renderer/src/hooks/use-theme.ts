import { useEffect } from 'react'
import { useSettingsStore } from '@renderer/store/settings.store'
import { useUIStore } from '@renderer/store/ui.store'

/**
 * Applies the current theme as a `data-theme` attribute on `<html>`.
 * Watches system dark-mode preference when theme is set to 'system'.
 */
export function useTheme(): void {
  const prefsTheme = useSettingsStore((s) => s.prefs.theme)
  const uiTheme = useUIStore((s) => s.theme)
  const setUITheme = useUIStore((s) => s.setTheme)

  // Sync prefs theme → ui store when prefs load
  useEffect(() => {
    if (prefsTheme) setUITheme(prefsTheme)
  }, [prefsTheme, setUITheme])

  // Apply data-theme attribute to <html>
  useEffect(() => {
    const html = document.documentElement

    function apply(theme: string): void {
      if (theme === 'dark') {
        html.setAttribute('data-theme', 'dark')
      } else {
        html.removeAttribute('data-theme')
      }
    }

    if (uiTheme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      apply(mq.matches ? 'dark' : 'light')

      const listener = (e: MediaQueryListEvent): void => apply(e.matches ? 'dark' : 'light')
      mq.addEventListener('change', listener)
      return () => mq.removeEventListener('change', listener)
    }

    apply(uiTheme)
    return undefined
  }, [uiTheme])
}

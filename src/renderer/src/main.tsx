import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

// Route to the tray popover or the main dashboard based on the ?window URL param.
// The tray BrowserWindow loads the same index.html with ?window=tray appended.
const windowParam = new URLSearchParams(window.location.search).get('window')

async function bootstrap(): Promise<void> {
  let Component: React.ComponentType

  if (windowParam === 'tray') {
    const { default: TrayApp } = await import('./tray-app')
    Component = TrayApp
  } else if (windowParam === 'update') {
    const { default: UpdateApp } = await import('./update-app')
    Component = UpdateApp
  } else if (windowParam === 'about') {
    const { default: AboutApp } = await import('./about-app')
    Component = AboutApp
  } else if (windowParam === 'onboarding') {
    const { default: OnboardingApp } = await import('./onboarding-app')
    Component = OnboardingApp
  } else {
    const { default: App } = await import('./app')
    Component = App
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Component />
    </React.StrictMode>
  )
}

bootstrap()

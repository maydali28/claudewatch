import React from 'react'
import TitleBar from './title-bar'
import LeftRail from './left-rail'
import MiddleSidebar from './middle-sidebar'
import MainPanel from './main-panel'
export default function DashboardShell(): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground overflow-hidden">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        <LeftRail />
        <MiddleSidebar />
        <MainPanel />
      </div>
    </div>
  )
}

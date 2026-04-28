import React, { useEffect, useState, useMemo } from 'react'
import { RefreshCw, Search, X, FolderOpen } from 'lucide-react'
import { useSessionsStore } from '@renderer/store/sessions.store'
import { Skeleton } from '@renderer/components/ui/skeleton'
import ProjectTree from './project-tree'

export default function SessionsSidebar(): React.JSX.Element {
  const {
    projects,
    activeSessionId,
    liveSessionIds,
    isLoadingProjects,
    sessionError,
    loadProjects,
    loadParsedSession,
    setActiveProject,
  } = useSessionsStore()

  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  function handleSelectSession(sessionId: string, projectId: string): void {
    setActiveProject(projectId)
    loadParsedSession(sessionId, projectId)
  }

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects

    const q = searchQuery.toLowerCase()

    return projects
      .map((project) => {
        const projectMatches = project.name.toLowerCase().includes(q)
        const filteredSessions = projectMatches
          ? project.sessions
          : project.sessions.filter((s) => (s.title || s.id).toLowerCase().includes(q))

        if (filteredSessions.length === 0) return null

        return { ...project, sessions: filteredSessions }
      })
      .filter(Boolean) as typeof projects
  }, [projects, searchQuery])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Sessions
          </span>
          {projects.length > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {projects.reduce((acc, p) => acc + p.sessions.length, 0)}
            </span>
          )}
        </div>
        <button
          onClick={loadProjects}
          disabled={isLoadingProjects}
          className="p-1 rounded hover:bg-accent transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 text-muted-foreground ${isLoadingProjects ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {/* Search bar */}
      <div className="px-2 py-1.5 border-b border-border/30">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects or sessions…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="p-0.5 hover:text-foreground text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoadingProjects && projects.length === 0 && (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )}

        {!isLoadingProjects && sessionError && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <p className="text-xs text-destructive font-medium">Failed to load projects</p>
            <p className="text-[10px] text-muted-foreground mt-1 break-all">{sessionError}</p>
          </div>
        )}

        {!isLoadingProjects && !sessionError && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-3">
            <FolderOpen className="h-6 w-6 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No projects found</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Start a session in Claude Code to see it here
            </p>
          </div>
        )}

        {!isLoadingProjects &&
          !sessionError &&
          projects.length > 0 &&
          filteredProjects.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-xs text-muted-foreground">
                No matches for &quot;{searchQuery}&quot;
              </p>
            </div>
          )}

        {filteredProjects.map((project) => (
          <ProjectTree
            key={project.id}
            project={project}
            sessions={project.sessions}
            activeSessionId={activeSessionId}
            liveSessionIds={liveSessionIds}
            onSelectSession={handleSelectSession}
            searchQuery={searchQuery}
          />
        ))}
      </div>
    </div>
  )
}

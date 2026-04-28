import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Eye, Code, FolderOpen } from 'lucide-react'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Skeleton } from '@renderer/components/ui/skeleton'
import PlansSidebar from './plans-sidebar'
import MarkdownRenderer from '@renderer/components/shared/markdown-renderer'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/store/ui.store'
import type { PlanSummary, PlanDetail } from '@shared/types'

// React Query keys for plan data. Centralised so the refresh button can
// invalidate everything in one call without depending on internal cache shape.
const PLANS_LIST_KEY = ['plans', 'list'] as const
const planDetailKey = (filename: string) => ['plans', 'detail', filename] as const
const planProjectsKey = (filename: string) => ['plans', 'projects', filename] as const

async function fetchPlansList(): Promise<PlanSummary[]> {
  const result = await ipc.plans.list()
  if (!result.ok) throw new Error(result.error)
  return result.data
}

async function fetchPlanDetail(filename: string): Promise<PlanDetail> {
  const result = await ipc.plans.get(filename)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

async function fetchPlanProjects(filename: string): Promise<string[]> {
  const slug = filename.replace(/\.md$/, '')
  const result = await ipc.plans.getProjects(slug)
  // Non-critical — badges just don't appear on failure.
  return result.ok ? result.data : []
}

function BodySection({ content }: { content: string }): React.JSX.Element {
  const [mode, setMode] = useState<'preview' | 'raw'>('preview')
  const lineCount = content.split('\n').length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-header */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-border/40 shrink-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
          Content ({lineCount} lines)
        </p>
        <div className="flex items-center rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setMode('preview')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors',
              mode === 'preview'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
          <button
            onClick={() => setMode('raw')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors border-l border-border',
              mode === 'raw'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            <Code className="h-3 w-3" />
            Raw
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {mode === 'preview' ? (
          <div className="max-w-3xl mx-auto px-6 py-6">
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          <pre className="max-w-3xl mx-auto px-6 py-6 text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
            {content}
          </pre>
        )}
      </ScrollArea>
    </div>
  )
}

export default function PlansPanel(): React.JSX.Element {
  const queryClient = useQueryClient()
  const plansQuery = useQuery({ queryKey: PLANS_LIST_KEY, queryFn: fetchPlansList })
  const plans = plansQuery.data ?? []
  const isLoadingList = plansQuery.isLoading
  const error = plansQuery.error ? String(plansQuery.error.message ?? plansQuery.error) : null

  // `userSelectedId` holds an explicit user choice; `null` means "fall back to
  // the first plan." Deriving the effective id during render — instead of
  // copying the default into state via an effect — keeps the source of truth
  // in one place and removes the need for a sync effect.
  const [userSelectedId, setUserSelectedId] = useState<string | null>(null)
  const selectedId = userSelectedId ?? plans[0]?.id ?? null

  const detailQuery = useQuery({
    queryKey: selectedId ? planDetailKey(selectedId) : ['plans', 'detail', null],
    queryFn: () => fetchPlanDetail(selectedId!),
    enabled: !!selectedId,
  })
  const detail = detailQuery.data ?? null
  const isLoadingDetail = !!selectedId && detailQuery.isLoading

  const projectsQuery = useQuery({
    queryKey: selectedId ? planProjectsKey(selectedId) : ['plans', 'projects', null],
    queryFn: () => fetchPlanProjects(selectedId!),
    enabled: !!selectedId,
  })
  const planProjects = projectsQuery.data ?? []

  const refreshPlans = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['plans'] })
  }, [queryClient])

  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarWidthRef = useRef(sidebarWidth)
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizing(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      const startX = e.clientX
      const startWidth = sidebarWidthRef.current

      const onMove = (ev: MouseEvent): void => {
        const next = Math.max(180, Math.min(400, startWidth + ev.clientX - startX))
        // Update CSS variable directly — no React re-render during drag
        containerRef.current?.style.setProperty('--sidebar-w', `${next}px`)
        sidebarWidthRef.current = next
      }
      const onUp = (): void => {
        setIsResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        // Commit final value to store once, triggering a single re-render
        setSidebarWidth(sidebarWidthRef.current)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setSidebarWidth]
  )

  const selectedPlan = plans.find((p) => p.id === selectedId)

  return (
    <div
      ref={containerRef}
      className="flex h-full"
      style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
    >
      {/* Sidebar */}
      <div
        className="relative shrink-0 border-r bg-muted/20 overflow-hidden flex flex-col"
        style={{ width: 'var(--sidebar-w)' }}
      >
        <PlansSidebar
          plans={plans}
          selectedId={selectedId}
          onSelect={setUserSelectedId}
          isLoading={isLoadingList}
          onRefresh={refreshPlans}
        />
        <div
          onMouseDown={onMouseDown}
          className={cn(
            'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none',
            'hover:bg-primary/30 transition-colors',
            isResizing && 'bg-primary/50'
          )}
          aria-hidden
        />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b px-4 py-3 flex items-center gap-3 shrink-0">
          {selectedPlan ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <h2 className="text-sm font-semibold truncate">{selectedPlan.title}</h2>
              <span className="text-xs text-muted-foreground font-mono shrink-0">
                {selectedPlan.filename}
              </span>
              {planProjects.length > 0 && (
                <div className="flex items-center gap-1 ml-1 shrink-0">
                  <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <div className="flex items-center gap-1 flex-wrap">
                    {planProjects.map((p) => (
                      <span
                        key={p}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <h2 className="text-sm font-semibold flex-1 text-muted-foreground">Plans</h2>
          )}
        </div>

        {/* Body */}
        {error ? (
          <div className="flex-1 flex items-center justify-center text-sm text-destructive p-4">
            {error}
          </div>
        ) : !selectedId || plans.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <FileText className="h-10 w-10 opacity-20" />
            <p className="text-sm">
              No plans found in <span className="font-mono">~/.claude/plans/</span>
            </p>
            <p className="text-xs">
              Plans are markdown files created by Claude Code&apos;s /plan command.
            </p>
          </div>
        ) : isLoadingDetail ? (
          <div className="p-6 space-y-3 max-w-3xl mx-auto w-full">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton
                key={i}
                className={`h-4 rounded ${i === 0 ? 'w-3/4' : i % 3 === 0 ? 'w-1/2' : 'w-full'}`}
              />
            ))}
          </div>
        ) : detail ? (
          <BodySection content={detail.content} />
        ) : null}
      </div>
    </div>
  )
}

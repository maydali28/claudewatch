import React from 'react'
import ReactDOM from 'react-dom'
import { DayPicker, type DateRange as DayPickerRange } from 'react-day-picker'
import { format } from 'date-fns'
import { RefreshCw, Calendar } from 'lucide-react'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@renderer/components/ui/tabs'
import { cn } from '@renderer/lib/cn'
import { useAnalyticsStore } from '@renderer/store/analytics.store'
import { useSessionsStore } from '@renderer/store/sessions.store'
import { OverviewTab } from './tabs/overview-tab'
import { InsightsTab } from './tabs/insights-tab'
import { CacheTab } from './tabs/cache-tab'
import { ModelsTab } from './tabs/models-tab'
import { LatencyTab } from './tabs/latency-tab'
import { EffortTab } from './tabs/effort-tab'
import type { DateRange, DateRangePreset } from '@shared/types'

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'insights', label: 'Insights' },
  { id: 'cache', label: 'Cache' },
  { id: 'models', label: 'Models' },
  { id: 'latency', label: 'Latency' },
  { id: 'effort', label: 'Effort' },
] as const

type TabId = (typeof TABS)[number]['id']

// ─── Time range toolbar ───────────────────────────────────────────────────────

const QUICK_RANGES: { label: string; value: DateRangePreset }[] = [
  { label: 'Today', value: 'today' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: 'All', value: 'all' },
]

function isPreset(range: DateRange): range is DateRangePreset {
  return typeof range === 'string'
}

function TimeRangeToolbar(): React.JSX.Element {
  const { dateRange, isLoading, setDateRange, refresh } = useAnalyticsStore()
  const [customOpen, setCustomOpen] = React.useState(false)
  const [range, setRange] = React.useState<DayPickerRange | undefined>(undefined)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const popoverRef = React.useRef<HTMLDivElement>(null)
  const [popoverPos, setPopoverPos] = React.useState({ top: 0, left: 0 })

  function openPopover(): void {
    setCustomOpen((v) => {
      if (!v && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect()
        setPopoverPos({ top: rect.bottom + 4, left: rect.left })
        // Restore selection from current dateRange if it's a custom range
        if (!isPreset(dateRange)) {
          const dr = dateRange as { from: string; to: string }
          const [fy, fm, fd] = dr.from.split('-').map(Number)
          const [ty, tm, td] = dr.to.split('-').map(Number)
          setRange({ from: new Date(fy, fm - 1, fd), to: new Date(ty, tm - 1, td) })
        } else {
          setRange(undefined)
        }
      }
      return !v
    })
  }

  React.useEffect(() => {
    if (!customOpen) return
    function handle(e: MouseEvent): void {
      if (buttonRef.current?.contains(e.target as Node)) return
      if (popoverRef.current?.contains(e.target as Node)) return
      setCustomOpen(false)
    }
    const id = window.setTimeout(() => document.addEventListener('mousedown', handle), 100)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', handle)
    }
  }, [customOpen])

  function handleSelect(selected: DayPickerRange | undefined): void {
    setRange(selected)
  }

  function handleApply(): void {
    if (range?.from) {
      const from = format(range.from, 'yyyy-MM-dd')
      const to = format(range.to ?? range.from, 'yyyy-MM-dd')
      setDateRange({ preset: 'custom', from, to })
      setCustomOpen(false)
    }
  }

  const activePreset = isPreset(dateRange) ? dateRange : null
  const isCustom = !isPreset(dateRange)

  return (
    <div className="flex items-center gap-1.5">
      {/* Inline preset pills */}
      <div className="flex items-center rounded-md border border-border bg-background p-0.5 gap-0.5">
        {QUICK_RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => setDateRange(r.value)}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
              activePreset === r.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Custom range */}
      <button
        ref={buttonRef}
        onClick={openPopover}
        className={cn(
          'flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent',
          isCustom && 'border-primary/50 bg-primary/10 text-primary',
          customOpen && 'border-primary/50 bg-accent'
        )}
        title="Custom date range"
      >
        <Calendar className="h-3 w-3" />
        {isCustom
          ? `${(dateRange as { from: string; to: string }).from} – ${(dateRange as { from: string; to: string }).to}`
          : 'Custom'}
      </button>

      {customOpen &&
        ReactDOM.createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            style={{ position: 'fixed', top: popoverPos.top, left: popoverPos.left, zIndex: 9999 }}
            className="cdp rounded-lg border border-border bg-popover shadow-lg p-3"
          >
            <DayPicker
              mode="range"
              selected={range}
              onSelect={(selected) => handleSelect(selected)}
              captionLayout="label"
              endMonth={new Date()}
              style={{ fontSize: '12px' }}
            />
            {range?.from && (
              <div className="border-t border-border pt-1.5 mt-1 flex justify-between items-center">
                <button
                  onClick={() => setRange(undefined)}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors"
                >
                  Clear
                </button>
                <button
                  onClick={handleApply}
                  className="text-xs font-medium bg-primary text-primary-foreground px-2.5 py-1 rounded hover:bg-primary/85 transition-colors"
                >
                  Apply
                </button>
              </div>
            )}
          </div>,
          document.body
        )}

      {/* Refresh */}
      <button
        onClick={() => refresh(true)}
        disabled={isLoading}
        title="Refresh"
        className="flex items-center justify-center rounded-md border border-border bg-background p-1.5 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
      </button>
    </div>
  )
}

// ─── Loading skeletons ────────────────────────────────────────────────────────

function LoadingState(): React.JSX.Element {
  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-52 rounded-lg" />
        ))}
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function AnalyticsPanel(): React.JSX.Element {
  const { analyticsData, isLoading, error, refresh } = useAnalyticsStore()
  const [activeTab, setActiveTab] = React.useState<TabId>('overview')
  useSessionsStore()

  React.useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar: time range + tabs */}
      <div className="shrink-0 border-b border-border/60 bg-background px-4 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <TimeRangeToolbar />
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} className="w-auto">
          <TabsList className="h-8">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="px-2.5 py-1 text-xs">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading */}
        {isLoading && !analyticsData && <LoadingState />}

        {/* Error */}
        {error && !isLoading && (
          <div className="flex h-full items-center justify-center p-8 text-sm text-destructive">
            Failed to load analytics: {error}
          </div>
        )}

        {/* Empty */}
        {!analyticsData && !isLoading && !error && (
          <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
            Select a time range to load analytics.
          </div>
        )}

        {/* Tab content */}
        {analyticsData && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
            <TabsContent value="overview" className="mt-0 p-4">
              <OverviewTab data={analyticsData} />
            </TabsContent>
            <TabsContent value="insights" className="mt-0 p-4">
              <InsightsTab data={analyticsData} />
            </TabsContent>
            <TabsContent value="cache" className="mt-0 p-4">
              <CacheTab data={analyticsData.cacheAnalytics} />
            </TabsContent>
            <TabsContent value="models" className="mt-0 p-4">
              <ModelsTab data={analyticsData} />
            </TabsContent>
            <TabsContent value="latency" className="mt-0 p-4">
              <LatencyTab data={analyticsData.latencyAnalytics} />
            </TabsContent>
            <TabsContent value="effort" className="mt-0 p-4">
              <EffortTab data={analyticsData} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}

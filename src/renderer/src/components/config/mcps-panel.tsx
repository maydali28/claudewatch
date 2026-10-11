import React, { useEffect, useMemo, useState } from 'react'
import { Check, Copy, FileText, Info, LayoutGrid, Search, Server, Wrench, X } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc-client'
import { useConfigStore } from '@renderer/store/config.store'
import { EmptyState } from '@renderer/components/shared/empty-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import MarkdownBody from '@renderer/components/shared/markdown-body'
import { useClaudePaths, type ClaudePaths } from '@renderer/hooks/use-claude-paths'
import { abbreviateHome } from '@renderer/components/plans/group-plans'
import { formatCost } from '@shared/utils/format-cost'
import type { McpServerEntry, ToolSummary } from '@shared/types'
import { relativeDay } from './skill-usage'
import {
  mcpCliCommands,
  mcpLevelLabel,
  mcpOriginNote,
  mcpToolRows,
  mcpTransport,
  type McpToolRow,
} from './mcp-labels'

// Mirrors getClaudeJsonPath()'s own default-vs-override branch (see
// @main/lib/claude-paths): the app:get-paths IPC result only carries
// `claudeDir`/`display`/`source`, not a separate .claude.json path, so the
// display string for it is derived the same way here.
function claudeJsonDisplay(paths: ClaudePaths): string {
  return paths.source === 'default' ? '~/.claude.json' : `${paths.display}/.claude.json`
}

const LEVEL_COLORS: Record<string, string> = {
  global: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  project: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  local: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  plugin: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  connector: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  builtin: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
}

const STATUS_TAGS: Record<string, { label: string; className: string }> = {
  connected: {
    label: 'connected',
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  failed: { label: 'failed', className: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  'needs-auth': {
    label: 'needs auth',
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
}

const TRANSPORT_COLORS: Record<string, string> = {
  stdio: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  sse: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  http: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
}

const TAG = 'text-[10px] font-semibold px-2 py-0.5 rounded uppercase'

/** Tools listed before "Show all" when none was called in the period. */
const COLLAPSED_TOOLS = 10

/** The period the usage figures cover. */
const USAGE_RANGE = '30d'
const USAGE_RANGE_LABEL = 'last 30 days'

// ─── Usage ────────────────────────────────────────────────────────────────────

// One fetch shared by every server's page, kept for a minute so moving
// between servers or views does not recompute the analytics each time.
let usageCache: { at: number; tools: ToolSummary[] } | null = null
const USAGE_TTL_MS = 60_000

/**
 * Per-tool usage over {@link USAGE_RANGE}, all projects; null until the first
 * fetch lands. A cached result shows at once and is refetched when stale.
 */
function useToolUsage(): ToolSummary[] | null {
  const [tools, setTools] = useState<ToolSummary[] | null>(usageCache?.tools ?? null)
  useEffect(() => {
    if (usageCache && Date.now() - usageCache.at < USAGE_TTL_MS) return
    let cancelled = false
    ipc.analytics
      .get({ dateRange: USAGE_RANGE })
      .then((r) => {
        if (!r.ok) return
        usageCache = { at: Date.now(), tools: r.data.toolUsage.tools }
        if (!cancelled) setTools(usageCache.tools)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return tools
}

// ─── Small parts ──────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  function handleCopy(): void {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button
      onClick={handleCopy}
      className="ml-auto shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
      {children}
    </p>
  )
}

function DetailRow({
  label,
  children,
  copyValue,
}: {
  label: string
  children: React.ReactNode
  copyValue?: string
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-3 items-start px-4 py-3 border-b border-border/30 last:border-0">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold pt-0.5">
        {label}
      </span>
      <div className="flex items-start gap-1 min-w-0">
        <div className="flex-1 min-w-0">{children}</div>
        {copyValue && <CopyButton value={copyValue} />}
      </div>
    </div>
  )
}

function StatPill({
  label,
  value,
  title,
}: {
  label: string
  value: string | number
  title?: string
}): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg bg-muted/50 border border-border/40 min-w-[4.5rem]"
      title={title}
    >
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  )
}

function MaskedKeys({ keys }: { keys: string[] }): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      {keys.map((key) => (
        <div key={key} className="flex items-center gap-1.5">
          <code className="text-xs font-mono text-foreground">{key}</code>
          <span className="text-[10px] text-muted-foreground">=</span>
          <code className="text-xs font-mono text-muted-foreground flex-1">••••••••</code>
          <CopyButton value={key} />
        </div>
      ))}
    </div>
  )
}

// ─── Sections ─────────────────────────────────────────────────────────────────

/** Why the server is not working, or is off, and what to do about it. */
function Notice({ mcp }: { mcp: McpServerEntry }): React.JSX.Element | null {
  let tone: 'error' | 'warn' | 'muted'
  let title: string
  let body: React.ReactNode
  if (mcp.disabled) {
    tone = 'muted'
    title = 'Turned off'
    body =
      mcp.level === 'plugin'
        ? 'Its plugin is disabled, so Claude Code does not start it.'
        : 'Disabled for this project in ~/.claude.json, so Claude Code does not start it.'
  } else if (mcp.status === 'failed') {
    tone = 'error'
    title = 'Connection failed'
    body = mcp.error ? (
      <pre className="font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
        {mcp.error}
      </pre>
    ) : (
      'Claude Code could not start or reach it.'
    )
  } else if (mcp.status === 'needs-auth') {
    tone = 'warn'
    title = 'Needs authentication'
    body =
      mcp.level === 'connector'
        ? 'Connect it again in claude.ai’s connector settings.'
        : 'Run /mcp in Claude Code and choose this server to sign in.'
  } else {
    return null
  }
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
        tone === 'error' && 'border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400',
        tone === 'warn' && 'border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-400',
        tone === 'muted' && 'border-border bg-muted/30 text-muted-foreground'
      )}
    >
      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <div className="mt-0.5 opacity-90">{body}</div>
      </div>
      {mcp.lastSeen && (
        <span className="text-[10px] text-muted-foreground shrink-0">
          {relativeDay(mcp.lastSeen)}
        </span>
      )}
    </div>
  )
}

function ToolsSection({
  rows,
  loadingUsage,
}: {
  rows: McpToolRow[]
  loadingUsage: boolean
}): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const [showAll, setShowAll] = useState(false)
  const q = filter.toLowerCase()
  const matching = rows.filter((r) => r.name.toLowerCase().includes(q))
  // Called tools first; the rest wait behind a toggle so a large server does
  // not push the other sections out of view. Filtering searches them all.
  const called = rows.filter((r) => r.calls > 0)
  const preview = called.length > 0 ? called : rows.slice(0, COLLAPSED_TOOLS)
  const collapsible = !loadingUsage && !q && preview.length < rows.length
  const shown = collapsible && !showAll ? preview : matching

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <SectionTitle>Tools ({rows.length})</SectionTitle>
        {rows.length > 8 && (
          <div className="ml-auto mb-2 flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-0.5 w-48">
            <Search className="h-3 w-3 text-muted-foreground shrink-0" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter tools…"
              className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
            />
            {filter && (
              <button
                onClick={() => setFilter('')}
                className="p-0.5 hover:text-foreground text-muted-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground text-center">
          No tools known yet. They are listed once a Claude Code session connects to this server.
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-1.5 text-left font-medium">Tool</th>
                <th className="px-3 py-1.5 text-right font-medium">Calls</th>
                <th className="px-3 py-1.5 text-right font-medium">Errors</th>
                <th className="px-3 py-1.5 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.name} className="border-b border-border/30 last:border-0">
                  <td className="px-3 py-1.5 font-mono">{r.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {loadingUsage ? (
                      '…'
                    ) : r.calls ? (
                      r.calls.toLocaleString()
                    ) : (
                      <span className="text-muted-foreground/50">0</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-1.5 text-right tabular-nums',
                      r.errors > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground/50'
                    )}
                  >
                    {loadingUsage ? '…' : r.errors}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {loadingUsage ? '…' : r.calls ? formatCost(r.costUsd) : '–'}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-center text-muted-foreground">
                    No tools match &quot;{filter}&quot;
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {collapsible && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-1.5 text-[11px] font-medium text-primary hover:underline"
        >
          {showAll
            ? called.length > 0
              ? 'Show called tools only'
              : 'Show fewer'
            : `Show all ${rows.length} tools`}
        </button>
      )}
      {rows.length > 0 && (
        <p className="mt-1.5 text-[10px] text-muted-foreground/70">
          Calls, errors and estimated cost over the {USAGE_RANGE_LABEL}, across all projects.
        </p>
      )}
    </div>
  )
}

function ConnectionSection({ mcp }: { mcp: McpServerEntry }): React.JSX.Element {
  const envKeys = Object.keys(mcp.env)
  const fullCommand = mcp.command ? [mcp.command, ...mcp.args].join(' ') : null
  const origin = mcpOriginNote(mcp)
  const hasConfig = Boolean(mcp.command || mcp.url)

  return (
    <div>
      <SectionTitle>Connection</SectionTitle>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {!hasConfig && (
          <DetailRow label="Provided by">
            <span className="text-xs text-foreground">
              {origin ?? 'Claude Code'}
              <span className="text-muted-foreground"> · no local configuration to show</span>
            </span>
          </DetailRow>
        )}

        {fullCommand && (
          <DetailRow label="Command" copyValue={fullCommand}>
            <code className="text-xs font-mono text-foreground break-all">{fullCommand}</code>
          </DetailRow>
        )}

        {mcp.args.length > 0 && (
          <DetailRow label={`Args (${mcp.args.length})`}>
            <div className="flex flex-wrap gap-1">
              {mcp.args.map((arg, i) => (
                <code key={i} className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                  {arg}
                </code>
              ))}
            </div>
          </DetailRow>
        )}

        {mcp.url && (
          <DetailRow label="URL" copyValue={mcp.url}>
            <code className="text-xs font-mono text-foreground break-all">{mcp.url}</code>
          </DetailRow>
        )}

        {envKeys.length > 0 && (
          <DetailRow label={`Env (${envKeys.length})`}>
            <MaskedKeys keys={envKeys} />
          </DetailRow>
        )}

        {mcp.headerNames && mcp.headerNames.length > 0 && (
          <DetailRow label={`Headers (${mcp.headerNames.length})`}>
            <MaskedKeys keys={mcp.headerNames} />
          </DetailRow>
        )}

        {mcp.capabilities?.serverVersion && (
          <DetailRow label="Server">
            <span className="text-xs text-foreground">
              {mcp.capabilities.serverVersion.name} v{mcp.capabilities.serverVersion.version}
            </span>
          </DetailRow>
        )}
      </div>
    </div>
  )
}

function SourceSection({ mcp }: { mcp: McpServerEntry }): React.JSX.Element {
  const paths = useClaudePaths()
  const commands = mcpCliCommands(mcp)
  const owner = mcp.projectName ?? mcp.pluginName
  const file = mcp.sourcePath
    ? abbreviateHome(mcp.sourcePath, paths)
    : mcp.level === 'connector'
      ? 'claude.ai account'
      : mcp.level === 'builtin'
        ? 'Claude Code'
        : `${claudeJsonDisplay(paths)} or ${paths.display}/settings.json`

  return (
    <div>
      <SectionTitle>Source</SectionTitle>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <DetailRow label="Scope">
          <div className="flex items-center gap-2">
            <span
              className={cn(TAG, LEVEL_COLORS[mcp.level ?? ''] ?? 'bg-muted text-muted-foreground')}
            >
              {mcpLevelLabel(mcp.level)}
            </span>
            {owner && <span className="text-xs text-foreground truncate">{owner}</span>}
          </div>
        </DetailRow>
        <DetailRow label="Defined in" copyValue={mcp.sourcePath}>
          <code className="text-xs font-mono text-muted-foreground break-all">{file}</code>
        </DetailRow>
        {commands.map((c) => (
          <DetailRow key={c.label} label={c.label} copyValue={c.command}>
            <code className="text-xs font-mono text-foreground break-all">{c.command}</code>
          </DetailRow>
        ))}
      </div>
    </div>
  )
}

type McpTab = 'overview' | 'tools' | 'instructions'

// ─── MCP detail view ──────────────────────────────────────────────────────────

function McpDetail({
  mcp,
  usage,
}: {
  mcp: McpServerEntry
  usage: ToolSummary[] | null
}): React.JSX.Element {
  const transport = mcpTransport(mcp)
  const origin = mcpOriginNote(mcp)
  const status = mcp.status ? STATUS_TAGS[mcp.status] : undefined
  const rows = useMemo(() => mcpToolRows(mcp, usage ?? []), [mcp, usage])
  const calls = rows.reduce((n, r) => n + r.calls, 0)
  const errors = rows.reduce((n, r) => n + r.errors, 0)
  const cost = rows.reduce((n, r) => n + r.costUsd, 0)
  const used = rows.filter((r) => r.calls > 0).length
  const loading = usage === null
  const subtitle = mcp.command ? mcp.command.split('/').pop() : (mcp.url ?? origin ?? 'MCP server')
  const owner = mcp.projectName ?? mcp.pluginName
  const [tab, setTab] = useState<McpTab>('overview')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg shrink-0 bg-primary/10">
          <Server className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold truncate">{mcp.name}</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {subtitle}
            {owner && <> · {owner}</>}
            {mcp.lastSeen && <> · status from {relativeDay(mcp.lastSeen)}</>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {status && (
            <span
              className={cn(TAG, status.className)}
              title={mcp.lastSeen ? `As of ${new Date(mcp.lastSeen).toLocaleString()}` : undefined}
            >
              {status.label}
            </span>
          )}
          {transport && (
            <span
              className={cn(TAG, TRANSPORT_COLORS[transport] ?? 'bg-muted text-muted-foreground')}
            >
              {transport}
            </span>
          )}
          {mcp.level && (
            <span className={cn(TAG, LEVEL_COLORS[mcp.level] ?? 'bg-muted text-muted-foreground')}>
              {mcpLevelLabel(mcp.level)}
            </span>
          )}
          {mcp.disabled && (
            <span className={cn(TAG, 'bg-muted text-muted-foreground')}>disabled</span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-2 px-6 py-3 border-b border-border/30">
        <StatPill
          label="Tools"
          value={mcp.toolCount ?? '—'}
          title="Tools the server offered when it last connected"
        />
        <StatPill
          label="Used"
          value={loading ? '…' : used}
          title={`Tools called at least once in the ${USAGE_RANGE_LABEL}`}
        />
        <StatPill
          label="Calls"
          value={loading ? '…' : calls.toLocaleString()}
          title={`Calls in the ${USAGE_RANGE_LABEL}, all projects`}
        />
        <StatPill
          label="Error rate"
          value={loading ? '…' : calls ? `${((errors / calls) * 100).toFixed(1)}%` : '—'}
          title={`${errors} failed calls in the ${USAGE_RANGE_LABEL}`}
        />
        <StatPill
          label="Est. cost"
          value={loading ? '…' : formatCost(cost)}
          title="Estimated cost of the responses that made the calls, split evenly when a response called several tools"
        />
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as McpTab)}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <div className="px-6 pt-4 shrink-0 flex justify-end">
          <TabsList>
            <TabsTrigger value="overview" className="gap-1.5">
              <LayoutGrid className="h-3.5 w-3.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="tools" className="gap-1.5">
              <Wrench className="h-3.5 w-3.5" />
              Tools
              <span className="tabular-nums text-muted-foreground">{rows.length}</span>
            </TabsTrigger>
            <TabsTrigger value="instructions" disabled={!mcp.instructions} className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Instructions
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="flex-1 overflow-y-auto px-6 pb-6 mt-3 space-y-5">
          <Notice mcp={mcp} />
          <ConnectionSection mcp={mcp} />
          <SourceSection mcp={mcp} />
        </TabsContent>

        <TabsContent value="tools" className="flex-1 overflow-y-auto px-6 pb-6 mt-3">
          <ToolsSection rows={rows} loadingUsage={loading} />
        </TabsContent>

        <TabsContent value="instructions" className="flex-1 overflow-y-auto px-6 pb-6 mt-3">
          {mcp.instructions && (
            <MarkdownBody content={mcp.instructions} label="What the server tells Claude" />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function McpsPanel(): React.JSX.Element {
  const { mcps, selectedMcpId } = useConfigStore()
  const usage = useToolUsage()
  const selected = mcps.find((m) => m.id === selectedMcpId) ?? null

  if (!selected)
    return (
      <EmptyState
        icon={Server}
        title="No server selected"
        description="Choose an MCP server from the sidebar to see its tools, usage and configuration"
      />
    )
  // Keyed so the tools filter resets when another server is chosen.
  return <McpDetail key={selected.id} mcp={selected} usage={usage} />
}

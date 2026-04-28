import React, { useState } from 'react'
import { AlertCircle, Check, CheckCircle2, Circle, Copy, Server } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useConfigStore } from '@renderer/store/config.store'
import { EmptyState } from '@renderer/components/shared/empty-state'
import type { McpServerEntry } from '@shared/types'

const LEVEL_COLORS: Record<string, string> = {
  global: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  project: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  local: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
}

const TRANSPORT_COLORS: Record<string, string> = {
  stdio: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  sse: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  http: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
}

// ─── Copy button ──────────────────────────────────────────────────────────────

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

// ─── Detail row ───────────────────────────────────────────────────────────────

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

// ─── Stat pill ────────────────────────────────────────────────────────────────

function StatPill({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg bg-muted/50 border border-border/40">
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  )
}

// ─── Status banner ────────────────────────────────────────────────────────────

function StatusBanner({ mcp }: { mcp: McpServerEntry }): React.JSX.Element | null {
  if (!mcp.status || mcp.status === 'unknown') return null

  if (mcp.status === 'connected') {
    return (
      <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-3 py-2.5">
        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Connected</p>
          {mcp.capabilities?.serverVersion && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {mcp.capabilities.serverVersion.name} v{mcp.capabilities.serverVersion.version}
            </p>
          )}
        </div>
        {mcp.lastSeen && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {new Date(mcp.lastSeen).toLocaleTimeString()}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="mx-6 mt-4 rounded-lg border border-red-500/20 bg-red-500/8 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-red-600 dark:text-red-400">Connection failed</p>
          {mcp.lastSeen && (
            <p className="text-[10px] text-muted-foreground">
              Last attempt: {new Date(mcp.lastSeen).toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>
      {mcp.error && (
        <div className="border-t border-red-500/20 px-3 py-2 bg-red-500/5">
          <pre className="text-[10px] font-mono text-red-600/80 dark:text-red-400/80 whitespace-pre-wrap break-all leading-relaxed max-h-32 overflow-y-auto">
            {mcp.error}
          </pre>
        </div>
      )}
    </div>
  )
}

// ─── Capabilities row ─────────────────────────────────────────────────────────

function CapabilityChip({ label, active }: { label: string; active: boolean }): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-1 text-[10px] px-2 py-1 rounded border font-medium',
        active
          ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-600 dark:text-emerald-400'
          : 'border-border/40 bg-muted/30 text-muted-foreground/50 line-through'
      )}
    >
      <Circle
        className={cn(
          'h-1.5 w-1.5 fill-current',
          active ? 'text-emerald-500' : 'text-muted-foreground/30'
        )}
      />
      {label}
    </div>
  )
}

// ─── MCP detail view ──────────────────────────────────────────────────────────

function McpDetail({ mcp }: { mcp: McpServerEntry }): React.JSX.Element {
  const envKeys = Object.keys(mcp.env)
  const fullCommand = mcp.command ? [mcp.command, ...mcp.args].join(' ') : null
  const transport = mcp.type ?? (mcp.url ? 'sse' : 'stdio')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <div
          className={cn(
            'flex items-center justify-center h-8 w-8 rounded-lg shrink-0',
            mcp.status === 'connected'
              ? 'bg-emerald-500/10'
              : mcp.status === 'failed'
                ? 'bg-red-500/10'
                : 'bg-primary/10'
          )}
        >
          <Server
            className={cn(
              'h-4 w-4',
              mcp.status === 'connected'
                ? 'text-emerald-500'
                : mcp.status === 'failed'
                  ? 'text-red-500'
                  : 'text-primary'
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold truncate">{mcp.name}</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {mcp.command ? mcp.command.split('/').pop() : (mcp.url ?? 'MCP Server')}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {mcp.type && (
            <span
              className={cn(
                'text-[10px] font-semibold px-2 py-0.5 rounded uppercase',
                TRANSPORT_COLORS[mcp.type] ?? 'bg-muted text-muted-foreground'
              )}
            >
              {mcp.type}
            </span>
          )}
          {mcp.level && (
            <span
              className={cn(
                'text-[10px] font-semibold px-2 py-0.5 rounded uppercase',
                LEVEL_COLORS[mcp.level] ?? 'bg-muted text-muted-foreground'
              )}
            >
              {mcp.level}
            </span>
          )}
        </div>
      </div>

      {/* Status banner */}
      <StatusBanner mcp={mcp} />

      {/* Stats */}
      <div className="flex gap-2 px-6 py-3 border-b border-border/30 mt-3">
        <StatPill label="Args" value={mcp.args.length} />
        <StatPill label="Env vars" value={envKeys.length} />
        <StatPill label="Transport" value={transport} />
      </div>

      {/* Detail rows */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Capabilities */}
        {mcp.capabilities && (
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
              Capabilities
            </p>
            <div className="flex flex-wrap gap-1.5">
              <CapabilityChip label="Tools" active={mcp.capabilities.hasTools} />
              <CapabilityChip label="Prompts" active={mcp.capabilities.hasPrompts} />
              <CapabilityChip label="Resources" active={mcp.capabilities.hasResources} />
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {fullCommand && (
            <DetailRow label="Command" copyValue={fullCommand}>
              <code className="text-xs font-mono text-foreground break-all">{fullCommand}</code>
            </DetailRow>
          )}

          {mcp.command && mcp.args.length > 0 && (
            <DetailRow label="Binary">
              <code className="text-xs font-mono text-foreground break-all">{mcp.command}</code>
            </DetailRow>
          )}

          {mcp.args.length > 0 && (
            <DetailRow label="Args">
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
              <div className="space-y-1.5">
                {envKeys.map((key) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <code className="text-xs font-mono text-foreground">{key}</code>
                    <span className="text-[10px] text-muted-foreground">=</span>
                    <code className="text-xs font-mono text-muted-foreground flex-1">
                      {'•'.repeat(Math.min(8, mcp.env[key].length))}
                    </code>
                    <CopyButton value={key} />
                  </div>
                ))}
              </div>
            </DetailRow>
          )}

          <DetailRow label="Config">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'text-[10px] font-semibold px-2 py-0.5 rounded uppercase',
                  LEVEL_COLORS[mcp.level ?? ''] ?? 'bg-muted text-muted-foreground'
                )}
              >
                {mcp.level ?? 'unknown'}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {mcp.level === 'global'
                  ? '~/.claude.json or ~/.claude/settings.json'
                  : mcp.level === 'project'
                    ? 'Project settings.json'
                    : 'Local settings'}
              </span>
            </div>
          </DetailRow>
        </div>
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function McpsPanel(): React.JSX.Element {
  const { mcps, selectedMcpId } = useConfigStore()
  const selected = mcps.find((m) => m.id === selectedMcpId) ?? null

  if (!selected)
    return (
      <EmptyState
        icon={Server}
        title="No server selected"
        description="Choose an MCP server from the sidebar to view its configuration"
      />
    )
  return <McpDetail mcp={selected} />
}

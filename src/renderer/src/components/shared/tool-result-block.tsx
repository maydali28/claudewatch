import React, { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Search,
  FileText,
  FolderSearch,
  Pencil,
  FilePlus,
  Terminal,
  Globe,
  BookOpen,
  List,
  GitBranch,
  Cpu,
  Layers,
  Database,
  MessageSquare,
  Zap,
  Wrench,
} from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import type { AnyCodableValue } from '@shared/types'

function getToolIcon(toolName: string): React.ReactNode {
  const name = toolName.toLowerCase()
  if (name === 'grep') return <Search className="h-3 w-3 shrink-0 text-yellow-500" />
  if (name === 'read') return <FileText className="h-3 w-3 shrink-0 text-blue-500" />
  if (name === 'glob') return <FolderSearch className="h-3 w-3 shrink-0 text-cyan-500" />
  if (name === 'edit') return <Pencil className="h-3 w-3 shrink-0 text-orange-500" />
  if (name === 'write') return <FilePlus className="h-3 w-3 shrink-0 text-emerald-500" />
  if (name === 'bash') return <Terminal className="h-3 w-3 shrink-0 text-purple-500" />
  if (name === 'webfetch' || name === 'websearch')
    return <Globe className="h-3 w-3 shrink-0 text-sky-500" />
  if (name === 'notebookedit') return <BookOpen className="h-3 w-3 shrink-0 text-indigo-500" />
  if (name === 'todowrite' || name === 'todoread')
    return <List className="h-3 w-3 shrink-0 text-pink-500" />
  if (name === 'agent') return <Cpu className="h-3 w-3 shrink-0 text-violet-500" />
  if (name === 'mcp' || name.startsWith('mcp__'))
    return <Layers className="h-3 w-3 shrink-0 text-teal-500" />
  if (name === 'dispatch_agent') return <GitBranch className="h-3 w-3 shrink-0 text-rose-500" />
  if (name.includes('sql') || name.includes('db'))
    return <Database className="h-3 w-3 shrink-0 text-amber-500" />
  if (name.includes('message') || name.includes('chat'))
    return <MessageSquare className="h-3 w-3 shrink-0 text-blue-400" />
  if (name.includes('trigger') || name.includes('run'))
    return <Zap className="h-3 w-3 shrink-0 text-yellow-400" />
  return <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" />
}

interface ToolResultBlockProps {
  toolName: string
  input: Record<string, AnyCodableValue>
  result?: string
  isError?: boolean
  className?: string
}

function renderValue(val: AnyCodableValue): string {
  if (val === null) return 'null'
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}

export default function ToolResultBlock({
  toolName,
  input,
  result,
  isError,
  className,
}: ToolResultBlockProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const inputEntries = Object.entries(input)

  return (
    <div
      className={cn(
        'rounded-md border text-xs',
        isError ? 'border-destructive/50 bg-destructive/5' : 'border-border/50 bg-muted/20',
        className
      )}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left hover:bg-muted/30 transition-colors rounded-t-md"
      >
        {isError ? (
          <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />
        ) : (
          getToolIcon(toolName)
        )}
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn('font-mono font-medium', isError ? 'text-destructive' : 'text-foreground')}
        >
          {toolName}
        </span>
        {!expanded && inputEntries.length > 0 && (
          <span className="ml-2 truncate text-muted-foreground/70">
            {renderValue(inputEntries[0][1]).slice(0, 60)}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-3 pb-3 pt-2 space-y-2">
          {inputEntries.length > 0 && (
            <div>
              <p className="text-muted-foreground font-medium mb-1">Input</p>
              <div className="space-y-1">
                {inputEntries.map(([key, val]) => (
                  <div key={key} className="flex gap-2">
                    <span className="font-mono text-muted-foreground shrink-0">{key}:</span>
                    <span className="font-mono break-all text-foreground/80">
                      {renderValue(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {result !== undefined && result !== '' && (
            <div>
              <p
                className={cn(
                  'font-medium mb-1',
                  isError ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                {isError ? 'Error' : 'Result'}
              </p>
              <pre className="font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-48 text-foreground/80 leading-relaxed">
                {result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

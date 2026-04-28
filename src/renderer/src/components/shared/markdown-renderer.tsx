import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@renderer/lib/cn'

interface MarkdownRendererProps {
  content: string
  className?: string
  variant?: 'default' | 'inverted'
}

export default function MarkdownRenderer({
  content,
  className,
  variant = 'default',
}: MarkdownRendererProps): React.JSX.Element {
  const inv = variant === 'inverted'

  return (
    <div className={cn('text-sm', !inv && 'text-foreground', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-sm font-bold mt-3 mb-1 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-semibold mt-3 mb-1 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3
              className={cn(
                'text-xs font-semibold mt-2 mb-1 first:mt-0',
                inv ? 'opacity-70' : 'text-muted-foreground'
              )}
            >
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="my-1 leading-snug">{children}</p>,
          ul: ({ children }) => <ul className="my-1 space-y-0.5 pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 space-y-0.5 pl-4 list-decimal">{children}</ol>,
          li: ({ children }) => (
            <li className="flex items-start gap-1.5 leading-snug">
              <span
                className={cn(
                  'mt-1.5 h-1 w-1 shrink-0 rounded-full',
                  inv ? 'bg-current opacity-60' : 'bg-muted-foreground/60'
                )}
              />
              <span>{children}</span>
            </li>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className={cn(
                'underline underline-offset-2 hover:opacity-80',
                inv ? 'text-inherit' : 'text-primary'
              )}
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code
              className={cn(
                'rounded px-1 py-0.5 font-mono text-xs',
                inv ? 'bg-black/20' : 'bg-muted'
              )}
            >
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre
              className={cn(
                'my-2 overflow-x-auto rounded p-2 text-xs font-mono',
                inv ? 'bg-black/20' : 'bg-muted'
              )}
            >
              {children}
            </pre>
          ),
          hr: () => (
            <hr className={cn('my-2', inv ? 'border-current opacity-30' : 'border-border')} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

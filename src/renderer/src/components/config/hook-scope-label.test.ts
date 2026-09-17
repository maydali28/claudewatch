import { describe, expect, it } from 'vitest'
import { formatHookTimeout, hookScopeLabel, hookScopeOrder } from './hook-scope-label'

describe('hookScopeLabel', () => {
  it('labels a user-scope rule "user"', () => {
    expect(hookScopeLabel({ scope: 'user' })).toBe('user')
  })

  it('labels a project-scope rule "<project> · project"', () => {
    expect(hookScopeLabel({ scope: 'project', projectName: 'claudewatch' })).toBe(
      'claudewatch · project'
    )
  })

  it('labels a local-scope rule "<project> · local"', () => {
    expect(hookScopeLabel({ scope: 'local', projectName: 'claudewatch' })).toBe(
      'claudewatch · local'
    )
  })

  it('falls back to a generic label when a project-scope rule has no projectName', () => {
    expect(hookScopeLabel({ scope: 'project' })).toBe('project')
  })

  it('falls back to a generic label when a local-scope rule has no projectName', () => {
    expect(hookScopeLabel({ scope: 'local' })).toBe('local')
  })

  it('ignores projectName for the user scope', () => {
    expect(hookScopeLabel({ scope: 'user', projectName: 'claudewatch' })).toBe('user')
  })
})

describe('hookScopeOrder', () => {
  it('orders user before project before local', () => {
    const user = hookScopeOrder({ scope: 'user' })
    const project = hookScopeOrder({ scope: 'project', projectName: 'a' })
    const local = hookScopeOrder({ scope: 'local', projectName: 'a' })

    const ordered = [local, project, user].sort()
    expect(ordered).toEqual([user, project, local])
  })

  it('orders project-scope rules alphabetically by project name', () => {
    const beta = hookScopeOrder({ scope: 'project', projectName: 'beta' })
    const alpha = hookScopeOrder({ scope: 'project', projectName: 'alpha' })

    expect(alpha < beta).toBe(true)
    expect(alpha).not.toBe(beta)
  })

  it('orders local-scope rules alphabetically by project name', () => {
    const beta = hookScopeOrder({ scope: 'local', projectName: 'beta' })
    const alpha = hookScopeOrder({ scope: 'local', projectName: 'alpha' })

    expect(alpha < beta).toBe(true)
    expect(alpha).not.toBe(beta)
  })

  it('keeps a stable, deterministic order for repeated calls with the same input', () => {
    const rule = { scope: 'project' as const, projectName: 'claudewatch' }
    expect(hookScopeOrder(rule)).toBe(hookScopeOrder(rule))
  })
})

describe('formatHookTimeout', () => {
  it('renders whole seconds with an "s" suffix', () => {
    expect(formatHookTimeout(10)).toBe('10s')
  })

  it('renders the documented default of 60 seconds', () => {
    expect(formatHookTimeout(60)).toBe('60s')
  })

  it('renders zero seconds', () => {
    expect(formatHookTimeout(0)).toBe('0s')
  })

  it('renders large timeouts without unit conversion', () => {
    expect(formatHookTimeout(300)).toBe('300s')
  })
})

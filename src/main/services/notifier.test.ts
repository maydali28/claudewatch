import { describe, expect, it, vi } from 'vitest'
import { Notifier, type NotificationLike, type NotifierDeps } from './notifier'

class FakeNote implements NotificationLike {
  listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  shown = false
  on(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }
  show(): void {
    this.shown = true
  }
  emit(event: string, ...args: unknown[]): void {
    for (const l of this.listeners.get(event) ?? []) l(...args)
  }
}

function setup(over: Partial<NotifierDeps> = {}) {
  const notes: FakeNote[] = []
  const onStatusChange = vi.fn()
  const notifier = new Notifier({
    isSupported: () => true,
    create: () => {
      const n = new FakeNote()
      notes.push(n)
      return n
    },
    onStatusChange,
    ...over,
  })
  return { notifier, notes, onStatusChange }
}

describe('Notifier', () => {
  it('starts unknown: the OS cannot be asked whether notifications are allowed', () => {
    expect(setup().notifier.status).toBe('unknown')
  })

  it('is unsupported where the OS has no notifications, and shows nothing', () => {
    const { notifier, notes } = setup({ isSupported: () => false })
    expect(notifier.status).toBe('unsupported')
    expect(notifier.show({ title: 't', body: 'b' })).toBe(false)
    expect(notes).toHaveLength(0)
  })

  it('learns "allowed" when a notification shows', () => {
    const { notifier, notes, onStatusChange } = setup()
    expect(notifier.show({ title: 't', body: 'b' })).toBe(true)
    expect(notes[0].shown).toBe(true)
    notes[0].emit('show')
    expect(notifier.status).toBe('allowed')
    expect(onStatusChange).toHaveBeenCalledWith('allowed')
  })

  it('learns "blocked" when the OS refuses one', () => {
    const { notifier, notes, onStatusChange } = setup()
    notifier.show({ title: 't', body: 'b' })
    notes[0].emit('failed', {}, 'Notifications are not allowed for this application')
    expect(notifier.status).toBe('blocked')
    expect(onStatusChange).toHaveBeenCalledWith('blocked')
  })

  it('goes back to "allowed" once a later notification shows', () => {
    const { notifier, notes } = setup()
    notifier.show({ title: 't', body: 'b' })
    notes[0].emit('failed', {}, 'denied')
    notifier.show({ title: 't', body: 'b' })
    notes[1].emit('show')
    expect(notifier.status).toBe('allowed')
  })

  it('reports a status change once, not on every notification', () => {
    const { notifier, notes, onStatusChange } = setup()
    notifier.show({ title: 't', body: 'b' })
    notifier.show({ title: 't', body: 'b' })
    notes[0].emit('show')
    notes[1].emit('show')
    expect(onStatusChange).toHaveBeenCalledTimes(1)
  })

  it('runs the click handler', () => {
    const { notifier, notes } = setup()
    const onClick = vi.fn()
    notifier.show({ title: 't', body: 'b', onClick })
    notes[0].emit('click')
    expect(onClick).toHaveBeenCalledOnce()
  })
})

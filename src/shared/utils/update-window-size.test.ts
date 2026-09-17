import { describe, it, expect } from 'vitest'
import {
  clampUpdateWindowHeight,
  UPDATE_WINDOW_MIN_HEIGHT,
  UPDATE_WINDOW_MAX_HEIGHT,
} from './update-window-size'

describe('clampUpdateWindowHeight', () => {
  it.each([
    [0, UPDATE_WINDOW_MIN_HEIGHT],
    [299.2, UPDATE_WINDOW_MIN_HEIGHT],
    [412.4, 413],
    [5000, UPDATE_WINDOW_MAX_HEIGHT],
    [Number.NaN, UPDATE_WINDOW_MIN_HEIGHT],
  ])('maps %s to %s', (input, expected) => expect(clampUpdateWindowHeight(input)).toBe(expected))
})

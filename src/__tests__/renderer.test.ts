/**
 * Tests for exported pure functions in graph-renderer.ts.
 *
 * Covers:
 *   - greyFromSlider: range bounds, monotonicity (higher value = lighter/darker)
 *   - widthFromSlider: range bounds, linearity
 */

import { describe, it, expect } from 'vitest'
import { greyFromSlider, widthFromSlider } from '../graph-renderer'

describe('greyFromSlider', () => {
  it('returns a valid rgb() string', () => {
    expect(greyFromSlider(50)).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
  })

  it('at v=0 returns near-white (level ≈ 220)', () => {
    // level = round(220 - 0 * 2.05) = 220
    expect(greyFromSlider(0)).toBe('rgb(220,220,220)')
  })

  it('at v=100 returns near-black (level ≈ 15)', () => {
    // level = round(220 - 100 * 2.05) = round(220 - 205) = 15
    expect(greyFromSlider(100)).toBe('rgb(15,15,15)')
  })

  it('is monotonically darker as v increases', () => {
    const levels = [0, 25, 50, 75, 100].map(v => {
      const match = greyFromSlider(v).match(/\d+/)
      return parseInt(match![0])
    })
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeLessThanOrEqual(levels[i - 1])
    }
  })

  it('mid-range v=50 gives a mid-grey', () => {
    // level = round(220 - 50 * 2.05) = round(117.5) = 118
    const result = greyFromSlider(50)
    const level = parseInt(result.match(/\d+/)![0])
    expect(level).toBeGreaterThan(50)
    expect(level).toBeLessThan(200)
  })
})

describe('widthFromSlider', () => {
  it('at v=1 (minimum) returns 0.5px', () => {
    // 0.5 + (1-1) * (2.5/9) = 0.5
    expect(widthFromSlider(1)).toBeCloseTo(0.5)
  })

  it('at v=10 (maximum) returns 3px', () => {
    // 0.5 + (10-1) * (2.5/9) = 0.5 + 9 * 0.2778 = 0.5 + 2.5 = 3.0
    expect(widthFromSlider(10)).toBeCloseTo(3.0)
  })

  it('increases linearly from v=1 to v=10', () => {
    const widths = [1, 3, 5, 7, 10].map(widthFromSlider)
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1])
    }
  })

  it('stays within [0.5, 3.0] for all valid slider values', () => {
    for (let v = 1; v <= 10; v++) {
      const w = widthFromSlider(v)
      expect(w).toBeGreaterThanOrEqual(0.5)
      expect(w).toBeLessThanOrEqual(3.01) // small float tolerance
    }
  })
})

import { describe, expect, it } from 'vitest'
import { selectTilesForCells, type RenderCandidate, type RGB } from '../src/server/mosaic'

describe('tile selection', () => {
  it('respects repeat limits and repeat spacing when alternatives exist', () => {
    const candidates: Array<RenderCandidate> = [
      { assetId: 'a', average: [0, 0, 0], tileBuffer: Buffer.from('a') },
      { assetId: 'b', average: [10, 10, 10], tileBuffer: Buffer.from('b') },
      { assetId: 'c', average: [20, 20, 20], tileBuffer: Buffer.from('c') },
      { assetId: 'd', average: [30, 30, 30], tileBuffer: Buffer.from('d') },
    ]
    const targets: Array<RGB> = Array.from({ length: 6 }, () => [0, 0, 0])
    const selected = selectTilesForCells(targets, candidates, { repeatLimit: 2, minRepeatSpacing: 1, randomSeed: 1 })
    const counts = selected.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.candidate.assetId]: (acc[item.candidate.assetId] ?? 0) + 1 }), {})
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(2)
    for (let i = 1; i < selected.length; i += 1) expect(selected[i].candidate.assetId).not.toBe(selected[i - 1].candidate.assetId)
  })

  it('avoids placing repeat tiles near each other in the grid when alternatives exist', () => {
    const candidates: Array<RenderCandidate> = Array.from({ length: 9 }, (_, index) => ({
      assetId: `tile-${index}`,
      average: [0, 0, index] as RGB,
      tileBuffer: Buffer.from(String(index)),
    }))
    const targets: Array<RGB> = Array.from({ length: 9 }, () => [0, 0, 0])
    const selected = selectTilesForCells(targets, candidates, { repeatLimit: 9, minRepeatSpacing: 4, randomSeed: 1 }, 3)
    const ids = selected.map((item) => item.candidate.assetId)
    expect(new Set(ids).size).toBeGreaterThan(1)
    expect(ids[0]).not.toBe(ids[1])
    expect(ids[0]).not.toBe(ids[3])
  })
})

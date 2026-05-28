import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/server/config'
import { imageAverage, renderMosaic, type TileCandidate } from '../src/server/mosaic'

describe('output generation', () => {
  it('writes final and preview images', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mosaic-output-'))
    const main = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#336699' } }).png().toBuffer()
    const red = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ff0000' } }).png().toBuffer()
    const blue = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#0000ff' } }).png().toBuffer()
    const candidates: Array<TileCandidate> = [
      { assetId: 'red', buffer: red, average: await imageAverage(red) },
      { assetId: 'blue', buffer: blue, average: await imageAverage(blue) },
    ]
    const config = { ...defaultConfig.mosaic, outputWidth: 96, outputHeight: 96, tileSize: 24, repeatLimit: 99, outputFormat: 'png' as const }
    const result = await renderMosaic({ mainBuffer: main, candidates, config, outputFolder: dir })
    await expect(fs.stat(result.finalPath)).resolves.toBeTruthy()
    await expect(fs.stat(result.previewPath)).resolves.toBeTruthy()
    const metadata = await sharp(result.finalPath).metadata()
    expect(metadata.width).toBe(96)
    expect(metadata.height).toBe(96)
  })
})

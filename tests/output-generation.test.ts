import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/server/config'
import { imageAverage, looksLikeScreenshot, renderMosaic, type TileCandidate } from '../src/server/mosaic'

describe('output generation', () => {
  it('writes final and preview images', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mosaic-output-'))
    const main = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#336699' } })
      .png()
      .toBuffer()
    const red = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer()
    const blue = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#0000ff' } })
      .png()
      .toBuffer()
    const candidates: Array<TileCandidate> = [
      { assetId: 'red', buffer: red, average: await imageAverage(red) },
      { assetId: 'blue', buffer: blue, average: await imageAverage(blue) },
    ]
    const config = {
      ...defaultConfig.mosaic,
      outputWidth: 96,
      outputHeight: 96,
      tileSize: 24,
      repeatLimit: 99,
      outputFormat: 'png' as const,
    }
    const result = await renderMosaic({ mainBuffer: main, candidates, config, outputFolder: dir })
    await expect(fs.stat(result.finalPath)).resolves.toBeTruthy()
    await expect(fs.stat(result.previewPath)).resolves.toBeTruthy()
    const metadata = await sharp(result.finalPath).metadata()
    expect(metadata.width).toBe(96)
    expect(metadata.height).toBe(96)
  })

  it('moves tile hue toward target cell colors', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mosaic-color-'))
    const main = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer()
    const blue = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#0000ff' } })
      .png()
      .toBuffer()
    const candidates: Array<TileCandidate> = [{ assetId: 'blue', buffer: blue, average: await imageAverage(blue) }]
    const config = {
      ...defaultConfig.mosaic,
      outputWidth: 48,
      outputHeight: 48,
      tileSize: 48,
      repeatLimit: 99,
      outputFormat: 'png' as const,
      colorMatchingStrength: 1,
      mainImageOpacity: 0,
    }
    const result = await renderMosaic({ mainBuffer: main, candidates, config, outputFolder: dir })
    const [r, , b] = await imageAverage(await fs.readFile(result.finalPath))
    expect(r).toBeGreaterThan(b)
  })

  it('detects screenshot-like candidates without rejecting photo-like gradients', async () => {
    const screenshot = await sharp(
      Buffer.from(
        '<svg width="240" height="160"><rect width="240" height="160" fill="white"/><rect x="12" y="12" width="216" height="20" fill="#111"/><rect x="12" y="48" width="180" height="12" fill="#333"/><rect x="12" y="76" width="205" height="12" fill="#333"/><rect x="12" y="104" width="120" height="12" fill="#333"/></svg>',
      ),
    )
      .png()
      .toBuffer()
    const photoLike = await sharp({ create: { width: 240, height: 160, channels: 3, background: '#7aa06f' } })
      .composite([
        {
          input: await sharp({ create: { width: 120, height: 160, channels: 3, background: '#d39b75' } })
            .blur(20)
            .png()
            .toBuffer(),
          left: 60,
          top: 0,
        },
      ])
      .png()
      .toBuffer()
    expect(await looksLikeScreenshot(screenshot)).toBe(true)
    expect(await looksLikeScreenshot(photoLike)).toBe(false)
  })
})

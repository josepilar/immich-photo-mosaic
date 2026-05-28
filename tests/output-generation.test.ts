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

  it('applies main image influence with uniform opacity even when the source has alpha', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mosaic-alpha-'))
    const width = 8
    const height = 4
    const rgba = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4
        rgba[i] = 255
        rgba[i + 1] = 255
        rgba[i + 2] = 255
        rgba[i + 3] = x < width / 2 ? 255 : 0
      }
    }
    const main = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer()
    const black = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#000000' } })
      .png()
      .toBuffer()
    const candidates: Array<TileCandidate> = [{ assetId: 'black', buffer: black, average: await imageAverage(black) }]
    const config = {
      ...defaultConfig.mosaic,
      outputWidth: 80,
      outputHeight: 40,
      tileSize: 20,
      repeatLimit: 99,
      outputFormat: 'png' as const,
      colorMatchingStrength: 0,
      mainImageOpacity: 0.5,
    }
    const result = await renderMosaic({ mainBuffer: main, candidates, config, outputFolder: dir })
    const raw = await sharp(result.finalPath).removeAlpha().raw().toBuffer()
    let left = 0
    let right = 0
    let leftPixels = 0
    let rightPixels = 0
    for (let y = 0; y < config.outputHeight; y += 1) {
      for (let x = 0; x < config.outputWidth; x += 1) {
        const i = (y * config.outputWidth + x) * 3
        const brightness = (raw[i] + raw[i + 1] + raw[i + 2]) / 3
        if (x < config.outputWidth / 2) {
          left += brightness
          leftPixels += 1
        } else {
          right += brightness
          rightPixels += 1
        }
      }
    }
    const leftAverage = left / leftPixels
    const rightAverage = right / rightPixels
    expect(Math.abs(leftAverage - rightAverage)).toBeLessThan(3)
    expect(leftAverage).toBeGreaterThan(120)
  })

  it('softens hard main-image influence seams so they do not look like render boundaries', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mosaic-seam-'))
    const width = 80
    const height = 40
    const main = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
      .composite([
        {
          input: await sharp({ create: { width: width / 2, height, channels: 3, background: '#000000' } })
            .png()
            .toBuffer(),
          left: width / 2,
          top: 0,
        },
      ])
      .png()
      .toBuffer()
    const black = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#000000' } })
      .png()
      .toBuffer()
    const candidates: Array<TileCandidate> = [{ assetId: 'black', buffer: black, average: await imageAverage(black) }]
    const config = {
      ...defaultConfig.mosaic,
      outputWidth: width,
      outputHeight: height,
      tileSize: 20,
      repeatLimit: 99,
      outputFormat: 'png' as const,
      colorMatchingStrength: 0,
      mainImageOpacity: 0.5,
    }
    const result = await renderMosaic({ mainBuffer: main, candidates, config, outputFolder: dir })
    const raw = await sharp(result.finalPath).removeAlpha().raw().toBuffer()
    const columnBrightness = (x: number) => {
      let total = 0
      for (let y = 0; y < height; y += 1) {
        const i = (y * width + x) * 3
        total += (raw[i] + raw[i + 1] + raw[i + 2]) / 3
      }
      return total / height
    }
    const seamJump = Math.abs(columnBrightness(width / 2 - 1) - columnBrightness(width / 2))
    const overallContrast = Math.abs(columnBrightness(4) - columnBrightness(width - 5))
    expect(seamJump).toBeLessThan(35)
    expect(overallContrast).toBeGreaterThan(80)
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

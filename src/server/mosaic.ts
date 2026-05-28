import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { MosaicConfig } from './config'

export type RGB = [number, number, number]

export type TileCandidate = {
  assetId: string
  sourcePath?: string
  buffer?: Buffer
  average: RGB
}

export type RenderCandidate = TileCandidate & { tileBuffer: Buffer }

export type Selection = { candidate: RenderCandidate; index: number }

export function seededRandom(seed: number) {
  let state = seed || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

export function shuffleDeterministic<T>(items: Array<T>, seed: number) {
  const copy = [...items]
  const random = seededRandom(seed)
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function colorDistance(a: RGB, b: RGB) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
}

export function selectTilesForCells(targetColors: Array<RGB>, candidates: Array<RenderCandidate>, config: Pick<MosaicConfig, 'repeatLimit' | 'minRepeatSpacing' | 'randomSeed'>): Array<Selection> {
  if (!candidates.length) throw new Error('No tile candidates available')
  const usage = new Map<string, number>()
  const recent = new Map<string, number>()
  const randomized = shuffleDeterministic(candidates, config.randomSeed)
  return targetColors.map((target, index) => {
    const ranked = randomized
      .map((candidate) => ({ candidate, distance: colorDistance(target, candidate.average) }))
      .sort((a, b) => a.distance - b.distance)
    const selected = ranked.find(({ candidate }) => {
      const count = usage.get(candidate.assetId) ?? 0
      const last = recent.get(candidate.assetId)
      return count < config.repeatLimit && (last === undefined || index - last > config.minRepeatSpacing)
    }) ?? ranked.find(({ candidate }) => (usage.get(candidate.assetId) ?? 0) < config.repeatLimit) ?? ranked[0]
    usage.set(selected.candidate.assetId, (usage.get(selected.candidate.assetId) ?? 0) + 1)
    recent.set(selected.candidate.assetId, index)
    return { candidate: selected.candidate, index }
  })
}

export async function imageAverage(buffer: Buffer, size = 32): Promise<RGB> {
  const raw = await sharp(buffer).rotate().resize(size, size, { fit: 'fill' }).removeAlpha().raw().toBuffer()
  let r = 0, g = 0, b = 0
  for (let i = 0; i < raw.length; i += 3) {
    r += raw[i]
    g += raw[i + 1]
    b += raw[i + 2]
  }
  const pixels = raw.length / 3
  return [Math.round(r / pixels), Math.round(g / pixels), Math.round(b / pixels)]
}

export async function brightnessAndSharpness(buffer: Buffer) {
  const raw = await sharp(buffer).rotate().resize(64, 64, { fit: 'inside' }).greyscale().raw().toBuffer()
  const values = [...raw]
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return { brightness: mean / 255, sharpness: variance }
}

export async function prepareTile(buffer: Buffer, config: MosaicConfig, width: number, height: number, average: RGB) {
  if (config.fitMode === 'stretch') {
    return sharp(buffer).rotate().resize(width, height, { fit: 'fill' }).jpeg({ quality: 92 }).toBuffer()
  }
  if (config.fitMode === 'cover') {
    return sharp(buffer).rotate().resize(width, height, { fit: 'cover' }).jpeg({ quality: 92 }).toBuffer()
  }

  const contained = await sharp(buffer).rotate().resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  if (config.paddingMode === 'blurred') {
    const background = await sharp(buffer).rotate().resize(width, height, { fit: 'cover' }).blur(18).modulate({ brightness: 0.8 }).jpeg().toBuffer()
    return sharp(background).composite([{ input: contained }]).jpeg({ quality: 92 }).toBuffer()
  }
  const bg = paddingColor(config, average)
  return sharp({ create: { width, height, channels: 3, background: bg } }).composite([{ input: contained }]).jpeg({ quality: 92 }).toBuffer()
}

export function computeLayout(config: MosaicConfig, mainWidth: number, mainHeight: number) {
  let outputWidth = config.outputWidth
  let outputHeight = config.outputHeight
  if (config.targetMegapixels > 0) {
    const aspect = mainWidth / mainHeight
    const pixels = config.targetMegapixels * 1_000_000
    outputWidth = Math.round(Math.sqrt(pixels * aspect))
    outputHeight = Math.round(outputWidth / aspect)
  }
  const tileWidth = config.tileSize
  const tileHeight = Math.max(1, Math.round(config.tileSize / config.tileAspectRatio))
  const columns = config.automaticGrid || config.columns === 0 ? Math.max(1, Math.round(outputWidth / tileWidth)) : config.columns
  const rows = config.automaticGrid || config.rows === 0 ? Math.max(1, Math.round(outputHeight / tileHeight)) : config.rows
  outputWidth = columns * tileWidth
  outputHeight = rows * tileHeight
  return { outputWidth, outputHeight, tileWidth, tileHeight, columns, rows }
}

export async function targetCellColors(mainBuffer: Buffer, columns: number, rows: number): Promise<Array<RGB>> {
  const raw = await sharp(mainBuffer).rotate().resize(columns, rows, { fit: 'fill' }).removeAlpha().raw().toBuffer()
  const colors: Array<RGB> = []
  for (let i = 0; i < raw.length; i += 3) colors.push([raw[i], raw[i + 1], raw[i + 2]])
  return colors
}

export async function renderMosaic(args: {
  mainBuffer: Buffer
  candidates: Array<TileCandidate>
  config: MosaicConfig
  outputFolder: string
}) {
  const metadata = await sharp(args.mainBuffer).metadata()
  const layout = computeLayout(args.config, metadata.width ?? args.config.outputWidth, metadata.height ?? args.config.outputHeight)
  await fs.mkdir(args.outputFolder, { recursive: true })
  const tileDir = path.join(args.outputFolder, 'tiles')
  if (args.config.keepIntermediates) await fs.mkdir(tileDir, { recursive: true })

  const prepared: Array<RenderCandidate> = []
  for (const candidate of args.candidates) {
    const source = candidate.buffer ?? await fs.readFile(candidate.sourcePath!)
    const tileBuffer = await prepareTile(source, args.config, layout.tileWidth, layout.tileHeight, candidate.average)
    if (args.config.keepIntermediates) await fs.writeFile(path.join(tileDir, `${safeName(candidate.assetId)}.jpg`), tileBuffer)
    prepared.push({ ...candidate, tileBuffer })
  }

  const colors = await targetCellColors(args.mainBuffer, layout.columns, layout.rows)
  const selections = selectTilesForCells(colors, prepared, args.config)
  const composites = await Promise.all(selections.map(async ({ candidate }, index) => ({
    input: await colorMatchedTile(candidate.tileBuffer, colors[index], args.config.colorMatchingStrength),
    left: (index % layout.columns) * layout.tileWidth,
    top: Math.floor(index / layout.columns) * layout.tileHeight,
  })))
  const base = sharp({ create: { width: layout.outputWidth, height: layout.outputHeight, channels: 3, background: '#000000' } })
  let mosaicBuffer = await base.composite(composites).png().toBuffer()
  if (args.config.mainImageOpacity > 0) {
    const overlay = await sharp(args.mainBuffer).rotate().resize(layout.outputWidth, layout.outputHeight, { fit: 'cover' }).ensureAlpha(args.config.mainImageOpacity).png().toBuffer()
    mosaicBuffer = await sharp(mosaicBuffer).composite([{ input: overlay }]).png().toBuffer()
  }

  const finalName = `final.${args.config.outputFormat}`
  const finalPath = path.join(args.outputFolder, finalName)
  const encoded = encodeOutput(sharp(mosaicBuffer), args.config)
  await encoded.toFile(finalPath)
  const previewPath = path.join(args.outputFolder, 'preview.jpg')
  await sharp(mosaicBuffer).resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 82 }).toFile(previewPath)
  return { finalName, finalPath, previewPath, layout, cells: colors.length, selections }
}

export function outputFolderName(input: unknown) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 12)
  return `mosaic-${hash}`
}

function encodeOutput(image: sharp.Sharp, config: MosaicConfig) {
  if (config.outputFormat === 'jpeg') return image.jpeg({ quality: config.quality })
  if (config.outputFormat === 'webp') return image.webp({ quality: config.quality })
  return image.png()
}

function paddingColor(config: MosaicConfig, average: RGB) {
  if (config.paddingMode === 'dominant') return { r: average[0], g: average[1], b: average[2] }
  if (config.paddingMode === 'white') return '#ffffff'
  if (config.paddingMode === 'custom') return config.paddingColor
  return '#000000'
}

async function colorMatchedTile(buffer: Buffer, target: RGB, strength: number) {
  if (strength <= 0) return buffer
  const overlay = Buffer.from(`<svg width="1" height="1"><rect width="1" height="1" fill="rgb(${target[0]},${target[1]},${target[2]})" fill-opacity="${Math.min(0.55, strength * 0.45)}" /></svg>`)
  return sharp(buffer).composite([{ input: overlay, tile: true, blend: 'overlay' }]).jpeg({ quality: 92 }).toBuffer()
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

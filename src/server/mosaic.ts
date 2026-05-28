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

const tileJpegOptions = { quality: 96, chromaSubsampling: '4:4:4' as const }
const tileSharpen = { sigma: 0.6 }

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

export function selectTilesForCells(targetColors: Array<RGB>, candidates: Array<RenderCandidate>, config: Pick<MosaicConfig, 'repeatLimit' | 'minRepeatSpacing' | 'randomSeed'>, columns?: number): Array<Selection> {
  if (!candidates.length) throw new Error('No tile candidates available')
  const usage = new Map<string, number>()
  const recent = new Map<string, number>()
  const positions = new Map<string, Array<number>>()
  const randomized = shuffleDeterministic(candidates, config.randomSeed)
  const localRadius = columns ? Math.max(1, Math.round(Math.sqrt(config.minRepeatSpacing))) : 0
  return targetColors.map((target, index) => {
    const ranked = randomized
      .map((candidate) => {
        const count = usage.get(candidate.assetId) ?? 0
        const distance = colorDistance(target, candidate.average)
        const localPenalty = hasLocalSpacing(index, positions.get(candidate.assetId), columns, localRadius) ? 0 : 1000
        return { candidate, distance, score: distance + count * 12 + localPenalty }
      })
      .sort((a, b) => a.score - b.score)
    const selected = ranked.find(({ candidate }) => {
      const count = usage.get(candidate.assetId) ?? 0
      const last = recent.get(candidate.assetId)
      return count < config.repeatLimit && (last === undefined || index - last > config.minRepeatSpacing) && hasLocalSpacing(index, positions.get(candidate.assetId), columns, localRadius)
    }) ?? ranked.find(({ candidate }) => {
      const count = usage.get(candidate.assetId) ?? 0
      const last = recent.get(candidate.assetId)
      return count < config.repeatLimit && (last === undefined || index - last > config.minRepeatSpacing)
    }) ?? ranked.find(({ candidate }) => (usage.get(candidate.assetId) ?? 0) < config.repeatLimit) ?? ranked[0]
    usage.set(selected.candidate.assetId, (usage.get(selected.candidate.assetId) ?? 0) + 1)
    recent.set(selected.candidate.assetId, index)
    const previousPositions = positions.get(selected.candidate.assetId) ?? []
    positions.set(selected.candidate.assetId, [...previousPositions.slice(-50), index])
    return { candidate: selected.candidate, index }
  })
}

function hasLocalSpacing(index: number, previous: Array<number> | undefined, columns: number | undefined, radius: number) {
  if (!columns || !previous?.length || radius <= 0) return true
  const row = Math.floor(index / columns)
  const column = index % columns
  return !previous.some((other) => Math.abs(row - Math.floor(other / columns)) <= radius && Math.abs(column - (other % columns)) <= radius)
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

export async function looksLikeScreenshot(buffer: Buffer) {
  const image = sharp(buffer).rotate().resize(96, 96, { fit: 'inside' }).removeAlpha()
  const metadata = await image.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (!width || !height) return false
  const raw = await image.raw().toBuffer()
  const pixels = raw.length / 3
  let lowSaturation = 0
  let nearWhite = 0
  let nearBlack = 0
  let veryBright = 0
  let strongEdges = 0
  const colors = new Set<string>()

  for (let i = 0; i < raw.length; i += 3) {
    const r = raw[i]
    const g = raw[i + 1]
    const b = raw[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max - min < 18) lowSaturation += 1
    if (r > 235 && g > 235 && b > 235) nearWhite += 1
    if (r < 25 && g < 25 && b < 25) nearBlack += 1
    if ((r + g + b) / 3 > 220) veryBright += 1
    colors.add(`${r >> 4},${g >> 4},${b >> 4}`)
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const i = (y * width + x) * 3
      const j = i - 3
      const diff = Math.abs(raw[i] - raw[j]) + Math.abs(raw[i + 1] - raw[j + 1]) + Math.abs(raw[i + 2] - raw[j + 2])
      if (diff > 180) strongEdges += 1
    }
  }
  for (let y = 1; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3
      const j = i - width * 3
      const diff = Math.abs(raw[i] - raw[j]) + Math.abs(raw[i + 1] - raw[j + 1]) + Math.abs(raw[i + 2] - raw[j + 2])
      if (diff > 180) strongEdges += 1
    }
  }

  const lowSatRatio = lowSaturation / pixels
  const whiteRatio = nearWhite / pixels
  const blackRatio = nearBlack / pixels
  const brightRatio = veryBright / pixels
  const edgeRatio = strongEdges / Math.max(1, (width - 1) * height + (height - 1) * width)
  const colorBucketRatio = colors.size / pixels

  return (
    (whiteRatio > 0.35 && lowSatRatio > 0.55 && edgeRatio > 0.08) ||
    (blackRatio > 0.35 && lowSatRatio > 0.55 && edgeRatio > 0.08) ||
    (brightRatio > 0.55 && lowSatRatio > 0.65) ||
    (edgeRatio > 0.18 && colorBucketRatio < 0.12)
  )
}

export async function prepareTile(buffer: Buffer, config: MosaicConfig, width: number, height: number, average: RGB) {
  if (config.fitMode === 'stretch') {
    return sharp(buffer).rotate().resize(width, height, { fit: 'fill' }).sharpen(tileSharpen).jpeg(tileJpegOptions).toBuffer()
  }
  if (config.fitMode === 'cover') {
    return sharp(buffer).rotate().resize(width, height, { fit: 'cover' }).sharpen(tileSharpen).jpeg(tileJpegOptions).toBuffer()
  }

  const contained = await sharp(buffer).rotate().resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).sharpen(tileSharpen).png().toBuffer()
  if (config.paddingMode === 'blurred') {
    const background = await sharp(buffer).rotate().resize(width, height, { fit: 'cover' }).blur(18).modulate({ brightness: 0.8 }).jpeg().toBuffer()
    return sharp(background).composite([{ input: contained }]).jpeg(tileJpegOptions).toBuffer()
  }
  const bg = paddingColor(config, average)
  return sharp({ create: { width, height, channels: 3, background: bg } }).composite([{ input: contained }]).jpeg(tileJpegOptions).toBuffer()
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
  onLog?: (message: string) => void
  onProgress?: (completed: number, total: number, message: string) => void
}) {
  const metadata = await sharp(args.mainBuffer).metadata()
  const layout = computeLayout(args.config, metadata.width ?? args.config.outputWidth, metadata.height ?? args.config.outputHeight)
  const renderTotal = args.candidates.length + layout.rows + 5
  let renderCompleted = 0
  const progress = (message: string) => args.onProgress?.(renderCompleted, renderTotal, message)
  args.onLog?.(`Render layout computed: output=${layout.outputWidth}x${layout.outputHeight}, tile=${layout.tileWidth}x${layout.tileHeight}, grid=${layout.columns}x${layout.rows}`)
  progress(`Preparing ${args.candidates.length} tiles for render`)
  await fs.mkdir(args.outputFolder, { recursive: true })
  const tileDir = path.join(args.outputFolder, 'tiles')
  if (args.config.keepIntermediates) await fs.mkdir(tileDir, { recursive: true })
  const rowDir = path.join(args.outputFolder, '.rows')
  await fs.rm(rowDir, { recursive: true, force: true })
  await fs.mkdir(rowDir, { recursive: true })

  const prepared: Array<RenderCandidate> = []
  for (const [index, candidate] of args.candidates.entries()) {
    if (index === 0 || (index + 1) % 100 === 0 || index + 1 === args.candidates.length) args.onLog?.(`Preparing tile ${index + 1}/${args.candidates.length}`)
    const source = candidate.buffer ?? await fs.readFile(candidate.sourcePath!)
    const tileBuffer = await prepareTile(source, args.config, layout.tileWidth, layout.tileHeight, candidate.average)
    if (args.config.keepIntermediates) await fs.writeFile(path.join(tileDir, `${safeName(candidate.assetId)}.jpg`), tileBuffer)
    prepared.push({ ...candidate, average: await imageAverage(tileBuffer), tileBuffer })
    renderCompleted += 1
    progress(`Preparing tile ${index + 1}/${args.candidates.length}`)
  }

  args.onLog?.('Computing target cell colors')
  const colors = await targetCellColors(args.mainBuffer, layout.columns, layout.rows)
  renderCompleted += 1
  progress('Computing target cell colors')
  args.onLog?.('Selecting best tile for each cell')
  const selections = selectTilesForCells(colors, prepared, args.config, layout.columns)
  renderCompleted += 1
  progress('Selecting best tile for each cell')

  args.onLog?.('Rendering row strips')
  const rowFiles: Array<string> = []
  for (let row = 0; row < layout.rows; row += 1) {
    if (row === 0 || (row + 1) % 10 === 0 || row + 1 === layout.rows) args.onLog?.(`Rendering row ${row + 1}/${layout.rows}`)
    const rowComposites = []
    for (let column = 0; column < layout.columns; column += 1) {
      const index = row * layout.columns + column
      const selection = selections[index]
      rowComposites.push({
        input: await colorMatchedTile(selection.candidate.tileBuffer, colors[index], selection.candidate.average, args.config.colorMatchingStrength),
        left: column * layout.tileWidth,
        top: 0,
      })
    }
    const rowPath = path.join(rowDir, `row-${String(row).padStart(5, '0')}.png`)
    await sharp({ create: { width: layout.outputWidth, height: layout.tileHeight, channels: 3, background: '#000000' } })
      .composite(rowComposites)
      .png()
      .toFile(rowPath)
    rowFiles.push(rowPath)
    renderCompleted += 1
    progress(`Rendering row ${row + 1}/${layout.rows}`)
  }

  args.onLog?.('Compositing row strips into final canvas')
  const rowComposites = rowFiles.map((rowPath, row) => ({ input: rowPath, left: 0, top: row * layout.tileHeight }))
  const base = sharp({ create: { width: layout.outputWidth, height: layout.outputHeight, channels: 3, background: '#000000' } })
  let mosaicBuffer = await base.composite(rowComposites).png().toBuffer()
  renderCompleted += 1
  progress('Compositing row strips into final canvas')
  if (args.config.mainImageOpacity > 0) {
    args.onLog?.(`Blending main image influence at opacity ${args.config.mainImageOpacity}`)
    const overlay = await sharp(args.mainBuffer).rotate().resize(layout.outputWidth, layout.outputHeight, { fit: 'cover' }).ensureAlpha(args.config.mainImageOpacity).png().toBuffer()
    mosaicBuffer = await sharp(mosaicBuffer).composite([{ input: overlay }]).png().toBuffer()
  }
  renderCompleted += 1
  progress('Applying main image blend')

  const finalName = `final.${args.config.outputFormat}`
  const finalPath = path.join(args.outputFolder, finalName)
  args.onLog?.(`Writing final image: ${finalName}`)
  const encoded = encodeOutput(sharp(mosaicBuffer), args.config)
  await encoded.toFile(finalPath)
  renderCompleted += 1
  progress(`Writing final image: ${finalName}`)
  const previewPath = path.join(args.outputFolder, 'preview.jpg')
  args.onLog?.('Writing preview image')
  await sharp(mosaicBuffer).resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 82 }).toFile(previewPath)
  if (!args.config.keepIntermediates) await fs.rm(rowDir, { recursive: true, force: true })
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

async function colorMatchedTile(buffer: Buffer, target: RGB, average: RGB, strength: number) {
  if (strength <= 0) return buffer
  const sourceHsl = rgbToHsl(average)
  const targetHsl = rgbToHsl(target)
  const brightness = clamp(1 + ((targetHsl.l / Math.max(sourceHsl.l, 0.08)) - 1) * strength, 0.65, 1.45)
  const saturation = clamp(1 + ((targetHsl.s / Math.max(sourceHsl.s, 0.18)) - 1) * strength, 0.55, 1.8)
  const hueDelta = sourceHsl.s > 0.08 && targetHsl.s > 0.08 ? Math.round(normalizeHue(shortestHueDelta(sourceHsl.h, targetHsl.h) * strength)) : 0
  return sharp(buffer)
    .modulate({ brightness, saturation, hue: hueDelta })
    .toColorspace('srgb')
    .jpeg(tileJpegOptions)
    .toBuffer()
}

function rgbToHsl([r, g, b]: RGB) {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === red) h = (green - blue) / d + (green < blue ? 6 : 0)
  else if (max === green) h = (blue - red) / d + 2
  else h = (red - green) / d + 4
  return { h: h * 60, s, l }
}

function shortestHueDelta(from: number, to: number) {
  return ((((to - from) % 360) + 540) % 360) - 180
}

function normalizeHue(value: number) {
  return ((value % 360) + 360) % 360
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

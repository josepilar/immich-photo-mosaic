import fs from 'node:fs/promises'
import path from 'node:path'
import { appConfigSchema, defaultConfig, type AppConfig, type MosaicConfig } from './config'
import { ImmichClient, type Asset } from './immich'
import { outputDir, uploadDir } from './paths'
import {
  brightnessAndSharpness,
  imageAverage,
  looksLikeScreenshot,
  outputFolderName,
  renderMosaic,
  shuffleDeterministic,
  type TileCandidate,
} from './mosaic'

export type MainImageSelection = { type: 'immich'; assetId: string } | { type: 'upload'; uploadId: string }

export type StartJobRequest = {
  personIds: Array<string>
  albumIds: Array<string>
  dateFrom?: string
  dateTo?: string
  mainImage: MainImageSelection
  config: AppConfig
}

export type JobProgress = {
  status: 'idle' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'error'
  stage: string
  completed: number
  total: number
  message: string
  logs: Array<string>
  stats: {
    assetsFound: number
    assetsDeduped: number
    candidatesAccepted: number
    candidatesRejected: number
    estimatedOutputPixels: number
    elapsedMs: number
  }
  output?: { folder: string; finalName: string; previewUrl: string; finalUrl: string }
  error?: string
}

let current: JobProgress = emptyProgress()
let controller: AbortController | null = null
let startedAt = 0
let logPaths: Array<string> = []

export function getProgress() {
  if ((current.status === 'running' || current.status === 'cancelling') && startedAt) {
    return { ...current, stats: { ...current.stats, elapsedMs: Date.now() - startedAt } }
  }
  return current
}

export function cancelJob() {
  if (!controller || current.status !== 'running') return false
  current = {
    ...current,
    status: 'cancelling',
    message: 'Cancellation requested',
    logs: [...current.logs, 'Cancellation requested'],
  }
  controller.abort()
  return true
}

export function startJob(request: StartJobRequest) {
  if (current.status === 'running' || current.status === 'cancelling') throw new Error('A job is already running')
  validateMainImage(request.mainImage)
  controller = new AbortController()
  startedAt = Date.now()
  logPaths = []
  current = emptyProgress()
  current.status = 'running'
  current.stage = 'starting'
  current.message = 'Starting mosaic job'
  log('Job accepted')
  void runJob(request, controller.signal)
    .catch((error) => {
      log(`Job failed: ${String(error.message ?? error)}`)
      current = {
        ...current,
        status: error.name === 'AbortError' ? 'cancelled' : 'error',
        error: String(error.message ?? error),
        message: String(error.message ?? error),
      }
    })
    .finally(() => {
      controller = null
    })
}

async function runJob(request: StartJobRequest, signal: AbortSignal) {
  await initializeRootLog()
  log('Initializing job configuration')
  const personIds = Array.isArray(request.personIds) ? request.personIds : []
  const albumIds = Array.isArray(request.albumIds) ? request.albumIds : []
  const config = appConfigSchema.parse(request.config ?? defaultConfig)
  const mosaic = config.mosaic
  log(
    `Configuration parsed: output=${mosaic.outputWidth}x${mosaic.outputHeight}, tileSize=${mosaic.tileSize}, poolLimit=${mosaic.candidatePoolLimit}, usePreviews=${mosaic.usePreviews}`,
  )
  log(
    `Filters: people=${personIds.length ? personIds.join(',') : 'any'}, albums=${albumIds.length ? albumIds.join(',') : 'none'}, dateFrom=${request.dateFrom || 'none'}, dateTo=${request.dateTo || 'none'}`,
  )
  const client = ImmichClient.fromEnv(config)
  update('connecting', 0, 1, 'Validating Immich connection')
  log('Validating Immich connection')
  await client.validateConnection()
  log('Immich connection validated')
  throwIfAborted(signal)

  const sourceLabel = personIds.length ? 'selected people' : 'all eligible photos'
  update('searching', 0, Math.max(1, personIds.length), `Searching Immich assets for ${sourceLabel}`)
  log(`Searching assets for ${sourceLabel}`)
  const allAssets = new Map<string, Asset>()
  const sourcePersonIds = personIds.length ? personIds : [undefined]
  for (const personId of sourcePersonIds) {
    throwIfAborted(signal)
    log(`Searching assets page set for source ${personId ?? 'any person'}`)
    const assets = await client.searchAssets({
      personIds: personId ? [personId] : undefined,
      albumIds,
      takenAfter: request.dateFrom,
      takenBefore: request.dateTo,
      includeVideos: mosaic.includeVideos,
    })
    log(`Found ${assets.length} assets for source ${personId ?? 'any person'}`)
    for (const asset of assets) allAssets.set(asset.id, asset)
    current.stats.assetsFound += assets.length
    current.completed += 1
  }
  if (request.mainImage.type === 'immich') {
    const removedMain = allAssets.delete(request.mainImage.assetId)
    log(`Removed main image from tile pool: ${removedMain ? 'yes' : 'not present'}`)
  }
  current.stats.assetsDeduped = allAssets.size
  log(`Deduplicated asset count: ${allAssets.size}`)
  if (!allAssets.size) throw new Error('No eligible Immich assets found for the selected people and filters')

  const filtered = filterAssets([...allAssets.values()], mosaic)
  log(`Metadata filters accepted ${filtered.length} of ${allAssets.size} assets`)
  const pool = shuffleDeterministic(filtered, mosaic.randomSeed).slice(0, mosaic.candidatePoolLimit)
  log(`Candidate pool selected: ${pool.length} assets using seed ${mosaic.randomSeed}`)

  update('main-image', 0, 1, 'Loading main mosaic image')
  log(`Loading main image from ${request.mainImage.type}`)
  const mainBuffer =
    request.mainImage.type === 'immich'
      ? (await client.downloadAsset(request.mainImage.assetId, false)).bytes
      : await fs.readFile(safeUploadPath(request.mainImage.uploadId))
  log(`Main image loaded: ${mainBuffer.byteLength} bytes`)
  current.completed = 1

  const folder = outputFolderName({
    people: personIds,
    albums: albumIds,
    dates: [request.dateFrom, request.dateTo],
    main: request.mainImage,
    mosaic,
  })
  const folderPath = path.join(outputDir(), folder)
  await attachFolderLog(folderPath)
  log(`Output folder selected: ${folderPath}`)
  const tempSourceDir = path.join(folderPath, '.candidate-sources')
  await fs.mkdir(tempSourceDir, { recursive: true })
  log(`Candidate source cache initialized: ${tempSourceDir}`)

  update('candidates', 0, pool.length, `Analyzing ${pool.length} candidate images`)
  const candidates: Array<TileCandidate> = []
  let analyzed = 0
  const candidateConcurrency = mosaic.usePreviews ? 6 : 3
  await mapLimit(pool, candidateConcurrency, async (asset, index) => {
    throwIfAborted(signal)
    try {
      const { bytes } = await client.downloadAsset(asset.id, mosaic.usePreviews)
      const metrics = await brightnessAndSharpness(bytes)
      if (await looksLikeScreenshot(bytes)) {
        current.stats.candidatesRejected += 1
        log(`Rejected ${asset.id}: looks like a screenshot or UI capture`)
      } else if (
        mosaic.brightnessFilterEnabled &&
        (metrics.brightness < mosaic.minBrightness || metrics.brightness > mosaic.maxBrightness)
      ) {
        current.stats.candidatesRejected += 1
        log(
          `Rejected ${asset.id}: brightness ${metrics.brightness.toFixed(3)} outside ${mosaic.minBrightness}-${mosaic.maxBrightness}`,
        )
      } else if (mosaic.blurFilterEnabled && metrics.sharpness < mosaic.minSharpness) {
        current.stats.candidatesRejected += 1
        log(`Rejected ${asset.id}: sharpness ${metrics.sharpness.toFixed(1)} below ${mosaic.minSharpness}`)
      } else {
        const sourcePath = path.join(tempSourceDir, `${String(index).padStart(5, '0')}-${safeFileName(asset.id)}.img`)
        await fs.writeFile(sourcePath, bytes)
        candidates.push({ assetId: asset.id, sourcePath, average: await imageAverage(bytes) })
        current.stats.candidatesAccepted += 1
      }
    } catch (error) {
      current.stats.candidatesRejected += 1
      log(`Rejected ${asset.id}: ${String((error as Error).message ?? error)}`)
    }
    analyzed += 1
    current = {
      ...current,
      completed: analyzed,
      stats: { ...current.stats, elapsedMs: startedAt ? Date.now() - startedAt : 0 },
    }
    if (analyzed === 1 || analyzed % 25 === 0 || analyzed === pool.length)
      log(`Analyzed candidate ${analyzed}/${pool.length}`)
  })
  log(
    `Candidate analysis complete: accepted=${current.stats.candidatesAccepted}, rejected=${current.stats.candidatesRejected}`,
  )
  if (!candidates.length) throw new Error('No candidate tiles passed the current filters')
  update('rendering', 0, 1, `Rendering mosaic to ${folder}`)
  log('Starting mosaic render')
  const result = await renderMosaic({
    mainBuffer,
    candidates,
    config: mosaic,
    outputFolder: folderPath,
    onLog: log,
    onProgress: (completed, total, message) => setProgress('rendering', completed, total, message),
  })
  log(`Mosaic render complete: ${result.layout.outputWidth}x${result.layout.outputHeight}, cells=${result.cells}`)
  if (!mosaic.keepIntermediates) {
    await fs.rm(tempSourceDir, { recursive: true, force: true })
    log('Temporary candidate source cache removed')
  }
  current.stats.estimatedOutputPixels = result.layout.outputWidth * result.layout.outputHeight
  await fs.writeFile(
    path.join(folderPath, 'metadata.json'),
    JSON.stringify(
      {
        request: { ...request, config: { ...config, immich: config.immich } },
        result: { layout: result.layout, cells: result.cells },
        stats: current.stats,
      },
      null,
      2,
    ),
  )
  log('Metadata written')

  current = {
    ...current,
    status: 'completed',
    stage: 'completed',
    completed: 1,
    total: 1,
    message: 'Mosaic completed',
    stats: { ...current.stats, elapsedMs: Date.now() - startedAt },
    output: {
      folder,
      finalName: result.finalName,
      previewUrl: `/api/outputs/${folder}/preview.jpg`,
      finalUrl: `/api/outputs/${folder}/${result.finalName}`,
    },
    logs: [...current.logs, 'Mosaic completed'],
  }
  log('Job completed successfully')
}

function filterAssets(assets: Array<Asset>, config: MosaicConfig) {
  return assets.filter((asset) => {
    if (!config.includeVideos && asset.type && asset.type !== 'IMAGE') return false
    if (!config.includeArchived && asset.isArchived) return false
    if (!config.includeHidden && (asset.isHidden || asset.visibility === 'hidden')) return false
    if (config.includeFavoritesOnly && !asset.isFavorite) return false
    return true
  })
}

function update(stage: string, completed: number, total: number, message: string) {
  setProgress(stage, completed, total, message, true)
}

function setProgress(stage: string, completed: number, total: number, message: string, writeLog = false) {
  current = {
    ...current,
    stage,
    completed,
    total,
    message,
    stats: { ...current.stats, elapsedMs: startedAt ? Date.now() - startedAt : 0 },
  }
  if (!writeLog) return
  log(`Stage update: ${stage} (${completed}/${total}) ${message}`)
}

function log(message: string) {
  const line = `${new Date().toISOString()} ${message}`
  writeJobLog(line)
}

function writeJobLog(line: string) {
  current = { ...current, logs: [...current.logs, line].slice(-500) }
  console.log(`[job] ${line}`)
  for (const logPath of logPaths) void fs.appendFile(logPath, `${line}\n`).catch(() => undefined)
}

async function initializeRootLog() {
  await fs.mkdir(outputDir(), { recursive: true })
  const stamp = new Date(startedAt || Date.now()).toISOString().replace(/[:.]/g, '-')
  logPaths = [path.join(outputDir(), `job-${stamp}.log`)]
  await fs.writeFile(logPaths[0], '')
  log(`Root log initialized: ${logPaths[0]}`)
}

async function attachFolderLog(folderPath: string) {
  await fs.mkdir(folderPath, { recursive: true })
  const folderLog = path.join(folderPath, 'process.log')
  await fs.writeFile(folderLog, `${current.logs.join('\n')}\n`)
  if (!logPaths.includes(folderLog)) logPaths.push(folderLog)
}

function validateMainImage(mainImage: MainImageSelection) {
  if (!mainImage || (mainImage.type !== 'immich' && mainImage.type !== 'upload')) throw new Error('Select a main image')
  if (mainImage.type === 'immich' && !mainImage.assetId) throw new Error('Select a main Immich image')
  if (mainImage.type === 'upload' && !mainImage.uploadId) throw new Error('Upload a main image')
}

function safeUploadPath(uploadId: string) {
  const root = path.resolve(uploadDir())
  const target = path.resolve(root, uploadId)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid upload path')
  return target
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120)
}

async function mapLimit<T>(items: Array<T>, limit: number, mapper: (item: T, index: number) => Promise<void>) {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      await mapper(items[index], index)
    }
  })
  await Promise.all(workers)
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    const error = new Error('Job cancelled')
    error.name = 'AbortError'
    throw error
  }
}

function emptyProgress(): JobProgress {
  return {
    status: 'idle',
    stage: 'idle',
    completed: 0,
    total: 0,
    message: '',
    logs: [],
    stats: {
      assetsFound: 0,
      assetsDeduped: 0,
      candidatesAccepted: 0,
      candidatesRejected: 0,
      estimatedOutputPixels: 0,
      elapsedMs: 0,
    },
  }
}

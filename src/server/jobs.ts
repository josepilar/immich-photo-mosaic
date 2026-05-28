import fs from 'node:fs/promises'
import path from 'node:path'
import { defaultConfig, type AppConfig, type MosaicConfig } from './config'
import { ImmichClient, type Asset } from './immich'
import { outputDir, uploadDir } from './paths'
import { brightnessAndSharpness, imageAverage, outputFolderName, renderMosaic, shuffleDeterministic, type TileCandidate } from './mosaic'

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

export function getProgress() {
  return current
}

export function cancelJob() {
  if (!controller || current.status !== 'running') return false
  current = { ...current, status: 'cancelling', message: 'Cancellation requested', logs: [...current.logs, 'Cancellation requested'] }
  controller.abort()
  return true
}

export function startJob(request: StartJobRequest) {
  if (current.status === 'running' || current.status === 'cancelling') throw new Error('A job is already running')
  controller = new AbortController()
  startedAt = Date.now()
  current = emptyProgress()
  current.status = 'running'
  current.stage = 'starting'
  current.message = 'Starting mosaic job'
  void runJob(request, controller.signal).catch((error) => {
    current = { ...current, status: error.name === 'AbortError' ? 'cancelled' : 'error', error: String(error.message ?? error), message: String(error.message ?? error), logs: [...current.logs, String(error.message ?? error)] }
  }).finally(() => { controller = null })
}

async function runJob(request: StartJobRequest, signal: AbortSignal) {
  const config = request.config ?? defaultConfig
  const mosaic = config.mosaic
  const client = ImmichClient.fromEnv(config)
  update('connecting', 0, 1, 'Validating Immich connection')
  await client.validateConnection()
  throwIfAborted(signal)

  const sourceLabel = request.personIds.length ? 'selected people' : 'all eligible photos'
  update('searching', 0, Math.max(1, request.personIds.length), `Searching Immich assets for ${sourceLabel}`)
  const allAssets = new Map<string, Asset>()
  const sourcePersonIds = request.personIds.length ? request.personIds : [undefined]
  for (const personId of sourcePersonIds) {
    throwIfAborted(signal)
    const assets = await client.searchAssets({
      personIds: personId ? [personId] : undefined,
      albumIds: request.albumIds,
      takenAfter: request.dateFrom,
      takenBefore: request.dateTo,
      includeVideos: mosaic.includeVideos,
    })
    assets.forEach((asset) => allAssets.set(asset.id, asset))
    current.stats.assetsFound += assets.length
    current.completed += 1
  }
  current.stats.assetsDeduped = allAssets.size
  if (!allAssets.size) throw new Error('No eligible Immich assets found for the selected people and filters')

  const filtered = filterAssets([...allAssets.values()], mosaic)
  const pool = shuffleDeterministic(filtered, mosaic.randomSeed).slice(0, mosaic.candidatePoolLimit)
  update('candidates', 0, pool.length, `Analyzing ${pool.length} candidate images`)
  const candidates: Array<TileCandidate> = []
  for (const asset of pool) {
    throwIfAborted(signal)
    try {
      const { bytes } = await client.downloadAsset(asset.id, mosaic.usePreviews)
      const metrics = await brightnessAndSharpness(bytes)
      if (mosaic.brightnessFilterEnabled && (metrics.brightness < mosaic.minBrightness || metrics.brightness > mosaic.maxBrightness)) {
        current.stats.candidatesRejected += 1
      } else if (mosaic.blurFilterEnabled && metrics.sharpness < mosaic.minSharpness) {
        current.stats.candidatesRejected += 1
      } else {
        candidates.push({ assetId: asset.id, buffer: bytes, average: await imageAverage(bytes) })
        current.stats.candidatesAccepted += 1
      }
    } catch (error) {
      current.stats.candidatesRejected += 1
      log(`Rejected ${asset.id}: ${String((error as Error).message ?? error)}`)
    }
    current.completed += 1
  }
  if (!candidates.length) throw new Error('No candidate tiles passed the current filters')

  update('main-image', 0, 1, 'Loading main mosaic image')
  const mainBuffer = request.mainImage.type === 'immich'
    ? (await client.downloadAsset(request.mainImage.assetId, false)).bytes
    : await fs.readFile(path.join(uploadDir(), request.mainImage.uploadId))
  current.completed = 1

  const folder = outputFolderName({ people: request.personIds, albums: request.albumIds, dates: [request.dateFrom, request.dateTo], main: request.mainImage, mosaic })
  const folderPath = path.join(outputDir(), folder)
  update('rendering', 0, 1, `Rendering mosaic to ${folder}`)
  const result = await renderMosaic({ mainBuffer, candidates, config: mosaic, outputFolder: folderPath })
  current.stats.estimatedOutputPixels = result.layout.outputWidth * result.layout.outputHeight
  await fs.writeFile(path.join(folderPath, 'metadata.json'), JSON.stringify({ request: { ...request, config: { ...config, immich: config.immich } }, result: { layout: result.layout, cells: result.cells }, stats: current.stats }, null, 2))

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
  current = { ...current, stage, completed, total, message, logs: [...current.logs, message].slice(-200), stats: { ...current.stats, elapsedMs: startedAt ? Date.now() - startedAt : 0 } }
}

function log(message: string) {
  current = { ...current, logs: [...current.logs, message].slice(-200) }
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
    stats: { assetsFound: 0, assetsDeduped: 0, candidatesAccepted: 0, candidatesRejected: 0, estimatedOutputPixels: 0, elapsedMs: 0 },
  }
}

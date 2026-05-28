import fs from 'node:fs/promises'
import path from 'node:path'
import { loadConfig, saveConfig, getImmichEnv, appConfigSchema } from './config'
import { ImmichClient } from './immich'
import { cancelJob, getProgress, startJob } from './jobs'
import { configDir, outputDir, uploadDir } from './paths'

export async function handleApi(request: Request, splat: string) {
  const url = new URL(request.url)
  const parts = splat.split('/').filter(Boolean)
  try {
    if (request.method === 'GET' && splat === 'health') return json({ ok: true })
    if (request.method === 'GET' && splat === 'status') return status()
    if (request.method === 'GET' && splat === 'config') return json(await loadConfig())
    if (request.method === 'PUT' && splat === 'config') return putConfig(request)
    if (request.method === 'GET' && splat === 'people') return people()
    if (request.method === 'GET' && parts[0] === 'people' && parts[2] === 'thumbnail') return peopleThumbnail(parts[1])
    if (request.method === 'GET' && splat === 'albums') return albums()
    if (request.method === 'GET' && splat === 'asset-count-preview') return assetCountPreview(url)
    if (request.method === 'GET' && splat === 'assets/search') return assetSearch(url)
    if (request.method === 'GET' && splat === 'assets/search-page') return assetSearchPage(url)
    if (request.method === 'GET' && parts[0] === 'assets' && parts[2] === 'thumbnail') return assetThumbnail(parts[1])
    if (request.method === 'POST' && splat === 'uploads') return upload(request)
    if (request.method === 'GET' && splat === 'jobs/current') return json(getProgress())
    if (request.method === 'POST' && splat === 'jobs') return postJob(request)
    if (request.method === 'POST' && splat === 'jobs/cancel') return json({ cancelled: cancelJob() })
    if (request.method === 'GET' && splat === 'outputs') return outputs()
    if (request.method === 'GET' && parts[0] === 'outputs' && parts.length >= 3) return outputFile(parts[1], parts.slice(2).join('/'))
    return text('Not found', 404)
  } catch (error) {
    const message = String((error as Error).message ?? error)
    const statusCode = message.includes('already running') ? 409 : message.includes('must be set') ? 400 : 500
    return json({ error: message }, statusCode)
  }
}

async function status() {
  const config = await loadConfig()
  const env = getImmichEnv()
  const writable = await Promise.all([isWritable(configDir()), isWritable(outputDir())])
  let connected = false
  let version = ''
  let error = ''
  if (env.apiKey && env.baseUrl) {
    try {
      const info = await ImmichClient.fromEnv(config).validateConnection()
      connected = true
      version = info.version
    } catch (err) {
      error = String((err as Error).message ?? err)
    }
  } else {
    error = 'IMMICH_API_KEY and IMMICH_BASE_URL must be set'
  }
  return json({ connected, version, error, env: { hasApiKey: Boolean(env.apiKey), baseUrl: env.baseUrl || null }, writable: { config: writable[0], output: writable[1] }, requiredScopes: ['album.read', 'asset.download', 'asset.read', 'asset.view', 'person.read', 'server.about'] })
}

async function putConfig(request: Request) {
  const body = await request.json()
  const config = appConfigSchema.parse(body)
  await saveConfig(config)
  return json(config)
}

async function people() {
  const client = ImmichClient.fromEnv(await loadConfig())
  return json(await client.getPeople())
}

async function albums() {
  const client = ImmichClient.fromEnv(await loadConfig())
  return json(await client.getAlbums())
}

async function peopleThumbnail(personId: string) {
  const client = ImmichClient.fromEnv(await loadConfig())
  const { bytes, contentType } = await client.personThumbnail(personId)
  return binary(bytes, contentType)
}

async function assetThumbnail(assetId: string) {
  const client = ImmichClient.fromEnv(await loadConfig())
  const { bytes, contentType } = await client.thumbnail(assetId)
  return binary(bytes, contentType)
}

async function assetCountPreview(url: URL) {
  const client = ImmichClient.fromEnv(await loadConfig())
  const assets = await client.searchAssets(searchOptionsFromUrl(url))
  return json({ totalAssets: new Set(assets.map((asset) => asset.id)).size })
}

async function assetSearch(url: URL) {
  const client = ImmichClient.fromEnv(await loadConfig())
  return json(await client.searchAssets(searchOptionsFromUrl(url, Number(url.searchParams.get('limit') ?? 80))))
}

async function assetSearchPage(url: URL) {
  const client = ImmichClient.fromEnv(await loadConfig())
  return json(await client.searchAssetsPage({
    ...searchOptionsFromUrl(url),
    page: Number(url.searchParams.get('page') ?? 1),
    size: Number(url.searchParams.get('limit') ?? 80),
  }))
}

async function upload(request: Request) {
  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return json({ error: 'file is required' }, 400)
  await fs.mkdir(uploadDir(), { recursive: true })
  const ext = extensionFromType(file.type) || path.extname(file.name) || '.jpg'
  const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`
  await fs.writeFile(path.join(uploadDir(), uploadId), Buffer.from(await file.arrayBuffer()))
  return json({ uploadId, name: file.name })
}

async function postJob(request: Request) {
  const body = await request.json()
  startJob(body)
  return json({ started: true })
}

async function outputs() {
  await fs.mkdir(outputDir(), { recursive: true })
  const entries = await fs.readdir(outputDir(), { withFileTypes: true })
  const folders = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const folder = entry.name
    const metadataPath = path.join(outputDir(), folder, 'metadata.json')
    let metadata = null
    try { metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) } catch {}
    const files = await fs.readdir(path.join(outputDir(), folder)).catch(() => [])
    const finalName = files.find((file) => file.startsWith('final.')) ?? null
    return { folder, finalName, previewUrl: `/api/outputs/${folder}/preview.jpg`, finalUrl: finalName ? `/api/outputs/${folder}/${finalName}` : null, metadata }
  }))
  return json(folders.reverse())
}

async function outputFile(folder: string, file: string) {
  const root = path.resolve(outputDir())
  const target = path.resolve(root, folder, file)
  if (!target.startsWith(root)) return text('Invalid path', 400)
  const bytes = await fs.readFile(target)
  return binary(bytes, contentType(file), file.startsWith('final.') ? `attachment; filename="${file}"` : undefined)
}

function searchOptionsFromUrl(url: URL, limit?: number) {
  return {
    personIds: csv(url.searchParams.get('person_ids')),
    albumIds: csv(url.searchParams.get('album_ids')),
    takenAfter: url.searchParams.get('date_from') || undefined,
    takenBefore: url.searchParams.get('date_to') || undefined,
    limit,
  }
}

async function isWritable(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true })
    const test = path.join(dir, '.writetest')
    await fs.writeFile(test, 'ok')
    await fs.rm(test)
    return true
  } catch {
    return false
  }
}

function csv(value: string | null) {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status })
}

function text(data: string, status = 200) {
  return new Response(data, { status, headers: { 'content-type': 'text/plain' } })
}

function binary(bytes: Buffer, type: string, disposition?: string) {
  const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'public, max-age=3600' }
  if (disposition) headers['content-disposition'] = disposition
  return new Response(new Uint8Array(bytes), { headers })
}

function extensionFromType(type: string) {
  if (type === 'image/png') return '.png'
  if (type === 'image/webp') return '.webp'
  if (type === 'image/jpeg') return '.jpg'
  return ''
}

function contentType(file: string) {
  if (file.endsWith('.png')) return 'image/png'
  if (file.endsWith('.webp')) return 'image/webp'
  if (file.endsWith('.json')) return 'application/json'
  return 'image/jpeg'
}

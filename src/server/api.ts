import fs from 'node:fs/promises'
import path from 'node:path'
import { z, ZodError } from 'zod'
import { loadConfig, saveConfig, getImmichEnv, appConfigSchema } from './config'
import { ImmichClient, ImmichError } from './immich'
import { cancelJob, getProgress, startJob } from './jobs'
import { configDir, outputDir, uploadDir } from './paths'

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const startJobSchema = z.object({
  personIds: z.array(z.string()).default([]),
  albumIds: z.array(z.string()).default([]),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  mainImage: z.discriminatedUnion('type', [
    z.object({ type: z.literal('immich'), assetId: z.string().min(1) }),
    z.object({ type: z.literal('upload'), uploadId: z.string().min(1) }),
  ]),
  config: appConfigSchema.default({}),
})

export async function handleApi(request: Request, splat: string) {
  const url = new URL(request.url)
  const parts = splat.split('/').filter(Boolean)
  try {
    if (request.method === 'GET' && splat === 'health') return json({ ok: true })
    if (request.method === 'GET' && splat === 'status') return await status()
    if (request.method === 'GET' && splat === 'config') return json(await loadConfig())
    if (request.method === 'PUT' && splat === 'config') return await putConfig(request)
    if (request.method === 'GET' && splat === 'people') return await people()
    if (request.method === 'GET' && parts[0] === 'people' && parts[2] === 'thumbnail') return await peopleThumbnail(parts[1])
    if (request.method === 'GET' && splat === 'albums') return await albums()
    if (request.method === 'GET' && splat === 'asset-count-preview') return await assetCountPreview(url)
    if (request.method === 'GET' && splat === 'assets/search') return await assetSearch(url)
    if (request.method === 'GET' && splat === 'assets/search-page') return await assetSearchPage(url)
    if (request.method === 'GET' && parts[0] === 'assets' && parts[2] === 'thumbnail') return await assetThumbnail(parts[1])
    if (request.method === 'POST' && splat === 'uploads') return await upload(request)
    if (request.method === 'GET' && splat === 'jobs/current') return json(getProgress())
    if (request.method === 'POST' && splat === 'jobs') return await postJob(request)
    if (request.method === 'POST' && splat === 'jobs/cancel') return json({ cancelled: cancelJob() })
    if (request.method === 'GET' && splat === 'outputs') return await outputs()
    if (request.method === 'DELETE' && splat === 'outputs') return await deleteOutputs(request)
    if (request.method === 'POST' && splat === 'outputs/archive') return await archiveOutputs(request)
    if (request.method === 'GET' && parts[0] === 'outputs' && parts.length >= 3) return await outputFile(parts[1], parts.slice(2).join('/'))
    return text('Not found', 404)
  } catch (error) {
    const message = String((error as Error).message ?? error)
    const statusCode = errorStatus(error)
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
  return json(await client.searchAssets(searchOptionsFromUrl(url, boundedInt(url.searchParams.get('limit'), 80, 1, 1000))))
}

async function assetSearchPage(url: URL) {
  const client = ImmichClient.fromEnv(await loadConfig())
  return json(await client.searchAssetsPage({
    ...searchOptionsFromUrl(url),
    page: boundedInt(url.searchParams.get('page'), 1, 1, 1000),
    size: boundedInt(url.searchParams.get('limit'), 80, 1, 200),
  }))
}

async function upload(request: Request) {
  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return json({ error: 'file is required' }, 400)
  if (file.size <= 0) return json({ error: 'file must not be empty' }, 400)
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: 'file is too large; maximum upload size is 100 MB' }, 413)
  if (file.type && !IMAGE_TYPES.has(file.type)) return json({ error: 'file must be a JPEG, PNG, or WebP image' }, 400)
  await fs.mkdir(uploadDir(), { recursive: true })
  const ext = extensionFromType(file.type) || extensionFromName(file.name)
  if (!ext) return json({ error: 'file must be a JPEG, PNG, or WebP image' }, 400)
  const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`
  await fs.writeFile(path.join(uploadDir(), uploadId), Buffer.from(await file.arrayBuffer()))
  return json({ uploadId, name: file.name })
}

async function postJob(request: Request) {
  const body = startJobSchema.parse(await request.json())
  startJob(body)
  return json({ started: true })
}

async function outputs() {
  await fs.mkdir(outputDir(), { recursive: true })
  const entries = await fs.readdir(outputDir(), { withFileTypes: true })
  const folders = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const folder = entry.name
    const stat = await fs.stat(path.join(outputDir(), folder)).catch(() => null)
    const metadataPath = path.join(outputDir(), folder, 'metadata.json')
    let metadata = null
    try { metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) } catch {}
    const files: Array<string> = await fs.readdir(path.join(outputDir(), folder)).catch(() => [])
    const finalName = files.find((file) => file.startsWith('final.')) ?? null
    const hasPreview = files.includes('preview.jpg')
    return { folder, finalName, hasPreview, complete: Boolean(finalName && hasPreview), previewUrl: hasPreview ? `/api/outputs/${folder}/preview.jpg` : null, finalUrl: finalName ? `/api/outputs/${folder}/${finalName}` : null, metadata, modifiedTime: stat?.mtimeMs ?? 0 }
  }))
  return json(folders.sort((a, b) => b.modifiedTime - a.modifiedTime))
}

async function outputFile(folder: string, file: string) {
  const root = path.resolve(outputDir())
  const target = path.resolve(root, folder, file)
  if (!isPathInside(root, target)) return text('Invalid path', 400)
  const bytes = await fs.readFile(target)
  return binary(bytes, contentType(file), file.startsWith('final.') ? `attachment; filename="${file}"` : undefined)
}

async function deleteOutputs(request: Request) {
  const body = z.object({ folders: z.array(z.string()).min(1).max(100) }).parse(await request.json())
  const root = path.resolve(outputDir())
  const deleted: Array<string> = []
  for (const folder of body.folders) {
    const target = path.resolve(root, folder)
    if (!isPathInside(root, target)) return json({ error: `Invalid output folder: ${folder}` }, 400)
    const stat = await fs.stat(target).catch(() => null)
    if (!stat) continue
    if (!stat.isDirectory()) return json({ error: `Output is not a folder: ${folder}` }, 400)
    await fs.rm(target, { recursive: true, force: true })
    deleted.push(folder)
  }
  return json({ deleted })
}

async function archiveOutputs(request: Request) {
  const body = z.object({ folders: z.array(z.string()).min(1).max(100) }).parse(await request.json())
  const files = await collectArchiveFiles(body.folders)
  if (!files.length) return json({ error: 'No downloadable output files found' }, 404)
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const file of files) {
          const stat = await fs.stat(file.path)
          controller.enqueue(tarHeader(file.name, stat.size, stat.mtime))
          controller.enqueue(new Uint8Array(await fs.readFile(file.path)))
          const padding = (512 - (stat.size % 512)) % 512
          if (padding) controller.enqueue(new Uint8Array(padding))
        }
        controller.enqueue(new Uint8Array(1024))
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-tar',
      'content-disposition': 'attachment; filename="immich-photo-mosaic-outputs.tar"',
    },
  })
}

async function collectArchiveFiles(folders: Array<string>) {
  const root = path.resolve(outputDir())
  const files: Array<{ path: string; name: string }> = []
  for (const folder of folders) {
    const folderPath = path.resolve(root, folder)
    if (!isPathInside(root, folderPath)) throw new Error(`Invalid output folder: ${folder}`)
    const stat = await fs.stat(folderPath).catch(() => null)
    if (!stat?.isDirectory()) continue
    const entries = await fs.readdir(folderPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.startsWith('final.') && entry.name !== 'preview.jpg' && entry.name !== 'metadata.json') continue
      const fullPath = path.join(folderPath, entry.name)
      files.push({ path: fullPath, name: `${folder}/${entry.name}` })
    }
  }
  return files
}

function tarHeader(name: string, size: number, mtime: Date) {
  const buffer = Buffer.alloc(512, 0)
  writeString(buffer, name.slice(0, 100), 0, 100)
  writeOctal(buffer, 0o644, 100, 8)
  writeOctal(buffer, 0, 108, 8)
  writeOctal(buffer, 0, 116, 8)
  writeOctal(buffer, size, 124, 12)
  writeOctal(buffer, Math.floor(mtime.getTime() / 1000), 136, 12)
  buffer.fill(0x20, 148, 156)
  buffer[156] = '0'.charCodeAt(0)
  writeString(buffer, 'ustar', 257, 6)
  writeString(buffer, '00', 263, 2)
  const checksum = buffer.reduce((sum, byte) => sum + byte, 0)
  writeOctal(buffer, checksum, 148, 8)
  return new Uint8Array(buffer)
}

function writeString(buffer: Buffer, value: string, offset: number, length: number) {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8')
}

function writeOctal(buffer: Buffer, value: number, offset: number, length: number) {
  const text = value.toString(8).padStart(length - 1, '0').slice(0, length - 1)
  buffer.write(`${text}\0`, offset, length, 'ascii')
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

function boundedInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(parsed)))
}

function isPathInside(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function errorStatus(error: unknown) {
  if (error instanceof ZodError) return 400
  if (error instanceof ImmichError) return error.status ?? 502
  const message = String((error as Error).message ?? error)
  if (message.includes('already running')) return 409
  if (message.includes('must be set') || message.includes('Invalid path')) return 400
  return 500
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

function extensionFromName(name: string) {
  const ext = path.extname(name).toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext
  return ''
}

function contentType(file: string) {
  if (file.endsWith('.png')) return 'image/png'
  if (file.endsWith('.webp')) return 'image/webp'
  if (file.endsWith('.json')) return 'application/json'
  return 'image/jpeg'
}

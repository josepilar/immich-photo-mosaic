import { z } from 'zod'
import type { AppConfig } from './config'

export type FetchLike = typeof fetch

export type Person = { id: string; name?: string | null }
export type Album = { id: string; albumName: string; assetCount: number; albumThumbnailAssetId?: string | null }
export type Asset = {
  id: string
  originalFileName?: string | null
  type?: string | null
  fileCreatedAt?: string | null
  localDateTime?: string | null
  width?: number | null
  height?: number | null
  isArchived?: boolean | null
  isFavorite?: boolean | null
  isHidden?: boolean | null
  visibility?: string | null
}

export type SearchOptions = {
  personIds?: Array<string>
  albumIds?: Array<string>
  takenAfter?: string
  takenBefore?: string
  includeVideos?: boolean
  limit?: number
  page?: number
  size?: number
}

const peopleResponseSchema = z.object({
  people: z.array(z.object({ id: z.string(), name: z.string().nullable().optional() })),
})
const albumSchema = z.object({
  id: z.string(),
  albumName: z.string(),
  assetCount: z.number().default(0),
  albumThumbnailAssetId: z.string().nullable().optional(),
})
const searchResponseSchema = z.object({
  assets: z.object({
    items: z.array(z.any()),
    nextPage: z.string().nullable().optional(),
  }),
})

export class ImmichError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

const MAX_IMAGE_BYTES = 150 * 1024 * 1024

export class ImmichClient {
  readonly baseUrl: string
  private readonly apiKey: string
  private readonly fetchFn: FetchLike
  private readonly timeoutMs: number

  constructor(args: { baseUrl: string; apiKey: string; timeoutSeconds?: number; fetchFn?: FetchLike }) {
    this.baseUrl = ImmichClient.sanitizeBaseUrl(args.baseUrl)
    this.apiKey = args.apiKey
    this.fetchFn = args.fetchFn ?? fetch
    this.timeoutMs = (args.timeoutSeconds ?? 45) * 1000
  }

  static fromEnv(config: AppConfig, fetchFn?: FetchLike) {
    return new ImmichClient({
      baseUrl: process.env.IMMICH_BASE_URL ?? '',
      apiKey: process.env.IMMICH_API_KEY ?? '',
      timeoutSeconds: config.immich.timeoutSeconds,
      fetchFn,
    })
  }

  static sanitizeBaseUrl(url: string) {
    const trimmed = url.trim().replace(/\/+$/, '')
    if (!trimmed) return ''
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
  }

  buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>) {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  async validateConnection() {
    return this.requestJson<{ version: string }>('/server/about')
  }

  async getPeople(): Promise<Array<Person>> {
    const json = await this.requestJson<unknown>('/people')
    return peopleResponseSchema.parse(json).people
  }

  async getAlbums(): Promise<Array<Album>> {
    const json = await this.requestJson<unknown>('/albums')
    return z.array(albumSchema).parse(json)
  }

  async searchAssets(options: SearchOptions): Promise<Array<Asset>> {
    const all: Array<Asset> = []
    const limit = positiveNumber(options.limit, Number.POSITIVE_INFINITY)
    let page = 1
    while (all.length < limit && page <= 1000) {
      const body = {
        personIds: options.personIds?.length ? options.personIds : undefined,
        albumIds: options.albumIds?.length ? options.albumIds : undefined,
        takenAfter: options.takenAfter || undefined,
        takenBefore: options.takenBefore || undefined,
        type: options.includeVideos ? undefined : 'IMAGE',
        page,
        size: Math.min(100, limit - all.length),
        withPeople: false,
      }
      const json = await this.requestJson<unknown>('/search/metadata', { method: 'POST', body: JSON.stringify(body) })
      const parsed = searchResponseSchema.parse(json)
      all.push(...parsed.assets.items.map(normalizeAsset))
      if (!parsed.assets.nextPage) break
      page += 1
    }
    return all.slice(0, limit)
  }

  async searchAssetsPage(options: SearchOptions): Promise<{ items: Array<Asset>; page: number; hasMore: boolean }> {
    const page = Math.trunc(positiveNumber(options.page, 1))
    const size = Math.min(200, Math.trunc(positiveNumber(options.size, 100)))
    const body = {
      personIds: options.personIds?.length ? options.personIds : undefined,
      albumIds: options.albumIds?.length ? options.albumIds : undefined,
      takenAfter: options.takenAfter || undefined,
      takenBefore: options.takenBefore || undefined,
      type: options.includeVideos ? undefined : 'IMAGE',
      page,
      size,
      withPeople: false,
    }
    const json = await this.requestJson<unknown>('/search/metadata', { method: 'POST', body: JSON.stringify(body) })
    const parsed = searchResponseSchema.parse(json)
    return {
      items: parsed.assets.items.map(normalizeAsset),
      page,
      hasMore: Boolean(parsed.assets.nextPage),
    }
  }

  async downloadAsset(assetId: string, preview: boolean) {
    const encoded = encodeURIComponent(assetId)
    const path = preview ? `/assets/${encoded}/thumbnail` : `/assets/${encoded}/original`
    return this.requestBytes(path, preview ? { size: 'preview' } : undefined)
  }

  async thumbnail(assetId: string) {
    return this.requestBytes(`/assets/${encodeURIComponent(assetId)}/thumbnail`, { size: 'preview' })
  }

  async personThumbnail(personId: string) {
    return this.requestBytes(`/people/${encodeURIComponent(personId)}/thumbnail`)
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, undefined, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })
    return (await response.json()) as T
  }

  private async requestBytes(path: string, query?: Record<string, string>) {
    const response = await this.request(path, query)
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_IMAGE_BYTES)
      throw new ImmichError(`Image download is too large (${contentLength} bytes)`, 413)
    const contentType = response.headers.get('content-type') ?? 'image/jpeg'
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > MAX_IMAGE_BYTES)
      throw new ImmichError(`Image download is too large (${bytes.byteLength} bytes)`, 413)
    return { bytes, contentType }
  }

  private async request(path: string, query?: Record<string, string>, init: RequestInit = {}) {
    if (!this.baseUrl || !this.apiKey) throw new ImmichError('IMMICH_BASE_URL and IMMICH_API_KEY must be set')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchFn(this.buildUrl(path, query), {
        ...init,
        signal: controller.signal,
        headers: { 'x-api-key': this.apiKey, ...(init.headers ?? {}) },
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        if (response.status === 401) throw new ImmichError('Invalid or expired Immich API key (401)', 401)
        if (response.status === 403) throw new ImmichError(`Missing Immich API permission (403). ${body}`, 403)
        throw new ImmichError(`Immich API request failed: HTTP ${response.status}. ${body}`, response.status)
      }
      return response
    } catch (error) {
      if (controller.signal.aborted) throw new ImmichError('Immich API request timed out', 504)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

function normalizeAsset(asset: any): Asset {
  return {
    id: String(asset.id),
    originalFileName: asset.originalFileName ?? asset.originalPath ?? null,
    type: asset.type ?? asset.assetType ?? null,
    fileCreatedAt: asset.fileCreatedAt ?? null,
    localDateTime: asset.localDateTime ?? null,
    width: asset.exifInfo?.exifImageWidth ?? asset.exifInfo?.imageWidth ?? asset.width ?? asset.originalWidth ?? null,
    height:
      asset.exifInfo?.exifImageHeight ?? asset.exifInfo?.imageHeight ?? asset.height ?? asset.originalHeight ?? null,
    isArchived: asset.isArchived ?? null,
    isFavorite: asset.isFavorite ?? null,
    isHidden: asset.isHidden ?? (asset.visibility === 'hidden' ? true : null),
    visibility: asset.visibility ?? null,
  }
}

function positiveNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback
}

import { createFileRoute } from '@tanstack/react-router'
import { AlertCircle, CheckCircle2, Images, Info, Layers3, Loader2, Search, Settings2, XCircle } from 'lucide-react'
import * as React from 'react'
import Lightbox from 'yet-another-react-lightbox'
import Download from 'yet-another-react-lightbox/plugins/download'
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select } from '~/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import type { AppConfig } from '~/server/config'

export const Route = createFileRoute('/')({ component: App })

type Person = { id: string; name?: string | null }
type Album = {
  id: string
  albumName: string
  assetCount: number
  albumThumbnailAssetId?: string | null
}
type Asset = {
  id: string
  originalFileName?: string | null
  localDateTime?: string | null
  width?: number | null
  height?: number | null
}
type AssetPage = { items: Array<Asset>; page: number; hasMore: boolean }
type Output = {
  folder: string
  finalName: string | null
  previewUrl: string | null
  finalUrl: string | null
  complete?: boolean
}
type Status = {
  connected: boolean
  version?: string
  error?: string
  env?: { hasApiKey: boolean; baseUrl: string | null }
  writable?: { config: boolean; output: boolean }
}
type ImageDimensions = { width: number; height: number }
type Job = {
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
  output?: {
    folder: string
    finalName: string
    previewUrl: string
    finalUrl: string
  }
  error?: string
}

const defaultMosaic: AppConfig['mosaic'] = {
  outputWidth: 3200,
  outputHeight: 2133,
  targetMegapixels: 0,
  tileSize: 64,
  columns: 0,
  rows: 0,
  automaticGrid: true,
  tileAspectRatio: 1,
  fitMode: 'cover',
  paddingMode: 'blurred',
  paddingColor: '#111827',
  mainImageOpacity: 0.2,
  colorMatchingStrength: 0.55,
  repeatLimit: 5,
  minRepeatSpacing: 20,
  candidatePoolLimit: 800,
  brightnessFilterEnabled: false,
  minBrightness: 0.08,
  maxBrightness: 0.94,
  blurFilterEnabled: false,
  minSharpness: 24,
  includeHidden: false,
  includeArchived: false,
  includeFavoritesOnly: false,
  includeVideos: false,
  randomSeed: 1337,
  outputFormat: 'jpeg',
  quality: 90,
  keepIntermediates: false,
}

const defaultConfig: AppConfig = {
  immich: { timeoutSeconds: 45 },
  filters: { albumIds: [], dateFrom: '', dateTo: '' },
  mosaic: defaultMosaic,
}

function App() {
  const [config, setConfig] = React.useState<AppConfig>(defaultConfig)
  const [status, setStatus] = React.useState<Status | null>(null)
  const [people, setPeople] = React.useState<Array<Person>>([])
  const [albums, setAlbums] = React.useState<Array<Album>>([])
  const [selectedPeople, setSelectedPeople] = React.useState<Array<string>>([])
  const [selectedAlbums, setSelectedAlbums] = React.useState<Array<string>>([])
  const [dateFrom, setDateFrom] = React.useState('')
  const [dateTo, setDateTo] = React.useState('')
  const [assetCount, setAssetCount] = React.useState<number | null>(null)
  const [mainMode, setMainMode] = React.useState<'immich' | 'upload'>('immich')
  const [assets, setAssets] = React.useState<Array<Asset>>([])
  const [assetPage, setAssetPage] = React.useState(0)
  const [hasMoreImages, setHasMoreImages] = React.useState(false)
  const [loadingImages, setLoadingImages] = React.useState(false)
  const [mainFilterPersonIds, setMainFilterPersonIds] = React.useState<Array<string>>([])
  const [mainFilterAlbumId, setMainFilterAlbumId] = React.useState('')
  const [mainFilterDateFrom, setMainFilterDateFrom] = React.useState('')
  const [mainFilterDateTo, setMainFilterDateTo] = React.useState('')
  const [mainAssetId, setMainAssetId] = React.useState('')
  const [uploadId, setUploadId] = React.useState('')
  const [targetDimensions, setTargetDimensions] = React.useState<ImageDimensions | null>(null)
  const [job, setJob] = React.useState<Job | null>(null)
  const [outputs, setOutputs] = React.useState<Array<Output>>([])
  const [message, setMessage] = React.useState('')
  const previousJobStatus = React.useRef<Job['status']>('idle')
  const autoLoadedImages = React.useRef(false)
  const mainImageFilterKey = [
    mainFilterPersonIds.join(','),
    mainFilterAlbumId,
    mainFilterDateFrom,
    mainFilterDateTo,
  ].join('|')

  React.useEffect(() => {
    void boot()
  }, [])
  React.useEffect(() => {
    const timer = setInterval(
      () => {
        void refreshJobAndOutputs()
      },
      job?.status === 'running' || job?.status === 'cancelling' ? 1000 : 4000,
    )
    return () => clearInterval(timer)
  }, [job?.status])
  React.useEffect(() => {
    void refreshCount()
  }, [selectedPeople.join(','), selectedAlbums.join(','), dateFrom, dateTo])
  React.useEffect(() => {
    if (!status?.connected || mainMode !== 'immich' || assets.length > 0 || autoLoadedImages.current) return
    autoLoadedImages.current = true
    void loadImages(true)
  }, [status?.connected, mainMode, assets.length, mainImageFilterKey])
  React.useEffect(() => {
    autoLoadedImages.current = false
    setAssets([])
    setAssetPage(0)
    setHasMoreImages(false)
  }, [mainImageFilterKey])

  async function boot() {
    const [cfg, stat, ppl, alb, current, out] = await Promise.all([
      api<AppConfig>('/api/config').catch(() => defaultConfig),
      api<Status>('/api/status').catch((error) => ({
        connected: false,
        error: String(error),
      })),
      api<Array<Person>>('/api/people').catch(() => []),
      api<Array<Album>>('/api/albums').catch(() => []),
      fetchJobSnapshot(),
      fetchOutputs(),
    ])
    setConfig(cfg)
    setSelectedAlbums(cfg.filters.albumIds)
    setDateFrom(cfg.filters.dateFrom)
    setDateTo(cfg.filters.dateTo)
    setStatus(stat)
    setPeople(ppl)
    setAlbums(alb)
    setJob(current)
    previousJobStatus.current = current.status
    setOutputs(out)
  }

  async function refreshJobAndOutputs() {
    const nextJob = await fetchJobSnapshot()
    const previous = previousJobStatus.current
    setJob(nextJob)
    const terminal = nextJob.status === 'completed' || nextJob.status === 'cancelled' || nextJob.status === 'error'
    if (terminal && previous !== nextJob.status) setOutputs(await fetchOutputs())
    previousJobStatus.current = nextJob.status
  }

  async function refreshCount() {
    const params = qs({
      person_ids: selectedPeople.join(','),
      album_ids: selectedAlbums.join(','),
      date_from: dateFrom,
      date_to: dateTo,
    })
    const data = await api<{ totalAssets: number }>(`/api/asset-count-preview?${params}`).catch(() => null)
    setAssetCount(data?.totalAssets ?? null)
  }

  async function loadImages(reset = false) {
    if (loadingImages) return
    setLoadingImages(true)
    try {
      const page = reset ? 1 : assetPage + 1
      const data = await api<AssetPage>(
        `/api/assets/search-page?${qs({
          limit: '80',
          page: String(page),
          person_ids: mainFilterPersonIds.join(','),
          album_ids: mainFilterAlbumId,
          date_from: mainFilterDateFrom,
          date_to: mainFilterDateTo,
        })}`,
      )
      const nextAssets = reset ? data.items : dedupeAssets([...assets, ...data.items])
      setAssets(nextAssets)
      setAssetPage(data.page)
      setHasMoreImages(data.hasMore)
      setMessage(
        data.hasMore
          ? `Loaded ${nextAssets.length} Immich images. Scroll for more.`
          : 'Loaded all matching Immich images.',
      )
    } catch (error) {
      setMessage(String((error as Error).message ?? error))
    } finally {
      setLoadingImages(false)
    }
  }

  async function selectMainAsset(asset: Asset) {
    if (asset.id !== mainAssetId) refreshRandomSeed()
    setMainAssetId(asset.id)
    const dimensions =
      asset.width && asset.height
        ? { width: asset.width, height: asset.height }
        : await loadImageDimensions(`/api/assets/${asset.id}/thumbnail`).catch(() => null)
    if (dimensions) applyTargetDimensions(dimensions)
  }

  async function uploadMain(file: File | null) {
    if (!file) return
    try {
      const dimensions = await fileDimensions(file).catch(() => null)
      const form = new FormData()
      form.set('file', file)
      const result = await api<{ uploadId: string; name: string }>('/api/uploads', {
        method: 'POST',
        body: form,
        headers: undefined,
      })
      setUploadId(result.uploadId)
      refreshRandomSeed()
      if (dimensions) applyTargetDimensions(dimensions)
      setMessage(`Uploaded ${result.name}`)
    } catch (error) {
      setMessage(String((error as Error).message ?? error))
    }
  }

  function applyTargetDimensions(dimensions: ImageDimensions) {
    if (!dimensions.width || !dimensions.height) return
    const aspect = dimensions.width / dimensions.height
    setTargetDimensions(dimensions)
    setConfig((current) => ({
      ...current,
      mosaic: {
        ...current.mosaic,
        outputHeight: Math.round(current.mosaic.outputWidth / aspect),
      },
    }))
  }

  function patchConfig(value: Partial<AppConfig['mosaic']>) {
    setConfig((current) => ({
      ...current,
      mosaic: { ...current.mosaic, ...value },
    }))
  }

  function refreshRandomSeed() {
    patchConfig({ randomSeed: randomMosaicSeed() })
  }

  function setLockedOutputWidth(width: number) {
    const aspect = targetDimensions ? targetDimensions.width / targetDimensions.height : null
    patchConfig({
      outputWidth: width,
      outputHeight: aspect ? Math.round(width / aspect) : config.mosaic.outputHeight,
    })
  }

  async function saveSettings() {
    try {
      const next = {
        ...config,
        filters: { albumIds: selectedAlbums, dateFrom, dateTo },
      }
      setConfig(
        await api<AppConfig>('/api/config', {
          method: 'PUT',
          body: JSON.stringify(next),
        }),
      )
      setMessage('Settings saved to /app/config/config.toml')
      return true
    } catch (error) {
      setMessage(String((error as Error).message ?? error))
      return false
    }
  }

  async function start() {
    try {
      if (!(await saveSettings())) return
      const mainImage =
        mainMode === 'immich'
          ? { type: 'immich' as const, assetId: mainAssetId }
          : { type: 'upload' as const, uploadId }
      if (mainImage.type === 'immich' && !mainImage.assetId) throw new Error('Select a main Immich image')
      if (mainImage.type === 'upload' && !mainImage.uploadId) throw new Error('Upload a main image')
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          personIds: selectedPeople,
          albumIds: selectedAlbums,
          dateFrom,
          dateTo,
          mainImage,
          config,
        }),
      })
      await refreshJobAndOutputs()
    } catch (error) {
      setMessage(String((error as Error).message ?? error))
    }
  }

  const running = job?.status === 'running' || job?.status === 'cancelling'
  const connected = Boolean(status?.connected)
  const hasMainImage = mainMode === 'immich' ? Boolean(mainAssetId) : Boolean(uploadId)
  const completedOutputs = outputs.filter((out) => out.complete !== false && out.finalName && out.previewUrl).length

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 rounded-2xl border border-white/10 bg-zinc-800 p-6 lg:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-zinc-300">
                Immich photo mosaic
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-stone-100 sm:text-5xl lg:text-6xl">
                Turn a library into a photo mosaic.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
                Choose a target photo, curate source tiles from people, albums, and dates, then tune the render into a
                high-resolution still image.
              </p>
            </div>
            <ConnectionBadge connected={connected} status={status} onRefresh={boot} />
          </div>
          <div className="mt-8 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <HeroStat label="People" value={String(people.length)} />
            <HeroStat label="Albums" value={String(albums.length)} />
            <HeroStat label="Candidates" value={assetCount == null ? '...' : String(assetCount)} />
            <HeroStat label="Outputs" value={String(completedOutputs)} />
          </div>
        </header>

        {message && (
          <div className="mb-5 rounded-xl border border-white/10 bg-zinc-800 px-4 py-3 text-sm text-zinc-300">
            {message}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div className="space-y-5">
            {connected ? (
              <>
                <MainImageSelector
                  mode={mainMode}
                  setMode={setMainMode}
                  people={people}
                  albums={albums}
                  filterPersonIds={mainFilterPersonIds}
                  setFilterPersonIds={setMainFilterPersonIds}
                  filterAlbumId={mainFilterAlbumId}
                  setFilterAlbumId={setMainFilterAlbumId}
                  filterDateFrom={mainFilterDateFrom}
                  setFilterDateFrom={setMainFilterDateFrom}
                  filterDateTo={mainFilterDateTo}
                  setFilterDateTo={setMainFilterDateTo}
                  assets={assets}
                  loadMoreImages={() => void loadImages(false)}
                  hasMoreImages={hasMoreImages}
                  loadingImages={loadingImages}
                  selectedAsset={mainAssetId}
                  selectAsset={(asset) => void selectMainAsset(asset)}
                  uploadId={uploadId}
                  uploadMain={uploadMain}
                  disabled={running}
                  targetDimensions={targetDimensions}
                />
                <SourcePanel
                  people={people}
                  selectedPeople={selectedPeople}
                  setSelectedPeople={setSelectedPeople}
                  albums={albums}
                  selectedAlbums={selectedAlbums}
                  setSelectedAlbums={setSelectedAlbums}
                  dateFrom={dateFrom}
                  setDateFrom={setDateFrom}
                  dateTo={dateTo}
                  setDateTo={setDateTo}
                  assetCount={assetCount}
                  disabled={running}
                />
                <SettingsTabs
                  config={config}
                  patch={patchConfig}
                  setLockedOutputWidth={setLockedOutputWidth}
                  targetDimensions={targetDimensions}
                  restoreDefaults={() =>
                    setConfig((current) => ({
                      ...current,
                      mosaic: targetDimensions
                        ? {
                            ...defaultMosaic,
                            outputHeight: Math.round(
                              defaultMosaic.outputWidth / (targetDimensions.width / targetDimensions.height),
                            ),
                          }
                        : defaultMosaic,
                    }))
                  }
                  onSave={() => void saveSettings()}
                  disabled={running}
                />
                <Preview job={job} />
              </>
            ) : (
              <Card className="border-yellow-700/40 bg-yellow-950/20">
                <CardContent className="p-8 text-center text-stone-200">
                  Connect to your Immich server to get started. Set `IMMICH_API_KEY` and `IMMICH_BASE_URL` in Docker.
                </CardContent>
              </Card>
            )}
          </div>

          <aside className="space-y-5 lg:sticky lg:top-6">
            <ActionPanel job={job} running={running} hasMainImage={hasMainImage} onStart={() => void start()} />
            <ProgressView
              job={job}
              onCancel={() => api('/api/jobs/cancel', { method: 'POST' }).then(() => refreshJobAndOutputs())}
            />
          </aside>
        </div>

        {connected && (
          <div className="mt-5">
            <OutputHistory outputs={outputs} onChanged={() => void fetchOutputs().then(setOutputs)} />
          </div>
        )}
      </div>
    </main>
  )
}

function ConnectionBadge({
  connected,
  status,
  onRefresh,
}: {
  connected: boolean
  status: Status | null
  onRefresh: () => void
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="group relative w-fit">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${connected ? 'border-green-700/50 bg-green-950/30 text-green-200' : 'border-red-700/50 bg-red-950/30 text-red-200'}`}
      >
        {connected ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
        {connected ? 'Connected' : 'Not connected'}
      </button>
      <div
        className={`${open ? 'block' : 'hidden'} absolute left-0 top-full z-30 mt-3 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-white/10 bg-zinc-800 p-4 text-left shadow-lg shadow-black/30 group-hover:block group-focus-within:block sm:left-auto sm:right-0`}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-stone-100">Connection</div>
            <div className="text-xs text-zinc-400">Immich and volume status</div>
          </div>
          <Button size="sm" variant="ghost" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
        <div className="space-y-3 text-sm text-zinc-300">
          <ConnectionRow label="Immich" value={status?.env?.baseUrl ?? 'not configured'} />
          <ConnectionRow label="API key" value={status?.env?.hasApiKey ? 'provided by environment' : 'missing'} />
          <ConnectionRow label="Version" value={status?.version || 'unknown'} />
          <div className="grid grid-cols-2 gap-2 pt-1">
            <VolumePill label="Config" writable={Boolean(status?.writable?.config)} />
            <VolumePill label="Output" writable={Boolean(status?.writable?.output)} />
          </div>
          {status?.error && (
            <p className="rounded-xl border border-red-700/50 bg-red-950/30 p-3 text-red-200">{status.error}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900 p-4">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-stone-100">{value}</div>
    </div>
  )
}

function ConnectionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900 p-3">
      <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-stone-100">{value}</div>
    </div>
  )
}

function VolumePill({ label, writable }: { label: string; writable: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 text-xs ${writable ? 'border-green-700/50 bg-green-950/30 text-green-200' : 'border-yellow-700/50 bg-yellow-950/30 text-yellow-200'}`}
    >
      <div className="font-medium">{label}</div>
      <div className="mt-1 opacity-80">{writable ? 'Writable' : 'Check perms'}</div>
    </div>
  )
}

function ActionPanel({
  job,
  running,
  hasMainImage,
  onStart,
}: {
  job: Job | null
  running: boolean
  hasMainImage: boolean
  onStart: () => void
}) {
  return (
    <Card className="border-stone-300/20 bg-zinc-800">
      <CardHeader>
        <CardTitle>Render</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Button className="w-full" onClick={onStart} disabled={running || !hasMainImage}>
            {running ? 'Running' : 'Generate Mosaic'}
          </Button>
          <Button className="w-full" variant="outline" onClick={onStart} disabled={running || !job?.output}>
            Re-run Same Setup
          </Button>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-900 p-3 text-sm text-zinc-300">
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500">Status</span>
            <span className="font-medium capitalize text-stone-100">{job?.status ?? 'idle'}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-zinc-500">Stage</span>
            <span className="truncate font-medium text-stone-100">{job?.stage ?? 'idle'}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MainImageSelector(props: {
  mode: 'immich' | 'upload'
  setMode: (v: 'immich' | 'upload') => void
  people: Array<Person>
  albums: Array<Album>
  filterPersonIds: Array<string>
  setFilterPersonIds: (v: Array<string>) => void
  filterAlbumId: string
  setFilterAlbumId: (v: string) => void
  filterDateFrom: string
  setFilterDateFrom: (v: string) => void
  filterDateTo: string
  setFilterDateTo: (v: string) => void
  assets: Array<Asset>
  loadMoreImages: () => void
  hasMoreImages: boolean
  loadingImages: boolean
  selectedAsset: string
  selectAsset: (asset: Asset) => void
  uploadId: string
  uploadMain: (file: File | null) => void
  disabled: boolean
  targetDimensions: ImageDimensions | null
}) {
  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const el = event.currentTarget
    if (props.hasMoreImages && !props.loadingImages && el.scrollTop + el.clientHeight >= el.scrollHeight - 220)
      props.loadMoreImages()
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Images className="size-4 text-zinc-300" /> 1. Main Photo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-400">This photo determines the final mosaic aspect ratio.</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={props.mode === 'immich' ? 'default' : 'secondary'}
            onClick={() => props.setMode('immich')}
          >
            Immich
          </Button>
          <Button
            size="sm"
            variant={props.mode === 'upload' ? 'default' : 'secondary'}
            onClick={() => props.setMode('upload')}
          >
            Upload
          </Button>
          {props.targetDimensions && (
            <span className="self-center text-xs text-slate-400">
              Aspect locked to {props.targetDimensions.width}x{props.targetDimensions.height}
            </span>
          )}
        </div>
        {props.mode === 'immich' ? (
          <>
            <div className="rounded-2xl border border-white/10 bg-zinc-900 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <Label>Browse Filters</Label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    props.setFilterPersonIds([])
                    props.setFilterAlbumId('')
                    props.setFilterDateFrom('')
                    props.setFilterDateTo('')
                  }}
                  disabled={
                    props.disabled ||
                    (!props.filterPersonIds.length &&
                      !props.filterAlbumId &&
                      !props.filterDateFrom &&
                      !props.filterDateTo)
                  }
                >
                  Clear
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <PersonMultiSelect
                  people={props.people}
                  selectedIds={props.filterPersonIds}
                  setSelectedIds={props.setFilterPersonIds}
                  disabled={props.disabled}
                />
                <Select
                  value={props.filterAlbumId}
                  onChange={(event) => props.setFilterAlbumId(event.target.value)}
                  disabled={props.disabled}
                  aria-label="Filter main photos by album"
                >
                  <option value="">Any album</option>
                  {props.albums.map((album) => (
                    <option key={album.id} value={album.id}>
                      {album.albumName}
                    </option>
                  ))}
                </Select>
                <Input
                  type="date"
                  value={props.filterDateFrom}
                  onChange={(event) => props.setFilterDateFrom(event.target.value)}
                  disabled={props.disabled}
                  aria-label="Filter main photos from date"
                />
                <Input
                  type="date"
                  value={props.filterDateTo}
                  onChange={(event) => props.setFilterDateTo(event.target.value)}
                  disabled={props.disabled}
                  aria-label="Filter main photos to date"
                />
              </div>
            </div>
            <div
              onScroll={onScroll}
              className="grid max-h-[28rem] grid-cols-2 gap-3 overflow-auto rounded-xl border border-white/10 bg-zinc-900 p-3 scrollbar-thin sm:grid-cols-3 md:grid-cols-4"
            >
              {props.assets.map((asset) => (
                <button
                  type="button"
                  key={asset.id}
                  onClick={() => props.selectAsset(asset)}
                  className={`overflow-hidden rounded-xl border bg-zinc-800 p-1.5 text-left transition ${props.selectedAsset === asset.id ? 'border-stone-200 bg-zinc-700' : 'border-white/10 hover:border-white/30'}`}
                >
                  <img
                    src={`/api/assets/${asset.id}/thumbnail`}
                    className="aspect-square w-full rounded-xl object-cover"
                    alt={asset.originalFileName || 'Immich asset thumbnail'}
                  />
                  <div className="truncate text-[10px] text-slate-400">{asset.originalFileName || asset.id}</div>
                </button>
              ))}
              {props.loadingImages && (
                <div className="col-span-full flex items-center justify-center gap-2 py-4 text-sm text-slate-400">
                  <Loader2 className="size-4 animate-spin" />
                  {props.assets.length ? 'Loading more images' : 'Loading images'}
                </div>
              )}
              {!props.loadingImages && props.assets.length === 0 && (
                <div className="col-span-full py-6 text-center text-sm text-slate-400">
                  No images match the current filters.
                </div>
              )}
              {props.assets.length > 0 && !props.hasMoreImages && (
                <div className="col-span-full py-3 text-center text-xs text-slate-500">All matching images loaded</div>
              )}
            </div>
          </>
        ) : (
          <>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => void props.uploadMain(e.currentTarget.files?.[0] ?? null)}
              disabled={props.disabled}
            />
            {props.uploadId && <p className="text-sm text-green-300">Upload ready: {props.uploadId}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function PersonMultiSelect({
  people,
  selectedIds,
  setSelectedIds,
  disabled,
}: {
  people: Array<Person>
  selectedIds: Array<string>
  setSelectedIds: (v: Array<string>) => void
  disabled: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const selected = people.filter((person) => selectedIds.includes(person.id))
  const label =
    selected.length === 0
      ? 'Any person'
      : selected.length === 1
        ? selected[0].name || 'Unnamed'
        : `${selected.length} people`

  function toggle(id: string) {
    setSelectedIds(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id])
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        className="flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-zinc-800 px-3.5 text-left text-sm text-stone-100 outline-none transition hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate">{label}</span>
        <span className="text-xs text-zinc-500">People</span>
      </button>
      {open && !disabled && (
        <div className="absolute left-0 top-full z-40 mt-2 max-h-72 w-full min-w-72 overflow-auto rounded-xl border border-white/10 bg-zinc-800 p-2 shadow-lg shadow-black/30 scrollbar-thin">
          {people.length ? (
            people.map((person) => {
              const checked = selectedIds.includes(person.id)
              return (
                <button
                  type="button"
                  key={person.id}
                  onClick={() => toggle(person.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition ${checked ? 'bg-zinc-700 text-stone-100' : 'text-zinc-300 hover:bg-zinc-700/60 hover:text-stone-100'}`}
                >
                  <img
                    src={`/api/people/${person.id}/thumbnail`}
                    className="size-8 rounded-full object-cover ring-1 ring-white/15"
                    alt={person.name ? `${person.name} thumbnail` : 'Person thumbnail'}
                  />
                  <span className="min-w-0 flex-1 truncate">{person.name || 'Unnamed'}</span>
                  <input className="size-4 accent-stone-200" type="checkbox" checked={checked} readOnly />
                </button>
              )
            })
          ) : (
            <div className="px-3 py-4 text-sm text-zinc-400">No people found</div>
          )}
        </div>
      )}
    </div>
  )
}

function SourcePanel(props: {
  people: Array<Person>
  selectedPeople: Array<string>
  setSelectedPeople: (v: Array<string>) => void
  albums: Array<Album>
  selectedAlbums: Array<string>
  setSelectedAlbums: (v: Array<string>) => void
  dateFrom: string
  setDateFrom: (v: string) => void
  dateTo: string
  setDateTo: (v: string) => void
  assetCount: number | null
  disabled: boolean
}) {
  const [query, setQuery] = React.useState('')
  const filtered = props.people.filter((person) =>
    (person.name || 'Unnamed').toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers3 className="size-4 text-zinc-300" /> 2. Mosaic Source Photos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-400">
          Select people to use their photos as tiles. Leave everyone unselected to use any eligible photo.
        </p>
        <div className="relative">
          <Search className="absolute left-3 top-3 size-4 text-slate-500" />
          <Input
            className="pl-9"
            placeholder="Search people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="grid max-h-[320px] grid-cols-3 gap-3 overflow-auto rounded-xl border border-white/10 bg-zinc-900 p-3 scrollbar-thin sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {filtered.map((person) => (
            <button
              type="button"
              key={person.id}
              disabled={props.disabled}
              onClick={() =>
                props.setSelectedPeople(
                  props.selectedPeople.includes(person.id)
                    ? props.selectedPeople.filter((id) => id !== person.id)
                    : [...props.selectedPeople, person.id],
                )
              }
              className={`rounded-xl border p-2 text-center transition ${props.selectedPeople.includes(person.id) ? 'border-stone-200 bg-zinc-700' : 'border-white/10 bg-zinc-800 hover:border-white/30'}`}
            >
              <img
                src={`/api/people/${person.id}/thumbnail`}
                className="mx-auto mb-1.5 size-14 rounded-full object-cover ring-1 ring-white/15"
                alt={person.name ? `${person.name} thumbnail` : 'Person thumbnail'}
              />
              <div className="truncate text-[11px]">{person.name || 'Unnamed'}</div>
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="From">
            <Input
              type="date"
              value={props.dateFrom}
              onChange={(e) => props.setDateFrom(e.target.value)}
              disabled={props.disabled}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={props.dateTo}
              onChange={(e) => props.setDateTo(e.target.value)}
              disabled={props.disabled}
            />
          </Field>
        </div>
        <div className="max-h-44 space-y-1 overflow-auto rounded-xl border border-white/10 bg-zinc-900 p-2 scrollbar-thin">
          {props.albums.map((album) => (
            <label key={album.id} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-zinc-800">
              <input
                type="checkbox"
                disabled={props.disabled}
                checked={props.selectedAlbums.includes(album.id)}
                onChange={() =>
                  props.setSelectedAlbums(
                    props.selectedAlbums.includes(album.id)
                      ? props.selectedAlbums.filter((id) => id !== album.id)
                      : [...props.selectedAlbums, album.id],
                  )
                }
              />
              <span className="truncate">{album.albumName}</span>
              <span className="ml-auto text-xs text-slate-500">{album.assetCount}</span>
            </label>
          ))}
        </div>
        <p className="text-sm text-slate-400">Candidate source assets found: {props.assetCount ?? 'loading...'}</p>
      </CardContent>
    </Card>
  )
}

function SettingsTabs(props: {
  config: AppConfig
  patch: (value: Partial<AppConfig['mosaic']>) => void
  setLockedOutputWidth: (width: number) => void
  targetDimensions: ImageDimensions | null
  restoreDefaults: () => void
  onSave: () => void
  disabled: boolean
}) {
  const [tab, setTab] = React.useState('output')
  const m = props.config.mosaic
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Settings2 className="size-4 text-zinc-300" /> 3. Mosaic Settings
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={props.onSave} disabled={props.disabled}>
            Save Settings
          </Button>
          <Button size="sm" variant="outline" onClick={props.restoreDefaults} disabled={props.disabled}>
            Restore Defaults
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <Tabs className="space-y-6">
          <TabsList className="flex flex-wrap gap-1">
            <TabsTrigger active={tab === 'output'} onClick={() => setTab('output')}>
              Output
            </TabsTrigger>
            <TabsTrigger active={tab === 'tiles'} onClick={() => setTab('tiles')}>
              Tiles
            </TabsTrigger>
            <TabsTrigger active={tab === 'matching'} onClick={() => setTab('matching')}>
              Matching
            </TabsTrigger>
            <TabsTrigger active={tab === 'sources'} onClick={() => setTab('sources')}>
              Sources
            </TabsTrigger>
            <TabsTrigger active={tab === 'advanced'} onClick={() => setTab('advanced')}>
              Advanced
            </TabsTrigger>
          </TabsList>
          {tab === 'output' && (
            <TabsContent>
              <p className="text-sm text-slate-400">Output height is locked to the selected main photo aspect ratio.</p>
              <div className="grid gap-5 md:grid-cols-3">
                <NumberField
                  label="Output width"
                  value={m.outputWidth}
                  set={props.setLockedOutputWidth}
                  disabled={props.disabled}
                />
                <NumberField
                  label="Output height"
                  value={m.outputHeight}
                  set={(v) => props.patch({ outputHeight: v })}
                  disabled={Boolean(props.targetDimensions) || props.disabled}
                />
                <NumberField
                  label="Megapixel target"
                  value={m.targetMegapixels}
                  set={(v) => props.patch({ targetMegapixels: v })}
                  disabled={props.disabled}
                />
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Format">
                  <Select
                    disabled={props.disabled}
                    value={m.outputFormat}
                    onChange={(e) =>
                      props.patch({
                        outputFormat: e.target.value as AppConfig['mosaic']['outputFormat'],
                      })
                    }
                  >
                    <option value="jpeg">JPG</option>
                    <option value="png">PNG</option>
                    <option value="webp">WebP</option>
                  </Select>
                </Field>
                <RangeField
                  label="JPEG/WebP quality"
                  min={50}
                  max={100}
                  step={1}
                  value={m.quality}
                  set={(v) => props.patch({ quality: v })}
                  disabled={props.disabled}
                />
              </div>
            </TabsContent>
          )}
          {tab === 'tiles' && (
            <TabsContent>
              <div className="grid gap-5 md:grid-cols-2">
                <RangeField
                  label="Tile size"
                  min={16}
                  max={128}
                  step={4}
                  value={m.tileSize}
                  set={(v) => props.patch({ tileSize: v })}
                  disabled={props.disabled}
                />
                <Field label="Fit mode">
                  <Select
                    disabled={props.disabled}
                    value={m.fitMode}
                    onChange={(e) =>
                      props.patch({
                        fitMode: e.target.value as AppConfig['mosaic']['fitMode'],
                      })
                    }
                  >
                    <option value="contain">Contain, no crop</option>
                    <option value="cover">Cover, crop edges</option>
                    <option value="stretch">Stretch</option>
                  </Select>
                </Field>
                <Field label="Padding for contain">
                  <Select
                    disabled={props.disabled}
                    value={m.paddingMode}
                    onChange={(e) =>
                      props.patch({
                        paddingMode: e.target.value as AppConfig['mosaic']['paddingMode'],
                      })
                    }
                  >
                    <option value="blurred">Blurred image</option>
                    <option value="dominant">Dominant color</option>
                    <option value="black">Black</option>
                    <option value="white">White</option>
                    <option value="custom">Custom color</option>
                  </Select>
                </Field>
                <Field label="Custom padding color">
                  <Input
                    type="color"
                    value={m.paddingColor}
                    onChange={(e) => props.patch({ paddingColor: e.target.value })}
                    disabled={props.disabled || m.paddingMode !== 'custom'}
                  />
                </Field>
              </div>
            </TabsContent>
          )}
          {tab === 'matching' && (
            <TabsContent>
              <div className="grid gap-5 md:grid-cols-2">
                <RangeField
                  label="Main photo influence"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={m.mainImageOpacity}
                  set={(v) => props.patch({ mainImageOpacity: v })}
                  disabled={props.disabled}
                />
                <RangeField
                  label="Color matching strength"
                  min={0}
                  max={1}
                  step={0.05}
                  value={m.colorMatchingStrength}
                  set={(v) => props.patch({ colorMatchingStrength: v })}
                  disabled={props.disabled}
                />
                <RangeField
                  label="Repeat limit per photo"
                  min={1}
                  max={20}
                  step={1}
                  value={m.repeatLimit}
                  set={(v) => props.patch({ repeatLimit: v })}
                  disabled={props.disabled}
                />
                <RangeField
                  label="Minimum repeat spacing"
                  min={0}
                  max={100}
                  step={1}
                  value={m.minRepeatSpacing}
                  set={(v) => props.patch({ minRepeatSpacing: v })}
                  disabled={props.disabled}
                />
              </div>
            </TabsContent>
          )}
          {tab === 'sources' && (
            <TabsContent>
              <div className="grid gap-5 md:grid-cols-2">
                <RangeField
                  label="Candidate pool limit"
                  min={50}
                  max={5000}
                  step={50}
                  value={m.candidatePoolLimit}
                  set={(v) => props.patch({ candidatePoolLimit: v })}
                  disabled={props.disabled}
                />
                <ToggleField
                  label="Include archived"
                  checked={m.includeArchived}
                  set={(v) => props.patch({ includeArchived: v })}
                  disabled={props.disabled}
                />
                <ToggleField
                  label="Include hidden"
                  checked={m.includeHidden}
                  set={(v) => props.patch({ includeHidden: v })}
                  disabled={props.disabled}
                />
                <ToggleField
                  label="Favorites only"
                  checked={m.includeFavoritesOnly}
                  set={(v) => props.patch({ includeFavoritesOnly: v })}
                  disabled={props.disabled}
                />
              </div>
            </TabsContent>
          )}
          {tab === 'advanced' && (
            <TabsContent>
              <div className="grid gap-5 md:grid-cols-2">
                <NumberField
                  label="Random seed"
                  value={m.randomSeed}
                  set={(v) => props.patch({ randomSeed: v })}
                  disabled={props.disabled}
                />
                <ToggleField
                  label="Keep debug intermediates"
                  checked={m.keepIntermediates}
                  set={(v) => props.patch({ keepIntermediates: v })}
                  disabled={props.disabled}
                />
                <ToggleField
                  label="Brightness filter"
                  checked={m.brightnessFilterEnabled}
                  set={(v) => props.patch({ brightnessFilterEnabled: v })}
                  disabled={props.disabled}
                />
                <ToggleField
                  label="Blur filter"
                  checked={m.blurFilterEnabled}
                  set={(v) => props.patch({ blurFilterEnabled: v })}
                  disabled={props.disabled}
                />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  )
}

function ProgressView({ job, onCancel }: { job: Job | null; onCancel: () => void }) {
  if (!job || (job.status !== 'running' && job.status !== 'cancelling')) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {job.status === 'running' && <Loader2 className="size-4 animate-spin" />} Job Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-stone-100"
            style={{
              width: `${job.total ? (job.completed / job.total) * 100 : 0}%`,
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <ProgressBadge label="Stage" value={job.stage} />
          <ProgressBadge label="Assets" value={`${job.stats.assetsDeduped}/${job.stats.assetsFound}`} />
          <ProgressBadge label="OK" value={String(job.stats.candidatesAccepted)} />
          <ProgressBadge label="Rejected" value={String(job.stats.candidatesRejected)} />
          <ProgressBadge label="Elapsed" value={`${Math.round(job.stats.elapsedMs / 1000)}s`} />
        </div>
        {job.error && (
          <p className="flex gap-2 rounded-xl border border-red-700/50 bg-red-950/30 p-3 text-red-200">
            <AlertCircle className="size-4" />
            {job.error}
          </p>
        )}
        <pre className="max-h-36 overflow-auto rounded-2xl border border-white/10 bg-zinc-900 p-3 text-xs leading-relaxed text-slate-300">
          {job.logs.join('\n')}
        </pre>
        {job.status === 'running' || job.status === 'cancelling' ? (
          <Button className="w-full" variant="destructive" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ProgressBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-full border border-white/10 bg-zinc-900 px-3 py-1.5">
      <span className="text-zinc-500">{label}</span>
      <span className="ml-2 font-medium text-stone-100">{value}</span>
    </div>
  )
}

function Preview({ job }: { job: Job | null }) {
  const [open, setOpen] = React.useState(false)
  if (!job?.output) return null
  const version = encodeURIComponent(`${job.output.folder}-${job.stats.elapsedMs}`)
  const previewSrc = `${job.output.previewUrl}?v=${version}`
  const finalSrc = `${job.output.finalUrl}?v=${version}`
  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => setOpen(true)}>
            Open Viewer
          </Button>
          <a
            className="text-sm text-stone-200 underline decoration-white/30 underline-offset-4 hover:text-white"
            href={job.output.finalUrl}
          >
            Download final
          </a>
          <span className="text-xs text-slate-500">
            Use the viewer for wheel/pinch zoom, pan, fullscreen, and download.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="block overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 text-left transition hover:border-white/30"
        >
          <img src={previewSrc} className="max-h-[70vh] w-full object-contain" alt="Mosaic preview" />
        </button>
        <Lightbox
          open={open}
          close={() => setOpen(false)}
          slides={[
            {
              src: finalSrc,
              alt: 'Generated mosaic',
              download: {
                url: job.output.finalUrl,
                filename: job.output.finalName,
              },
            },
          ]}
          plugins={[Zoom, Fullscreen, Download]}
          zoom={{ maxZoomPixelRatio: 2, scrollToZoom: true }}
          carousel={{ finite: true }}
        />
      </CardContent>
    </Card>
  )
}

function OutputHistory({ outputs, onChanged }: { outputs: Array<Output>; onChanged: () => void }) {
  const completeOutputs = outputs.filter((out) => out.complete !== false && out.finalName && out.previewUrl)
  const [selected, setSelected] = React.useState<Array<string>>([])
  const [busy, setBusy] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(5)
  const selectedSet = new Set(selected)
  const totalPages = Math.max(1, Math.ceil(completeOutputs.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pageOutputs = completeOutputs.slice(pageStart, pageStart + pageSize)
  const pageEnd = Math.min(pageStart + pageOutputs.length, completeOutputs.length)
  const allPageSelected = pageOutputs.length > 0 && pageOutputs.every((out) => selectedSet.has(out.folder))

  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  function toggle(folder: string) {
    setSelected((current) =>
      current.includes(folder) ? current.filter((item) => item !== folder) : [...current, folder],
    )
  }

  function togglePageSelection() {
    const pageFolders = pageOutputs.map((out) => out.folder)
    setSelected((current) => {
      if (allPageSelected) return current.filter((folder) => !pageFolders.includes(folder))
      return [...new Set([...current, ...pageFolders])]
    })
  }

  async function downloadSelected() {
    if (!selected.length || busy) return
    setBusy(true)
    try {
      const response = await fetch('/api/outputs/archive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ folders: selected }),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? response.statusText)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = selected.length === 1 ? `${selected[0]}.tar` : 'immich-photo-mosaic-outputs.tar'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      window.alert(String((error as Error).message ?? error))
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelected() {
    if (!selected.length || busy) return
    const message =
      selected.length === 1
        ? `Delete output "${selected[0]}"? This cannot be undone.`
        : `Delete ${selected.length} selected outputs? This cannot be undone.`
    if (!window.confirm(message)) return
    setBusy(true)
    try {
      await api('/api/outputs', {
        method: 'DELETE',
        body: JSON.stringify({ folders: selected }),
      })
      setSelected([])
      onChanged()
    } catch (error) {
      window.alert(String((error as Error).message ?? error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Output History</CardTitle>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={togglePageSelection}
              disabled={!pageOutputs.length}
            />
            Select page
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void downloadSelected()}
            disabled={!selected.length || busy}
          >
            Download Selected
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void deleteSelected()}
            disabled={!selected.length || busy}
          >
            Delete Selected
          </Button>
          {selected.length > 0 && (
            <span className="self-center text-xs text-slate-400">{selected.length} selected</span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>
              Showing {completeOutputs.length ? pageStart + 1 : 0}-{pageEnd} of {completeOutputs.length}
            </span>
            <Select
              className="h-8 w-24 rounded-lg px-2 text-xs"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
            >
              <option value={5}>5 / page</option>
              <option value={10}>10 / page</option>
              <option value={20}>20 / page</option>
              <option value={50}>50 / page</option>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={currentPage <= 1}
            >
              Prev
            </Button>
            <span>
              {currentPage}/{totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              disabled={currentPage >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {pageOutputs.map((out) => (
          <div
            key={out.folder}
            className={`relative rounded-xl border bg-zinc-800 p-2 transition ${selectedSet.has(out.folder) ? 'border-stone-200 bg-zinc-700' : 'border-white/10 hover:border-white/30'}`}
          >
            <label className="mb-2 flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={selectedSet.has(out.folder)} onChange={() => toggle(out.folder)} />
              Select
            </label>
            <a className="group block" href={out.finalUrl ?? out.previewUrl ?? '#'}>
              <img
                src={out.previewUrl ?? ''}
                className="mb-2 aspect-video w-full rounded-lg object-cover"
                alt={`${out.folder} preview`}
              />
              <div className="truncate text-xs">{out.folder}</div>
              <div className="text-xs text-slate-500">{out.finalName}</div>
              <div className="pointer-events-none fixed left-1/2 top-1/2 z-50 hidden w-[90vw] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-zinc-900 p-3 opacity-0 shadow-xl shadow-black/40 transition-opacity delay-[600ms] duration-150 group-hover:block group-hover:opacity-100 group-focus-within:block group-focus-within:opacity-100">
                <img
                  src={out.previewUrl ?? ''}
                  className="max-h-[70vh] w-full rounded-lg object-contain"
                  alt={`${out.folder} larger preview`}
                />
              </div>
            </a>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-zinc-900 p-4">
      <div className="flex items-center gap-1.5">
        <Label>{label}</Label>
        <InfoTooltip label={label} />
      </div>
      {children}
    </div>
  )
}
function NumberField({
  label,
  value,
  set,
  disabled,
}: {
  label: string
  value: number
  set: (v: number) => void
  disabled?: boolean
}) {
  return (
    <Field label={label}>
      <Input type="number" value={value} onChange={(e) => set(Number(e.target.value))} disabled={disabled} />
    </Field>
  )
}
function RangeField({
  label,
  min,
  max,
  step,
  value,
  set,
  disabled,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  set: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-zinc-900 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <Label>{label}</Label>
          <InfoTooltip label={label} />
        </div>
        <span className="rounded-full border border-white/10 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-stone-100">
          {value}
        </span>
      </div>
      <input
        className="h-2 w-full accent-stone-200"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        disabled={disabled}
      />
      <div className="flex justify-between text-[11px] text-zinc-500">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
function ToggleField({
  label,
  checked,
  set,
  disabled,
}: {
  label: string
  checked: boolean
  set: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-white/10 bg-zinc-900 p-4 text-sm text-stone-200 transition hover:border-white/20">
      <span className="flex items-center gap-1.5">
        {label}
        <InfoTooltip label={label} />
      </span>
      <input
        className="size-4 accent-stone-200"
        type="checkbox"
        checked={checked}
        onChange={(e) => set(e.target.checked)}
        disabled={disabled}
      />
    </label>
  )
}
function InfoTooltip({ label }: { label: string }) {
  const text = settingTooltip(label)
  if (!text) return null
  return (
    <button type="button" className="group relative inline-flex">
      <Info className="size-3.5 cursor-help text-zinc-500 transition group-hover:text-stone-200 group-focus:text-stone-200" />
      <span className="pointer-events-none absolute left-1/2 top-5 z-20 hidden w-64 -translate-x-1/2 rounded-xl border border-white/10 bg-zinc-800 p-3 text-xs normal-case leading-relaxed text-stone-200 shadow-lg shadow-black/30 group-hover:block group-focus:block">
        {text}
      </span>
    </button>
  )
}

function settingTooltip(label: string) {
  const key = label.split(':')[0]
  const tooltips: Record<string, string> = {
    'Output width':
      'Final mosaic width in pixels. Height follows the main photo aspect ratio once a main photo is selected.',
    'Output height': 'Final mosaic height in pixels. This is locked when a main photo provides an aspect ratio.',
    'Megapixel target': 'Optional size target. Leave at 0 to use width and height directly.',
    Format: 'JPG is the default and keeps files smaller. PNG is lossless and larger. WebP is also compact.',
    'JPEG/WebP quality':
      'Compression quality for JPEG and WebP outputs. Higher means larger files and fewer artifacts.',
    'Tile size':
      'Pixel size of each mosaic tile. Smaller tiles show more detail but take longer and need more source photos.',
    'Fit mode':
      'Contain avoids cropping source photos. Cover fills each tile by cropping edges. Stretch may distort photos.',
    'Padding for contain': 'How empty space is filled when a photo is contained without cropping.',
    'Custom padding color': 'Used only when padding mode is set to custom color.',
    'Main photo influence':
      'Blends the target photo over the tile mosaic. Higher values make the target more recognizable but reduce tile visibility.',
    'Color matching strength':
      'Tints tiles toward their target cell color. Higher values improve resemblance but alter source photo colors.',
    'Repeat limit per photo': 'Maximum number of times the same source photo can be reused in one mosaic.',
    'Minimum repeat spacing': 'Minimum number of cells before the same source photo can appear again.',
    'Candidate pool limit':
      'Maximum number of source photos to download and analyze after filters. Increase for more variety.',
    'Include archived': 'Allow archived Immich assets as tile candidates.',
    'Include hidden': 'Allow hidden Immich assets as tile candidates if Immich reports that metadata.',
    'Favorites only': 'Use only favorite assets as tile candidates.',
    'Random seed': 'Controls deterministic random choices. Reuse the same seed for repeatable mosaics.',
    'Keep debug intermediates': 'Writes prepared tile images and extra files to the output folder for troubleshooting.',
    'Brightness filter': 'Rejects very dark or very bright tile candidates using the configured internal thresholds.',
    'Blur filter': 'Rejects tile candidates that look low-detail or blurry using the internal sharpness check.',
  }
  return tooltips[key]
}

async function api<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const headers =
    init.body instanceof FormData ? undefined : { 'content-type': 'application/json', ...(init.headers ?? {}) }
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? response.statusText)
  return response.json() as Promise<T>
}
async function fetchJobSnapshot(): Promise<Job> {
  return api<Job>('/api/jobs/current').catch(() => idleJob())
}
async function fetchOutputs() {
  return api<Array<Output>>('/api/outputs').catch(() => [])
}
function qs(params: Record<string, string>) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value)
  })
  return search.toString()
}
function dedupeAssets(assets: Array<Asset>) {
  return [...new Map(assets.map((asset) => [asset.id, asset])).values()]
}

function randomMosaicSeed() {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 2147483648
  return Math.floor(Math.random() * 2147483648)
}
function idleJob(): Job {
  return {
    status: 'idle',
    stage: 'idle',
    completed: 0,
    total: 0,
    message: '',
    stats: {
      assetsFound: 0,
      assetsDeduped: 0,
      candidatesAccepted: 0,
      candidatesRejected: 0,
      estimatedOutputPixels: 0,
      elapsedMs: 0,
    },
    logs: [],
  }
}
function loadImageDimensions(src: string) {
  return new Promise<ImageDimensions>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = src
  })
}
function fileDimensions(file: File) {
  const url = URL.createObjectURL(file)
  return loadImageDimensions(url).finally(() => URL.revokeObjectURL(url))
}

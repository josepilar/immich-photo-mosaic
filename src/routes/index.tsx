import { createFileRoute } from '@tanstack/react-router'
import { AlertCircle, CheckCircle2, Info, Loader2, Search, XCircle } from 'lucide-react'
import * as React from 'react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select } from '~/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import type { AppConfig } from '~/server/config'

export const Route = createFileRoute('/')({ component: App })

type Person = { id: string; name?: string | null }
type Album = { id: string; albumName: string; assetCount: number; albumThumbnailAssetId?: string | null }
type Asset = { id: string; originalFileName?: string | null; localDateTime?: string | null; width?: number | null; height?: number | null }
type AssetPage = { items: Array<Asset>; page: number; hasMore: boolean }
type Output = { folder: string; finalName: string | null; previewUrl: string; finalUrl: string | null }
type Status = { connected: boolean; version?: string; error?: string; env?: { hasApiKey: boolean; baseUrl: string | null }; writable?: { config: boolean; output: boolean } }
type ImageDimensions = { width: number; height: number }
type Job = {
  status: 'idle' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'error'
  stage: string
  completed: number
  total: number
  message: string
  logs: Array<string>
  stats: { assetsFound: number; assetsDeduped: number; candidatesAccepted: number; candidatesRejected: number; estimatedOutputPixels: number; elapsedMs: number }
  output?: { folder: string; finalName: string; previewUrl: string; finalUrl: string }
  error?: string
}

const defaultMosaic: AppConfig['mosaic'] = {
  outputWidth: 4800,
  outputHeight: 3200,
  targetMegapixels: 0,
  tileSize: 40,
  columns: 0,
  rows: 0,
  automaticGrid: true,
  tileAspectRatio: 1,
  fitMode: 'contain',
  paddingMode: 'blurred',
  paddingColor: '#111827',
  mainImageOpacity: 0.18,
  colorMatchingStrength: 0.6,
  repeatLimit: 3,
  minRepeatSpacing: 18,
  candidatePoolLimit: 500,
  usePreviews: true,
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
  outputFormat: 'png',
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
  const [mainAssetId, setMainAssetId] = React.useState('')
  const [uploadId, setUploadId] = React.useState('')
  const [targetDimensions, setTargetDimensions] = React.useState<ImageDimensions | null>(null)
  const [job, setJob] = React.useState<Job | null>(null)
  const [outputs, setOutputs] = React.useState<Array<Output>>([])
  const [message, setMessage] = React.useState('')
  const [previewZoom, setPreviewZoom] = React.useState(1)

  React.useEffect(() => { void boot() }, [])
  React.useEffect(() => {
    const timer = setInterval(() => {
      void fetchJobSnapshot().then(setJob)
      void fetchOutputs().then(setOutputs)
    }, job?.status === 'running' || job?.status === 'cancelling' ? 1000 : 4000)
    return () => clearInterval(timer)
  }, [job?.status])
  React.useEffect(() => { void refreshCount() }, [selectedPeople.join(','), selectedAlbums.join(','), dateFrom, dateTo])

  async function boot() {
    const [cfg, stat, ppl, alb, current, out] = await Promise.all([
      api<AppConfig>('/api/config').catch(() => defaultConfig),
      api<Status>('/api/status').catch((error) => ({ connected: false, error: String(error) })),
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
    setOutputs(out)
  }

  async function refreshCount() {
    const params = qs({ person_ids: selectedPeople.join(','), album_ids: selectedAlbums.join(','), date_from: dateFrom, date_to: dateTo })
    const data = await api<{ totalAssets: number }>(`/api/asset-count-preview?${params}`).catch(() => null)
    setAssetCount(data?.totalAssets ?? null)
  }

  async function loadImages(reset = false) {
    if (loadingImages) return
    setLoadingImages(true)
    try {
      const page = reset ? 1 : assetPage + 1
      const data = await api<AssetPage>(`/api/assets/search-page?${qs({ limit: '80', page: String(page) })}`)
      const nextAssets = reset ? data.items : dedupeAssets([...assets, ...data.items])
      setAssets(nextAssets)
      setAssetPage(data.page)
      setHasMoreImages(data.hasMore)
      setMessage(data.hasMore ? `Loaded ${nextAssets.length} Immich images. Scroll for more.` : 'Loaded all matching Immich images.')
    } finally {
      setLoadingImages(false)
    }
  }

  async function selectMainAsset(asset: Asset) {
    setMainAssetId(asset.id)
    const dimensions = asset.width && asset.height ? { width: asset.width, height: asset.height } : await loadImageDimensions(`/api/assets/${asset.id}/thumbnail`).catch(() => null)
    if (dimensions) applyTargetDimensions(dimensions)
  }

  async function uploadMain(file: File | null) {
    if (!file) return
    const dimensions = await fileDimensions(file).catch(() => null)
    const form = new FormData()
    form.set('file', file)
    const result = await api<{ uploadId: string; name: string }>('/api/uploads', { method: 'POST', body: form, headers: undefined })
    setUploadId(result.uploadId)
    if (dimensions) applyTargetDimensions(dimensions)
    setMessage(`Uploaded ${result.name}`)
  }

  function applyTargetDimensions(dimensions: ImageDimensions) {
    if (!dimensions.width || !dimensions.height) return
    const aspect = dimensions.width / dimensions.height
    setTargetDimensions(dimensions)
    setConfig((current) => ({ ...current, mosaic: { ...current.mosaic, outputHeight: Math.round(current.mosaic.outputWidth / aspect) } }))
  }

  function patchConfig(value: Partial<AppConfig['mosaic']>) {
    setConfig((current) => ({ ...current, mosaic: { ...current.mosaic, ...value } }))
  }

  function setLockedOutputWidth(width: number) {
    const aspect = targetDimensions ? targetDimensions.width / targetDimensions.height : null
    patchConfig({ outputWidth: width, outputHeight: aspect ? Math.round(width / aspect) : config.mosaic.outputHeight })
  }

  async function saveSettings() {
    const next = { ...config, filters: { albumIds: selectedAlbums, dateFrom, dateTo } }
    setConfig(await api<AppConfig>('/api/config', { method: 'PUT', body: JSON.stringify(next) }))
    setMessage('Settings saved to /app/config/config.toml')
  }

  async function start() {
    try {
      await saveSettings()
      const mainImage = mainMode === 'immich' ? { type: 'immich' as const, assetId: mainAssetId } : { type: 'upload' as const, uploadId }
      if (mainImage.type === 'immich' && !mainImage.assetId) throw new Error('Select a main Immich image')
      if (mainImage.type === 'upload' && !mainImage.uploadId) throw new Error('Upload a main image')
      await api('/api/jobs', { method: 'POST', body: JSON.stringify({ personIds: selectedPeople, albumIds: selectedAlbums, dateFrom, dateTo, mainImage, config }) })
      setJob(await fetchJobSnapshot())
    } catch (error) {
      setMessage(String((error as Error).message ?? error))
    }
  }

  const running = job?.status === 'running' || job?.status === 'cancelling'
  const connected = Boolean(status?.connected)
  const hasMainImage = mainMode === 'immich' ? Boolean(mainAssetId) : Boolean(uploadId)

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-8">
      <header className="mb-6 flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Immich Photo Mosaic</h1>
          <p className="mt-1 text-sm text-slate-400">Choose a target photo, choose optional source people, then tune the mosaic.</p>
        </div>
        <StatusPill connected={connected} />
      </header>

      <div className="space-y-4">
        <ConnectionPanel status={status} onRefresh={boot} />
        {connected ? (
          <>
            <MainImageSelector mode={mainMode} setMode={setMainMode} assets={assets} loadImages={() => void loadImages(true)} loadMoreImages={() => void loadImages(false)} hasMoreImages={hasMoreImages} loadingImages={loadingImages} selectedAsset={mainAssetId} selectAsset={(asset) => void selectMainAsset(asset)} uploadId={uploadId} uploadMain={uploadMain} disabled={running} targetDimensions={targetDimensions} />
            <SourcePanel people={people} selectedPeople={selectedPeople} setSelectedPeople={setSelectedPeople} albums={albums} selectedAlbums={selectedAlbums} setSelectedAlbums={setSelectedAlbums} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} assetCount={assetCount} disabled={running} />
            <SettingsTabs config={config} patch={patchConfig} setLockedOutputWidth={setLockedOutputWidth} targetDimensions={targetDimensions} restoreDefaults={() => setConfig((current) => ({ ...current, mosaic: targetDimensions ? { ...defaultMosaic, outputHeight: Math.round(defaultMosaic.outputWidth / (targetDimensions.width / targetDimensions.height)) } : defaultMosaic }))} disabled={running} />
            <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <Button onClick={() => void start()} disabled={running || !hasMainImage}>{running ? 'Running' : 'Generate Mosaic'}</Button>
              <Button variant="secondary" onClick={() => void saveSettings()} disabled={running}>Save Settings</Button>
              <Button variant="outline" onClick={() => void start()} disabled={running || !job?.output}>Re-run Same Setup</Button>
              {message && <span className="self-center text-sm text-slate-400">{message}</span>}
            </div>
            <ProgressView job={job} onCancel={() => api('/api/jobs/cancel', { method: 'POST' }).then(fetchJobSnapshot).then(setJob)} />
            <Preview job={job} zoom={previewZoom} setZoom={setPreviewZoom} />
            <OutputHistory outputs={outputs} />
          </>
        ) : (
          <Card><CardContent className="p-8 text-center text-slate-300">Connect to your Immich server to get started. Set `IMMICH_API_KEY` and `IMMICH_BASE_URL` in Docker.</CardContent></Card>
        )}
      </div>
    </main>
  )
}

function StatusPill({ connected }: { connected: boolean }) {
  return <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${connected ? 'bg-emerald-950 text-emerald-300' : 'bg-red-950 text-red-300'}`}>{connected ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}{connected ? 'Connected' : 'Not connected'}</span>
}

function ConnectionPanel({ status, onRefresh }: { status: Status | null; onRefresh: () => void }) {
  return <Card><CardHeader><CardTitle>Connection</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div>Immich: {status?.env?.baseUrl ?? 'not configured'}</div><div>API key: {status?.env?.hasApiKey ? 'provided by environment' : 'missing'}</div><div>Version: {status?.version || 'unknown'}</div><div>Volumes: config {status?.writable?.config ? 'writable' : 'not writable'}, output {status?.writable?.output ? 'writable' : 'not writable'}</div>{status?.error && <p className="text-red-300">{status.error}</p>}<Button size="sm" variant="secondary" onClick={onRefresh}>Refresh</Button></CardContent></Card>
}

function MainImageSelector(props: { mode: 'immich' | 'upload'; setMode: (v: 'immich' | 'upload') => void; assets: Array<Asset>; loadImages: () => void; loadMoreImages: () => void; hasMoreImages: boolean; loadingImages: boolean; selectedAsset: string; selectAsset: (asset: Asset) => void; uploadId: string; uploadMain: (file: File | null) => void; disabled: boolean; targetDimensions: ImageDimensions | null }) {
  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const el = event.currentTarget
    if (props.hasMoreImages && !props.loadingImages && el.scrollTop + el.clientHeight >= el.scrollHeight - 220) props.loadMoreImages()
  }
  return <Card><CardHeader><CardTitle>1. Main Photo</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-slate-400">This photo determines the final mosaic aspect ratio.</p><div className="flex gap-2"><Button size="sm" variant={props.mode === 'immich' ? 'default' : 'secondary'} onClick={() => props.setMode('immich')}>Immich</Button><Button size="sm" variant={props.mode === 'upload' ? 'default' : 'secondary'} onClick={() => props.setMode('upload')}>Upload</Button>{props.targetDimensions && <span className="self-center text-xs text-slate-400">Aspect locked to {props.targetDimensions.width}x{props.targetDimensions.height}</span>}</div>{props.mode === 'immich' ? <><Button size="sm" variant="outline" onClick={props.loadImages} disabled={props.disabled || props.loadingImages}>{props.loadingImages ? 'Loading...' : 'Load Images From Immich'}</Button><div onScroll={onScroll} className="grid max-h-96 grid-cols-4 gap-2 overflow-auto rounded-lg border border-slate-800 p-2 scrollbar-thin">{props.assets.map((asset) => <button key={asset.id} onClick={() => props.selectAsset(asset)} className={`rounded-md border p-1 ${props.selectedAsset === asset.id ? 'border-cyan-400' : 'border-slate-800'}`}><img src={`/api/assets/${asset.id}/thumbnail`} className="aspect-square w-full rounded object-cover" /><div className="truncate text-[10px] text-slate-400">{asset.originalFileName || asset.id}</div></button>)}{props.loadingImages && <div className="col-span-4 flex items-center justify-center gap-2 py-4 text-sm text-slate-400"><Loader2 className="size-4 animate-spin" />Loading more images</div>}{props.assets.length > 0 && !props.hasMoreImages && <div className="col-span-4 py-3 text-center text-xs text-slate-500">All matching images loaded</div>}</div></> : <><Input type="file" accept="image/*" onChange={(e) => void props.uploadMain(e.currentTarget.files?.[0] ?? null)} disabled={props.disabled} />{props.uploadId && <p className="text-sm text-emerald-300">Upload ready: {props.uploadId}</p>}</>}</CardContent></Card>
}

function SourcePanel(props: { people: Array<Person>; selectedPeople: Array<string>; setSelectedPeople: (v: Array<string>) => void; albums: Array<Album>; selectedAlbums: Array<string>; setSelectedAlbums: (v: Array<string>) => void; dateFrom: string; setDateFrom: (v: string) => void; dateTo: string; setDateTo: (v: string) => void; assetCount: number | null; disabled: boolean }) {
  const [query, setQuery] = React.useState('')
  const filtered = props.people.filter((person) => (person.name || 'Unnamed').toLowerCase().includes(query.toLowerCase()))
  return <Card><CardHeader><CardTitle>2. Mosaic Source Photos</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-slate-400">Select people to use their photos as tiles. Leave everyone unselected to use any eligible photo.</p><div className="relative"><Search className="absolute left-3 top-3 size-4 text-slate-500" /><Input className="pl-9" placeholder="Search people" value={query} onChange={(e) => setQuery(e.target.value)} /></div><div className="grid max-h-[300px] grid-cols-3 gap-2 overflow-auto scrollbar-thin">{filtered.map((person) => <button key={person.id} disabled={props.disabled} onClick={() => props.setSelectedPeople(props.selectedPeople.includes(person.id) ? props.selectedPeople.filter((id) => id !== person.id) : [...props.selectedPeople, person.id])} className={`rounded-lg border p-2 text-left transition ${props.selectedPeople.includes(person.id) ? 'border-cyan-400 bg-cyan-950/40' : 'border-slate-800 bg-slate-900/60 hover:bg-slate-800'}`}><img src={`/api/people/${person.id}/thumbnail`} className="mb-2 aspect-square w-full rounded-md object-cover" /><div className="truncate text-xs">{person.name || 'Unnamed'}</div></button>)}</div><div className="grid gap-3 md:grid-cols-2"><Field label="From"><Input type="date" value={props.dateFrom} onChange={(e) => props.setDateFrom(e.target.value)} disabled={props.disabled} /></Field><Field label="To"><Input type="date" value={props.dateTo} onChange={(e) => props.setDateTo(e.target.value)} disabled={props.disabled} /></Field></div><div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-slate-800 p-2 scrollbar-thin">{props.albums.map((album) => <label key={album.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-900"><input type="checkbox" disabled={props.disabled} checked={props.selectedAlbums.includes(album.id)} onChange={() => props.setSelectedAlbums(props.selectedAlbums.includes(album.id) ? props.selectedAlbums.filter((id) => id !== album.id) : [...props.selectedAlbums, album.id])} /><span className="truncate">{album.albumName}</span><span className="ml-auto text-xs text-slate-500">{album.assetCount}</span></label>)}</div><p className="text-sm text-slate-400">Candidate source assets found: {props.assetCount ?? 'loading...'}</p></CardContent></Card>
}

function SettingsTabs(props: { config: AppConfig; patch: (value: Partial<AppConfig['mosaic']>) => void; setLockedOutputWidth: (width: number) => void; targetDimensions: ImageDimensions | null; restoreDefaults: () => void; disabled: boolean }) {
  const [tab, setTab] = React.useState('output')
  const m = props.config.mosaic
  return <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>3. Mosaic Settings</CardTitle><Button size="sm" variant="outline" onClick={props.restoreDefaults} disabled={props.disabled}>Restore Defaults</Button></CardHeader><CardContent><Tabs><TabsList className="flex flex-wrap"><TabsTrigger active={tab === 'output'} onClick={() => setTab('output')}>Output</TabsTrigger><TabsTrigger active={tab === 'tiles'} onClick={() => setTab('tiles')}>Tiles</TabsTrigger><TabsTrigger active={tab === 'matching'} onClick={() => setTab('matching')}>Matching</TabsTrigger><TabsTrigger active={tab === 'sources'} onClick={() => setTab('sources')}>Sources</TabsTrigger><TabsTrigger active={tab === 'advanced'} onClick={() => setTab('advanced')}>Advanced</TabsTrigger></TabsList>{tab === 'output' && <TabsContent><p className="text-sm text-slate-400">Output height is locked to the selected main photo aspect ratio.</p><div className="grid gap-3 md:grid-cols-3"><NumberField label="Output width" value={m.outputWidth} set={props.setLockedOutputWidth} disabled={props.disabled} /><NumberField label="Output height" value={m.outputHeight} set={(v) => props.patch({ outputHeight: v })} disabled={Boolean(props.targetDimensions) || props.disabled} /><NumberField label="Megapixel target" value={m.targetMegapixels} set={(v) => props.patch({ targetMegapixels: v })} disabled={props.disabled} /></div><div className="grid gap-3 md:grid-cols-2"><Field label="Format"><Select value={m.outputFormat} onChange={(e) => props.patch({ outputFormat: e.target.value as AppConfig['mosaic']['outputFormat'] })}><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></Select></Field><RangeField label="JPEG/WebP quality" min={50} max={100} step={1} value={m.quality} set={(v) => props.patch({ quality: v })} disabled={props.disabled} /></div></TabsContent>}{tab === 'tiles' && <TabsContent><div className="grid gap-3 md:grid-cols-2"><RangeField label="Tile size" min={16} max={128} step={4} value={m.tileSize} set={(v) => props.patch({ tileSize: v })} disabled={props.disabled} /><Field label="Fit mode"><Select value={m.fitMode} onChange={(e) => props.patch({ fitMode: e.target.value as AppConfig['mosaic']['fitMode'] })}><option value="contain">Contain, no crop</option><option value="cover">Cover, crop edges</option><option value="stretch">Stretch</option></Select></Field><Field label="Padding for contain"><Select value={m.paddingMode} onChange={(e) => props.patch({ paddingMode: e.target.value as AppConfig['mosaic']['paddingMode'] })}><option value="blurred">Blurred image</option><option value="dominant">Dominant color</option><option value="black">Black</option><option value="white">White</option><option value="custom">Custom color</option></Select></Field><Field label="Custom padding color"><Input type="color" value={m.paddingColor} onChange={(e) => props.patch({ paddingColor: e.target.value })} disabled={props.disabled || m.paddingMode !== 'custom'} /></Field></div></TabsContent>}{tab === 'matching' && <TabsContent><div className="grid gap-3 md:grid-cols-2"><RangeField label="Main photo influence" min={0} max={0.5} step={0.01} value={m.mainImageOpacity} set={(v) => props.patch({ mainImageOpacity: v })} disabled={props.disabled} /><RangeField label="Color matching strength" min={0} max={1} step={0.05} value={m.colorMatchingStrength} set={(v) => props.patch({ colorMatchingStrength: v })} disabled={props.disabled} /><RangeField label="Repeat limit per photo" min={1} max={20} step={1} value={m.repeatLimit} set={(v) => props.patch({ repeatLimit: v })} disabled={props.disabled} /><RangeField label="Minimum repeat spacing" min={0} max={100} step={1} value={m.minRepeatSpacing} set={(v) => props.patch({ minRepeatSpacing: v })} disabled={props.disabled} /></div></TabsContent>}{tab === 'sources' && <TabsContent><div className="grid gap-3 md:grid-cols-2"><RangeField label="Candidate pool limit" min={50} max={5000} step={50} value={m.candidatePoolLimit} set={(v) => props.patch({ candidatePoolLimit: v })} disabled={props.disabled} /><ToggleField label="Use Immich previews" checked={m.usePreviews} set={(v) => props.patch({ usePreviews: v })} disabled={props.disabled} /><ToggleField label="Include archived" checked={m.includeArchived} set={(v) => props.patch({ includeArchived: v })} disabled={props.disabled} /><ToggleField label="Include hidden" checked={m.includeHidden} set={(v) => props.patch({ includeHidden: v })} disabled={props.disabled} /><ToggleField label="Favorites only" checked={m.includeFavoritesOnly} set={(v) => props.patch({ includeFavoritesOnly: v })} disabled={props.disabled} /></div></TabsContent>}{tab === 'advanced' && <TabsContent><div className="grid gap-3 md:grid-cols-2"><NumberField label="Random seed" value={m.randomSeed} set={(v) => props.patch({ randomSeed: v })} disabled={props.disabled} /><ToggleField label="Keep debug intermediates" checked={m.keepIntermediates} set={(v) => props.patch({ keepIntermediates: v })} disabled={props.disabled} /><ToggleField label="Brightness filter" checked={m.brightnessFilterEnabled} set={(v) => props.patch({ brightnessFilterEnabled: v })} disabled={props.disabled} /><ToggleField label="Blur filter" checked={m.blurFilterEnabled} set={(v) => props.patch({ blurFilterEnabled: v })} disabled={props.disabled} /></div></TabsContent>}</Tabs></CardContent></Card>
}

function ProgressView({ job, onCancel }: { job: Job | null; onCancel: () => void }) {
  if (!job || job.status === 'idle') return null
  return <Card><CardHeader><CardTitle className="flex items-center gap-2">{job.status === 'running' && <Loader2 className="size-4 animate-spin" />} Job Progress</CardTitle></CardHeader><CardContent className="space-y-3"><div className="h-2 overflow-hidden rounded bg-slate-800"><div className="h-full bg-cyan-400" style={{ width: `${job.total ? (job.completed / job.total) * 100 : 0}%` }} /></div><div className="grid gap-2 text-sm md:grid-cols-4"><Stat label="Stage" value={job.stage} /><Stat label="Assets" value={`${job.stats.assetsDeduped}/${job.stats.assetsFound}`} /><Stat label="Candidates" value={`${job.stats.candidatesAccepted} ok, ${job.stats.candidatesRejected} rejected`} /><Stat label="Elapsed" value={`${Math.round(job.stats.elapsedMs / 1000)}s`} /></div>{job.error && <p className="flex gap-2 text-red-300"><AlertCircle className="size-4" />{job.error}</p>}<pre className="max-h-40 overflow-auto rounded bg-black/40 p-3 text-xs text-slate-300">{job.logs.join('\n')}</pre>{job.status === 'running' || job.status === 'cancelling' ? <Button variant="destructive" onClick={onCancel}>Cancel</Button> : null}</CardContent></Card>
}

function Preview({ job, zoom, setZoom }: { job: Job | null; zoom: number; setZoom: (v: number) => void }) {
  if (!job?.output) return null
  return <Card><CardHeader><CardTitle>Preview</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex items-center gap-3"><Label>Zoom</Label><input type="range" min="0.25" max="3" step="0.25" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /><a className="text-sm text-cyan-300" href={job.output.finalUrl}>Download final</a></div><div className="overflow-auto rounded-lg border border-slate-800 bg-black"><img src={`${job.output.previewUrl}?t=${Date.now()}`} style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }} className="max-w-none" /></div></CardContent></Card>
}

function OutputHistory({ outputs }: { outputs: Array<Output> }) {
  return <Card><CardHeader><CardTitle>Output History</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-3">{outputs.map((out) => <a key={out.folder} href={out.finalUrl ?? out.previewUrl} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2 hover:border-cyan-500"><img src={out.previewUrl} className="mb-2 aspect-video w-full rounded object-cover" /><div className="truncate text-sm">{out.folder}</div><div className="text-xs text-slate-500">{out.finalName ?? 'no final image'}</div></a>)}</CardContent></Card>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1"><div className="flex items-center gap-1.5"><Label>{label}</Label><InfoTooltip label={label} /></div>{children}</div> }
function NumberField({ label, value, set, disabled }: { label: string; value: number; set: (v: number) => void; disabled?: boolean }) { return <Field label={label}><Input type="number" value={value} onChange={(e) => set(Number(e.target.value))} disabled={disabled} /></Field> }
function RangeField({ label, min, max, step, value, set, disabled }: { label: string; min: number; max: number; step: number; value: number; set: (v: number) => void; disabled?: boolean }) { return <Field label={`${label}: ${value}`}><input className="w-full accent-cyan-400" type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} disabled={disabled} /></Field> }
function ToggleField({ label, checked, set, disabled }: { label: string; checked: boolean; set: (v: boolean) => void; disabled?: boolean }) { return <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200"><span className="flex items-center gap-1.5">{label}<InfoTooltip label={label} /></span><input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} disabled={disabled} /></label> }
function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded bg-slate-900 p-2"><div className="text-xs text-slate-500">{label}</div><div>{value}</div></div> }

function InfoTooltip({ label }: { label: string }) {
  const text = settingTooltip(label)
  if (!text) return null
  return (
    <span className="group relative inline-flex" tabIndex={0}>
      <Info className="size-3.5 cursor-help text-slate-500 transition group-hover:text-cyan-300 group-focus:text-cyan-300" />
      <span className="pointer-events-none absolute left-1/2 top-5 z-20 hidden w-64 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-950 p-2 text-xs normal-case leading-relaxed text-slate-200 shadow-xl group-hover:block group-focus:block">
        {text}
      </span>
    </span>
  )
}

function settingTooltip(label: string) {
  const key = label.split(':')[0]
  const tooltips: Record<string, string> = {
    'Output width': 'Final mosaic width in pixels. Height follows the main photo aspect ratio once a main photo is selected.',
    'Output height': 'Final mosaic height in pixels. This is locked when a main photo provides an aspect ratio.',
    'Megapixel target': 'Optional size target. Leave at 0 to use width and height directly.',
    Format: 'PNG is lossless and larger. JPEG/WebP are smaller and use the quality setting.',
    'JPEG/WebP quality': 'Compression quality for JPEG and WebP outputs. Higher means larger files and fewer artifacts.',
    'Tile size': 'Pixel size of each mosaic tile. Smaller tiles show more detail but take longer and need more source photos.',
    'Fit mode': 'Contain avoids cropping source photos. Cover fills each tile by cropping edges. Stretch may distort photos.',
    'Padding for contain': 'How empty space is filled when a photo is contained without cropping.',
    'Custom padding color': 'Used only when padding mode is set to custom color.',
    'Main photo influence': 'Blends the target photo over the tile mosaic. Higher values make the target more recognizable but reduce tile visibility.',
    'Color matching strength': 'Tints tiles toward their target cell color. Higher values improve resemblance but alter source photo colors.',
    'Repeat limit per photo': 'Maximum number of times the same source photo can be reused in one mosaic.',
    'Minimum repeat spacing': 'Minimum number of cells before the same source photo can appear again.',
    'Candidate pool limit': 'Maximum number of source photos to download and analyze after filters. Increase for more variety.',
    'Use Immich previews': 'Uses Immich preview images instead of originals for faster processing and lower bandwidth.',
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
  const headers = init.body instanceof FormData ? undefined : { 'content-type': 'application/json', ...(init.headers ?? {}) }
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? response.statusText)
  return response.json() as Promise<T>
}
async function fetchJobSnapshot(): Promise<Job> { return api<Job>('/api/jobs/current').catch(() => idleJob()) }
async function fetchOutputs() { return api<Array<Output>>('/api/outputs').catch(() => []) }
function qs(params: Record<string, string>) { const search = new URLSearchParams(); Object.entries(params).forEach(([key, value]) => { if (value) search.set(key, value) }); return search.toString() }
function dedupeAssets(assets: Array<Asset>) { return [...new Map(assets.map((asset) => [asset.id, asset])).values()] }
function idleJob(): Job { return { status: 'idle', stage: 'idle', completed: 0, total: 0, message: '', stats: { assetsFound: 0, assetsDeduped: 0, candidatesAccepted: 0, candidatesRejected: 0, estimatedOutputPixels: 0, elapsedMs: 0 }, logs: [] } }
function loadImageDimensions(src: string) { return new Promise<ImageDimensions>((resolve, reject) => { const img = new Image(); img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight }); img.onerror = reject; img.src = src }) }
function fileDimensions(file: File) { const url = URL.createObjectURL(file); return loadImageDimensions(url).finally(() => URL.revokeObjectURL(url)) }

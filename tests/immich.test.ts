import { describe, expect, it } from 'vitest'
import { ImmichClient } from '../src/server/immich'

describe('ImmichClient', () => {
  it('sanitizes base URLs and builds preview URLs', () => {
    const client = new ImmichClient({ baseUrl: 'http://immich.local:2283/', apiKey: 'key' })
    expect(client.baseUrl).toBe('http://immich.local:2283/api')
    expect(client.buildUrl('/assets/a%2Fb/thumbnail', { size: 'preview' })).toBe('http://immich.local:2283/api/assets/a%2Fb/thumbnail?size=preview')
  })

  it('posts search metadata with people, album, date, and image type', async () => {
    const captured: Array<{ url: string; body: any }> = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      captured.push({ url, body: JSON.parse(String(init.body)) })
      return Response.json({ assets: { items: [], nextPage: null } })
    }) as any
    const client = new ImmichClient({ baseUrl: 'http://host', apiKey: 'key', fetchFn })
    await client.searchAssets({ personIds: ['p1'], albumIds: ['a1'], takenAfter: '2020-01-01', takenBefore: '2021-01-01' })
    expect(captured[0]?.url).toBe('http://host/api/search/metadata')
    expect(captured[0]?.body).toMatchObject({ personIds: ['p1'], albumIds: ['a1'], takenAfter: '2020-01-01', takenBefore: '2021-01-01', type: 'IMAGE', page: 1, withPeople: false })
  })

  it('fetches every available search page when no limit is provided', async () => {
    const requestedPages: Array<number> = []
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      requestedPages.push(body.page)
      return Response.json({
        assets: {
          items: [{ id: `asset-${body.page}` }],
          nextPage: body.page < 3 ? String(body.page + 1) : null,
        },
      })
    }) as any
    const client = new ImmichClient({ baseUrl: 'http://host', apiKey: 'key', fetchFn })
    const assets = await client.searchAssets({ personIds: ['p1'] })
    expect(requestedPages).toEqual([1, 2, 3])
    expect(assets.map((asset) => asset.id)).toEqual(['asset-1', 'asset-2', 'asset-3'])
  })

  it('supports paginated asset browsing for the UI', async () => {
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(body).toMatchObject({ page: 4, size: 80 })
      return Response.json({ assets: { items: [{ id: 'asset-4' }], nextPage: '5' } })
    }) as any
    const client = new ImmichClient({ baseUrl: 'http://host', apiKey: 'key', fetchFn })
    const page = await client.searchAssetsPage({ page: 4, size: 80 })
    expect(page).toEqual({ items: [{ id: 'asset-4', originalFileName: null, type: null, fileCreatedAt: null, localDateTime: null, width: null, height: null, isArchived: null, isFavorite: null, isHidden: null, visibility: null }], page: 4, hasMore: true })
  })
})

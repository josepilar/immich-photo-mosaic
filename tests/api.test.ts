import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { handleApi } from '../src/server/api'

describe('API validation', () => {
  it('rejects malformed job requests before starting a job', async () => {
    const response = await handleApi(new Request('http://localhost/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ personIds: [] }),
      headers: { 'content-type': 'application/json' },
    }), 'jobs')
    expect(response.status).toBe(400)
    expect(await response.json()).toHaveProperty('error')
  })

  it('rejects output path traversal', async () => {
    const response = await handleApi(new Request('http://localhost/api/outputs/../secret.txt'), 'outputs/../secret.txt')
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Invalid path')
  })

  it('rejects unsupported upload file types', async () => {
    const form = new FormData()
    form.set('file', new File(['not an image'], 'notes.txt', { type: 'text/plain' }))
    const response = await handleApi(new Request('http://localhost/api/uploads', {
      method: 'POST',
      body: form,
    }), 'uploads')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'file must be a JPEG, PNG, or WebP image' })
  })

  it('deletes selected output folders', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mosaic-api-output-'))
    process.env.OUTPUT_DIR = dir
    await fs.mkdir(path.join(dir, 'mosaic-a'))
    await fs.writeFile(path.join(dir, 'mosaic-a', 'metadata.json'), '{}')
    const response = await handleApi(new Request('http://localhost/api/outputs', {
      method: 'DELETE',
      body: JSON.stringify({ folders: ['mosaic-a'] }),
      headers: { 'content-type': 'application/json' },
    }), 'outputs')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: ['mosaic-a'] })
    await expect(fs.stat(path.join(dir, 'mosaic-a'))).rejects.toThrow()
  })

  it('archives selected output files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mosaic-api-archive-'))
    process.env.OUTPUT_DIR = dir
    await fs.mkdir(path.join(dir, 'mosaic-b'))
    await fs.writeFile(path.join(dir, 'mosaic-b', 'final.png'), 'png')
    await fs.writeFile(path.join(dir, 'mosaic-b', 'metadata.json'), '{}')
    const response = await handleApi(new Request('http://localhost/api/outputs/archive', {
      method: 'POST',
      body: JSON.stringify({ folders: ['mosaic-b'] }),
      headers: { 'content-type': 'application/json' },
    }), 'outputs/archive')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/x-tar')
    const archive = Buffer.from(await response.arrayBuffer())
    expect(archive.toString('utf8')).toContain('mosaic-b/final.png')
    expect(archive.toString('utf8')).toContain('mosaic-b/metadata.json')
  })
})

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultConfig, loadConfig, saveConfig } from '../src/server/config'

describe('config persistence', () => {
  it('creates defaults and never writes an API key', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mosaic-config-'))
    const file = path.join(dir, 'config.toml')
    await saveConfig({ ...defaultConfig, mosaic: { ...defaultConfig.mosaic, outputWidth: 1234 } } as any, file)
    const text = await fs.readFile(file, 'utf8')
    expect(text).not.toContain('IMMICH_API_KEY')
    expect(text).not.toMatch(/api[_-]?key/i)
    const loaded = await loadConfig(file)
    expect(loaded.mosaic.outputWidth).toBe(1234)
  })
})

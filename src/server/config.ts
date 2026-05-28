import fs from 'node:fs/promises'
import path from 'node:path'
import { parse, stringify } from 'smol-toml'
import { z } from 'zod'
import { configPath } from './paths'

export const mosaicConfigSchema = z.object({
  outputWidth: z.number().int().min(256).max(12000).default(3200),
  outputHeight: z.number().int().min(256).max(12000).default(2133),
  targetMegapixels: z.number().min(0).max(80).default(0),
  tileSize: z.number().int().min(8).max(512).default(64),
  columns: z.number().int().min(0).max(1000).default(0),
  rows: z.number().int().min(0).max(1000).default(0),
  automaticGrid: z.boolean().default(true),
  tileAspectRatio: z.number().min(0.2).max(5).default(1),
  fitMode: z.enum(['contain', 'cover', 'stretch']).default('cover'),
  paddingMode: z.enum(['dominant', 'blurred', 'black', 'white', 'custom']).default('blurred'),
  paddingColor: z.string().default('#111827'),
  mainImageOpacity: z.number().min(0).max(1).default(0.2),
  colorMatchingStrength: z.number().min(0).max(1).default(0.55),
  repeatLimit: z.number().int().min(1).max(9999).default(5),
  minRepeatSpacing: z.number().int().min(0).max(10000).default(20),
  candidatePoolLimit: z.number().int().min(10).max(20000).default(800),
  brightnessFilterEnabled: z.boolean().default(false),
  minBrightness: z.number().min(0).max(1).default(0.08),
  maxBrightness: z.number().min(0).max(1).default(0.94),
  blurFilterEnabled: z.boolean().default(false),
  minSharpness: z.number().min(0).max(10000).default(24),
  includeHidden: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
  includeFavoritesOnly: z.boolean().default(false),
  includeVideos: z.boolean().default(false),
  randomSeed: z.number().int().min(0).max(2147483647).default(1337),
  outputFormat: z.enum(['png', 'jpeg', 'webp']).default('jpeg'),
  quality: z.number().int().min(1).max(100).default(90),
  keepIntermediates: z.boolean().default(false),
})

export const filterConfigSchema = z.object({
  albumIds: z.array(z.string()).default([]),
  dateFrom: z.string().default(''),
  dateTo: z.string().default(''),
})

export const appConfigSchema = z.object({
  immich: z.object({ timeoutSeconds: z.number().int().min(5).max(300).default(45) }).default({ timeoutSeconds: 45 }),
  filters: filterConfigSchema.default({}),
  mosaic: mosaicConfigSchema.default({}),
})

export type MosaicConfig = z.infer<typeof mosaicConfigSchema>
export type AppConfig = z.infer<typeof appConfigSchema>

export const defaultConfig: AppConfig = appConfigSchema.parse({})

export async function loadConfig(filePath = configPath()): Promise<AppConfig> {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    return appConfigSchema.parse(parse(text))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await saveConfig(defaultConfig, filePath)
    return defaultConfig
  }
}

export async function saveConfig(config: AppConfig, filePath = configPath()) {
  const parsed = appConfigSchema.parse(config)
  const sanitized = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>
  delete (sanitized as { apiKey?: string }).apiKey
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, stringify(sanitized), 'utf8')
}

export function getImmichEnv() {
  return {
    apiKey: process.env.IMMICH_API_KEY ?? '',
    baseUrl: process.env.IMMICH_BASE_URL ?? '',
  }
}

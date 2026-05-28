import path from 'node:path'

const isProduction = process.env.NODE_ENV === 'production'

export function configDir() {
  return process.env.CONFIG_DIR ?? (isProduction ? '/app/config' : path.resolve('config'))
}

export function outputDir() {
  return process.env.OUTPUT_DIR ?? (isProduction ? '/app/output' : path.resolve('output'))
}

export function configPath() {
  return path.join(configDir(), 'config.toml')
}

export function uploadDir() {
  return path.join(configDir(), 'uploads')
}

import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const GAME_DIR = [
  resolve(__dirname, 'Ballance_bin/Ballance'),
  resolve(__dirname, 'Ballance_bin/source1/Ballance'),
].find(existsSync) ?? resolve(__dirname, 'Ballance_bin/Ballance')

const MIME: Record<string, string> = {
  bmp: 'image/bmp',
  tga: 'application/octet-stream',
  wav: 'audio/wav',
  nmo: 'application/octet-stream',
  cmo: 'application/octet-stream',
  txt: 'text/plain; charset=windows-1252',
  tdb: 'application/octet-stream',
  apng: 'image/apng',
}

const ATARI_APNG = join(tmpdir(), 'ballance-atari-lossless.apng')

/**
 * Microsoft Video 1 is not implemented by browsers.  Convert the original
 * 125-frame AVI to lossless APNG on demand: decoded RGB frame hashes are
 * byte-identical, unlike a normal H.264/WebM transcode.
 */
function ensureAtariApng(): string | null {
  const input = join(GAME_DIR, 'Textures/atari.avi')
  if (!existsSync(input)) return null
  if (existsSync(ATARI_APNG) && statSync(ATARI_APNG).mtimeMs >= statSync(input).mtimeMs) return ATARI_APNG
  const result = spawnSync('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    input,
    '-an',
    '-plays',
    '0',
    '-f',
    'apng',
    ATARI_APNG,
  ])
  return result.status === 0 && existsSync(ATARI_APNG) ? ATARI_APNG : null
}

/**
 * Serves the original (gitignored) game files under /bin/* with
 * case-insensitive path resolution, plus /bin-index.json file listing.
 */
function gameAssetsPlugin(): Plugin {
  let index: Map<string, string> | null = null
  const buildIndex = () => {
    const map = new Map<string, string>()
    const walk = (rel: string) => {
      for (const name of readdirSync(join(GAME_DIR, rel))) {
        if (name.startsWith('.')) continue
        const relPath = rel ? `${rel}/${name}` : name
        if (statSync(join(GAME_DIR, relPath)).isDirectory()) walk(relPath)
        else map.set(relPath.toLowerCase(), relPath)
      }
    }
    if (existsSync(GAME_DIR)) walk('')
    return map
  }
  const middleware = (req: { url?: string }, res: ServerResponse, next: () => void) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0])
    if (url === '/bin-derived/atari.apng') {
      const apng = ensureAtariApng()
      if (!apng) {
        res.statusCode = 404
        res.end('ffmpeg/APNG conversion unavailable')
        return
      }
      res.setHeader('Content-Type', MIME.apng)
      res.setHeader('Cache-Control', 'no-cache')
      createReadStream(apng).pipe(res)
      return
    }
    if (url === '/bin-index.json') {
      index ??= buildIndex()
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify([...index.values()]))
      return
    }
    if (!url.startsWith('/bin/')) return next()
    index ??= buildIndex()
    const rel = index.get(url.slice(5).toLowerCase())
    if (!rel) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    const ext = rel.split('.').pop()?.toLowerCase() ?? ''
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-cache')
    createReadStream(join(GAME_DIR, rel)).pipe(res)
  }
  return {
    name: 'ballance-game-assets',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), gameAssetsPlugin()],
})

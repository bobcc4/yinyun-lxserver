import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import path from 'node:path'
import { getUserSpace } from '@/user'
import { normalizeUsername } from '@/utils/username'
import * as fileCache from './fileCache'

export const PLAYLIST_EXCHANGE_FORMAT = 'yinyun-playlist'
export const PLAYLIST_EXCHANGE_SCHEMA_VERSION = 1
export const PLAYLIST_EXCHANGE_MAX_TRACKS = 10000
export const PLAYLIST_EXCHANGE_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000
const MAX_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000

export interface PlaylistExchangeTrack {
  id?: string
  source: string
  name: string
  singer: string
  interval?: string | number
  albumName?: string
  albumId?: string
  albumArtist?: string
  songmid?: string
  songId?: string
  hash?: string
  copyrightId?: string
  strMediaMid?: string
  albumMid?: string
  qualitys?: unknown[]
  _qualitys?: Record<string, unknown>
  meta?: Record<string, unknown>
  [key: string]: unknown
}

export interface PlaylistExchangePackage {
  format: typeof PLAYLIST_EXCHANGE_FORMAT
  schemaVersion: typeof PLAYLIST_EXCHANGE_SCHEMA_VERSION
  playlist: {
    name: string
    description: string
    tracks: PlaylistExchangeTrack[]
  }
  origin: {
    product: 'yinyun'
    serverVersion: string
    serverName: string
  }
  createdAt: number
}

interface StoredPlaylistExchange {
  token: string
  owner: string
  createdAt: number
  expiresAt: number
  package: PlaylistExchangePackage
}

export interface PlaylistExchangePreviewItem {
  index: number
  track: PlaylistExchangeTrack
  status: 'local' | 'online' | 'unmatched'
  localTrack?: { filename: string; quality?: string; size?: number; storageLocation?: string }
  reason: string
}

export class PlaylistExchangeError extends Error {
  statusCode: number
  code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

const getExchangeDir = () => path.join(global.lx.dataPath, 'playlist-shares')
const getExchangePath = (token: string) => path.join(getExchangeDir(), `${token}.json`)

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
)

const asText = (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max)

const containsDangerousKey = (key: string) => /(?:url|path|token|password|cookie|proxy|purl|ekey|api.?key|filename|storage|cache|lyric|lrc|cover|file)/i.test(key)

const sanitizeValue = (value: unknown, depth = 0): unknown => {
  if (depth > 4 || value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, 2000)
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeValue(item, depth + 1))
  if (!isPlainObject(value)) return undefined
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (containsDangerousKey(key)) continue
    const safeChild = sanitizeValue(child, depth + 1)
    if (safeChild !== undefined) result[key] = safeChild
  }
  return result
}

const sanitizeTrack = (song: any): PlaylistExchangeTrack => {
  const sanitized = sanitizeValue(song) as Record<string, unknown> || {}
  const meta = isPlainObject(sanitized.meta) ? sanitized.meta : undefined
  const source = asText(song?.source || meta?.source, 40).toLowerCase()
  const name = asText(song?.name || song?.title, 300)
  const singer = asText(song?.singer || song?.artist, 300)
  if (!source || !name) throw new PlaylistExchangeError(400, 'invalid_track', '歌单中存在缺少平台或歌名的歌曲')
  return {
    ...sanitized,
    source,
    name,
    singer,
    id: asText(song?.id, 300) || undefined,
    interval: typeof song?.interval === 'number' ? song.interval : asText(song?.interval, 40) || undefined,
    albumName: asText(song?.albumName || meta?.albumName, 300) || undefined,
    albumId: asText(song?.albumId || meta?.albumId, 300) || undefined,
    albumArtist: asText(song?.albumArtist || meta?.albumArtist, 300) || undefined,
    songmid: asText(song?.songmid || meta?.songmid, 300) || undefined,
    songId: asText(song?.songId || meta?.songId, 300) || undefined,
    hash: asText(song?.hash || meta?.hash, 300) || undefined,
    copyrightId: asText(song?.copyrightId || meta?.copyrightId, 300) || undefined,
    strMediaMid: asText(song?.strMediaMid || meta?.strMediaMid, 300) || undefined,
    albumMid: asText(song?.albumMid || meta?.albumMid, 300) || undefined,
    meta: meta ? sanitizeValue(meta) as Record<string, unknown> : undefined,
  }
}

const validatePackage = (value: unknown): PlaylistExchangePackage => {
  if (!isPlainObject(value) || value.format !== PLAYLIST_EXCHANGE_FORMAT || value.schemaVersion !== PLAYLIST_EXCHANGE_SCHEMA_VERSION) {
    throw new PlaylistExchangeError(400, 'invalid_playlist_package', '分享包格式或版本不受支持')
  }
  const playlist = value.playlist
  if (!isPlainObject(playlist)) throw new PlaylistExchangeError(400, 'invalid_playlist_package', '分享包缺少歌单信息')
  const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : []
  if (tracks.length > PLAYLIST_EXCHANGE_MAX_TRACKS) throw new PlaylistExchangeError(413, 'playlist_too_large', '歌单歌曲数量超过限制')
  const result: PlaylistExchangePackage = {
    format: PLAYLIST_EXCHANGE_FORMAT,
    schemaVersion: PLAYLIST_EXCHANGE_SCHEMA_VERSION,
    playlist: {
      name: asText(playlist.name, 100) || '未命名歌单',
      description: asText(playlist.description, 500),
      tracks: tracks.map(sanitizeTrack),
    },
    origin: {
      product: 'yinyun',
      serverVersion: asText(isPlainObject(value.origin) ? value.origin.serverVersion : '', 40),
      serverName: asText(isPlainObject(value.origin) ? value.origin.serverName : '', 100),
    },
    createdAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : Date.now(),
  }
  const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8')
  if (bytes > PLAYLIST_EXCHANGE_MAX_BYTES) throw new PlaylistExchangeError(413, 'playlist_package_too_large', '分享包大小超过限制')
  return result
}

const buildPackage = async (username: string, playlistId: string, serverVersion: string, serverName: string) => {
  const data = await getUserSpace(username).listManage.getListData()
  const playlist = playlistId === 'default'
    ? { name: '试听列表', list: data.defaultList }
    : playlistId === 'love'
      ? { name: '我的收藏', list: data.loveList }
      : data.userList.find(item => item.id === playlistId)
  if (!playlist) throw new PlaylistExchangeError(404, 'playlist_not_found', '未找到要分享的歌单')
  if (!Array.isArray(playlist.list) || playlist.list.length === 0) throw new PlaylistExchangeError(400, 'empty_playlist', '空歌单不能分享')
  return validatePackage({
    format: PLAYLIST_EXCHANGE_FORMAT,
    schemaVersion: PLAYLIST_EXCHANGE_SCHEMA_VERSION,
    playlist: { name: playlist.name || '未命名歌单', description: '', tracks: playlist.list },
    origin: { product: 'yinyun', serverVersion, serverName },
    createdAt: Date.now(),
  })
}

const writeStored = (stored: StoredPlaylistExchange) => {
  fs.mkdirSync(getExchangeDir(), { recursive: true })
  fs.writeFileSync(getExchangePath(stored.token), JSON.stringify(stored, null, 2), 'utf8')
}

const readStored = (token: string): StoredPlaylistExchange => {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new PlaylistExchangeError(404, 'share_not_found', '分享链接不存在或已失效')
  try {
    const stored = JSON.parse(fs.readFileSync(getExchangePath(token), 'utf8')) as StoredPlaylistExchange
    if (!stored || stored.expiresAt <= Date.now()) {
      fs.rmSync(getExchangePath(token), { force: true })
      throw new PlaylistExchangeError(410, 'share_expired', '分享链接已过期')
    }
    return { ...stored, package: validatePackage(stored.package) }
  } catch (error) {
    if (error instanceof PlaylistExchangeError) throw error
    throw new PlaylistExchangeError(404, 'share_not_found', '分享链接不存在或已失效')
  }
}

export const createPlaylistExchange = async (
  username: string,
  playlistId: unknown,
  serverVersion: string,
  serverName: string,
  baseUrl: string,
  expiryMs = DEFAULT_EXPIRY_MS,
) => {
  const normalizedUser = normalizeUsername(username)
  if (typeof playlistId !== 'string' || !playlistId) throw new PlaylistExchangeError(400, 'invalid_playlist', '请选择要分享的歌单')
  const packageData = await buildPackage(normalizedUser, playlistId, serverVersion, serverName)
  const token = crypto.randomBytes(32).toString('hex')
  const createdAt = Date.now()
  const expiresAt = createdAt + Math.min(Math.max(Number(expiryMs) || DEFAULT_EXPIRY_MS, 60 * 60 * 1000), MAX_EXPIRY_MS)
  writeStored({ token, owner: normalizedUser, createdAt, expiresAt, package: packageData })
  return {
    token,
    url: `${baseUrl.replace(/\/$/, '')}/share/playlist/${token}`,
    apiUrl: `${baseUrl.replace(/\/$/, '')}/api/v1/playlist-shares/${token}`,
    expiresAt,
    package: packageData,
  }
}

export const getPlaylistExchange = (token: string) => readStored(token).package

export const revokePlaylistExchange = (username: string, token: string) => {
  const stored = readStored(token)
  if (stored.owner !== normalizeUsername(username)) throw new PlaylistExchangeError(403, 'share_forbidden', '只有分享创建者可以撤销链接')
  fs.rmSync(getExchangePath(token), { force: true })
  return { revoked: true }
}

const collectTrackIds = (value: any) => {
  const source = asText(value?.source || value?.meta?.source, 40).toLowerCase()
  const ids = new Set<string>()
  for (const candidate of [value?.id, value?.songmid, value?.songId, value?.hash, value?.copyrightId, value?.strMediaMid, value?.meta?.songId, value?.meta?.songmid, value?.meta?.hash]) {
    if (candidate === undefined || candidate === null || !String(candidate).trim()) continue
    const id = String(candidate).trim()
    ids.add(id)
    if (source) {
      ids.add(`${source}_${id}`)
      if (id.startsWith(`${source}_`)) ids.add(id.slice(source.length + 1))
    }
  }
  return ids
}

const findLocalTrack = (song: PlaylistExchangeTrack, localItems: any[]) => {
  const ids = collectTrackIds(song)
  const candidates = localItems.filter(item => {
    const itemIds = collectTrackIds({ ...item.songInfo, ...item })
    return [...ids].some(id => itemIds.has(id))
  })
  if (!candidates.length) return null
  return candidates.sort((left, right) => Number(right.folder === 'music') - Number(left.folder === 'music') || Number(right.size || 0) - Number(left.size || 0))[0]
}

export const previewPlaylistExchange = async (
  username: string,
  packageData: PlaylistExchangePackage,
  isSourceSupported: (source: string, username: string) => boolean,
) => {
  const localItems = await fileCache.getCacheList(username)
  const items: PlaylistExchangePreviewItem[] = packageData.playlist.tracks.map((track, index) => {
    const local = findLocalTrack(track, localItems)
    if (local) return { index, track, status: 'local', localTrack: { filename: local.filename, quality: local.quality, size: local.size, storageLocation: local.storageLocation }, reason: '已匹配本地歌曲，导入后优先使用本地文件' }
    if (isSourceSupported(track.source, username)) return { index, track, status: 'online', reason: '未找到本地文件，将保留在线识别信息' }
    return { index, track, status: 'unmatched', reason: '当前账户没有可用的对应平台或稳定歌曲标识' }
  })
  return {
    playlist: { name: packageData.playlist.name, description: packageData.playlist.description },
    origin: packageData.origin,
    total: items.length,
    localMatches: items.filter(item => item.status === 'local').length,
    onlineMatches: items.filter(item => item.status === 'online').length,
    unmatched: items.filter(item => item.status === 'unmatched').length,
    items,
  }
}

export const importPlaylistExchange = async (
  username: string,
  packageData: PlaylistExchangePackage,
  normalizeSongInfo: (song: any) => any,
  nameOverride?: unknown,
) => {
  const userSpace = getUserSpace(username)
  const data = await userSpace.listManage.getListData()
  const requestedName = asText(nameOverride, 100) || packageData.playlist.name || '导入歌单'
  const usedNames = new Set(data.userList.map(item => item.name))
  let name = requestedName
  let suffix = 2
  while (usedNames.has(name)) name = `${requestedName}（${suffix++}）`
  const id = `exchange_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`
  const tracks = packageData.playlist.tracks.map(track => normalizeSongInfo(JSON.parse(JSON.stringify(track))))
  await userSpace.listManage.listDataManage.userListCreate({ id, name, position: -1, locationUpdateTime: Date.now() })
  await userSpace.listManage.listDataManage.listMusicOverwrite(id, tracks)
  await userSpace.listManage.createSnapshot()
  return { id, name, trackCount: tracks.length, localMatches: (await previewPlaylistExchange(username, packageData, () => true)).localMatches }
}

const isBlockedHost = async (hostname: string) => {
  const normalized = hostname.toLowerCase().replace(/[\[\]]/g, '')
  if (['localhost', 'localhost.localdomain', '0.0.0.0', '::1'].includes(normalized)) return true
  if (/^(127\.|169\.254\.|224\.|255\.)/.test(normalized)) return true
  try {
    const addresses = await dns.lookup(normalized, { all: true })
    return addresses.some(item => /^(127\.|169\.254\.|224\.|255\.)/.test(item.address) || item.address === '::1')
  } catch {
    return false
  }
}

const readRemoteJson = async (rawUrl: string): Promise<unknown> => {
  let current = rawUrl
  for (let attempt = 0; attempt < 4; attempt++) {
    let parsed: URL
    try { parsed = new URL(current) } catch { throw new PlaylistExchangeError(400, 'invalid_share_url', '分享链接不是有效的 URL') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new PlaylistExchangeError(400, 'invalid_share_url', '分享链接只支持 HTTP(S) URL')
    if (await isBlockedHost(parsed.hostname)) throw new PlaylistExchangeError(400, 'blocked_share_host', '分享链接目标地址不允许访问')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await fetch(parsed, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/json' } })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) throw new PlaylistExchangeError(502, 'invalid_redirect', '分享链接重定向地址无效')
        current = new URL(location, parsed).toString()
        continue
      }
      if (!response.ok) throw new PlaylistExchangeError(502, 'remote_share_failed', `远程服务返回 HTTP ${response.status}`)
      const reader = response.body?.getReader()
      if (!reader) return JSON.parse(await response.text())
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > PLAYLIST_EXCHANGE_MAX_BYTES) throw new PlaylistExchangeError(413, 'remote_share_too_large', '远程分享包超过大小限制')
        chunks.push(chunk.value)
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (error) {
      if (error instanceof PlaylistExchangeError) throw error
      if ((error as any)?.name === 'AbortError') throw new PlaylistExchangeError(504, 'remote_share_timeout', '读取远程分享链接超时')
      throw new PlaylistExchangeError(502, 'remote_share_failed', '读取远程分享链接失败')
    } finally {
      clearTimeout(timer)
    }
  }
  throw new PlaylistExchangeError(502, 'too_many_redirects', '远程分享链接重定向次数过多')
}

export const resolvePlaylistExchangeInput = async (input: any) => {
  if (isPlainObject(input?.package)) return validatePackage(input.package)
  if (isPlainObject(input) && input.format === PLAYLIST_EXCHANGE_FORMAT) return validatePackage(input)
  const url = asText(input?.url, 2048)
  if (!url) throw new PlaylistExchangeError(400, 'share_input_required', '请输入分享链接或上传分享 JSON')
  const remote = await readRemoteJson(url) as any
  return validatePackage(remote?.data?.package || remote?.data || remote)
}

const escapeHtml = (value: unknown) => asText(value, 10000).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))

export const renderPlaylistExchangePage = (token: string) => {
  const data = getPlaylistExchange(token)
  const rows = data.playlist.tracks.slice(0, 200).map((track, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(track.name)}</td><td>${escapeHtml(track.singer)}</td><td>${escapeHtml(track.source)}</td></tr>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>音云歌单分享</title><style>body{font-family:system-ui,sans-serif;background:#f3f8f5;color:#17352a;margin:0;padding:32px}main{max-width:900px;margin:auto;background:#fff;border:1px solid #d6e8de;border-radius:16px;padding:28px;box-shadow:0 10px 30px #174d2515}h1{margin:0 0 8px;color:#087f5b}p{color:#597267}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{text-align:left;padding:10px;border-bottom:1px solid #e5eee9}th{color:#087f5b}.hint{padding:12px;background:#edf8f2;border-radius:10px}</style></head><body><main><h1>${escapeHtml(data.playlist.name)}</h1><p>音云歌单分享 · ${data.playlist.tracks.length} 首歌曲 · 来源：${escapeHtml(data.origin.serverName || '音云')}</p><div class="hint">在另一台音云服务器的 Web 播放器中选择“导入分享链接”，确认预览后即可创建歌单。本页面不包含音频文件、密码或临时播放地址。</div><table><thead><tr><th>#</th><th>歌曲</th><th>歌手</th><th>平台</th></tr></thead><tbody>${rows}</tbody></table>${data.playlist.tracks.length > 200 ? '<p>仅展示前 200 首歌曲，完整内容请在音云中导入。</p>' : ''}</main></body></html>`
}

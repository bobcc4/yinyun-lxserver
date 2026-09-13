import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getUserSpace } from '@/user'
import { tryNormalizeUsername } from '@/utils/username'
import * as fileCache from './fileCache'
import * as serverDownloadQueue from './serverDownloadQueue'
import * as remasterQueue from './remasterQueue'
import {
  PlaylistSharingError,
  createPlaylistShare,
  getPendingPlaylistShares,
  isPlaylistSharingEnabled,
  respondToPlaylistShare,
  setPlaylistSharingEnabled,
} from './playlistSharing'
import { getEnabledSourcePlatforms, setEnabledSourcePlatforms } from './customSourcePlatformPreferences'
import { isSourceSharedWithUser } from './customSourceSharing'
import {
  ACCOUNT_SYNC_MAX_BYTES,
  ACCOUNT_SYNC_SCHEMA_VERSION,
  buildAccountSyncSnapshot,
  restoreAccountSyncSnapshot,
} from './accountSync'
import {
  decodeTrackId,
  encodeApiValue,
  signApiToken,
  verifySignedApiToken,
  type ApiTokenPayload,
} from './apiV1Contract'
import { normalizeLyricsResponse } from './utils/apiLyrics'
import type { NetworkPlaylistMonitor } from './networkPlaylistMonitor'
import {
  createPlaylistExchange,
  getPlaylistExchange,
  importPlaylistExchange,
  PlaylistExchangeError,
  previewPlaylistExchange,
  resolvePlaylistExchangeInput,
  revokePlaylistExchange,
} from './playlistExchange'

const API_PREFIX = '/api/v1'
const ACCESS_TOKEN_TTL = 60 * 60
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60
const MEDIA_TOKEN_TTL = 5 * 60
const MAX_BODY_SIZE = 2 * 1024 * 1024
const QUALITY_ORDER = ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master']

interface ApiV1Dependencies {
  serverVersion: string
  getAuthSecret: () => string
  getUsers: () => Array<{ name: string; password: string; isAdmin?: boolean }>
  isAdminUser: (username: string) => boolean
  musicSdk: any
  normalizeSongInfo: (songInfo: any) => any
  resolveSong: (
    songInfo: any,
    quality: string,
    username: string,
    allowQualityFallback: boolean,
    options?: { allowPlatformSwitch?: boolean; allowApiSwitch?: boolean },
  ) => Promise<any>
  isSourceSupported: (source: string, username: string) => boolean
  getLoadedSources: () => any[]
  getLibrary: (username: string, type: 'artists' | 'albums') => Promise<any[]>
  saveLibrary: (username: string, type: 'artists' | 'albums', items: any[]) => Promise<void>
  getLeaderboardBoards: (source: string, username: string) => Promise<any>
  getLeaderboardList: (source: string, bangid: string, page: number, username: string) => Promise<any>
  networkPlaylistMonitor: NetworkPlaylistMonitor
  getLegacyUsername?: (req: IncomingMessage) => string | null
}

interface ApiErrorShape {
  status: number
  code: string
  message: string
  details?: unknown
}

class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const revokedTokens = new Map<string, number>()

const json = (res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(data))
}

const success = (res: ServerResponse, data: unknown, status = 200) => json(res, status, { data })

const failure = (res: ServerResponse, error: ApiErrorShape) => json(res, error.status, {
  error: {
    code: error.code,
    message: error.message,
    ...(error.details === undefined ? {} : { details: error.details }),
  },
})

const readJson = async (req: IncomingMessage, maxBodySize = MAX_BODY_SIZE) => await new Promise<any>((resolve, reject) => {
  const chunks: Buffer[] = []
  let size = 0
  let oversized = false
  req.on('data', chunk => {
    if (oversized) return
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > maxBodySize) {
      oversized = true
      reject(new ApiError(413, 'payload_too_large', '请求内容过大'))
      return
    }
    chunks.push(value)
  })
  req.on('end', () => {
    if (oversized) return
    try {
      const text = Buffer.concat(chunks).toString('utf8')
      resolve(text ? JSON.parse(text) : {})
    } catch {
      reject(new ApiError(400, 'invalid_json', '请求内容不是有效的 JSON'))
    }
  })
  req.on('error', reject)
})

const verifyApiToken = (token: string, secret: string, expectedType?: ApiTokenPayload['type']) => {
  const now = Date.now()
  for (const [revokedToken, expiresAt] of revokedTokens) {
    if (expiresAt <= now) revokedTokens.delete(revokedToken)
  }
  const payload = verifySignedApiToken(token, secret, expectedType)
  return payload && (revokedTokens.get(token) || 0) <= now ? payload : null
}

const issueToken = (
  username: string,
  type: ApiTokenPayload['type'],
  ttl: number,
  secret: string,
  extra: Partial<ApiTokenPayload> = {},
) => {
  const now = Math.floor(Date.now() / 1000)
  return signApiToken({ sub: username, type, iat: now, exp: now + ttl, ...extra }, secret)
}

const issueSession = (username: string, secret: string) => ({
  tokenType: 'Bearer',
  accessToken: issueToken(username, 'access', ACCESS_TOKEN_TTL, secret),
  accessTokenExpiresIn: ACCESS_TOKEN_TTL,
  refreshToken: issueToken(username, 'refresh', REFRESH_TOKEN_TTL, secret),
  refreshTokenExpiresIn: REFRESH_TOKEN_TTL,
  user: { username },
})

const getBearerToken = (req: IncomingMessage) => {
  const header = req.headers.authorization
  const match = typeof header === 'string' ? header.match(/^Bearer\s+(.+)$/i) : null
  return match?.[1] || null
}

const requireUser = (req: IncomingMessage, deps: ApiV1Dependencies, url?: URL) => {
  const token = getBearerToken(req)
  let payload = token ? verifyApiToken(token, deps.getAuthSecret(), 'access') : null
  if (!payload && url?.searchParams.get('token')) {
    const mediaToken = url.searchParams.get('token')!
    const mediaPayload = verifyApiToken(mediaToken, deps.getAuthSecret(), 'media')
    const trackId = url.pathname.match(/^\/api\/v1\/library\/tracks\/([^/]+)\/(?:stream|cover)$/)?.[1]
    if (mediaPayload && trackId && mediaPayload.trackId === decodeURIComponent(trackId)) payload = mediaPayload
  }
  const username = payload
    ? tryNormalizeUsername(payload.sub)
    : (deps.getLegacyUsername ? tryNormalizeUsername(deps.getLegacyUsername(req) || '') : null)
  if (!username || !deps.getUsers().some(user => user.name === username)) {
    throw new ApiError(401, 'unauthorized', '登录状态无效或已过期')
  }
  return username
}

const getRequestBaseUrl = (req: IncomingMessage) => {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim()
  const host = (forwardedHost || String(req.headers.host || 'localhost:9527')).replace(/[\r\n]/g, '')
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const protocol = forwardedProto === 'https' || (req.socket as any).encrypted ? 'https' : 'http'
  return `${protocol}://${host}`
}

const parsePositiveInt = (value: string | null, fallback: number, max: number) => {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}

const encodeTrackId = (item: any) => encodeApiValue(JSON.stringify({
  f: item.filename,
  d: item.folder,
  l: item.storageLocation,
}))

const parseDurationSeconds = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value || '').trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text)
  const parts = text.split(':').map(Number)
  if (parts.some(part => !Number.isFinite(part))) return 0
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

const toTrack = (item: any) => ({
  id: encodeTrackId(item),
  catalogId: item.id,
  songmid: item.songmid || item.id,
  title: item.name || '',
  artist: item.singer || '',
  albumArtist: item.albumArtist || item.singer || null,
  album: item.album || '',
  albumId: item.albumId || null,
  addedAt: Number(item.mtime || 0),
  publishTime: item.releaseDate || item.songInfo?.publishTime || item.songInfo?.releaseDate || item.songInfo?.year || null,
  source: item.source || 'unknown',
  requestedSource: item.requestedSource || null,
  downloadSource: item.downloadSource || item.source || 'unknown',
  quality: item.quality || 'unknown',
  bitrate: Number(item.bitrate || 0) || (
    Number(item.size) > 0 && parseDurationSeconds(item.interval) > 0
      ? Math.round(Number(item.size) * 8 / parseDurationSeconds(item.interval) / 1000)
      : 0
  ),
  duration: item.interval || null,
  size: Number(item.size || 0),
  folder: item.folder,
  storageLocation: item.storageLocation || null,
  extension: item.ext || '',
  hasCover: item.hasCover === true,
  hasLyrics: item.hasLyric === true || !!item.lyricFilename || item.hasEmbedLyric === true,
  streamPath: `${API_PREFIX}/library/tracks/${encodeURIComponent(encodeTrackId(item))}/stream`,
  coverPath: `${API_PREFIX}/library/tracks/${encodeURIComponent(encodeTrackId(item))}/cover`,
  raw: item.songInfo || {
    id: item.id,
    songmid: item.songmid || item.id,
    name: item.name,
    singer: item.singer,
    albumArtist: item.albumArtist || item.singer,
    albumName: item.album,
    albumId: item.albumId,
    publishTime: item.releaseDate || null,
    source: item.source,
    interval: item.interval,
    img: item.img,
  },
})

const getTrackItem = async (username: string, rawId: string) => {
  const decoded = decodeTrackId(rawId)
  if (!decoded) throw new ApiError(404, 'track_not_found', '歌曲不存在')
  const items = await fileCache.getCacheList(username)
  const item = items.find((candidate: any) => (
    candidate.filename === decoded.filename &&
    candidate.folder === decoded.folder &&
    (!decoded.location || candidate.storageLocation === decoded.location)
  ))
  if (!item) throw new ApiError(404, 'track_not_found', '歌曲不存在或曲库索引已更新')
  return { item, decoded }
}

const normalizeOnlineTrack = (song: any, source: string) => ({
  id: song.id || `${song.source || source}_${song.songmid || song.hash || ''}`,
  title: song.name || song.title || '',
  artist: song.singer || song.artist || '',
  albumArtist: song.albumArtist || song.albumArtistName || song.meta?.albumArtist || song.meta?.albumArtistName || song.singer || song.artist || '',
  album: song.albumName || song.album || song.meta?.albumName || '',
  source: song.source || source,
  duration: song.interval || song.duration || null,
  artworkUrl: song.img || song.picUrl || song.meta?.picUrl || null,
  raw: song,
})

const collectTrackIds = (value: any) => {
  const source = String(value?.source || value?.meta?.source || '').toLowerCase()
  const ids = new Set<string>()
  for (const candidate of [value?.id, value?.songmid, value?.songId, value?.hash, value?.meta?.songId, value?.meta?.songmid, value?.meta?.hash]) {
    if (candidate === undefined || candidate === null || String(candidate).trim() === '') continue
    const id = String(candidate).trim()
    ids.add(id)
    if (!source) continue
    const prefix = `${source}_`
    ids.add(id.startsWith(prefix) ? id.slice(prefix.length) : `${prefix}${id}`)
  }
  return ids
}

const createLocalTrackIndex = (localItems: any[]) => {
  const index = new Map<string, any[]>()
  for (const item of localItems) {
    const ids = collectTrackIds({ ...item.songInfo, id: item.id, songmid: item.songmid, source: item.source })
    for (const id of ids) index.set(id, [...(index.get(id) || []), item])
  }
  return index
}

const findLocalPlaylistTrack = (song: any, localIndex: Map<string, any[]>) => {
  const songIds = collectTrackIds(song)
  const candidates = [...new Set([...songIds].flatMap(id => localIndex.get(id) || []))]
  if (!candidates.length) return null
  return candidates.sort((left, right) => {
    const folderScore = Number(right.folder === 'music') - Number(left.folder === 'music')
    if (folderScore) return folderScore
    const qualityScore = QUALITY_ORDER.indexOf(right.quality) - QUALITY_ORDER.indexOf(left.quality)
    return qualityScore || Number(right.size || 0) - Number(left.size || 0)
  })[0]
}

const mergeLocalTrackMetadata = (onlineTrack: any, localItem: any) => {
  if (!localItem) return onlineTrack
  const localTrack = toTrack(localItem)
  return {
    ...onlineTrack,
    quality: localTrack.quality,
    bitrate: localTrack.bitrate,
    size: localTrack.size,
    extension: localTrack.extension,
    albumArtist: localTrack.albumArtist,
    hasCover: localTrack.hasCover,
    hasLyrics: localTrack.hasLyrics,
    localTrackId: localTrack.id,
    streamPath: localTrack.streamPath,
    coverPath: localTrack.coverPath,
  }
}

const withSignedArtwork = (track: any, username: string, secret: string) => {
  const localTrackId = track.localTrackId || (track.streamPath ? track.id : '')
  if (!track.hasCover || !track.coverPath || !localTrackId) return track
  const token = issueToken(username, 'media', MEDIA_TOKEN_TTL, secret, { trackId: localTrackId })
  return { ...track, artworkUrl: `${track.coverPath}?token=${encodeURIComponent(token)}` }
}

const normalizeSearchResult = (value: any, source: string) => {
  const list = Array.isArray(value) ? value : Array.isArray(value?.list) ? value.list : []
  return {
    items: list.map((song: any) => normalizeOnlineTrack(song, source)),
    total: Number(value?.total || list.length),
    page: Number(value?.page || 1),
    limit: Number(value?.limit || list.length),
  }
}

const normalizeAlbum = (item: any, source: string) => ({
  id: String(item.id || item.mid || item.albumMid || ''),
  name: item.name || item.albumName || item.info?.name || '',
  artist: item.artistName || item.artist || item.singer || item.info?.author || '',
  albumArtist: item.albumArtist || item.albumArtistName || item.artistName || item.artist || item.singer || item.info?.author || '',
  artworkUrl: item.picUrl || item.img || item.info?.img || null,
  source: item.source || source,
  publishTime: item.publishTime || item.info?.publishTime || null,
  trackCount: Number(item.size || item.total || item.count || 0),
  kind: 'album',
  raw: item,
})

const fetchAllPages = async (
  fetchPage: (page: number, limit: number) => Promise<any>,
  pageSize = 100,
  maxPages = 20,
) => {
  const items: any[] = []
  let total = 0
  let complete = false
  for (let page = 1; page <= maxPages; page++) {
    const result = await fetchPage(page, pageSize)
    const pageItems = Array.isArray(result) ? result : Array.isArray(result?.list) ? result.list : []
    items.push(...pageItems)
    total = Math.max(total, Number(result?.total) || 0)
    if (pageItems.length < pageSize || (total > 0 && items.length >= total)) {
      complete = true
      break
    }
  }
  return { items, total: total || items.length, complete }
}

const normalizeEntityResult = (value: any, source: string, type: 'singer' | 'album') => {
  const list = Array.isArray(value) ? value : Array.isArray(value?.list) ? value.list : []
  return {
    items: list.map((item: any) => type === 'singer' ? ({
      id: String(item.id || item.mid || ''),
      name: item.name || '',
      title: item.name || '',
      artist: item.name || '',
      artworkUrl: item.picUrl || item.img || null,
      source: item.source || source,
      kind: 'singer',
      raw: item,
    }) : ({
      id: String(item.id || item.mid || ''),
      name: item.name || '',
      title: item.name || '',
      artist: item.artistName || item.artist || '',
      artworkUrl: item.picUrl || item.img || null,
      source: item.source || source,
      kind: 'album',
      raw: item,
    })),
    total: Number(value?.total || list.length),
    page: Number(value?.page || 1),
    limit: Number(value?.limit || list.length),
  }
}

const getPlaylist = async (username: string, playlistId: string) => {
  const data = await getUserSpace(username).listManage.getListData()
  if (playlistId === 'default') return { id: 'default', name: '试听列表', list: data.defaultList }
  if (playlistId === 'love') return { id: 'love', name: '我的收藏', list: data.loveList }
  const playlist = data.userList.find(item => item.id === playlistId)
  if (!playlist) throw new ApiError(404, 'playlist_not_found', '歌单不存在')
  return playlist
}

const sourceView = (source: any, username: string) => {
  const supportedSources = Object.keys(source.sources || {})
  return {
    id: source.id,
    name: source.name,
    version: source.version,
    author: source.author,
    owner: source.owner,
    enabled: source.enabled !== false,
    shared: source.owner !== username,
    readOnly: source.owner !== username,
    supportedPlatforms: supportedSources,
    enabledPlatforms: getEnabledSourcePlatforms(username, source.owner, source.id, supportedSources),
  }
}

export const apiV1OpenApi = {
  openapi: '3.1.0',
  info: {
    title: '音云 API',
    version: '1.4.0',
    description: '音云原生客户端使用的稳定接口。旧网页接口与 Subsonic 接口不属于本契约。',
  },
  servers: [{ url: '/' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'Yinyun token' },
    },
  },
  paths: {
    '/api/v1/capabilities': { get: { security: [], summary: '查询服务器能力' } },
    '/api/v1/auth/login': { post: { security: [], summary: '用户登录' } },
    '/api/v1/auth/refresh': { post: { security: [], summary: '刷新访问令牌' } },
    '/api/v1/auth/logout': { post: { summary: '注销当前令牌' } },
    '/api/v1/auth/me': { get: { summary: '查询当前用户' } },
    '/api/v1/sync/snapshot': {
      get: { summary: '导出当前账户同步快照' },
      put: { summary: '将客户端同步快照恢复到当前账户' },
    },
    '/api/v1/library/tracks': { get: { summary: '查询本地曲库' } },
    '/api/v1/library/tracks/{id}/stream': { get: { summary: 'Range 流式播放本地歌曲' } },
    '/api/v1/library/tracks/{id}/cover': { get: { summary: '读取本地歌曲封面' } },
    '/api/v1/search': { get: { summary: '搜索在线曲库' } },
    '/api/v1/leaderboards': { get: { summary: '查询排行榜列表' } },
    '/api/v1/leaderboards/{id}/tracks': { get: { summary: '查询排行榜歌曲' } },
    '/api/v1/library/artists': { get: { summary: '查询收藏歌手' }, put: { summary: '覆盖收藏歌手' } },
    '/api/v1/library/albums': { get: { summary: '查询收藏专辑' }, put: { summary: '覆盖收藏专辑' } },
    '/api/v1/artists/{id}': { get: { summary: '查询歌手、全部歌曲及专辑' } },
    '/api/v1/albums/{id}': { get: { summary: '查询专辑及全部歌曲' } },
    '/api/v1/tracks/resolve': { post: { summary: '解析在线歌曲播放地址' } },
    '/api/v1/tracks/qualities': { get: { summary: '查询支持的音质标识' } },
    '/api/v1/lyrics': { post: { summary: '读取歌词' } },
    '/api/v1/playlists': { get: { summary: '查询歌单' }, post: { summary: '创建歌单' } },
    '/api/v1/playlists/{id}/export': { get: { summary: '导出歌单 JSON' } },
    '/api/v1/playlist-shares': { post: { summary: '创建跨音云服务端分享链接' } },
    '/api/v1/playlist-shares/{token}': { get: { security: [], summary: '读取公开歌单分享包' }, delete: { summary: '撤销歌单分享链接' } },
    '/api/v1/playlist-import/preview': { post: { summary: '预览跨服务端歌单导入' } },
    '/api/v1/playlist-import': { post: { summary: '导入跨服务端歌单' } },
    '/api/v1/downloads': { get: { summary: '查询服务端下载队列' }, post: { summary: '加入服务端下载队列' } },
    '/api/v1/replacement': { get: { summary: '查询洗版任务' }, post: { summary: '启动洗版任务' } },
    '/api/v1/sources': { get: { summary: '查询可用音源及平台开关' } },
    '/api/v1/shares/inbox': { get: { summary: '查询待处理歌单分享' } },
    '/api/v1/events': { get: { summary: '订阅下载、洗版和分享状态事件' } },
  },
}

export const createApiV1Handler = (deps: ApiV1Dependencies) => async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> => {
  const pathname = url.pathname
  if (pathname !== API_PREFIX && !pathname.startsWith(`${API_PREFIX}/`)) return false

  try {
    if ((pathname === API_PREFIX || pathname === `${API_PREFIX}/capabilities`) && req.method === 'GET') {
      success(res, {
        product: 'yinyun',
        serverVersion: deps.serverVersion,
        apiVersion: '1.4.0',
        playerPath: '/',
        features: {
          localLibrary: true,
          onlineSearch: true,
          rangeStreaming: true,
          lyrics: true,
          playlists: true,
          favoriteArtists: true,
          favoriteAlbums: true,
          artistAlbumDetails: true,
          leaderboards: true,
          serverDownloads: true,
          replacement: true,
          customSources: true,
          playlistSharing: true,
          playlistExchange: {
            create: true,
            preview: true,
            import: true,
            jsonExport: true,
          },
          accountSync: {
            schemaVersion: ACCOUNT_SYNC_SCHEMA_VERSION,
            maxSnapshotBytes: ACCOUNT_SYNC_MAX_BYTES,
            restore: true,
          },
          events: 'sse',
          networkPlaylistMonitor: true,
          subsonic: global.lx.config['subsonic.enable'] === true,
        },
        supportedQualities: QUALITY_ORDER,
      })
      return true
    }

    if (pathname === `${API_PREFIX}/openapi.json` && req.method === 'GET') {
      json(res, 200, apiV1OpenApi, { 'Cache-Control': 'public, max-age=300' })
      return true
    }

    const exchangePublicMatch = pathname.match(/^\/api\/v1\/playlist-shares\/([a-f0-9]{64})$/)
    if (exchangePublicMatch && req.method === 'GET') {
      success(res, { package: getPlaylistExchange(exchangePublicMatch[1]) })
      return true
    }

    if (pathname === `${API_PREFIX}/auth/login` && req.method === 'POST') {
      const body = await readJson(req)
      const username = tryNormalizeUsername(body.username)
      const user = username && deps.getUsers().find(item => item.name === username && item.password === body.password)
      if (!user) throw new ApiError(401, 'invalid_credentials', '用户名或密码错误')
      success(res, issueSession(user.name, deps.getAuthSecret()))
      return true
    }

    if (pathname === `${API_PREFIX}/auth/refresh` && req.method === 'POST') {
      const body = await readJson(req)
      const payload = verifyApiToken(body.refreshToken, deps.getAuthSecret(), 'refresh')
      const username = payload ? tryNormalizeUsername(payload.sub) : null
      if (!username || !deps.getUsers().some(item => item.name === username)) {
        throw new ApiError(401, 'invalid_refresh_token', '刷新令牌无效或已过期')
      }
      revokedTokens.set(body.refreshToken, payload!.exp * 1000)
      success(res, issueSession(username, deps.getAuthSecret()))
      return true
    }

    if (pathname === `${API_PREFIX}/auth/logout` && req.method === 'POST') {
      const token = getBearerToken(req)
      const payload = token ? verifyApiToken(token, deps.getAuthSecret(), 'access') : null
      if (token && payload) revokedTokens.set(token, payload.exp * 1000)
      success(res, { loggedOut: true })
      return true
    }

    const username = requireUser(req, deps, url)

    if (pathname === `${API_PREFIX}/playlist-shares` && req.method === 'POST') {
      const body = await readJson(req)
      success(res, await createPlaylistExchange(
        username,
        body.playlistId,
        deps.serverVersion,
        String(global.lx.config.serverName || ''),
        getRequestBaseUrl(req),
        Number(body.expiresInMs),
      ), 201)
      return true
    }

    const exchangeManageMatch = pathname.match(/^\/api\/v1\/playlist-shares\/([a-f0-9]{64})$/)
    if (exchangeManageMatch && req.method === 'DELETE') {
      success(res, revokePlaylistExchange(username, exchangeManageMatch[1]))
      return true
    }

    if (pathname === `${API_PREFIX}/playlist-import/preview` && req.method === 'POST') {
      const body = await readJson(req, 2 * 1024 * 1024 + 64 * 1024)
      const packageData = await resolvePlaylistExchangeInput(body)
      success(res, await previewPlaylistExchange(username, packageData, (source, currentUser) => deps.isSourceSupported(source, currentUser)))
      return true
    }

    if (pathname === `${API_PREFIX}/playlist-import` && req.method === 'POST') {
      const body = await readJson(req, 2 * 1024 * 1024 + 64 * 1024)
      const packageData = await resolvePlaylistExchangeInput(body)
      const preview = await previewPlaylistExchange(username, packageData, (source, currentUser) => deps.isSourceSupported(source, currentUser))
      const imported = await importPlaylistExchange(username, packageData, deps.normalizeSongInfo, body.name)
      success(res, { ...imported, preview }, 201)
      return true
    }

    if (pathname === `${API_PREFIX}/player/network-playlists/status` && req.method === 'GET') {
      success(res, deps.networkPlaylistMonitor.getStatus(username))
      return true
    }
    if (pathname === `${API_PREFIX}/player/network-playlists/check` && req.method === 'POST') {
      success(res, await deps.networkPlaylistMonitor.checkAndGetStatus(username))
      return true
    }
    if (pathname === `${API_PREFIX}/auth/me` && req.method === 'GET') {
      success(res, { username, isAdmin: deps.isAdminUser(username) })
      return true
    }

    if (pathname === `${API_PREFIX}/sync/snapshot` && req.method === 'GET') {
      success(res, await buildAccountSyncSnapshot(username))
      return true
    }

    if (pathname === `${API_PREFIX}/sync/snapshot` && req.method === 'PUT') {
      const body = await readJson(req, ACCOUNT_SYNC_MAX_BYTES + 64 * 1024)
      if (body.confirm !== 'restore') {
        throw new ApiError(400, 'restore_confirmation_required', '恢复同步数据前必须明确确认')
      }
      try {
        const snapshot = await restoreAccountSyncSnapshot(username, body.snapshot, {
          expectedEmpty: body.expectedEmpty === true,
          expectedRevision: typeof body.expectedRevision === 'string' ? body.expectedRevision : undefined,
        })
        success(res, snapshot)
      } catch (error: any) {
        const message = error?.message || String(error)
        if (message.includes('already contains') || message.includes('changed')) {
          throw new ApiError(409, 'sync_conflict', message)
        }
        throw new ApiError(400, 'invalid_sync_snapshot', message)
      }
      return true
    }

    if (pathname === `${API_PREFIX}/tracks/qualities` && req.method === 'GET') {
      success(res, QUALITY_ORDER.map(id => ({ id, label: {
        '128k': '标准音质', '320k': '高音质', flac: '无损音质',
        flac24bit: '24bit无损', hires: '高解析度', atmos: '空间音频',
        atmos_plus: '增强空间音频', master: '母带音质',
      }[id] || id })))
      return true
    }

    if (pathname === `${API_PREFIX}/library/tracks` && req.method === 'GET') {
      const page = parsePositiveInt(url.searchParams.get('page'), 1, 100000)
      const limit = parsePositiveInt(url.searchParams.get('limit'), 100, 500)
      const query = (url.searchParams.get('query') || '').trim().toLocaleLowerCase()
      const folder = url.searchParams.get('folder')
      const all = await fileCache.getCacheList(username)
      const filtered = all.filter((item: any) => (
        (!folder || item.folder === folder) &&
        (!query || `${item.name}\n${item.singer}\n${item.albumArtist || item.singer}\n${item.album}`.toLocaleLowerCase().includes(query))
      ))
      const offset = (page - 1) * limit
      success(res, { items: filtered.slice(offset, offset + limit).map(toTrack).map(track => withSignedArtwork(track, username, deps.getAuthSecret())), page, limit, total: filtered.length })
      return true
    }

    const localTrackMatch = pathname.match(/^\/api\/v1\/library\/tracks\/([^/]+)\/(stream|cover|stream-token)$/)
    if (localTrackMatch) {
      const trackId = decodeURIComponent(localTrackMatch[1])
      const action = localTrackMatch[2]
      const { decoded } = await getTrackItem(username, trackId)
      if (action === 'stream-token' && req.method === 'POST') {
        const token = issueToken(username, 'media', MEDIA_TOKEN_TTL, deps.getAuthSecret(), { trackId })
        success(res, { token, expiresIn: MEDIA_TOKEN_TTL, path: `${API_PREFIX}/library/tracks/${encodeURIComponent(trackId)}/stream?token=${encodeURIComponent(token)}` })
        return true
      }
      if (action === 'stream' && (req.method === 'GET' || req.method === 'HEAD')) {
        fileCache.serveCacheFile(req, res, decoded.filename, username, decoded.folder, decoded.location)
        return true
      }
      if (action === 'cover' && req.method === 'GET') {
        const cover = await fileCache.getCacheCover(decoded.filename, username, decoded.location) as any
        if (!cover?.data) throw new ApiError(404, 'cover_not_found', '歌曲没有可用封面')
        res.writeHead(200, { 'Content-Type': cover.mime || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' })
        res.end(cover.data)
        return true
      }
    }

    if (pathname === `${API_PREFIX}/search` && req.method === 'GET') {
      const query = (url.searchParams.get('query') || '').trim()
      const source = url.searchParams.get('source') || 'tx'
      const type = url.searchParams.get('type') || 'song'
      const page = parsePositiveInt(url.searchParams.get('page'), 1, 10000)
      const limit = parsePositiveInt(url.searchParams.get('limit'), 30, 100)
      if (!query) throw new ApiError(400, 'query_required', '请输入搜索内容')
      if (!deps.isSourceSupported(source, username)) throw new ApiError(409, 'source_unavailable', `当前账户没有可用的 ${source} 音源`)
      if (type === 'singer' || type === 'album') {
        const method = type === 'singer' ? 'searchSinger' : 'searchAlbum'
        if (!deps.musicSdk[source]?.extendSearch?.[method]) throw new ApiError(400, 'search_unsupported', '该平台不支持此类搜索')
        const result = await deps.musicSdk[source].extendSearch[method](query, page, limit)
        success(res, normalizeEntityResult(result, source, type))
        return true
      }
      if (!deps.musicSdk[source]?.musicSearch?.search) throw new ApiError(400, 'search_unsupported', '该平台不支持歌曲搜索')
      const result = await deps.musicSdk[source].musicSearch.search(query, page, limit)
      success(res, normalizeSearchResult(result, source))
      return true
    }

    const entityDetailMatch = pathname.match(/^\/api\/v1\/(artists|albums)\/([^/]+)$/)
    if (entityDetailMatch && req.method === 'GET') {
      const kind = entityDetailMatch[1] as 'artists' | 'albums'
      const id = decodeURIComponent(entityDetailMatch[2])
      const source = url.searchParams.get('source') || 'tx'
      if (!id) throw new ApiError(400, 'entity_id_required', '缺少歌手或专辑 ID')
      if (!deps.isSourceSupported(source, username)) throw new ApiError(409, 'source_unavailable', `当前账户没有可用的 ${source} 音源`)
      const detailSdk = deps.musicSdk[source]?.extendDetail
      if (!detailSdk) throw new ApiError(400, 'detail_unsupported', '该平台不支持歌手或专辑详情')

      if (kind === 'artists') {
        if (!detailSdk.getArtistSongs || !detailSdk.getArtistAlbums) {
          throw new ApiError(400, 'artist_detail_unsupported', '该平台不支持歌手详情')
        }
        const detailPromise = detailSdk.getArtistDetail
          ? Promise.resolve(detailSdk.getArtistDetail(id)).catch(() => null)
          : Promise.resolve(null)
        const [detail, songs, albums] = await Promise.all([
          detailPromise,
          fetchAllPages((page, limit) => detailSdk.getArtistSongs(id, page, limit, 'hot')),
          fetchAllPages((page, limit) => detailSdk.getArtistAlbums(id, page, limit, 'time')),
        ])
        const normalizedSongs = normalizeSearchResult({ list: songs.items, total: songs.total }, source)
        success(res, {
          kind: 'singer',
          entity: {
            id,
            name: detail?.name || url.searchParams.get('name') || '',
            source,
            artworkUrl: detail?.avatar || null,
            description: detail?.desc || '',
          },
          songs: normalizedSongs.items,
          songCount: normalizedSongs.total,
          songsComplete: songs.complete,
          albums: albums.items.map(item => normalizeAlbum(item, source)),
          albumCount: albums.total,
          albumsComplete: albums.complete,
        })
        return true
      }

      if (!detailSdk.getAlbumSongs) throw new ApiError(400, 'album_detail_unsupported', '该平台不支持专辑详情')
      const album = await detailSdk.getAlbumSongs(id)
      const normalizedSongs = normalizeSearchResult(album, source)
      const firstTrack = normalizedSongs.items[0]
      success(res, {
        kind: 'album',
        entity: {
          id,
          name: album?.name || url.searchParams.get('name') || firstTrack?.album || '',
          artist: url.searchParams.get('artist') || firstTrack?.artist || '',
          source,
          artworkUrl: firstTrack?.artworkUrl || null,
          publishTime: album?.publishTime || null,
        },
        songs: normalizedSongs.items,
        songCount: normalizedSongs.total,
      })
      return true
    }

    const libraryMatch = pathname.match(/^\/api\/v1\/library\/(artists|albums)$/)
    if (libraryMatch && (req.method === 'GET' || req.method === 'PUT')) {
      const type = libraryMatch[1] as 'artists' | 'albums'
      if (req.method === 'GET') {
        success(res, await deps.getLibrary(username, type))
        return true
      }
      const body = await readJson(req)
      if (!Array.isArray(body.items)) throw new ApiError(400, 'items_required', '收藏数据必须是数组')
      if (body.items.length > 10000) throw new ApiError(413, 'items_too_large', '收藏数量超过限制')
      await deps.saveLibrary(username, type, body.items)
      success(res, { items: body.items })
      return true
    }

    const leaderboardMatch = pathname.match(/^\/api\/v1\/leaderboards(?:\/([^/]+)\/tracks)?$/)
    if (leaderboardMatch && req.method === 'GET') {
      const source = url.searchParams.get('source') || 'tx'
      if (!deps.isSourceSupported(source, username)) throw new ApiError(409, 'source_unavailable', `当前账户没有可用的 ${source} 音源`)
      if (leaderboardMatch[1]) {
        const page = parsePositiveInt(url.searchParams.get('page'), 1, 10000)
        const result = await deps.getLeaderboardList(source, decodeURIComponent(leaderboardMatch[1]), page, username)
        success(res, normalizeSearchResult(result, source))
      } else {
        success(res, await deps.getLeaderboardBoards(source, username))
      }
      return true
    }

    if (pathname === `${API_PREFIX}/tracks/resolve` && req.method === 'POST') {
      const body = await readJson(req)
      const song = deps.normalizeSongInfo(body.track || body.songInfo)
      if (!song?.source) throw new ApiError(400, 'invalid_track', '歌曲信息不完整')
      const requestedQuality = QUALITY_ORDER.includes(body.quality) ? body.quality : 'flac'
      const resolved = await deps.resolveSong(song, requestedQuality, username, body.allowQualityFallback !== false, {
        allowPlatformSwitch: body.allowPlatformSwitch !== false,
        allowApiSwitch: body.allowSourceSwitch !== false,
      })
      success(res, {
        url: resolved.url,
        quality: resolved.quality,
        requestedQuality,
        requestedSource: resolved.requestedSource || song.source,
        actualSource: resolved.downloadSource || resolved.songInfo?.source || song.source,
        sourceName: resolved.sourceName || null,
        track: resolved.songInfo || song,
      })
      return true
    }

    if (pathname === `${API_PREFIX}/lyrics` && req.method === 'POST') {
      const body = await readJson(req)
      const song = deps.normalizeSongInfo(body.track || body.songInfo)
      const local = fileCache.getLocalLyrics(song, username)
      if (local.exists && local.content) {
        success(res, normalizeLyricsResponse(local.content, local.source || 'local'))
        return true
      }
      if (!song?.source || !deps.musicSdk[song.source]?.getLyric) throw new ApiError(404, 'lyrics_not_found', '没有可用歌词')
      const request = deps.musicSdk[song.source].getLyric(song)
      const result = request?.promise ? await request.promise : await request
      success(res, { ...result, source: song.source })
      return true
    }

    if (pathname === `${API_PREFIX}/playlists` && req.method === 'GET') {
      const data = await getUserSpace(username).listManage.getListData()
      success(res, [
        { id: 'default', name: '试听列表', trackCount: data.defaultList.length },
        { id: 'love', name: '我的收藏', trackCount: data.loveList.length },
        ...data.userList.map(item => ({ id: item.id, name: item.name, trackCount: item.list.length })),
      ])
      return true
    }

    if (pathname === `${API_PREFIX}/playlists` && req.method === 'POST') {
      const body = await readJson(req)
      const name = String(body.name || '').trim()
      if (!name || name.length > 100) throw new ApiError(400, 'invalid_playlist_name', '歌单名称不能为空且不能超过 100 个字符')
      const id = `mobile_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
      const manage = getUserSpace(username).listManage
      await manage.listDataManage.userListCreate({ id, name, position: -1, locationUpdateTime: Date.now() })
      await manage.createSnapshot()
      success(res, { id, name, trackCount: 0 }, 201)
      return true
    }

    const playlistExportMatch = pathname.match(/^\/api\/v1\/playlists\/([^/]+)\/export$/)
    if (playlistExportMatch && req.method === 'GET') {
      const exchange = await createPlaylistExchange(
        username,
        decodeURIComponent(playlistExportMatch[1]),
        deps.serverVersion,
        String(global.lx.config.serverName || ''),
        getRequestBaseUrl(req),
        60 * 60 * 1000,
      )
      await revokePlaylistExchange(username, exchange.token)
      success(res, { package: exchange.package })
      return true
    }

    const playlistMatch = pathname.match(/^\/api\/v1\/playlists\/([^/]+)(?:\/tracks(?:\/([^/]+))?)?$/)
    if (playlistMatch) {
      const playlistId = decodeURIComponent(playlistMatch[1])
      const trackId = playlistMatch[2] ? decodeURIComponent(playlistMatch[2]) : null
      const manage = getUserSpace(username).listManage
      if (req.method === 'GET' && !trackId) {
        const playlist = await getPlaylist(username, playlistId)
        const localItems = await fileCache.getCacheList(username)
        const localIndex = createLocalTrackIndex(localItems)
        const items = playlist.list.map(song => {
          const normalizedSong = deps.normalizeSongInfo({ ...song })
          return withSignedArtwork(mergeLocalTrackMetadata(
            normalizeOnlineTrack(normalizedSong, song.source || 'unknown'),
            findLocalPlaylistTrack(normalizedSong, localIndex),
          ), username, deps.getAuthSecret())
        })
        success(res, { id: playlist.id, name: playlist.name, items })
        return true
      }
      if (req.method === 'PATCH' && !pathname.includes('/tracks')) {
        if (['default', 'love'].includes(playlistId)) throw new ApiError(400, 'playlist_readonly', '系统歌单不能重命名')
        const body = await readJson(req)
        const playlist = await getPlaylist(username, playlistId)
        const name = String(body.name || '').trim()
        if (!name || name.length > 100) throw new ApiError(400, 'invalid_playlist_name', '歌单名称无效')
        await manage.listDataManage.userListsUpdate([{ ...playlist, name, locationUpdateTime: Date.now() }])
        await manage.createSnapshot()
        success(res, { id: playlistId, name })
        return true
      }
      if (req.method === 'DELETE' && !pathname.includes('/tracks')) {
        if (['default', 'love'].includes(playlistId)) throw new ApiError(400, 'playlist_readonly', '系统歌单不能删除')
        await getPlaylist(username, playlistId)
        await manage.listDataManage.userListsRemove([playlistId])
        await manage.createSnapshot()
        res.writeHead(204); res.end()
        return true
      }
      if (req.method === 'POST' && pathname.endsWith('/tracks')) {
        await getPlaylist(username, playlistId)
        const body = await readJson(req)
        const tracks = Array.isArray(body.tracks) ? body.tracks : body.track ? [body.track] : []
        if (!tracks.length) throw new ApiError(400, 'tracks_required', '请选择要加入的歌曲')
        await manage.listDataManage.listMusicAdd(playlistId, tracks.map(deps.normalizeSongInfo), body.position === 'top' ? 'top' : 'bottom')
        await manage.createSnapshot()
        success(res, { added: tracks.length })
        return true
      }
      if (req.method === 'DELETE' && trackId) {
        await getPlaylist(username, playlistId)
        await manage.listDataManage.listMusicRemove(playlistId, [trackId])
        await manage.createSnapshot()
        res.writeHead(204); res.end()
        return true
      }
    }

    if (pathname === `${API_PREFIX}/downloads` && req.method === 'GET') {
      success(res, { concurrency: serverDownloadQueue.getConcurrency(username), items: serverDownloadQueue.list(username) })
      return true
    }
    if (pathname === `${API_PREFIX}/downloads` && req.method === 'POST') {
      const body = await readJson(req)
      const rawItems = Array.isArray(body.items) ? body.items : body.track ? [{ track: body.track, quality: body.quality }] : []
      if (!rawItems.length) throw new ApiError(400, 'tracks_required', '请选择要下载的歌曲')
      const items = rawItems.map((item: any) => ({
        id: item.id || crypto.randomUUID(),
        songInfo: deps.normalizeSongInfo(item.track || item.songInfo),
        quality: QUALITY_ORDER.includes(item.quality) ? item.quality : 'flac',
        enableOnlyDownloadMode: true,
        cacheLyric: item.downloadLyrics !== false,
        embedLyric: item.embedLyrics !== false,
        sidecarLyricFormat: item.sidecarLyricFormat,
        embedLyricFormat: item.embedLyricFormat,
      }))
      success(res, { items: serverDownloadQueue.enqueue(username, items) }, 202)
      return true
    }
    if (pathname === `${API_PREFIX}/downloads/concurrency` && req.method === 'PUT') {
      const body = await readJson(req)
      success(res, { concurrency: serverDownloadQueue.setConcurrency(username, body.concurrency) })
      return true
    }
    if (pathname === `${API_PREFIX}/downloads/resume` && req.method === 'POST') {
      const body = await readJson(req); serverDownloadQueue.resume(username, body.id); success(res, { resumed: true }); return true
    }
    if (pathname === `${API_PREFIX}/downloads/pause` && req.method === 'POST') {
      const body = await readJson(req); serverDownloadQueue.pause(username, body.id); success(res, { paused: true }); return true
    }
    if (pathname === `${API_PREFIX}/downloads` && req.method === 'DELETE') {
      const body = await readJson(req); serverDownloadQueue.remove(username, { id: body.id, all: body.all, completed: body.completed }); res.writeHead(204); res.end(); return true
    }

    if (pathname === `${API_PREFIX}/replacement` && req.method === 'GET') {
      success(res, remasterQueue.getStatus(username, Number(url.searchParams.get('offset') || 0), parsePositiveInt(url.searchParams.get('limit'), 100, 200)))
      return true
    }
    if (pathname === `${API_PREFIX}/replacement` && req.method === 'POST') {
      const body = await readJson(req)
      const status = await remasterQueue.start(username, body.targetQuality || 'flac', body.filenames, {
        allowPlatformSwitch: body.allowPlatformSwitch !== false,
        allowApiSwitch: body.onlyFirstSource !== true,
      })
      success(res, status, 202)
      return true
    }
    if (pathname === `${API_PREFIX}/replacement/cancel` && req.method === 'POST') {
      success(res, { cancelled: remasterQueue.cancel(username) })
      return true
    }

    if (pathname === `${API_PREFIX}/sources` && req.method === 'GET') {
      const sources = deps.getLoadedSources().filter(source => (
        source.owner === username || isSourceSharedWithUser(source.owner, source.id, username)
      ))
      success(res, sources.map(source => sourceView(source, username)))
      return true
    }
    const sourcePlatformsMatch = pathname.match(/^\/api\/v1\/sources\/([^/]+)\/platforms$/)
    if (sourcePlatformsMatch && req.method === 'PUT') {
      const body = await readJson(req)
      const sourceId = decodeURIComponent(sourcePlatformsMatch[1])
      const owner = tryNormalizeUsername(body.owner) || username
      const source = deps.getLoadedSources().find(item => item.id === sourceId && item.owner === owner)
      if (!source || (owner !== username && !isSourceSharedWithUser(owner, sourceId, username))) {
        throw new ApiError(404, 'source_not_found', '音源不存在')
      }
      const enabledPlatforms = setEnabledSourcePlatforms(username, owner, sourceId, body.enabledPlatforms, Object.keys(source.sources || {}))
      success(res, { enabledPlatforms })
      return true
    }

    if (pathname === `${API_PREFIX}/shares/settings`) {
      if (req.method === 'GET') { success(res, { enabled: isPlaylistSharingEnabled(username) }); return true }
      if (req.method === 'PUT') { const body = await readJson(req); success(res, { enabled: setPlaylistSharingEnabled(username, body.enabled === true) }); return true }
    }
    if (pathname === `${API_PREFIX}/shares/inbox` && req.method === 'GET') {
      success(res, getPendingPlaylistShares(username)); return true
    }
    if (pathname === `${API_PREFIX}/shares` && req.method === 'POST') {
      const body = await readJson(req); success(res, await createPlaylistShare(username, body.toUsername, body.playlistId), 202); return true
    }
    const shareMatch = pathname.match(/^\/api\/v1\/shares\/([^/]+)$/)
    if (shareMatch && req.method === 'POST') {
      const body = await readJson(req); success(res, await respondToPlaylistShare(username, decodeURIComponent(shareMatch[1]), body.action)); return true
    }

    if (pathname === `${API_PREFIX}/events` && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      let previous = ''
      const send = () => {
        const value = JSON.stringify({
          downloads: serverDownloadQueue.list(username),
          replacement: remasterQueue.getStatus(username, 0, 0),
          pendingShares: getPendingPlaylistShares(username).length,
        })
        if (value !== previous) {
          previous = value
          res.write(`event: state\ndata: ${value}\n\n`)
        } else {
          res.write(': keep-alive\n\n')
        }
      }
      send()
      const timer = setInterval(send, 2000)
      req.on('close', () => clearInterval(timer))
      return true
    }

    throw new ApiError(404, 'endpoint_not_found', '接口不存在')
  } catch (error: any) {
    if (error instanceof PlaylistSharingError) {
      failure(res, { status: error.statusCode, code: error.code, message: error.message })
    } else if (error instanceof PlaylistExchangeError) {
      failure(res, { status: error.statusCode, code: error.code, message: error.message })
    } else if (error instanceof ApiError) {
      failure(res, error)
    } else {
      console.error('[API v1]', error)
      failure(res, { status: 500, code: 'internal_error', message: error?.message || '服务器内部错误' })
    }
    return true
  }
}

import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { PlaylistExchangeError, PLAYLIST_EXCHANGE_FORMAT, PLAYLIST_EXCHANGE_MAX_TRACKS, validatePackage } from './playlistExchange'

export const PLAYLIST_FILE_MAX_BYTES = 8 * 1024 * 1024
export const PLAYLIST_FILE_MAX_DECODED_BYTES = 16 * 1024 * 1024
const MAX_LISTS = 200
const MAX_TOTAL_TRACKS = 30000
const unzip = promisify(gunzip)
const object = (value: any): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const text = (value: any, max = 300): string => typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : ''
const first = (...values: any[]) => values.map(value => text(value)).find(Boolean) || ''
const fail = (message: string, status = 400): never => { throw new PlaylistExchangeError(status, 'invalid_playlist_file', message) }

// Build an allowlisted song record: backups must never restore paths, credentials or scripts.
const convertTrack = (input: any) => {
  const song = object(input)
  const meta = object(song.meta)
  const source = text(song.source).toLowerCase()
  if (source === 'local') return { reason: '本地歌曲没有在线平台及对应歌曲 ID，已跳过' }
  if (!['tx', 'wy', 'kw', 'kg', 'mg'].includes(source)) return { reason: '不支持的歌曲平台' }
  const name = text(song.name)
  const hash = first(meta.hash, song.hash)
  const copyrightId = first(meta.copyrightId, song.copyrightId)
  const id = first(source === 'kg' ? hash : '', source === 'mg' ? copyrightId : '', meta.songId, song.songmid, song.songId, song.id)
    .replace(new RegExp(`^${source}_`), '')
  if (!name || !id) return { reason: '缺少歌名或歌曲编号' }
  const qualities = Array.isArray(meta.qualitys) ? meta.qualitys : Array.isArray(song.types) ? song.types : Array.isArray(song.qualitys) ? song.qualitys : []
  const qualityMap = object(meta._qualitys || song._types || song._qualitys)
  const qualitys: Array<{ type: string; size: string | null; hash?: string }> = []
  for (const type of ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master']) {
    const entry = qualities.find((item: any) => object(item).type === type) || qualityMap[type]
    if (!entry) continue
    qualitys.push({ type, size: text(entry.size, 40) || null, ...(source === 'kg' && text(entry.hash) ? { hash: text(entry.hash) } : {}) })
  }
  const normalizedMeta = {
    songId: id,
    albumName: first(meta.albumName, song.albumName),
    albumId: first(meta.albumId, song.albumId),
    albumArtist: first(meta.albumArtist, song.albumArtist),
    qualitys,
    _qualitys: Object.fromEntries(qualitys.map(({ type, ...quality }) => [type, quality])),
    ...(source === 'tx' ? { strMediaMid: first(meta.strMediaMid, song.strMediaMid), albumMid: first(meta.albumMid, song.albumMid) } : {}),
    ...(source === 'kg' ? { hash: hash || id } : {}),
    ...(source === 'mg' ? { copyrightId: copyrightId || id } : {}),
  }
  return { track: {
    id: `${source}_${id}`, source, name, singer: text(song.singer), interval: text(song.interval, 40),
    songmid: id, albumName: normalizedMeta.albumName, albumArtist: normalizedMeta.albumArtist,
    ...(source === 'tx' && /^\d+$/.test(first(meta.id, song.songId)) ? { songId: first(meta.id, song.songId) } : {}),
    meta: normalizedMeta,
  } }
}

export const parsePlaylistFile = async (input: any) => {
  const filename = text(input?.name, 255)
  if (!/\.(json|lxmc)$/i.test(filename)) fail('仅支持 JSON 或 LXMC 歌单文件')
  const base64 = input?.base64
  if (typeof base64 !== 'string' || !base64 || base64.length > Math.ceil(PLAYLIST_FILE_MAX_BYTES / 3) * 4) fail('歌单文件为空或超过 8 MB', 413)
  if (base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) fail('歌单文件编码无效')
  let bytes = Buffer.from(base64, 'base64')
  if (bytes.length > PLAYLIST_FILE_MAX_BYTES) fail('歌单文件超过 8 MB', 413)
  const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b
  if (compressed) {
    try { bytes = await unzip(bytes, { maxOutputLength: PLAYLIST_FILE_MAX_DECODED_BYTES }) }
    catch { fail('LXMC 解压失败：文件损坏或解压后超过 16 MB') }
  } else if (/\.lxmc$/i.test(filename)) fail('LXMC 文件不是有效的 gzip 备份，请重新从洛雪导出')
  let value: any
  try {
    value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
    // LX Desktop 1.14.0 could serialize its backup JSON twice.
    if (typeof value === 'string') value = JSON.parse(value)
  } catch { fail('歌单文件中的 JSON 数据无效') }
  if (value?.format === PLAYLIST_EXCHANGE_FORMAT) {
    const pack = validatePackage(value)
    return { format: 'yinyun', playlists: [{ package: pack, total: pack.playlist.tracks.length, skipped: 0, warnings: [] }] }
  }
  let lists: any
  switch (value?.type) {
    case 'playListPart': case 'playListPart_v2': case 'defautlList': lists = [value.data]; break
    case 'playList': case 'playList_v2': lists = value.data; break
    case 'allData': case 'allData_v2': lists = value.playList || (value.defaultList ? [value.defaultList] : undefined); break
    default: fail('该文件不是支持的洛雪歌单备份；设置或音源文件不能作为歌单导入')
  }
  if (!Array.isArray(lists) || !lists.length) fail('备份中没有歌单')
  if (lists.length > MAX_LISTS) fail('单次最多导入 200 个歌单', 413)
  let total = 0
  const playlists = lists.map((list: any, index: number) => {
    if (!Array.isArray(list?.list)) fail(`第 ${index + 1} 个歌单缺少歌曲列表`)
    total += list.list.length
    if (list.list.length > PLAYLIST_EXCHANGE_MAX_TRACKS || total > MAX_TOTAL_TRACKS) fail('超过歌曲数量限制：单歌单 10000 首，单文件 30000 首', 413)
    const warnings: Array<{ index: number; name: string; reason: string }> = []
    const tracks = []
    let skipped = 0
    for (const [songIndex, song] of list.list.entries()) {
      const result = convertTrack(song)
      if (result.track) tracks.push(result.track)
      else {
        skipped++
        if (warnings.length < 100) warnings.push({ index: songIndex + 1, name: text(song?.name) || '未命名歌曲', reason: result.reason! })
      }
    }
    const pack = validatePackage({
      format: PLAYLIST_EXCHANGE_FORMAT, schemaVersion: 1,
      playlist: { name: text(list.name, 100) || (list.id === 'love' ? '我的收藏' : `导入歌单 ${index + 1}`), description: '', tracks },
      origin: { serverName: '洛雪歌单备份', serverVersion: '' }, createdAt: Date.now(),
    })
    return { package: pack, total: list.list.length, skipped, warnings }
  })
  return { format: 'lx', playlists }
}

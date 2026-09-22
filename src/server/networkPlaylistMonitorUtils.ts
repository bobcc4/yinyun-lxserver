export const parseNetworkPlaylistInterval = (value: unknown) => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw || ['off', 'none', 'disable', '0'].includes(raw)) return 0
  const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/)
  if (!match) return 6 * 60 * 60 * 1000
  const count = Number(match[1])
  if (!Number.isFinite(count) || count <= 0) return 0
  const multiplier = { ms: 1, s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }[match[2] || 'h']
  return Math.max(30 * 1000, count * (multiplier || 60 * 60 * 1000))
}

export const networkPlaylistSongKey = (song: any) => {
  const source = String(song?.source || song?.meta?.source || '')
  const meta = song?.meta || {}
  const first = (...values: any[]) => values.find(value => value !== undefined && value !== null && value !== '')
  const strip = (value: any) => {
    const id = String(value ?? '')
    return source && id.startsWith(`${source}_`) ? id.slice(source.length + 1) : id
  }
  // TX songmid is different from its numeric songId; KG is identified by hash.
  let id = first(song?.songmid, meta.songmid, song?.id, song?.songId, meta.songId)
  if (source === 'kg') {
    const fallback = strip(id)
    id = first(song?.hash, meta.hash, fallback.match(/(?:^|_)([a-f0-9]{32})$/i)?.[1], fallback)
    id = String(id || '').toLowerCase()
  } else if (source === 'mg') {
    id = first(song?.copyrightId, meta.copyrightId, id)
  }
  return `${source}:${strip(id)}`
}

export const networkPlaylistsAreEqual = (local: any[], remote: any[]) => (
  local.length === remote.length && local.every((song, index) => networkPlaylistSongKey(song) === networkPlaylistSongKey(remote[index]))
)

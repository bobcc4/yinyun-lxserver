import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

const song = { id: 'tx_001mid', name: '测试歌曲', singer: '测试歌手', source: 'tx', interval: '03:10', meta: { songId: '001mid', id: 123, strMediaMid: 'media001', albumName: '测试专辑', qualitys: [{ type: 'flac', size: '30M' }] } }
const list = { id: 'love', name: '我的收藏', list: [song] }
const upload = (value: unknown, compressed = true) => ({ name: compressed ? 'test.lxmc' : 'test.json', base64: (compressed ? gzipSync(JSON.stringify(value)) : Buffer.from(JSON.stringify(value))).toString('base64') })

test('LX playlist files parse safely and import through authenticated API without restoring settings', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yinyun-lxmc-'))
  const dataPath = path.join(root, 'data')
  fs.mkdirSync(path.join(dataPath, 'users'), { recursive: true })
  global.lx = {
    dataPath, userPath: path.join(dataPath, 'users'), logPath: path.join(root, 'logs'), staticPath: path.join(root, 'public'),
    config: { users: [{ name: 'admin', password: 'password' }], maxSnapshotNum: 10, 'list.addMusicLocationType': 'bottom' } as LX.Config,
    saveConfig: () => {},
  }
  const { parsePlaylistFile, PLAYLIST_FILE_MAX_DECODED_BYTES } = await import('../src/server/playlistFileImport')
  const { normalizeSongInfo } = await import('../src/server/utils/songInfo')
  const { getUserSpace, releaseUserSpace } = await import('../src/user')
  let server: http.Server | undefined
  try {
    await t.test('single, multiple and full backups, old/new formats and double serialization', async () => {
      for (const value of [
        { type: 'playListPart', data: list }, { type: 'playListPart_v2', data: list },
        { type: 'playList', data: [list] }, { type: 'playList_v2', data: [list] },
        { type: 'allData', playList: [list], setting: { secret: 'not-imported' } },
        { type: 'allData_v2', playList: [list], setting: { secret: 'not-imported' } },
        { type: 'defautlList', data: list }, { type: 'allData', defaultList: list },
      ]) {
        for (const compressed of [true, false]) {
          const result = await parsePlaylistFile(upload(value, compressed))
          assert.equal(result.playlists.length, 1)
          const track = normalizeSongInfo(result.playlists[0].package.playlist.tracks[0])
          assert.equal(track.songmid, '001mid')
          assert.equal(track.songId, '123')
          assert.equal(track.strMediaMid, 'media001')
          assert.equal(track.types[0].type, 'flac')
          assert.ok(!JSON.stringify(result).includes('not-imported'))
        }
      }
      assert.equal((await parsePlaylistFile(upload(JSON.stringify({ type: 'playListPart_v2', data: list })))).playlists.length, 1)
      assert.equal((await parsePlaylistFile(upload({ type: 'playList_v2', data: [list, { ...list, name: '另一个歌单' }] }))).playlists.length, 2)
    })
    await t.test('preserves old platform IDs, order and KG per-quality hashes; strips private fields', async () => {
      const tracks = [
        { source: 'tx', name: 'QQ', singer: 'Singer', songmid: 'mid1', strMediaMid: 'media1', types: [{ type: '320k', size: '8M' }] },
        { source: 'wy', name: 'WY', songmid: 12345 },
        { source: 'kw', name: 'KW', songmid: '678' },
        { source: 'kg', name: 'KG', hash: 'hash1', _types: { flac: { hash: 'flachash', size: '40M' } } },
        { source: 'mg', name: 'MG', copyrightId: 'cid1' },
      ].map(track => ({ ...track, url: 'secret-url', password: 'secret-password', filePath: 'private-path' }))
      const result = await parsePlaylistFile(upload({ type: 'playListPart', data: { name: 'Old', list: tracks } }))
      const actual = result.playlists[0].package.playlist.tracks.map(track => normalizeSongInfo(track))
      assert.deepEqual(actual.map(track => track.source), ['tx', 'wy', 'kw', 'kg', 'mg'])
      assert.deepEqual(actual.map(track => track.songmid), ['mid1', '12345', '678', 'hash1', 'cid1'])
      assert.equal(actual[3]._types.flac.hash, 'flachash')
      assert.equal(actual[4].copyrightId, 'cid1')
      assert.doesNotMatch(JSON.stringify(result), /secret-|private-path/)
    })
    await t.test('reports local and invalid songs instead of silently importing unusable paths', async () => {
      const result = await parsePlaylistFile(upload({ type: 'playListPart_v2', data: { ...list, list: [song, { source: 'local', name: 'Local', meta: { filePath: 'C:/private/file.mp3' } }, { source: 'wy', name: 'Missing ID' }, null] } }))
      assert.equal(result.playlists[0].total, 4)
      assert.equal(result.playlists[0].skipped, 3)
      assert.equal(result.playlists[0].package.playlist.tracks.length, 1)
      assert.match(result.playlists[0].warnings[0].reason, /没有在线平台/)
      assert.doesNotMatch(JSON.stringify(result), /C:\/private/)
    })
    await t.test('rejects corrupt, non-playlist, oversized and decompression-bomb files', async () => {
      await assert.rejects(parsePlaylistFile(upload({ type: 'setting_v2', data: {} })), /不是支持的洛雪歌单/)
      await assert.rejects(parsePlaylistFile({ name: 'bad.lxmc', base64: Buffer.from('not gzip').toString('base64') }), /gzip/)
      await assert.rejects(parsePlaylistFile({ name: 'bad.json', base64: '!!!!' }), /编码/)
      await assert.rejects(parsePlaylistFile({ name: 'bad.json', base64: Buffer.from('{').toString('base64') }), /JSON/)
      await assert.rejects(parsePlaylistFile(upload({ type: 'playList_v2', data: Array(201).fill(list) })), /200/)
      await assert.rejects(parsePlaylistFile(upload({ type: 'playListPart_v2', data: { ...list, list: Array(10001).fill(song) } })), /数量限制/)
      await assert.rejects(parsePlaylistFile({ name: 'bomb.lxmc', base64: gzipSync(Buffer.alloc(PLAYLIST_FILE_MAX_DECODED_BYTES + 1, 32)).toString('base64') }), /16 MB/)
      await assert.rejects(parsePlaylistFile({ name: 'big.json', base64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }), /8 MB/)
      await assert.rejects(parsePlaylistFile(upload({ type: 'playListPart_v2', data: {} })), /歌曲列表/)
    })
    await t.test('existing Yinyun JSON remains supported', async () => {
      const result = await parsePlaylistFile(upload({ format: 'yinyun-playlist', schemaVersion: 1, playlist: { name: 'Yinyun', tracks: [song] } }, false))
      assert.equal(result.format, 'yinyun')
      assert.equal(result.playlists[0].package.playlist.name, 'Yinyun')
    })
    await t.test('HTTP parse requires login, preview writes nothing, confirmed imports do not overwrite', async () => {
      const { createApiV1Handler } = await import('../src/server/apiV1')
      const handler = createApiV1Handler({
        serverVersion: 'test', getAuthSecret: () => 'test-secret', getUsers: () => global.lx.config.users,
        isAdminUser: () => false, normalizeSongInfo, isSourceSupported: () => true,
      } as any)
      server = http.createServer((req, res) => { void handler(req, res, new URL(req.url || '/', 'http://localhost')).then(handled => { if (!handled) { res.statusCode = 404; res.end() } }) })
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
      const origin = `http://127.0.0.1:${(server.address() as any).port}`
      const body = JSON.stringify(upload({ type: 'allData_v2', playList: [list], setting: { foo: 'secret' } }))
      const post = (route: string, body: string, token = '') => fetch(`${origin}/api/v1/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body })
      assert.equal((await post('playlist-import/file', body)).status, 401)
      const login = await (await post('auth/login', JSON.stringify({ username: 'admin', password: 'password' }))).json() as any
      const token = login.data.accessToken
      const parsed = await post('playlist-import/file', body, token)
      assert.equal(parsed.status, 200)
      const result = (await parsed.json() as any).data
      const account = getUserSpace('admin')
      assert.equal((await account.listManage.getListData()).userList.length, 0)
      const importBody = JSON.stringify({ package: result.playlists[0].package })
      assert.equal((await post('playlist-import/preview', importBody, token)).status, 200)
      for (let i = 0; i < 2; i++) assert.equal((await post('playlist-import', importBody, token)).status, 201)
      const data = await account.listManage.getListData()
      assert.equal(data.userList.length, 2)
      assert.deepEqual(data.userList.map(item => item.name), ['我的收藏', '我的收藏（2）'])
      assert.equal(data.loveList.length, 0)
      assert.equal(data.userList[0].list[0].meta.songId, '001mid')
    })
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
    releaseUserSpace('admin', true)
    await new Promise(resolve => setTimeout(resolve, 200))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

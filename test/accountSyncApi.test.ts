import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ACCOUNT_SYNC_MAX_BYTES } from '../src/server/accountSyncContract'

test('account sync API supports login, large restore, and conflict protection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yinyun-account-api-'))
  const dataPath = path.join(root, 'data')
  fs.mkdirSync(path.join(dataPath, 'users'), { recursive: true })
  global.lx = {
    dataPath,
    userPath: path.join(dataPath, 'users'),
    logPath: path.join(root, 'logs'),
    staticPath: path.join(root, 'public'),
    config: {
      users: [{ name: 'admin', password: 'password' }],
      maxSnapshotNum: 10,
      'list.addMusicLocationType': 'bottom',
      'subsonic.enable': true,
    } as LX.Config,
    saveConfig: () => {},
  }

  const { createApiV1Handler } = await import('../src/server/apiV1')
  const { releaseUserSpace } = await import('../src/user')
  const libraries: Record<'artists' | 'albums', any[]> = { artists: [], albums: [] }
  const handler = createApiV1Handler({
    serverVersion: 'test',
    getAuthSecret: () => 'test-secret',
    getUsers: () => global.lx.config.users,
    musicSdk: {
      tx: {
        extendSearch: {
          searchSinger: async () => ({ list: [{ id: 'artist-1', name: 'Test singer', source: 'tx' }] }),
          searchAlbum: async () => ({ list: [{ id: 'album-1', name: 'Test album', artistName: 'Test singer', source: 'tx' }] }),
        },
        extendDetail: {
          getArtistDetail: async () => ({ id: 'artist-1', name: 'Test singer', avatar: 'https://img.test/artist.jpg', desc: 'Artist description' }),
          getArtistSongs: async () => ({ list: [{ songmid: 'song-1', name: 'Test song', singer: 'Test singer', albumName: 'Test album', img: 'https://img.test/album.jpg', source: 'tx' }], total: 1 }),
          getArtistAlbums: async () => ({ list: [{ id: 'album-1', name: 'Test album', singer: 'Test singer', img: 'https://img.test/album.jpg', total: 1, source: 'tx' }], total: 1 }),
          getAlbumSongs: async () => ({ name: 'Test album', publishTime: '2026-01-01', list: [{ songmid: 'song-1', name: 'Test song', singer: 'Test singer', albumName: 'Test album', img: 'https://img.test/album.jpg', source: 'tx' }], total: 1 }),
        },
      },
    },
    normalizeSongInfo: value => value,
    resolveSong: async () => null,
    isSourceSupported: source => source === 'tx',
    getLoadedSources: () => [],
    getLibrary: async (_username, type) => libraries[type],
    saveLibrary: async (_username, type, items) => { libraries[type] = items },
    getLeaderboardBoards: async () => ({ list: [{ id: 'tx__4', bangid: '4', name: 'Test board' }] }),
    getLeaderboardList: async () => ({ list: [{ songmid: 'song-1', name: 'Test song', singer: 'Test singer', source: 'tx' }] }),
  })
  const server = http.createServer((req, res) => {
    void handler(req, res, new URL(req.url || '/', 'http://127.0.0.1')).then(handled => {
      if (!handled) {
        res.writeHead(404)
        res.end()
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`

  try {
    const loginResponse = await fetch(`${origin}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ADMIN', password: 'password' }),
    })
    assert.equal(loginResponse.status, 200)
    const login = await loginResponse.json() as any
    const headers = {
      'Authorization': `Bearer ${login.data.accessToken}`,
      'Content-Type': 'application/json',
    }

    const snapshotResponse = await fetch(`${origin}/api/v1/sync/snapshot`, { headers })
    assert.equal(snapshotResponse.status, 200)
    const snapshot = (await snapshotResponse.json() as any).data
    assert.equal(snapshot.empty, true)

    const capabilitiesResponse = await fetch(`${origin}/api/v1/capabilities`)
    assert.equal((await capabilitiesResponse.json() as any).data.apiVersion, '1.4.0')

    const boardsResponse = await fetch(`${origin}/api/v1/leaderboards?source=tx`, { headers })
    assert.equal(boardsResponse.status, 200)
    assert.equal((await boardsResponse.json() as any).data.list[0].bangid, '4')

    const boardTracksResponse = await fetch(`${origin}/api/v1/leaderboards/4/tracks?source=tx`, { headers })
    assert.equal(boardTracksResponse.status, 200)
    assert.equal((await boardTracksResponse.json() as any).data.items[0].title, 'Test song')

    const singerSearchResponse = await fetch(`${origin}/api/v1/search?query=test&type=singer&source=tx`, { headers })
    assert.equal(singerSearchResponse.status, 200)
    assert.equal((await singerSearchResponse.json() as any).data.items[0].kind, 'singer')

    const albumSearchResponse = await fetch(`${origin}/api/v1/search?query=test&type=album&source=tx`, { headers })
    assert.equal(albumSearchResponse.status, 200)
    const albumSearch = (await albumSearchResponse.json() as any).data.items[0]
    assert.equal(albumSearch.kind, 'album')
    assert.equal(albumSearch.artist, 'Test singer')

    const artistDetailResponse = await fetch(`${origin}/api/v1/artists/artist-1?source=tx`, { headers })
    assert.equal(artistDetailResponse.status, 200)
    const artistDetail = (await artistDetailResponse.json() as any).data
    assert.equal(artistDetail.entity.name, 'Test singer')
    assert.equal(artistDetail.songs[0].title, 'Test song')
    assert.equal(artistDetail.albums[0].name, 'Test album')

    const albumDetailResponse = await fetch(`${origin}/api/v1/albums/album-1?source=tx`, { headers })
    assert.equal(albumDetailResponse.status, 200)
    const albumDetail = (await albumDetailResponse.json() as any).data
    assert.equal(albumDetail.entity.name, 'Test album')
    assert.equal(albumDetail.songs[0].artworkUrl, 'https://img.test/album.jpg')

    const saveArtistsResponse = await fetch(`${origin}/api/v1/library/artists`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ items: [{ id: 'artist-1', name: 'Test singer', source: 'tx' }] }),
    })
    assert.equal(saveArtistsResponse.status, 200)
    const artistsResponse = await fetch(`${origin}/api/v1/library/artists`, { headers })
    assert.equal(artistsResponse.status, 200)
    assert.equal((await artistsResponse.json() as any).data[0].name, 'Test singer')

    snapshot.data.settings = { largeValue: 'x'.repeat(2_250_000) }
    snapshot.data.lists.defaultList = [{
      id: 'tx_playlist-song',
      name: 'Playlist song',
      singer: 'Test singer',
      source: 'tx',
      interval: '03:21',
      meta: { albumName: 'Playlist album', picUrl: 'https://img.test/playlist.jpg' },
    }]
    const restoreBody = JSON.stringify({
      confirm: 'restore',
      snapshot,
      expectedEmpty: true,
      expectedRevision: snapshot.revision,
    })
    assert.ok(Buffer.byteLength(restoreBody) > 2 * 1024 * 1024)
    const restoreResponse = await fetch(`${origin}/api/v1/sync/snapshot`, {
      method: 'PUT',
      headers,
      body: restoreBody,
    })
    assert.equal(restoreResponse.status, 200)
    const restored = (await restoreResponse.json() as any).data
    assert.equal(restored.data.settings.largeValue.length, 2_250_000)

    const playlistResponse = await fetch(`${origin}/api/v1/playlists/default`, { headers })
    const playlistTrack = (await playlistResponse.json() as any).data.items[0]
    assert.equal(playlistTrack.album, 'Playlist album')
    assert.equal(playlistTrack.artworkUrl, 'https://img.test/playlist.jpg')

    const conflictResponse = await fetch(`${origin}/api/v1/sync/snapshot`, {
      method: 'PUT',
      headers,
      body: restoreBody,
    })
    assert.equal(conflictResponse.status, 409)
    assert.equal((await conflictResponse.json() as any).error.code, 'sync_conflict')

    const oversizedResponse = await fetch(`${origin}/api/v1/sync/snapshot`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ value: 'x'.repeat(ACCOUNT_SYNC_MAX_BYTES + 128 * 1024) }),
    })
    assert.equal(oversizedResponse.status, 413)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    releaseUserSpace('admin', true)
    await new Promise(resolve => setTimeout(resolve, 250))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('cross-server playlist exchange preserves tracks and creates a normal playlist', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yinyun-playlist-exchange-'))
  const dataPath = path.join(root, 'data')
  fs.mkdirSync(path.join(dataPath, 'users'), { recursive: true })
  global.lx = {
    dataPath,
    userPath: path.join(dataPath, 'users'),
    logPath: path.join(root, 'logs'),
    staticPath: path.join(root, 'public'),
    config: {
      serverName: 'Test Yinyun',
      users: [
        { name: 'owner', password: 'secret' },
        { name: 'receiver', password: 'secret' },
      ],
      maxSnapshotNum: 10,
      'list.addMusicLocationType': 'bottom',
    } as LX.Config,
    saveConfig: () => {},
  }

  const { getUserSpace, releaseUserSpace } = await import('../src/user')
  const { createPlaylistExchange, previewPlaylistExchange, importPlaylistExchange } = await import('../src/server/playlistExchange')
  const song = {
    id: 'tx_001',
    songmid: '001',
    name: 'Test song',
    singer: 'Test singer',
    source: 'tx',
    interval: '03:00',
    meta: { songId: '001', albumName: 'Test album', picUrl: 'https://private.example/cover.jpg' },
    url: 'https://private.example/audio.flac',
  } as LX.Music.MusicInfo

  try {
    const owner = getUserSpace('owner')
    await owner.listManage.listDataManage.userListCreate({ id: 'playlist-1', name: 'Shared songs', position: -1, locationUpdateTime: Date.now() })
    await owner.listManage.listDataManage.listMusicOverwrite('playlist-1', [song])
    const share = await createPlaylistExchange('owner', 'playlist-1', '1.7.0', 'Test Yinyun', 'https://source.example')
    assert.match(share.url, /^https:\/\/source\.example\/share\/playlist\/[a-f0-9]{64}$/)
    assert.equal((share.package.playlist.tracks[0] as any).url, undefined)
    assert.equal((share.package.playlist.tracks[0] as any).meta.picUrl, undefined)

    const preview = await previewPlaylistExchange('receiver', share.package, () => true)
    assert.equal(preview.total, 1)
    assert.equal(preview.onlineMatches, 1)

    const imported = await importPlaylistExchange('receiver', share.package, value => value)
    assert.equal(imported.trackCount, 1)
    const receiver = await getUserSpace('receiver').listManage.getListData()
    assert.equal(receiver.userList.length, 1)
    assert.equal(receiver.userList[0].list[0].id, 'tx_001')
  } finally {
    releaseUserSpace('owner', true)
    releaseUserSpace('receiver', true)
    await new Promise(resolve => setTimeout(resolve, 100))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

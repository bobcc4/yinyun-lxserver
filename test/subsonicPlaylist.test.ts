import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('Subsonic createPlaylist creates a user playlist from POST form parameters', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yinyun-subsonic-playlist-'))
  const dataPath = path.join(root, 'data')
  const userPath = path.join(dataPath, 'users')
  fs.mkdirSync(userPath, { recursive: true })
  global.lx = {
    dataPath,
    userPath,
    config: {
      users: [{ name: 'admin', password: 'password' }],
      maxSnapshotNum: 10,
      'list.addMusicLocationType': 'bottom',
      'subsonic.enableDebug': false,
    },
  } as any

  const { subsonicHandler } = await import('../src/server/subsonic')
  const { getUserSpace, releaseUserSpace } = await import('../src/user')
  const server = http.createServer((req, res) => {
    void subsonicHandler.handleRequest(req, res, new URL(req.url || '/', 'http://127.0.0.1'))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    releaseUserSpace('admin', true)
    fs.rmSync(root, { recursive: true, force: true })
  })

  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const body = new URLSearchParams({ playlistName: 'Arrow Music Playlist', f: 'json' })
  const response = await fetch(`${origin}/rest/createPlaylist.view?u=admin&p=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json() as any)['subsonic-response'].status, 'ok')

  const listData = await getUserSpace('admin').listManage.getListData()
  assert.equal(listData.userList.length, 1)
  assert.equal(listData.userList[0].name, 'Arrow Music Playlist')
  assert.match(listData.userList[0].id, /^subsonic_[a-f0-9]{24}$/)
  const snapshotInfo = getUserSpace('admin').listManage.snapshotDataManage
  assert.ok((await snapshotInfo.getSnapshotInfo()).latest)

  const rename = new URLSearchParams({ playlistId: listData.userList[0].id, name: 'Renamed Playlist', f: 'json' })
  const renameResponse = await fetch(`${origin}/rest/updatePlaylist.view?u=admin&p=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: rename,
  })
  assert.equal((await renameResponse.json() as any)['subsonic-response'].status, 'ok')
  assert.equal((await getUserSpace('admin').listManage.getListData()).userList[0].name, 'Renamed Playlist')

  const protectedRename = await fetch(`${origin}/rest/updatePlaylist.view?u=admin&p=password&playlistId=love&name=Changed&f=json`)
  assert.equal((await protectedRename.json() as any)['subsonic-response'].error.code, 50)

  const playlistId = listData.userList[0].id
  const deleteResponse = await fetch(`${origin}/rest/deletePlaylist.view?u=admin&p=password&playlistId=${playlistId}&f=json`)
  assert.equal((await deleteResponse.json() as any)['subsonic-response'].status, 'ok')
  assert.equal((await getUserSpace('admin').listManage.getListData()).userList.length, 0)

  const protectedDelete = await fetch(`${origin}/rest/deletePlaylist.view?u=admin&p=password&playlistId=love&f=json`)
  assert.equal((await protectedDelete.json() as any)['subsonic-response'].error.code, 50)

  const missingName = await fetch(`${origin}/rest/createPlaylist.view?u=admin&p=password&f=json`, { method: 'POST' })
  assert.equal((await missingName.json() as any)['subsonic-response'].error.code, 10)

  await new Promise(resolve => setTimeout(resolve, 100))
})

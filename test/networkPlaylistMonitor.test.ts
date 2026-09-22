import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { networkPlaylistsAreEqual, parseNetworkPlaylistInterval } from '../src/server/networkPlaylistMonitorUtils'

test('network playlist monitor parses supported intervals and clamps short values', () => {
  assert.equal(parseNetworkPlaylistInterval('6h'), 6 * 60 * 60 * 1000)
  assert.equal(parseNetworkPlaylistInterval('30s'), 30 * 1000)
  assert.equal(parseNetworkPlaylistInterval('off'), 0)
  assert.equal(parseNetworkPlaylistInterval('invalid'), 6 * 60 * 60 * 1000)
})

test('network playlist monitor compares source and song ids in order', () => {
  const list = [{ source: 'tx', songmid: '1' }, { source: 'tx', songmid: '2' }]
  assert.equal(networkPlaylistsAreEqual(list, [{ source: 'tx', id: '1' }, { source: 'tx', id: '2' }]), true)
  assert.equal(networkPlaylistsAreEqual(list, [{ source: 'wy', songmid: '1' }, { source: 'tx', songmid: '2' }]), false)
  assert.equal(networkPlaylistsAreEqual(list, [...list].reverse()), false)
})

test('network playlist comparison understands saved meta and platform identifiers', () => {
  for (const source of ['tx', 'wy', 'kw', 'mg']) {
    const local = [{ source, id: `${source}_123`, meta: { songmid: '123', songId: '456' } }]
    assert.equal(networkPlaylistsAreEqual(local, [{ source, songmid: '123', songId: '456' }]), true, source)
  }
  const hash = 'AB'.repeat(16)
  assert.equal(networkPlaylistsAreEqual(
    [{ source: 'kg', id: `123_${hash}`, meta: { hash, songId: '123' } }],
    [{ source: 'kg', hash: hash.toLowerCase(), songmid: '123' }],
  ), true)
  assert.equal(networkPlaylistsAreEqual(
    [{ source: 'mg', id: 'unused', meta: { copyrightId: '600123' } }],
    [{ source: 'mg', copyrightId: '600123' }],
  ), true)
  assert.equal(networkPlaylistsAreEqual([{ source: 'wy', id: 'wy_123' }], [{ source: 'wy', id: 123 }]), true)
})

test('saved refresh survives restart and cannot be overwritten by an earlier background check', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yinyun-playlist-monitor-'))
  global.lx = {
    dataPath: root, userPath: path.join(root, 'users'), logPath: path.join(root, 'logs'),
    config: { users: [{ name: 'monitor', password: 'test' }], maxSnapshotNum: 3, 'list.addMusicLocationType': 'bottom' } as LX.Config,
    saveConfig: () => {},
  }
  fs.mkdirSync(global.lx.userPath, { recursive: true })
  const { getUserSpace, releaseUserSpace } = await import('../src/user')
  const { NetworkPlaylistMonitor } = await import('../src/server/networkPlaylistMonitor')
  const localSong = { source: 'wy', id: 'wy_123', name: 'Test', singer: 'Test', interval: '03:00', meta: { songmid: '123', songId: '123' } }
  const snapshot: any = { defaultList: [], loveList: [], userList: [
    { id: 'network', name: 'My name', source: 'wy', sourceListId: 'remote', locationUpdateTime: null, list: [localSong] },
  ] }
  let getDetail = async (): Promise<any> => ({ list: [{ source: 'wy', songmid: '456' }] })
  const deps = { getUsers: () => [], musicSdk: { wy: { songList: { getListDetail: () => getDetail() } } }, normalizeSongInfo: (s: any) => s }
  const monitor = new NetworkPlaylistMonitor(deps)
  try {
    await getUserSpace('monitor').listManage.listDataManage.restore(snapshot)
    await monitor.checkUser('monitor')
    assert.equal(monitor.getStatus('monitor')[0].changed, true)
    let release!: (result: any) => void
    let started!: () => void
    const entered = new Promise<void>(r => { started = r })
    getDetail = () => new Promise(r => { release = r; started() })
    const pending = monitor.checkUser('monitor')
    await entered
    await monitor.acknowledgeRefresh('monitor', 'network')
    release({ list: [{ source: 'wy', songmid: '456' }] })
    await pending
    assert.equal(monitor.getStatus('monitor')[0].changed, false)
    const restarted = new NetworkPlaylistMonitor(deps)
    assert.equal(restarted.getStatus('monitor')[0].changed, false)
    getDetail = async () => ({ list: [{ source: 'wy', songmid: '123' }] })
    await restarted.checkUser('monitor')
    assert.equal(restarted.getStatus('monitor')[0].changed, false)
    getDetail = async () => { throw new Error('Upstream unavailable') }
    await restarted.checkUser('monitor')
    assert.equal(restarted.getStatus('monitor')[0].changed, false)
    assert.match(restarted.getStatus('monitor')[0].error || '', /Upstream/)
    await restarted.acknowledgeRefresh('monitor', 'network')
    assert.equal(restarted.getStatus('monitor')[0].error, undefined)
    await assert.rejects(restarted.acknowledgeRefresh('monitor', 'missing'), /不存在/)
    getDetail = async () => ({ invalid: true })
    await restarted.checkUser('monitor')
    assert.match(restarted.getStatus('monitor')[0].error || '', /不完整/)
  } finally {
    monitor.stop()
    releaseUserSpace('monitor', true)
    await new Promise(resolve => setTimeout(resolve, 250))
    fs.rmSync(root, { recursive: true, force: true })
  }
})

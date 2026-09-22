import fs from 'node:fs'
import path from 'node:path'
import { File } from '@/constants'
import { getUserDirname, getUserSpace } from '@/user'
import { normalizeUsername } from '@/utils/username'
import { networkPlaylistsAreEqual, parseNetworkPlaylistInterval } from './networkPlaylistMonitorUtils'

type NetworkPlaylistStatus = {
  listId: string
  name: string
  source: string
  sourceListId: string
  changed: boolean
  checkedAt: number
  localCount: number
  remoteCount?: number
  error?: string
  lastSuccessAt?: number
  refreshedAt?: number
  comparisonVersion?: number
}

type MonitorDeps = {
  getUsers: () => Array<{ name: string }>
  musicSdk: any
  normalizeSongInfo: (value: any) => any
}

const getStatePath = (username: string) => path.join(
  global.lx.userPath,
  getUserDirname(username),
  File.userNetworkPlaylistCheckJSON,
)

const readState = (username: string): Record<string, NetworkPlaylistStatus> => {
  try {
    const value = JSON.parse(fs.readFileSync(getStatePath(username), 'utf8'))
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

const writeState = (username: string, state: Record<string, NetworkPlaylistStatus>) => {
  const filePath = getStatePath(username)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8')
}

const getUserSettings = (username: string): Record<string, any> => {
  try {
    const settingsPath = path.join(getUserSpace(username).dataManage.userDir, File.userSettingsJSON)
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    return settings && typeof settings === 'object' ? settings : {}
  } catch {
    return {}
  }
}

const getTargetLists = async (username: string) => {
  const data = await getUserSpace(username).listManage.getListData()
  return data.userList.filter(list => !!list?.source && !!list?.sourceListId)
}

export class NetworkPlaylistMonitor {
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly running = new Set<string>()

  constructor(private readonly deps: MonitorDeps) {}

  private stopTimer(username: string) {
    const timer = this.timers.get(username)
    if (timer) clearInterval(timer)
    this.timers.delete(username)
  }

  stop() {
    for (const username of this.timers.keys()) this.stopTimer(username)
  }

  reloadUser(username: string) {
    const normalized = normalizeUsername(username)
    this.stopTimer(normalized)
    const settings = getUserSettings(normalized)
    if (settings.autoUpdateNetworkList !== true) return
    const interval = parseNetworkPlaylistInterval(settings.networkListAutoCheckInterval)
    if (!interval) return
    const check = () => { void this.checkUser(normalized).catch(error => console.warn('[NetworkPlaylistMonitor] Check failed:', error)) }
    const timer = setInterval(check, interval)
    timer.unref?.()
    this.timers.set(normalized, timer)
    setTimeout(check, 1000).unref?.()
  }

  start() {
    this.stop()
    for (const user of this.deps.getUsers()) this.reloadUser(user.name)
  }

  async checkUser(username: string) {
    const normalized = normalizeUsername(username)
    if (this.running.has(normalized)) return this.getStatus(normalized)
    this.running.add(normalized)
    const state = readState(normalized)
    try {
      const lists = await getTargetLists(normalized)
      for (const list of lists) {
        const previous = state[list.id]
        const entry: NetworkPlaylistStatus = {
          listId: list.id,
          name: list.name,
          source: list.source!,
          sourceListId: list.sourceListId!,
          changed: previous?.changed === true,
          checkedAt: Date.now(),
          localCount: Array.isArray(list.list) ? list.list.length : 0,
          ...(previous?.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
          refreshedAt: previous?.refreshedAt,
          comparisonVersion: previous?.comparisonVersion,
        }
        try {
          const sdk = this.deps.musicSdk[list.source!]
          if (!sdk?.songList?.getListDetail) throw new Error(`Source ${list.source} does not support song list details`)
          const result = await sdk.songList.getListDetail(list.sourceListId, 1)
          if (!Array.isArray(result?.list)) throw new Error('远端歌单数据不完整')
          const remote = result.list.map((song: any) => this.deps.normalizeSongInfo({ ...song, source: song.source || list.source }))
          entry.remoteCount = remote.length
          entry.changed = !networkPlaylistsAreEqual(Array.isArray(list.list) ? list.list : [], remote)
          entry.comparisonVersion = 2
          entry.lastSuccessAt = entry.checkedAt
          delete entry.error
        } catch (error: any) {
          entry.error = error?.message || String(error)
          // Keep the previous changed state on a transient upstream failure.
          if (previous?.changed === true) entry.changed = true
          console.warn(`[NetworkPlaylistMonitor] ${normalized}/${list.id}: ${entry.error}`)
        }
        // A manual refresh may have completed while the upstream request was pending.
        const latest = readState(normalized)
        if (latest[list.id]?.refreshedAt !== previous?.refreshedAt) continue
        latest[list.id] = entry
        writeState(normalized, latest)
      }
      return this.getStatus(normalized)
    } finally {
      this.running.delete(normalized)
    }
  }

  getStatus(username: string) {
    // Old comparisons mixed prefixed IDs and raw IDs; do not restore false alarms.
    return Object.values(readState(normalizeUsername(username))).map(entry => ({
      ...entry, changed: entry.comparisonVersion === 2 && entry.changed,
    }))
  }

  async acknowledgeRefresh(username: string, listId: string) {
    const normalized = normalizeUsername(username)
    const list = (await getTargetLists(normalized)).find(item => item.id === listId)
    if (!list) throw new Error('待更新的网络歌单不存在')
    const state = readState(normalized)
    const now = Date.now()
    state[listId] = {
      listId, name: list.name, source: list.source!, sourceListId: list.sourceListId!,
      changed: false, checkedAt: now, lastSuccessAt: now, comparisonVersion: 2,
      refreshedAt: Math.max(now, (state[listId]?.refreshedAt || 0) + 1),
      localCount: list.list.length, remoteCount: list.list.length,
    }
    writeState(normalized, state)
  }

  async checkAndGetStatus(username: string) {
    await this.checkUser(username)
    return this.getStatus(username)
  }
}

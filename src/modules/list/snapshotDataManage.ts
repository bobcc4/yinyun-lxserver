import { throttle } from '@/utils/common'
import fs from 'node:fs'
import path from 'node:path'
import { syncLog } from '@/utils/log4js'
import { checkAndCreateDirSync } from '@/utils'
import { getUserConfig, type UserDataManage } from '@/user/data'
import { File } from '@/constants'

interface SnapshotInfo {
  latest: string | null
  time: number
  list: string[]
}
export class SnapshotDataManage {
  userDataManage: UserDataManage
  listDir: string
  snapshotDir: string
  snapshotInfoFilePath: string
  snapshotInfo: SnapshotInfo
  private readonly saveSnapshotInfoThrottle: () => void

  clearOldSnapshot = async () => {
    if (!this.snapshotInfo) return
    const snapshotList = [...this.snapshotInfo.list]
    // console.log(snapshotList.length, lx.config.maxSnapshotNum)
    const userMaxSnapshotNum = getUserConfig(this.userDataManage.userName).maxSnapshotNum
    let requiredSave = snapshotList.length > userMaxSnapshotNum
    while (snapshotList.length > userMaxSnapshotNum) {
      const name = snapshotList.pop()
      if (name) {
        await this.removeSnapshot(name)
        this.snapshotInfo.list.splice(this.snapshotInfo.list.indexOf(name), 1)
      } else break
    }
    if (requiredSave) this.saveSnapshotInfo(this.snapshotInfo)
  }

  getSnapshotInfo = async (): Promise<SnapshotInfo> => {
    return this.snapshotInfo
  }

  saveSnapshotInfo = (info: SnapshotInfo) => {
    this.snapshotInfo = info
    this.saveSnapshotInfoThrottle()
  }

  getSnapshot = async (name: string) => {
    const filePath = path.join(this.snapshotDir, `snapshot_${name}`)
    let listData: LX.Sync.List.ListData
    try {
      listData = JSON.parse((await fs.promises.readFile(filePath)).toString('utf-8'))
    } catch (err) {
      syncLog.warn(err)
      return null
    }
    return listData
  }

  saveSnapshot = async (name: string, data: string) => {
    syncLog.info('saveSnapshot', this.userDataManage.userName, name)
    const filePath = path.join(this.snapshotDir, `snapshot_${name}`)
    try {
      fs.writeFileSync(filePath, data)
    } catch (err) {
      syncLog.error(err)
      throw err
    }
  }

  saveSnapshotWithTime = async (name: string, data: string, time: number) => {
    syncLog.info('saveSnapshotWithTime', this.userDataManage.userName, name, time)
    const filePath = path.join(this.snapshotDir, `snapshot_${name}`)
    try {
      fs.writeFileSync(filePath, data)
      if (time) {
        const date = new Date(time)
        fs.utimesSync(filePath, date, date)
      }
    } catch (err) {
      syncLog.error(err)
      throw err
    }
  }

  removeSnapshot = async (name: string) => {
    syncLog.info('removeSnapshot', this.userDataManage.userName, name)
    const filePath = path.join(this.snapshotDir, `snapshot_${name}`)
    try {
      fs.unlinkSync(filePath)
    } catch (err) {
      syncLog.error(err)
    }
  }

  getSnapshotListWithMeta = async () => {
    const list = []
    try {
      const files = await fs.promises.readdir(this.snapshotDir)
      for (const file of files) {
        if (!file.startsWith('snapshot_')) continue
        const name = file.replace('snapshot_', '')
        const filePath = path.join(this.snapshotDir, file)
        try {
          const stat = await fs.promises.stat(filePath)
          list.push({
            id: name,
            time: stat.mtimeMs,
            size: stat.size,
          })
        } catch (e) {
          // ignore missing files
        }
      }
    } catch (err) {
      syncLog.error(err)
    }
    // Sort by time desc
    return list.sort((a, b) => b.time - a.time)
  }

  setLatest = (name: string) => {
    this.snapshotInfo.latest = name
    this.saveSnapshotInfoThrottle()
  }

  updateSnapshotDir = (configuredPath?: string) => {
    const configured = String(configuredPath ?? global.lx.config['snapshot.backupPath'] ?? '').trim()
    const target = configured
      ? path.join(path.isAbsolute(configured) ? configured : path.join(global.lx.dataPath, configured), this.userDataManage.userName, File.listSnapshotDir)
      : path.join(this.listDir, File.listSnapshotDir)
    checkAndCreateDirSync(target)
    if (path.resolve(target) !== path.resolve(this.snapshotDir) && fs.existsSync(this.snapshotDir)) {
      for (const name of fs.readdirSync(this.snapshotDir)) {
        const source = path.join(this.snapshotDir, name)
        const destination = path.join(target, name)
        if (!fs.existsSync(destination)) {
          try { fs.renameSync(source, destination) } catch {
            fs.copyFileSync(source, destination)
            fs.unlinkSync(source)
          }
        }
      }
    }
    this.snapshotDir = target
  }


  constructor(userDataManage: UserDataManage) {
    this.userDataManage = userDataManage

    this.listDir = path.join(userDataManage.userDir, File.listDir)
    checkAndCreateDirSync(this.listDir)

    this.snapshotDir = path.join(this.listDir, File.listSnapshotDir)
    checkAndCreateDirSync(this.snapshotDir)
    this.updateSnapshotDir()

    this.snapshotInfoFilePath = path.join(this.listDir, File.listSnapshotInfoJSON)
    this.snapshotInfo = fs.existsSync(this.snapshotInfoFilePath)
      ? JSON.parse(fs.readFileSync(this.snapshotInfoFilePath).toString())
      : { latest: null, time: 0, list: [] }

    this.saveSnapshotInfoThrottle = throttle(() => {
      fs.writeFile(this.snapshotInfoFilePath, JSON.stringify(this.snapshotInfo), 'utf8', (err) => {
        if (err) console.error(err)
        void this.clearOldSnapshot()
      })
    })

  }
}
// type UserDataManages = Map<string, UserDataManage>

// export const createUserDataManage = (user: LX.UserConfig) => {
//   const manage = Object.create(userDataManage) as typeof userDataManage
//   manage.userDir = user.dataPath
// }

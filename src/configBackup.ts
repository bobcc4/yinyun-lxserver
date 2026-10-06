import fs from 'node:fs'
import path from 'node:path'

let timer: NodeJS.Timeout | undefined
let lastBackupDate = ''

const getDirectory = () => {
  const configured = String(global.lx.config['configBackup.dir'] || '').trim()
  return configured
    ? (path.isAbsolute(configured) ? configured : path.join(global.lx.dataPath, configured))
    : path.join(global.lx.dataPath, 'backups')
}

export const runConfigBackup = () => {
  if (global.lx.config['configBackup.enable'] === false) return
  const source = global.lx.configPath
  if (!source || !fs.existsSync(source)) return
  const date = new Date().toISOString().slice(0, 10)
  const directory = getDirectory()
  try {
    fs.mkdirSync(directory, { recursive: true })
    if (lastBackupDate !== date) {
      fs.copyFileSync(source, path.join(directory, `config-${date}.js`))
      lastBackupDate = date
    }
    const retention = Math.max(1, Number(global.lx.config['configBackup.retentionDays']) || 7)
    const cutoff = Date.now() - retention * 24 * 60 * 60 * 1000
    for (const filename of fs.readdirSync(directory)) {
      if (!/^config-\d{4}-\d{2}-\d{2}\.js$/.test(filename)) continue
      const file = path.join(directory, filename)
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file)
    }
  } catch (error) {
    console.error('[ConfigBackup] Backup failed:', error)
  }
}

export const startConfigBackup = () => {
  if (timer) clearInterval(timer)
  runConfigBackup()
  timer = setInterval(runConfigBackup, 60 * 60 * 1000)
  timer.unref?.()
}

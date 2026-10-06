import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runConfigBackup } from '../src/configBackup'

test('automatic config backup writes the config under the data directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yinyun-config-backup-'))
  const configPath = path.join(root, 'config.js')
  const previousLx = global.lx
  fs.writeFileSync(configPath, 'module.exports = {}')
  global.lx = {
    configPath,
    dataPath: path.join(root, 'data'),
    config: { 'configBackup.enable': true, 'configBackup.retentionDays': 7 },
  } as any

  try {
    runConfigBackup()
    const files = fs.readdirSync(path.join(root, 'data', 'backups'))
    assert.equal(files.length, 1)
    assert.match(files[0], /^config-\d{4}-\d{2}-\d{2}\.js$/)
    assert.equal(fs.readFileSync(path.join(root, 'data', 'backups', files[0]), 'utf8'), 'module.exports = {}')
  } finally {
    global.lx = previousLx
    fs.rmSync(root, { recursive: true, force: true })
  }
})

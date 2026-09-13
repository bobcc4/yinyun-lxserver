#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import moduleAlias from 'module-alias'
// @ts-ignore
moduleAlias.addAliases({
  '@common': path.join(__dirname, 'common'),
  '@renderer': path.join(__dirname, 'modules'),
  '@': __dirname
})

if (typeof (global as any).navigator === 'undefined') {
  (global as any).navigator = { userAgent: 'node.js' }
}

import { initLogger, sanitizeLogText } from '@/utils/log4js'
import defaultConfig from './defaultConfig'
import { normalizePublicUrl } from './utils/publicUrl'
import { migrateLegacySubsonicSourcePriority } from './server/subsonicSearch'
import { ENV_PARAMS, File } from './constants'
import { checkAndCreateDirSync } from './utils'
import { normalizeUsername, validateUsername } from './utils/username'
import { normalizeAdminPath } from './adminPath'
import { withUserRole } from './userRoles'
import { resolveConfigPath } from './configPath'

// Declare Env Params Type
type ENV_PARAMS_Type = typeof ENV_PARAMS
type ENV_PARAMS_Value_Type = ENV_PARAMS_Type[number]

const formatEnvLogValue = (key: string, value: unknown) => {
  if (/PASSWORD|TOKEN|SECRET/i.test(key) || key.startsWith('LX_USER_')) return 'REDACTED'
  return sanitizeLogText(String(value))
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err)
})
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason)
})

let envParams: Partial<Record<Exclude<ENV_PARAMS_Value_Type, 'LX_USER_'>, string>> = {}
let envUsers: LX.User[] = []
const envParamKeys = Object.values(ENV_PARAMS).filter(v => v != 'LX_USER_')

{
  const envLog = [
    ...(envParamKeys.map(e => [e, process.env[e]]) as Array<[Exclude<ENV_PARAMS_Value_Type, 'LX_USER_'>, string]>).filter(([k, v]) => {
      if (!v) return false
      envParams[k] = v
      return true
    }),
    ...Object.entries(process.env)
      .filter(([k, v]) => {
        if (k.startsWith('LX_USER_') && !!v) {
          const name = k.replace('LX_USER_', '')
          if (name) {
            envUsers.push({
              name,
              password: v,
            })
            return true
          }
        }
        return false
      }),
  ].map(([e, v]) => `${e}: ${formatEnvLogValue(e, v)}`)
  if (envLog.length) console.log(`Load env: \n  ${envLog.join('\n  ')}`)
}

let lastConfigHash = ''
const getConfigHash = (filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return ''
    const content = fs.readFileSync(filePath)
    return crypto.createHash('md5').update(content).digest('hex')
  } catch {
    return ''
  }
}

const dataPath = envParams.DATA_PATH ?? path.join(__dirname, '../data')
const bundledConfigPath = path.join(__dirname, '../config.js')
let configPath = resolveConfigPath(dataPath, envParams.CONFIG_PATH)
const saveConfigToFile = () => {
  const content = `module.exports = ${JSON.stringify(global.lx.config, null, 2)}`
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, content)
    lastConfigHash = crypto.createHash('md5').update(content).digest('hex')
    // console.log('Current memory config saved to config.js')
  } catch (err) {
    console.error('Failed to save config.js:', err)
  }
}

global.lx = {
  logPath: envParams.LOG_PATH ?? path.join(__dirname, '../logs'),
  dataPath,
  userPath: path.join(dataPath, File.userDir),
  configPath,
  config: defaultConfig,
  staticPath: process.env.STATIC_PATH ?? path.join(process.cwd(), 'public'),
  saveConfig: saveConfigToFile,
}

const mergeConfigFileEnv = (config: Partial<Record<ENV_PARAMS_Value_Type, string>>) => {
  const envLog = []
  for (const [k, v] of Object.entries(config).filter(([k]) => k.startsWith('env.'))) {
    const envKey = k.replace('env.', '') as keyof typeof envParams
    let value = String(v)
    if (envParamKeys.includes(envKey)) {
      if (envParams[envKey] == null) {
        envLog.push(`${envKey}: ${formatEnvLogValue(envKey, value)}`)
        envParams[envKey] = value
      }
    } else if (envKey.startsWith('LX_USER_') && value) {
      const name = envKey.slice('LX_USER_'.length)
      if (name) {
        envUsers.push({
          name,
          password: value,
        })
        envLog.push(`${envKey}: ${formatEnvLogValue(envKey, value)}`)
      }
    }
  }
  if (envLog.length) console.log(`Load config file env:\n  ${envLog.join('\n  ')}`)
}

const margeConfig = (p: string) => {
  let config
  try {
    config = path.extname(p) == '.js'
      ? require(p)
      : JSON.parse(fs.readFileSync(p).toString()) as LX.Config
  } catch (err: any) {
    console.warn('Read config error: ' + (err.message as string))
    return false
  }
  const newConfig = { ...global.lx.config }
  for (const key of Object.keys(defaultConfig) as Array<keyof LX.Config>) {
    // @ts-expect-error
    if (config[key] !== undefined) newConfig[key] = config[key]
  }

  console.log('Load config: ' + p)
  if (newConfig.users.length) {
    const users: LX.UserConfig[] = []
    for (const user of newConfig.users) {
      users.push({
        ...withUserRole(user),
        dataPath: '',
      })
    }
    newConfig.users = users
  }
  if (['lxserver', 'yintuan'].includes(newConfig.serverName)) newConfig.serverName = 'yinyun'
  try {
    newConfig['admin.path'] = normalizeAdminPath(newConfig['admin.path'])
  } catch (error: any) {
    console.warn(`Invalid admin.path, using /admin: ${error.message}`)
    newConfig['admin.path'] = '/admin'
  }
  try {
    newConfig['server.publicUrl'] = normalizePublicUrl(newConfig['server.publicUrl'])
  } catch (error: any) {
    console.warn(`Invalid server.publicUrl, disabled: ${error.message}`)
    newConfig['server.publicUrl'] = ''
  }
  newConfig['subsonic.onlineSearchSources'] = migrateLegacySubsonicSourcePriority(newConfig['subsonic.onlineSearchSources']) as string
  global.lx.config = newConfig

  mergeConfigFileEnv(config)
  return true
}

//加载环境变量
fs.existsSync(bundledConfigPath) && margeConfig(bundledConfigPath)
configPath = resolveConfigPath(dataPath, envParams.CONFIG_PATH)
global.lx.configPath = configPath
if (path.resolve(configPath) !== path.resolve(bundledConfigPath) && fs.existsSync(configPath)) {
  margeConfig(configPath)
}
if (envParams.PROXY_HEADER) {
  global.lx.config['proxy.enabled'] = true
  global.lx.config['proxy.header'] = envParams.PROXY_HEADER
}
if (envParams.MAX_SNAPSHOT_NUM) {
  const num = parseInt(envParams.MAX_SNAPSHOT_NUM)
  if (!isNaN(num)) global.lx.config.maxSnapshotNum = num
}
if (envParams.LIST_ADD_MUSIC_LOCATION_TYPE) {
  switch (envParams.LIST_ADD_MUSIC_LOCATION_TYPE) {
    case 'top':
    case 'bottom':
      global.lx.config['list.addMusicLocationType'] = envParams.LIST_ADD_MUSIC_LOCATION_TYPE
      break
  }
}
if (envParams.FRONTEND_PASSWORD) {
  global.lx.config['frontend.password'] = envParams.FRONTEND_PASSWORD
}
if (envParams.ADMIN_PATH) {
  try {
    global.lx.config['admin.path'] = normalizeAdminPath(envParams.ADMIN_PATH)
  } catch (error: any) {
    console.warn(`Invalid ADMIN_PATH, using /admin: ${error.message}`)
    global.lx.config['admin.path'] = '/admin'
  }
}
if (envParams.PUBLIC_URL) {
  try {
    global.lx.config['server.publicUrl'] = normalizePublicUrl(envParams.PUBLIC_URL)
  } catch (error: any) {
    console.warn(`Invalid PUBLIC_URL, disabled: ${error.message}`)
    global.lx.config['server.publicUrl'] = ''
  }
}
if (envParams.WEBDAV_ENABLE) {
  global.lx.config['webdav.enable'] = envParams.WEBDAV_ENABLE === 'true'
}
if (envParams.WEBDAV_URL) {
  global.lx.config['webdav.url'] = envParams.WEBDAV_URL
}
if (envParams.WEBDAV_USERNAME) {
  global.lx.config['webdav.username'] = envParams.WEBDAV_USERNAME
}
if (envParams.WEBDAV_PASSWORD) {
  global.lx.config['webdav.password'] = envParams.WEBDAV_PASSWORD
}
if (envParams.WEBDAV_SYNC_PATH) {
  global.lx.config['webdav.syncPath'] = envParams.WEBDAV_SYNC_PATH
}
if (envParams.WEBDAV_BACKUP_PATH) {
  global.lx.config['webdav.backupPath'] = envParams.WEBDAV_BACKUP_PATH
}
if (envParams.SYNC_INTERVAL) {
  const interval = parseInt(envParams.SYNC_INTERVAL)
  if (!isNaN(interval)) global.lx.config['sync.interval'] = interval
}
if (envParams.BACKUP_INTERVAL) {
  const backupInterval = parseInt(envParams.BACKUP_INTERVAL)
  if (!isNaN(backupInterval)) global.lx.config['sync.backupInterval'] = backupInterval
}
if (envParams.PORT) {
  const port = parseInt(envParams.PORT, 10)
  if (!isNaN(port) && port > 0) global.lx.config.port = port
}
if (envParams.BIND_IP) {
  global.lx.config.bindIP = envParams.BIND_IP
}
if (envParams.DISABLE_TELEMETRY) {
  global.lx.config.disableTelemetry = envParams.DISABLE_TELEMETRY === 'true'
}
if (envParams.ENABLE_LOGIN_USER_CACHE_RESTRICTION) {
  global.lx.config['user.enableLoginCacheRestriction'] = envParams.ENABLE_LOGIN_USER_CACHE_RESTRICTION === 'true'
}
if (envParams.ENABLE_CACHE_SIZE_LIMIT) {
  global.lx.config['user.enableCacheSizeLimit'] = envParams.ENABLE_CACHE_SIZE_LIMIT === 'true'
}
if (envParams.CACHE_SIZE_LIMIT) {
  global.lx.config['user.cacheSizeLimit'] = parseInt(envParams.CACHE_SIZE_LIMIT) || 2000
}
if (envParams.PROXY_ALL_ENABLED) {
  global.lx.config['proxy.all.enabled'] = envParams.PROXY_ALL_ENABLED === 'true'
}
if (envParams.PROXY_ALL_ADDRESS) {
  global.lx.config['proxy.all.address'] = envParams.PROXY_ALL_ADDRESS
}
if (envParams.SUBSONIC_ENABLE !== undefined) {
  global.lx.config['subsonic.enable'] = envParams.SUBSONIC_ENABLE === 'true'
}
if (envParams.SUBSONIC_PATH !== undefined) {
  global.lx.config['subsonic.path'] = envParams.SUBSONIC_PATH
}
if (envParams.SINGER_SOURCE_PRIORITY !== undefined) {
  const priority = envParams.SINGER_SOURCE_PRIORITY.split(',').filter(s => s === 'tx' || s === 'wy') as Array<'tx' | 'wy'>
  if (priority.length > 0) global.lx.config['singer.sourcePriority'] = priority
}
if (envParams.SERVER_NAME) {
  global.lx.config.serverName = envParams.SERVER_NAME
}

if (envUsers.length) {
  const users: LX.Config['users'] = []
  let u
  for (let user of envUsers) {
    let isLikeJSON = true
    try {
      u = JSON.parse(user.password) as Omit<LX.User, 'name'>
    } catch {
      isLikeJSON = false
    }
    if (isLikeJSON && typeof u == 'object') {
      users.push({
        name: user.name,
        ...u,
        dataPath: '',
      })
    } else {
      users.push({
        name: user.name,
        password: user.password,
        dataPath: '',
      })
    }
  }
  global.lx.config.users = users
}

const exit = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const checkAndCreateDir = (path: string) => {
  try {
    checkAndCreateDirSync(path)
  } catch (e: any) {
    if (e.code !== 'EEXIST') {
      exit(`Could not set up log directory, error was: ${e.message as string}`)
    }
  }
}

const validateUserConfig = (users: LX.Config['users']) => {
  const userNames = new Set<string>()
  const normalizedUsers: LX.Config['users'] = []
  const renames: Array<{ oldName: string; newName: string }> = []

  for (const user of users) {
    let oldName: string
    let name: string
    try {
      oldName = validateUsername(user.name)
      name = normalizeUsername(user.name)
    } catch {
      throw new Error('Invalid user name: ' + String(user.name || ''))
    }
    if (userNames.has(name)) throw new Error('User name duplicate: ' + name)
    userNames.add(name)
    normalizedUsers.push(withUserRole({ ...user, name }))
    if (oldName !== name) renames.push({ oldName, newName: name })
  }
  return { users: normalizedUsers, renames }
}

const checkUserConfig = (users: LX.Config['users']): ReturnType<typeof validateUserConfig> => {
  try {
    return validateUserConfig(users)
  } catch (error: any) {
    return exit(error.message as string)
  }
}

checkAndCreateDir(global.lx.logPath)
checkAndCreateDir(global.lx.dataPath)
checkAndCreateDir(global.lx.userPath)
initLogger()

// Load users from users.json if exists
const usersJsonPath = path.join(global.lx.dataPath, 'users.json')
if (fs.existsSync(usersJsonPath)) {
  try {
    const users = JSON.parse(fs.readFileSync(usersJsonPath, 'utf-8'))
    if (Array.isArray(users)) {
      console.log('Load users from users.json')
      global.lx.config.users = users.map(u => ({ ...withUserRole(u), dataPath: '' }))
    }
  } catch (err) {
    console.error('Failed to load users.json', err)
  }
}

const preparedUsers = checkUserConfig(global.lx.config.users)
global.lx.config.users = preparedUsers.users

console.log(`Configured users (${global.lx.config.users.length}): ${global.lx.config.users.map(user => user.name).join(', ') || 'none'}`)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getUserDirname, migrateUserData } = require('@/user')
for (const rename of preparedUsers.renames) {
  migrateUserData(rename.oldName, rename.newName)
}
for (const user of global.lx.config.users) {
  const dataPath = path.join(global.lx.userPath, getUserDirname(user.name))
  checkAndCreateDir(dataPath)
  user.dataPath = dataPath
}

try {
  fs.writeFileSync(usersJsonPath, JSON.stringify(global.lx.config.users.map(u => ({
    name: u.name,
    password: u.password,
    isAdmin: u.isAdmin === true,
    maxSnapshotNum: u.maxSnapshotNum,
    'list.addMusicLocationType': u['list.addMusicLocationType'],
  })), null, 2))
} catch (err) {
  console.error('Failed to save users.json', err)
}

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val: string) {
  const port = parseInt(val, 10)

  if (isNaN(port) || port < 1) {
    // named pipe
    exit(`port illegal: ${val}`)
  }
  return port
}

/**
 * Get port from environment and store in Express.
 */

// const port = normalizePort(envParams.PORT ?? '9527')
// const bindIP = envParams.BIND_IP ?? '127.0.0.1'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createModuleEvent } = require('@/event')
createModuleEvent()

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startServer, reloadServerData } = require('@/server')

// 初始化 WebDAV 同步
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebDAVSync = require('@/utils/webdavSync').default
const webdavSync = new WebDAVSync({
  enable: global.lx.config['webdav.enable'],
  url: global.lx.config['webdav.url'],
  username: global.lx.config['webdav.username'],
  password: global.lx.config['webdav.password'],
  syncPath: global.lx.config['webdav.syncPath'],
  backupPath: global.lx.config['webdav.backupPath'],
  interval: global.lx.config['sync.interval'],
  backupInterval: global.lx.config['sync.backupInterval'],
}, global.lx.dataPath)

// 如果配置了 WebDAV，在启动时尝试从远程恢复
if (webdavSync.isConfigured()) {
  console.log('WebDAV configured, attempting to restore from remote...')
  void webdavSync.restoreFromRemote().then(async (success: boolean) => {
    if (success) {
      console.log('Data restored from WebDAV successfully')
      await reloadServerData()
    }
    // 启动自动同步
    webdavSync.startAutoSync()
  })
} else {
  console.log('WebDAV not configured, skipping remote restore')
}

// 导出 webdavSync 实例供 API 使用
global.lx.webdavSync = webdavSync

// 启动前最后保存一次合并后的配置，确保环境变量被固化到 config.js 中
saveConfigToFile()

startServer(global.lx.config.port, global.lx.config.bindIP)

// 监控 config.js 变动以实现热重载 (由于 nodemon 已忽略该文件)
const rootConfigPath = global.lx.configPath
if (fs.existsSync(rootConfigPath)) {
  lastConfigHash = getConfigHash(rootConfigPath)
  let debounceTimer: NodeJS.Timeout | null = null
  fs.watch(rootConfigPath, (event) => {
    if (event === 'change') {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const currentHash = getConfigHash(rootConfigPath)
        // 如果内容未发生实质改变（如内部写配置触发的 fs.watch 事件），跳过热重载
        if (currentHash && currentHash === lastConfigHash) return
        lastConfigHash = currentHash

        console.log('Detected external config.js change, hot-reloading...')
        try {
          delete require.cache[require.resolve(rootConfigPath)]
          margeConfig(rootConfigPath)
          // 重新初始化各模块以使用新配置（如果需要）
          if (global.lx.webdavSync) {
            global.lx.webdavSync.updateConfig({
              url: global.lx.config['webdav.url'],
              username: global.lx.config['webdav.username'],
              password: global.lx.config['webdav.password'],
              syncPath: global.lx.config['webdav.syncPath'],
              backupPath: global.lx.config['webdav.backupPath'],
              interval: global.lx.config['sync.interval'],
              backupInterval: global.lx.config['sync.backupInterval'],
            })
          }
        } catch (e) {
          console.error('Hot-reload config.js failed:', e)
        }
      }, 500)
    }
  })
}

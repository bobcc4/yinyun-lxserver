import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { normalizeUsername } from '@/utils/username'

export const EXTERNAL_LOCATION_PREFIX = 'external:'
const EXTERNAL_CONFIG_FILE = 'externalLibraries.json'
const EXTERNAL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export interface ExternalMusicLibrary {
  id: string
  username: string
  name: string
  enabled: boolean
  createdAt: number
}

export interface ExternalMusicLibraryCandidate {
  username: string
  name: string
  mounted: boolean
  registered: boolean
  containerPath: string
  hostPath: string
  libraryId?: string
}

const getDataPath = () => String((global as any).lx?.dataPath || path.join(process.cwd(), 'data'))
const getConfigPath = () => path.join(getDataPath(), EXTERNAL_CONFIG_FILE)
const getExternalRoot = () => path.join(process.cwd(), 'external')

const readLibraries = (): ExternalMusicLibrary[] => {
  try {
    const value = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'))
    if (!Array.isArray(value)) return []
    return value.filter(isValidLibrary).map(item => ({
      id: item.id,
      username: item.username,
      name: item.name,
      enabled: item.enabled !== false,
      createdAt: Number(item.createdAt) || 0,
    }))
  } catch (error: any) {
    if (error?.code !== 'ENOENT') console.error('[ExternalMusic] Failed to read configuration:', error?.message || error)
    return []
  }
}

const writeLibraries = (libraries: ExternalMusicLibrary[]) => {
  fs.mkdirSync(getDataPath(), { recursive: true })
  const target = getConfigPath()
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(libraries, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, target)
}

const isValidLibrary = (value: any): value is ExternalMusicLibrary => (
  value && typeof value.id === 'string' && /^[a-z0-9_-]{8,100}$/i.test(value.id) &&
  typeof value.username === 'string' && typeof value.name === 'string' &&
  EXTERNAL_NAME_PATTERN.test(value.name)
)

const userExists = (username: string) => (
  Array.isArray((global as any).lx?.config?.users) &&
  (global as any).lx.config.users.some((user: any) => user.name === username)
)

const makeId = (username: string, name: string) => `external_${crypto.createHash('sha256').update(`${username}\0${name}`).digest('hex').slice(0, 24)}`

export const normalizeExternalLibraryName = (value: unknown) => {
  const name = String(value || '').trim()
  if (!EXTERNAL_NAME_PATTERN.test(name)) {
    throw new Error('库名称只能包含字母、数字、点、下划线和短横线，长度为 1-64 个字符')
  }
  return name
}

export const listExternalMusicLibraries = (username?: string): ExternalMusicLibrary[] => {
  const normalized = username ? normalizeUsername(username) : ''
  return readLibraries().filter(item => item.enabled && (!normalized || item.username === normalized))
}

export const listAllExternalMusicLibraries = (): ExternalMusicLibrary[] => readLibraries()

export const getExternalMusicLibrary = (id: string, username?: string) => {
  const library = readLibraries().find(item => item.id === id && item.enabled)
  if (!library) return null
  if (username && library.username !== normalizeUsername(username)) return null
  return library
}

export const getExternalLocation = (library: ExternalMusicLibrary): string => `${EXTERNAL_LOCATION_PREFIX}${library.id}`

export const getExternalLibraryByLocation = (location: string, username?: string) => {
  if (!location.startsWith(EXTERNAL_LOCATION_PREFIX)) return null
  const id = location.slice(EXTERNAL_LOCATION_PREFIX.length)
  if (!/^[a-z0-9_-]{8,100}$/i.test(id)) return null
  return getExternalMusicLibrary(id, username)
}

export const getExternalMusicPath = (library: ExternalMusicLibrary) => path.join(getExternalRoot(), library.username, library.name)

export const getExternalIndexPath = (library: ExternalMusicLibrary, folder: 'cache' | 'music') => {
  const indexDir = path.join(getDataPath(), 'external-index', library.username, library.id)
  fs.mkdirSync(indexDir, { recursive: true })
  return path.join(indexDir, folder === 'music' ? 'music_index.json' : 'cache_index.json')
}

export const createExternalMusicLibrary = (usernameValue: unknown, nameValue: unknown): ExternalMusicLibrary => {
  const username = normalizeUsername(usernameValue)
  const name = normalizeExternalLibraryName(nameValue)
  if (!userExists(username)) throw new Error('用户不存在')

  const libraries = readLibraries()
  const existing = libraries.find(item => item.username === username && item.name.toLowerCase() === name.toLowerCase())
  if (existing) return existing

  const library: ExternalMusicLibrary = {
    id: makeId(username, name),
    username,
    name,
    enabled: true,
    createdAt: Date.now(),
  }
  libraries.push(library)
  writeLibraries(libraries)
  return library
}

export const removeExternalMusicLibrary = (id: string): ExternalMusicLibrary | null => {
  const libraries = readLibraries()
  const library = libraries.find(item => item.id === id)
  if (!library) return null
  writeLibraries(libraries.filter(item => item.id !== id))
  const indexDir = path.join(getDataPath(), 'external-index', library.username, library.id)
  fs.rmSync(indexDir, { recursive: true, force: true })
  return library
}

export const getExternalLibraryContainerPath = (library: ExternalMusicLibrary) => `/server/external/${library.username}/${library.name}`

export const getExternalLibraryInfo = (library: ExternalMusicLibrary) => ({
  ...library,
  location: getExternalLocation(library),
  containerPath: getExternalLibraryContainerPath(library),
  hostPath: getExternalMusicPath(library),
})

/**
 * Discover directories that are already mounted below /server/external.
 * Discovery is intentionally read-only; registration still requires an
 * explicit administrator action.
 */
export const discoverExternalMusicLibraries = (): ExternalMusicLibraryCandidate[] => {
  const root = getExternalRoot()
  if (!fs.existsSync(root)) return []

  const libraries = readLibraries()
  const registeredByKey = new Map(
    libraries.map(library => [`${library.username}\0${library.name.toLowerCase()}`, library]),
  )
  const candidates: ExternalMusicLibraryCandidate[] = []

  let userEntries: fs.Dirent[]
  try {
    userEntries = fs.readdirSync(root, { withFileTypes: true })
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error?.code === 'EACCES') return []
    throw error
  }

  for (const userEntry of userEntries) {
    if (!userEntry.isDirectory()) continue
    let username: string
    try {
      username = normalizeUsername(userEntry.name)
    } catch {
      continue
    }
    if (!userExists(username)) continue

    const userRoot = path.join(root, username)
    let libraryEntries: fs.Dirent[]
    try {
      libraryEntries = fs.readdirSync(userRoot, { withFileTypes: true })
    } catch {
      continue
    }

    for (const libraryEntry of libraryEntries) {
      if (!libraryEntry.isDirectory() || !EXTERNAL_NAME_PATTERN.test(libraryEntry.name)) continue
      const name = libraryEntry.name
      const key = `${username}\0${name.toLowerCase()}`
      const registered = registeredByKey.get(key)
      candidates.push({
        username,
        name,
        mounted: true,
        registered: !!registered,
        containerPath: `/server/external/${username}/${name}`,
        hostPath: path.join(userRoot, name),
        ...(registered ? { libraryId: registered.id } : {}),
      })
    }
  }

  return candidates.sort((a, b) => `${a.username}/${a.name}`.localeCompare(`${b.username}/${b.name}`))
}

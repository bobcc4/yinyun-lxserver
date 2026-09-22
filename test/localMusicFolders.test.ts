import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = fs.readFileSync('public/music/js/local_music.js', 'utf8')
function harness() {
  const storage = new Map([['lx_sync_user', 'test']])
  const context = vm.createContext({
    window: { location: { origin: 'http://localhost' } },
    localStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) },
    document: { getElementById: () => null },
    setTimeout: () => 0, console,
    fetch: () => assert.fail('Folder filtering must not make a write request'),
  })
  vm.runInContext(source, context)
  const manager = context.window.LocalMusicManager
  manager.render = () => {}
  manager.updateBatchUI = () => {}
  return { manager, storage }
}
const songs = [
  { filename: 'a.flac', subPath: '', folder: 'music', name: 'A', quality: 'flac', source: 'tx' },
  { filename: 'artist/b.flac', subPath: 'artist', folder: 'music', name: 'B', quality: 'flac', source: 'tx' },
  { filename: 'artist/album/c.mp3', subPath: 'artist/album', folder: 'music', name: 'C', quality: '128k', source: 'tx' },
  { filename: 'd.flac', subPath: '', folder: 'cache', name: 'D', quality: 'flac', source: 'tx' },
]

for (const savedPath of ['__ROOT__', 'artist', 'artist/album']) {
  test('legacy folder filter is removed without losing other preferences: ' + savedPath, () => {
    const { manager, storage } = harness()
    const key = manager.getFilterStorageKey()
    storage.set(key, JSON.stringify({ selectedSubPath: savedPath, filterFolder: 'music', sortBy: 'name', sortOrder: 'asc', filterQuality: ['flac'] }))
    manager.loadFilters()
    assert.equal('selectedSubPath' in JSON.parse(storage.get(key)!), false)
    assert.equal(manager.filterFolder, 'music')
    assert.equal(manager.sortBy, 'name')
    assert.equal(manager.filterQuality.has('flac'), true)
    manager.originalData = songs
    manager.applyFilters()
    assert.deepEqual(Array.from(manager.displayData, (s: any) => s.name), ['A', 'B'])
    manager.filterQuality.clear()
    manager.applyFilters()
    assert.deepEqual(Array.from(manager.displayData, (s: any) => s.name), ['A', 'B', 'C'])
    manager.filterFolder = 'all'
    manager.applyFilters()
    assert.equal(manager.displayData.length, 4)
    manager.filterFolder = 'cache'
    manager.applyFilters()
    assert.deepEqual(Array.from(manager.displayData, (s: any) => s.name), ['D'])
    assert.equal('selectedSubPath' in JSON.parse(storage.get(key)!), false)
  })
}

test('external library isolation remains intact and folder management is removed', () => {
  const { manager } = harness()
  manager.originalData = [...songs, { ...songs[0], storageLocation: 'external:one' }]
  manager.externalOnly = true
  manager.applyFilters()
  assert.equal(manager.displayData.length, 1)
  assert.equal(manager.displayData[0].storageLocation, 'external:one')
  for (const method of ['changeLocation', 'batchSwitchBaseLocation', 'batchCategorize', 'createSubFolder', 'selectSubPath']) {
    assert.equal(manager[method], undefined)
  }
  assert.equal(typeof manager.batchSwitchFolder, 'function')
})

test('folder classification and storage switching are removed from the player and server', () => {
  const html = fs.readFileSync('public/music/index.html', 'utf8')
  assert.doesNotMatch(html, /id="lm-subpath-(?:btn|text)"/)
  assert.doesNotMatch(html, /id="(?:lm-location-select|lm-storage-controls|lm-batch-categorize-btn|setting-server-cache-location|subpath-select-modal|new-subfolder-input)"/)
  assert.match(html, /id="lm-folder-select"/)
  assert.match(html, /id="setting-server-cache-naming"/)
  const server = fs.readFileSync('src/server/server.ts', 'utf8')
  assert.doesNotMatch(server, /pathname === '\/api\/v1\/player\/music\/cache\/(?:switch-base|subdirs|mkdir|categorize)'/)
  assert.doesNotMatch(server, /fileCache\.setCacheLocation/)
})

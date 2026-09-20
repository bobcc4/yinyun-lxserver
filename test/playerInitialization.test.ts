import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const app = fs.readFileSync('public/music/app.js', 'utf8')
const sound = fs.readFileSync('public/music/js/sound-effects.js', 'utf8')
function declaration(source: string, name: string) {
  const ast = ts.createSourceFile('player.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let result = ''
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast)
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === name) result = node.getText(ast).replace(/^async /, 'async function ')
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === name)) result = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(result, 'Missing declaration: ' + name)
  return result
}

for (const readyState of ['loading', 'interactive']) {
  test('authentication waits for settings initialization: ' + readyState, async () => {
    let ready = () => {}
    let verified = 0
    let synced = 0
    const errors: unknown[] = []
    const context = vm.createContext({
      document: { readyState, addEventListener: (_: string, cb: () => void) => { ready = cb } },
      window: {}, userToken: 'saved-token',
      fetch: async () => { verified++; return { json: async () => ({ valid: true }) } },
      isUserLoggedIn: () => true, updateUserUI: () => {},
      loadPlaylistSharingSetting: async () => {}, startPlaylistSharePolling: () => {},
      console: { error: (...args: unknown[]) => errors.push(args), warn: () => {} },
      onSync: () => { synced++ },
    })
    vm.runInContext(declaration(app, 'initialUserAuthReady') + '\n' +
      'function syncSettingsUI() { Object.keys(SETTINGS_UI_MAP); onSync(); }\n' +
      'const SETTINGS_UI_MAP = {};', context)
    ready()
    await vm.runInContext('initialUserAuthReady', context)
    assert.equal(synced, 1)
    assert.equal(verified, 1)
    assert.deepEqual(errors, [])
  })
}

function statsHarness() {
  const storage = new Map([['lx_sync_user', 'admin'], ['lx_user_token', 'old']])
  const elements: Record<string, { textContent: string }> = {
    'server-cache-info': { textContent: '' }, 'server-music-info': { textContent: '' },
  }
  const warnings: unknown[] = []
  const context = vm.createContext({
    initialUserAuthReady: Promise.resolve(), userToken: 'old',
    document: { getElementById: (id: string) => elements[id] },
    localStorage: { getItem: (key: string) => storage.get(key) || '' },
    normalizeSyncUsername: (name: string) => name.trim().toLowerCase(),
    isUserLoggedIn: () => !!storage.get('lx_sync_user') && !!storage.get('lx_user_token'),
    getUserAuthHeaders: () => ({ 'x-user-token': storage.get('lx_user_token') }),
    console: { warn: (...args: unknown[]) => warnings.push(args) },
  })
  vm.runInContext(declaration(app, 'cacheStatsRequests') + '\n' + declaration(app, 'updateServerCacheSize'), context)
  return { context, storage, elements, warnings, run: () => vm.runInContext('updateServerCacheSize()', context) }
}
const statsResponse = { ok: true, status: 200, json: async () => ({ success: true, data: {
  cache: { totalSize: 1024, fileCount: 1 }, music: { totalSize: 2048, fileCount: 2 },
} }) }

for (const name of ['loadNetworkListStatusesV162', 'fetchCustomSources', 'requestServerQueue']) {
  test(name + ' waits for restored authentication before sending a request', async () => {
    let release!: () => void
    const ready = new Promise<void>(resolve => { release = resolve })
    let requests = 0
    let token = 'expired'
    const context = vm.createContext({
      initialUserAuthReady: ready,
      isUserLoggedIn: () => true,
      localStorage: { getItem: (key: string) => key === 'lx_sync_user' ? 'admin' : '' },
      getUserAuthHeaders: () => ({ token }),
      getServerQueueHeaders: () => ({ token }),
      canUseServerQueue: () => true,
      applyNetworkListStatusesV162: () => {}, console,
      fetch: async (_: string, options: any) => {
        requests++
        assert.equal(options.headers.token, 'renewed')
        return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }
      },
    })
    context.window = context
    const source = name === 'requestServerQueue' ? fs.readFileSync('public/music/js/download_manager.js', 'utf8') : app
    vm.runInContext(declaration(app, 'waitForUserAuthReady') + '\n' + declaration(source, name), context)
    const pending = vm.runInContext(name + "('/queue')", context)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests, 0)
    token = 'renewed'
    release()
    await pending
    assert.equal(requests, 1)
  })
}

test('guest cache statistics do not send an unauthorized request', async () => {
  const h = statsHarness()
  h.storage.clear()
  h.context.fetch = () => assert.fail('Guest request')
  await h.run()
  assert.equal(h.elements['server-cache-info'].textContent, '请先登录同步账户')
  assert.equal(h.warnings.length, 0)
})

test('concurrent statistics refreshes share a request and retry 401 with a new token', async () => {
  const h = statsHarness()
  const tokens: string[] = []
  let refreshes = 0
  h.context.ensureUserAuthToken = async () => {
    refreshes++
    h.storage.set('lx_user_token', 'renewed')
    return true
  }
  h.context.fetch = async (_: string, options: any) => {
    tokens.push(options.headers['x-user-token'])
    return tokens.length === 1 ? { status: 401, ok: false } : statsResponse
  }
  await Promise.all([h.run(), h.run(), h.run()])
  assert.deepEqual(tokens, ['old', 'renewed'])
  assert.equal(refreshes, 1)
  assert.match(h.elements['server-music-info'].textContent, /2\.00 KB/)
  assert.equal(h.warnings.length, 0)
})

test('a late response cannot display the previous account statistics', async () => {
  const h = statsHarness()
  h.context.fetch = async () => { h.storage.set('lx_sync_user', 'other'); return statsResponse }
  await h.run()
  assert.doesNotMatch(h.elements['server-music-info'].textContent, /2\.00 KB/)
})

test('server errors retain an HTTP diagnostic and allow a later refresh', async () => {
  const h = statsHarness()
  h.context.fetch = async () => ({ status: 500, ok: false })
  await h.run()
  assert.match(String(h.warnings[0]), /HTTP 500/)
  h.context.fetch = async () => statsResponse
  await h.run()
  assert.match(h.elements['server-cache-info'].textContent, /1\.00 KB/)
})

function pitchHarness(worklet?: object) {
  const errors: unknown[] = []
  let renders = 0
  const context = vm.createContext({
    audioContext: { audioWorklet: worklet },
    pitchShifterNode: undefined, pitchFactorParam: undefined,
    pitchShifterLoading: false, pitchShifterUnavailable: false,
    settings: { pitch: 1 }, applyPitch: () => {}, connectPitchShifter: () => {},
    disconnectPitchShifter: () => {}, renderUI: () => { renders++ },
    console: { log: () => {}, error: (...args: unknown[]) => errors.push(args) },
  })
  vm.runInContext(declaration(sound, 'initPitchShifter'), context)
  return { context, errors, renders: () => renders, run: () => vm.runInContext('initPitchShifter()', context) }
}

test('HTTP browsers without AudioWorklet disable pitch without an exception', async () => {
  const h = pitchHarness()
  await h.run()
  await h.run()
  assert.equal(h.context.pitchShifterUnavailable, true)
  assert.equal(h.renders(), 1)
  assert.deepEqual(h.errors, [])
})

test('supported pitch initialization loads one worklet for concurrent requests', async () => {
  let loads = 0
  const h = pitchHarness({ addModule: async () => { loads++ } })
  h.context.AudioWorkletNode = class { parameters = new Map([['pitchFactor', {}]]) }
  await Promise.all([h.run(), h.run()])
  assert.equal(loads, 1)
  assert.ok(h.context.pitchShifterNode)
  assert.deepEqual(h.errors, [])
})

test('worklet load failure disables pitch and is not repeatedly retried', async () => {
  let loads = 0
  const h = pitchHarness({ addModule: async () => { loads++; throw new Error('404') } })
  h.context.AudioWorkletNode = class {}
  await h.run()
  await h.run()
  assert.equal(loads, 1)
  assert.equal(h.errors.length, 1)
  assert.equal(h.context.pitchShifterUnavailable, true)
})

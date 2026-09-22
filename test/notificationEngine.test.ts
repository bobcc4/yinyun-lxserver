import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const source = fs.readFileSync('public/js/notification-engine.js', 'utf8')
const ast = ts.createSourceFile('notification.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const declarations = new Map<string, string>()
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(ast))
  if (ts.isVariableStatement(node)) {
    for (const d of node.declarationList.declarations) declarations.set(d.name.getText(ast), node.getText(ast))
  }
  ts.forEachChild(node, visit)
}
visit(ast)
const selected = ['RELEASE_CACHE_KEY', 'RELEASE_CACHE_TTL', 'releaseCheckState', 'releaseRequest',
  'validRelease', 'readReleaseCheckState', 'saveReleaseCheckState', 'releaseCheckError',
  'loadLatestRelease', 'fetchLatestRelease', 'checkUpdates']

function harness(storage = new Map<string, string>()) {
  let now = 1800000000000
  let requests = 0
  let responder: (options: any) => Promise<Response> = async () => response(200, { tag_name: 'v1.7.3' })
  const indicators: string[] = []
  const modals: any[] = []
  const items: any[] = []
  const warnings: any[] = []
  const window = { CONFIG: { disableTelemetry: false } }
  const context = vm.createContext({
    CONFIG: { LATEST_RELEASE_URL: 'https://api.github.com/repos/bobcc4/yinyun-lxserver/releases/latest', getLocalVersion: () => '1.7.2' },
    Date: class extends Date { static now() { return now } },
    localStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) },
    fetch: async (_: string, options: any) => { requests++; return responder(options) },
    AbortController, setTimeout, clearTimeout, window,
    console: { warn: (...args: any[]) => warnings.push(args) },
    updateVersionIndicators: (version: string) => indicators.push(version),
    renderModal: (item: any) => modals.push(item),
    processItem: (item: any) => { items.push(item); return item.logic.target_version !== 'v1.7.2' },
  })
  vm.runInContext(selected.map(name => { assert.ok(declarations.has(name), name); return declarations.get(name) }).join('\n'), context)
  return {
    context, storage, indicators, modals, items, warnings, window,
    get requests() { return requests },
    respond(fn: typeof responder) { responder = fn },
    advance(ms: number) { now += ms },
    run(manual = false, force = false) { return vm.runInContext(`checkUpdates(${manual}, ${force})`, context) },
  }
}
function response(status: number, body: any, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers })
}

test('automatic checks reuse metadata across reloads; manual checks refresh it', async () => {
  const h = harness()
  await h.run()
  await h.run()
  assert.equal(h.requests, 1)
  const reloaded = harness(h.storage)
  await reloaded.run()
  assert.equal(reloaded.requests, 0)
  assert.equal(reloaded.indicators.at(-1), 'v1.7.3')
  await reloaded.run(true)
  assert.equal(reloaded.requests, 1)
  reloaded.advance(6 * 60 * 60 * 1000 + 1)
  await reloaded.run()
  assert.equal(reloaded.requests, 2)
})

test('concurrent update checks share one request', async () => {
  const h = harness()
  let resolve!: (response: Response) => void
  h.respond(async () => new Promise<Response>(r => { resolve = r }))
  const first = h.run()
  const second = h.run(true)
  assert.equal(h.requests, 1)
  resolve(response(200, { tag_name: 'v1.7.3' }))
  await Promise.all([first, second])
})

test('GitHub rate limit persists until reset, including forced manual checks', async () => {
  const h = harness()
  h.respond(async () => response(403, { message: 'API rate limit exceeded' }, {
    'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((1800000000000 + 120000) / 1000),
  }))
  await h.run()
  await h.run(true, true)
  assert.equal(h.requests, 1)
  assert.equal(h.warnings.length, 1)
  assert.match(h.modals.at(-1).ui.message, /额度已用完/)
  const reloaded = harness(h.storage)
  await reloaded.run()
  assert.equal(reloaded.requests, 0)
  assert.equal(reloaded.warnings.length, 0)
  reloaded.advance(121001)
  await reloaded.run()
  assert.equal(reloaded.requests, 1)
  assert.equal(reloaded.indicators.at(-1), 'v1.7.3')
})

test('ordinary 403 is not mislabeled as rate limiting', async () => {
  const h = harness()
  h.respond(async () => response(403, { message: 'Forbidden' }))
  await h.run(true)
  assert.match(h.modals[0].ui.message, /拒绝/)
  assert.doesNotMatch(h.modals[0].ui.message, /额度已用完/)
  assert.equal(h.modals[0].action.url, 'https://github.com/bobcc4/yinyun-lxserver/releases/latest')
})

test('Retry-After is honored on 429 responses', async () => {
  const h = harness()
  h.respond(async () => response(429, {}, { 'retry-after': '120' }))
  await h.run()
  h.advance(119000)
  await h.run(true)
  assert.equal(h.requests, 1)
  h.advance(2001)
  await h.run()
  assert.equal(h.requests, 2)
})

test('failed refresh preserves the known update badge without claiming current version is latest', async () => {
  const h = harness()
  await h.run()
  h.respond(async () => { throw new Error('Network unavailable') })
  await h.run(true)
  assert.equal(h.indicators.at(-1), 'v1.7.3')
  assert.equal(h.modals.at(-1).id, 'manual_check_error')
  const reloaded = harness(h.storage)
  await reloaded.run()
  assert.equal(reloaded.indicators.at(-1), 'v1.7.3')
  assert.equal(reloaded.requests, 0)
})

test('disabled checks make no request and do not restore notifications', async () => {
  const h = harness()
  h.window.CONFIG.disableTelemetry = true
  await h.run()
  await h.run(true)
  assert.equal(h.requests, 0)
  assert.deepEqual(h.indicators, [])
  assert.equal(h.modals[0].id, 'manual_check_disabled')
})

test('malformed responses, unavailable storage and timeouts remain recoverable', async () => {
  const h = harness(new Map([['yinyun_release_check_v1', '{bad json']]))
  h.respond(async () => response(200, { tag_name: 'not-a-version' }))
  await h.run(true)
  assert.equal(h.modals.at(-1).id, 'manual_check_error')
  h.advance(15 * 60 * 1000 + 1)
  h.context.localStorage.setItem = () => { throw new Error('Storage blocked') }
  h.respond(async () => response(200, { tag_name: 'v1.7.2' }))
  await h.run(true)
  assert.equal(h.modals.at(-1).id, 'manual_check_uptodate')
  let timeout!: () => void
  h.context.setTimeout = (cb: () => void) => { timeout = cb; return 0 }
  h.respond(async options => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('Aborted')))))
  const pending = h.run(true)
  timeout()
  await pending
  assert.equal(h.modals.at(-1).id, 'manual_check_error')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { getProxyAgent, resolveProxyAddress } from '../src/modules/utils/proxy.js'

test('direct category mode bypasses global and environment proxy settings', async () => {
  const previousLx = global.lx
  const previousEnvProxy = process.env.HTTPS_PROXY
  global.lx = {
    config: {
      'proxy.all.enabled': true,
      'proxy.all.address': 'http://global-proxy.invalid:8080',
      'proxy.music.mode': 'direct',
    },
  } as any
  process.env.HTTPS_PROXY = 'http://env-proxy.invalid:8080'

  try {
    assert.equal(resolveProxyAddress('music'), '')
    assert.equal(await getProxyAgent('https://music.invalid', 'music'), undefined)
  } finally {
    global.lx = previousLx
    if (previousEnvProxy === undefined) delete process.env.HTTPS_PROXY
    else process.env.HTTPS_PROXY = previousEnvProxy
  }
})

test('custom category inherits the global proxy when not overridden', () => {
  const previousLx = global.lx
  global.lx = {
    config: {
      'proxy.all.enabled': true,
      'proxy.all.address': 'http://global-proxy.invalid:8080',
      'proxy.customSource.mode': 'inherit',
    },
  } as any

  try {
    assert.equal(resolveProxyAddress('customSource'), 'http://global-proxy.invalid:8080')
  } finally {
    global.lx = previousLx
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePublicUrl } from '../src/utils/publicUrl'

test('public URL accepts an origin and rejects player or admin paths', () => {
  assert.equal(normalizePublicUrl('https://music.example.com:16666/'), 'https://music.example.com:16666')
  assert.equal(normalizePublicUrl(''), '')
  assert.throws(() => normalizePublicUrl('https://music.example.com/music'), /不能包含/)
  assert.throws(() => normalizePublicUrl('ftp://music.example.com'), /只支持/)
  assert.throws(() => normalizePublicUrl('https://user:pass@music.example.com'), /不能包含用户名/)
})

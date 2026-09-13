import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('playlist list keeps internal sharing and combines cross-server export actions', () => {
  const source = fs.readFileSync('public/music/app.js', 'utf8')
  assert.match(source, /title="分享给本站用户"[\s\S]*handleSharePlaylist\('\$\{id\}', event\)/)
  assert.match(source, /title="跨服务端分享或导出 JSON"[\s\S]*handlePlaylistExchangeMenu\('\$\{id\}', event\)/)
  assert.doesNotMatch(source, /title="导出歌单 JSON"[\s\S]*exportPlaylistExchangeJson\('\$\{id\}', event\)/)
})

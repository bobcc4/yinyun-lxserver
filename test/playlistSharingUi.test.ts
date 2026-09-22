import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('playlist list keeps internal sharing and combines cross-server export actions', () => {
  const source = fs.readFileSync('public/music/app.js', 'utf8')
  assert.match(source, /\['分享给本站用户', 'fa-user-friends', handleSharePlaylist\]/)
  assert.match(source, /\['跨服务端分享或导出 JSON', 'fa-share-alt', handlePlaylistExchangeMenu\]/)
  assert.match(source, /aria-haspopup="menu"/)
  assert.doesNotMatch(source, /title="导出歌单 JSON"[\s\S]*exportPlaylistExchangeJson\('\$\{id\}', event\)/)
})

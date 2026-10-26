import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS } from '../src/core/config.js'
import { checkRoot, listDrives, pathsOf } from '../src/song/studio.js'

test('Linux 连接模式默认不执行 Windows SnowLuma 进程管理', () => {
  if (process.platform === 'win32') return
  assert.equal(DEFAULTS.snowluma.autoStart, false)
  assert.equal(DEFAULTS.snowluma.autoAttach, false)
  assert.equal(DEFAULTS.snowluma.dir, '')
  assert.equal(checkRoot('/tmp/aurabot').ok, true)
  assert.equal(checkRoot('relative/path').ok, false)
  assert.ok(listDrives().some((x) => x.drive === '/'))
  const p = pathsOf('/opt/aurabot/rvc')
  assert.match(p.python, /\/env\/bin\/python$/)
  assert.match(p.ffmpeg, /\/bin\/ffmpeg$/)
})

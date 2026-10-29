import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS } from '../src/core/config.js'
import { checkRoot, listDrives, pathsOf } from '../src/song/studio.js'

test('Linux 连接模式默认不执行 Windows SnowLuma 进程管理', () => {
  if (process.platform === 'win32') return
  assert.equal(DEFAULTS.gateway, 'onebot')
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


test('旧版 Linux 配置在新版默认切换到外部 OneBot，保持原有地址与凭据字段', async () => {
  if (process.platform === 'win32') return
  const { normalize } = await import('../src/core/config.js')
  const oldConfig = {
    botQQ: '10001',
    snowluma: {
      httpUrl: 'http://127.0.0.1:13000',
      wsUrl: 'ws://127.0.0.1:13001',
      httpToken: '',
      wsToken: '',
      autoStart: false,
      autoAttach: false,
    },
  }
  const cfg = normalize(oldConfig)
  assert.equal(cfg.gateway, 'onebot')
  assert.equal(cfg.snowluma.httpUrl, oldConfig.snowluma.httpUrl)
  assert.equal(cfg.snowluma.wsUrl, oldConfig.snowluma.wsUrl)
  assert.equal(cfg.snowluma.autoStart, false)
  assert.equal(cfg.snowluma.autoAttach, false)
})

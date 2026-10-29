// 完整链路：DSH 审批事件 → QQ OneBot 私聊 → 主人一次性批准 → 结束悬挂的审批。
// 不连接真实 QQ、没有外部模型或网络账户。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeDsh } from './helpers/fake-dsh.js'
import { startMockOneBot } from './helpers/mock-onebot.js'

const BOT = '20000002'
const OWNER = '10000001'
const FRIEND = '30000003'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, timeout = 8000) {
  const untilAt = Date.now() + timeout
  while (Date.now() < untilAt) {
    const v = fn()
    if (v) return v
    await sleep(25)
  }
  throw Error('wait timeout')
}
const priv = (uid, text) => ({
  message_type: 'private', sub_type: 'friend', user_id: Number(uid),
  sender: { user_id: Number(uid), nickname: 'test' },
  message: [{ type: 'text', data: { text } }],
})

test('原生 DSH 审批确实经过 Host/OneBot 路由；非主人消息不能批准', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aurabot-qqapproval-it-'))
  process.env.AURABOT_DATA_DIR = dataDir
  process.env.AURABOT_WORKSPACE = join(dataDir, 'ws')
  const mock = await startMockOneBot({ selfId: BOT })
  const fake = createFakeDsh({ brain: async () => '好的' })
  let approvalListener
  let sessionListener
  const oldOn = fake.ctx.on.bind(fake.ctx)
  fake.ctx.on = (name, fn, options) => {
    if (name === 'approval/request') {
      approvalListener = fn
      assert.equal(options?.prepend, true, 'QQ 审批监听应优先于一般 Web 监听')
    }
    if (name === 'session/event') sessionListener = fn
    return oldOn(name, fn)
  }
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
    enabled: true, dryRun: false, setupDone: true, botQQ: BOT, ownerQQ: OWNER,
    security: { dangerConfirm: false, qqApproval: true },
    allow: { private: [OWNER, FRIEND], groups: [] },
    snowluma: { autoStart: false, autoAttach: false,
      httpUrl: mock.httpUrl, wsUrl: mock.wsUrl,
      httpToken: mock.token, wsToken: mock.token },
    voice: { enabled: false, autoChance: 0 }, stickers: { enabled: false, autoChance: 0 },
    merge: { waitSec: 0.2, maxSec: 2 },
  }))
  try {
    const { apply } = await import('../src/host.js')
    const host = apply(fake.ctx)
    await host.ready
    assert.equal(typeof approvalListener, 'function')
    assert.equal(typeof sessionListener, 'function')
    await fake.call('/onebot/reconnect')
    await until(() => mock.connected() > 0)

    mock.push(priv(OWNER, '建立一个会话'))
    const sid = await until(() => {
      try { return JSON.parse(readFileSync(join(dataDir, 'sessions.json'))).chats[`private:${OWNER}`]?.sessionId } catch (e) { return null }
    })
    assert.equal(host.hub.chatOfSession(sid), `private:${OWNER}`)
    await until(() => fake.turns.length > 0)

    sessionListener({ id: sid }, { type: 'tool/call',
      data: { callId: 'req-123', name: 'bash', arguments: JSON.stringify({ command: 'pwd' }) } })
    const pending = approvalListener({
      agent: { session: { id: sid } }, toolName: 'bash', callId: 'req-123', reason: '模拟审批',
    }, async () => 'WEB')
    const before = fake.turns.length
    const sent = await until(() => mock.sent('send_private_msg').find((x) => JSON.stringify(x.params).includes('【DSH 单次工具审批】')))
    assert.equal(String(sent.params.user_id), OWNER)
    const code = /编号：([A-F0-9]{8})/.exec(JSON.stringify(sent.params))?.[1]
    assert.ok(code, '生成了单次随机审批码')
    mock.push(priv(FRIEND, `批准 ${code}`))
    mock.push({ message_type: 'group', group_id: 11, user_id: Number(OWNER), sender: { user_id: Number(OWNER) }, message: [{ type: 'text', data: { text: `批准 ${code}` } }] })
    await sleep(70)
    assert.equal(fake.turns.length, before, '无关审批回复不进入主人的 AI 会话')
    mock.push(priv(OWNER, `批准 ${code}`))
    assert.equal(await pending, 'allowed-once')
    assert.equal(host.getConfig().security.qqApproval, true)
    // 主人批准消息被 host 拦截，不能再次触发 AI 回答
    await sleep(100)
    assert.equal(fake.turns.length, before)
    const audit = mock.sent('send_private_msg').filter((x) => JSON.stringify(x.params).includes('【DSH 单次工具审批】'))
    assert.equal(audit.length, 1, '审批通知不重复发送')
  } finally {
    fake.dispose()
    await mock.close()
  }
})

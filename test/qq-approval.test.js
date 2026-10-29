import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createQQApprovalBridge } from '../src/security/qq-approval.js'

const owner = '10001'
const chat = `private:${owner}`
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function fixture({ enabled = true, connected = true, dryRun = false, timeoutMs = 250, delivery = undefined } = {}) {
  const cfg = { enabled: true, dryRun, security: { qqApproval: enabled } }
  const messages = []
  let online = connected
  const bridge = createQQApprovalBridge({
    getConfig: () => cfg,
    ownerQQ: () => owner,
    chatOfSession: (sid) => sid === 'sid-owner' ? chat : sid === 'sid-group' ? 'group:88' : '',
    isConnected: () => online,
    deliver: async (to, text) => {
      messages.push({ to, text })
      return delivery ? delivery(to, text) : { message_id: messages.length }
    },
    timeoutMs,
  })
  function observe({ sid = 'sid-owner', callId = 'call-1', name = 'bash', args = { command: 'pwd' } } = {}) {
    bridge.observe({ id: sid }, {
      type: 'tool/call',
      data: { callId, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
    })
  }
  function req({ sid = 'sid-owner', callId = 'call-1', toolName = 'bash', reason = '需要单次授权', signal } = {}) {
    return { agent: { session: { id: sid } }, callId, toolName, reason, signal }
  }
  const next = async () => 'WEB'
  const code = (index = -1) => {
    const msg = messages.at(index)?.text || ''
    const match = /编号：([A-F0-9]{8})/.exec(msg)
    return match?.[1]
  }
  return { bridge, messages, cfg, observe, req, next, code, setOnline: (v) => { online = v } }
}

test('默认关闭、断线、非主人私聊：全部交给原 DSH 审批器，不发 QQ', async () => {
  for (const opts of [{ enabled: false }, { connected: false }, { dryRun: true }]) {
    const f = fixture(opts)
    f.observe()
    assert.equal(await f.bridge.request(f.req(), f.next), 'WEB')
    assert.equal(f.messages.length, 0)
    f.bridge.dispose()
  }
  const f = fixture()
  f.observe({ sid: 'sid-group' })
  assert.equal(await f.bridge.request(f.req({ sid: 'sid-group' }), f.next), 'WEB')
  assert.equal(f.messages.length, 0)
  f.bridge.dispose()
})

test('只对准确匹配的 tool/call 单次授权，主人带随机编号批准才放行', async () => {
  const f = fixture()
  f.observe({ args: { command: 'echo ok', cwd: '/tmp' } })
  const waiting = f.bridge.request(f.req(), f.next)
  await delay(1)
  assert.equal(f.bridge.pendingCount, 1)
  assert.equal(f.messages.length, 1)
  assert.equal(f.messages[0].to, chat)
  assert.match(f.messages[0].text, /"command": "echo ok"/)
  assert.equal(f.bridge.handleReply(chat, '999', `批准 ${f.code()}`), false)
  assert.equal(f.bridge.handleReply('group:88', owner, `批准 ${f.code()}`), false)
  assert.equal(f.bridge.handleReply(chat, owner, '批准'), false)
  assert.equal(f.bridge.handleReply(chat, owner, `批准 ${f.code()}`), true)
  assert.equal(await waiting, 'allowed-once')
  assert.equal(f.bridge.pendingCount, 0)
  f.bridge.dispose()
})

test('明确拒绝、过期编号与其他文本不会产生隐式授权', async () => {
  const f = fixture()
  f.observe()
  const waiting = f.bridge.request(f.req(), f.next)
  await delay(1)
  assert.equal(f.bridge.handleReply(chat, owner, `拒绝 ${f.code()}`), true)
  assert.equal(await waiting, 'rejected')
  assert.equal(f.bridge.handleReply(chat, owner, `批准 ${f.code(0)}`), true, '旧编号被消费，不进入 AI 对话')
  assert.equal(f.bridge.handleReply(chat, owner, '晚安'), false)
  f.bridge.dispose()
})

test('没有工具调用原文/调用编号不一致/工具名不一致/参数非 JSON：绝不 QQ 放行', async () => {
  const f = fixture()
  assert.equal(await f.bridge.request(f.req(), f.next), 'WEB')
  f.observe()
  assert.equal(await f.bridge.request(f.req({ callId: 'other' }), f.next), 'WEB')
  assert.equal(await f.bridge.request(f.req({ toolName: 'write_file' }), f.next), 'WEB')
  assert.equal(await f.bridge.request(f.req({ callId: null }), f.next), 'WEB')
  f.observe({ callId: 'bad-json', args: 'not json' })
  assert.equal(await f.bridge.request(f.req({ callId: 'bad-json' }), f.next), 'WEB')
  f.observe({ callId: 'array', args: '[1,2]' })
  assert.equal(await f.bridge.request(f.req({ callId: 'array' }), f.next), 'WEB')
  assert.equal(f.messages.length, 0)
  f.bridge.dispose()
})

test('参数或原因可能含密钥、参数过长：不经 QQ 转发，交由 Web 审批', async () => {
  const f = fixture()
  const badArgs = [
    { api_key: 'fake-value' },
    { command: 'curl -H "Authorization: Bearer fake-value" example.com' },
    { command: 'echo ' + 'a'.repeat(1100) },
    { command: 'echo sk-abcde12345678' },
  ]
  for (let i = 0; i < badArgs.length; i++) {
    f.observe({ callId: String(i), args: badArgs[i] })
    assert.equal(await f.bridge.request(f.req({ callId: String(i) }), f.next), 'WEB')
  }
  f.observe({ callId: 'reason' })
  assert.equal(await f.bridge.request(f.req({ callId: 'reason', reason: 'Cookie=private' }), f.next), 'WEB')
  assert.equal(f.messages.length, 0)
  f.bridge.dispose()
})

test('QQ 消息发送失败或网关返回空结果：拒绝授权且不留下等待项', async () => {
  for (const delivery of [() => null, () => { throw Error('offline') }]) {
    const f = fixture({ delivery })
    f.observe()
    assert.equal(await f.bridge.request(f.req(), f.next), 'unavailable')
    assert.equal(f.bridge.pendingCount, 0)
    f.bridge.dispose()
  }
})

test('超时、AbortSignal、turn/end 和销毁：撤销所有未完成的审批', async () => {
  const f = fixture({ timeoutMs: 30 })
  f.observe()
  assert.equal(await f.bridge.request(f.req(), f.next), 'unavailable')
  assert.equal(f.bridge.pendingCount, 0)
  f.bridge.dispose()

  for (const kind of ['abort', 'turn-end', 'dispose']) {
    const g = fixture()
    const ctrl = new AbortController()
    g.observe()
    const waiting = g.bridge.request(g.req({ signal: ctrl.signal }), g.next)
    await delay(1)
    assert.equal(g.bridge.pendingCount, 1)
    if (kind === 'abort') ctrl.abort()
    if (kind === 'turn-end') g.bridge.observe({ id: 'sid-owner' }, { type: 'turn/end' })
    if (kind === 'dispose') g.bridge.dispose()
    assert.equal(await waiting, 'cancelled')
    assert.equal(g.bridge.pendingCount, 0)
    g.bridge.dispose()
  }
})

test('并行工具审批互不串号，最多同时存在 4 个', async () => {
  const f = fixture()
  const waits = []
  for (let i = 0; i < 4; i++) {
    f.observe({ callId: 'c'+i, args: { command: 'echo '+i } })
    waits.push(f.bridge.request(f.req({ callId: 'c'+i }), f.next))
  }
  await delay(1)
  assert.equal(f.bridge.pendingCount, 4)
  const codes = [...f.messages].map((_, i) => f.code(i))
  assert.equal(new Set(codes).size, 4)
  f.observe({ callId: 'fifth' })
  assert.equal(await f.bridge.request(f.req({ callId: 'fifth' }), f.next), 'unavailable')
  assert.equal(f.bridge.handleReply(chat, owner, `批准 ${codes[1]}`), true)
  assert.equal(f.bridge.handleReply(chat, owner, `拒绝 ${codes[0]}`), true)
  f.bridge.cancelAll()
  assert.deepEqual(await Promise.all(waits), ['rejected', 'allowed-once', 'cancelled', 'cancelled'])
  f.bridge.dispose()
})

test('配置关闭或登录状态断开时，即使回复正确编号也不能授权', async () => {
  for (const how of ['config', 'disconnect']) {
    const f = fixture()
    f.observe()
    const waiting = f.bridge.request(f.req(), f.next)
    await delay(1)
    if (how === 'config') f.cfg.security.qqApproval = false
    else f.setOnline(false)
    assert.equal(f.bridge.handleReply(chat, owner, `批准 ${f.code()}`), true)
    assert.equal(await waiting, 'cancelled')
    f.bridge.dispose()
  }
})

test('工具调用属于其他会话、工具调用在 turn/end 后过期，不匹配就不给 QQ', async () => {
  const f = fixture()
  f.observe({ sid: 'sid-group' })
  assert.equal(await f.bridge.request(f.req(), f.next), 'WEB')
  f.observe()
  f.bridge.observe({ id: 'sid-owner' }, { type: 'turn/end' })
  assert.equal(await f.bridge.request(f.req(), f.next), 'WEB')
  f.bridge.dispose()
})

test('工具结果先到时撤销待批请求，不能事后放行已结束调用', async () => {
  const f = fixture()
  f.observe({ callId: 'c-res' })
  const waiting = f.bridge.request(f.req({ callId: 'c-res' }), f.next)
  await delay(1)
  const code = f.code()
  f.bridge.observe({ id: 'sid-owner' }, { type: 'tool/result', data: { callId: 'c-res' } })
  assert.equal(await waiting, 'cancelled')
  assert.equal(f.bridge.handleReply(chat, owner, `批准 ${code}`), true)
  assert.equal(f.bridge.pendingCount, 0)
  f.bridge.dispose()
})

test('非法 tool/call 事件不会成为可审批依据', async () => {
  const f = fixture()
  f.bridge.observe({ id: 'sid-owner' }, { type: 'tool/call', data: { callId: 'a', name: 'bash', arguments: undefined } })
  assert.equal(await f.bridge.request(f.req({ callId: 'a', toolName: 'bash' }), f.next), 'WEB')
  f.bridge.dispose()
})


test('网关发送永久悬挂不阻塞超时；迟到的发送结果也不能恢复授权', async () => {
  let settleSend
  const delivery = () => new Promise((resolve) => { settleSend = resolve })
  const f = fixture({ timeoutMs: 25, delivery })
  f.observe()
  const waiting = f.bridge.request(f.req(), f.next)
  await delay(5)
  assert.equal(typeof settleSend, 'function')
  assert.equal(await waiting, 'unavailable')
  settleSend({ message_id: 1 })
  await delay(1)
  assert.equal(f.bridge.pendingCount, 0)
  assert.equal(f.bridge.handleReply(chat, owner, `批准 ${f.code()}`), true)
  f.bridge.dispose()
})

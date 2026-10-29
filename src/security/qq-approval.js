// DSH 原生审批 → 主人 QQ 私聊（实验功能，默认关闭）。
// 只为真实且完整的 tool/call 做一次性授权；没法核对调用参数时交还原审批通道。
// 无独立 HTTP 审批端点、不缓存 QQ 凭据、不修改 DSH 会话审批策略。
import { randomBytes } from 'node:crypto'

const MAX_CALLS = 128
const CALL_TTL_MS = 5 * 60_000
const MAX_ARGUMENTS = 950
const MAX_REASON = 240
const MAX_PENDING = 4
const COMMAND = /^(批准|拒绝)\s+([A-F0-9]{8})$/i
// 不在 QQ 转发可能包含凭据的工具参数；这种调用留给 DSH 原有审批端。
// 包括内联 curl -H、JSON 参数、环境变量赋值等常见凭据样式。
const SENSITIVE = /(?:password|passwd|passphrase|api[_-]?key|token|authorization|cookie|secret|private[_-]?key|bearer\s+|-----BEGIN\s+.*PRIVATE KEY|\bsk-[A-Za-z0-9_-]{8,})/i

const idOf = (x) => String(x ?? '')

export function createQQApprovalBridge({
  getConfig, ownerQQ, chatOfSession, deliver, isConnected, timeoutMs = 120_000, log,
} = {}) {
  const calls = new Map() // exact session+callId → tool call, bounded and short lived
  const pending = new Map() // random 8 hex code → a single Promise resolver
  let disposed = false

  const ownerChat = () => {
    const owner = idOf(ownerQQ?.())
    return /^\d+$/.test(owner) ? `private:${owner}` : ''
  }

  const enabled = () => {
    const cfg = getConfig?.()
    return !disposed && cfg?.security?.qqApproval === true && cfg.enabled === true && cfg.dryRun !== true
  }

  const prune = () => {
    const now = Date.now()
    for (const [key, call] of calls) {
      if (now - call.at > CALL_TTL_MS) calls.delete(key)
    }
    while (calls.size > MAX_CALLS) calls.delete(calls.keys().next().value)
  }

  const keyOf = (sessionId, callId) => `${idOf(sessionId)}\x00${idOf(callId)}`

  /** Session events have authoritative tool/call arguments before DSH asks permission. */
  function observe(session, event) {
    if (disposed || !session?.id || !event) return
    const sid = idOf(session.id)
    if (event.type === 'turn/end') {
      for (const key of calls.keys()) if (key.startsWith(sid + '\x00')) calls.delete(key)
      for (const [code, item] of pending) if (item.sid === sid) settle(code, 'cancelled')
      return
    }
    if (event.type === 'tool/result') {
      const callId = event.data?.callId
      if (typeof callId === 'string') {
        calls.delete(keyOf(sid, callId))
        for (const [code, item] of pending) if (item.sid === sid && item.callId === callId) settle(code, 'cancelled')
      }
      return
    }
    if (event.type !== 'tool/call' || !enabled() || chatOfSession?.(sid) !== ownerChat()) return
    const d = event.data
    if (!d || typeof d.callId !== 'string' || typeof d.name !== 'string' || typeof d.arguments !== 'string') return
    prune()
    calls.set(keyOf(sid, d.callId), { name: d.name, args: d.arguments, at: Date.now() })
    prune()
  }

  function settle(code, outcome) {
    const item = pending.get(code)
    if (!item) return false
    pending.delete(code)
    clearTimeout(item.timer)
    item.signal?.removeEventListener('abort', item.abort)
    item.resolve(outcome)
    return true
  }

  function cancelAll() {
    for (const code of [...pending.keys()]) settle(code, 'cancelled')
    calls.clear()
  }

  /** A waterfall listener: delegate foreign requests; never grant without matching call details. */
  async function request(req, next) {
    const fallback = () => next()
    if (!enabled() || !isConnected?.() || !ownerChat() || !req?.agent?.session?.id) return fallback()
    const sid = idOf(req.agent.session.id)
    const chatId = chatOfSession?.(sid)
    if (chatId !== ownerChat()) return fallback()
    if (req.signal?.aborted) return 'cancelled'
    if (typeof req.callId !== 'string' || !req.callId) return fallback()
    prune()
    const call = calls.get(keyOf(sid, req.callId))
    if (!call || call.name !== req.toolName || !call.args || call.args.length > MAX_ARGUMENTS || SENSITIVE.test(call.args)) return fallback()
    // Only JSON object arguments from the real session event may be sent to QQ.
    let args
    try { args = JSON.parse(call.args) } catch (error) { return fallback() }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return fallback()
    const reason = idOf(req.displayReason?.zh || req.reason || '').trim()
    if (reason.length > MAX_REASON || SENSITIVE.test(reason)) return fallback()
    if (pending.size >= MAX_PENDING) return 'unavailable'

    let code
    do { code = randomBytes(4).toString('hex').toUpperCase() } while (pending.has(code))
    const lifetime = Math.max(1, Math.round(timeoutMs / 1000))
    const message = [
      '【DSH 单次工具审批】',
      `工具：${call.name}`,
      `参数：${JSON.stringify(args, null, 2)}`,
      reason ? `原因：${reason}` : '',
      `编号：${code}`,
      `回复「批准 ${code}」仅允许这一次操作；回复「拒绝 ${code}」立即拒绝。`,
      `${lifetime} 秒超时自动拒绝。请核对完整参数，勿批准不认识的操作。`,
    ].filter(Boolean).join('\n')

    const outcome = new Promise((resolve) => {
      const abort = () => settle(code, 'cancelled')
      const timer = setTimeout(() => settle(code, 'unavailable'), timeoutMs)
      pending.set(code, { resolve, timer, abort, signal: req.signal, sid, callId: req.callId, chatId })
      req.signal?.addEventListener('abort', abort, { once: true })
      if (req.signal?.aborted) abort()
    })
    // Do not await the QQ send here: even a hung OneBot call must not prevent
    // timeout/abort/disconnection from settling the original DSH approval.
    void Promise.resolve().then(() => pending.has(code) ? deliver(chatId, message) : null).then(
      (sent) => { if (pending.has(code) && !sent) settle(code, 'unavailable') },
      () => {
        log?.warn?.('DSH QQ 审批提醒发送失败')
        settle(code, 'unavailable')
      },
    )
    return outcome
  }

  /** Called only after the OneBot account has been verified by the host. */
  function handleReply(chatId, userId, text) {
    if (disposed || chatId !== ownerChat() || idOf(userId) !== idOf(ownerQQ?.())) return false
    const match = COMMAND.exec(idOf(text).trim())
    if (!match) return false
    const code = match[2].toUpperCase()
    const item = pending.get(code)
    if (!item || !enabled() || !isConnected?.() || item.chatId !== chatId || chatOfSession?.(item.sid) !== chatId) {
      // Consume expired/unknown codes: do not leak them into the model conversation.
      if (item) settle(code, 'cancelled')
      void Promise.resolve().then(() => deliver(chatId, '这条审批已过期、取消或不存在；没有执行任何授权。')).catch(() => {})
      return true
    }
    const approved = match[1] === '批准'
    settle(code, approved ? 'allowed-once' : 'rejected')
    void Promise.resolve().then(() => deliver(chatId, approved
      ? `已批准一次操作（${code}）；这不代表以后同类操作自动放行。`
      : `已拒绝操作（${code}）。`)).catch(() => {})
    return true
  }

  return {
    observe, request, handleReply, cancelAll,
    dispose: () => { disposed = true; cancelAll() },
    get pendingCount() { return pending.size },
  }
}

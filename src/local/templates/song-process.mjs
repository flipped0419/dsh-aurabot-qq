// Aurabot 本地接口：把截取好的完整歌曲上传 InstaBox，远程分离人声、RVC 换声，下载两条 WAV。
// 配置文件：与本脚本同目录的 rvc-worker.env（由 rvc-worker.env.example 复制）。
// 不需要在腾讯云安装 audio-separator、PyTorch 或 RVC；模型在 InstaBox。
// Node.js 20+，只使用内置 fetch / FormData / Blob，不需要 npm install。

import { readFileSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENV_PATH = fileURLToPath(new URL('./rvc-worker.env', import.meta.url))
const VOICES_PATH = fileURLToPath(new URL('./rvc-voices.json', import.meta.url))

function voiceConfig() {
  let raw
  try { raw = JSON.parse(readFileSync(VOICES_PATH, 'utf8')) }
  catch (e) {
    if (e?.code === 'ENOENT') return { default: '', voices: {} } // compatibility with one-model deployment
    throw new Error('rvc-voices.json 解析失败：' + e.message)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      !raw.voices || typeof raw.voices !== 'object' || Array.isArray(raw.voices)) {
    throw new Error('rvc-voices.json 必须包含 voices 对象')
  }
  const voices = Object.create(null)
  for (const [label, name] of Object.entries(raw.voices)) {
    if (!/^[\\p{L}\\p{N}_.-]{1,32}$/u.test(label) ||
        typeof name !== 'string' || !name.endsWith('.pth') || basename(name) !== name ||
        name === '.pth' || name.length > 100 || Object.keys(voices).length >= 24) {
      throw new Error('rvc-voices.json 中存在非法音色名称或模型文件名')
    }
    voices[label] = name
  }
  const defaultVoice = String(raw.default || '')
  if (defaultVoice && !Object.hasOwn(voices, defaultVoice)) {
    throw new Error('rvc-voices.json 的 default 不在 voices 列表中')
  }
  return { default: defaultVoice || Object.keys(voices)[0] || '', voices }
}

function selectVoice(c, chosen = '') {
  const v = voiceConfig()
  if (!Object.keys(v.voices).length) {
    if (chosen) throw new Error('尚未配置远程音色列表，请先创建 rvc-voices.json')
    return { model: c.model, label: c.model }
  }
  const label = chosen || v.default
  if (!Object.hasOwn(v.voices, label)) throw new Error('未知远程音色：' + label)
  return { label, model: v.voices[label] }
}

function readSettings() {
  let raw
  try { raw = readFileSync(ENV_PATH, 'utf8') }
  catch { throw new Error(`缺少 ${ENV_PATH}。请复制 rvc-worker.env.example 为 rvc-worker.env，填入私有端口 Token 和 Worker Key。`) }
  const values = {}
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i < 1) continue
    const key = s.slice(0, i).trim()
    let value = s.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[key] = value
  }
  for (const key of ['RVC_BASE_URL', 'RVC_PORT_TOKEN', 'RVC_WORKER_KEY', 'RVC_MODEL', 'RVC_F0_METHOD', 'RVC_SEPARATOR_PROFILE']) {
    if (process.env[key] !== undefined) values[key] = process.env[key]
  }
  const base = String(values.RVC_BASE_URL || '').trim()
  if (!base) throw new Error('rvc-worker.env 缺少 RVC_BASE_URL')
  let url
  try { url = new URL(base) } catch { throw new Error('RVC_BASE_URL 不是有效 URL') }
  if (url.protocol !== 'https:' || url.search || url.hash) throw new Error('RVC_BASE_URL 必须是没有查询参数的 HTTPS 基础地址；Port Token 单独填入 RVC_PORT_TOKEN')
  const portToken = String(values.RVC_PORT_TOKEN || '').trim()
  const workerKey = String(values.RVC_WORKER_KEY || '').trim()
  if (!portToken || !workerKey) throw new Error('rvc-worker.env 缺少 RVC_PORT_TOKEN 或 RVC_WORKER_KEY')
  const model = String(values.RVC_MODEL || 'Fp231.pth').trim()
  if (!model.endsWith('.pth') || basename(model) !== model) throw new Error('RVC_MODEL 必须是模型目录中的 .pth 文件名，不能包含路径')
  const f0Method = String(values.RVC_F0_METHOD || 'rmvpe').trim()
  if (!['pm', 'rmvpe'].includes(f0Method)) throw new Error('RVC_F0_METHOD 只能是 pm 或 rmvpe')
  const separatorProfile = String(values.RVC_SEPARATOR_PROFILE || 'mel-vocals').trim()
  if (!['mel-vocals', 'bs-roformer', 'mdx-hq5'].includes(separatorProfile)) throw new Error('RVC_SEPARATOR_PROFILE 只能是 mel-vocals、bs-roformer 或 mdx-hq5')
  return { base: url.origin + url.pathname.replace(/\/$/, ''), portToken, workerKey, model, f0Method, separatorProfile }
}

export async function cacheKey(voice = '') {
  const c = readSettings()
  const selected = selectVoice(c, voice)
  return `instabox-song:${selected.model}:${c.f0Method}:${c.separatorProfile}:v3`
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function get(path, c, { timeoutMs = 120_000, attempts = 3 } = {}) {
  const headers = { Authorization: `Bearer ${c.portToken}`, 'X-Worker-Key': c.workerKey }
  let last
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(c.base + path, { headers, signal: AbortSignal.timeout(timeoutMs) })
      if ([502, 503, 504].includes(res.status) && i + 1 < attempts) {
        last = new Error(`HTTP ${res.status}`)
        await delay(3000 * (i + 1))
        continue
      }
      if (!res.ok) {
        const error = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`)
        if (![502, 503, 504].includes(res.status)) throw Object.assign(error, { permanent: true })
        last = error
        if (i + 1 < attempts) await delay(3000 * (i + 1))
        continue
      }
      return res
    } catch (error) {
      if (error.permanent) throw error
      last = error
      if (i + 1 < attempts) await delay(3000 * (i + 1))
    }
  }
  throw new Error(`连接 InstaBox RVC Worker 失败：${last?.message || 'unknown error'}`)
}

export default async function processSong({ input, outputVocals, outputInstrumental, pitch = 0, voice = '', log }) {
  const c = readSettings()
  const selected = selectVoice(c, voice)
  const audio = await readFile(input)
  if (!audio.length) throw new Error('待转换的人声文件为空')
  if (audio.length > 64 * 1024 * 1024) throw new Error('人声文件超过 Worker 的 64 MiB 上传限制')

  log.info(`连接 InstaBox RVC Worker；音色 ${selected.label}，模型 ${selected.model}，F0 ${c.f0Method}`)
  const health = await (await get('/health', c)).json()
  if (!health.ready) throw new Error('InstaBox RVC Worker 尚未就绪')
  if (!health.separator_ready) throw new Error('InstaBox 尚未完成 audio-separator 模型安装或 Worker 升级')
  if (health.separator_profile !== c.separatorProfile) {
    throw new Error(`InstaBox 当前分离模型为 ${health.separator_profile || '未知'}，但配置希望使用 ${c.separatorProfile}；请先同步 Worker 与 rvc-worker.env，避免误用缓存或混合不同模型`)
  }
  const available = await (await get('/v1/models', c)).json()
  if (!Array.isArray(available.models) || !available.models.includes(selected.model)) {
    throw new Error(`InstaBox 上没有模型 ${selected.model}；当前模型：${(available.models || []).join('、') || '无'}`)
  }

  const form = new FormData()
  form.append('file', new Blob([audio]), basename(input))
  form.append('model', selected.model)
  form.append('pitch', String(Math.max(-24, Math.min(24, Math.round(Number(pitch) || 0)))))
  form.append('f0_method', c.f0Method)

  // POST 只提交一次：若网络中断导致响应不明，不能盲目重试，否则可能重复排队。
  let response
  try {
    response = await fetch(c.base + '/v1/song-jobs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.portToken}`, 'X-Worker-Key': c.workerKey },
      body: form,
      signal: AbortSignal.timeout(180_000),
    })
  } catch (error) {
    throw new Error(`提交结果暂时无法确认（${error.message}）。请先检查 InstaBox Worker 的任务状态，不要立即重复提交。`)
  }
  if (!response.ok) throw new Error(`提交 RVC 任务失败（HTTP ${response.status}）：${(await response.text()).slice(0, 240)}`)
  const accepted = await response.json()
  const jobId = String(accepted.job_id || '')
  if (!/^[0-9a-f]{32}$/.test(jobId)) throw new Error('Worker 返回了无效的 job_id')
  log.info(`RVC 任务已提交：${jobId}`)

  const deadline = Date.now() + 60 * 60 * 1000
  let previous = ''
  while (Date.now() < deadline) {
    await delay(5000)
    const item = await (await get(`/v1/song-jobs/${jobId}`, c, { timeoutMs: 90_000 })).json()
    if (item.state !== previous) {
      previous = item.state
      log.info(`RVC 任务 ${jobId}：${item.state}`)
    }
    if (item.state === 'failed') throw new Error(`RVC 推理失败：${item.error || 'Worker 未提供错误详情'}`)
    if (item.state === 'done') break
    if (!['queued', 'running'].includes(item.state)) throw new Error(`Worker 返回未知任务状态：${item.state}`)
  }
  if (previous !== 'done') throw new Error(`RVC 任务超过 60 分钟仍未完成（${jobId}）`)

  async function downloadStem(path, output) {
    const response = await get(path, c, { timeoutMs: 180_000 })
    const wav = Buffer.from(await response.arrayBuffer())
    if (wav.length < 44 || wav.length > 80 * 1024 * 1024 ||
        wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error('Worker 返回的声轨不是有效 WAV 或文件过大')
    }
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, wav)
    return wav.length
  }
  const vocalsSize = await downloadStem(`/v1/song-jobs/${jobId}/vocals`, outputVocals)
  const instrumentalSize = await downloadStem(`/v1/song-jobs/${jobId}/instrumental`, outputInstrumental)
  log.info(`远程人声分离 + RVC 完成：人声 ${vocalsSize} 字节，伴奏 ${instrumentalSize} 字节`)
  return { vocals: outputVocals, instrumental: outputInstrumental }
}

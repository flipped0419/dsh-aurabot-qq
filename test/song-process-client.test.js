// Remote full-song and legacy vocal-only adapters: mock fetch, exercise real file IO.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const noopLog = { info() {}, warn() {} }
const jid = 'a'.repeat(32)
function riffWav() {
  const bytes = Buffer.alloc(44)
  bytes.write('RIFF', 0, 4)
  bytes.writeUInt32LE(36, 4)
  bytes.write('WAVE', 8, 4)
  bytes.write('fmt ', 12, 4)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16000, 24)
  bytes.writeUInt32LE(32000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36, 4)
  bytes.writeUInt32LE(0, 40)
  return bytes
}
function response(body, status = 200) {
  return new Response(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body), { status })
}
function fixture(sourceFile) {
  const folder = mkdtempSync(join(tmpdir(), 'ab-full-song-client-'))
  copyFileSync(new URL('../src/local/templates/' + sourceFile, import.meta.url), join(folder, sourceFile))
  writeFileSync(join(folder, 'rvc-worker.env'), [
    'RVC_BASE_URL=https://unit.example.invalid',
    'RVC_PORT_TOKEN=ibp_test_do_not_use',
    'RVC_WORKER_KEY=test_not_production',
    'RVC_MODEL=Fp231.pth',
    'RVC_F0_METHOD=pm',
  ].join('\n'))
  const input = join(folder, 'input.wav')
  writeFileSync(input, riffWav())
  return { folder, input, file: pathToFileURL(join(folder, sourceFile)).href }
}

test('song-process.mjs uploads original audio and downloads both WAV tracks', async () => {
  const f = fixture('song-process.mjs')
  const orig = globalThis.fetch
  let postCount = 0
  let stems = []
  const wav = riffWav()
  globalThis.fetch = async (url, opts = {}) => {
    const path = new URL(url).pathname
    if (path === '/health') return response({ ready: true, separator_ready: true })
    if (path === '/v1/models') return response({ models: ['Fp231.pth'] })
    if (path === '/v1/song-jobs') {
      postCount++
      assert.equal(opts.method, 'POST')
      assert.equal(opts.body.get('model'), 'Fp231.pth')
      assert.equal(opts.body.get('pitch'), '4')
      return response({ job_id: jid, state: 'queued' }, 202)
    }
    if (path === '/v1/song-jobs/' + jid) return response({ state: 'done' })
    if (path.startsWith('/v1/song-jobs/' + jid + '/')) {
      stems.push(path.split('/').pop())
      return response(wav)
    }
    throw new Error('unexpected route ' + path)
  }
  try {
    const convert = await import(f.file)
    assert.match(await convert.cacheKey(), /Fp231\.pth/)
    const vocals = join(f.folder, 'voice.wav'), instrumental = join(f.folder, 'inst.wav')
    const out = await convert.default({ input: f.input, outputVocals: vocals, outputInstrumental: instrumental, pitch: 4, log: noopLog })
    assert.deepEqual(out, { vocals, instrumental })
    assert.deepEqual(readFileSync(vocals), wav)
    assert.deepEqual(readFileSync(instrumental), wav)
    assert.deepEqual(stems.sort(), ['instrumental', 'vocals'])
    assert.equal(postCount, 1)
  } finally {
    globalThis.fetch = orig
    rmSync(f.folder, { recursive: true, force: true })
  }
})

test('song-process.mjs rejects missing separator before job POST', async () => {
  const f = fixture('song-process.mjs')
  const orig = globalThis.fetch
  let posts = 0
  globalThis.fetch = async (url, opts = {}) => {
    if (opts.method === 'POST') posts++
    const path = new URL(url).pathname
    if (path === '/health') return response({ ready: true, separator_ready: false })
    throw new Error('unexpected route ' + path)
  }
  try {
    const convert = await import(f.file)
    await assert.rejects(convert.default({
      input: f.input, outputVocals: join(f.folder, 'a.wav'), outputInstrumental: join(f.folder, 'b.wav'), log: noopLog,
    }), /audio-separator/)
    assert.equal(posts, 0)
  } finally {
    globalThis.fetch = orig
    rmSync(f.folder, { recursive: true, force: true })
  }
})

test('旧版 song-convert.mjs 仍是可独立编辑的通用脚本模板', () => {
  const raw = readFileSync(new URL('../src/local/templates/song-convert.mjs', import.meta.url), 'utf8')
  assert.match(raw, /export default async/)
  assert.match(raw, /voiceFile|input/)
  assert.doesNotMatch(raw, /song-jobs/)
})

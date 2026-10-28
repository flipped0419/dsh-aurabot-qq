import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize } from '../src/core/config.js'
import { askModel } from '../src/core/llm.js'

test('模型思考强度默认不指定，但保留用户明确选择', () => {
  assert.equal(normalize({}).model.reasoningEffort, '')
  assert.equal(normalize({ model: { reasoningEffort: '' } }).model.reasoningEffort, '')
  assert.equal(normalize({ model: { reasoningEffort: 'high' } }).model.reasoningEffort, 'high')
})

async function probe(effort) {
  let request
  const dsh = {
    llm: { async *stream(opts) { request = opts; yield { type: 'text-delta', text: '在呢' } } },
  }
  const cfg = { model: { provider: 'cliproxy', model: 'sample-model', ...(effort === undefined ? {} : { reasoningEffort: effort }) } }
  const text = await askModel(dsh, { cfg, system: 'test', text: '在吗' })
  assert.equal(text, '在呢')
  return request
}

test('后台模型调用默认不传 reasoningEffort，避免无推理元数据的模型拒绝', async () => {
  for (const effort of [undefined, '']) {
    const request = await probe(effort)
    assert.equal(Object.hasOwn(request, 'reasoningEffort'), false)
  }
})

test('后台模型调用尊重用户显式思考强度', async () => {
  const request = await probe('high')
  assert.equal(request.reasoningEffort, 'high')
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { collectAssetRefs } from '../lib/utils/collectAssetRefs.js'

describe('collectAssetRefs()', () => {
  const parse = id => {
    if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('INVALID_OBJECTID')
    return id
  }
  const a = 'a'.repeat(24)
  const b = 'b'.repeat(24)

  it('should return every reference as valid when all parse', () => {
    const content = [{ _id: '1', _type: 'block', _assetIds: [a, b] }]
    assert.deepEqual(collectAssetRefs(content, parse), { valid: [a, b], invalid: [] })
  })

  it('should tag an unparseable reference with its content item', () => {
    const content = [{ _id: '1', _type: 'block', _assetIds: [a, 'nope'] }]
    const { valid, invalid } = collectAssetRefs(content, parse)
    assert.deepEqual(valid, [a])
    assert.deepEqual(invalid, [{ id: 'nope', contentId: '1', contentType: 'block' }])
  })

  it('should collect references across multiple content items', () => {
    const content = [
      { _id: '1', _type: 'block', _assetIds: [a] },
      { _id: '2', _type: 'component', _assetIds: ['bad', b] }
    ]
    const { valid, invalid } = collectAssetRefs(content, parse)
    assert.deepEqual(valid, [a, b])
    assert.deepEqual(invalid, [{ id: 'bad', contentId: '2', contentType: 'component' }])
  })

  it('should treat missing _assetIds and missing courseContent as empty', () => {
    assert.deepEqual(collectAssetRefs([{ _id: '1', _type: 'page' }], parse), { valid: [], invalid: [] })
    assert.deepEqual(collectAssetRefs(undefined, parse), { valid: [], invalid: [] })
  })
})

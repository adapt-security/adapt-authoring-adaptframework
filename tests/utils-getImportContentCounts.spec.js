import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { getImportContentCounts } from '../lib/utils/getImportContentCounts.js'

describe('getImportContentCounts()', () => {
  it('should count single items by _type', () => {
    const content = {
      course: { _type: 'course' },
      config: { _type: 'config' }
    }
    assert.deepEqual(getImportContentCounts(content), { course: 1, config: 1 })
  })

  it('should count arrays of items by _type', () => {
    const content = {
      course: { _type: 'course' },
      contentObjects: {
        co1: { _type: 'page' },
        co2: { _type: 'page' },
        co3: { _type: 'menu' }
      }
    }
    assert.deepEqual(getImportContentCounts(content), { course: 1, page: 2, menu: 1 })
  })

  it('should return empty object for empty content', () => {
    assert.deepEqual(getImportContentCounts({}), {})
  })
})

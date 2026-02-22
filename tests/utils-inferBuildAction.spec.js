import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { inferBuildAction } from '../lib/utils/inferBuildAction.js'

describe('inferBuildAction()', () => {
  const cases = [
    { url: '/preview/abc123', expected: 'preview' },
    { url: '/publish/abc123', expected: 'publish' },
    { url: '/export/abc123', expected: 'export' }
  ]
  cases.forEach(({ url, expected }) => {
    it(`should return "${expected}" for URL "${url}"`, () => {
      assert.equal(inferBuildAction({ url }), expected)
    })
  })

  it('should return full action for URLs without trailing slash', () => {
    assert.equal(inferBuildAction({ url: '/import' }), 'import')
  })
})

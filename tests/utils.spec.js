import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { inferBuildAction } from '../lib/utils/inferBuildAction.js'
import { getPluginUpdateStatus } from '../lib/utils/getPluginUpdateStatus.js'
import { getImportContentCounts } from '../lib/utils/getImportContentCounts.js'

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

describe('getPluginUpdateStatus()', () => {
  it('should return "INVALID" for an invalid import version', () => {
    assert.equal(getPluginUpdateStatus(['1.0.0', 'not-valid'], false, false), 'INVALID')
  })

  it('should return "INSTALLED" when no installed version exists', () => {
    assert.equal(getPluginUpdateStatus([undefined, '1.0.0'], false, false), 'INSTALLED')
  })

  it('should return "OLDER" when import version is older', () => {
    assert.equal(getPluginUpdateStatus(['2.0.0', '1.0.0'], false, false), 'OLDER')
  })

  it('should return "NO_CHANGE" when versions are equal', () => {
    assert.equal(getPluginUpdateStatus(['1.0.0', '1.0.0'], false, false), 'NO_CHANGE')
  })

  it('should return "UPDATE_BLOCKED" when import is newer but updates not enabled and not local', () => {
    assert.equal(getPluginUpdateStatus(['1.0.0', '2.0.0'], false, false), 'UPDATE_BLOCKED')
  })

  it('should return "UPDATED" when import is newer and updates are enabled', () => {
    assert.equal(getPluginUpdateStatus(['1.0.0', '2.0.0'], false, true), 'UPDATED')
  })

  it('should return "UPDATED" when import is newer and is a local install', () => {
    assert.equal(getPluginUpdateStatus(['1.0.0', '2.0.0'], true, false), 'UPDATED')
  })
})

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

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { getPluginUpdateStatus } from '../lib/utils/getPluginUpdateStatus.js'

describe('getPluginUpdateStatus()', () => {
  it('should return "INVALID" for an invalid import version', () => {
    assert.equal(getPluginUpdateStatus(['1.0.0', 'not-valid'], false, 'all'), 'INVALID')
  })

  it('should return "INSTALLED" when no installed version exists', () => {
    assert.equal(getPluginUpdateStatus([undefined, '1.0.0'], false, 'none'), 'INSTALLED')
  })

  it('should return "OLDER" when import version is older', () => {
    assert.equal(getPluginUpdateStatus(['2.0.0', '1.0.0'], false, 'all'), 'OLDER')
  })

  it('should return "NO_CHANGE" when versions are equal', () => {
    assert.equal(getPluginUpdateStatus(['1.0.0', '1.0.0'], false, 'all'), 'NO_CHANGE')
  })

  it('should return "UPDATED" when import is newer for a custom plugin under the default (custom) policy', () => {
    assert.equal(getPluginUpdateStatus(['1.0.0', '2.0.0'], true, 'custom'), 'UPDATED')
  })

  it('should return "UPDATE_BLOCKED" for a newer managed plugin under the custom policy', () => {
    assert.equal(getPluginUpdateStatus(['1.0.0', '2.0.0'], false, 'custom'), 'UPDATE_BLOCKED')
  })

  it('should return "UPDATE_BLOCKED" for a newer custom plugin under the none policy', () => {
    assert.equal(getPluginUpdateStatus(['1.0.0', '2.0.0'], true, 'none'), 'UPDATE_BLOCKED')
  })

  it('should return "UPDATED" for a newer managed plugin only under the all policy', () => {
    assert.equal(getPluginUpdateStatus(['1.0.0', '2.0.0'], false, 'all'), 'UPDATED')
  })
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { getPluginUpdateStatus } from '../lib/utils/getPluginUpdateStatus.js'

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

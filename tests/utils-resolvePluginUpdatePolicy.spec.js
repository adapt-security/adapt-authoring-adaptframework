import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePluginUpdatePolicy } from '../lib/utils/resolvePluginUpdatePolicy.js'

describe('resolvePluginUpdatePolicy()', () => {
  it('should default to "custom" when nothing is provided', () => {
    assert.equal(resolvePluginUpdatePolicy(undefined, undefined), 'custom')
  })

  it('should honour an explicit valid policy over the legacy boolean', () => {
    assert.equal(resolvePluginUpdatePolicy('none', true), 'none')
    assert.equal(resolvePluginUpdatePolicy('all', false), 'all')
    assert.equal(resolvePluginUpdatePolicy('custom', true), 'custom')
  })

  it('should map legacy updatePlugins:true to "all"', () => {
    assert.equal(resolvePluginUpdatePolicy(undefined, true), 'all')
  })

  it('should map an explicit updatePlugins:false to "none"', () => {
    assert.equal(resolvePluginUpdatePolicy(undefined, false), 'none')
  })

  it('should ignore an invalid policy string and fall back to the legacy/default', () => {
    assert.equal(resolvePluginUpdatePolicy('bogus', true), 'all')
    assert.equal(resolvePluginUpdatePolicy('bogus', undefined), 'custom')
  })
})

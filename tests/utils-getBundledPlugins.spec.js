import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { getBundledPlugins } from '../lib/utils/getBundledPlugins.js'

describe('getBundledPlugins()', () => {
  const enabled = [
    { name: 'adapt-contrib-text', type: 'component' },
    { name: 'adapt-contrib-vanilla', type: 'theme' }
  ]
  const disabled = [
    { name: 'adapt-contrib-pageLevelProgress', type: 'extension' },
    { name: 'adapt-contrib-media', type: 'component' },
    { name: 'adapt-contrib-spoor', type: 'extension' },
    { name: 'some-other-theme', type: 'theme' },
    { name: 'some-other-menu', type: 'menu' }
  ]

  it('should return only enabled plugins for a non-preview build', () => {
    assert.deepEqual(getBundledPlugins(false, enabled, disabled), enabled)
  })

  it('should not mutate the enabled array for a non-preview build', () => {
    const result = getBundledPlugins(false, enabled, disabled)
    assert.equal(result, enabled)
  })

  it('should bundle enabled plus disabled non-theme/menu plugins for a preview', () => {
    const result = getBundledPlugins(true, enabled, disabled)
    assert.deepEqual(result.map(p => p.name), [
      'adapt-contrib-text',
      'adapt-contrib-vanilla',
      'adapt-contrib-pageLevelProgress',
      'adapt-contrib-media',
      'adapt-contrib-spoor'
    ])
  })

  it('should exclude disabled themes from a preview', () => {
    const result = getBundledPlugins(true, enabled, disabled)
    assert.ok(!result.some(p => p.name === 'some-other-theme'))
  })

  it('should exclude disabled menus from a preview', () => {
    const result = getBundledPlugins(true, enabled, disabled)
    assert.ok(!result.some(p => p.name === 'some-other-menu'))
  })

  it('should keep enabled themes/menus in a preview (only disabled ones are excluded)', () => {
    const result = getBundledPlugins(true, enabled, disabled)
    assert.ok(result.some(p => p.name === 'adapt-contrib-vanilla' && p.type === 'theme'))
  })

  it('should return only enabled plugins when no plugins are disabled', () => {
    assert.deepEqual(getBundledPlugins(true, enabled, []), enabled)
  })

  it('should return an empty array when nothing is enabled or disabled', () => {
    assert.deepEqual(getBundledPlugins(true, [], []), [])
  })
})

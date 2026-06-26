import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePluginAction } from '../lib/utils/resolvePluginAction.js'

describe('resolvePluginAction()', () => {
  it('should report invalid when the import version is not valid semver', () => {
    const r = resolvePluginAction({ installedVersion: '1.0.0', importVersion: 'nope', isLocalInstall: true, policy: 'all' })
    assert.equal(r.action, 'invalid')
  })

  it('should install when not already installed', () => {
    const r = resolvePluginAction({ installedVersion: undefined, importVersion: '1.0.0', policy: 'none' })
    assert.equal(r.action, 'install')
    assert.equal(r.reason, 'NOT_INSTALLED')
  })

  it('should migrate (keep installed) when the import is older', () => {
    const r = resolvePluginAction({ installedVersion: '2.0.0', importVersion: '1.0.0', isLocalInstall: true, policy: 'all' })
    assert.equal(r.action, 'migrate')
    assert.equal(r.reason, 'IMPORT_OLDER')
  })

  it('should skip (no change) when versions are equal', () => {
    const r = resolvePluginAction({ installedVersion: '1.2.3', importVersion: '1.2.3', isLocalInstall: false, policy: 'all' })
    assert.equal(r.action, 'skip')
    assert.equal(r.reason, 'NO_CHANGE')
  })

  // newer import — the policy matrix
  const newer = { installedVersion: '1.0.0', importVersion: '2.0.0' }
  const cases = [
    { policy: 'none', isLocalInstall: true, action: 'skip', reason: 'CUSTOM_UPDATE_DISABLED' },
    { policy: 'none', isLocalInstall: false, action: 'skip', reason: 'MANAGED_UPDATE_SKIPPED' },
    { policy: 'custom', isLocalInstall: true, action: 'update', reason: 'CUSTOM_NEWER' },
    { policy: 'custom', isLocalInstall: false, action: 'skip', reason: 'MANAGED_UPDATE_SKIPPED' },
    { policy: 'all', isLocalInstall: true, action: 'update', reason: 'CUSTOM_NEWER' },
    { policy: 'all', isLocalInstall: false, action: 'update', reason: 'MANAGED_NEWER' }
  ]
  for (const c of cases) {
    it(`newer import: policy=${c.policy} ${c.isLocalInstall ? 'custom' : 'managed'} -> ${c.action}/${c.reason}`, () => {
      const r = resolvePluginAction({ ...newer, isLocalInstall: c.isLocalInstall, policy: c.policy })
      assert.equal(r.action, c.action)
      assert.equal(r.reason, c.reason)
    })
  }

  it('should default to the custom policy when none is given', () => {
    assert.equal(resolvePluginAction({ installedVersion: '1.0.0', importVersion: '2.0.0', isLocalInstall: true }).action, 'update')
    assert.equal(resolvePluginAction({ installedVersion: '1.0.0', importVersion: '2.0.0', isLocalInstall: false }).action, 'skip')
  })

  it('should treat a prerelease install as newer than its release base (no downgrade)', () => {
    const r = resolvePluginAction({ installedVersion: '5.14.4-pr', importVersion: '5.14.3', isLocalInstall: true, policy: 'all' })
    assert.equal(r.action, 'migrate')
  })
})

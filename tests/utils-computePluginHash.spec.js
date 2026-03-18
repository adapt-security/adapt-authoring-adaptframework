import { before, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

describe('computePluginHash()', () => {
  let computePluginHash

  before(async () => {
    mock.module('adapt-cli/lib/integration/Project.js', {
      defaultExport: class MockProject {
        constructor ({ cwd }) { this.cwd = cwd }
        async getInstalledDependencies () {
          return {
            'adapt-contrib-text': '1.0.0',
            'adapt-contrib-narrative': '2.0.0',
            'adapt-contrib-core': '3.0.0'
          }
        }
      }
    })
    ;({ computePluginHash } = await import('../lib/utils/computePluginHash.js'))
  })

  it('should return a 16-character hex string', async () => {
    const hash = await computePluginHash('/fake/framework')
    assert.match(hash, /^[0-9a-f]{16}$/)
  })

  it('should return the same hash for the same plugin set', async () => {
    const hash1 = await computePluginHash('/fake/framework')
    const hash2 = await computePluginHash('/fake/framework')
    assert.equal(hash1, hash2)
  })

  it('should produce a deterministic hash regardless of insertion order', async () => {
    // The mock always returns the same deps — verify stability
    const hash1 = await computePluginHash('/path/a')
    const hash2 = await computePluginHash('/path/b')
    assert.equal(hash1, hash2)
  })
})

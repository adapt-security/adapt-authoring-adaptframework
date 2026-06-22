import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileAssetTags } from '../lib/utils/reconcileAssetTags.js'

describe('reconcileAssetTags()', () => {
  const valid = new Set(['a', 'b', 'c'])

  const cases = [
    {
      name: 'prune existing tags that no longer resolve',
      existing: ['a', 'stale', 'b'],
      imported: [],
      expected: ['a', 'b']
    },
    {
      name: 'merge imported tags with kept existing tags',
      existing: ['a'],
      imported: ['b'],
      expected: ['a', 'b']
    },
    {
      name: 'de-duplicate overlap between existing and imported',
      existing: ['a', 'b'],
      imported: ['b', 'c'],
      expected: ['a', 'b', 'c']
    },
    {
      name: 'drop every existing tag when all are orphaned',
      existing: ['x', 'y'],
      imported: ['c'],
      expected: ['c']
    },
    {
      name: 'return imported tags when there are no existing tags',
      existing: [],
      imported: ['a', 'b'],
      expected: ['a', 'b']
    },
    {
      name: 'return an empty list when nothing is valid or imported',
      existing: ['stale'],
      imported: [],
      expected: []
    }
  ]

  for (const { name, existing, imported, expected } of cases) {
    it(`should ${name}`, () => {
      assert.deepEqual(reconcileAssetTags(existing, imported, valid), expected)
    })
  }

  it('should coerce non-string ids (e.g. ObjectIds) to strings', () => {
    const id = { toString: () => 'a' }
    assert.deepEqual(reconcileAssetTags([id], [{ toString: () => 'b' }], valid), ['a', 'b'])
  })

  it('should treat missing existing/imported arguments as empty', () => {
    assert.deepEqual(reconcileAssetTags(undefined, undefined, valid), [])
    assert.deepEqual(reconcileAssetTags(['a'], undefined, valid), ['a'])
  })
})

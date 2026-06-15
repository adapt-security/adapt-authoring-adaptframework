import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyContentAccessFilter } from '../lib/utils/applyContentAccessFilter.js'

describe('applyContentAccessFilter()', () => {
  it('should be a no-op when userId is falsy', () => {
    const query = { _type: 'course' }
    applyContentAccessFilter(query, undefined)
    assert.deepEqual(query, { _type: 'course' })
  })

  it('should add a $or clause covering creator, public, and per-user sharing', () => {
    const query = { _type: 'course' }
    applyContentAccessFilter(query, 'user1')
    assert.deepEqual(query.$or, [
      { createdBy: 'user1' },
      { _isShared: true },
      { _shareWithUsers: 'user1' }
    ])
  })

  it('should add a group-sharing grant when the user has groups', () => {
    const query = { _type: 'course' }
    applyContentAccessFilter(query, 'user1', ['g1', 'g2'])
    assert.deepEqual(query.$or, [
      { createdBy: 'user1' },
      { _isShared: true },
      { _shareWithUsers: 'user1' },
      { userGroups: { $in: ['g1', 'g2'] } }
    ])
  })

  it('should not add a group grant when the user has no groups', () => {
    const query = { _type: 'course' }
    applyContentAccessFilter(query, 'user1', [])
    assert.equal(query.$or.length, 3)
    assert.ok(!query.$or.some(c => c.userGroups))
  })

  it('should preserve an existing $or by lifting both into $and', () => {
    const query = { $or: [{ title: 'foo' }] }
    applyContentAccessFilter(query, 'user1')
    assert.equal(query.$or, undefined)
    assert.deepEqual(query.$and, [
      { $or: [{ title: 'foo' }] },
      {
        $or: [
          { createdBy: 'user1' },
          { _isShared: true },
          { _shareWithUsers: 'user1' }
        ]
      }
    ])
  })

  it('should append to an existing $and rather than clobber it', () => {
    const query = { $or: [{ title: 'foo' }], $and: [{ flag: true }] }
    applyContentAccessFilter(query, 'user1')
    assert.equal(query.$or, undefined)
    assert.equal(query.$and.length, 3)
    assert.deepEqual(query.$and[0], { flag: true })
  })

  it('should leave other top-level keys intact', () => {
    const query = { _type: 'course', title: { $regex: 'foo' } }
    applyContentAccessFilter(query, 'user1')
    assert.equal(query._type, 'course')
    assert.deepEqual(query.title, { $regex: 'foo' })
  })
})

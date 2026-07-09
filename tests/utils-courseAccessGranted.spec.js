import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { courseAccessGranted } from '../lib/utils/courseAccessGranted.js'

describe('courseAccessGranted()', () => {
  const cases = [
    { name: 'no course', course: null, userId: 'u1', userGroups: [], expected: false },
    { name: 'public course', course: { _access: { public: true } }, userId: 'u1', userGroups: [], expected: true },
    { name: 'private course, non-owner, no shares', course: { _access: { public: false }, createdBy: 'u2' }, userId: 'u1', userGroups: [], expected: false },
    { name: 'owner', course: { _access: { public: false }, createdBy: 'u1' }, userId: 'u1', userGroups: [], expected: true },
    { name: 'shared with user', course: { _access: { public: false, users: ['u1'] } }, userId: 'u1', userGroups: [], expected: true },
    { name: 'not shared with user', course: { _access: { public: false, users: ['u2'] } }, userId: 'u1', userGroups: [], expected: false },
    { name: 'shared with a group the user is in', course: { _access: { public: false, groups: ['g2'] } }, userId: 'u1', userGroups: ['g1', 'g2'], expected: true },
    { name: 'shared with a group the user is not in', course: { _access: { public: false, groups: ['g3'] } }, userId: 'u1', userGroups: ['g1', 'g2'], expected: false },
    { name: 'no _access at all (private by absence)', course: { createdBy: 'u2' }, userId: 'u1', userGroups: [], expected: false },
    { name: 'ObjectId-like owner via toString', course: { createdBy: { toString: () => 'u1' } }, userId: 'u1', userGroups: [], expected: true }
  ]
  for (const { name, course, userId, userGroups, expected } of cases) {
    it(`should return ${expected}: ${name}`, () => {
      assert.equal(courseAccessGranted(course, userId, userGroups), expected)
    })
  }
})

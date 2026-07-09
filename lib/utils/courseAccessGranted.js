/**
 * Determines whether a user may access a course based on its generic `_access` grants
 * (public / per-user / per-group) plus `createdBy` ownership. Additive: any matching
 * dimension grants access. This is the per-item equivalent of the clauses built by
 * `applyContentAccessFilter`, used by the content access resolver so that a course and
 * all its descendants are judged by the course's access.
 * @param {Object} course The course document (needs `_access` and `createdBy`)
 * @param {String} userId The requesting user's id (stringified)
 * @param {Array} [userGroups] The requesting user's group memberships
 * @return {Boolean}
 * @memberof adaptframework
 */
export function courseAccessGranted (course, userId, userGroups = []) {
  if (!course) return false
  const groups = userGroups.map(g => g.toString())
  return course._access?.public === true ||
    course.createdBy?.toString() === userId ||
    (course._access?.users ?? []).some(u => u.toString() === userId) ||
    (course._access?.groups ?? []).some(g => groups.includes(g.toString()))
}

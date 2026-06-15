/**
 * Mutates a mongo content query so it only matches courses the given user can access:
 * owned by them, marked public via `_isShared`, in `_shareWithUsers`, or shared with one
 * of the user's groups (`userGroups`). All are additive grants — sharing a course via any
 * dimension widens access. Combines safely with an existing `$or` (e.g. from search) by
 * lifting both into `$and`.
 * @param {object} query The mongo query object to mutate
 * @param {string} userId The user's `_id` (already coerced to string)
 * @param {Array} [userGroups] The user's group ids; adds a group-sharing grant when present
 * @memberof adaptframework
 */
export function applyContentAccessFilter (query, userId, userGroups = []) {
  if (!userId) return
  const clauses = [
    { createdBy: userId },
    { _isShared: true },
    { _shareWithUsers: userId }
  ]
  // a course shared with any group the user belongs to (optional dimension —
  // only present when the usergroups module is in use)
  if (userGroups?.length) clauses.push({ userGroups: { $in: userGroups } })
  if (query.$or) {
    query.$and = [
      ...(query.$and ?? []),
      { $or: query.$or },
      { $or: clauses }
    ]
    delete query.$or
  } else {
    query.$or = clauses
  }
}

/**
 * Mutates a mongo content query so it only matches courses the given user can access:
 * owned by them, marked public via `_isShared`, or in `_shareWithUsers`. Combines safely
 * with an existing `$or` (e.g. from search) by lifting both into `$and`.
 * @param {object} query The mongo query object to mutate
 * @param {string} userId The user's `_id` (already coerced to string)
 * @memberof adaptframework
 */
export function applyContentAccessFilter (query, userId) {
  if (!userId) return
  const clauses = [
    { createdBy: userId },
    { _isShared: true },
    { _shareWithUsers: userId }
  ]
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

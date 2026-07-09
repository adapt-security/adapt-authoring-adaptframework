/**
 * Backfills the generic `_access` grants on courses from the legacy sharing fields,
 * preserving existing semantics. Legacy `_isShared` / `_shareWithUsers` are left in place
 * until the contract step (#224). The `userGroups` → `_access.groups` mapping is owned by
 * the usergroups module.
 *
 * `_access.public` is written EXPLICITLY (not left to the schema default of `true`) so that
 * previously-private courses (`_isShared` falsy) stay private after the migration.
 * Idempotent: only touches course documents that don't yet carry `_access.public`.
 */
export default function (migration) {
  migration.describe('Backfill course _access.public/_access.users from legacy _isShared/_shareWithUsers')
  migration.runCommand(backfillCourseAccess)
}

async function backfillCourseAccess (db) {
  return db.collection('content').updateMany(
    { _type: 'course', '_access.public': { $exists: false } },
    [{
      $set: {
        '_access.public': { $eq: ['$_isShared', true] },
        '_access.users': { $ifNull: ['$_shareWithUsers', []] }
      }
    }]
  )
}

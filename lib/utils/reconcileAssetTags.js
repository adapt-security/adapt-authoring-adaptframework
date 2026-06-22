/**
 * Reconciles the tag references of an asset that persisted across a re-import. Prunes any
 * existing tag ids that no longer resolve to a tag document (orphaned when tags are
 * regenerated with fresh ids) and merges in the tags from the current import. Returns a
 * de-duplicated list of string ids.
 * @param {Array<String>} existingTags Tag ids currently stored on the persisted asset
 * @param {Array<String>} importTags Tag ids resolved for this import (already valid)
 * @param {Set<String>} validTagIds Every currently-valid tag id, as strings
 * @return {Array<String>} The reconciled, de-duplicated tag ids
 * @memberof adaptframework
 */
export function reconcileAssetTags (existingTags, importTags, validTagIds) {
  const kept = (existingTags ?? []).filter(t => validTagIds.has(t.toString()))
  return [...new Set([...kept, ...(importTags ?? [])].map(t => t.toString()))]
}

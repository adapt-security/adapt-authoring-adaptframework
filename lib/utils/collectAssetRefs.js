/**
 * Partitions the asset references found across a course's content into those that parse to
 * a valid id and those that don't, tagging each unparseable reference with the content item
 * it came from so a build can report or skip it rather than aborting with no context.
 * @param {Array<Object>} courseContent Content documents projected with _id, _type and _assetIds
 * @param {Function} parse Parser applied to each reference; throws for an invalid id
 * @return {{ valid: Array, invalid: Array<{ id: *, contentId: *, contentType: String }> }}
 * @memberof adaptframework
 */
export function collectAssetRefs (courseContent, parse) {
  const valid = []
  const invalid = []
  for (const c of courseContent ?? []) {
    for (const id of c._assetIds ?? []) {
      try {
        valid.push(parse(id))
      } catch (e) {
        invalid.push({ id, contentId: c._id, contentType: c._type })
      }
    }
  }
  return { valid, invalid }
}

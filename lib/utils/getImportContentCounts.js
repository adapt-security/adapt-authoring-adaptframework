/**
 * Returns a map of content types and their instance count in the content JSON
 * @param {Object} content Course content
 * @returns {Object}
 */
export function getImportContentCounts (content) {
  return Object.values(content).reduce((m, c) => {
    const items = c._type ? [c] : Object.values(c)
    return items.reduce((m, { _type }) => {
      return { ...m, [_type]: m[_type] !== undefined ? m[_type] + 1 : 1 }
    }, m)
  }, {})
}

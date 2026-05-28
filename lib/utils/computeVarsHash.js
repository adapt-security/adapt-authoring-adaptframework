import { createHash } from 'node:crypto'

/**
 * Serialises a value to JSON with object keys sorted (arrays preserve order, undefined → null)
 * @param {*} value
 * @return {String}
 */
export function canonicalJson (value) {
  if (value === undefined || value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}'
}

/**
 * Hashes per-course LESS inputs (themeVariables + customStyle) for the cache key
 * @param {Object} [data]
 * @param {Object} [data.themeVariables]
 * @param {String} [data.customStyle]
 * @return {String} 12-char hex hash
 */
export function computeVarsHash ({ themeVariables, customStyle } = {}) {
  const input = canonicalJson({
    themeVariables: themeVariables ?? null,
    customStyle: customStyle ?? null
  })
  return createHash('sha256').update(input).digest('hex').slice(0, 12)
}

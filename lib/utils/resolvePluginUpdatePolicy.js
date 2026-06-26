export const PLUGIN_UPDATE_POLICIES = ['none', 'custom', 'all']

/**
 * Resolves the effective plugin update policy, mapping the legacy `updatePlugins`
 * boolean for backwards compatibility.
 * - an explicit valid `pluginUpdatePolicy` always wins
 * - `updatePlugins: true`  -> 'all'
 * - `updatePlugins: false` (explicitly passed) -> 'none'
 * - neither provided -> 'custom' (default)
 * @param {String} [pluginUpdatePolicy] One of 'none' | 'custom' | 'all'
 * @param {Boolean} [updatePlugins] Legacy boolean
 * @returns {'none'|'custom'|'all'}
 */
export function resolvePluginUpdatePolicy (pluginUpdatePolicy, updatePlugins) {
  if (PLUGIN_UPDATE_POLICIES.includes(pluginUpdatePolicy)) return pluginUpdatePolicy
  if (updatePlugins === true) return 'all'
  if (updatePlugins === false) return 'none'
  return 'custom'
}

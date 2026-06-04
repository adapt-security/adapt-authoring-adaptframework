/**
 * Returns the plugins bundled into a build. A preview's cache is shared across
 * courses, so it bundles all installed plugins — except disabled themes/menus,
 * since only one of each can be active per build and the framework's less:dev
 * task globs every theme/menu in src/, which OOMs when more than one is present
 * (see adapt_framework#3802). Non-preview builds bundle only enabled plugins.
 * @param {Boolean} isPreview Whether this is a preview build
 * @param {Array<Object>} enabledPlugins Plugins used by the course
 * @param {Array<Object>} disabledPlugins Plugins installed but not used by the course
 * @return {Array<Object>} The plugins to bundle
 */
export function getBundledPlugins (isPreview, enabledPlugins, disabledPlugins) {
  if (!isPreview) return enabledPlugins
  return [
    ...enabledPlugins,
    ...disabledPlugins.filter(p => p.type !== 'theme' && p.type !== 'menu')
  ]
}

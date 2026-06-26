import semver from 'semver'

/**
 * Single source of truth for what a course import should do with one plugin.
 * Pure: no app state, no side effects — so the status report and the executor
 * can both derive from it and never disagree.
 *
 * Plugin classes (see contentplugin `isLocalInstall`):
 * - custom  = local install (uploaded with a course / local path)
 * - managed = installed by name from the registry/framework manifest
 *
 * @param {Object} options
 * @param {String} [options.installedVersion] Installed version, falsy if not installed
 * @param {String} options.importVersion Version present in the import
 * @param {Boolean} [options.isLocalInstall] Whether the installed plugin is a custom (local) install
 * @param {'none'|'custom'|'all'} [options.policy='custom'] Update policy
 * @returns {{ action: String, reason: String }}
 *   action: 'install' | 'update' | 'migrate' | 'skip' | 'invalid'
 */
export function resolvePluginAction ({ installedVersion, importVersion, isLocalInstall, policy = 'custom' }) {
  if (!semver.valid(importVersion)) return { action: 'invalid', reason: 'INVALID_IMPORT_VERSION' }
  if (!installedVersion) return { action: 'install', reason: 'NOT_INSTALLED' }
  if (semver.lt(importVersion, installedVersion)) return { action: 'migrate', reason: 'IMPORT_OLDER' }
  if (semver.eq(importVersion, installedVersion)) return { action: 'skip', reason: 'NO_CHANGE' }
  // import is strictly newer than installed
  const mayUpdate = policy === 'all' || (policy === 'custom' && isLocalInstall === true)
  if (mayUpdate) return { action: 'update', reason: isLocalInstall ? 'CUSTOM_NEWER' : 'MANAGED_NEWER' }
  return {
    action: 'skip',
    reason: isLocalInstall ? 'CUSTOM_UPDATE_DISABLED' : 'MANAGED_UPDATE_SKIPPED'
  }
}

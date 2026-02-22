import semver from 'semver'

/**
 * Determines the update status code for a plugin based on version comparison
 * @param {Array} versions Tuple of [installedVersion, importVersion]
 * @param {Boolean} isLocalInstall Whether the plugin is a local install
 * @param {Boolean} updatePlugins Whether plugin updates are enabled
 * @returns {String} The update status code
 */
export function getPluginUpdateStatus (versions, isLocalInstall, updatePlugins) {
  const [installedVersion, importVersion] = versions
  if (!semver.valid(importVersion)) return 'INVALID'
  if (!installedVersion) return 'INSTALLED'
  if (semver.lt(importVersion, installedVersion)) return 'OLDER'
  if (semver.gt(importVersion, installedVersion)) {
    if (!updatePlugins && !isLocalInstall) return 'UPDATE_BLOCKED'
    return 'UPDATED'
  }
  return 'NO_CHANGE'
}

import { resolvePluginAction } from './resolvePluginAction.js'

const ACTION_TO_STATUS = {
  invalid: 'INVALID',
  install: 'INSTALLED',
  migrate: 'OLDER',
  update: 'UPDATED'
}

/**
 * Maps the resolved import action for a plugin to a display status code.
 * Thin label-mapper over resolvePluginAction so the status report and the
 * import executor always agree.
 * @param {Array} versions Tuple of [installedVersion, importVersion]
 * @param {Boolean} isLocalInstall Whether the installed plugin is a custom (local) install
 * @param {'none'|'custom'|'all'} policy The plugin update policy
 * @returns {String} 'INVALID' | 'INSTALLED' | 'OLDER' | 'NO_CHANGE' | 'UPDATED' | 'UPDATE_BLOCKED'
 */
export function getPluginUpdateStatus (versions, isLocalInstall, policy) {
  const [installedVersion, importVersion] = versions
  const { action, reason } = resolvePluginAction({ installedVersion, importVersion, isLocalInstall, policy })
  if (action === 'skip') return reason === 'NO_CHANGE' ? 'NO_CHANGE' : 'UPDATE_BLOCKED'
  return ACTION_TO_STATUS[action]
}

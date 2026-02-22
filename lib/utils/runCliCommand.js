import AdaptCli from 'adapt-cli'
import { App } from 'adapt-authoring-core'

/**
 * Wrapper for running adapt-cli commands
 * @param {string} command Command to run
 * @param {object} opts Extra options
 */
export async function runCliCommand (command, opts = {}) {
  if (typeof AdaptCli[command] !== 'function') {
    throw App.instance.errors.FW_CLI_UNKNOWN_CMD.setData({ command })
  }
  const debugLog = (...args) => App.instance.logger.log('debug', 'adapt-cli', ...args)

  App.instance.logger.log('verbose', 'adapt-cli', 'CMD_START', command, opts)
  const res = await AdaptCli[command]({
    cwd: App.instance.config.get('adapt-authoring-adaptframework.frameworkDir'),
    repository: App.instance.config.get('adapt-authoring-adaptframework.frameworkRepository'),
    logger: { log: debugLog, logProgress: debugLog, write: debugLog },
    ...opts
  })
  App.instance.logger.log('verbose', 'adapt-cli', 'CMD_END', command, opts)
  return res
}

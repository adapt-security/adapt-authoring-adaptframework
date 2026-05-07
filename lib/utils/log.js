import { App } from 'adapt-authoring-core'
import bytes from 'bytes'
import fsSync from 'node:fs'
import path from 'upath'

/**
 * Logs a message using the framework module's namespace
 * @param {String} level Log level
 * @param {...*} rest Arguments to be logged
 */
export function log (level, ...rest) {
  App.instance?.logger?.log(level, 'adaptframework', ...rest)
}

/**
 * Logs directory path and file mode information
 * @param {string} label Label for the directory
 * @param {string} dir Directory path
 */
export function logDir (label, dir) {
  try {
    const resolved = dir ? path.resolve(dir) : undefined
    log('verbose', 'DIR', label, resolved)
    if (resolved) log('verbose', 'DIR_MODE', label, fsSync.statSync(resolved).mode)
  } catch (e) {
    log('warn', `failed to log dir ${label} (${dir}), ${e.code}`)
  }
}

/**
 * Logs current memory usage statistics
 */
export function logMemory () {
  log('verbose', 'MEMORY', Object.entries(process.memoryUsage()).reduce((m, [k, v]) => Object.assign(m, { [k]: bytes.parse(v) }), {}))
}
